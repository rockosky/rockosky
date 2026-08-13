// /api/test-digital-patch.js
//
// ONE-OFF DIAGNOSTIC ENDPOINT — not part of the publish pipeline.
// Confirmed: Squarespace's API refuses to CREATE a DIGITAL product
// (405 OPERATION_NOT_ALLOWED_FOR_PRODUCT_TYPE). What's still unknown
// is whether it will let you EDIT/PATCH a DIGITAL product that already
// exists (e.g. one created by hand in the Squarespace dashboard).
//
// USAGE:
//   GET  /api/test-digital-patch
//     -> lists every product in the store with its id, name, and type,
//        so you can find/copy the id of a DIGITAL product without
//        digging through the dashboard URL.
//
//   GET  /api/test-digital-patch?patchId=PRODUCT_ID
//     -> attempts a small, harmless PATCH on that product (appends a
//        timestamp to its description) and returns the raw Squarespace
//        response — success or the exact error text either way.
//        Does NOT touch price, images, inventory, or visibility.

const SQUARESPACE_API_KEY = process.env.SQUARESPACE_API_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { patchId } = req.query || {};

    if (!patchId) {
      // --- LIST MODE ---
      const listRes = await fetch('https://api.squarespace.com/1.0/commerce/products', {
        headers: squarespaceHeaders()
      });
      const raw = await listRes.text();
      if (!listRes.ok) {
        res.status(200).json({ mode: 'list', ok: false, status: listRes.status, raw });
        return;
      }
      const data = JSON.parse(raw);
      const products = data.products || data.results || (Array.isArray(data) ? data : []);
      const summary = products.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        isVisible: p.isVisible,
        url: p.url
      }));
      res.status(200).json({
        mode: 'list',
        ok: true,
        count: summary.length,
        digitalProducts: summary.filter(p => p.type === 'DIGITAL'),
        allProducts: summary
      });
      return;
    }

    // --- PATCH TEST MODE ---
    const testStamp = `[patch test ${new Date().toISOString()}]`;

    const getRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${patchId}`, {
      headers: squarespaceHeaders()
    });
    const getRaw = await getRes.text();
    if (!getRes.ok) {
      res.status(200).json({ mode: 'patch', step: 'fetch existing product', ok: false, status: getRes.status, raw: getRaw });
      return;
    }
    const existing = JSON.parse(getRaw);

    const patchRes = await fetch(`https://api.squarespace.com/1.0/commerce/products/${patchId}`, {
      method: 'PATCH',
      headers: { ...squarespaceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: (existing.description || '') + '\n\n' + testStamp
      })
    });
    const patchRaw = await patchRes.text();

    res.status(200).json({
      mode: 'patch',
      productType: existing.type,
      productName: existing.name,
      testStamp: testStamp,
      ok: patchRes.ok,
      status: patchRes.status,
      raw: patchRaw
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
};

function squarespaceHeaders() {
  return {
    Authorization: `Bearer ${SQUARESPACE_API_KEY}`,
    'User-Agent': 'KetchupFiles-Publisher/1.0'
  };
}
