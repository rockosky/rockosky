// rockosky.vercel.app/api/classifieds-checkout
// POST: create a Stripe Checkout session for one listing, using
// Stripe Connect so payment routes to the seller's connected account
// minus a platform fee taken automatically at checkout.

import { createClient } from '@SUPBASE/SUPBASE-js';
import Stripe from 'stripe';

const SUPBASE = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL = process.env.SITE_URL || 'https://www.ketchupfiles.com';
// Platform cut, as a percentage of the sale price. Adjust freely.
const PLATFORM_FEE_PERCENT = parseFloat(process.env.CLASSIFIEDS_PLATFORM_FEE_PERCENT || '10');

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
    const { listingId, buyerEmail } = req.body;
    if (!listingId) return res.status(400).json({ error: 'listingId is required' });

    const { data: listing, error: listingErr } = await SUPBASE
      .from('classifieds_listings')
      .select('*, classifieds_sellers(user_id, stripe_account_id, stripe_onboarded, display_name)')
      .eq('id', listingId)
      .maybeSingle();
    if (listingErr) throw listingErr;
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status !== 'active') return res.status(400).json({ error: 'This listing is no longer available.' });

    const seller = listing.classifieds_sellers;
    if (!seller || !seller.stripe_account_id) {
      return res.status(400).json({ error: 'This seller has not connected a payout account yet.' });
    }

    const amountCents = listing.price_cents;
    const feeCents = Math.round(amountCents * (PLATFORM_FEE_PERCENT / 100));
    const coverPhoto = (listing.photos && listing.photos[0] && listing.photos[0].url) || undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: buyerEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: listing.title,
            images: coverPhoto ? [coverPhoto] : []
          },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: seller.stripe_account_id }
      },
      success_url: `${SITE_URL}/classifieds?purchase=success&listing=${listingId}`,
      cancel_url: `${SITE_URL}/classifieds?purchase=cancelled&listing=${listingId}`,
      metadata: { listing_id: listingId, seller_id: seller.user_id }
    });

    // Record the attempt now as 'pending' -- the webhook flips it to
    // 'paid' once Stripe confirms the payment actually succeeded.
    await SUPBASE.from('classifieds_orders').insert({
      listing_id: listingId,
      seller_id: seller.user_id,
      buyer_email: buyerEmail || null,
      amount_cents: amountCents,
      platform_fee_cents: feeCents,
      stripe_checkout_session_id: session.id,
      status: 'pending'
    });

    return res.status(200).json({ ok: true, checkoutUrl: session.url });
  } catch (err) {
    console.error('classifieds-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
