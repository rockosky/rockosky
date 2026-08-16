// /api/stripe-connect-onboard.js
//
// Called by the "Connect Stripe to get paid" button in the upload widget.
// Creates a Stripe Express connected account for the contributor if they
// don't have one yet, then returns an onboarding link to redirect them to.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SITE_URL = process.env.SITE_URL || 'https://www.ketchupfiles.com';

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

  const { user_id, email } = req.body || {};
  if (!user_id || !email) {
    res.status(400).json({ error: 'user_id and email are required' });
    return;
  }

  try {
    // 1. Check for an existing creator profile
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/creator_profiles?user_id=eq.${user_id}&select=*`,
      { headers: supabaseHeaders() }
    );
    const profiles = await profileRes.json();
    let accountId = profiles && profiles[0] && profiles[0].stripe_account_id;

    // 2. Create a Stripe Express account if they don't have one yet
    if (!accountId) {
      const acct = await stripeFetch('/v1/accounts', {
        type: 'express',
        email: email,
        capabilities: {
          'transfers[requested]': 'true'
        }
      });
      accountId = acct.id;

      await fetch(`${SUPABASE_URL}/rest/v1/creator_profiles`, {
        method: 'POST',
        headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id, stripe_account_id: accountId, stripe_onboarded: false })
      });
    }

    // 3. Create an onboarding link for this account
    const link = await stripeFetch('/v1/account_links', {
      account: accountId,
      refresh_url: `${SITE_URL}/upload?stripe=refresh`,
      return_url: `${SITE_URL}/upload?stripe=return`,
      type: 'account_onboarding'
    });

    res.status(200).json({ url: link.url });
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

// Minimal Stripe API helper — Stripe's API takes form-encoded bodies,
// including for nested objects like capabilities.
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
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenParams(value, paramKey, body);
    } else {
      body.append(paramKey, value);
    }
  });
}
