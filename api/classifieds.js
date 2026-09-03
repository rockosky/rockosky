<div class="kf-cl-widget">
  <style>
    .kf-cl-widget {
      all: initial; display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
      --kf-red: #e2231a; --kf-green: #5fbf7a; --bg: #0c0b0a; --card: #161311; --border: #302b26; --text: #f2ece1; --muted: #8a8378;
      color: var(--text); background: var(--bg); max-width: 1200px; margin: 0 auto; padding: 24px 16px; box-sizing: border-box;
    }
    .kf-cl-widget * { box-sizing: border-box; }
    .kf-cl-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-wrap: wrap; gap: 10px; }
    .kf-cl-top h1 { font-size: 20px; font-weight: 700; margin: 0; }
    .kf-cl-account { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--muted); }
    .kf-cl-account a { color: var(--kf-red); cursor: pointer; text-decoration: underline; }
    .kf-cl-post-btn { background: var(--kf-red); color: #fff; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; }
    .kf-cl-search-row { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
    .kf-cl-search-row input, .kf-cl-search-row select {
      padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; font-family: inherit;
      background: var(--card); color: var(--text);
    }
    .kf-cl-search-row input[type="text"] { flex: 1; min-width: 160px; }
    .kf-cl-search-row input::placeholder { color: var(--muted); }
    .kf-cl-search-row input[type="number"] { width: 90px; }

    .kf-cl-grid {
      column-count: 2; column-gap: 14px;
    }
    @media (min-width: 560px) { .kf-cl-grid { column-count: 3; } }
    @media (min-width: 860px) { .kf-cl-grid { column-count: 4; } }
    @media (min-width: 1100px) { .kf-cl-grid { column-count: 5; } }
    .kf-cl-card {
      background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
      cursor: pointer; transition: box-shadow .15s ease, transform .15s ease;
      break-inside: avoid; margin-bottom: 14px; display: inline-block; width: 100%; position: relative;
    }
    .kf-cl-card:hover { box-shadow: 0 10px 26px rgba(0,0,0,.35); transform: translateY(-2px); }
    .kf-cl-card img { width: 100%; display: block; background: #211d1a; }
    .kf-cl-price-badge {
      position: absolute; top: 8px; right: 8px;
      background: var(--kf-red); color: #fff; font-weight: 700; font-size: 12.5px;
      padding: 4px 10px; border-radius: 20px; box-shadow: 0 2px 8px rgba(0,0,0,.4);
    }
    .kf-cl-card-body { padding: 10px 12px; }
    .kf-cl-card-price { font-size: 15px; font-weight: 700; }
    .kf-cl-card-title { font-size: 12.5px; color: var(--text); margin: 2px 0; line-height: 1.3; }
    .kf-cl-card-loc { font-size: 11px; color: var(--muted); }

    .kf-cl-empty { color: var(--muted); font-size: 13px; padding: 40px 0; text-align: center; grid-column: 1/-1; }

    /* Detail view */
    .kf-cl-detail { display: none; }
    .kf-cl-back-btn { background: none; border: none; color: var(--kf-red); font-size: 13px; font-weight: 600; cursor: pointer; padding: 0; margin-bottom: 16px; }
    .kf-cl-detail-layout { display: grid; grid-template-columns: 1fr 320px; gap: 28px; }
    .kf-cl-detail-photos img { width: 100%; max-height: 560px; border-radius: 10px; margin-bottom: 8px; background: #0c0b0a; object-fit: contain; }
    .kf-cl-detail-thumbs { display: flex; gap: 6px; overflow-x: auto; }
    .kf-cl-detail-thumbs img { width: 60px; height: 60px; border-radius: 6px; object-fit: cover; flex-shrink: 0; cursor: pointer; opacity: .7; }
    .kf-cl-detail-thumbs img.active { opacity: 1; outline: 2px solid var(--kf-red); }
    .kf-cl-detail-price { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
    .kf-cl-detail-title { font-size: 16px; font-weight: 600; margin-bottom: 10px; }
    .kf-cl-detail-meta { font-size: 12.5px; color: var(--muted); margin-bottom: 16px; }
    .kf-cl-detail-desc { font-size: 13px; line-height: 1.6; margin-bottom: 20px; }
    .kf-cl-seller { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 16px; }
    .kf-cl-seller-avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--kf-red); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
    .kf-cl-section-title { font-size: 13px; font-weight: 700; margin: 24px 0 10px; }
    .kf-cl-mini-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
    .kf-cl-mini-card { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; cursor: pointer; }
    .kf-cl-mini-card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: #211d1a; }
    .kf-cl-mini-card-body { padding: 6px 8px; font-size: 11px; }
    .kf-cl-mini-card-price { font-weight: 700; }

    /* Auth panel */
    .kf-cl-modal-backdrop {
      all: initial;
      --kf-red: #e2231a; --kf-green: #5fbf7a; --bg: #0c0b0a; --card: #161311; --border: #302b26; --text: #f2ece1; --muted: #8a8378;
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,.85); z-index: 9999;
      align-items: center; justify-content: center; padding: 48px 20px; box-sizing: border-box;
    }
    .kf-cl-modal-backdrop * { box-sizing: border-box; }
    .kf-cl-modal-backdrop.open { display: flex; }
    .kf-cl-modal {
      background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 14px;
      max-width: 480px; width: 100%; max-height: 85vh; overflow-y: auto; padding: 36px;
      box-shadow: 0 30px 80px rgba(0,0,0,.6);
    }
    .kf-cl-modal h2 { font-size: 17px; margin: 0 0 14px; }
    .kf-cl-modal input, .kf-cl-modal select, .kf-cl-modal textarea {
      width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; margin-bottom: 10px; font-family: inherit;
      background: var(--bg); color: var(--text);
    }
    .kf-cl-modal input::placeholder, .kf-cl-modal textarea::placeholder { color: var(--muted); }
    .kf-cl-modal button.submit {
      background: #333; color: #f2ece1; border: none; padding: 11px; border-radius: 8px; font-weight: 700;
      cursor: not-allowed; width: 100%; font-size: 13px; transition: background .15s ease;
    }
    .kf-cl-modal button.submit.ready { background: var(--kf-green); cursor: pointer; }
    .kf-cl-modal button.submit:disabled { opacity: .7; cursor: default; }
    .kf-cl-modal .close-x { float: right; background: none; border: none; font-size: 18px; cursor: pointer; color: var(--muted); }
    .kf-cl-modal-msg { font-size: 12px; margin-top: 8px; color: var(--muted); }
    .kf-cl-modal-msg.ok { color: var(--kf-green); }
    .kf-cl-modal-msg.err { color: var(--kf-red); }
    .kf-cl-photo-thumbs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .kf-cl-photo-thumbs .kf-cl-thumb-wrap { position: relative; width: 56px; height: 56px; }
    .kf-cl-photo-thumbs img { width: 56px; height: 56px; border-radius: 6px; object-fit: cover; display: block; }
    .kf-cl-photo-thumbs .kf-cl-thumb-status {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,.45); border-radius: 6px; font-size: 9px; color: #fff; text-align: center;
    }
    .kf-cl-toggle { font-size: 11.5px; color: var(--muted); text-decoration: underline; cursor: pointer; margin-top: -4px; margin-bottom: 10px; display: inline-block; }
  </style>

  <div id="kf-cl-browse">
    <div class="kf-cl-top">
      <h1>Community Classifieds</h1>
      <div class="kf-cl-account">
        <span id="kf-cl-account-status">Loading…</span>
        <button class="kf-cl-post-btn" id="kf-cl-open-post">+ Post a Listing</button>
      </div>
    </div>
    <div class="kf-cl-search-row">
      <input type="text" id="kf-cl-search" placeholder="Search listings…">
      <select id="kf-cl-category">
        <option value="">All Categories</option>
        <option value="electronics">Electronics</option>
        <option value="clothing">Clothing, Shoes &amp; Accessories</option>
        <option value="home">Home &amp; Garden</option>
        <option value="vehicles">Vehicles</option>
        <option value="collectibles">Collectibles &amp; Art</option>
        <option value="other">Other</option>
      </select>
      <select id="kf-cl-condition">
        <option value="">Any Condition</option>
        <option value="new">New</option>
        <option value="open_box">Open Box</option>
        <option value="used">Used</option>
        <option value="for_parts">For Parts</option>
      </select>
      <input type="number" id="kf-cl-min" placeholder="Min $">
      <input type="number" id="kf-cl-max" placeholder="Max $">
    </div>
    <div class="kf-cl-grid" id="kf-cl-grid">Loading…</div>
  </div>

  <div class="kf-cl-detail" id="kf-cl-detail">
    <button class="kf-cl-back-btn" id="kf-cl-back">&larr; Back to listings</button>
    <div id="kf-cl-detail-content"></div>
  </div>

  <div class="kf-cl-detail" id="kf-cl-store">
    <button class="kf-cl-back-btn" id="kf-cl-store-back">&larr; Back to listings</button>
    <div id="kf-cl-store-content"></div>
  </div>
</div>

<!-- Seller profile editor -->
<div class="kf-cl-modal-backdrop" id="kf-cl-profile-backdrop">
  <div class="kf-cl-modal">
    <button class="close-x" id="kf-cl-profile-close">&times;</button>
    <h2>Edit Your Store</h2>
    <div style="font-size:11px;color:#8a8378;margin-bottom:4px;">Store Photo</div>
    <input type="file" id="kf-cl-profile-avatar-file" accept="image/*" style="margin-bottom:10px;">
    <img id="kf-cl-profile-avatar-preview" src="" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;display:none;margin-bottom:10px;background:#211d1a;">
    <input type="text" id="kf-cl-profile-store-name" placeholder="Store name (e.g. Felipe's Gear Closet)">
    <input type="text" id="kf-cl-profile-display-name" placeholder="Your display name">
    <textarea id="kf-cl-profile-bio" placeholder="A short bio for your store page" rows="3"></textarea>
    <button class="submit ready" id="kf-cl-profile-save" style="background:var(--kf-red);">Save Store</button>
    <div class="kf-cl-modal-msg" id="kf-cl-profile-msg"></div>
    <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border);">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Payouts</div>
      <div style="font-size:12.5px;" id="kf-cl-payout-status">Checking…</div>
      <button class="submit ready" id="kf-cl-payout-btn" style="background:#1355c9;margin-top:8px;display:none;">Connect Payouts (Stripe)</button>
    </div>
    <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border);">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Payment Method (for buying)</div>
      <div style="font-size:12.5px;" id="kf-cl-payment-status">Checking…</div>
      <div id="kf-cl-card-element-wrap" style="display:none;margin-top:8px;">
        <div id="kf-cl-card-element" style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:8px;"></div>
        <div id="kf-cl-card-errors" style="font-size:11.5px;color:var(--kf-red);min-height:16px;margin-bottom:6px;"></div>
        <button class="submit ready" id="kf-cl-card-save-btn" style="background:#1355c9;">Save Card</button>
      </div>
      <button class="submit ready" id="kf-cl-add-card-btn" style="background:#1355c9;margin-top:8px;">Add Payment Method</button>
    </div>
  </div>
