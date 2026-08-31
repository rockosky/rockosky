

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!supbase_URL) missingEnvVars.push('SUPBASE_URL');
  if (!supbase_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
  if (!STRIPE_SECRET_KEY) missingEnvVars.push('STRIPE_SECRET_KEY');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  try {
    const { buyerId, email } = req.body || {};
    if (!buyerId || !email) {
      res.status(400).json({ ok: false, error: 'buyerId and email are both required.' });
      return;
    }

    const profileRes = await fetch(
      `${supbase_URL}/rest/v1/creator_profiles?user_id=eq.${encodeURIComponent(buyerId)}&select=stripe_customer_id`,
      { headers: supbaseHeaders() }
    );
    const profiles = await profileRes.json();
    let stripeCustomerId = (Array.isArray(profiles) && profiles[0] && profiles[0].stripe_customer_id) || null;

    if (!stripeCustomerId) {
      const customer = await stripeRequest('POST', '/v1/customers', {
        email: email,
        metadata: { ketchup_files_user_id: buyerId }
      });
      if (customer.error) {
        res.status(500).json({ ok: false, error: customer.error.message || 'Could not create Stripe customer.' });
        return;
      }
      stripeCustomerId = customer.id;

      const updateRes = await fetch(
        `${supbase_URL}/rest/v1/creator_profiles?user_id=eq.${encodeURIComponent(buyerId)}`,
        {
          method: 'PATCH',
          headers: { ...supbaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ stripe_customer_id: stripeCustomerId, role: 'buyer' })
        }
      );
      if (!updateRes.ok) {
        console.error('create-buyer-setup-intent: failed to save stripe_customer_id:', await updateRes.text());
      }
    }

    // A SetupIntent (not a PaymentIntent) because no charge is happening
    // yet -- this just walks the buyer through securely attaching a card
    // to their Stripe customer for future use.
    const setupIntent = await stripeRequest('POST', '/v1/setup_intents', {
      customer: stripeCustomerId,
      'payment_method_types[]': 'card'
    });
    if (setupIntent.error) {
      res.status(500).json({ ok: false, error: setupIntent.error.message || 'Could not create setup intent.' });
      return;
    }

    res.status(200).json({
      ok: true,
      clientSecret: setupIntent.client_secret,
      stripeCustomerId
    });
  } catch (err) {
    console.error('create-buyer-setup-intent failed:', err);
    res.status(500).json({ ok: false, error: 'Could not start card setup -- check logs.' });
  }
};

async function stripeRequest(method, path, params) {
  const body = new URLSearchParams();
  flattenParams(params, '', body);

  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  return res.json();
}

function flattenParams(obj, prefix, body) {
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenParams(value, paramKey, body);
    } else {
      body.append(paramKey, value);
    }
  });
}

function supbaseHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}
