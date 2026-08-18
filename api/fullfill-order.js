

const nodemailer = require('nodemailer');

const SUPBASE_URL = process.env.SUPBASE_URL;
const SUPBASE_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY;
const ORIGINALS_BUCKET = "Ketchup Files ORIGINALS";
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 72; // 72 hours

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

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


    const already = await fetch(
      `${SUPBASE_URL}/rest/v1/order_deliveries?squarespace_order_id=eq.${encodeURIComponent(orderId)}&select=id`,
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
      `${SUPBASE_URL}/rest/v1/photos?or=(${orFilter})&select=id,title,original_file_path,squarespace_product_id`,
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

    await fetch(`${SUPBASE_URL}/rest/v1/order_deliveries`, {
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
      `${SUPBASE_URL}/storage/v1/object/sign/${encodeURIComponent(ORIGINALS_BUCKET)}/${path}`,
      {
        method: 'POST',
        headers: { ...supbaseHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: SIGNED_URL_EXPIRY_SECONDS })
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.signedURL ? `${SUPBASE_URL}/storage/v1${data.signedURL}` : null;
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
    apikey: SUPBASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPBASE_SERVICE_ROLE_KEY}`
  };
}
