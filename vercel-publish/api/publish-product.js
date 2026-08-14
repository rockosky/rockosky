// /api/publish-product.js
//
// Called by the admin dashboard when Felipe hits "Approve & Publish".
// 1. Loads the photo's saved details from Supabase (service role, bypasses RLS)
// 2. Downloads the image from Supabase Storage
// 3. Publishes it as a Squarespace product — see PRODUCT STRATEGY below
// 4. Writes the resulting Squarespace product id/url back to Supabase, status -> 'published'
//
// ============================================================
// PRODUCT STRATEGY — why this isn't a plain "create a DIGITAL product" call
// ============================================================
// Confirmed live (see /api/test-digital-patch.js): Squarespace's Commerce
// API refuses to CREATE a product with type DIGITAL — it 405s with
// OPERATION_NOT_ALLOWED_FOR_PRODUCT_TYPE. Only PHYSICAL can be created
// through that endpoint. What's NOT yet confirmed live is whether it will
// let you PATCH/update a DIGITAL product that already exists.
//
// So this endpoint takes the approach that's actually possible today:
//   1. Look for an unused DIGITAL product "template" already sitting in
//      the store — one you create ONCE by hand in the Squarespace
//      dashboard (type: Digital), tag with `kf-template-unused`, and
//      leave hidden. This script finds one of those and PATCHes it with
//      the real title/price/description/image/tags, then makes it
//      visible — so the live listing is a genuine DIGITAL product, never
//      created via the blocked endpoint, only ever edited.
//   2. If no template is found (or patching one fails for any reason),
//      it falls back to creating a PHYSICAL product the old way, so
//      publishing never just breaks — it degrades instead of failing.
//   3. Every step's real success/failure is collected in `diagnostics`
//      and shown back in the admin dashboard, so it's obvious which path
//      was taken and whether the image/inventory steps actually worked
//      rather than silently guessing.
//
// TO USE THE DIGITAL PATH: in Squarespace, create one or more Digital
// products by hand (any placeholder title/price is fine), tag each with
// exactly `kf-template-unused`, and leave them hidden (isVisible: false).
// This script consumes one template per publish and removes the tag once
// used, so keep a small stock of them around (a handful is plenty since
// they get reused... actually they're consumed, not reused — see note
// below on making more).
// ============================================================

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;
const BUCKET = "Ketchup Files UPLOADS";
const TEMPLATE_TAG = "kf-template-unused";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { photo_id } = req.body || {};
  if (!photo_id) {
    res.status(400).json({ error: 'photo_id is required' });
    return;
  }

  try {
    // 1. Load photo row (service role key bypasses RLS)
    const photoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/photos?id=eq.${photo_id}&select=*`,
      { headers: supabaseHeaders() }
    );
    const photos = await photoRes.json();
    const photo = photos && photos[0];
    if (!photo) throw new Error('Photo not found');
    if (!photo.title || !photo.city || !photo.season || photo.price_cents == null) {
      throw new Error('Photo is missing title, city, season, or price');
    }

    // 2. Public image URL from Supabase Storage
    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${photo.file_path}`;

    // 3. Find the store collection matching this city + season
    const storePageId = await getOrCreateStorePage(photo.city, photo.season);

    // 4. Publish — DIGITAL-via-template first, PHYSICAL-create fallback second
    const product = await publishProduct({
      title: photo.title,
      description: photo.description || '',
      priceCents: photo.price_cents,
      city: photo.city,
      season: photo.season,
      hashtags: photo.hashtags || '',
      socialUrl: photo.social_url || '',
      storePageId,
      imageUrl
    });

    // 5. Write back to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/photos?id=eq.${photo_id}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        status: 'published',
        squarespace_product_id: product.id,
        squarespace_product_url: product.url,
        published_at: new Date().toISOString()
      })
    });

    res.status(200).json({ ok: true, url: product.url, productType: product.type, diagnostics: product.diagnostics });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };
}

// Looks up an existing store page/collection whose name contains BOTH
// the given city and season, falling back to city-only if no exact
// combined match is found.
async function getOrCreateStorePage(city, season) {
  const listRes = await fetch('https://api.squarespace.com/1.0/commerce/store_pages', {
    headers: squarespaceHeaders()
  });
  const list = await listRes.json();
  const pages = list.storePages || list.pages || list.results || (Array.isArray(list) ? list : []);

  const cityLower = (city || '').toLowerCase().trim();
  const seasonLower = (season || '').toLowerCase().trim();

  var existing = pages.find((p) => {
    if (!p || !p.title) return false;
    const nameLower = p.title.toLowerCase();
    return nameLower.includes(cityLower) && (seasonLower ? nameLower.includes(seasonLower) : true);
  });

  if (!existing) {
    existing = pages.find((p) => p && p.title && p.title.toLowerCase().includes(cityLower));
  }

  if (existing && existing.id) return existing.id;

  throw new Error(
    `No store page found containing both "${city}" and "${season}" in its name. ` +
    `Available page names: ${pages.map(p => p && p.title).filter(Boolean).join(', ') || '(none found)'}.`
  );
}

