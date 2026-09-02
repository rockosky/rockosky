// rockosky.vercel.app/api/classifieds-stripe-onboard
// POST: create (or resume) a Stripe Connect Express account for a
// classifieds seller, and return the onboarding URL to send them to.
// Same pattern as stripe-onboard-photographer.js, applied to
// classifieds_sellers instead.

import { createClient } from '@SUPBASE/SUPBASE-js';
import Stripe from 'stripe';

const SUPBASE = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL = process.env.SITE_URL || 'https://www.ketchupfiles.com';

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
    const { sellerId, email } = req.body;
    if (!sellerId) return res.status(400).json({ error: 'sellerId is required' });

    const { data: seller, error: sellerErr } = await SUPBASE
      .from('classifieds_sellers')
      .select('stripe_account_id')
      .eq('user_id', sellerId)
      .maybeSingle();
    if (sellerErr) throw sellerErr;

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

      await SUPBASE.from('classifieds_sellers')
        .update({ stripe_account_id: accountId })
        .eq('user_id', sellerId);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${SITE_URL}/classifieds?stripe_refresh=1`,
      return_url: `${SITE_URL}/classifieds?stripe_return=1`,
      type: 'account_onboarding'
    });

    return res.status(200).json({ ok: true, onboardingUrl: accountLink.url });
  } catch (err) {
    console.error('classifieds-stripe-onboard error:', err);
    return res.status(500).json({ error: err.message });
  }
}
