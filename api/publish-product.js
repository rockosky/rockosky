// /api/publish-product.js
//
// TWO-PHASE flow, matching what the upload widget already expects:
//
// PHASE 1 -- auto-create (called automatically by the upload widget
// right after every submission, body: { photo_id, auto: true }):
// claims the next unused product from a PRE-CREATED POOL of blank
// hidden DIGITAL products (tracked in the squarespace_product_pool
// Supabase table), fills it in with the real content -- but keeps it
// HIDDEN (isVisible: false). Saves squarespace_product_id/url back to
// the photo row immediately. Does NOT touch photo status -- the photo
// stays 'pending' for normal admin review either way. If anything
// isn't ready (pool exhausted, Squarespace error, etc), this responds
// { ok: true, held: true } rather than an error -- non-fatal,
// contributor never sees a scary message, admin review still covers
// it normally, and Phase 2 will just do the full claim itself later.
//
// PHASE 2 -- finalize & reveal (called when you click Approve &
// Publish, body: { photo_id }, no auto flag): if Phase 1 already
// claimed a pool product, this just flips isVisible: true and
// refreshes the content in case anything changed since upload --
// fast, since the heavy lifting already happened. If Phase 1 never
// ran or was held, this does the full claim right now instead.
// Either way, ends with photo status -> 'published'.
//
// WHY A POOL INSTEAD OF CREATE/DUPLICATE: both confirmed dead ends
// against the real Squarespace API --
//   - POST a brand-new DIGITAL product directly: confirmed 405.
//   - POST .../products/{id}/duplicate: confirmed 404, this endpoint
//     does not exist at all in Squarespace's real API despite matching
//     their documented pattern.
// The one operation confirmed reliable throughout all of this is a
// plain PUT to update an EXISTING product's content. So instead of
// creating anything, a batch of blank hidden DIGITAL products gets
// created BY HAND in Squarespace ahead of time and tracked in the
// squarespace_product_pool table, and this code just claims the next
// free one and PUTs the real content into it -- no create, no
// duplicate, no dependency on Squarespace's product-list endpoint
// either (which separately proved unreliable, returning an empty list
// even for confirmed-existing visible products).
//
// MAINTENANCE: when the pool runs low, create more blank hidden
// DIGITAL products in Squarespace by hand, then INSERT each new
// product's ID directly into squarespace_product_pool via Supabase --
// see add-squarespace-product-pool.sql for the exact insert to run.
// No code changes needed to add more pool products.

const SUPBASE_URL = process.env.SUPBASE_URL;
const SUPBASE_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY;
const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;
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

    // ---- PHASE 2 fast path: Phase 1 already created this product
    // (hidden). Just flip it visible and refresh content -- no need
    // to find the template or duplicate again. ----
    if (photo.squarespace_product_id && !auto) {
      const storePageId = await getOrCreateStorePage(photo.city, photo.season);
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

    // ---- First time claiming a product for this photo, for either
    // Phase 1 (hidden) or Phase 2 running standalone (visible
    // immediately, since Phase 1 either never ran or was held). Claims
    // the next unused pool item instead of creating/duplicating. ----
    const storePageId = await getOrCreateStorePage(photo.city, photo.season);
    const newProductId = await claimNextPoolProduct(photo.id);
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

// Finds an existing collection/store page for this photo's city and
// season. FIXED: this used to try creating a new store page if no
// exact match was found -- confirmed live that Squarespace's API
// flatly returns 405 Method Not Allowed for POST on this endpoint, so
// creation is simply not possible via the API, only reading existing
// ones -- any new collection (like "NEW YORK FASHION WEEK SS27 SPRING
// SUMMER 2026") has to be created manually in Squarespace first.
// Matching now prefers a collection containing BOTH the city and
// season (so a New York SS27 photo lands in the SS27-specific
// collection, not just any New York collection), falling back to
// city-only if no season-specific match exists yet.
async function getOrCreateStorePage(city, season) {
  const listRes = await fetch('https://api.squarespace.com/1.0/commerce/store_pages', {
    headers: squarespaceHeaders()
  });
  const listText = await listRes.text();
  console.log('getOrCreateStorePage list raw response:', listText);
  if (!listRes.ok) throw new Error(`Squarespace store page lookup failed: ${listText}`);
  const list = JSON.parse(listText);

  // Normalize hyphens/underscores to spaces and collapse whitespace
  // before comparing, so matching works whether a collection's title
  // uses spaces ("New York Fashion Week") or hyphens/slug-style
  // formatting ("new-york-fashion-week") -- confirmed titles and URL
  // slugs aren't always styled the same way in this store.
  function normalize(s) {
    return (s || '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const cityNorm = normalize(city);
  const seasonNorm = normalize(season);

  // Best: enabled collection with both city AND season.
  if (seasonNorm) {
    const exact = (list.storePages || []).find(p => {
      const t = normalize(p.title);
      return p.isEnabled && t.includes(cityNorm) && t.includes(seasonNorm);
    });
    if (exact) return exact.id;
  }

  // Next best: enabled collection matching just the city.
  const cityMatch = (list.storePages || []).find(
    p => p.isEnabled && normalize(p.title).includes(cityNorm)
  );
  if (cityMatch) return cityMatch.id;

  // Last resort: any match at all, even disabled.
  const anyMatch = (list.storePages || []).find(
    p => normalize(p.title).includes(cityNorm)
  );
  if (anyMatch) return anyMatch.id;

  throw new Error(`No Squarespace collection found matching city "${city}" -- collections can't be created via the API, so create one manually in Squarespace first (e.g. "${city.toUpperCase()} FASHION WEEK ${season || ''} 2026")`);
}

// Claims the next unclaimed pool product from the squarespace_product_pool
// table. Does this as SELECT-then-UPDATE-with-a-safety-check rather than
// a single query, since Supabase's REST API (PostgREST) doesn't support
// atomic claim-and-return in one call the way a raw SQL function would --
// the WHERE claimed_by_photo_id=is.null on the UPDATE means if two
// requests race for the same row, only one actually succeeds (the second
// one's UPDATE affects zero rows), so this stays safe even under
// concurrent publishes.
async function claimNextPoolProduct(photoId) {
  const availableRes = await fetch(
    `${SUPBASE_URL}/rest/v1/squarespace_product_pool?claimed_by_photo_id=is.null&select=squarespace_product_id&order=created_at.asc&limit=5`,
    { headers: supabaseHeaders() }
  );
  const available = await availableRes.json();
  if (!available || !available.length) {
    throw new Error('Pool of blank digital products is exhausted -- create more blank hidden DIGITAL products in Squarespace and insert their IDs into squarespace_product_pool');
  }

  // Try each candidate in order until one claim actually succeeds
  // (guards against a race with another simultaneous publish).
  for (const row of available) {
    const claimRes = await fetch(
      `${SUPBASE_URL}/rest/v1/squarespace_product_pool?squarespace_product_id=eq.${row.squarespace_product_id}&claimed_by_photo_id=is.null`,
      {
        method: 'PATCH',
        headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ claimed_by_photo_id: photoId, claimed_at: new Date().toISOString() })
      }
    );
    const claimed = await claimRes.json();
    if (claimed && claimed.length) {
      return claimed[0].squarespace_product_id;
    }
  }

  throw new Error('Could not claim a pool product -- all available candidates were claimed by another request at the same time, try again');
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
