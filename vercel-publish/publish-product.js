

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;
const TEMPLATE_TAG = 'kf-template-unused';
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

  const { photo_id } = req.body || {};
  if (!photo_id) {
    res.status(400).json({ error: 'photo_id is required' });
    return;
  }

  try {
    // 1. Load the photo row (service role key bypasses RLS)
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

    // 2. Find the hidden template product by its tag
    const templateId = await findTemplateProduct();
    if (!templateId) {
      throw new Error(`No product tagged "${TEMPLATE_TAG}" found in Squarespace -- create one hidden DIGITAL product with that exact tag first`);
    }

    // 3. Find or create the destination collection for this photo's
    // city + season (e.g. "New York Fashion Week 2026") -- confirmed
    // from the earlier working product, which lived in a collection
    // like this, separate from where the hidden template itself sits.
    const collectionName = `${photo.city} Fashion Week ${photo.season}`;
    const storePageId = await getOrCreateStorePage(collectionName);

    // 4. Duplicate the template, then move the duplicate into that
    // collection and overwrite its content with this photo's real data
    const newProductId = await duplicateProduct(templateId);
    const product = await updateProduct(newProductId, {
      title: photo.title,
      description: photo.description || '',
      priceCents: photo.price_cents,
      city: photo.city,
      season: photo.season,
      hashtags: photo.hashtags || '',
      socialUrl: photo.social_url || '',
      photographerName: photo.photographer_name || '',
      storePageId,
      imageUrl
    });

    // 5. Write the result back to Supabase
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
    console.error('publish-product error:', err);
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

// Looks up the hidden DIGITAL product tagged kf-template-unused.
// Logs the raw response so the real filter query-param shape can be
// confirmed/adjusted against what Squarespace actually returns.
async function findTemplateProduct() {
  const listRes = await fetch(
    `https://api.squarespace.com/1.0/commerce/products?filter=tag,${encodeURIComponent(TEMPLATE_TAG)}`,
    { headers: squarespaceHeaders() }
  );
  const text = await listRes.text();
  console.log('findTemplateProduct raw response:', text);
  if (!listRes.ok) throw new Error(`Squarespace product lookup failed: ${text}`);
  const data = JSON.parse(text);
  const match = (data.products || []).find(p => (p.tags || []).includes(TEMPLATE_TAG));
  return match ? match.id : null;
}

// Looks up an existing collection/store page matching the city+season
// name, or creates one if it doesn't exist yet. Confirmed this is a
// separate collection from where the hidden template product itself
// lives (street-style-contributors) -- published products get moved
// OUT of that collection and into their real city/season one.
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

// Overwrites the duplicate with this photo's real title, description,
// price, image, and tags; moves it into the correct city/season
// collection; and makes it visible on the storefront.
async function updateProduct(productId, { title, description, priceCents, city, season, hashtags, socialUrl, photographerName, storePageId, imageUrl }) {
  const hashtagList = (hashtags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  const fullDescription = description
    + '\n\nLocation: ' + city + ' \u2014 ' + season
    + (photographerName ? '\n\nPhoto by ' + photographerName : '')
    + (hashtagList.length ? '\n\n' + hashtagList.map(function (t) { return '#' + t.replace(/^#/, ''); }).join(' ') : '')
    + (socialUrl ? '\n\nProfile / Link: ' + socialUrl : '');

  const body = {
    storePageId: storePageId,
    name: title,
    description: fullDescription,
    tags: [city, season, 'Ketchup Files'].concat(hashtagList),
    isVisible: true,
    variants: [
      {
        pricing: { basePrice: { currency: 'USD', value: (priceCents / 100).toFixed(2) } },
        sku: 'KF-' + productId
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