</div>

<!-- Sign up / log in — separate account system just for classifieds
     sellers/buyers, entirely independent from Ketchup Files
     contributors (creator_profiles, roster, chat approval, etc). -->
<div class="kf-cl-modal-backdrop" id="kf-cl-auth-backdrop">
  <div class="kf-cl-modal">
    <button class="close-x" id="kf-cl-auth-close">&times;</button>
    <h2 id="kf-cl-auth-title">Log in to post a listing</h2>
    <input type="email" id="kf-cl-auth-email" placeholder="Email" autocomplete="email">
    <input type="password" id="kf-cl-auth-password" placeholder="Password" autocomplete="current-password">
    <span class="kf-cl-toggle" id="kf-cl-auth-toggle">New here? Create an account instead</span>
    <button class="submit ready" id="kf-cl-auth-submit" style="background:var(--kf-red);">Log In</button>
    <div class="kf-cl-modal-msg" id="kf-cl-auth-msg"></div>
  </div>
</div>

<!-- Post a listing -->
<div class="kf-cl-modal-backdrop" id="kf-cl-checkout-backdrop">
  <div class="kf-cl-modal" style="max-width:460px;">
    <button class="close-x" id="kf-cl-checkout-close">&times;</button>
    <h2>Complete Purchase</h2>
    <div id="checkout-form"></div>
    <div class="kf-cl-modal-msg" id="kf-cl-checkout-msg"></div>
  </div>
