

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PLATFORM_FEE_PERCENT = 0.15; // your cut -- photographer keeps the other 85%

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
    const { requestId } = req.body || {};
    if (!requestId) {
      res.status(400).json({ ok: false, error: 'requestId is required.' });
      return;
    }

    const reqRes = await fetch(
      `${supbase_URL}/rest/v1/image_requests?id=eq.${encodeURIComponent(requestId)}&select=id,buyer_id,photographer_id,budget_cents,status`,
      { headers: supbaseHeaders() }
    );
    const requests = await reqRes.json();
    const jobRequest = Array.isArray(requests) ? requests[0] : null;

    if (!jobRequest) {
      res.status(404).json({ ok: false, error: 'Request not found.' });
      return;
    }
    if (jobRequest.status !== 'completed') {
      res.status(400).json({ ok: false, error: `This request is "${jobRequest.status}" -- payment only happens once it's marked completed.` });
      return;
    }
    if (!jobRequest.photographer_id) {
      res.status(400).json({ ok: false, error: 'No photographer assigned to this request yet.' });
      return;
    }

    const buyerRes = await fetch(
      `${supbase_URL}/rest/v1/creator_profiles?user_id=eq.${encodeURIComponent(jobRequest.buyer_id)}&select=stripe_customer_id`,
      { headers: supbaseHeaders() }
    );
    const buyers = await buyerRes.json();
    const stripeCustomerId = (Array.isArray(buyers) && buyers[0] && buyers[0].stripe_customer_id) || null;
    if (!stripeCustomerId) {
      res.status(400).json({ ok: false, error: 'Buyer has no saved payment method on file yet.' });
      return;
    }

    const photographerRes = await fetch(
      `${supbase_URL}/rest/v1/creator_profiles?user_id=eq.${encodeURIComponent(jobRequest.photographer_id)}&select=stripe_account_id`,
      { headers: supbaseHeaders() }
    );
    const photographers = await photographerRes.json();
    const stripeAccountId = (Array.isArray(photographers) && photographers[0] && photographers[0].stripe_account_id) || null;
    if (!stripeAccountId) {
      res.status(400).json({ ok: false, error: 'Photographer has not completed Stripe payout setup yet.' });
      return;
    }

    const totalCents = jobRequest.budget_cents;
    const applicationFeeCents = Math.round(totalCents * PLATFORM_FEE_PERCENT);

    // Destination charge: the full amount is charged to the buyer, Stripe
    // automatically routes (total - application_fee) to the photographer's
    // connected account, and the application_fee stays in your own Stripe
    // balance. No manual transfer step, no holding buyer funds yourself.
    const paymentIntent = await stripeRequest('POST', '/v1/payment_intents', {
      amount: totalCents,
      currency: 'usd',
      customer: stripeCustomerId,
      application_fee_amount: applicationFeeCents,
      transfer_data: {
        destination: stripeAccountId
      },
      metadata: {
        image_request_id: requestId
      }
    });

    if (paymentIntent.error) {
      res.status(500).json({ ok: false, error: paymentIntent.error.message || 'Stripe payment could not be created.' });
      return;
    }

    res.status(200).json({
      ok: true,
      clientSecret: paymentIntent.client_secret,
      totalCents,
      photographerReceivesCents: totalCents - applicationFeeCents,
      platformFeeCents: applicationFeeCents
    });
  } catch (err) {
    console.error('create-job-payment failed:', err);
    res.status(500).json({ ok: false, error: 'Could not create payment -- check logs.' });
  }
};

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
