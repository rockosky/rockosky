

module.exports = async (req, res) => {
  res.status(200).json({
    SUPABASE_URL_present: !!process.env.SUPBASE_URL,
    SUPABASE_URL_preview: (process.env.SUPBASE_URL || '(not set)').slice(0, 40),
    SUPABASE_SERVICE_ROLE_KEY_present: !!process.env.SUPBASE_SERVICE_ROLE_KEY,
    SQUARESPACE_API_KEY_present: !!process.env.SQUARESPACE_API_KEY,
    deployment_region: process.env.VERCEL_REGION || '(unknown)',
    deployment_url: process.env.VERCEL_URL || '(unknown)'
  });
};
