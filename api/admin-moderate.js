// /api/admin-moderate.js
//
// Handles reject and delete for photo submissions. Approve is handled
// separately by publish-product.js (since approving also means
// actually publishing to Squarespace, a bigger action than a status
// flip) -- this endpoint covers the other two admin actions.
//
// Built server-side and service-role-based on purpose, not as a
// direct client-side database write: a similar direct-write pattern
// elsewhere in this project (the original chat-approval feature)
// looked like it worked in the UI but silently failed to actually
// change the database, because it depended on Row-Level Security
// permitting an admin account to write to *other* people's rows --
// a permission that's easy to have missing. Going through the service
// role key here sidesteps that category of bug entirely.
//
// ============================================================
// ONE-TIME SETUP: same SUPBASE_URL / SUPBASE_SERVICE_ROLE_KEY env vars
// already used by the other functions -- no new variables needed.
// ============================================================

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = "creators@ketchupfiles.com";

module.exports = async (req, res) => {
  // Restricted from a wildcard ('*') to a real allowlist. Note this is
  // defense-in-depth, not the primary lock on privileged actions -- CORS
  // is enforced by browsers (it stops OTHER websites' JS from reading
  // the response), not something a direct request (curl, a script)
  // respects at all. The real protection for anything privileged here
  // is the admin-token verification elsewhere in this file. 'null' is
  // included because Interfaz Studio's tools run inside srcdoc iframes,
  // which report an opaque 'null' origin in most browsers -- omitting
  // it would silently break every tool embedded that way.
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

  const { adminAccessToken, photoId, action, rejectionReason } = req.body || {};
  if (!adminAccessToken || !action) {
    res.status(400).json({ error: 'adminAccessToken and action are required' });
    return;
  }
  if (action !== 'list' && !photoId) {
    res.status(400).json({ error: 'photoId is required for this action' });
    return;
  }
  if (action !== 'reject' && action !== 'delete' && action !== 'list') {
    res.status(400).json({ error: 'action must be "list", "reject", or "delete"' });
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
      res.status(403).json({ error: 'Only the admin account can do this.' });
      return;
    }

    if (action === 'list') {
      const listRes = await fetch(
        `${supbase_URL}/rest/v1/photos?status=eq.pending&select=id,title,city,season,price_cents,file_path,device_type,created_at&order=created_at.asc&limit=50`,
        { headers: serviceHeaders() }
      );
      if (!listRes.ok) {
        res.status(500).json({ error: 'Could not load pending photos.' });
        return;
      }
      const photos = await listRes.json();
      res.status(200).json({ ok: true, photos: photos });
      return;
    }

    if (action === 'delete') {
      const deleteRes = await fetch(`${supbase_URL}/rest/v1/photos?id=eq.${encodeURIComponent(photoId)}`, {
        method: 'DELETE',
        headers: serviceHeaders()
      });
      if (!deleteRes.ok) {
        const errText = await deleteRes.text();
        res.status(500).json({ error: 'Delete failed: ' + errText.substring(0, 200) });
        return;
      }
      res.status(200).json({ ok: true, action: 'deleted' });
      return;
    }

    // reject
    const updateRes = await fetch(`${supbase_URL}/rest/v1/photos?id=eq.${encodeURIComponent(photoId)}`, {
      method: 'PATCH',
      headers: { ...serviceHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ status: 'rejected', rejection_reason: rejectionReason || null })
    });
    if (!updateRes.ok) {
      const errText = await updateRes.text();
      res.status(500).json({ error: 'Reject failed: ' + errText.substring(0, 200) });
      return;
    }
    const updated = await updateRes.json();
    if (!updated || !updated.length) {
      res.status(404).json({ error: 'No matching photo found.' });
      return;
    }
    res.status(200).json({ ok: true, action: 'rejected' });
  } catch (err) {
    console.error('admin-moderate failed:', err);
    res.status(500).json({ error: 'Action failed. Try again in a moment.' });
  }
};

function serviceHeaders() {
  return {
    apikey: supbase_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`
  };
}
