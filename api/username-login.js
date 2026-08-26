// /api/username-login.js
//
// Lets someone sign in with just a username instead of remembering
// their email. supbase's own auth system only accepts email for the
// password grant -- there's no username grant type -- so this resolves
// username -> email entirely server-side using the service role key,
// then does the real sign-in on the user's behalf. The email itself is
// never sent back to the browser at any point; only the resulting
// session tokens are, which is all the client actually needs.
//
// ============================================================
// ONE-TIME SETUP: same SUPBASE_URL / SUPBASE_SERVICE_ROLE_KEY env vars
// already used by the other functions -- no new variables needed.
// Also requires add-username.sql to have been run (adds the username
// column this depends on).
// ============================================================

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const supbase_ANON_KEY = "sb_publishable_KX1Hpau0Lc7M_n1snlYbEw_lnr_GfL9";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!supbase_URL) missingEnvVars.push('SUPBASE_URL');
  if (!supbase_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  try {
    // 1. Look up the account by username -> user_id (case-insensitive).
    const profileRes = await fetch(
      `${supbase_URL}/rest/v1/creator_profiles?username=ilike.${encodeURIComponent(username)}&select=user_id&limit=1`,
      { headers: serviceHeaders() }
    );
    const profiles = await profileRes.json();
    if (!profiles || !profiles.length) {
      res.status(401).json({ error: 'No account with that username.' });
      return;
    }
    const userId = profiles[0].user_id;

    // 2. Resolve user_id -> real email, server-side only, using the
    // Admin API -- this is the one place the email is ever seen, and
    // it never leaves this function.
    const userRes = await fetch(`${supbase_URL}/auth/v1/admin/users/${userId}`, {
      headers: serviceHeaders()
    });
    if (!userRes.ok) {
      res.status(401).json({ error: 'Could not find that account.' });
      return;
    }
    const userData = await userRes.json();
    const email = userData && userData.email;
    if (!email) {
      res.status(401).json({ error: 'That account has no email on file.' });
      return;
    }

    // 3. Do the real sign-in with the resolved email -- this is the
    // standard password grant, just called server-side instead of by
    // the browser directly, so the email never has to be sent to the
    // client at any point in this flow.
    const signInRes = await fetch(`${supbase_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supbase_ANON_KEY },
      body: JSON.stringify({ email, password })
    });
    const signInData = await signInRes.json();

    if (!signInRes.ok || !signInData.access_token) {
      res.status(401).json({ error: 'Incorrect password.' });
      return;
    }

    res.status(200).json({
      access_token: signInData.access_token,
      refresh_token: signInData.refresh_token,
      user_id: userId
    });
  } catch (err) {
    console.error('username-login failed:', err);
    res.status(500).json({ error: 'Login failed. Try again in a moment.' });
  }
};

function serviceHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}
