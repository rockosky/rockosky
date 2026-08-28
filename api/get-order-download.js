

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.supbase_URL,
  process.env.supbase_SERVICE_ROLE_KEY
);

const PRIVATE_BUCKET = 'kf-originals-private';
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export default async function handler(req, res) {
  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ ok: false, error: 'missing orderId' });

  const { data: delivery, error } = await supabase
    .from('order_deliveries')
    .select('*, photos(original_storage_path, watermark_storage_path, title)')
    .eq('order_id', orderId)
    .maybeSingle();

  if (error || !delivery) {
    return res.status(404).json({ ok: false, error: 'order not found' });
  }

  const expired =
    !delivery.download_expires_at || new Date(delivery.download_expires_at) < new Date();

  let downloadUrl = delivery.download_url;

  if (expired) {
    const { data: signed, error: signErr } = await supabase.storage
      .from(PRIVATE_BUCKET)
      .createSignedUrl(delivery.photos.original_storage_path, SIGNED_URL_TTL_SECONDS);
    if (signErr) return res.status(500).json({ ok: false, error: signErr.message });

    downloadUrl = signed.signedUrl;
    await supabase
      .from('order_deliveries')
      .update({
        download_url: downloadUrl,
        download_expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      })
      .eq('order_id', orderId);
  }

  const { data: pub } = supabase.storage
    .from('kf-public')
    .getPublicUrl(delivery.photos.watermark_storage_path);

  return res.status(200).json({
    ok: true,
    title: delivery.photos.title,
    downloadUrl,          // original, full-res, signed
    watermarkUrl: pub.publicUrl, // watermarked preview, public
  });
}

/* ------------------------------------------------------------------
   Squarespace Code Block for a page at e.g.
   https://www.ketchupfiles.com/commerce/orders/[order-id]
   (create the page, set its URL slug, drop this in a Code Block)
------------------------------------------------------------------- */

/*
<div id="kf-download">Loading your download…</div>
<script>
(function () {
  const orderId = window.location.pathname.split('/').pop();
  fetch('https://vercel-publish-fawn.vercel.app/api/get-order-download?orderId=' + orderId)
    .then(r => r.json())
    .then(d => {
      document.getElementById('kf-download').innerHTML = d.ok
        ? '<a href="' + d.downloadUrl + '">Download "' + d.title + '" (original file)</a>'
          + ' &nbsp;|&nbsp; '
          + '<a href="' + d.watermarkUrl + '">Watermarked preview</a>'
        : "We couldn't find that order.";
    });
})();
</script>
*/
