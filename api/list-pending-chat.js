// /api/list-pending-chat.js
//
// Companion to approve-chat.js, for the read side of the same problem.
// The admin dashboard's Chat Approvals tab was querying creator_profiles
// straight from the browser using the admin's own logged-in session --
// which IS subject to Row-Level Security. If there's no policy letting
// the admin's account read *other* users' rows (a much less commonly
// granted permission than "read your own row"), that query silently
// returns empty. The tab shows "Nobody waiting for approval" even when
// someone genuinely is -- no error, just nothing to click Approve on.
//
// This endpoint sidesteps that the same way approve-chat.js already
// sidesteps it for the write: service role key, bypasses RLS entirely.
//
// ============================================================
// ONE-TIME SETUP: same SUPBASE_URL / SUPBASE_SERVICE_ROLE_KEY env vars
// already used by every other function -- no new variables needed.
// ============================================================

const SUPABASE_URL = process.env.SUPBASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = "creators@ketchupfiles.com";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!SUPABASE_URL) missingEnvVars.push('SUPBASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  const { adminAccessToken } = req.body || {};
  if (!adminAccessToken) {
    res.status(400).json({ error: 'adminAccessToken is required' });
    return;
  }

  try {
    // Same admin check as approve-chat.js -- verified server-side
    // against the real account, never trusted from the client.
    const callerRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${adminAccessToken}` }
    });
    if (!callerRes.ok) {
      res.status(401).json({ error: 'Not logged in, or session expired.' });
      return;
    }
    const caller = await callerRes.json();
    if (!caller || !caller.email || caller.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      res.status(403).json({ error: 'Only the admin account can view pending chat approvals.' });
      return;
    }

    // The actual read, using the service role key -- bypasses RLS,
    // so this actually sees every pending row, not just the admin's own.
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/creator_profiles?chat_approved=eq.false&select=user_id,display_name,username,chat_approved`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    if (!listRes.ok) {
      const errText = await listRes.text();
      res.status(500).json({ error: 'Database read failed: ' + errText.substring(0, 200) });
      return;
    }

    const rows = await listRes.json();
    res.status(200).json({ ok: true, pending: rows });
  } catch (err) {
    console.error('list-pending-chat failed:', err);
    res.status(500).json({ error: 'Could not load pending approvals. Try again in a moment.' });
  }
};
