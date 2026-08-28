// /api/is-admin.js
//
// Answers exactly one question -- "is this access token the real admin
// account?" -- without ever sending the admin's actual email back to
// the client. The retro chat's username-based login deliberately never
// exposes a user's email client-side (that's the whole point of
// resolving username -> email server-side in username-login.js), so
// the client genuinely has no way to check "am I admin?" on its own.
// This is that check, done safely.
//
// ============================================================
// ONE-TIME SETUP: same SUPBASE_URL / SUPBASE_SERVICE_ROLE_KEY env vars
// already used by the other functions -- no new variables needed.
// ============================================================

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
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
  if (!supbase_URL) missingEnvVars.push('SUPBASE_URL');
  if (!supbase_SERVICE_ROLE_KEY) missingEnvVars.push('SUPBASE_SERVICE_ROLE_KEY');
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
    const callerRes = await fetch(`${supbase_URL}/auth/v1/user`, {
      headers: { apikey: supbase_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` }
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
