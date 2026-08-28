
const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;
const BUCKET = "Ketchup Files UPLOADS";
const ADMIN_EMAIL = "creators@ketchupfiles.com";

module.exports = async (req, res) => {

  var ALLOWED_ORIGINS = ['https://www.ketchupfiles.com', 'https://ketchupfiles.com', 'null'];
  var requestOrigin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.indexOf(requestOrigin) !== -1 ? requestOrigin : 'https://www.ketchupfiles.com');
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

  const { photo_id, product_type, auto, adminAccessToken } = req.body || {};
  if (!adminAccessToken) {
    res.status(401).json({ error: 'adminAccessToken is required' });
    return;
  }
  try {
    const callerRes = await fetch(`${supbase_URL}/auth/v1/user`, {
      headers: { apikey: supbase_SERVICE_ROLE_KEY, Authorization: `Bearer ${adminAccessToken}` }
    });
    if (!callerRes.ok) {
      res.status(401).json({ error: 'Not logged in, or session expired.' });
      return;
    }
    const caller = await callerRes.json();
    if (!caller || !caller.email || caller.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      res.status(403).json({ error: 'Only the admin account can approve and publish.' });
      return;
    }
  } catch (err) {
    res.status(500).json({ error: 'Could not verify admin identity.' });
    return;
  }

  if (!photo_id) {
    res.status(400).json({ error: 'photo_id is required' });
    return;
  }
  if (product_type === 'digital') {
    res.status(400).json({ error: 'True DIGITAL-type creation is confirmed rejected by Squarespace for this operation (METHOD_NOT_ALLOWED) -- this endpoint only creates PHYSICAL-type products as a workaround. Use "Physical" or "Auto".' });
    return;
  }

  if (auto === true) {
    res.status(200).json({ ok: true, held: true, reason: 'Auto-publish only applies to true Digital products, which Squarespace does not currently allow creating via this API. Held for normal admin review.' });
    return;
  }

  try {
   
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

   
    const imageUrl = `${supbase_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${photo.file_path}`;

 
    const storePageId = await getOrCreateStorePage(photo.city, photo.season);

  
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


  if (!existing) {
    existing = pages.find((p) => p && p.title && p.title.toLowerCase().includes('contributor'));
  }

  if (existing && existing.id) return existing.id;

  throw new Error(
    `No store page found containing both "${city}" and "${season}" in its name, and no fallback ` +
    `"Contributors" page exists either (create one in Squarespace Commerce settings with "contributor" ` +
    `in its title to fix this permanently). ` +
    `Available page names: ${pages.map(p => p && p.title).filter(Boolean).join(', ') || '(none found)'}. ` +
    `RAW RESPONSE (to diagnose the actual shape): ${JSON.stringify(list).substring(0, 800)}`
  );
}

async function createSquarespaceProduct({ title, description, priceCents, city, season, hashtags, socialUrl, mediaType, photoId, storePageId, imageUrl }) {
  var hashtagList = (hashtags || '').split(',').map(function(t){ return t.trim(); }).filter(Boolean);
  var fullDescription = description + `\n\nLocation: ${city} — ${season}`
    + (hashtagList.length ? `\n\n${hashtagList.map(t => '#' + t.replace(/^#/, '')).join(' ')}` : '')
    + (socialUrl ? `\n\nProfile / Link: ${socialUrl}` : '');


  var mediaLabelMap = { image: 'Image', video: 'Video', audio: 'Audio', raw: 'RAW File', file: 'File' };
  var mediaLabel = mediaLabelMap[mediaType] || 'Image';
  var isGif = mediaType === 'image' && /\.gif$/i.test(title);
  if (isGif) mediaLabel = 'GIF';
  var buyPrefix = 'Buy this ' + mediaLabel + ': ';

  var skuMediaCodeMap = { image: 'IMG', video: 'VID', audio: 'AUD', raw: 'RAW', file: 'DOC' };
  var skuMediaCode = isGif ? 'GIF' : (skuMediaCodeMap[mediaType] || 'IMG');

  const body = {
    type: 'PHYSICAL',

    storePageId: storePageId,

    name: buyPrefix + title + ' (Digital Download)',
    description: fullDescription,
    isVisible: true,
    tags: [city, season, 'Ketchup Files'].concat(hashtagList),
    variants: [
      {
        pricing: { basePrice: { currency: 'USD', value: (priceCents / 100).toFixed(2) } },
    
        sku: `KF-${skuMediaCode}-${photoId}`
    
      }
    ]
 
    
  };

  const createRes = await fetch('https://api.squarespace.com/1.0/commerce/products', {
    method: 'POST',
    headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!createRes.ok) {
    const errText = await createRes.text();

    console.error('Squarespace product create failed. Body sent:', JSON.stringify(body));
    throw new Error(`Squarespace product create failed: ${errText} | Body sent: ${JSON.stringify(body).substring(0, 500)}`);
  }
  const product = await createRes.json();
  var diagnostics = [];


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

  try {
    const imageFetchRes = await fetch(imageUrl);
    if (!imageFetchRes.ok) {
      diagnostics.push('Image: FAILED -- could not fetch source image (' + imageFetchRes.status + ')');
    } else {
      const imageBuffer = await imageFetchRes.arrayBuffer();
      const contentType = imageFetchRes.headers.get('content-type') || 'image/png';
      const filename = (imageUrl.split('/').pop() || 'photo.png').split('?')[0];

      const form = new FormData();
  
      form.append('file', new Blob([imageBuffer], { type: contentType }), filename);

      const imageUploadRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${product.id}/images`, {
        method: 'POST',

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

  
  try {
    const seoRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${product.id}`, {
      method: 'PUT',
      headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: product.type,
        seoOptions: {
          title: (buyPrefix + title).slice(0, 100),
          description: fullDescription.slice(0, 400)
        }
      })
    });
    if (!seoRes.ok) {
      const seoErrText = await seoRes.text();
      diagnostics.push('SEO: FAILED -- ' + seoErrText.substring(0, 200));
    } else {
      diagnostics.push('SEO: OK');
    }
  } catch (seoErr) {
    diagnostics.push('SEO: FAILED -- ' + seoErr.message);
  }

  return { id: product.id, url: product.url || '', diagnostics: diagnostics.join(' | ') };
}

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles-Publisher/1.0'
  };
}
