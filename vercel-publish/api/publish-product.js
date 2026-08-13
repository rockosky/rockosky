// /api/publish-product.js
//
// Called by the admin dashboard when Felipe hits "Approve & Publish".
// 1. Loads the photo's saved details from Supabase (service role, bypasses RLS)
// 2. Downloads the image from Supabase Storage
// 3. Creates a DIGITAL product in the Squarespace store via the Commerce API
//    (assigns it to a category matching the "season" name)
// 4. Writes the resulting Squarespace product id/url back to Supabase, status -> 'published'
//
// NOTE: Squarespace's exact Commerce API request/response shape may need
// adjusting once tested live — this follows their documented v1 Products API
// as of early 2026, but hasn't been run against a real store yet.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;
const BUCKET = "Ketchup Files UPLOADS";

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

    // 3. Find or create the store category matching "City Fashion Week —
    // Season" (e.g. "New York Fashion Week — SS27") so each city's fashion
    // week gets its own collection instead of all cities sharing one
    // season-only page.
    const collectionName = `${photo.city} Fashion Week — ${photo.season}`;
    const storePageId = await getOrCreateStorePage(collectionName);

    // 4. Create the digital product in Squarespace
    const product = await createSquarespaceProduct({
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

    res.status(200).json({ ok: true, url: product.url });
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

// Looks up an existing store category/collection matching the given name,
// or creates one if it doesn't exist yet. Squarespace calls these
// "Store Pages" or "Product Collections" depending on API version —
// verify this endpoint against your Commerce Advanced API docs.
async function getOrCreateStorePage(collectionName) {
  const listRes = await fetch('https://api.squarespace.com/1.0/commerce/store_pages', {
    headers: squarespaceHeaders()
  });
  const list = await listRes.json();
  const existing = (list.storePages || []).find(
    (p) => p.name && p.name.toLowerCase() === collectionName.toLowerCase()
  );
  if (existing) return existing.id;

  const createRes = await fetch('https://api.squarespace.com/1.0/commerce/store_pages', {
    method: 'POST',
    headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: collectionName })
  });
  const created = await createRes.json();
  return created.id;
}

async function createSquarespaceProduct({ title, description, priceCents, city, season, hashtags, socialUrl, storePageId, imageUrl }) {
  var hashtagList = (hashtags || '').split(',').map(function(t){ return t.trim(); }).filter(Boolean);
  var fullDescription = description + `\n\nLocation: ${city} — ${season}`
    + (hashtagList.length ? `\n\n${hashtagList.map(t => '#' + t.replace(/^#/, '')).join(' ')}` : '')
    + (socialUrl ? `\n\nProfile / Link: ${socialUrl}` : '');

  const body = {
    type: 'DIGITAL',
    storePageId: storePageId,
    name: title,
    description: fullDescription,
    isVisible: true,
    tags: [city, season, 'Ketchup Files'].concat(hashtagList),
    variants: [
      {
        pricing: { basePrice: { currency: 'USD', value: (priceCents / 100).toFixed(2) } },
        sku: `KF-${Date.now()}`
        // 'stock' removed for now — rejected as wrong type both as a
        // number and a string, with the identical error either way.
        // That pattern suggests 'stock' may not be a valid field at all
        // for DIGITAL-type products (which are typically unlimited by
        // nature) rather than a simple type mismatch. Getting core
        // product creation working reliably first; one-of-one stock
        // limiting is a separate follow-up to investigate — it may
        // require a different Squarespace endpoint, a different field
        // name specific to digital products, or switching product type
        // away from DIGITAL entirely.
      }
    ]
    // NOTE: 'images' removed from here — Squarespace's Commerce API rejected
    // it as an unknown/readonly field on product creation. Squarespace
    // requires images to be attached in a separate follow-up step after
    // the product exists, not in the initial create request. That
    // follow-up call still needs to be built and tested — until then,
    // products publish successfully but without a photo attached yet.
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

  // Safety net: some Squarespace fields (like we saw with 'images') are
  // rejected at creation time and only settable via a follow-up update.
  // If isVisible didn't take effect above, this explicit PATCH forces it.
  // If this call itself errors, we don't fail the whole publish — the
  // product already exists, this is just a best-effort visibility push.
  try {
    await fetch(`https://api.squarespace.com/1.0/commerce/products/${product.id}`, {
      method: 'PATCH',
      headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ isVisible: true })
    });
  } catch (visibilityErr) {
    console.error('Visibility follow-up failed (non-fatal):', visibilityErr);
  }

  return { id: product.id, url: product.url || '' };
}

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles-Publisher/1.0'
  };
}