</div>

<div class="kf-cl-modal-backdrop" id="kf-cl-modal-backdrop">
  <div class="kf-cl-modal">
    <button class="close-x" id="kf-cl-modal-close">&times;</button>
    <h2>Post a Listing</h2>
    <input type="text" id="kf-cl-f-title" placeholder="Title" required>
    <textarea id="kf-cl-f-desc" placeholder="Description" rows="3"></textarea>
    <input type="number" id="kf-cl-f-price" placeholder="Price (USD)" min="0" step="0.01">
    <select id="kf-cl-f-category">
      <option value="">Category…</option>
      <option value="electronics">Electronics</option>
      <option value="clothing">Clothing, Shoes &amp; Accessories</option>
      <option value="home">Home &amp; Garden</option>
      <option value="vehicles">Vehicles</option>
      <option value="collectibles">Collectibles &amp; Art</option>
      <option value="other">Other</option>
    </select>
    <select id="kf-cl-f-condition">
      <option value="">Condition…</option>
      <option value="new">New</option>
      <option value="open_box">Open Box</option>
      <option value="used">Used</option>
      <option value="for_parts">For Parts</option>
    </select>
    <input type="text" id="kf-cl-f-city" placeholder="City">
    <input type="text" id="kf-cl-f-state" placeholder="State">
    <div style="font-size:11px;color:#767676;margin-bottom:4px;">Photos (at least one required)</div>
    <input type="file" id="kf-cl-f-photos" accept="image/*" multiple style="margin-bottom:8px;">
    <div class="kf-cl-photo-thumbs" id="kf-cl-photo-thumbs"></div>
    <button class="submit" id="kf-cl-f-submit" disabled>Fill out the listing to post</button>
    <div class="kf-cl-modal-msg" id="kf-cl-f-msg"></div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://js.stripe.com/dahlia/stripe.js"></script>
