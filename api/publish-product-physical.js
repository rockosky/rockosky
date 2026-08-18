

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
    // 1. Load the photo row (service role bypasses RLS)
    const photoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/photos?id=eq.${photo_id}&select=*`,
      { headers: supabaseHeaders() }
    );
    const photos = await photoRes.json();
    const photo = photos && photos[0];
    if (!photo) throw new Error('Photo not found');
    if (!photo.title || !photo.city || !photo.season || photo.price_cents == null) {
      throw new Error('Photo is missing title, city, season, or price -- fill these in before publishing');
    }

    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${photo.file_path}`;

    // 2. Straightforward create -- no template/duplicate needed for
    // PHYSICAL type
    const product = await createPhysicalProduct({
      photoId: photo.id,
      title: photo.title,
      description: photo.description || '',
      priceCents: photo.price_cents,
      city: photo.city,
      season: photo.season,
      hashtags: photo.hashtags || '',
      socialUrl: photo.social_url || '',
      photographerName: photo.photographer_name || '',
      imageUrl
    });

    // 3. Write the result back to Supabase
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
    console.error('publish-product-physical error:', err);
    res.status(500).json({ error: err.message });
  }
};

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };
}

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles-Publisher/1.0'
  };
}

async function createPhysicalProduct({ photoId, title, description, priceCents, city, season, hashtags, socialUrl, photographerName, imageUrl }) {
  const hashtagList = (hashtags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  const fullDescription = description
    + '\n\nLocation: ' + city + ' \u2014 ' + season
    + (photographerName ? '\n\nPhoto by ' + photographerName : '')
    + (hashtagList.length ? '\n\n' + hashtagList.map(function (t) { return '#' + t.replace(/^#/, ''); }).join(' ') : '')
    + (socialUrl ? '\n\nProfile / Link: ' + socialUrl : '')
    + '\n\n<!-- kf-photo-id: ' + photoId + ' -->';

  const body = {
    type: 'PHYSICAL',
    name: title,
    description: fullDescription,
    tags: [city, season, 'Ketchup Files'].concat(hashtagList),
    isVisible: true,
    variants: [
      {
        pricing: { basePrice: { currency: 'USD', value: (priceCents / 100).toFixed(2) } },
        sku: 'KF-' + photoId,
        // Zeroed shipping/weight + unlimited stock: nothing physical is
        // actually being shipped, this is a digital download riding on
        // the physical-product creation path to route around the
        // DIGITAL-type 405. If Squarespace rejects zero weight or still
        // demands shipping config despite this, that's the next thing
        // to adjust once tested live.
        unlimited: true,
        weight: 0
      }
    ],
    images: [{ url: imageUrl }]
  };

  const createRes = await fetch('https://api.squarespace.com/1.0/commerce/products', {
    method: 'POST',
    headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await createRes.text();
  console.log('createPhysicalProduct raw response:', text);
  if (!createRes.ok) throw new Error(`Squarespace physical product create failed: ${text}`);
  const product = JSON.parse(text);
  return { id: product.id, url: product.url || '' };
}
