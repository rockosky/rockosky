

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = "creators@ketchupfiles.com";
const BUCKET = "Ketchup Files UPLOADS"; // public bucket -- watermarked copies live here

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

  const { adminAccessToken } = req.body || {};
  if (!adminAccessToken) {
    res.status(400).json({ error: 'adminAccessToken is required' });
    return;
  }

  try {
    const callerRes = await fetch(`${supbase_URL}/auth/v1/user`, {
      headers: { apikey: supbase_SERVICE_ROLE_KEY, Authorization: `Bearer ${adminAccessToken}` }
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
      `${supbase_URL}/rest/v1/photos?status=eq.pending&select=id,title,description,city,season,price_cents,file_path,media_type,hashtags,social_url&order=created_at.asc`,
      {
        headers: {
          apikey: supbase_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
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
          ? `${supbase_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${row.file_path}`
          : null
      });
    });

    res.status(200).json({ ok: true, pending: pending });
  } catch (err) {
    console.error('list-pending-photos failed:', err);
    res.status(500).json({ error: 'Could not load pending photos. Try again in a moment.' });
  }
};
