// /api/payout-contributor.js
//
// Called from the admin dashboard's Payouts view. Given a user_id, sums
// all their 'owed' ledger rows, sends one Stripe transfer for the total
// to their connected account, and marks those rows 'paid'.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

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

  const { user_id } = req.body || {};
  if (!user_id) {
    res.status(400).json({ error: 'user_id is required' });
    return;
  }

  try {
    // 1. Get their connected Stripe account
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/creator_profiles?user_id=eq.${user_id}&select=stripe_account_id,stripe_onboarded`,
      { headers: supabaseHeaders() }
    );
    const profiles = await profileRes.json();
    const profile = profiles && profiles[0];
    if (!profile || !profile.stripe_account_id) {
      throw new Error('This contributor has not connected Stripe yet');
    }

    // 2. Get all their unpaid ledger rows
    const ledgerRes = await fetch(
      `${SUPABASE_URL}/rest/v1/payout_ledger?user_id=eq.${user_id}&status=eq.owed&select=id,contributor_cut_cents`,
      { headers: supabaseHeaders() }
    );
    const rows = await ledgerRes.json();
    if (!rows || rows.length === 0) {
      throw new Error('Nothing owed to this contributor right now');
    }

    const total = rows.reduce((sum, r) => sum + r.contributor_cut_cents, 0);

    // 3. Send one Stripe transfer for the total
    const transfer = await stripeFetch('/v1/transfers', {
      amount: total,
      currency: 'usd',
      destination: profile.stripe_account_id
    });

    // 4. Mark those rows paid
    const ids = rows.map(r => r.id);
    await fetch(`${SUPABASE_URL}/rest/v1/payout_ledger?id=in.(${ids.join(',')})`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'paid', stripe_transfer_id: transfer.id, paid_at: new Date().toISOString() })
    });

    res.status(200).json({ ok: true, amount_cents: total, transfer_id: transfer.id });
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

async function stripeFetch(path, params) {
  const body = new URLSearchParams(params);
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
