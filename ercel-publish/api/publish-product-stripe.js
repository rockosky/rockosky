// /api/publish-product-stripe.js
//
// Replaces publish-product.js's Squarespace product creation with a
// Stripe Product + Price + Payment Link instead — no Squarespace Commerce
// Advanced plan required. Called by the admin dashboard's "Approve &
// Publish" button.
//
// On POST with { photo_id }:
//  1. Loads the photo row from Supabase (service role, bypasses RLS)
//  2. Builds its public image URL
//  3. Creates a Stripe Product (with that image), a one-time Price, and a
//     Payment Link for that price
//  4. Writes stripe_product_id, stripe_price_id, stripe_checkout_url,
//     status='published', published_at back to Supabase
//
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const BUCKET = "Ketchup Files UPLOADS";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { photo_id } = req.body || {};
  if (!photo_id) {
    res.status(400).json({ error: 'photo_id is required' });
    return;
  }

  try {
    // 1. Load the photo row
    const photoRes = await fetch(
      `${SUPABASE_URL}/rest/v1/photos?id=eq.${photo_id}&select=*`,
      { headers: supabaseHeaders() }
    );
    const photos = await photoRes.json();
    const photo = photos && photos[0];
    if (!photo) throw new Error('Photo not found');
    if (!photo.price_cents || photo.price_cents <= 0) throw new Error('Photo has no valid price set');

    // 2. Public image URL
    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${photo.file_path}`;

    // 3. Stripe Product
    const product = await stripeFetch('/v1/products', {
      name: photo.title || 'Ketchup Files Photo',
      description: photo.description || undefined,
      images: [imageUrl],
      metadata: { photo_id: String(photo.id) }
    });

    // 4. Stripe Price (one-time)
    const price = await stripeFetch('/v1/prices', {
      product: product.id,
      unit_amount: photo.price_cents,
      currency: 'usd'
    });

    // 5. Stripe Payment Link — a persistent shareable checkout URL,
    // simpler than creating a new Checkout Session per visitor
    const paymentLink = await stripeFetch('/v1/payment_links', {
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { photo_id: String(photo.id) }
    });

    // 6. Write back to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/photos?id=eq.${photo_id}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        stripe_product_id: product.id,
        stripe_price_id: price.id,
        stripe_checkout_url: paymentLink.url,
        status: 'published',
        published_at: new Date().toISOString()
      })
    });

    res.status(200).json({ ok: true, checkout_url: paymentLink.url });
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

// Minimal Stripe API helper — form-encoded bodies, including nested
// objects/arrays like metadata and line_items.
async function stripeFetch(path, params) {
  const body = new URLSearchParams();
  flattenParams(params, '', body);

  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ? data.error.message : 'Stripe request failed');
  return data;
}

function flattenParams(obj, prefix, body) {
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (value === undefined || value === null) return;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const arrKey = `${paramKey}[${i}]`;
        if (item && typeof item === 'object') {
          flattenParams(item, arrKey, body);
        } else {
          body.append(arrKey, item);
        }
      });
    } else if (typeof value === 'object') {
      flattenParams(value, paramKey, body);
    } else {
      body.append(paramKey, value);
    }
  });
}
