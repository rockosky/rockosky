// rockosky.vercel.app/api/wallet-tokens
// GET  ?packages=1&userId=X  -> list purchasable token packages (excludes
//                                first-purchase-only ones if user already bought before)
// GET  ?balance=1&userId=X   -> current token balance for a user
// POST                       -> start a Stripe Checkout session to buy a token package
// PATCH                      -> spend tokens (used by classifieds-checkout.mjs when
//                                paying with tokens instead of a card)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const missing = [];
    if (!process.env.SUPBASE_URL) missing.push('SUPBASE_URL');
    if (!process.env.SUPBASE_SERVICE_ROLE_KEY) missing.push('SUPBASE_SERVICE_ROLE_KEY');
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variable(s): ${missing.join(', ')}` });
    }
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPBASE_URL, process.env.SUPBASE_SERVICE_ROLE_KEY);

    if (req.method === 'GET') {
      const { packages, balance, userId } = req.query;

      if (balance) {
        if (!userId) return res.status(400).json({ error: 'userId is required' });
        const { data, error } = await supabase
          .from('wallet_balances')
          .select('balance_tokens')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;
        return res.status(200).json({ balance_tokens: data ? data.balance_tokens : 0 });
      }

      if (packages) {
        let hasPurchasedBefore = false;
        if (userId) {
          const { data: prior } = await supabase
            .from('wallet_transactions')
            .select('id')
            .eq('user_id', userId)
            .eq('type', 'purchase')
            .limit(1);
          hasPurchasedBefore = !!(prior && prior.length);
        }

        let query = supabase.from('token_packages').select('*').eq('active', true).order('price_cents', { ascending: true });
        const { data, error } = await query;
        if (error) throw error;

        const visible = data.filter(p => !p.is_first_purchase_only || !hasPurchasedBefore);
        return res.status(200).json({ packages: visible });
      }

      return res.status(400).json({ error: 'Specify ?packages=1 or ?balance=1' });
    }

    if (req.method === 'POST') {
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(500).json({ error: 'Missing environment variable: STRIPE_SECRET_KEY' });
      }
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1'
      });

      const { userId, email, packageId } = req.body;
      if (!userId || !packageId) return res.status(400).json({ error: 'userId and packageId are required' });

      const { data: pkg, error: pkgErr } = await supabase
        .from('token_packages')
        .select('*')
        .eq('id', packageId)
        .eq('active', true)
        .maybeSingle();
      if (pkgErr) throw pkgErr;
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      if (pkg.is_first_purchase_only) {
        const { data: prior } = await supabase
          .from('wallet_transactions')
          .select('id')
          .eq('user_id', userId)
          .eq('type', 'purchase')
          .limit(1);
        if (prior && prior.length) {
          return res.status(400).json({ error: 'This bundle is only available on your first purchase.' });
        }
      }

      const session = await stripe.checkout.sessions.create({
        ui_mode: 'form',
        billing_address_collection: 'auto',
        phone_number_collection: { enabled: false },
        automatic_tax: { enabled: false },
        submit_type: 'auto',
        managed_payments: { enabled: false },
        mode: 'payment',
        customer_email: email || undefined,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: `${pkg.name} — ${pkg.token_amount.toLocaleString()} White Donuts` },
            unit_amount: pkg.price_cents
          },
          quantity: 1
        }],
        metadata: {
          type: 'token_purchase',
          user_id: userId,
          package_id: pkg.id,
          token_amount: String(pkg.token_amount)
        }
      });

      return res.status(200).json({ client_secret: session.client_secret });
    }

    if (req.method === 'PATCH') {
      // Spend tokens -- called server-to-server from classifieds-checkout.mjs,
      // not directly from the browser.
      const { userId, amountTokens, referenceType, referenceId } = req.body;
      if (!userId || !amountTokens) return res.status(400).json({ error: 'userId and amountTokens are required' });

      const { data: wallet } = await supabase
        .from('wallet_balances')
        .select('balance_tokens')
        .eq('user_id', userId)
        .maybeSingle();

      const currentBalance = wallet ? wallet.balance_tokens : 0;
      if (currentBalance < amountTokens) {
        return res.status(400).json({ error: 'Insufficient White Donuts balance.' });
      }

      const newBalance = currentBalance - amountTokens;
      const { error: updateErr } = await supabase
        .from('wallet_balances')
        .upsert({ user_id: userId, balance_tokens: newBalance, updated_at: new Date().toISOString() });
      if (updateErr) throw updateErr;

      await supabase.from('wallet_transactions').insert({
        user_id: userId,
        amount_tokens: -amountTokens,
        type: 'spend',
        reference_type: referenceType || null,
        reference_id: referenceId || null
      });

      return res.status(200).json({ ok: true, new_balance: newBalance });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('wallet-tokens error:', err);
    return res.status(500).json({ error: err.message });
  }
}
