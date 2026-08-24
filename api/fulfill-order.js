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
      `${supbase_URL}/rest/v1/order_deliveries?squarespace_order_id=eq.${encodeURIComponent(orderId)}&select=id`,
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
      `${supbase_URL}/rest/v1/photos?or=(${orFilter})&select=id,title,original_file_path,squarespace_product_id`,
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
      if (signedUrl) links.push({ title: photo.title || 'Your photo', url: signedUrl });
      else missing.push(photo.title || photo.id);
    }

    if (links.length) {
      await sendDeliveryEmail(buyerEmail, links, missing);
    }

    // Record what happened either way, so missing-original cases are
    // visible somewhere instead of just silently not sending anything.
    await fetch(`${supbase_URL}/rest/v1/order_deliveries`, {
      method: 'POST',
      headers: { ...supbaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        squarespace_order_id: orderId,
        customer_email: buyerEmail,
        photo_ids: photos.map(p => p.id),
        delivered_count: links.length,
        missing_originals: missing.length ? missing : null,
        delivered_at: new Date().toISOString()
      })
    });

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

  const linksHtml = links.map(l => `<p><strong>${l.title}</strong><br><a href="${l.url}">Download full-resolution file</a></p>`).join('');
  const missingHtml = missing.length
    ? `<p style="color:#999;">Note: ${missing.length} item(s) from this order aren't ready for delivery yet — Ketchup Files will follow up separately.</p>`
    : '';

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Your Ketchup Files photo is ready to download',
    html: `
      <div style="font-family: Arial, sans-serif;">
        <p>Thanks for your purchase from Ketchup Files.</p>
        ${linksHtml}
        ${missingHtml}
        <p style="color:#999; font-size:12px;">Download link${links.length > 1 ? 's expire' : ' expires'} in 72 hours.</p>
      </div>
    `
  });
}

function supbaseHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}
