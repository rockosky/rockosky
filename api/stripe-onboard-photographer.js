

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const RETURN_URL = 'https://www.ketchupfiles.com/chat?stripe=return';
const REFRESH_URL = 'https://www.ketchupfiles.com/chat?stripe=refresh';

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
    const { photographerId, email } = req.body || {};
    if (!photographerId || !email) {
      res.status(400).json({ ok: false, error: 'photographerId and email are both required.' });
      return;
    }

    // Check if this photographer already has a Stripe account on file --
    // reuse it instead of creating a duplicate every time they click the button.
    const profileRes = await fetch(
      `${supbase_URL}/rest/v1/creator_profiles?user_id=eq.${encodeURIComponent(photographerId)}&select=stripe_account_id`,
      { headers: supbaseHeaders() }
    );
    const profiles = await profileRes.json();
    let stripeAccountId = (Array.isArray(profiles) && profiles[0] && profiles[0].stripe_account_id) || null;

    if (!stripeAccountId) {
      const account = await stripeRequest('POST', '/v1/accounts', {
        type: 'express',
        email: email,
        capabilities: {
          'card_payments': { requested: 'true' },
          'transfers': { requested: 'true' }
        }
      });
      if (account.error) {
        res.status(500).json({ ok: false, error: account.error.message || 'Could not create Stripe account.' });
        return;
      }
      stripeAccountId = account.id;

      const updateRes = await fetch(
        `${supbase_URL}/rest/v1/creator_profiles?user_id=eq.${encodeURIComponent(photographerId)}`,
        {
          method: 'PATCH',
          headers: { ...supbaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ stripe_account_id: stripeAccountId })
        }
      );
      if (!updateRes.ok) {
        console.error('stripe-onboard-photographer: failed to save stripe_account_id:', await updateRes.text());
      }
    }

    // Generate a fresh onboarding link every time -- these expire quickly,
    // so we never store/reuse the link itself, only the underlying account id.
    const link = await stripeRequest('POST', '/v1/account_links', {
      account: stripeAccountId,
      refresh_url: REFRESH_URL,
      return_url: RETURN_URL,
      type: 'account_onboarding'
    });
    if (link.error) {
      res.status(500).json({ ok: false, error: link.error.message || 'Could not create onboarding link.' });
      return;
    }

    res.status(200).json({ ok: true, onboardingUrl: link.url, stripeAccountId });
  } catch (err) {
    console.error('stripe-onboard-photographer failed:', err);
    res.status(500).json({ ok: false, error: 'Could not start Stripe onboarding -- check logs.' });
  }
};

// Stripe's API takes form-encoded bodies, not JSON -- this flattens a
// (possibly nested) object into the x-www-form-urlencoded format Stripe expects.
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
