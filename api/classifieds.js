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
      const { id, category, min, max, condition, q, city, status, seller, sellers } = req.query;

      if (sellers) {
        const { data, error } = await supabase
          .from('classifieds_sellers')
          .select('user_id, display_name, store_name, email, stripe_account_id, has_payment_method, created_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json({ sellers: data || [] });
      }


      if (seller) {
        const [sellerRes, listingsRes] = await Promise.all([
          supabase.from('classifieds_sellers').select('*').eq('user_id', seller).maybeSingle(),
          supabase.from('classifieds_listings')
            .select('id, title, price_cents, category, condition, photos, location_city, location_state, created_at')
            .eq('user_id', seller)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
        ]);
        if (sellerRes.error) throw sellerRes.error;
        if (!sellerRes.data) return res.status(404).json({ error: 'Seller not found' });
        return res.status(200).json({ seller: sellerRes.data, listings: listingsRes.data || [] });
      }

      if (id) {
        const { data: listing, error } = await supabase
          .from('classifieds_listings')
          .select('*, classifieds_sellers(display_name, email, phone)')
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
        .select('id, user_id, title, price_cents, category, condition, photos, location_city, location_state, created_at, status, classifieds_sellers(display_name, email)')
        .eq('status', status || 'active')
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
          photos: photos || [], location_city: location_city || null, location_state: location_state || null,
          status: 'pending'
        }])
        .select();
      if (error) throw error;
      return res.status(201).json({ listing: data[0] });
    }

    if (req.method === 'PATCH') {
      const { id, user_id, status, title, description } = req.body;
      const VALID = ['pending', 'active', 'sold', 'removed', 'rejected'];
      if (!id) return res.status(400).json({ error: 'id is required' });
      if (status && !VALID.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });
      }
      if (!status && title === undefined && description === undefined) {
        return res.status(400).json({ error: 'provide status, title, and/or description to update' });
      }

      const updates = {};
      if (status !== undefined) updates.status = status;
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;

      let query = supabase.from('classifieds_listings').update(updates).eq('id', id);
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
