// rockosky.vercel.app/api/guest-directory
// GET: list distinct guests/designers from published photos, with
// counts and a sample thumbnail (?list=1), OR fetch every published
// photo for one named guest/designer (?name=...) for a landing page.

import { createClient } from '@supabase/supabase-js';

const BUCKET = "Ketchup Files UPLOADS";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const missing = [];
    if (!process.env.SUPBASE_URL) missing.push('SUPBASE_URL');
    if (!process.env.SUPBASE_SERVICE_ROLE_KEY) missing.push('SUPBASE_SERVICE_ROLE_KEY');
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variable(s): ${missing.join(', ')}` });
    }
    const supabase = createClient(process.env.SUPBASE_URL, process.env.SUPBASE_SERVICE_ROLE_KEY);

    const { name } = req.query;

    if (name) {
      // Single guest/designer's page: every published photo they appear in
      const { data, error } = await supabase
        .from('photos')
        .select('file_path, title, description, city, season, photographer_name, guest_name, designer_name, media_type, created_at')
        .in('status', ['approved', 'published'])
        .or(`guest_name.ilike.%${name}%,designer_name.ilike.%${name}%`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const photos = (data || []).map(p => ({
        ...p,
        url: supabase.storage.from(BUCKET).getPublicUrl(p.file_path).data.publicUrl
      }));

      return res.status(200).json({ name, photos, photo_count: photos.length });
    }

    // Directory mode: every distinct name that appears, with counts
    const { data, error } = await supabase
      .from('photos')
      .select('file_path, guest_name, designer_name, city, season')
      .in('status', ['approved', 'published']);

    if (error) throw error;

    const namesMap = {};
    (data || []).forEach(p => {
      [p.guest_name, p.designer_name].filter(Boolean).forEach(n => {
        if (!namesMap[n]) namesMap[n] = { name: n, count: 0, sample_path: p.file_path };
        namesMap[n].count++;
      });
    });

    const directory = Object.values(namesMap)
      .map(n => ({ ...n, sample_url: supabase.storage.from(BUCKET).getPublicUrl(n.sample_path).data.publicUrl }))
      .sort((a, b) => b.count - a.count);

    return res.status(200).json({ directory });
  } catch (err) {
    console.error('guest-directory error:', err);
    return res.status(500).json({ error: err.message });
  }
}
