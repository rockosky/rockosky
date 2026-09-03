// rockosky.vercel.app/api/classifieds-create-setup-intent
// POST: creates (or reuses) a Stripe Customer for this account, then
// a SetupIntent so the browser can save a card via Stripe Elements.
// Marking has_payment_method = true happens in the webhook once
// Stripe confirms the card was actually saved, not here.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.supabase_URL,
  process.env.supabase_SERVICE_ROLE_KEY
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    const { userId, email } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const { data: seller, error: sellerErr } = await supabase
      .from('classifieds_sellers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (sellerErr) throw sellerErr;

    let customerId = seller && seller.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { classifieds_user_id: userId }
      });
      customerId = customer.id;
      await supabase.from('classifieds_sellers')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', userId);
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session'
    });

    return res.status(200).json({ ok: true, clientSecret: setupIntent.client_secret });
  } catch (err) {
    console.error('classifieds-create-setup-intent error:', err);
    return res.status(500).json({ error: err.message });
  }
}
