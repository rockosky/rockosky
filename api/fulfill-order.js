

import { createClient } from '@supbase/supbase-js';

const supbase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

const PRIVATE_BUCKET = 'kf-originals-private';
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'orders@ketchupfiles.com';

// ---- email --------------------------------------------------------

async function sendReceiptEmail({ to, orderId, items }) {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eee;">
            <div style="font-weight:600;">${item.title}</div>
            <div style="margin-top:6px;">
              <a href="${item.originalUrl}" style="margin-right:16px;">Download original (full-res)</a>
              <a href="${item.watermarkUrl}">Download watermarked preview</a>
            </div>
          </td>
        </tr>`
    )
    .join('');

  const html = `
    <div style="font-family:sans-serif;max-width:560px;">
      <h2>Your Ketchup Files order</h2>
      <p>Order ${orderId} — here's every file from this order. The original link is
      full-resolution and unwatermarked; it's what you actually purchased. The
      watermarked link is included for reference/preview only.</p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <p style="color:#888;font-size:13px;margin-top:24px;">
        Original download links expire in 7 days. If yours has expired, reply to this
        email or visit your order page at
        https://www.ketchupfiles.com/commerce/orders/${orderId} to get a fresh link.
      </p>
    </div>`;

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
    const text = await res.text();
    throw new Error(`Resend send failed: ${res.status} ${text}`);
  }
}

// ---- main handler ---------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const order = req.body; // Squarespace order webhook payload
    const orderId = order.id;
    const customerEmail = order.customerEmail;

    const emailItems = [];

    for (const lineItem of order.lineItems || []) {
      const squarespaceProductId = lineItem.productId;

      const { data: photo, error: photoErr } = await supbase
        .from('photos')
        .select('*')
        .eq('squarespace_product_id', squarespaceProductId)
        .maybeSingle();

      if (photoErr || !photo) {
        console.error(`No photo found for product ${squarespaceProductId}`, photoErr);
        continue;
      }

      // original — signed, private, time-limited
      const { data: signed, error: signErr } = await supbase.storage
        .from(PRIVATE_BUCKET)
        .createSignedUrl(photo.original_storage_path, SIGNED_URL_TTL_SECONDS);
      if (signErr) throw signErr;

      // watermark — already public, no signing needed
      const { data: pub } = supbase.storage
        .from('kf-public')
        .getPublicUrl(photo.watermark_storage_path);

      const originalUrl = signed.signedUrl;
      const watermarkUrl = pub.publicUrl;

      await supbase.from('order_deliveries').insert({
        order_id: orderId,
        photo_id: photo.id,
        download_url: originalUrl,
        download_expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      });

      emailItems.push({ title: photo.title, originalUrl, watermarkUrl });
    }

    if (emailItems.length > 0) {
      await sendReceiptEmail({ to: customerEmail, orderId, items: emailItems });
    }

    return res.status(200).json({ ok: true, delivered: emailItems.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
