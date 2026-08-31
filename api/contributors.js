// vercel-publish-fawn.vercel.app/api/contributors
// GET: list contributors from creator_profiles (for the assignments dashboard)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const { status } = req.query;
    let query = supabase
      .from('creator_profiles')
      .select('user_id, display_name, username, roster_status, contributor_type, roster_city, chat_approved')
      .order('display_name', { ascending: true });

    if (status) query = query.eq('roster_status', status);

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json({ contributors: data });
  } catch (err) {
    console.error('contributors error:', err);
    return res.status(500).json({ error: err.message });
  }
}
