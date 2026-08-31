

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { status } = req.query;
      let query = supabase
        .from('job_postings')
        .select('*, job_claims(contributor_id, status)')
        .order('created_at', { ascending: false });

      if (status) query = query.eq('status', status);
      else query = query.eq('status', 'open'); // default: only show open jobs

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ jobs: data });
    }

    if (req.method === 'POST') {
      const { title, description, event, city, role_needed, spots_available, call_time, location, pay_notes, posted_by } = req.body;

      if (!title) return res.status(400).json({ error: 'title is required' });

      const { data, error } = await supabase
        .from('job_postings')
        .insert([{ title, description, event, city, role_needed, spots_available, call_time, location, pay_notes, posted_by }])
        .select();

      if (error) throw error;
      return res.status(201).json({ job: data[0] });
    }

    if (req.method === 'PATCH') {
      const { action } = req.query;

      // A contributor claiming/applying to a job
      if (action === 'claim') {
        const { job_id, contributor_id } = req.body;
        if (!job_id || !contributor_id) {
          return res.status(400).json({ error: 'job_id and contributor_id are required' });
        }
        const { data, error } = await supabase
          .from('job_claims')
          .insert([{ job_id, contributor_id }])
          .select();
        if (error) throw error;
        return res.status(201).json({ claim: data[0] });
      }

      // Admin updating a posting's status (e.g. mark filled/closed)
      const { id, status } = req.body;
      if (!id) return res.status(400).json({ error: 'id is required' });

      const { data, error } = await supabase
        .from('job_postings')
        .update({ status })
        .eq('id', id)
        .select();

      if (error) throw error;
      return res.status(200).json({ job: data[0] });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('job-postings error:', err);
    return res.status(500).json({ error: err.message });
  }
}
