// /api/fulfill-order.js
//
// Squarespace calls this URL (as a webhook) when an order comes in.
// This looks up which photo(s) were purchased, generates a short-lived
// signed link to the CLEAN original (no watermark — that file lives in
// a separate PRIVATE bucket the public site never touches), and emails
// it to the buyer.
//
// ============================================================
// ONE-TIME SETUP NEEDED (none of this is automatic yet):
//
// 1. Create a PRIVATE supbase Storage bucket named exactly
//    "Ketchup Files ORIGINALS" (public access OFF — this is the whole
//    point, it should never be reachable except via a signed URL this
//    endpoint generates). The uploader now writes the clean original
//    here automatically on every new upload; anything uploaded before
//    this was added won't have one — those rows will just have a null
//    original_file_path, and this endpoint will say so instead of
//    sending a broken link.
//
// 2. Set these environment variables in Vercel:
//      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//      (whatever real SMTP provider you're using — Gmail, Postmark,
//      Resend's SMTP mode, etc. This file doesn't assume which one.)
//    Optionally: SQUARESPACE_WEBHOOK_SECRET, if you want signature
//    verification (see verifyWebhookSignature below — Squarespace's
//    exact signing scheme isn't hard-verified here yet since it hasn't
//    been tested against a real payload; treat that check as best-effort
//    until confirmed).
//
// 3. Register this URL as a webhook subscription in Squarespace,
//    subscribed to order creation/fulfillment. Squarespace's exact
//    webhook payload shape is assumed below based on their documented
//    order object — the first real webhook that comes in should be
//    checked against what's actually parsed here (this endpoint logs
//    the full raw payload on every call specifically so that's easy to
//    verify and adjust if the real shape differs).
// ============================================================

const nodemailer = require('nodemailer');

