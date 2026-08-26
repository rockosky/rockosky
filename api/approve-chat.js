

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = "creators@ketchupfiles.com";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!supbase_URL) missingEnvVars.push('SUPBASE_URL');
  if (!supbase_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  const { adminAccessToken, targetUserId } = req.body || {};
  if (!adminAccessToken || !targetUserId) {
    res.status(400).json({ error: 'adminAccessToken and targetUserId are required' });
    return;
  }

  try {
    // Verify the caller is genuinely the admin, not just anyone who
    // found this URL -- checked server-side against the real account,
    // not trusted from the client.
    const callerRes = await fetch(`${supbase_URL}/auth/v1/user`, {
      headers: { apikey: supbase_SERVICE_ROLE_KEY, Authorization: `Bearer ${adminAccessToken}` }
    });
    if (!callerRes.ok) {
      res.status(401).json({ error: 'Not logged in, or session expired.' });
      return;
    }
    const caller = await callerRes.json();
    if (!caller || !caller.email || caller.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      res.status(403).json({ error: 'Only the admin account can approve chat access.' });
      return;
    }

    // The actual write, using the service role key -- bypasses RLS
    // entirely, so this always genuinely takes effect.
    const updateRes = await fetch(
      `${supbase_URL}/rest/v1/creator_profiles?user_id=eq.${encodeURIComponent(targetUserId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: supbase_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ chat_approved: true })
      }
    );

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      res.status(500).json({ error: 'Database update failed: ' + errText.substring(0, 200) });
      return;
    }

    const updated = await updateRes.json();
    if (!updated || !updated.length) {
      res.status(404).json({ error: 'No matching account found for that user.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('approve-chat failed:', err);
    res.status(500).json({ error: 'Approval failed. Try again in a moment.' });
  }
};
