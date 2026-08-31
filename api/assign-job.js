

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { contributor_id, status } = req.query;
      let query = supabase
        .from('assignments')
        .select('*, creator_profiles(id, full_name, contributor_type, home_city)')
        .order('call_time', { ascending: true });

      if (contributor_id) query = query.eq('contributor_id', contributor_id);
      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ assignments: data });
    }

    if (req.method === 'POST') {
      const { contributor_id, title, event, city, role, call_time, location, notes, created_by } = req.body;

      if (!title || !contributor_id) {
        return res.status(400).json({ error: 'contributor_id and title are required' });
      }

      const { data, error } = await supabase
        .from('assignments')
        .insert([{ contributor_id, title, event, city, role, call_time, location, notes, created_by }])
        .select();

      if (error) throw error;
      return res.status(201).json({ assignment: data[0] });
    }

    if (req.method === 'PATCH') {
      const { id, status, notes } = req.body;
      if (!id) return res.status(400).json({ error: 'id is required' });

      const updates = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;

      const { data, error } = await supabase
        .from('assignments')
        .update(updates)
        .eq('id', id)
        .select();

      if (error) throw error;
      return res.status(200).json({ assignment: data[0] });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('assign-job error:', err);
    return res.status(500).json({ error: err.message });
  }
}