// ---- Top-level publish flow: try DIGITAL-via-template, fall back to
// PHYSICAL-create only if that's not possible right now. ----
async function publishProduct(details) {
  var diagnostics = [];

  const template = await findDigitalTemplate();
  if (template) {
    diagnostics.push('Product type: attempting DIGITAL (patching template ' + template.id + ')');
    try {
      const patched = await patchDigitalTemplate(template, details, diagnostics);
      diagnostics.push('Product type: DIGITAL — success');
      return { id: patched.id, url: patched.url, type: 'DIGITAL', diagnostics: diagnostics.join(' | ') };
    } catch (templateErr) {
      diagnostics.push('DIGITAL template patch failed, falling back to PHYSICAL: ' + templateErr.message);
    }
  } else {
    diagnostics.push('Product type: no unused DIGITAL template found (tag "' + TEMPLATE_TAG + '"), using PHYSICAL. ' +
      'Create a hidden Digital product in Squarespace tagged "' + TEMPLATE_TAG + '" to enable true digital publishing.');
  }

  const created = await createPhysicalProduct(details, diagnostics);
  return { id: created.id, url: created.url, type: 'PHYSICAL', diagnostics: diagnostics.join(' | ') };
}

// ---- Find one unused DIGITAL template product, tagged and hidden,
// created by hand in the Squarespace dashboard ahead of time. ----
async function findDigitalTemplate() {
  const listRes = await fetch('https://api.squarespace.com/1.0/commerce/products', {
    headers: squarespaceHeaders()
  });
  if (!listRes.ok) return null;
  const data = await listRes.json();
  const products = data.products || data.results || (Array.isArray(data) ? data : []);
  const match = products.find((p) =>
    p && p.type === 'DIGITAL' && Array.isArray(p.tags) && p.tags.includes(TEMPLATE_TAG)
  );
  return match || null;
}

// ---- Turn a blank DIGITAL template into the real listing via PUT.
// (Confirmed live: PATCH gets a 405 "Method 'PATCH' is not supported"
// on /1.0/commerce/products/{id} — Squarespace wants PUT for updates,
// same as it does for the variant/price endpoint below.) ----
async function patchDigitalTemplate(template, details, diagnostics) {
  const fullDescription = buildDescription(details);
  const remainingTags = (template.tags || []).filter(t => t !== TEMPLATE_TAG);
  const newTags = remainingTags.concat([details.city, details.season, 'Ketchup Files']);

  const patchBody = {
    storePageId: details.storePageId,
    name: details.title,
    description: fullDescription,
    isVisible: true,
    tags: newTags
  };

  const patchRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${template.id}`, {
    method: 'PUT',
    headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody)
  });
  if (!patchRes.ok) {
    const errText = await patchRes.text();
    throw new Error('Base update failed: ' + errText.substring(0, 300));
  }
  const product = await patchRes.json();

  // Price lives on the variant, not the product itself — update the
  // template's existing variant rather than trying to replace the
  // variants array wholesale (which some Commerce endpoints reject).
  const variantId = product.variants && product.variants[0] && product.variants[0].id;
  if (variantId) {
    const priceRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${template.id}/variants/${variantId}`, {
      method: 'PUT',
      headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ pricing: { basePrice: { currency: 'USD', value: (details.priceCents / 100).toFixed(2) } } })
    });
    diagnostics.push(priceRes.ok ? 'Price: OK' : 'Price: FAILED — ' + (await priceRes.text()).substring(0, 200));
    await attemptSetStock(template.id, variantId, diagnostics);
  } else {
    diagnostics.push('Price: skipped, template has no variant to update');
  }

  await attemptAttachImage(template.id, details.imageUrl, diagnostics);

  return { id: product.id, url: product.url || template.url || '' };
}

