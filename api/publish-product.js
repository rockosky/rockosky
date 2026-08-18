// /api/publish-product.js
//
// TWO-PHASE flow, matching what the upload widget already expects:
//
// PHASE 1 -- auto-create (called automatically by the upload widget
// right after every submission, body: { photo_id, auto: true }):
// finds the hidden Squarespace DIGITAL product template (confirmed:
// lives in the "street-style-contributors" collection, slug/tag
// "kf-template-unused"), duplicates it, moves the duplicate into the
// correct city/season collection, fills in the real content -- but
// creates it HIDDEN (isVisible: false). Saves squarespace_product_id/
// url back to the photo row immediately. Does NOT touch photo status
// -- the photo stays 'pending' for normal admin review either way.
// If anything isn't ready (no template, Squarespace error, etc), this
// responds { ok: true, held: true } rather than an error -- non-fatal,
// contributor never sees a scary message, admin review still covers
// it normally, and Phase 2 will just do the full creation itself later.
//
// PHASE 2 -- finalize & reveal (called when you click Approve &
// Publish, body: { photo_id }, no auto flag): if Phase 1 already
// created the hidden product, this just flips isVisible: true and
// refreshes the content in case anything changed since upload --
// fast, since the heavy lifting already happened. If Phase 1 never
// ran or was held, this does the full creation right now instead.
// Either way, ends with photo status -> 'published'.
//
// WHY DUPLICATE INSTEAD OF CREATE: Squarespace's Commerce API returns
// a 405 if you try to POST a brand-new DIGITAL-type product directly
// -- confirmed. The workaround: keep one hidden/unused DIGITAL product
// as a template (never shown on the storefront) and duplicate IT
// instead -- duplication is a different, less-restricted operation.
//
// NOTE: the exact duplicate-product endpoint/response shape below
// follows Squarespace's documented Commerce Advanced API as of early
// 2026 but has NOT been confirmed against a live call yet -- every
// Squarespace response is logged raw specifically so the first real
// run can be checked against what's actually returned, and this
// adjusted if the real shape differs.

const SUPBASE_URL = process.env.SUPBASE_URL;
const SUPBASE_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY;
const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;
const TEMPLATE_TAG = 'kf-template-unused';
// FIXED: the products LIST endpoint (used to search for this template
// by tag) reliably returned an empty product array even with the
// product confirmed visible, tagged, and existing -- a genuine
// Squarespace-side quirk with that specific endpoint, not something in
// our request. Sidestepped entirely by hardcoding the template's real
// internal ID (confirmed directly from its Squarespace admin URL:
// https://ketchupfiles.squarespace.com/config/commerce/products/digital/6a83eec2762f55650d9d3781)
// and duplicating it directly -- no search, no list call, no guessing.
const TEMPLATE_PRODUCT_ID = '6a83eec2762f55650d9d3781';
const BUCKET = "Ketchup Files UPLOADS";

