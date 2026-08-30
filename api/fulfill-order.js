// ============================================================

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'orders@ketchupfiles.com';
const ORDER_PAGE_BASE = 'https://www.ketchupfiles.com/commerce/orders/';
const ORIGINALS_BUCKET = 'Ketchup Files ORIGINALS'; // private bucket -- never public, only ever accessed via a signed URL
const DOWNLOAD_LINK_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // signed link stays valid for 7 days
const KF_LOGO_URL = 'https://vercel-publish-fawn.vercel.app/kf-logo.png'; // upload a real hosted logo here -- see note below

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
    const customerName = (order.billingAddress && order.billingAddress.firstName) || '';
    const lineItems = order.lineItems || [];

    if (!orderId) {
      res.status(400).json({ ok: false, error: 'Webhook payload had no order id.' });
      return;
    }

    const deliveredItems = []; // { title, downloadUrl }

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

      // The actual fix: turn the stored file path into a real, working
      // download link -- previously nothing did this, so the receipt
      // email pointed at the order page with no file behind it.
      const downloadUrl = await getSignedDownloadUrl(photo.original_file_path);
      if (!downloadUrl) {
        console.error(`fulfill-order: could not create a signed download link for photo ${photo.id} (order ${orderId})`);
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

      deliveredItems.push({ title: photo.title || 'Untitled', downloadUrl });
    }

    if (deliveredItems.length && customerEmail && RESEND_API_KEY) {
      await sendReceiptEmail({ to: customerEmail, orderId, items: deliveredItems, customerName });
    }

    res.status(200).json({ ok: true, delivered: deliveredItems.length });
  } catch (err) {
    console.error('fulfill-order failed:', err);
    res.status(500).json({ ok: false, error: 'Order fulfillment failed. The order was received but not recorded -- check logs.' });
  }
};

// Creates a time-limited signed URL into the PRIVATE originals bucket --
// this is what actually lets a customer download their purchase without
// making the whole bucket public. Returns null (and logs) on failure so
// the caller can skip that item rather than send a broken email.
async function getSignedDownloadUrl(originalPath) {
  const signRes = await fetch(
    `${supbase_URL}/storage/v1/object/sign/${encodeURIComponent(ORIGINALS_BUCKET)}/${originalPath}`,
    {
      method: 'POST',
      headers: { ...supbaseHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: DOWNLOAD_LINK_EXPIRY_SECONDS })
    }
  );
  if (!signRes.ok) {
    console.error('fulfill-order: signing request failed:', signRes.status, await signRes.text());
    return null;
  }
  const signData = await signRes.json(); // { signedURL: "/object/sign/<bucket>/<path>?token=..." }
  if (!signData || !signData.signedURL) return null;
  return `${supbase_URL}/storage/v1${signData.signedURL}`;
}

async function sendReceiptEmail({ to, orderId, items, customerName }) {
  const orderUrl = ORDER_PAGE_BASE + encodeURIComponent(orderId);
  const greetingName = customerName ? customerName : 'there';

  const downloadButtonsHtml = items.map((item) => `
    <tr>
      <td style="padding:0 40px 16px;">
        <p style="margin:0 0 10px; font-size:14px; color:#ffffff; font-weight:700;">${escapeHtml(item.title)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="background-color:#ffffff; border-radius:2px;">
              <a href="${item.downloadUrl}" target="_blank" style="display:inline-block; padding:14px 28px; font-size:12px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#000000; text-decoration:none;">Download this photo</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Ketchup Files download</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4; font-family:'Helvetica Neue', Arial, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4; padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#000000; max-width:600px; width:100%;">
        <tr>
          <td align="center" style="padding:32px 24px 24px; border-bottom:1px solid #ffffff22;">
            <img src="${KF_LOGO_URL}" alt="Ketchup Files" width="140" style="display:block; height:auto;">
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 8px;">
            <p style="margin:0; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#e2231a; font-weight:700;">Order confirmed</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 16px;">
            <h1 style="margin:0; font-size:26px; line-height:1.3; color:#ffffff; font-weight:700;">${items.length > 1 ? 'Your photos are' : 'Your photo is'} ready to download.</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;">
            <p style="margin:0; font-size:14px; line-height:1.6; color:#a8a8a8;">Thanks for your order, ${escapeHtml(greetingName)}. Each link below is unique to you and works for 7 days, so save your file${items.length > 1 ? 's' : ''} somewhere safe once downloaded.</p>
          </td>
        </tr>
        ${downloadButtonsHtml}
        <tr>
          <td style="padding:8px 40px 40px; border-top:1px solid #ffffff22; padding-top:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:6px 0; font-size:13px; color:#a8a8a8;">Order</td>
                <td align="right" style="padding:6px 0; font-size:13px; color:#ffffff;">#${escapeHtml(orderId)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 40px;">
            <p style="margin:0; font-size:13px; color:#a8a8a8;">You can also view your order details anytime at: <a href="${orderUrl}" style="color:#ffffff; text-decoration:underline;">${orderUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px; border-top:1px solid #ffffff22;" align="center">
            <p style="margin:0 0 6px; font-size:11px; color:#666666;">© 2026 Ketchup Files Street Style Images</p>
            <p style="margin:0; font-size:11px; color:#666666;">Ketchup is a trademark created by Cocora Creatives LLC</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

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

function escapeHtml(str) {
  return String(str).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}

function supbaseHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}
