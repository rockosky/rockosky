// /api/squarespace-order-webhook.js
//
// Set this URL as a Webhook in Squarespace: Settings > Advanced > Webhooks
// (Commerce Advanced required), subscribed to "Order Created" or
// "Order Fulfilled" events. Every time an order comes in, this checks
// each line item against your photos table — if it matches a contributor
// photo (by squarespace_product_id), it logs a 60/40 split into
// payout_ledger with status 'owed'.
//
// NOTE: Squarespace signs webhook payloads — verify SQUARESPACE_WEBHOOK_SECRET
// against the request signature header once you have real payload samples
// to confirm the exact header name/format Squarespace uses; this endpoint
// currently trusts the payload shape documented for Commerce order webhooks
// as of early 2026, which may need a small adjustment once tested live.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONTRIBUTOR_SHARE = 0.6; // 60% to the contributor, 40% platform

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const order = req.body || {};
    const lineItems = order.lineItems || order.order?.lineItems || [];
    const orderId = order.id || order.orderId || null;

    for (const item of lineItems) {
      const productId = item.productId || item.variantOptions?.productId;
      if (!productId) continue;

      // find the photo this product corresponds to
      const photoRes = await fetch(
        `${SUPABASE_URL}/rest/v1/photos?squarespace_product_id=eq.${productId}&select=id,user_id,price_cents`,
        { headers: supabaseHeaders() }
      );
      const photos = await photoRes.json();
      const photo = photos && photos[0];
      if (!photo) continue; // not a contributor product — a regular store item, skip

      const saleAmountCents = photo.price_cents || Math.round((item.unitPricePaid?.value || 0) * 100);
      const contributorCut = Math.round(saleAmountCents * CONTRIBUTOR_SHARE);
      const platformCut = saleAmountCents - contributorCut;

      await fetch(`${SUPABASE_URL}/rest/v1/payout_ledger`, {
        method: 'POST',
        headers: { ...supabaseHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo_id: photo.id,
          user_id: photo.user_id,
          squarespace_order_id: orderId,
          sale_amount_cents: saleAmountCents,
          contributor_cut_cents: contributorCut,
          platform_cut_cents: platformCut,
          status: 'owed'
        })
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  };
}
