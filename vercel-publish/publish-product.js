

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;
const BUCKET = "Ketchup Files UPLOADS";
const ORIGINALS_BUCKET = "Ketchup Files ORIGINALS"; // private — clean, non-watermarked files
const TEMPLATE_TAG = "kf-template-unused";

// CORS headers as a plain object, applied identically and explicitly on
// every single response path (including OPTIONS) rather than relying on
// setHeader calls that a caching layer further upstream could
// theoretically strip on some responses but not others. Confirmed live
// via a real browser CORS error that a stale/cached response was
// missing Access-Control-Allow-Origin entirely — this is the belt-and-
// suspenders fix for that, paired with a hard cache-busting redeploy.
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store' // prevent this exact "stale CORS-less response" scenario from ever being cacheable again
  };
}

module.exports = async (req, res) => {
  const headers = corsHeaders();
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === 'OPTIONS') {
    // 200 with an explicit empty body instead of 204 — some edge/proxy
    // layers have historically handled 204 (no content) responses
    // inconsistently when custom headers are attached; 200 with a body
    // is the more universally reliable choice for a preflight response.
    res.status(200).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { photo_id, auto, product_type } = req.body || {};
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

    // 2b. Signed URL to the clean original, if one was saved (private
    // bucket — needs a signed URL rather than a public one). Only used
    // for the DIGITAL path, to fill Squarespace's native file-delivery
    // slot; the PHYSICAL fallback has no equivalent field.
    let originalFileUrl = null;
    if (photo.original_file_path) {
      const signRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(ORIGINALS_BUCKET)}/${photo.original_file_path}`,
        {
          method: 'POST',
          headers: { ...supabaseHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 300 }) // just long enough to immediately re-download and forward to Squarespace
        }
      );
      if (signRes.ok) {
        const signData = await signRes.json();
        if (signData.signedURL) originalFileUrl = `${SUPABASE_URL}/storage/v1${signData.signedURL}`;
      }
    }

    // 3. Publish — DIGITAL-via-template first, PHYSICAL-create fallback
    // second. In auto mode (triggered straight from upload, no admin
    // review), the Physical fallback is skipped entirely — auto-publish
    // is only for the clean, no-stock-issues Digital path. If no
    // Digital template is available, the upload just stays 'pending'
    // for a human to review normally, same as before this feature
    // existed, rather than silently creating a Physical listing with
    // nobody having looked at it.
    //
    // Note: the store-page lookup (matching a city/season page like
    // "new-york-fashion-week-2026") is only needed for the Physical
    // fallback now — Digital products stay on whichever page their
    // template already lives on. So it's looked up lazily inside
    // createPhysicalProduct itself, not here, otherwise a city/season
    // with no matching physical page would incorrectly fail an
    // otherwise-successful Digital publish.
    const allowPhysicalFallback = !auto;
    const forceType = (product_type === 'digital' || product_type === 'physical') ? product_type : null;
    const product = await publishProduct({
      title: photo.title,
      description: photo.description || '',
      priceCents: photo.price_cents,
      city: photo.city,
      season: photo.season,
      hashtags: photo.hashtags || '',
      socialUrl: photo.social_url || '',
      imageUrl,
      originalFileUrl
    }, allowPhysicalFallback, forceType);

    if (!product) {
      // auto mode, no digital template available -- leave the photo
      // exactly as it was (still 'pending') and say so plainly.
      res.status(200).json({
        ok: true,
        held: true,
        message: 'No Digital template available yet — left pending for manual review instead of auto-publishing as Physical.'
      });
      return;
    }

    if (product.failed) {
      // manual override picked a type that couldn't actually be
      // fulfilled (e.g. forced Digital but no template exists) -- report
      // that clearly instead of silently publishing as something else.
      res.status(200).json({
        ok: false,
        diagnostics: product.diagnostics
      });
      return;
    }

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
// Every published product — Digital or the Physical fallback alike —
// lands on this one page: ketchupfiles.com/street-style-contributors.
// Matched by URL slug rather than title, since that's the actual part
// of the address ("/street-style-contributors/p/...") that has to be
// right, and titles/slugs don't always match exactly.
const TARGET_STORE_PAGE_SLUG = 'street-style-contributors';

async function getTargetStorePage() {
  const listRes = await fetch('https://api.squarespace.com/1.0/commerce/store_pages', {
    headers: squarespaceHeaders()
  });
  const list = await listRes.json();
  const pages = list.storePages || list.pages || list.results || (Array.isArray(list) ? list : []);

  const existing = pages.find((p) => {
    if (!p) return false;
    const slug = (p.urlSlug || p.identifier || '').toLowerCase();
    const title = (p.title || '').toLowerCase();
    return slug === TARGET_STORE_PAGE_SLUG || title.includes(TARGET_STORE_PAGE_SLUG.replace(/-/g, ' '));
  });

  if (existing && existing.id) return existing.id;

  throw new Error(
    `Could not find the "${TARGET_STORE_PAGE_SLUG}" store page. ` +
    `Available page names: ${pages.map(p => p && p.title).filter(Boolean).join(', ') || '(none found)'}.`
  );
}

// ---- Top-level publish flow: try DIGITAL-via-template, fall back to
// PHYSICAL-create only if that's not possible right now. ----
async function publishProduct(details, allowPhysicalFallback = true, forceType = null) {
  var diagnostics = [];

  // Manual override: skip auto-detection entirely when the admin/uploader
  // explicitly picked a type instead of leaving it on auto-detect.
  if (forceType === 'physical') {
    diagnostics.push('Product type: FORCED to PHYSICAL (manual selection)');
    const created = await createPhysicalProduct(details, diagnostics);
    return { id: created.id, url: created.url, type: 'PHYSICAL', diagnostics: diagnostics.join(' | ') };
  }
  if (forceType === 'digital') {
    const template = await findDigitalTemplate();
    if (!template) {
      diagnostics.push('Product type: FORCED to DIGITAL but no unused template found (tag "' + TEMPLATE_TAG + '") — nothing published.');
      return { id: null, url: null, type: null, diagnostics: diagnostics.join(' | '), failed: true };
    }
    diagnostics.push('Product type: FORCED to DIGITAL (patching template ' + template.id + ')');
    try {
      const patched = await patchDigitalTemplate(template, details, diagnostics);
      diagnostics.push('Product type: DIGITAL — success');
      return { id: patched.id, url: patched.url, type: 'DIGITAL', diagnostics: diagnostics.join(' | ') };
    } catch (templateErr) {
      diagnostics.push('Product type: FORCED to DIGITAL but the patch failed: ' + templateErr.message + ' — nothing published.');
      return { id: null, url: null, type: null, diagnostics: diagnostics.join(' | '), failed: true };
    }
  }

  // Auto-detect (default): try Digital first, fall back to Physical.
  const template = await findDigitalTemplate();
  if (template) {
    diagnostics.push('Product type: attempting DIGITAL (patching template ' + template.id + ')');
    try {
      const patched = await patchDigitalTemplate(template, details, diagnostics);
      diagnostics.push('Product type: DIGITAL — success');
      return { id: patched.id, url: patched.url, type: 'DIGITAL', diagnostics: diagnostics.join(' | ') };
    } catch (templateErr) {
      diagnostics.push('DIGITAL template patch failed' + (allowPhysicalFallback ? ', falling back to PHYSICAL: ' : ': ') + templateErr.message);
    }
  } else {
    diagnostics.push('Product type: no unused DIGITAL template found (tag "' + TEMPLATE_TAG + '")' +
      (allowPhysicalFallback ? ', using PHYSICAL. ' : '. ') +
      'Create a hidden Digital product in Squarespace tagged "' + TEMPLATE_TAG + '" to enable true digital publishing.');
  }

  if (!allowPhysicalFallback) {
    return null; // auto-publish mode: no Digital template available, so nothing gets published — stays 'pending' for manual review
  }

  const created = await createPhysicalProduct(details, diagnostics);
  return { id: created.id, url: created.url, type: 'PHYSICAL', diagnostics: diagnostics.join(' | ') };
}

// ---- Find one unused DIGITAL template product, tagged and hidden,
// created by hand in the Squarespace dashboard ahead of time. ----
// ---- Find one unused DIGITAL template product, tagged and hidden,
// created by hand in the Squarespace dashboard ahead of time. Paginates
// through the full product list rather than just the first page — with
// any real number of products already in the store, a template sitting
// past page 1 would otherwise never be found, silently falling back to
// PHYSICAL every time even though the template genuinely exists. ----
async function findDigitalTemplate() {
  let cursor = null;
  let pagesChecked = 0;
  const MAX_PAGES = 5; // each page is a full network round-trip — keep this low enough that searching never becomes the reason the whole request times out

  while (pagesChecked < MAX_PAGES) {
    const url = new URL('https://api.squarespace.com/1.0/commerce/products');
    if (cursor) url.searchParams.set('cursor', cursor);

    const listRes = await fetch(url.toString(), { headers: squarespaceHeaders() });
    if (!listRes.ok) return null;
    const data = await listRes.json();
    const products = data.products || data.results || (Array.isArray(data) ? data : []);

    const match = products.find((p) =>
      p && p.type === 'DIGITAL' && Array.isArray(p.tags) && p.tags.includes(TEMPLATE_TAG)
    );
    if (match) return match;

    pagesChecked++;
    const pagination = data.pagination || {};
    if (pagination.hasNextPage && pagination.nextPageCursor) {
      cursor = pagination.nextPageCursor;
    } else {
      break; // no more pages
    }
  }
  return null;
}

// ---- Turn a blank DIGITAL template into the real listing via PUT.
// (Confirmed live: PATCH gets a 405 "Method 'PATCH' is not supported"
// on /1.0/commerce/products/{id} — Squarespace wants PUT for updates,
// same as it does for the variant/price endpoint below.) ----
async function patchDigitalTemplate(template, details, diagnostics) {
  const fullDescription = buildDescription(details);
  const remainingTags = (template.tags || []).filter(t => t !== TEMPLATE_TAG);
  const newTags = remainingTags.concat([details.city, details.season, 'Ketchup Files']);

  // Deliberately NOT setting storePageId here — digital products stay on
  // whichever store page the template already lives on (e.g.
  // ketchupfiles.com/street-style-contributors), rather than getting
  // moved to a city/season-specific page the way the Physical fallback
  // does. City/season are still added as tags below, so they're still
  // filterable/searchable, just not relocated.
  const patchBody = {
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
    // Deliberately NOT calling attemptSetStock here. If you set this
    // template's variant to unlimited stock once by hand in Squarespace
    // before it's ever used, this code should never touch that setting
    // again — only title/description/price/image get patched per use.
    // Touching stock here would risk a guessed API call silently
    // overwriting your manual "unlimited" with some wrong quantity.
    diagnostics.push('Inventory: not touched — set unlimited stock once by hand on this template in Squarespace and it\'ll stay that way for every future publish');

    // A real DIGITAL product has its own native file-delivery slot
    // ("Inventory > File" in the product editor — Squarespace generates
    // its own secure, expiring download link once that's filled in, no
    // custom email pipeline needed for this path at all). This uploads
    // the clean, non-watermarked original there directly.
    if (details.originalFileUrl) {
      await attemptAttachDigitalFile(template.id, details.originalFileUrl, diagnostics);
    } else {
      diagnostics.push('Digital file: skipped — no clean original was saved for this upload (only uploads made after the original-file-backup feature was added have one)');
    }
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

  const storePageId = await getTargetStorePage();

  const body = {
    type: 'PHYSICAL',
    storePageId: storePageId,
    name: details.title,
    description: fullDescription,
    isVisible: true,
    tags: [details.city, details.season, 'Ketchup Files'].concat(hashtagList),
    variants: [
      {
        pricing: { basePrice: { currency: 'USD', value: (details.priceCents / 100).toFixed(2) } },
        sku: `KF-${Date.now()}`
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
    await attemptSetStock(product.id, variantId, diagnostics);
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
// created product landed with 0 stock ("Agotado"/Sold Out). Also
// confirmed live that "unlimited" isn't a valid field on the variant at
// product-creation time (400 "unknown or readonly fields" — that
// attempt has been removed since it broke product creation entirely).
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

// ---- Digital file: fills Squarespace's native "Inventory > File" slot
// on a DIGITAL product, which is what makes Squarespace generate its
// own secure, expiring download link for the buyer — no custom email
// pipeline needed for this path. Not yet confirmed live which exact
// endpoint/field name this needs, so two plausible shapes are tried,
// same multipart pattern as the confirmed-working image upload (a real
// file part, not a URL reference — Squarespace has already shown it
// wants files uploaded that way, not referenced). ----
async function attemptAttachDigitalFile(productId, originalFileUrl, diagnostics) {
  let fileRes;
  try {
    fileRes = await fetch(originalFileUrl);
    if (!fileRes.ok) {
      diagnostics.push('Digital file: FAILED — could not download original (' + fileRes.status + ')');
      return;
    }
  } catch (e) {
    diagnostics.push('Digital file: FAILED — could not download original: ' + e.message);
    return;
  }
  const fileBlob = await fileRes.blob();
  const fileName = originalFileUrl.split('/').pop().split('?')[0] || 'original.jpg';

  const attempts = [
    { label: 'products/{id}/digital-file', url: `https://api.squarespace.com/1.0/commerce/products/${productId}/digital-file` },
    { label: 'products/{id}/inventory/file', url: `https://api.squarespace.com/1.0/commerce/products/${productId}/inventory/file` }
  ];
  for (const attempt of attempts) {
    try {
      const form = new FormData();
      form.append('file', fileBlob, fileName);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: squarespaceHeaders(),
        body: form
      });
      if (res.ok) {
        diagnostics.push('Digital file: OK (' + attempt.label + ')');
        return;
      }
      const errText = await res.text();
      diagnostics.push('Digital file (' + attempt.label + '): FAILED — ' + errText.substring(0, 150));
    } catch (e) {
      diagnostics.push('Digital file (' + attempt.label + '): FAILED — ' + e.message);
    }
  }
  diagnostics.push('Digital file: automated upload failed — for now, upload the original manually to this product\'s Inventory > File field in Squarespace, or send the next diagnostic here so the endpoint/field can be corrected.');
}

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles-Publisher/1.0'
  };
}

// Explicitly request a longer execution window. Vercel functions default
// to a short timeout (as low as 10-15s) regardless of plan tier unless a
// file requests more — this flow makes several sequential calls to
// Squarespace and Supabase in one request (product create/update, price,
// image upload, digital file upload, inventory attempts), which can add
// up past the default before ever hitting a real error. 60s gives real
// headroom without reserving the full 300s Pro allows. This has to come
// AFTER module.exports is assigned the handler function above, or it
// gets wiped out by that assignment.
module.exports.config = { maxDuration: 60 };
