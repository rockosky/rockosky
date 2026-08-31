// rockosky.vercel.app/api/contributors
// GET: list contributors from creator_profiles, each with a few recent
// approved/published photos so the assignments dashboard can show a
// real portfolio thumbnail strip instead of a bare name list.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

const BUCKET = "Ketchup Files UPLOADS";
const THUMBS_PER_CONTRIBUTOR = 4;

export default async function handler(req, res) {
  try {
    if (req.method === 'PATCH') {
      const { user_id, roster_status } = req.body;
      const VALID_STATUSES = ['pending', 'active', 'inactive', 'alumni'];

      if (!user_id || !roster_status) {
        return res.status(400).json({ error: 'user_id and roster_status are required' });
      }
      if (!VALID_STATUSES.includes(roster_status)) {
        return res.status(400).json({ error: `roster_status must be one of: ${VALID_STATUSES.join(', ')}` });
      }

      const { data, error } = await supabase
        .from('creator_profiles')
        .update({ roster_status })
        .eq('user_id', user_id)
        .select();

      if (error) throw error;
      if (!data || !data.length) return res.status(404).json({ error: 'Contributor not found' });
      return res.status(200).json({ contributor: data[0] });
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET', 'PATCH']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    const { status } = req.query;
    let query = supabase
      .from('creator_profiles')
      .select('user_id, display_name, username, roster_status, contributor_type, roster_city, chat_approved, profile_photo_url')
      .order('display_name', { ascending: true });

    if (status) query = query.eq('roster_status', status);

    const { data: contributors, error } = await query;
    if (error) throw error;

    const userIds = contributors.map(c => c.user_id).filter(Boolean);
    let photosByUser = {};

    if (userIds.length) {
      const { data: photos, error: photosError } = await supabase
        .from('photos')
        .select('user_id, file_path, title, media_type, created_at')
        .in('user_id', userIds)
        .in('status', ['approved', 'published'])
        .order('created_at', { ascending: false });

      if (photosError) throw photosError;

      (photos || []).forEach(p => {
        if (!photosByUser[p.user_id]) photosByUser[p.user_id] = [];
        if (photosByUser[p.user_id].length >= THUMBS_PER_CONTRIBUTOR) return;
        const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(p.file_path).data.publicUrl;
        photosByUser[p.user_id].push({ url: publicUrl, title: p.title, media_type: p.media_type });
      });
    }

    const enriched = contributors.map(c => ({
      ...c,
      photos: photosByUser[c.user_id] || [],
      photo_count: (photosByUser[c.user_id] || []).length
    }));

    return res.status(200).json({ contributors: enriched });
  } catch (err) {
    console.error('contributors error:', err);
    return res.status(500).json({ error: err.message });
  }
}
