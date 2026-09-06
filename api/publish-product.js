const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;
const BUCKET = "Ketchup Files UPLOADS";
const ADMIN_EMAIL = "creators@ketchupfiles.com";

const SQUARESPACE_API_BASE = "https://api.squarespace.com/1.0";

// ---- Retry-with-backoff helper -------------------------------------------
// Squarespace's Commerce API occasionally throws a bare
// INTERNAL_SERVER_ERROR (500) on transient hiccups (rate limiting, brief
// outages, scope-check flakiness) that succeeds a moment later with zero
// changes on our end. Wrapping every Squarespace call in this retries the
// request a few times with exponential backoff before giving up, so a
// one-off 500 no longer permanently fails a publish. It does NOT retry on
// 4xx responses (bad request, auth, not found, etc.) since those won't
// change on retry -- only on 5xx and network-level failures.
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function fetchWithRetry(url, options, retryOptions) {
  const maxAttempts = (retryOptions && retryOptions.maxAttempts) || 3;
  const baseDelayMs = (retryOptions && retryOptions.baseDelayMs) || 500;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);

      // Success, or a 4xx that won't be fixed by retrying -- return as-is.
      if (res.ok || res.status < 500) {
        return res;
      }

      // 5xx -- worth retrying, unless this was the last attempt.
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`Squarespace call returned ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts}): ${url}`);
        await sleep(delay);
        continue;
      }
      return res; // exhausted retries -- let the caller handle the failed response
    } catch (e) {
      // Network-level failure (DNS, timeout, connection reset, etc.)
      lastError = e;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`Squarespace call threw "${e.message}", retrying in ${delay}ms (attempt ${attempt}/${maxAttempts}): ${url}`);
        await sleep(delay);
        continue;
      }
      throw lastError;
    }
  }
}
// ---------------------------------------------------------------------------

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
    // Wrapped in fetchWithRetry: this was the exact call that surfaced
    // a bare INTERNAL_SERVER_ERROR from Squarespace in production.
    const pagesRes = await fetchWithRetry(`${SQUARESPACE_API_BASE}/commerce/store-pages`, {
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
      const createRes = await fetchWithRetry(`${SQUARESPACE_API_BASE}/commerce/products`, {
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

      // Persist the new product's ID/URL back onto the photo row so a
      // repeat publish call reuses it instead of creating a duplicate
      // product in Squarespace.
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
    // The connected Squarespace API key does not have the Inventory
    // scope, so calling this endpoint always fails. Inventory is not
    // required to complete publishing, so it's skipped rather than
    // attempted-and-logged-as-failed on every single publish.
    diagnostics.push('Inventory: skipped (API key lacks Inventory scope; not required to publish)');

    // ---- Step: Image ----
    // Squarespace's product-image endpoint needs the actual image bytes
    // as a real multipart file, not a URL reference -- appending the URL
    // string directly to FormData sends it as plain text, which the
    // endpoint rejects. Fetch the image from storage first, then upload
    // it as a real file.
    try {
      const imgFetchRes = await fetch(publicImageUrl);
      if (!imgFetchRes.ok) {
        diagnostics.push('Image: FAILED -- could not fetch source image from storage (' + imgFetchRes.status + ')');
      } else {
        const imgBuffer = await imgFetchRes.arrayBuffer();
        const contentType = imgFetchRes.headers.get('content-type') || 'image/jpeg';
        const filename = (photo.file_path || 'image.jpg').split('/').pop();
        const form = new FormData();
        form.append('image', new Blob([imgBuffer], { type: contentType }), filename);
        const imgRes = await fetchWithRetry(`${SQUARESPACE_API_BASE}/commerce/products/${squarespaceProductId}/images`, {
          method: 'POST',
          headers: squarespaceHeaders(),
          body: form
        });
        diagnostics.push(imgRes.ok ? 'Image: OK' : 'Image: FAILED -- ' + (await imgRes.text()).substring(0, 200));
      }
    } catch (e) {
      diagnostics.push('Image: FAILED -- ' + e.message);
    }

    // ---- Step: Visibility ----
    // This was the first confirmed 405 -- was sending PUT, Squarespace's
    // API only accepts PATCH for updating an existing product's fields.
    try {
      const visRes = await fetchWithRetry(`${SQUARESPACE_API_BASE}/commerce/products/${squarespaceProductId}`, {
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
      const seoRes = await fetchWithRetry(`${SQUARESPACE_API_BASE}/commerce/products/${squarespaceProductId}`, {
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
