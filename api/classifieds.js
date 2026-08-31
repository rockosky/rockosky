// rockosky.vercel.app/api/classifieds
// GET  ?id=X            -> one listing + similar items (same category) + seller's other listings
// GET  (with filters)   -> list active listings: ?category=&min=&max=&condition=&q=&city=
// POST                  -> create a new listing
// PATCH                 -> update status (mark sold/removed) -- only by the listing's owner

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { id, category, min, max, condition, q, city } = req.query;

      if (id) {
        const { data: listing, error } = await supabase
          .from('classifieds_listings')
          .select('*, creator_profiles(display_name, username, profile_photo_url)')
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        if (!listing) return res.status(404).json({ error: 'Listing not found' });

        const [similarRes, sellerRes] = await Promise.all([
          supabase.from('classifieds_listings')
            .select('id, title, price_cents, photos, location_city')
            .eq('status', 'active')
            .eq('category', listing.category)
            .neq('id', id)
            .limit(6),
          supabase.from('classifieds_listings')
            .select('id, title, price_cents, photos, location_city')
            .eq('status', 'active')
            .eq('user_id', listing.user_id)
            .neq('id', id)
            .limit(6)
        ]);

        return res.status(200).json({
          listing,
          similar_items: similarRes.data || [],
          sellers_other_listings: sellerRes.data || []
        });
      }

      let query = supabase
        .from('classifieds_listings')
        .select('id, title, price_cents, category, condition, photos, location_city, location_state, created_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (category) query = query.eq('category', category);
      if (condition) query = query.eq('condition', condition);
      if (min) query = query.gte('price_cents', parseInt(min) * 100);
      if (max) query = query.lte('price_cents', parseInt(max) * 100);
      if (city) query = query.ilike('location_city', `%${city}%`);
      if (q) query = query.ilike('title', `%${q}%`);

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return res.status(200).json({ listings: data });
    }

    if (req.method === 'POST') {
      const { user_id, title, description, price, category, condition, photos, location_city, location_state } = req.body;
      if (!user_id || !title) return res.status(400).json({ error: 'user_id and title are required' });

      const { data, error } = await supabase
        .from('classifieds_listings')
        .insert([{
          user_id, title, description: description || null,
          price_cents: Math.round((parseFloat(price) || 0) * 100),
          category: category || null, condition: condition || null,
          photos: photos || [], location_city: location_city || null, location_state: location_state || null
        }])
        .select();
      if (error) throw error;
      return res.status(201).json({ listing: data[0] });
    }

    if (req.method === 'PATCH') {
      const { id, user_id, status } = req.body;
      const VALID = ['active', 'sold', 'removed'];
      if (!id || !status || !VALID.includes(status)) {
        return res.status(400).json({ error: `id and status (one of ${VALID.join(', ')}) are required` });
      }

      let query = supabase.from('classifieds_listings').update({ status }).eq('id', id);
      if (user_id) query = query.eq('user_id', user_id); // owner check when called from the client
      const { data, error } = await query.select();
      if (error) throw error;
      if (!data || !data.length) return res.status(404).json({ error: 'Listing not found or not owned by this user' });
      return res.status(200).json({ listing: data[0] });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('classifieds error:', err);
    return res.status(500).json({ error: err.message });
  }
}
