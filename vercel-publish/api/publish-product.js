
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

  // --- DIAGNOSTIC MODE (temporary) ---
  // GET  /api/publish-product              -> lists products + their type,
  //                                            so you can find a DIGITAL one's id
  // GET  /api/publish-product?patchId=XYZ  -> tests whether Squarespace allows
  //                                            PATCHing (editing) that product
  // This does NOT touch the normal publish flow below (still POST-only,
  // still triggered the same way from the admin dashboard).
  if (req.method === 'GET') {
    try {
      const { patchId } = req.query || {};

      if (!patchId) {
        const listRes = await fetch('https://api.squarespace.com/1.0/commerce/products', {
          headers: squarespaceHeaders()
        });
        const raw = await listRes.text();
        if (!listRes.ok) {
          res.status(200).json({ mode: 'list', ok: false, status: listRes.status, raw });
          return;
        }
        const data = JSON.parse(raw);
        const products = data.products || data.results || (Array.isArray(data) ? data : []);
        const summary = products.map(p => ({ id: p.id, name: p.name, type: p.type, isVisible: p.isVisible, url: p.url }));
        res.status(200).json({
          mode: 'list',
          ok: true,
          count: summary.length,
          digitalProducts: summary.filter(p => p.type === 'DIGITAL'),
          allProducts: summary
        });
        return;
      }

      const testStamp = `[patch test ${new Date().toISOString()}]`;
      const getRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${patchId}`, { headers: squarespaceHeaders() });
      const getRaw = await getRes.text();
      if (!getRes.ok) {
        res.status(200).json({ mode: 'patch', step: 'fetch existing product', ok: false, status: getRes.status, raw: getRaw });
        return;
      }
      const existing = JSON.parse(getRaw);
      const patchRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${patchId}`, {
        method: 'PATCH',
        headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: (existing.description || '') + '\n\n' + testStamp })
      });
      const patchRaw = await patchRes.text();
      res.status(200).json({
        mode: 'patch',
        productId: patchId,
        productType: existing.type,
        testStampAppended: testStamp,
        ok: patchRes.ok,
        status: patchRes.status,
        raw: patchRaw
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

    // 4. Create the product, upload its image, and fix inventory
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
        publish_diagnostics: product.diagnostics,
        published_at: new Date().toISOString()
      })
    });

    res.status(200).json({ ok: true, url: product.url, diagnostics: product.diagnostics });
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
// the given city and season — flexible matching.
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
    `Available page names: ${pages.map(p => p && p.title).filter(Boolean).join(', ') || '(none found)'}. ` +
    `RAW RESPONSE (to diagnose the actual shape): ${JSON.stringify(list).substring(0, 800)}`
  );
}

