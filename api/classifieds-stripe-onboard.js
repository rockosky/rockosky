

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    // ---- Defensive env var checks, with a specific message for each ----
    const missing = [];
    if (!process.env.SUPBASE_URL) missing.push('SUPBASE_URL');
    if (!process.env.SUPBASE_SERVICE_ROLE_KEY) missing.push('SUPBASE_SERVICE_ROLE_KEY');
    if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variable(s): ${missing.join(', ')}` });
    }

    const supabase = createClient(process.env.SUPBASE_URL, process.env.SUPBASE_SERVICE_ROLE_KEY);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const SITE_URL = process.env.SITE_URL || 'https://www.ketchupfiles.com';

    const { sellerId, email } = req.body || {};
    if (!sellerId) return res.status(400).json({ error: 'sellerId is required' });

    const { data: seller, error: sellerErr } = await supabase
      .from('classifieds_sellers')
      .select('stripe_account_id')
      .eq('user_id', sellerId)
      .maybeSingle();
    if (sellerErr) throw new Error(`Supabase lookup failed: ${sellerErr.message}`);

    let accountId = seller && seller.stripe_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        }
      });
      accountId = account.id;

      const { error: updateErr } = await supabase.from('classifieds_sellers')
        .update({ stripe_account_id: accountId })
        .eq('user_id', sellerId);
      if (updateErr) throw new Error(`Supabase update failed: ${updateErr.message}`);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${SITE_URL}/classifieds?stripe_refresh=1`,
      return_url: `${SITE_URL}/classifieds?stripe_return=1`,
      type: 'account_onboarding'
    });

    return res.status(200).json({ ok: true, onboardingUrl: accountLink.url });
  } catch (err) {
    // Stripe errors carry extra detail worth surfacing -- include the
    // Stripe-specific message/type if present, not just err.message.
    const detail = err.raw ? (err.raw.message || err.message) : err.message;
    console.error('classifieds-stripe-onboard error:', err);
    return res.status(500).json({ error: detail || 'Unknown error', type: err.type || null });
  }
}
