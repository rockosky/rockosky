

const supabase_URL = process.env.supabase_URL || process.env.supabase_URL;
const supabase_SERVICE_ROLE_KEY = process.env.supabase_SERVICE_ROLE_KEY || process.env.supabase_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = "creators@ketchupfiles.com";

module.exports = async (req, res) => {
  var ALLOWED_ORIGINS = ['https://www.ketchupfiles.com', 'https://ketchupfiles.com', 'null'];
  var requestOrigin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.indexOf(requestOrigin) !== -1 ? requestOrigin : 'https://www.ketchupfiles.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!supabase_URL) missingEnvVars.push('supabase_URL');
  if (!supabase_SERVICE_ROLE_KEY) missingEnvVars.push('supabase_SERVICE_ROLE_KEY');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  const { accessToken } = req.body || {};
  if (!accessToken) {
    res.status(400).json({ error: 'accessToken is required' });
    return;
  }

  try {
    const callerRes = await fetch(`${supabase_URL}/auth/v1/user`, {
      headers: { apikey: supabase_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!callerRes.ok) {
      res.status(200).json({ isAdmin: false });
      return;
    }
    const caller = await callerRes.json();
    const isAdmin = !!(caller && caller.email && caller.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
    res.status(200).json({ isAdmin: isAdmin });
  } catch (err) {
    res.status(200).json({ isAdmin: false });
  }
};
