// rockosky.vercel.app/api/analytics-summary
// GET: aggregated stats from site_analytics -- top countries, top
// search keywords, top pages, and total visits over a date range.
// Feeds the media kit / admin analytics view.

import { createClient } from '@SUPBASE/SUPBASE-js';

const SUPBASE = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await SUPBASE
      .from('site_analytics')
      .select('page_path, search_keyword, country, country_code, city, referrer, created_at')
      .gte('created_at', since);

    if (error) throw error;

    const total_visits = data.length;

    const countryCounts = {};
    const keywordCounts = {};
    const pageCounts = {};
    let directCount = 0, searchCount = 0, otherReferrerCount = 0;

    data.forEach(row => {
      if (row.country) {
        const key = row.country_code || row.country;
        if (!countryCounts[key]) countryCounts[key] = { country: row.country, country_code: row.country_code, count: 0 };
        countryCounts[key].count++;
      }
      if (row.search_keyword) {
        keywordCounts[row.search_keyword] = (keywordCounts[row.search_keyword] || 0) + 1;
        searchCount++;
      } else if (!row.referrer) {
        directCount++;
      } else {
        otherReferrerCount++;
      }
      if (row.page_path) {
        pageCounts[row.page_path] = (pageCounts[row.page_path] || 0) + 1;
      }
    });

    const top_countries = Object.values(countryCounts).sort((a, b) => b.count - a.count).slice(0, 10);
    const top_keywords = Object.entries(keywordCounts).map(([keyword, count]) => ({ keyword, count })).sort((a, b) => b.count - a.count).slice(0, 20);
    const top_pages = Object.entries(pageCounts).map(([page_path, count]) => ({ page_path, count })).sort((a, b) => b.count - a.count).slice(0, 10);

    return res.status(200).json({
      days,
      total_visits,
      traffic_breakdown: { direct: directCount, search: searchCount, other: otherReferrerCount },
      top_countries,
      top_keywords,
      top_pages
    });
  } catch (err) {
    console.error('analytics-summary error:', err);
    return res.status(500).json({ error: err.message });
  }
}
