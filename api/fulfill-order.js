
// ============================================================

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'orders@ketchupfiles.com';
const ORDER_PAGE_BASE = 'https://www.ketchupfiles.com/commerce/orders/';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!supbase_URL) missingEnvVars.push('SUPBASE_URL');
  if (!supbase_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  try {
    const order = req.body || {}; // Squarespace order webhook payload
    const orderId = order.id;
    const customerEmail = order.customerEmail;
    const lineItems = order.lineItems || [];

    if (!orderId) {
      res.status(400).json({ ok: false, error: 'Webhook payload had no order id.' });
      return;
    }

    const deliveredTitles = [];

    for (const lineItem of lineItems) {
      const squarespaceProductId = lineItem.productId;
      if (!squarespaceProductId) continue;

      const photoRes = await fetch(
        `${supbase_URL}/rest/v1/photos?squarespace_product_id=eq.${encodeURIComponent(squarespaceProductId)}&select=id,title,original_file_path`,
        { headers: supbaseHeaders() }
      );
      const photos = await photoRes.json();
      const photo = Array.isArray(photos) ? photos[0] : null;

      if (!photo) {
        console.error(`fulfill-order: no photo found for Squarespace product ${squarespaceProductId} (order ${orderId})`);
        continue;
      }
      if (!photo.original_file_path) {
        console.error(`fulfill-order: photo ${photo.id} has no original_file_path, nothing to deliver (order ${orderId})`);
        continue;
      }

      const insertRes = await fetch(`${supbase_URL}/rest/v1/order_fulfillments`, {
        method: 'POST',
        headers: { ...supbaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          squarespace_order_id: orderId,
          photo_id: photo.id,
          customer_email: customerEmail || null
        })
      });
      if (!insertRes.ok) {
        const errText = await insertRes.text();
        console.error(`fulfill-order: failed to record fulfillment for photo ${photo.id}, order ${orderId}: ${errText}`);
        continue;
      }

      deliveredTitles.push(photo.title || 'Untitled');
    }

    if (deliveredTitles.length && customerEmail && RESEND_API_KEY) {
      await sendReceiptEmail({ to: customerEmail, orderId, titles: deliveredTitles });
    }

    res.status(200).json({ ok: true, delivered: deliveredTitles.length });
  } catch (err) {
    console.error('fulfill-order failed:', err);
    res.status(500).json({ ok: false, error: 'Order fulfillment failed. The order was received but not recorded -- check logs.' });
  }
};

async function sendReceiptEmail({ to, orderId, titles }) {
  const orderUrl = ORDER_PAGE_BASE + encodeURIComponent(orderId);
  const html = `
    <div style="font-family:sans-serif;max-width:560px;">
      <h2>Your Ketchup Files order</h2>
      <p>Order ${orderId} — thanks for your purchase:</p>
      <ul>${titles.map((t) => `<li>${t}</li>`).join('')}</ul>
      <p>Get your full-resolution, watermark-free download${titles.length > 1 ? 's' : ''} here:</p>
      <p><a href="${orderUrl}" style="display:inline-block;background:#e2231a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;font-size:13px;font-weight:bold;">${orderUrl}</a></p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject: `Your Ketchup Files download — order ${orderId}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error('fulfill-order: receipt email send failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('fulfill-order: receipt email send threw:', err);
  }
}

function supbaseHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}
