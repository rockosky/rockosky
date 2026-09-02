

const SUPBASE_URL = process.env.SUPBASE_URL || process.env.SUPBASE_URL;
const SUPBASE_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.SUPBASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = "creators@ketchupfiles.com";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!SUPBASE_URL) missingEnvVars.push('SUPBASE_URL');
  if (!SUPBASE_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
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
    const callerRes = await fetch(`${SUPBASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPBASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${adminAccessToken}` }
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
    // location/roster_city included so the admin can see roughly where
    // each pending account is from, not just a name.
    const listRes = await fetch(
      `${SUPBASE_URL}/rest/v1/creator_profiles?chat_approved=eq.false&select=user_id,display_name,username,chat_approved,location,roster_city`,
      {
        headers: {
          apikey: SUPBASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPBASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    if (!listRes.ok) {
      const errText = await listRes.text();
      res.status(500).json({ error: 'Database read failed: ' + errText.substring(0, 200) });
      return;
    }

    const rows = await listRes.json();

    // Email lives on auth.users, not creator_profiles -- a completely
    // separate table -- which is exactly why every pending account was
    // showing up with no way to identify who it actually was. One admin
    // API call per pending row; the list is small (people waiting on
    // approval), so this stays cheap in practice.
    const withEmail = await Promise.all(rows.map(async (row) => {
      try {
        const userRes = await fetch(`${SUPBASE_URL}/auth/v1/admin/users/${row.user_id}`, {
          headers: { apikey: SUPBASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPBASE_SERVICE_ROLE_KEY}` }
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          row.email = userData.email || null;
        }
      } catch (e) { /* non-fatal -- row still shows with whatever profile fields it has */ }
      return row;
    }));

    res.status(200).json({ ok: true, pending: withEmail });
  } catch (err) {
    console.error('list-pending-chat failed:', err);
    res.status(500).json({ error: 'Could not load pending approvals. Try again in a moment.' });
  }
};
