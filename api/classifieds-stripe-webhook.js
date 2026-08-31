// rockosky.vercel.app/api/classifieds-stripe-webhook
// Stripe webhook: listens for checkout.session.completed, marks the
// matching order 'paid' and the listing 'sold'.
//
// SETUP REQUIRED: in the Stripe Dashboard, add a webhook endpoint
// pointing at this URL, subscribed to "checkout.session.completed",
// and put its signing secret in the STRIPE_WEBHOOK_SECRET env var.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe requires the raw, unparsed request body to verify the
// webhook signature -- Vercel's default JSON body parser would break
// that, so it's turned off here.
export const config = {
  api: { bodyParser: false }
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end();
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('classifieds-stripe-webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const { data: order } = await supabase
        .from('classifieds_orders')
        .update({
          status: 'paid',
          stripe_payment_intent_id: session.payment_intent || null
        })
        .eq('stripe_checkout_session_id', session.id)
        .select()
        .maybeSingle();

      if (order && order.listing_id) {
        await supabase.from('classifieds_listings')
          .update({ status: 'sold' })
          .eq('id', order.listing_id);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('classifieds-stripe-webhook handling error:', err);
    // Still return 200 so Stripe doesn't endlessly retry a webhook
    // whose failure is on our side, not a signature problem -- but
    // log it loudly so it's visible in Vercel's function logs.
    return res.status(200).json({ received: true, warning: err.message });
  }
}
