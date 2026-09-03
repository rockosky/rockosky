import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.supabase_URL,
  process.env.supabase_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.ketchupfiles.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.CONTEST_ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('contest_submissions')
        .select('id, contest_id, display_name, instagram_handle, based_in, caption, image_urls, status, submitted_at, contests(name, city, slug)')
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ submissions: data });
    } catch (err) {
      console.error('contest-review GET error:', err);
      return res.status(500).json({ error: 'Could not load submissions.' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { submission_id, status } = req.body || {};
      if (!['pending', 'shortlisted', 'winner', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
      }
      if (!submission_id) return res.status(400).json({ error: 'Missing submission_id.' });

      const { error } = await supabase
        .from('contest_submissions')
        .update({ status })
        .eq('id', submission_id);
      if (error) throw error;

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('contest-review POST error:', err);
      return res.status(500).json({ error: 'Update failed.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
