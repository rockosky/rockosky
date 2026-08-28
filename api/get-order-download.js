

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const ORIGINALS_BUCKET = "Ketchup Files ORIGINALS";
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 72; // 72 hours -- matches fulfill-order.js's own expiry

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!supbase_URL) missingEnvVars.push('SUPBASE_URL');
  if (!supbase_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  const orderId = req.query.orderId;
  if (!orderId) { res.status(400).json({ error: 'orderId is required' }); return; }

  try {
    const fulfillmentsRes = await fetch(
      `${supbase_URL}/rest/v1/order_fulfillments?squarespace_order_id=eq.${encodeURIComponent(orderId)}&select=photo_id`,
      { headers: supbaseHeaders() }
    );
    const fulfillments = await fulfillmentsRes.json();

    if (!fulfillments || !fulfillments.length) {
      res.status(404).json({ ok: false, error: 'No order found with that id, or it hasn\u2019t been fulfilled yet.' });
      return;
    }

    const photoIds = fulfillments.map(f => f.photo_id).filter(Boolean);
    if (!photoIds.length) {
      res.status(404).json({ ok: false, error: 'Order found, but nothing to deliver for it.' });
      return;
    }

    const orFilter = photoIds.map(id => `id.eq.${id}`).join(',');
    const photosRes = await fetch(
      `${supbase_URL}/rest/v1/photos?or=(${orFilter})&select=id,title,original_file_path`,
      { headers: supbaseHeaders() }
    );
    const photos = await photosRes.json();

    const items = [];
    for (const photo of photos) {
      if (!photo.original_file_path) {
        items.push({ title: photo.title || 'Untitled', ready: false });
        continue;
      }
      const signedUrl = await createSignedUrl(photo.original_file_path);
      if (!signedUrl) {
        items.push({ title: photo.title || 'Untitled', ready: false });
        continue;
      }
      const safeFilename = sanitizeFilename(photo.title || 'ketchup-files-photo') + guessExtension(photo.original_file_path);
      const downloadUrl = signedUrl + (signedUrl.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(safeFilename);
      items.push({ title: photo.title || 'Untitled', ready: true, downloadUrl });
    }

    res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error('get-order-download failed:', err);
    res.status(500).json({ ok: false, error: 'Could not load your download. Try again in a moment.' });
  }
};

async function createSignedUrl(path) {
  try {
    const res = await fetch(
      `${supbase_URL}/storage/v1/object/sign/${encodeURIComponent(ORIGINALS_BUCKET)}/${path}`,
      {
        method: 'POST',
        headers: { ...supbaseHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: SIGNED_URL_EXPIRY_SECONDS })
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.signedURL ? `${supbase_URL}/storage/v1${data.signedURL}` : null;
  } catch (e) {
    return null;
  }
}

function sanitizeFilename(name) {
  return String(name).replace(/[\/\\?%*:|"<>]/g, '').trim().slice(0, 120) || 'ketchup-files-photo';
}

function guessExtension(storagePath) {
  var match = /\.[a-zA-Z0-9]+$/.exec(storagePath || '');
  return match ? match[0] : '';
}

function supbaseHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}

/* ------------------------------------------------------------------
   Squarespace Code Block for a page at
   https://www.ketchupfiles.com/commerce/orders/[order-id]
   (create the page, set its URL slug, drop this in a Code Block)
------------------------------------------------------------------- */

/*
<div id="kf-order-download" style="font-family:Arial,sans-serif; max-width:480px; margin:40px auto;">Loading your download&#8230;</div>
<script>
(function () {
  var orderId = window.location.pathname.split('/').pop();
  fetch('https://rockosky.vercel.app/api/get-order-download?orderId=' + encodeURIComponent(orderId))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var el = document.getElementById('kf-order-download');
      if (!data.ok || !data.items || !data.items.length) {
        el.textContent = data.error || "We couldn't find that order.";
        return;
      }
      el.innerHTML = data.items.map(function (item) {
        return item.ready
          ? '<div style="margin-bottom:20px;"><div style="margin-bottom:8px;">' + item.title + '</div>' +
            '<a href="' + item.downloadUrl + '" style="display:inline-block;background:#e2231a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">Download Full-Resolution File (No Watermark)</a></div>'
          : '<div style="margin-bottom:20px;color:#888;">' + item.title + ' \u2014 not ready for delivery yet, we\u2019ll follow up separately.</div>';
      }).join('');
    })
    .catch(function () {
      document.getElementById('kf-order-download').textContent = 'Something went wrong loading your download. Try refreshing, or contact us.';
    });
})();
</script>
*/
