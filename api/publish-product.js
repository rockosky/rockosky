// /api/publish-product.js
//
// Called by the admin dashboard when Felipe hits "Approve & Publish".
// 1. Loads the photo's saved details from supbase (service role, bypasses RLS)
// 2. Downloads the image from supbase Storage
// 3. Creates a DIGITAL product in the Squarespace store via the Commerce API
//    (assigns it to a category matching the "season" name)
// 4. Writes the resulting Squarespace product id/url back to supbase, status -> 'published'
//
// NOTE: Squarespace's exact Commerce API request/response shape may need
// adjusting once tested live — this follows their documented v1 Products API
// as of early 2026, but hasn't been run against a real store yet.

// Confirmed via debug-env.js (already deployed, actually checkable at
// /api/debug-env) that the real Vercel env vars are named SUPBASE_URL /
// SUPBASE_SERVICE_ROLE_KEY -- no "A". This file previously read the
// correctly-spelled version, which would silently be undefined against
// the real env vars -- reading both here removes the ambiguity either way.
const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
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

  const missingEnvVars = [];
  if (!supbase_URL) missingEnvVars.push('SUPBASE_URL');
  if (!supbase_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
  if (!SQUARESPACE_API_KEY) missingEnvVars.push('SQUARESPACE_API_KEY');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  const { photo_id, product_type, auto } = req.body || {};
  if (!photo_id) {
    res.status(400).json({ error: 'photo_id is required' });
    return;
  }
  if (product_type === 'digital') {
    res.status(400).json({ error: 'True DIGITAL-type creation is confirmed rejected by Squarespace for this operation (METHOD_NOT_ALLOWED) -- this endpoint only creates PHYSICAL-type products as a workaround. Use "Physical" or "Auto".' });
    return;
  }

  // REAL BUG FIX: 02's upload flow calls this endpoint with auto:true
  // right after every single upload, on the assumption that this would
  // only actually publish if it could land as a genuine DIGITAL
  // product -- keeping admin curation intact for everything else. That
  // gate was never implemented here, so every upload was silently
  // auto-publishing straight to Squarespace as PHYSICAL with zero admin
  // review. Since true DIGITAL creation is confirmed impossible via
  // this API (see the check above), an auto request can never
  // currently satisfy that condition -- so it's always held for normal
  // review in 03, exactly as the original design intended. If
  // Squarespace ever allows real DIGITAL creation in the future, this
  // is the one line to change.
  if (auto === true) {
    res.status(200).json({ ok: true, held: true, reason: 'Auto-publish only applies to true Digital products, which Squarespace does not currently allow creating via this API. Held for normal admin review.' });
    return;
  }

  try {
    // 1. Load photo row (service role key bypasses RLS)
    const photoRes = await fetch(
      `${supbase_URL}/rest/v1/photos?id=eq.${photo_id}&select=*`,
      { headers: supbaseHeaders() }
    );
    const photos = await photoRes.json();
    const photo = photos && photos[0];
    if (!photo) throw new Error('Photo not found');
    if (!photo.title || !photo.city || !photo.season || photo.price_cents == null) {
      throw new Error('Photo is missing title, city, season, or price');
    }

    // 2. Public image URL from supbase Storage
    const imageUrl = `${supbase_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${photo.file_path}`;

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
      mediaType: photo.media_type || 'image',
      photoId: photo.id,
      storePageId,
      imageUrl
    });

    // 5. Write back to supbase
    await fetch(`${supbase_URL}/rest/v1/photos?id=eq.${photo_id}`, {
      method: 'PATCH',
      headers: { ...supbaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        status: 'published',
        squarespace_product_id: product.id,
        squarespace_product_url: product.url,
        published_at: new Date().toISOString()
      })
    });

    res.status(200).json({ ok: true, url: product.url, diagnostics: product.diagnostics });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

function supbaseHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
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
    if (!p || !p.title) return false;
    const nameLower = p.title.toLowerCase();
    return nameLower.includes(cityLower) && (seasonLower ? nameLower.includes(seasonLower) : true);
  });

  // Fall back to matching city alone — handles cases where the season
  // was named differently than expected (e.g. "2026" vs "SS27")
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

