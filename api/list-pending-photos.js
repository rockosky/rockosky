// /api/list-pending-photos.js
//
// Lists photos with status='pending' for the retro chat's ADMIN tab.
// Same reasoning as list-pending-chat.js: rather than querying `photos`
// straight from the browser (which depends on whatever RLS policy is
// or isn't configured for the signed-in account), this goes through
// the service role key server-side so it reliably sees every pending
// row regardless of RLS, and verifies the caller is genuinely the
// admin account first.
//
// ============================================================
// ONE-TIME SETUP: same SUPBASE_URL / SUPBASE_SERVICE_ROLE_KEY env vars
// already used by every other function -- no new variables needed.
// ============================================================

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
      `${SUPABASE_URL}/rest/v1/photos?status=eq.pending&select=id,title,description,city,season,price_cents,file_path,media_type,hashtags,social_url&order=created_at.asc`,
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
    const pending = rows.map(function (row) {
      return Object.assign({}, row, {
        thumbnailUrl: row.file_path
          ? `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${row.file_path}`
          : null
      });
    });

    res.status(200).json({ ok: true, pending: pending });
  } catch (err) {
    console.error('list-pending-photos failed:', err);
    res.status(500).json({ error: 'Could not load pending photos. Try again in a moment.' });
  }
};