<script>
(function () {
  const SUPBASE_URL = "https://lfbtreaojwxxwuwhssba.supabase.co";
  const SUPBASE_ANON_KEY = "sb_publishable_KX1Hpau0Lc7M_n1snlYbEw_lnr_GfL9";
  const BUCKET = "Ketchup Files UPLOADS";
  const API_BASE = 'https://rockosky.vercel.app/api';
  const STRIPE_PUBLISHABLE_KEY = "pk_test_51UAe6eRtAeXFm7gfOOGqQNopaXZUM0AnsH1WnMrjTZ3QJV0LPgEM6c40J9ZFHyJQG9T1p1qzjbsLhM0DOXceCCoQ00fes7kBth";
  const stripeClient = window.Stripe ? Stripe(STRIPE_PUBLISHABLE_KEY, { betas: ['custom_checkout_payment_form_1'] }) : null;
  let stripeElements = null;
  let cardElement = null;

  const sb = supabase.createClient(SUPBASE_URL, SUPBASE_ANON_KEY);
  let currentUser = null;
  let selectedPhotoFiles = [];
  let isSignup = false;

  function money(cents) { return '$' + (cents / 100).toFixed(0); }
  function coverPhoto(photos) { return (photos && photos[0] && photos[0].url) || ''; }

  // ---- Account state (classifieds sellers -- a separate group from
  // Ketchup Files contributors; no shared table, no shared roster). ----
  async function ensureSellerProfile(user) {
    try {
      const existing = await sb.from('classifieds_sellers').select('user_id').eq('user_id', user.id).maybeSingle();
      if (existing.data) return; // already has a profile — don't re-trigger onboarding on every login
      await sb.from('classifieds_sellers').upsert({
        user_id: user.id,
        display_name: (user.email || 'Seller').split('@')[0],
        email: user.email
      }, { onConflict: 'user_id' });

      // First-time profile creation — kick off Stripe Connect
      // onboarding right away instead of making them come back later
      // through "My Store" to set up payouts.
      startStripeOnboarding(user.id, user.email, true);
    } catch (err) { /* non-fatal */ }
  }

  async function startStripeOnboarding(userId, email, isAutoStart) {
    try {
      const res = await fetch(`${API_BASE}/classifieds-stripe-onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: userId, email })
      });
      const data = await res.json();
      if (data.ok && data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      } else if (!isAutoStart) {
        alert(data.error || 'Could not start payout setup.');
      }
      // On auto-start, a failure (e.g. the Stripe restriction) fails
      // silently here — the seller can still browse/list normally,
      // and can retry payout setup any time from "My Store".
    } catch (err) { /* non-fatal on auto-start */ }
  }

  async function updateAccountUI(user) {
    const statusEl = document.getElementById('kf-cl-account-status');
    if (user) {
      statusEl.innerHTML = `Signed in as ${user.email} — <a id="kf-cl-manage-store">My Store</a> · <a id="kf-cl-logout">Log out</a>`;
      document.getElementById('kf-cl-logout').addEventListener('click', async () => { await sb.auth.signOut(); });
      document.getElementById('kf-cl-manage-store').addEventListener('click', openProfileEditor);
      renderPayoutReminder(user);
    } else {
      statusEl.textContent = 'Not signed in';
      const reminder = document.getElementById('kf-cl-payout-reminder');
      if (reminder) reminder.remove();
    }
  }

  // A small persistent reminder next to the account status, in case
  // the auto-onboarding redirect got missed, closed, blocked, or
  // failed (e.g. a Stripe-side restriction) -- reconnecting is never
  // more than one click away, without having to dig into My Store.
  async function renderPayoutReminder(user) {
    let reminder = document.getElementById('kf-cl-payout-reminder');
    if (!reminder) {
      reminder = document.createElement('span');
      reminder.id = 'kf-cl-payout-reminder';
      reminder.style.cssText = 'margin-left:8px;';
      document.getElementById('kf-cl-account-status').insertAdjacentElement('afterend', reminder);
    }
    try {
      const res = await sb.from('classifieds_sellers').select('stripe_account_id').eq('user_id', user.id).maybeSingle();
      if (res.data && res.data.stripe_account_id) {
        reminder.innerHTML = '';
        return;
      }
      reminder.innerHTML = `<a id="kf-cl-payout-reminder-link" style="color:#e2231a;font-weight:600;cursor:pointer;">⚠ Connect Payouts</a>`;
      document.getElementById('kf-cl-payout-reminder-link').addEventListener('click', () => {
        startStripeOnboarding(user.id, user.email, false);
      });
    } catch (err) { /* leave reminder as-is on error */ }
  }

  sb.auth.onAuthStateChange((event, session) => {
    currentUser = session ? session.user : null;
    updateAccountUI(currentUser);
    if (currentUser) ensureSellerProfile(currentUser);
  });
  sb.auth.getSession().then(res => {
    currentUser = res.data.session ? res.data.session.user : null;
    updateAccountUI(currentUser);
    if (currentUser) ensureSellerProfile(currentUser);
  });

  // ---- Auth modal ----
  const authBackdrop = document.getElementById('kf-cl-auth-backdrop');
  document.getElementById('kf-cl-auth-close').addEventListener('click', () => authBackdrop.classList.remove('open'));
  document.getElementById('kf-cl-auth-toggle').addEventListener('click', function () {
    isSignup = !isSignup;
    document.getElementById('kf-cl-auth-title').textContent = isSignup ? 'Create your account' : 'Log in to post a listing';
    document.getElementById('kf-cl-auth-submit').textContent = isSignup ? 'Create Account' : 'Log In';
    this.textContent = isSignup ? 'Already have an account? Log in instead' : 'New here? Create an account instead';
  });

  document.getElementById('kf-cl-auth-submit').addEventListener('click', async () => {
    const msgEl = document.getElementById('kf-cl-auth-msg');
    const email = document.getElementById('kf-cl-auth-email').value.trim();
    const password = document.getElementById('kf-cl-auth-password').value;
    if (!email || !password) { msgEl.textContent = 'Enter email and password.'; msgEl.className = 'kf-cl-modal-msg err'; return; }

    msgEl.textContent = isSignup ? 'Creating account…' : 'Logging in…'; msgEl.className = 'kf-cl-modal-msg';
    const result = isSignup
      ? await sb.auth.signUp({ email, password })
      : await sb.auth.signInWithPassword({ email, password });

    if (result.error) { msgEl.textContent = result.error.message; msgEl.className = 'kf-cl-modal-msg err'; return; }

    if (isSignup && !result.data.session) {
      msgEl.textContent = 'Check your email to confirm your account, then log in.';
      msgEl.className = 'kf-cl-modal-msg ok';
      return;
    }

    msgEl.textContent = ''; authBackdrop.classList.remove('open');
    document.getElementById('kf-cl-modal-backdrop').classList.add('open');
  });

  // ---- Browse / search ----
  async function loadListings() {
    const grid = document.getElementById('kf-cl-grid');
    grid.innerHTML = 'Loading…';
    const params = new URLSearchParams();
    const q = document.getElementById('kf-cl-search').value.trim();
    const category = document.getElementById('kf-cl-category').value;
    const condition = document.getElementById('kf-cl-condition').value;
    const min = document.getElementById('kf-cl-min').value;
    const max = document.getElementById('kf-cl-max').value;
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (condition) params.set('condition', condition);
    if (min) params.set('min', min);
    if (max) params.set('max', max);

    try {
      const res = await fetch(`${API_BASE}/classifieds?${params.toString()}`);
      const { listings } = await res.json();
      if (!listings || !listings.length) {
        grid.innerHTML = '<div class="kf-cl-empty">No listings found.</div>';
        return;
      }
      grid.innerHTML = listings.map(l => `
        <div class="kf-cl-card" onclick="kfClOpenDetail('${l.id}')">
          <img src="${coverPhoto(l.photos)}" alt="" loading="lazy">
          <div class="kf-cl-price-badge">${money(l.price_cents)}</div>
          <div class="kf-cl-card-body">
            <div class="kf-cl-card-title">${l.title}</div>
            <div class="kf-cl-card-loc">${l.location_city || ''}${l.location_state ? ', ' + l.location_state : ''}</div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      grid.innerHTML = '<div class="kf-cl-empty">Could not load listings.</div>';
    }
  }

  // ---- Buy Now: creates a Stripe Checkout session for this listing
  // and redirects the buyer there. Works for anyone, logged in or
  // not -- Stripe Checkout collects the buyer's card + email itself. ----
  window.kfClBuyListing = async function (listingId) {
    const btn = document.getElementById('kf-cl-buy-btn');
    const msgEl = document.getElementById('kf-cl-buy-msg');
    btn.disabled = true;
    btn.textContent = 'Preparing checkout…';
    msgEl.textContent = '';

    try {
      const res = await fetch(`${API_BASE}/classifieds-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          buyerEmail: currentUser ? currentUser.email : undefined
        })
      });
      const data = await res.json();

      if (res.ok && data.client_secret) {
        btn.disabled = false;
        btn.textContent = 'Buy Now';
        openEmbeddedCheckout(data.client_secret);
      } else {
        msgEl.textContent = data.error || 'Could not start checkout.';
        msgEl.className = 'kf-cl-modal-msg err';
        btn.disabled = false;
        btn.textContent = 'Buy Now';
      }
    } catch (err) {
      msgEl.textContent = 'Could not reach checkout — try again.';
      msgEl.className = 'kf-cl-modal-msg err';
      btn.disabled = false;
      btn.textContent = 'Buy Now';
    }
  };

  // ---- Embedded custom payment form (Stripe Checkout Studio).
  // Renders in a Stripe-hosted iframe inside our own modal, instead
  // of redirecting to a Stripe-hosted page. Fulfillment (marking the
  // order paid + listing sold) still happens via the
  // checkout.session.completed webhook, same as before -- this only
  // changes how the buyer enters their card. ----
  const checkoutBackdrop = document.getElementById('kf-cl-checkout-backdrop');

  async function openEmbeddedCheckout(clientSecret) {
    const msgEl = document.getElementById('kf-cl-checkout-msg');
    const formContainer = document.getElementById('checkout-form');
    formContainer.innerHTML = '';
    msgEl.textContent = '';
    checkoutBackdrop.classList.add('open');

    if (!stripeClient) {
      msgEl.textContent = 'Payment form could not load — try again shortly.';
      msgEl.className = 'kf-cl-modal-msg err';
      return;
    }

    try {
      const appearance = {
        theme: 'stripe',
        labels: 'auto',
        inputs: 'spaced',
        variables: {
          borderRadius: '8px',
          colorBackground: '#161311',
          colorDanger: '#e2231a',
          colorPrimary: '#e2231a',
          colorSuccess: '#5fbf7a',
          colorText: '#f2ece1',
          fontFamily: 'default',
          fontSizeBase: '14px',
          spacingUnit: '4px'
        }
      };

      const checkout = await stripeClient.initCheckoutFormSdk({ clientSecret, appearance });
      const form = checkout.createForm({ layout: 'expanded' });
      form.mount('#checkout-form');

      const loadActionsResult = await checkout.loadActions();
      if (loadActionsResult.type === 'success') {
        form.on('confirm', async (event) => {
          try {
            await loadActionsResult.actions.confirm({ formConfirmEvent: event });
            // Success is ultimately confirmed by the webhook flipping
            // the listing to 'sold' -- refresh the grid once the buyer
            // is done so they see the up-to-date state.
            checkoutBackdrop.classList.remove('open');
            loadListings();
          } catch (error) {
            msgEl.textContent = error.message || 'Payment could not be confirmed.';
            msgEl.className = 'kf-cl-modal-msg err';
          }
        });
      } else {
        msgEl.textContent = 'Could not load payment actions — try again.';
        msgEl.className = 'kf-cl-modal-msg err';
      }
    } catch (err) {
      msgEl.textContent = 'Could not load the payment form — try again.';
      msgEl.className = 'kf-cl-modal-msg err';
    }
  }

  document.getElementById('kf-cl-checkout-close').addEventListener('click', () => {
    checkoutBackdrop.classList.remove('open');
  });

  window.kfClOpenDetail = async function (id) {
    document.getElementById('kf-cl-browse').style.display = 'none';
    document.getElementById('kf-cl-detail').style.display = 'block';
    const content = document.getElementById('kf-cl-detail-content');
    content.innerHTML = 'Loading…';

    try {
      const res = await fetch(`${API_BASE}/classifieds?id=${id}`);
      const { listing, similar_items, sellers_other_listings } = await res.json();
      const photos = listing.photos || [];
      const seller = listing.classifieds_sellers || {};
      const sellerLabel = seller.store_name || seller.display_name || 'Seller';
      const sellerInitial = sellerLabel.charAt(0).toUpperCase();
      const sellerAvatarHtml = seller.avatar_url
        ? `<img src="${seller.avatar_url}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
        : `<div class="kf-cl-seller-avatar">${sellerInitial}</div>`;

      content.innerHTML = `
        <div class="kf-cl-detail-layout">
          <div>
            <div class="kf-cl-detail-photos">
              <img id="kf-cl-main-photo" src="${photos[0] ? photos[0].url : ''}" alt="">
              ${photos.length > 1 ? `<div class="kf-cl-detail-thumbs">${photos.map((p, i) => `<img src="${p.url}" class="${i === 0 ? 'active' : ''}" onclick="document.getElementById('kf-cl-main-photo').src='${p.url}'; this.parentElement.querySelectorAll('img').forEach(im=>im.classList.remove('active')); this.classList.add('active');">`).join('')}</div>` : ''}
            </div>
          </div>
          <div>
            <div class="kf-cl-detail-price">${money(listing.price_cents)}</div>
            <div class="kf-cl-detail-title">${listing.title}</div>
            <div class="kf-cl-detail-meta">${listing.location_city || ''}${listing.location_state ? ', ' + listing.location_state : ''} · ${listing.condition || ''}</div>
            <div class="kf-cl-seller" style="cursor:pointer;" onclick="kfClOpenStore('${listing.user_id}')">
              ${sellerAvatarHtml}
              <div>${sellerLabel}</div>
            </div>
            <div class="kf-cl-detail-desc">${listing.description || ''}</div>
            ${listing.status === 'active'
              ? `<button class="submit ready" id="kf-cl-buy-btn" style="background:var(--kf-red);" onclick="kfClBuyListing('${listing.id}')">Buy Now — ${money(listing.price_cents)}</button>
                 <div class="kf-cl-modal-msg" id="kf-cl-buy-msg" style="margin-top:8px;"></div>`
              : `<div style="color:var(--muted);font-size:13px;">This item is no longer available.</div>`}
          </div>
        </div>
        <div class="kf-cl-section-title">Similar Items</div>
        <div class="kf-cl-mini-grid">
          ${(similar_items || []).map(s => `
            <div class="kf-cl-mini-card" onclick="kfClOpenDetail('${s.id}')">
              <img src="${coverPhoto(s.photos)}" alt="">
              <div class="kf-cl-mini-card-body"><div class="kf-cl-mini-card-price">${money(s.price_cents)}</div>${s.title}</div>
            </div>
          `).join('') || '<div style="color:#767676;font-size:12px;">None found.</div>'}
        </div>
        <div class="kf-cl-section-title">Seller's Other Listings</div>
        <div class="kf-cl-mini-grid">
          ${(sellers_other_listings || []).map(s => `
            <div class="kf-cl-mini-card" onclick="kfClOpenDetail('${s.id}')">
              <img src="${coverPhoto(s.photos)}" alt="">
              <div class="kf-cl-mini-card-body"><div class="kf-cl-mini-card-price">${money(s.price_cents)}</div>${s.title}</div>
            </div>
          `).join('') || '<div style="color:#767676;font-size:12px;">No other listings.</div>'}
        </div>
      `;
    } catch (err) {
      content.innerHTML = '<div class="kf-cl-empty">Could not load this listing.</div>';
    }
  };

  document.getElementById('kf-cl-back').addEventListener('click', () => {
    document.getElementById('kf-cl-detail').style.display = 'none';
    document.getElementById('kf-cl-browse').style.display = 'block';
  });

  ['kf-cl-search', 'kf-cl-category', 'kf-cl-condition', 'kf-cl-min', 'kf-cl-max'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadListings);
  });
  document.getElementById('kf-cl-search').addEventListener('keydown', e => { if (e.key === 'Enter') loadListings(); });

  // ---- Post listing modal ----
  const modalBackdrop = document.getElementById('kf-cl-modal-backdrop');
  document.getElementById('kf-cl-open-post').addEventListener('click', () => {
    if (!currentUser) { authBackdrop.classList.add('open'); return; }
    modalBackdrop.classList.add('open');
  });
  document.getElementById('kf-cl-modal-close').addEventListener('click', () => modalBackdrop.classList.remove('open'));

  // Submit button only turns green (and clickable) once every required
  // field is actually filled in, including at least one photo.
  const submitBtn = document.getElementById('kf-cl-f-submit');
  function checkFormReady() {
    const ready =
      document.getElementById('kf-cl-f-title').value.trim() &&
      document.getElementById('kf-cl-f-price').value !== '' &&
      document.getElementById('kf-cl-f-category').value &&
      document.getElementById('kf-cl-f-condition').value &&
      document.getElementById('kf-cl-f-city').value.trim() &&
      selectedPhotoFiles.length > 0;
    submitBtn.disabled = !ready;
    submitBtn.classList.toggle('ready', !!ready);
    submitBtn.textContent = ready ? 'Post Listing' : 'Fill out the listing to post';
    return ready;
  }
  ['kf-cl-f-title', 'kf-cl-f-price', 'kf-cl-f-category', 'kf-cl-f-condition', 'kf-cl-f-city'].forEach(id => {
    document.getElementById(id).addEventListener('input', checkFormReady);
    document.getElementById(id).addEventListener('change', checkFormReady);
  });

  document.getElementById('kf-cl-f-photos').addEventListener('change', function () {
    selectedPhotoFiles = Array.from(this.files).slice(0, 8);
    document.getElementById('kf-cl-photo-thumbs').innerHTML = selectedPhotoFiles.map(f => `
      <div class="kf-cl-thumb-wrap"><img src="${URL.createObjectURL(f)}" alt=""></div>
    `).join('');
    checkFormReady();
  });

  submitBtn.addEventListener('click', async () => {
    if (!checkFormReady()) return;
    const msgEl = document.getElementById('kf-cl-f-msg');
    if (!currentUser) { msgEl.textContent = 'Please log in.'; msgEl.className = 'kf-cl-modal-msg err'; return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading photos…';
    msgEl.textContent = ''; msgEl.className = 'kf-cl-modal-msg';

    try {
      const thumbWraps = document.querySelectorAll('#kf-cl-photo-thumbs .kf-cl-thumb-wrap');
      const uploadedPhotos = [];
      let uploadFailures = 0;

      for (let i = 0; i < selectedPhotoFiles.length; i++) {
        const file = selectedPhotoFiles[i];
        const path = `${currentUser.id}/classifieds/${Date.now()}-${i}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const upload = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
        if (upload.error) {
          uploadFailures++;
          console.error('Classifieds photo upload failed:', upload.error.message);
          if (thumbWraps[i]) thumbWraps[i].innerHTML += `<div class="kf-cl-thumb-status" title="${upload.error.message}">Failed</div>`;
        } else {
          uploadedPhotos.push({ url: sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
        }
      }

      if (!uploadedPhotos.length) {
        msgEl.textContent = 'All photo uploads failed — check your connection and try again.';
        msgEl.className = 'kf-cl-modal-msg err';
        submitBtn.disabled = false; submitBtn.textContent = 'Post Listing';
        return;
      }

      submitBtn.textContent = 'Submitting…';
      const res = await fetch(`${API_BASE}/classifieds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          title: document.getElementById('kf-cl-f-title').value.trim(),
          description: document.getElementById('kf-cl-f-desc').value.trim(),
          price: document.getElementById('kf-cl-f-price').value,
          category: document.getElementById('kf-cl-f-category').value,
          condition: document.getElementById('kf-cl-f-condition').value,
          location_city: document.getElementById('kf-cl-f-city').value.trim(),
          location_state: document.getElementById('kf-cl-f-state').value.trim(),
          photos: uploadedPhotos
        })
      });

      if (res.ok) {
        msgEl.textContent = uploadFailures
          ? `Submitted (${uploadFailures} photo(s) failed to upload) — it'll appear once approved.`
          : "Submitted — it'll appear once approved.";
        msgEl.className = 'kf-cl-modal-msg ok';
        submitBtn.textContent = 'Submitted ✓';
        setTimeout(() => {
          modalBackdrop.classList.remove('open');
          document.getElementById('kf-cl-f-title').value = '';
          document.getElementById('kf-cl-f-desc').value = '';
          document.getElementById('kf-cl-f-price').value = '';
          document.getElementById('kf-cl-f-category').value = '';
          document.getElementById('kf-cl-f-condition').value = '';
          document.getElementById('kf-cl-f-city').value = '';
          document.getElementById('kf-cl-f-state').value = '';
          document.getElementById('kf-cl-photo-thumbs').innerHTML = '';
          selectedPhotoFiles = [];
          msgEl.textContent = '';
          checkFormReady();
          loadListings();
        }, 1600);
      } else {
        let serverMsg = 'Something went wrong.';
        try { const errData = await res.json(); if (errData.error) serverMsg = errData.error; } catch (e) {}
        msgEl.textContent = serverMsg; msgEl.className = 'kf-cl-modal-msg err';
        submitBtn.disabled = false; submitBtn.textContent = 'Post Listing';
      }
    } catch (err) {
      msgEl.textContent = 'Could not post listing: ' + (err.message || 'unknown error'); msgEl.className = 'kf-cl-modal-msg err';
      submitBtn.disabled = false; submitBtn.textContent = 'Post Listing';
    }
  });

  // ---- Storefront: a seller's public page -- their store name/bio/
  // avatar plus every active listing they have up, MySpace-profile
  // style. ----
  window.kfClOpenStore = async function (userId) {
    document.getElementById('kf-cl-browse').style.display = 'none';
    document.getElementById('kf-cl-detail').style.display = 'none';
    document.getElementById('kf-cl-store').style.display = 'block';
    const content = document.getElementById('kf-cl-store-content');
    content.innerHTML = 'Loading…';

    try {
      const res = await fetch(`${API_BASE}/classifieds?seller=${userId}`);
      const { seller, listings } = await res.json();
      const label = seller.store_name || seller.display_name || 'Store';
      const avatarHtml = seller.avatar_url
        ? `<img src="${seller.avatar_url}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;">`
        : `<div class="kf-cl-seller-avatar" style="width:64px;height:64px;font-size:24px;">${label.charAt(0).toUpperCase()}</div>`;

      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px;">
          ${avatarHtml}
          <div>
            <div style="font-size:19px;font-weight:700;">${label}</div>
            ${seller.display_name && seller.store_name ? `<div style="font-size:12px;color:var(--muted);">${seller.display_name}</div>` : ''}
          </div>
        </div>
        ${seller.bio ? `<div style="font-size:13px;color:var(--text);line-height:1.6;margin:14px 0 24px;max-width:600px;">${seller.bio}</div>` : '<div style="margin-bottom:24px;"></div>'}
        <div class="kf-cl-section-title" style="margin-top:0;">${listings.length} Listing${listings.length === 1 ? '' : 's'}</div>
        <div class="kf-cl-grid">
          ${listings.map(l => `
            <div class="kf-cl-card" onclick="kfClOpenDetail('${l.id}')">
              <img src="${coverPhoto(l.photos)}" alt="" loading="lazy">
              <div class="kf-cl-price-badge">${money(l.price_cents)}</div>
              <div class="kf-cl-card-body">
                <div class="kf-cl-card-title">${l.title}</div>
                <div class="kf-cl-card-loc">${l.location_city || ''}${l.location_state ? ', ' + l.location_state : ''}</div>
              </div>
            </div>
          `).join('') || '<div class="kf-cl-empty">No active listings.</div>'}
        </div>
      `;
    } catch (err) {
      content.innerHTML = '<div class="kf-cl-empty">Could not load this store.</div>';
    }
  };

  document.getElementById('kf-cl-store-back').addEventListener('click', () => {
    document.getElementById('kf-cl-store').style.display = 'none';
    document.getElementById('kf-cl-browse').style.display = 'block';
  });

  // ---- Profile editor: store name, bio, avatar -- writes directly
  // to classifieds_sellers via Supabase (RLS already restricts this
  // to auth.uid() = user_id, so no separate API endpoint needed). ----
  const profileBackdrop = document.getElementById('kf-cl-profile-backdrop');
  let selectedAvatarFile = null;

  async function openProfileEditor() {
    if (!currentUser) return;
    document.getElementById('kf-cl-profile-msg').textContent = '';
    selectedAvatarFile = null;
    const res = await sb.from('classifieds_sellers').select('*').eq('user_id', currentUser.id).maybeSingle();
    const data = res.data || {};
    document.getElementById('kf-cl-profile-store-name').value = data.store_name || '';
    document.getElementById('kf-cl-profile-display-name').value = data.display_name || '';
    document.getElementById('kf-cl-profile-bio').value = data.bio || '';
    const preview = document.getElementById('kf-cl-profile-avatar-preview');
    if (data.avatar_url) { preview.src = data.avatar_url; preview.style.display = 'block'; } else { preview.style.display = 'none'; }

    const payoutStatusEl = document.getElementById('kf-cl-payout-status');
    const payoutBtn = document.getElementById('kf-cl-payout-btn');
    if (data.stripe_account_id) {
      payoutStatusEl.textContent = 'Payouts connected \u2713 — buyers can purchase your listings.';
      payoutBtn.style.display = 'none';
    } else {
      payoutStatusEl.textContent = 'Not connected yet — buyers can\'t check out until you connect a payout account.';
      payoutBtn.style.display = 'inline-block';
    }

    const paymentStatusEl = document.getElementById('kf-cl-payment-status');
    const addCardBtn = document.getElementById('kf-cl-add-card-btn');
    document.getElementById('kf-cl-card-element-wrap').style.display = 'none';
    if (data.has_payment_method) {
      paymentStatusEl.textContent = 'Card on file \u2713';
      addCardBtn.textContent = 'Update Card';
    } else {
      paymentStatusEl.textContent = 'No payment method saved yet.';
      addCardBtn.textContent = 'Add Payment Method';
    }

    profileBackdrop.classList.add('open');
  }

  document.getElementById('kf-cl-payout-btn').addEventListener('click', async () => {
    const btn = document.getElementById('kf-cl-payout-btn');
    const statusEl = document.getElementById('kf-cl-payout-status');
    btn.disabled = true;
    statusEl.textContent = 'Opening Stripe setup…';
    try {
      const res = await fetch(`${API_BASE}/classifieds-stripe-onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: currentUser.id, email: currentUser.email })
      });
      const data = await res.json();
      if (data.ok && data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      } else {
        statusEl.textContent = data.error || 'Could not start payout setup.';
        btn.disabled = false;
      }
    } catch (err) {
      statusEl.textContent = 'Could not reach payout setup — try again.';
      btn.disabled = false;
    }
  });

  // ---- Payment method: saves a card via Stripe Elements, mounted
  // directly inside the profile modal (not a separate page). The
  // actual "has_payment_method = true" flip happens server-side in
  // the webhook once Stripe confirms setup_intent.succeeded -- this
  // just triggers the flow and shows a temporary optimistic status. ----
  document.getElementById('kf-cl-add-card-btn').addEventListener('click', async () => {
    if (!currentUser || !stripeClient) return;
    const wrap = document.getElementById('kf-cl-card-element-wrap');
    const btn = document.getElementById('kf-cl-add-card-btn');
    btn.disabled = true;
    btn.textContent = 'Loading…';

    try {
      const res = await fetch(`${API_BASE}/classifieds-create-setup-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, email: currentUser.email })
      });
      const data = await res.json();
      if (!data.ok || !data.clientSecret) {
        document.getElementById('kf-cl-card-errors').textContent = data.error || 'Could not start card setup.';
        btn.disabled = false;
        btn.textContent = 'Add Payment Method';
        return;
      }

      stripeElements = stripeClient.elements();
      cardElement = stripeElements.create('card', {
        style: { base: { color: '#f2ece1', fontSize: '14px', '::placeholder': { color: '#8a8378' } }, invalid: { color: '#e2231a' } }
      });
      cardElement.mount('#kf-cl-card-element');
      wrap.style.display = 'block';
      btn.style.display = 'none';

      document.getElementById('kf-cl-card-save-btn').onclick = async () => {
        const saveBtn = document.getElementById('kf-cl-card-save-btn');
        const errorsEl = document.getElementById('kf-cl-card-errors');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        const result = await stripeClient.confirmCardSetup(data.clientSecret, { payment_method: { card: cardElement } });
        if (result.error) {
          errorsEl.textContent = result.error.message;
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Card';
        } else {
          document.getElementById('kf-cl-payment-status').textContent = 'Card on file \u2713';
          wrap.style.display = 'none';
          btn.style.display = 'inline-block';
          btn.disabled = false;
          btn.textContent = 'Update Card';
        }
      };
    } catch (err) {
      document.getElementById('kf-cl-card-errors').textContent = 'Could not reach card setup — try again.';
      btn.disabled = false;
      btn.textContent = 'Add Payment Method';
    }
  });

  document.getElementById('kf-cl-profile-close').addEventListener('click', () => profileBackdrop.classList.remove('open'));

  document.getElementById('kf-cl-profile-avatar-file').addEventListener('change', function () {
    selectedAvatarFile = this.files[0] || null;
    const preview = document.getElementById('kf-cl-profile-avatar-preview');
    if (selectedAvatarFile) { preview.src = URL.createObjectURL(selectedAvatarFile); preview.style.display = 'block'; }
  });

  document.getElementById('kf-cl-profile-save').addEventListener('click', async () => {
    const msgEl = document.getElementById('kf-cl-profile-msg');
    if (!currentUser) return;
    msgEl.textContent = 'Saving…'; msgEl.className = 'kf-cl-modal-msg';

    try {
      let avatarUrl = null;
      if (selectedAvatarFile) {
        const path = `${currentUser.id}/classifieds-avatars/${Date.now()}-${selectedAvatarFile.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const upload = await sb.storage.from(BUCKET).upload(path, selectedAvatarFile, { contentType: selectedAvatarFile.type });
        if (!upload.error) avatarUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }

      const updates = {
        store_name: document.getElementById('kf-cl-profile-store-name').value.trim() || null,
        display_name: document.getElementById('kf-cl-profile-display-name').value.trim() || null,
        bio: document.getElementById('kf-cl-profile-bio').value.trim() || null
      };
      if (avatarUrl) updates.avatar_url = avatarUrl;

      const res = await sb.from('classifieds_sellers').update(updates).eq('user_id', currentUser.id);
      if (res.error) throw new Error(res.error.message);

      msgEl.textContent = 'Saved!'; msgEl.className = 'kf-cl-modal-msg ok';
      setTimeout(() => profileBackdrop.classList.remove('open'), 900);
    } catch (err) {
      msgEl.textContent = err.message || 'Could not save.'; msgEl.className = 'kf-cl-modal-msg err';
    }
  });

  loadListings();
})();
</script>