module.exports = async (req, res) => {
  // ---- CORS: without this, the browser blocks the response before
  // the Admin dashboard ever sees it -- shows up client-side as a
  // generic "Failed to fetch" with no useful detail, even though the
  // Squarespace/Supabase calls underneath may have partially run.
  // This was confirmed missing from the previous version. ----
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

  const { photo_id, auto } = req.body || {};
  if (!photo_id) {
    res.status(400).json({ error: 'photo_id is required' });
    return;
  }

  try {
    // 1. Load the photo row (service role key bypasses RLS)
    const photoRes = await fetch(
      `${SUPBASE_URL}/rest/v1/photos?id=eq.${photo_id}&select=*`,
      { headers: supabaseHeaders() }
    );
    const photos = await photoRes.json();
    const photo = photos && photos[0];
    if (!photo) throw new Error('Photo not found');
    if (!photo.title || !photo.city || !photo.season || photo.price_cents == null) {
      if (auto) { res.status(200).json({ ok: true, held: true, reason: 'missing required fields' }); return; }
      throw new Error('Photo is missing title, city, season, or price -- fill these in before publishing');
    }

    const imageUrl = `${SUPBASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${photo.file_path}`;
    const collectionName = `${photo.city} Fashion Week ${photo.season}`;

    // ---- PHASE 2 fast path: Phase 1 already created this product
    // (hidden). Just flip it visible and refresh content -- no need
    // to find the template or duplicate again. ----
    if (photo.squarespace_product_id && !auto) {
      const storePageId = await getOrCreateStorePage(collectionName);
      const product = await updateProduct(photo.squarespace_product_id, {
        photoId: photo.id,
        title: photo.title,
        description: photo.description || '',
        priceCents: photo.price_cents,
        city: photo.city,
        season: photo.season,
        hashtags: photo.hashtags || '',
        socialUrl: photo.social_url || '',
        photographerName: photo.photographer_name || '',
        storePageId,
        imageUrl,
        isVisible: true
      });
      await patchPhoto(photo_id, {
        status: 'published',
        squarespace_product_url: product.url,
        published_at: new Date().toISOString()
      });
      res.status(200).json({ ok: true, url: product.url });
      return;
    }

    // ---- Phase 1 already ran and this is just another auto call on
    // the same photo (e.g. a retry) -- nothing more to do. ----
    if (photo.squarespace_product_id && auto) {
      res.status(200).json({ ok: true, held: false, url: photo.squarespace_product_url });
      return;
    }

    // ---- First time creating this product, for either Phase 1
    // (hidden) or Phase 2 running standalone (visible immediately,
    // since Phase 1 either never ran or was held). No search needed
    // anymore -- TEMPLATE_PRODUCT_ID is the confirmed real ID. ----
    const storePageId = await getOrCreateStorePage(collectionName);
    const newProductId = await duplicateProduct(TEMPLATE_PRODUCT_ID);
    const product = await updateProduct(newProductId, {
      photoId: photo.id,
      title: photo.title,
      description: photo.description || '',
      priceCents: photo.price_cents,
      city: photo.city,
      season: photo.season,
      hashtags: photo.hashtags || '',
      socialUrl: photo.social_url || '',
      photographerName: photo.photographer_name || '',
      storePageId,
      imageUrl,
      isVisible: !auto
    });

    if (auto) {
      // Phase 1: save the id/url so Phase 2 can find it fast later,
      // but don't touch status -- stays 'pending' for normal review.
      await patchPhoto(photo_id, {
        squarespace_product_id: product.id,
        squarespace_product_url: product.url
      });
      res.status(200).json({ ok: true, held: false, url: product.url });
      return;
    }

    // Phase 2 standalone (no prior Phase 1): publish for real now.
    await patchPhoto(photo_id, {
      status: 'published',
      squarespace_product_id: product.id,
      squarespace_product_url: product.url,
      published_at: new Date().toISOString()
    });
    res.status(200).json({ ok: true, url: product.url });
  } catch (err) {
    console.error('publish-product error:', err);
    if (auto) { res.status(200).json({ ok: true, held: true, reason: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
};

async function patchPhoto(photoId, fields) {
  await fetch(`${SUPBASE_URL}/rest/v1/photos?id=eq.${photoId}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(fields)
  });
}

function supabaseHeaders() {
  return {
    apikey: SUPBASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPBASE_SERVICE_ROLE_KEY}`
  };
}

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles-Publisher/1.0'
  };
}

// Looks up an existing collection/store page matching the city+season
// name, or creates one if it doesn't exist yet. Confirmed this is a
// separate collection from where the hidden template product itself
// lives -- published products get moved OUT of the template's
// collection and into their real city/season one.
async function getOrCreateStorePage(collectionName) {
  const listRes = await fetch('https://api.squarespace.com/1.0/commerce/store_pages', {
    headers: squarespaceHeaders()
  });
  const listText = await listRes.text();
  console.log('getOrCreateStorePage list raw response:', listText);
  if (!listRes.ok) throw new Error(`Squarespace store page lookup failed: ${listText}`);
  const list = JSON.parse(listText);
  const existing = (list.storePages || []).find(
    p => p.name && p.name.toLowerCase() === collectionName.toLowerCase()
  );
  if (existing) return existing.id;

  const createRes = await fetch('https://api.squarespace.com/1.0/commerce/store_pages', {
    method: 'POST',
    headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: collectionName })
  });
  const createText = await createRes.text();
  console.log('getOrCreateStorePage create raw response:', createText);
  if (!createRes.ok) throw new Error(`Squarespace store page create failed: ${createText}`);
  const created = JSON.parse(createText);
  return created.id;
}

// Duplicates the template product. This is the step that avoids the
// 405-on-raw-create limit -- duplication of an existing DIGITAL
// product is allowed even though creating one from nothing isn't.
async function duplicateProduct(templateId) {
  const dupRes = await fetch(
    `https://api.squarespace.com/1.0/commerce/products/${templateId}/duplicate`,
    { method: 'POST', headers: squarespaceHeaders() }
  );
  const text = await dupRes.text();
  console.log('duplicateProduct raw response:', text);
  if (!dupRes.ok) throw new Error(`Squarespace product duplicate failed: ${text}`);
  const data = JSON.parse(text);
  return data.id;
}

// Overwrites the product with this photo's real title, description,
// price, image, and tags; moves it into the correct city/season
// collection; and sets visibility explicitly (false = hidden draft
// created at upload time, true = live and shown on the storefront).
// SKU and a hidden HTML comment both encode the Supabase photo_id, so
// any live product can be traced straight back to its source row --
// SKU is visible in the Squarespace admin, the comment is invisible on
// the storefront but present in the raw description/API data.
async function updateProduct(productId, { photoId, title, description, priceCents, city, season, hashtags, socialUrl, photographerName, storePageId, imageUrl, isVisible }) {
  const hashtagList = (hashtags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  const fullDescription = description
    + '\n\nLocation: ' + city + ' \u2014 ' + season
    + (photographerName ? '\n\nPhoto by ' + photographerName : '')
    + (hashtagList.length ? '\n\n' + hashtagList.map(function (t) { return '#' + t.replace(/^#/, ''); }).join(' ') : '')
    + (socialUrl ? '\n\nProfile / Link: ' + socialUrl : '')
    + '\n\n<!-- kf-photo-id: ' + photoId + ' -->';

  const body = {
    storePageId: storePageId,
    name: title,
    description: fullDescription,
    tags: [city, season, 'Ketchup Files'].concat(hashtagList),
    isVisible: !!isVisible,
    variants: [
      {
        pricing: { basePrice: { currency: 'USD', value: (priceCents / 100).toFixed(2) } },
        sku: 'KF-' + photoId
      }
    ],
    images: [{ url: imageUrl }]
  };

  const putRes = await fetch(
    `https://api.squarespace.com/1.0/commerce/products/${productId}`,
    { method: 'PUT', headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const text = await putRes.text();
  console.log('updateProduct raw response:', text);
  if (!putRes.ok) throw new Error(`Squarespace product update failed: ${text}`);
  const product = JSON.parse(text);
  return { id: product.id, url: product.url || '' };
}
