// rockosky.vercel.app/api/classifieds-checkout
// POST: create a Stripe Checkout session for one listing, using an
// embedded custom payment form (per Stripe Checkout Studio config)
// rather than a hosted-page redirect. Payment still routes through
// Stripe Connect so the seller gets paid minus a platform fee.
//
// NOTE ON DEVIATIONS FROM THE GENERIC INTEGRATION TASK:
// The Checkout Studio task instructions say to remove any parameter
// not listed in its Field Intents. Two groups of parameters here are
// intentionally KEPT despite not being in that list, because removing
// them would break real functionality already in production:
//   - payment_intent_data (application_fee_amount + transfer_data):
//     this is the Stripe Connect marketplace split -- without it,
//     100% of every sale would go to Ketchup Files and 0% to the
//     seller. Not something that can be "no longer configured."
//   - metadata (listing_id, seller_id) and customer_email: the
//     webhook (classifieds-stripe-webhook.js) depends on metadata to
//     know which order/listing to mark paid/sold. Removing it would
//     silently break order fulfillment.
// success_url / cancel_url ARE removed, per the task -- embedded
// checkout confirms in-page via the client-side 'confirm' event and
// the checkout.session.completed webhook, so a redirect is no longer
// needed.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

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
    const missing = [];
    if (!process.env.SUPBASE_URL) missing.push('SUPBASE_URL');
    if (!process.env.SUPBASE_SERVICE_ROLE_KEY) missing.push('SUPBASE_SERVICE_ROLE_KEY');
    if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variable(s): ${missing.join(', ')}` });
    }

    const supabase = createClient(process.env.SUPBASE_URL, process.env.SUPBASE_SERVICE_ROLE_KEY);
    // API version + beta flag required for the embedded custom payment
    // form (initCheckoutFormSdk on the client depends on this).
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1'
    });

    const { listingId, buyerEmail } = req.body;
    if (!listingId) return res.status(400).json({ error: 'listingId is required' });

    const { data: listing, error: listingErr } = await supabase
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
      // --- fixed_by_ui, from Checkout Studio ---
      ui_mode: 'form',
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      submit_type: 'auto',

      // --- sample_only, but already real values in this codebase --
      // preserved as-is per the precedence rule (real values win over
      // placeholders). mode stays "payment" (one-time sale, not a
      // subscription), so payment_method_collection is correctly
      // omitted per rule #8.
      mode: 'payment',
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

      // --- kept despite not being in Field Intents (see file header) ---
      // Managed Payments is a newer Stripe feature enabled by default
      // on this account, which conflicts with the classic Connect
      // application_fee_amount approach used below -- Stripe's own
      // error message says to disable it per-request like this.
      managed_payments: { enabled: false },

      customer_email: buyerEmail || undefined,
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: seller.stripe_account_id }
      },
      metadata: { listing_id: listingId, seller_id: seller.user_id }
    });

    // Record the attempt now as 'pending' -- the webhook flips it to
    // 'paid' once Stripe confirms the payment actually succeeded.
    await supabase.from('classifieds_orders').insert({
      listing_id: listingId,
      seller_id: seller.user_id,
      buyer_email: buyerEmail || null,
      amount_cents: amountCents,
      platform_fee_cents: feeCents,
      stripe_checkout_session_id: session.id,
      status: 'pending'
    });

    return res.status(200).json({ client_secret: session.client_secret });
  } catch (err) {
    console.error('classifieds-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