async function createSquarespaceProduct({ title, description, priceCents, city, season, hashtags, socialUrl, storePageId, imageUrl }) {
  var hashtagList = (hashtags || '').split(',').map(function(t){ return t.trim(); }).filter(Boolean);
  var fullDescription = description + `\n\nLocation: ${city} — ${season}`
    + (hashtagList.length ? `\n\n${hashtagList.map(t => '#' + t.replace(/^#/, '')).join(' ')}` : '')
    + (socialUrl ? `\n\nProfile / Link: ${socialUrl}` : '');

  const body = {
    type: 'DIGITAL',
    // Switched back to DIGITAL — this is what actually gives buyers a
    // download after payment; PHYSICAL never delivers a file no matter
    // how the rest of the product is configured. An earlier attempt at
    // DIGITAL was rejected, but the exact error was never captured in
    // full (only paraphrased), so it's untested whether that was a real
    // platform limitation or just a missing "Digital Products" scope on
    // the API key. If this call fails, the full raw response is thrown
    // below (not truncated to a short summary) so the real cause is
    // visible this time.
    storePageId: storePageId,
    name: title,
    description: fullDescription,
    isVisible: true,
    tags: [city, season, 'Ketchup Files'].concat(hashtagList),
    variants: [
      {
        pricing: { basePrice: { currency: 'USD', value: (priceCents / 100).toFixed(2) } },
        sku: `KF-${Date.now()}`
        // 'stock' intentionally omitted here — rejected at create time
        // regardless of type. Inventory is set via the dedicated
        // Inventory endpoint below, after creation.
      }
    ]
    // 'images' intentionally omitted — Squarespace rejects it on create.
    // Image is uploaded separately below via attachProductImage().
  };

  const createRes = await fetch('https://api.squarespace.com/1.0/commerce/products', {
    method: 'POST',
    headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!createRes.ok) {
    const errText = await createRes.text();
    // Intentionally NOT truncated — this is the exact response body from
    // Squarespace, needed in full to know whether DIGITAL was rejected
    // for a platform reason (won't work at all via API) or a scope/
    // permissions reason (API key needs "Digital Products" enabled).
    throw new Error(`Squarespace product create failed [${createRes.status}]: ${errText}`);
  }
  const product = await createRes.json();
  var diagnostics = [];

  // --- Inventory: set to unlimited so it never shows "out of stock" ---
  const variantId = product.variants && product.variants[0] && product.variants[0].id;
  if (variantId) {
    let invOk = false;
    let lastInvErr = '';
    // Retry twice with a short delay — the variant may not be fully
    // indexed immediately after product creation.
    for (let attempt = 1; attempt <= 3 && !invOk; attempt++) {
      if (attempt > 1) await sleep(1000 * attempt);
      try {
        const inventoryRes = await fetch('https://api.squarespace.com/1.0/commerce/inventory', {
          method: 'PATCH',
          headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inventory: [{ variantId: variantId, unlimited: true }]
          })
        });
        if (inventoryRes.ok) {
          invOk = true;
        } else {
          lastInvErr = (await inventoryRes.text()).substring(0, 200);
        }
      } catch (e) {
        lastInvErr = e.message;
      }
    }
    diagnostics.push(invOk ? 'Inventory: OK (unlimited)' : `Inventory: FAILED after retries — ${lastInvErr}`);
  } else {
    diagnostics.push('Inventory: skipped, no variant ID found');
  }

  // --- Image: upload the actual file bytes to Squarespace's CDN ---
  // Confirmed live that Squarespace serves product images from
  // images.squarespace-cdn.com — an external URL reference is not
  // accepted anywhere in the Products API. The file itself has to be
  // uploaded via multipart/form-data to this dedicated endpoint.
  try {
    await attachProductImage(product.id, imageUrl);
    diagnostics.push('Image: OK');
  } catch (imgErr) {
    diagnostics.push('Image: ' + imgErr.message);
  }

  // isVisible is already true from create, but re-assert in case image
  // upload triggered a draft state on Squarespace's side.
  try {
    const patchRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${product.id}`, {
      method: 'PATCH',
      headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ isVisible: true })
    });
    if (!patchRes.ok) {
      const patchErrText = await patchRes.text();
      diagnostics.push('Visibility: ' + patchErrText.substring(0, 200));
    }
  } catch (patchErr) {
    diagnostics.push('Visibility: ' + patchErr.message);
  }

  return { id: product.id, url: product.url || '', diagnostics: diagnostics.join(' | ') };
}

// Downloads the photo from Supabase Storage and uploads it to Squarespace
// as multipart/form-data, per their dedicated product-images endpoint.
// This has NOT been confirmed against Squarespace's live API yet — the
// exact field name Squarespace expects for the file part ('image' below)
// and the exact response shape are best-guess from their documented
// pattern for this endpoint as of early 2026. If this throws, the error
// text captured here is what we need to correct the request shape.
async function attachProductImage(productId, imageUrl) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`could not fetch source image from Supabase (${imgRes.status})`);
  }
  const arrayBuffer = await imgRes.arrayBuffer();
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const filename = (imageUrl.split('/').pop() || 'photo.jpg').split('?')[0];

  const form = new FormData();
  form.append('image', new Blob([arrayBuffer], { type: contentType }), filename);

  const uploadRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${productId}/images`, {
    method: 'POST',
    headers: squarespaceHeaders(), // do NOT set Content-Type — FormData sets its own multipart boundary
    body: form
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`upload failed (${uploadRes.status}) — ${errText.substring(0, 300)}`);
  }

  return await uploadRes.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles-Publisher/1.0'
  };
}