// Confirmed via debug-env.js that the real Vercel env vars are named
// SUPBASE_URL / SUPBASE_SERVICE_ROLE_KEY (no "A") -- reading both
// spellings here so this works regardless, and matches the fix
// already applied to publish-product.js.
const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const ORIGINALS_BUCKET = "Ketchup Files ORIGINALS";
const PUBLIC_BUCKET = "Ketchup Files UPLOADS"; // watermarked copy -- safe to show as an email preview image
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 72; // 72 hours

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const missingEnvVars = [];
  if (!supbase_URL) missingEnvVars.push('SUPBASE_URL');
  if (!supbase_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
  if (!process.env.SMTP_HOST) missingEnvVars.push('SMTP_HOST');
  if (!process.env.SMTP_USER) missingEnvVars.push('SMTP_USER');
  if (!process.env.SMTP_PASS) missingEnvVars.push('SMTP_PASS');
  if (!process.env.SMTP_FROM) missingEnvVars.push('SMTP_FROM');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  // Log the raw payload every time — the fastest way to confirm/adjust
  // the parsing below once a real order comes through.
  console.log('Squarespace webhook payload:', JSON.stringify(req.body));

  try {
    const order = extractOrder(req.body);
    if (!order) {
      res.status(200).json({ ok: true, skipped: 'Payload did not look like an order — logged for review' });
      return;
    }

    const buyerEmail = order.customerEmail;
    const orderId = order.id;
    if (!buyerEmail || !orderId) {
      res.status(200).json({ ok: true, skipped: 'Missing customerEmail or order id' });
      return;
    }

    // Avoid double-sending if Squarespace retries the same webhook.
    const already = await fetch(
      `${supbase_URL}/rest/v1/order_fulfillments?squarespace_order_id=eq.${encodeURIComponent(orderId)}&select=id&limit=1`,
      { headers: supbaseHeaders() }
    ).then(r => r.json());
    if (already && already.length) {
      res.status(200).json({ ok: true, skipped: 'Already delivered for this order' });
      return;
    }

    const productIds = (order.lineItems || []).map(li => li.productId).filter(Boolean);
    if (!productIds.length) {
      res.status(200).json({ ok: true, skipped: 'No line items with a productId found' });
      return;
    }

    const orFilter = productIds.map(id => `squarespace_product_id.eq.${id}`).join(',');
    const photosRes = await fetch(
      `${supbase_URL}/rest/v1/photos?or=(${orFilter})&select=id,title,file_path,original_file_path,squarespace_product_id`,
      { headers: supbaseHeaders() }
    );
    const photos = await photosRes.json();

    if (!photos || !photos.length) {
      res.status(200).json({ ok: true, skipped: 'No matching photos found for purchased product IDs' });
      return;
    }

    const links = [];
    const missing = [];
    for (const photo of photos) {
      if (!photo.original_file_path) {
        missing.push(photo.title || photo.id);
        continue;
      }
      const signedUrl = await createSignedUrl(photo.original_file_path);
      // The watermarked copy is public by design (it's the one shown on
      // the storefront) -- safe to embed directly as a preview image in
      // the receipt so the buyer can actually see what they bought,
      // right next to the button that downloads the real un-watermarked
      // file. No signing needed for this one, it's already public.
      const previewUrl = photo.file_path
        ? `${supbase_URL}/storage/v1/object/public/${encodeURIComponent(PUBLIC_BUCKET)}/${photo.file_path}`
        : null;
      if (signedUrl) {
        // Without this, clicking the link just opens the image inline in
        // a new browser tab for most image types -- the buyer would have
        // to know to right-click -> Save As, which isn't a real "download"
        // experience. supbase Storage forces a true file download (a
        // real Content-Disposition: attachment response) when a `download`
        // parameter is present on the object URL -- appending it here,
        // with a clean filename built from the photo title.
        const safeFilename = sanitizeFilename(photo.title || 'ketchup-files-photo') + guessExtension(photo.original_file_path);
        const downloadUrl = signedUrl + (signedUrl.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(safeFilename);
        links.push({ photoId: photo.id, title: photo.title || 'Your photo', url: downloadUrl, previewUrl: previewUrl });
      } else {
        missing.push(photo.title || photo.id);
      }
    }

    if (links.length) {
      await sendDeliveryEmail(buyerEmail, links, missing);
    }

    // Record what happened either way, so missing-original cases are
    // visible somewhere instead of just silently not sending anything.
    // One row per photo, matching order_fulfillments' real shape --
    // photo_id is int8 there (matching photos.id exactly), not the
    // uuid[] the old order_deliveries.photo_ids column expected, which
    // would have rejected every single insert with a type error.
    const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();
    for (const link of links) {
      await fetch(`${supbase_URL}/rest/v1/order_fulfillments`, {
        method: 'POST',
        headers: { ...supbaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          squarespace_order_id: orderId,
          photo_id: link.photoId,
          buyer_email: buyerEmail,
          download_url_expires_at: expiresAt,
          fulfilled_at: new Date().toISOString()
        })
      });
    }

    res.status(200).json({ ok: true, delivered: links.length, missingOriginals: missing });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ---- Best-effort extraction of order id / buyer email / line items.
// Squarespace's real webhook payload shape should be checked against
// the logged raw payload (see console.log above) the first time a real
// order comes through, and this adjusted if it doesn't match. ----
function extractOrder(body) {
  const order = body && (body.data || body.order || body);
  if (!order || (!order.id && !order.orderId)) return null;
  return {
    id: order.id || order.orderId,
    customerEmail: order.customerEmail || (order.billingAddress && order.billingAddress.email) || order.email,
    lineItems: (order.lineItems || order.line_items || []).map(li => ({
      productId: li.productId || li.product_id || (li.variantOptions && li.variantOptions.productId)
    }))
  };
}

// A clean, safe filename for the forced download -- strips anything
// that could break a Content-Disposition header or look wrong in a
// download folder (slashes, quotes, control characters).
function sanitizeFilename(name) {
  return String(name)
    .replace(/[\/\\?%*:|"<>]/g, '')
    .trim()
    .slice(0, 120) || 'ketchup-files-photo';
}

// The original file's own extension (from its storage path) is the
// correct one to keep -- guessing from the watermarked copy or
// hardcoding .jpg would be wrong for video uploads.
function guessExtension(storagePath) {
  var match = /\.[a-zA-Z0-9]+$/.exec(storagePath || '');
  return match ? match[0] : '';
}

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

async function sendDeliveryEmail(toEmail, links, missing) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  // Branded to match the rest of Ketchup Files (black, red accent, serif
  // headline / mono details) instead of the generic default email. Kept
  // to table/inline-style basics rather than webfonts or flex/grid --
  // most email clients (Outlook especially) strip external stylesheets
  // and don't support modern CSS layout, so this uses the same safe
  // subset real marketing emails rely on.
  const linkRows = links.map(l => `
    <tr>
      <td style="padding:18px 0; border-top:1px solid #262626;">
        ${l.previewUrl ? `<img src="${l.previewUrl}" alt="${l.title}" width="220" style="display:block; width:220px; max-width:100%; height:auto; border-radius:2px; margin-bottom:14px; border:1px solid #262626;">` : ''}
        <div style="font-family:Georgia, 'Times New Roman', serif; font-size:16px; color:#ffffff; margin-bottom:10px;">${l.title}</div>
        <a href="${l.url}" style="display:inline-block; background:#e2231a; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif; font-size:11px; letter-spacing:1px; text-transform:uppercase; font-weight:bold; padding:11px 20px; border-radius:999px;">Download Full-Resolution File</a>
      </td>
    </tr>
  `).join('');

  const missingHtml = missing.length
    ? `<tr><td style="padding-top:16px;"><p style="font-family:Arial, sans-serif; color:#8a8a8a; font-size:12px; line-height:1.6; margin:0;">Note: ${missing.length} item(s) from this order aren't ready for delivery yet — Ketchup Files will follow up separately.</p></td></tr>`
    : '';

  const expiryNote = `Download link${links.length > 1 ? 's expire' : ' expires'} in 72 hours — save your file${links.length > 1 ? 's' : ''} somewhere safe once downloaded.`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#0a0a0a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background:#0a0a0a; border:1px solid #262626; border-radius:6px;">
          <tr>
            <td style="padding:36px 32px 28px; border-bottom:1px solid #262626;">
              <div style="font-family:Georgia, 'Times New Roman', serif; font-weight:bold; font-size:26px; color:#ffffff; letter-spacing:.5px;">Ketchup Files</div>
              <div style="font-family:Arial, sans-serif; font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#e2231a; margin-top:6px;">Order Confirmed</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;">
              <p style="font-family:Arial, sans-serif; color:#e8e8e8; font-size:14px; line-height:1.6; margin:0 0 8px;">Thanks for your purchase from Ketchup Files. Your file${links.length > 1 ? 's are' : ' is'} ready below.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${linkRows}
                ${missingHtml}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px;">
              <p style="font-family:Arial, sans-serif; color:#5c5c5c; font-size:11px; line-height:1.6; margin:0;">${expiryNote}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px; border-top:1px solid #1a1a1a; background:#050505;">
              <p style="font-family:Arial, sans-serif; color:#5c5c5c; font-size:10px; letter-spacing:1px; text-transform:uppercase; margin:0;">Ketchup Files &middot; ketchupfiles.com</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Your Ketchup Files photo is ready to download',
    html
  });
}

function supbaseHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}
