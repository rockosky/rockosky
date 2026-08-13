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

    // 3. Find the store collection matching this city + season, however
    // it happens to be named — matching flexibly on whether the page
    // name contains both the city and season, rather than requiring an
    // exact "City Fashion Week — Season" string.
    const storePageId = await getOrCreateStorePage(photo.city, photo.season);

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

// Looks up an existing store page/collection whose name contains BOTH
// the given city and season — flexible matching, since the exact
// wording/format of the collection name in Squarespace may not match
// any single guessed format exactly (e.g. "New York Fashion Week —
// SS27" vs "New York Fashion Week 2026" vs other variations).
async function getOrCreateStorePage(city, season) {
  const listRes = await fetch('https://api.squarespace.com/1.0/commerce/store_pages', {
    headers: squarespaceHeaders()
  });
  const list = await listRes.json();

  // Defensive: try a few plausible response shapes, since the exact key
  // Squarespace uses here hasn't been confirmed live.
  const pages = list.storePages || list.pages || list.results || (Array.isArray(list) ? list : []);

  const cityLower = (city || '').toLowerCase().trim();
  const seasonLower = (season || '').toLowerCase().trim();

  // Try matching both city and season first (most precise)
  var existing = pages.find((p) => {
    if (!p || !p.name) return false;
    const nameLower = p.name.toLowerCase();
    return nameLower.includes(cityLower) && (seasonLower ? nameLower.includes(seasonLower) : true);
  });

  // Fall back to matching city alone — handles cases where the season
  // was named differently than expected (e.g. "2026" vs "SS27")
  if (!existing) {
    existing = pages.find((p) => p && p.name && p.name.toLowerCase().includes(cityLower));
  }

  if (existing && existing.id) return existing.id;

  throw new Error(
    `No store page found containing both "${city}" and "${season}" in its name. ` +
    `Create a collection in Squarespace's Store section with a name that includes both, then try approving again. ` +
    `Available page names: ${pages.map(p => p && p.name).filter(Boolean).join(', ') || '(none found — check the store_pages response shape)'}`
  );
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
