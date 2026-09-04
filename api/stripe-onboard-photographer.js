// rockosky.vercel.app/api/stripe-onboard-photographer
// POST: create (or resume) a Stripe Connect Express account for a
// Ketchup Files contributor, and return the onboarding URL to send
// them to. Same pattern as classifieds-stripe-onboard.js, applied to
// creator_profiles instead of classifieds_sellers.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);
const stripe = new Stripe(process.env.STRIPE_SECRET_API_KEY);

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
    const { photographerId, email } = req.body;
    if (!photographerId) return res.status(400).json({ error: 'photographerId is required' });

    const { data: contributor, error: contributorErr } = await supabase
      .from('creator_profiles')
      .select('stripe_account_id')
      .eq('user_id', photographerId)
      .maybeSingle();
    if (contributorErr) throw contributorErr;

    let accountId = contributor && contributor.stripe_account_id;

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

      await supabase.from('creator_profiles')
        .update({ stripe_account_id: accountId })
        .eq('user_id', photographerId);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${SITE_URL}?stripe_refresh=1`,
      return_url: `${SITE_URL}?stripe_return=1`,
      type: 'account_onboarding'
    });

    return res.status(200).json({ ok: true, onboardingUrl: accountLink.url });
  } catch (err) {
    console.error('stripe-onboard-photographer error:', err);
    return res.status(500).json({ error: err.message });
  }
}