// ---- Fallback: create a PHYSICAL product the way this always has, for
// when no digital template is available yet. ----
async function createPhysicalProduct(details, diagnostics) {
  const fullDescription = buildDescription(details);
  var hashtagList = (details.hashtags || '').split(',').map(function(t){ return t.trim(); }).filter(Boolean);

  const body = {
    type: 'PHYSICAL',
    storePageId: details.storePageId,
    name: details.title,
    description: fullDescription,
    isVisible: true,
    tags: [details.city, details.season, 'Ketchup Files'].concat(hashtagList),
    variants: [
      {
        pricing: { basePrice: { currency: 'USD', value: (details.priceCents / 100).toFixed(2) } },
        sku: `KF-${Date.now()}`,
        unlimited: true
      }
    ]
  };

  const createRes = await fetch('https://api.squarespace.com/1.0/commerce/products', {
    method: 'POST',
    headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Squarespace product create failed: ${errText}`);
  }
  const product = await createRes.json();

  const variantId = product.variants && product.variants[0] && product.variants[0].id;
  if (variantId) {
    const createdUnlimited = product.variants[0].unlimited === true;
    diagnostics.push(createdUnlimited
      ? 'Inventory: OK (unlimited set at creation)'
      : 'Inventory: "unlimited" at creation didn\'t stick, trying variant update…');
    if (!createdUnlimited) await attemptSetStock(product.id, variantId, diagnostics);
  } else {
    diagnostics.push('Inventory: skipped, no variant ID found');
  }

  await attemptAttachImage(product.id, details.imageUrl, diagnostics);

  return { id: product.id, url: product.url || '' };
}

function buildDescription(details) {
  var hashtagList = (details.hashtags || '').split(',').map(function(t){ return t.trim(); }).filter(Boolean);
  return (details.description || '') + `\n\nLocation: ${details.city} — ${details.season}`
    + (hashtagList.length ? `\n\n${hashtagList.map(t => '#' + t.replace(/^#/, '')).join(' ')}` : '')
    + (details.socialUrl ? `\n\nProfile / Link: ${details.socialUrl}` : '');
}

// ---- Stock: confirmed live this screenshot's actual symptom — a
// created product landed with 0 stock ("Agotado"/Sold Out), meaning
// "unlimited: true" at creation time (tried above) may not have stuck.
// Rather than keep guessing at the separate /inventory/adjustments
// endpoint (which rejected 4 different shapes across PATCH/PUT/POST),
// this tries the SAME variant PUT endpoint that's confirmed working for
// price — since that call already succeeds, adding stock fields to it
// is a much better bet than a different endpoint that's failed every
// time so far. Falls back to the adjustments endpoint only as a last
// resort. Non-fatal either way, but note this one actually matters:
// 0 stock blocks real sales, unlike the earlier failures which didn't. ----
async function attemptSetStock(productId, variantId, diagnostics) {
  const variantAttempts = [
    { label: 'variant PUT unlimited', payload: { unlimited: true } },
    { label: 'variant PUT stock.unlimited', payload: { stock: { unlimited: true } } },
    { label: 'variant PUT stock.quantity', payload: { stock: { quantity: 999, unlimited: false } } }
  ];
  for (const attempt of variantAttempts) {
    try {
      const res = await fetch(`https://api.squarespace.com/1.0/commerce/products/${productId}/variants/${variantId}`, {
        method: 'PUT',
        headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt.payload)
      });
      if (res.ok) {
        diagnostics.push('Inventory: OK (' + attempt.label + ')');
        return;
      }
      const errText = await res.text();
      diagnostics.push('Inventory (' + attempt.label + '): FAILED — ' + errText.substring(0, 150));
    } catch (e) {
      diagnostics.push('Inventory (' + attempt.label + '): FAILED — ' + e.message);
    }
  }

  // Last resort: the separate adjustments endpoint, in case it turns out
  // to need an idempotency key AND a shape none of the above guessed.
  try {
    const invRes = await fetch('https://api.squarespace.com/1.0/commerce/inventory/adjustments', {
      method: 'POST',
      headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify([{ variantId: variantId, quantity: 999 }])
    });
    if (invRes.ok) {
      diagnostics.push('Inventory: OK (adjustments endpoint, bare array)');
      return;
    }
    diagnostics.push('Inventory (adjustments endpoint): FAILED — ' + (await invRes.text()).substring(0, 150));
  } catch (e) {
    diagnostics.push('Inventory (adjustments endpoint): FAILED — ' + e.message);
  }
  diagnostics.push('Inventory: all automated attempts failed — until this is confirmed working, check "Continue selling when out of stock" in this product\'s Squarespace inventory settings as an immediate workaround so it isn\'t stuck showing Sold Out.');
}

// ---- Image/thumbnail attach: confirmed live that this endpoint wants a
// real file upload, not a JSON body referencing a URL — the earlier
// {images:[{url}]} attempt got back "Expected exactly one file part
// named 'file', but found none." So this downloads the actual image
// bytes from Supabase Storage and POSTs them as multipart/form-data
// with the field named 'file', which is what the error message says
// it's looking for. ----
async function attemptAttachImage(productId, imageUrl, diagnostics) {
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      diagnostics.push('Image: FAILED — could not download source image (' + imgRes.status + ')');
      return;
    }
    const imgBlob = await imgRes.blob();
    const fileName = imageUrl.split('/').pop() || 'photo.jpg';

    const form = new FormData();
    form.append('file', imgBlob, fileName);

    const uploadRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${productId}/images`, {
      method: 'POST',
      headers: squarespaceHeaders(), // no Content-Type here — FormData sets its own multipart boundary
      body: form
    });
    if (uploadRes.ok) {
      diagnostics.push('Image: OK (multipart upload)');
      return;
    }
    const errText = await uploadRes.text();
    diagnostics.push('Image: FAILED — ' + errText.substring(0, 200));
  } catch (e) {
    diagnostics.push('Image: FAILED — ' + e.message);
  }
}

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles-Publisher/1.0'
  };
}