async function createSquarespaceProduct({ title, description, priceCents, city, season, hashtags, socialUrl, mediaType, photoId, storePageId, imageUrl }) {
  var hashtagList = (hashtags || '').split(',').map(function(t){ return t.trim(); }).filter(Boolean);
  var fullDescription = description + `\n\nLocation: ${city} — ${season}`
    + (hashtagList.length ? `\n\n${hashtagList.map(t => '#' + t.replace(/^#/, '')).join(' ')}` : '')
    + (socialUrl ? `\n\nProfile / Link: ${socialUrl}` : '');

  // "Buy this Image / Video / GIF / Audio / File" prefix, based on
  // what was actually uploaded -- Squarespace's checkout button text
  // itself is a fixed theme element the Products API can't change, but
  // this makes the same intent clear in the one place we DO control:
  // the product title, which is what shows right next to that button.
  var mediaLabelMap = { image: 'Image', video: 'Video', audio: 'Audio', raw: 'RAW File', file: 'File' };
  var mediaLabel = mediaLabelMap[mediaType] || 'Image';
  var isGif = mediaType === 'image' && /\.gif$/i.test(title);
  if (isGif) mediaLabel = 'GIF';
  var buyPrefix = 'Buy this ' + mediaLabel + ': ';

  // SKU media code -- KF-{MEDIA}-{ASSET_ID} per spec. Deliberately its
  // own map rather than reusing mediaLabelMap above: that one needs
  // full words for the button-prefix text ("Image", "RAW File"), this
  // one needs fixed 3-letter codes (IMG, not IMA from slicing "Image").
  var skuMediaCodeMap = { image: 'IMG', video: 'VID', audio: 'AUD', raw: 'RAW', file: 'DOC' };
  var skuMediaCode = isGif ? 'GIF' : (skuMediaCodeMap[mediaType] || 'IMG');

  const body = {
    type: 'PHYSICAL',
    // Switched from 'DIGITAL' — Squarespace's API explicitly rejected
    // that type for this create operation (METHOD_NOT_ALLOWED /
    // OPERATION_NOT_ALLOWED_FOR_PRODUCT_TYPE). PHYSICAL works with this
    // endpoint. Since these are licensed photo downloads, not shipped
    // goods, this may need a shipping-related field added too if
    // Squarespace's checkout starts asking buyers for a shipping
    // address — that's the next thing to watch for once this succeeds.
    storePageId: storePageId,
    // Squarespace's own product "type" field is stuck as PHYSICAL --
    // that's the confirmed API restriction, not something a label can
    // change. What we DO control is what it's actually called: adding
    // "(Digital Download)" here makes it obvious everywhere this shows
    // up -- your Squarespace backend, order emails, the storefront --
    // that nothing physical ships, even though the underlying type
    // says otherwise.
    name: buyPrefix + title + ' (Digital Download)',
    description: fullDescription,
    isVisible: true,
    tags: [city, season, 'Ketchup Files'].concat(hashtagList),
    variants: [
      {
        pricing: { basePrice: { currency: 'USD', value: (priceCents / 100).toFixed(2) } },
        // KF-{MEDIA}-{ASSET_ID}, using the real photos.id -- not a
        // timestamp (the previous KF-${Date.now()} produced a
        // different SKU every time the same photo got re-published,
        // and looked like a raw millisecond count, e.g.
        // KF-1787596299037, rather than a real product identifier).
        // Using the actual row id keeps this identical no matter which
        // widget (02, 04, Interfaz Studio) triggers the publish.
        sku: `KF-${skuMediaCode}-${photoId}`
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
  var diagnostics = [];

  // Set stock to genuinely unlimited via a dedicated Inventory follow-up
  // call. Previously used a finite quantity (10), but that produced a
  // real bug: the product would sometimes show "Out of Stock" on the
  // storefront even while inventory was confirmed available in
  // Squarespace's own backend. Switching to unlimited removes the bug
  // class entirely -- there's no finite count left to miscalculate --
  // and Squarespace doesn't show a stock counter for unlimited items,
  // satisfying "don't show the count" without extra work. Best-guess
  // endpoint shape, non-fatal if wrong.
  try {
    const variantId = product.variants && product.variants[0] && product.variants[0].id;
    if (variantId) {
      const inventoryRes = await fetch('https://api.squarespace.com/1.0/commerce/inventory', {
        method: 'PATCH',
        headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventory: [{ variantId: variantId, unlimited: true }]
        })
      });
      if (!inventoryRes.ok) {
        const invErrText = await inventoryRes.text();
        // A live test returned AUTHORIZATION_ERROR here specifically --
        // that's Squarespace's API key itself lacking permission for
        // Inventory, not a bug in this request. Flagging that plainly so
        // it isn't mistaken for something fixable in code: check
        // Settings -> Advanced -> API Keys on the Squarespace account
        // and confirm the key used here has Inventory access enabled.
        var isAuthError = invErrText.indexOf('AUTHORIZATION_ERROR') !== -1;
        diagnostics.push('Inventory: ' + (isAuthError
          ? 'FAILED -- API key lacks Inventory permission. Fix in Squarespace: Settings > Advanced > API Keys > enable Inventory scope on this key.'
          : invErrText.substring(0, 200)));
      } else {
        diagnostics.push('Inventory: OK');
      }
    } else {
      diagnostics.push('Inventory: skipped, no variant ID found');
    }
  } catch (inventoryErr) {
    diagnostics.push('Inventory: ' + inventoryErr.message);
  }

  // Attach the image as a real multipart file upload. The previous
  // version of this sent `images: [{ url: imageUrl }]` on the PATCH
  // below -- a URL reference. ketchup-files-full-system-check.md
  // already confirmed from live testing that Squarespace's Commerce
  // API rejects that shape and needs the actual file bytes uploaded
  // instead. isVisible is still set via the PATCH endpoint that's
  // already confirmed working; the image now goes through its own
  // multipart call first.
  try {
    const imageFetchRes = await fetch(imageUrl);
    if (!imageFetchRes.ok) {
      diagnostics.push('Image: FAILED -- could not fetch source image (' + imageFetchRes.status + ')');
    } else {
      const imageBuffer = await imageFetchRes.arrayBuffer();
      const contentType = imageFetchRes.headers.get('content-type') || 'image/png';
      const filename = (imageUrl.split('/').pop() || 'photo.png').split('?')[0];

      const form = new FormData();
      // Squarespace's real error (confirmed from a live test run) was
      // explicit: "Expected exactly one file part named 'file'" -- the
      // field name below was previously 'image', which is why every
      // upload failed. This was a plain typo, not a guess.
      form.append('file', new Blob([imageBuffer], { type: contentType }), filename);

      const imageUploadRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${product.id}/images`, {
        method: 'POST',
        // Deliberately not setting Content-Type by hand -- fetch sets
        // the correct multipart boundary automatically for a FormData body.
        headers: squarespaceHeaders(),
        body: form
      });
      const imageUploadText = await imageUploadRes.text();
      console.log('image multipart upload raw response:', imageUploadText);
      diagnostics.push(imageUploadRes.ok ? 'Image: OK' : ('Image: FAILED -- ' + imageUploadText.substring(0, 200)));
    }
  } catch (imageErr) {
    diagnostics.push('Image: FAILED -- ' + imageErr.message);
  }

  // isVisible toggle -- confirmed from a live test run that this endpoint
  // rejects PATCH outright ("Method 'PATCH' is not supported"). Switched
  // to PUT, which is what Squarespace's Commerce Products API actually
  // exposes for updates. Includes `type` alongside isVisible since PUT
  // endpoints on this API have been observed elsewhere in testing to
  // want at least that field present, not just the one being changed.
  try {
    const patchRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${product.id}`, {
      method: 'PUT',
      headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ isVisible: true, type: product.type })
    });
    if (!patchRes.ok) {
      const patchErrText = await patchRes.text();
      diagnostics.push('Visibility: FAILED -- ' + patchErrText.substring(0, 200));
    } else {
      diagnostics.push('Visibility: OK');
    }
  } catch (patchErr) {
    diagnostics.push('Visibility: FAILED -- ' + patchErr.message);
  }

  return { id: product.id, url: product.url || '', diagnostics: diagnostics.join(' | ') };
}

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles-Publisher/1.0'
  };
}
