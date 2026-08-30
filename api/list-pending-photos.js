

const SUPABASE_URL = process.env.SUPBASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = "creators@ketchupfiles.com";
const BUCKET = "Ketchup Files UPLOADS"; // public bucket -- watermarked copies live here

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
    const callerRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${adminAccessToken}` }
    });
    if (!callerRes.ok) {
      res.status(401).json({ error: 'Not logged in, or session expired.' });
      return;
    }
    const caller = await callerRes.json();
    if (!caller || !caller.email || caller.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      res.status(403).json({ error: 'Only the admin account can view pending photos.' });
      return;
    }

    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/photos?status=eq.pending&select=id,title,description,city,season,price_cents,file_path,media_type,hashtags,social_url,user_id,guest_name,photographer_name&order=created_at.asc`,
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
    const pending = await Promise.all(rows.map(async (row) => {
      // Same identity gap as list-pending-chat.js: whoever submitted
      // this had no visible name, email, or way to tell who they are
      // from this list alone. guest_name/photographer_name cover
      // guest-style submissions; email (from auth.users, a separate
      // table from photos) covers registered contributors.
      let email = null;
      if (row.user_id) {
        try {
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${row.user_id}`, {
            headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
          });
          if (userRes.ok) { email = (await userRes.json()).email || null; }
        } catch (e) { /* non-fatal */ }
      }
      return Object.assign({}, row, {
        email: email,
        thumbnailUrl: row.file_path
          ? `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${row.file_path}`
          : null
      });
    }));

    res.status(200).json({ ok: true, pending: pending });
  } catch (err) {
    console.error('list-pending-photos failed:', err);
    res.status(500).json({ error: 'Could not load pending photos. Try again in a moment.' });
  }
};
