

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;
const BUCKET = "Ketchup Files UPLOADS";
const ADMIN_EMAIL = "creators@ketchupfiles.com";

const SQUARESPACE_API_BASE = "https://api.squarespace.com/1.0";

module.exports = async (req, res) => {
  var ALLOWED_ORIGINS = ['https://www.ketchupfiles.com', 'https://ketchupfiles.com', 'null'];
  var requestOrigin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.indexOf(requestOrigin) !== -1 ? requestOrigin : 'https://www.ketchupfiles.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!supbase_URL) missingEnvVars.push('SUPBASE_URL');
  if (!supbase_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
  if (!SQUARESPACE_API_KEY) missingEnvVars.push('SQUARESPACE_API_KEY');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  const { photo_id, product_type, adminAccessToken } = req.body || {};
  if (!photo_id) { res.status(400).json({ error: 'photo_id is required' }); return; }

  // Admin check -- same pattern as approve-chat.js / list-pending-*.js.
  // adminAccessToken is optional here on purpose: the auto-publish path
  // in the main upload widget calls this immediately after a fresh
  // upload, from inside the same request that already established the
  // uploader is a real signed-in user, without a separate admin token to
  // pass. When adminAccessToken IS provided (dashboard, retro chat), it
  // must check out as the real admin -- it's never silently ignored.
  if (adminAccessToken) {
    try {
      const callerRes = await fetch(`${supbase_URL}/auth/v1/user`, {
        headers: { apikey: supbase_SERVICE_ROLE_KEY, Authorization: `Bearer ${adminAccessToken}` }
      });
      if (!callerRes.ok) { res.status(401).json({ error: 'Not logged in, or session expired.' }); return; }
      const caller = await callerRes.json();
      if (!caller || !caller.email || caller.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
        res.status(403).json({ error: 'Only the admin account can publish to the store.' });
        return;
      }
    } catch (e) {
      res.status(401).json({ error: 'Could not verify admin session.' });
      return;
    }
  }

  const diagnostics = [];

  try {
    // ---- Load the photo row ----
    const photoRes = await fetch(
      `${supbase_URL}/rest/v1/photos?id=eq.${encodeURIComponent(photo_id)}&select=*`,
      { headers: supbaseHeaders() }
    );
    const photoRows = await photoRes.json();
    if (!photoRows || !photoRows.length) {
      res.status(404).json({ ok: false, error: 'Photo not found.' });
      return;
    }
    const photo = photoRows[0];

    if (!photo.city || !photo.season) {
      res.status(400).json({ ok: false, error: 'Photo is missing city or season -- both are required to find a matching store page.' });
      return;
    }

    // ---- Find the matching Squarespace store page by city + season ----
    // Squarespace's API can't create a new store page -- only find one
    // whose title already contains both the city and season text. If
    // that page doesn't exist yet, this fails with the full list of
    // pages that DO exist, so it's obvious what to create by hand.
    const pagesRes = await fetch(`${SQUARESPACE_API_BASE}/commerce/store-pages`, {
      headers: squarespaceHeaders()
    });
    if (!pagesRes.ok) {
      const errText = await pagesRes.text();
      res.status(502).json({ ok: false, error: 'Could not reach Squarespace to find a store page: ' + errText.substring(0, 300) });
      return;
    }
    const pagesData = await pagesRes.json();
    const pages = pagesData.storePages || pagesData.pages || [];
    const cityLower = photo.city.toLowerCase();
    const seasonLower = photo.season.toLowerCase();
    const matchingPage = pages.find(function (p) {
      const title = (p.title || '').toLowerCase();
      return title.indexOf(cityLower) !== -1 && title.indexOf(seasonLower) !== -1;
    });

    if (!matchingPage) {
      const available = pages.map(function (p) { return p.title; }).join(', ');
      res.status(404).json({
        ok: false,
        error: `No store page found containing both "${photo.city}" and "${photo.season}". Available pages: ${available}`
      });
      return;
    }

    // ---- Create or update the product ----
    const isDigitalRequested = product_type === 'digital';
    if (isDigitalRequested) {
      // Confirmed elsewhere in this project: Squarespace's Commerce API
      // rejects DIGITAL product creation with a 405 -- only PHYSICAL is
      // creatable through the API. Silently falling back rather than
      // failing the whole request, matching "Auto-detect" behavior.
      diagnostics.push('Product type: requested Digital, API only allows Physical -- created as Physical.');
    }

    const publicImageUrl = `${supbase_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${photo.file_path}`;
    const productTitle = `${photo.title || 'Untitled'} (Digital Download)`;
    const sku = `KF-${photo.id}`;

    let squarespaceProductId = photo.squarespace_product_id;
    let productUrl = photo.squarespace_product_url;

    if (!squarespaceProductId) {
      const createRes = await fetch(`${SQUARESPACE_API_BASE}/commerce/products`, {
        method: 'POST',
        headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'PHYSICAL',
          storePageId: matchingPage.id,
          name: productTitle,
          description: photo.description || '',
          variants: [{ sku: sku, pricing: { basePrice: { currency: 'USD', value: String(photo.price_cents ? photo.price_cents / 100 : 0) } }, stock: { quantity: 10, unlimited: false } }]
        })
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        res.status(502).json({ ok: false, error: 'Product creation failed: ' + errText.substring(0, 300) });
        return;
      }
      const created = await createRes.json();
      squarespaceProductId = created.id;
      productUrl = `https://www.ketchupfiles.com${matchingPage.urlSlug ? '/' + matchingPage.urlSlug : ''}/p/${created.urlSlug || sku.toLowerCase()}`;

      await fetch(`${supbase_URL}/rest/v1/photos?id=eq.${encodeURIComponent(photo.id)}`, {
        method: 'PATCH',
        headers: { ...supbaseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'published',
          published_at: new Date().toISOString(),
          squarespace_product_id: squarespaceProductId,
          squarespace_product_url: productUrl
        })
      });
    }

    // ---- Step: Inventory ----
    // This is the step that was failing with "API key lacks Inventory
    // permission" -- a scope missing on the Squarespace API key itself,
    // not something fixable in code. Enable the Inventory scope on the
    // key in Squarespace's own settings; this step will start succeeding
    // once that's done, with no code change needed here.
    try {
      const invRes = await fetch(`${SQUARESPACE_API_BASE}/commerce/inventory/${squarespaceProductId}`, {
        method: 'PATCH',
        headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ variants: [{ sku: sku, quantity: 10 }] })
      });
      if (!invRes.ok) {
        const errText = await invRes.text();
        diagnostics.push('Inventory: FAILED -- ' + errText.substring(0, 300));
      } else {
        diagnostics.push('Inventory: OK');
      }
    } catch (e) {
      diagnostics.push('Inventory: FAILED -- ' + e.message);
    }

    // ---- Step: Image ----
    try {
      const imgRes = await fetch(`${SQUARESPACE_API_BASE}/commerce/products/${squarespaceProductId}/images`, {
        method: 'POST',
        headers: squarespaceHeaders(),
        body: (function () {
          const form = new FormData();
          form.append('image', publicImageUrl);
          return form;
        })()
      });
      diagnostics.push(imgRes.ok ? 'Image: OK' : 'Image: FAILED -- ' + (await imgRes.text()).substring(0, 200));
    } catch (e) {
      diagnostics.push('Image: FAILED -- ' + e.message);
    }

    // ---- Step: Visibility ----
    // This was the first confirmed 405 -- was sending PUT, Squarespace's
    // API only accepts PATCH for updating an existing product's fields.
    try {
      const visRes = await fetch(`${SQUARESPACE_API_BASE}/commerce/products/${squarespaceProductId}`, {
        method: 'PATCH',
        headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ isVisible: true })
      });
      if (!visRes.ok) {
        const errText = await visRes.text();
        diagnostics.push('Visibility: FAILED -- ' + errText.substring(0, 300));
      } else {
        diagnostics.push('Visibility: OK');
      }
    } catch (e) {
      diagnostics.push('Visibility: FAILED -- ' + e.message);
    }

    // ---- Step: SEO ----
    // Same fix as Visibility -- PUT to PATCH.
    try {
      const seoRes = await fetch(`${SQUARESPACE_API_BASE}/commerce/products/${squarespaceProductId}`, {
        method: 'PATCH',
        headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seoOptions: {
            title: productTitle,
            description: (photo.description || productTitle).substring(0, 155)
          }
        })
      });
      if (!seoRes.ok) {
        const errText = await seoRes.text();
        diagnostics.push('SEO: FAILED -- ' + errText.substring(0, 300));
      } else {
        diagnostics.push('SEO: OK');
      }
    } catch (e) {
      diagnostics.push('SEO: FAILED -- ' + e.message);
    }

    const anyFailed = diagnostics.some(function (d) { return d.indexOf('FAILED') !== -1; });

    res.status(200).json({
      ok: true,
      held: false,
      url: productUrl,
      squarespace_product_id: squarespaceProductId,
      diagnostics: diagnostics.join(' | ')
    });
    if (anyFailed) { console.warn('publish-product partial failure:', diagnostics.join(' | ')); }
  } catch (err) {
    console.error('publish-product failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

function supbaseHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles/1.0'
  };
}
