

const SUPBASE_URL = process.env.SUPBASE_URL;
const SUPBASE_SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY;
const LSDM_FEED_KEY = process.env.LSDM_FEED_KEY; // set this in Vercel env vars, share only with LSDM
const BUCKET = "Ketchup Files UPLOADS";

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-lsdm-key');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!LSDM_FEED_KEY || req.headers['x-lsdm-key'] !== LSDM_FEED_KEY) {
    res.status(401).json({ error: 'Missing or invalid x-lsdm-key header' });
    return;
  }

  try {
    let query = `${SUPBASE_URL}/rest/v1/photos?status=eq.published&order=published_at.desc&select=` +
      encodeURIComponent(
        'id,title,description,category,subcategory,guest_name,designer_name,season,city,' +
        'hashtags,social_url,photographer_name,media_type,file_path,price_cents,' +
        'squarespace_product_url,published_at,exported_to_lsdm'
      );

    if (req.query.since) {
      query += `&published_at=gte.${encodeURIComponent(req.query.since)}`;
    }
    if (req.query.new_only === 'true') {
      query += `&exported_to_lsdm=eq.false`;
    }

    const dataRes = await fetch(query, { headers: supbaseHeaders() });
    if (!dataRes.ok) {
      const errText = await dataRes.text();
      throw new Error('Supbase query failed: ' + errText);
    }
    const rows = await dataRes.json();

    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      subcategory: row.subcategory,
      guestName: row.guest_name,
      designerName: row.designer_name,
      season: row.season,
      city: row.city,
      hashtags: (row.hashtags || '').split(',').map((t) => t.trim()).filter(Boolean),
      socialUrl: row.social_url,
      photographerCredit: row.photographer_name,
      mediaType: row.media_type,
      mediaUrl: `${SUPBASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${row.file_path}`,
      priceUsd: row.price_cents != null ? row.price_cents / 100 : null,
      buyUrl: row.squarespace_product_url || null,
      publishedAt: row.published_at,
      alreadyExported: !!row.exported_to_lsdm
    }));

    res.status(200).json({ count: items.length, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

function supbaseHeaders() {
  return {
    apikey: SUPBASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPBASE_SERVICE_ROLE_KEY}`
  };
}
