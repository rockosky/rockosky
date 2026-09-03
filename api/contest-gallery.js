import { createClient } from '@supbase/supbase-js';

const supbase = createClient(
  process.env.supbase_URL,
  process.env.supbase_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.ketchupfiles.com');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const slug = req.query.slug;
  if (!slug) return res.status(400).json({ error: 'Missing slug.' });

  try {
    const { data: contest } = await supbase
      .from('contests')
      .select('id')
      .eq('slug', slug)
      .single();

    if (!contest) return res.status(404).json({ error: 'Contest not found.' });

    const { data, error } = await supbase
      .from('contest_submissions')
      .select('display_name, instagram_handle, caption, image_urls, status')
      .eq('contest_id', contest.id)
      .in('status', ['shortlisted', 'winner'])
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ entries: data });
  } catch (err) {
    console.error('contest-gallery error:', err);
    return res.status(500).json({ error: 'Could not load gallery.' });
  }
}
