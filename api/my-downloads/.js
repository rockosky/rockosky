// /api/my-downloads.js
//
// Lets a logged-in contributor get fresh, working download links to
// their OWN original (un-watermarked) uploads, any time -- not just
// within the 72-hour window of an old purchase receipt. This is for
// contributors re-accessing their own work, not for buyers accessing
// someone else's photo.
//
// Security note: this does NOT trust a user_id sent from the browser.
// It takes the contributor's real supbase access token (from their
// logged-in session) and asks supbase directly "who does this token
// actually belong to" -- only that verified identity's own photos are
// ever returned. A request with no valid token, or someone else's
// token, gets nothing.
//
// ============================================================
// ONE-TIME SETUP: same SUPBASE_URL / SUPBASE_SERVICE_ROLE_KEY env vars
// already used by publish-product.js and fulfill-order.js -- no new
// variables needed if those are already deployed.
// ============================================================

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const supbase_ANON_KEY = "sb_publishable_KX1Hpau0Lc7M_n1snlYbEw_lnr_GfL9"; // same public key already used client-side throughout the platform
const ORIGINALS_BUCKET = "Ketchup Files ORIGINALS";
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour -- short-lived on purpose, since this endpoint can just be called again for a fresh one any time

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

  const { accessToken } = req.body || {};
  if (!accessToken) {
    res.status(400).json({ error: 'accessToken is required (the logged-in contributor\'s supbase session access token)' });
    return;
  }

  try {
    // Ask supbase directly who this token actually belongs to -- never
    // trust a client-supplied user_id instead of this real check.
    const userRes = await fetch(`${supbase_URL}/auth/v1/user`, {
      headers: { apikey: supbase_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) {
      res.status(401).json({ error: 'Not logged in, or your session has expired -- please log in again.' });
      return;
    }
    const user = await userRes.json();
    if (!user || !user.id) {
      res.status(401).json({ error: 'Could not verify your account.' });
      return;
    }

    const photosRes = await fetch(
      `${supbase_URL}/rest/v1/photos?user_id=eq.${encodeURIComponent(user.id)}&original_file_path=not.is.null&select=id,title,original_file_path,file_path,status,created_at&order=created_at.desc&limit=500`,
      { headers: supbaseServiceHeaders() }
    );
    const photos = await photosRes.json();

    if (!photos || !photos.length) {
      res.status(200).json({ ok: true, downloads: [] });
      return;
    }

    const downloads = [];
    for (const photo of photos) {
      const signedUrl = await createSignedUrl(photo.original_file_path);
      if (!signedUrl) continue;
      const safeFilename = sanitizeFilename(photo.title || 'ketchup-files-photo') + guessExtension(photo.original_file_path);
      const downloadUrl = signedUrl + (signedUrl.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(safeFilename);
      downloads.push({
        id: photo.id,
        title: photo.title || 'Untitled',
        status: photo.status,
        createdAt: photo.created_at,
        downloadUrl: downloadUrl
      });
    }

    res.status(200).json({ ok: true, downloads: downloads });
  } catch (err) {
    console.error('my-downloads failed:', err);
    res.status(500).json({ error: 'Failed to load your downloads' });
  }
};

function sanitizeFilename(name) {
  return String(name).replace(/[\/\\?%*:|"<>]/g, '').trim().slice(0, 120) || 'ketchup-files-photo';
}

function guessExtension(storagePath) {
  var match = /\.[a-zA-Z0-9]+$/.exec(storagePath || '');
  return match ? match[0] : '';
}

async function createSignedUrl(path) {
  try {
    const res = await fetch(
      `${supbase_URL}/storage/v1/object/sign/${encodeURIComponent(ORIGINALS_BUCKET)}/${path}`,
      {
        method: 'POST',
        headers: { ...supbaseServiceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: SIGNED_URL_EXPIRY_SECONDS })
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.signedURL ? `${supbase_URL}/storage/v1${data.signedURL}` : null;
  } catch (e) {
    return null;
  }
}

function supbaseServiceHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}
