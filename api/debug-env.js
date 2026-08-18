// /api/debug-env.js
//
// TEMPORARY diagnostic endpoint. Visit it directly in a browser (GET,
// no body needed) and it reports back exactly what this deployment
// actually sees in its environment variables -- no dashboard digging,
// no guessing. Doesn't expose full secret values, just whether each
// one exists and a short preview of the non-secret one.
//
// DELETE THIS FILE once SUPABASE_URL is confirmed working -- it's
// diagnostic-only, not meant to stay in production long-term.

module.exports = async (req, res) => {
  res.status(200).json({
    SUPABASE_URL_present: !!process.env.SUPABASE_URL,
    SUPABASE_URL_preview: (process.env.SUPABASE_URL || '(not set)').slice(0, 40),
    SUPABASE_SERVICE_ROLE_KEY_present: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SQUARESPACE_API_KEY_present: !!process.env.SQUARESPACE_API_KEY,
    deployment_region: process.env.VERCEL_REGION || '(unknown)',
    deployment_url: process.env.VERCEL_URL || '(unknown)'
  });
};
