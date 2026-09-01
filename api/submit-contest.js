import { createClient } from '@supabase/supabase-js';

export const config = {
  api: { bodyParser: true },
};

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.ketchupfiles.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      contest_slug, display_name, instagram_handle, based_in, caption, image_urls,
    } = req.body || {};

    const contestSlug = String(contest_slug || '').trim();
    const displayName = String(display_name || '').trim();
    const instagram = String(instagram_handle || '').trim().replace(/^@/, '');
    const basedIn = String(based_in || '').trim();

    if (!contestSlug) return res.status(400).json({ error: 'Missing contest.' });
    if (!displayName) return res.status(400).json({ error: 'Name is required.' });
    if (!Array.isArray(image_urls) || image_urls.length === 0) {
      return res.status(400).json({ error: 'At least one image is required.' });
    }

    const { data: contest, error: contestErr } = await supabase
      .from('contests')
      .select('id, active, ends_at')
      .eq('slug', contestSlug)
      .single();

    if (contestErr || !contest || !contest.active) {
      return res.status(400).json({ error: 'This contest is not currently open.' });
    }
    if (contest.ends_at && new Date(contest.ends_at) < new Date()) {
      return res.status(400).json({ error: 'Submissions are closed.' });
    }

    let userId = null;
    if (instagram) {
      const { data: existing } = await supabase
        .from('creator_profiles')
        .select('user_id')
        .eq('instagram_handle', instagram)
        .maybeSingle();
      if (existing) userId = existing.user_id;
    }

    const { data: submission, error: insertErr } = await supabase
      .from('contest_submissions')
      .insert({
        contest_id: contest.id,
        user_id: userId,
        display_name: displayName,
        instagram_handle: instagram,
        based_in: basedIn,
        caption: String(caption || '').trim(),
        image_urls,
        status: 'pending',
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    return res.status(200).json({ success: true, submission_id: submission.id });
  } catch (err) {
    console.error('submit-contest error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
