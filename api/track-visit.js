// rockosky.vercel.app/api/track-visit
// POST: log a page visit -- captures the visitor's IP, resolves it to
// a country/city via a free geolocation lookup, and parses a search
// keyword out of the referrer when the visit came from a search
// engine result (Google, Bing, DuckDuckGo, Yahoo).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

// Pulls the ?q= (or ?p=) search term out of a search engine's referrer
// URL. Returns null for anything else (direct traffic, social, etc).
function extractSearchKeyword(referrer) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    const host = url.hostname.replace(/^www\./, '');
    const params = url.searchParams;

    if (host.includes('google.')) return params.get('q');
    if (host.includes('bing.')) return params.get('q');
    if (host.includes('duckduckgo.')) return params.get('q');
    if (host.includes('search.yahoo.')) return params.get('p');
    return null;
  } catch (err) {
    return null;
  }
}

async function lookupIp(ip) {
  // ipwho.is -- free, no API key, HTTPS. Skips lookup for local/
  // private IPs (dev environments, proxies without a real client IP).
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return {};
  }
  try {
    const res = await fetch(`https://ipwho.is/${ip}`);
    const data = await res.json();
    if (!data.success) return {};
    return {
      country: data.country || null,
      country_code: data.country_code || null,
      region: data.region || null,
      city: data.city || null
    };
  } catch (err) {
    return {}; // non-fatal -- still log the visit without geo data
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { page_path, referrer, user_agent } = req.body;

    // Vercel puts the real client IP in x-forwarded-for (first entry
    // when there are multiple proxies in the chain).
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = (forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket?.remoteAddress) || null;

    const geo = await lookupIp(ip);
    const search_keyword = extractSearchKeyword(referrer);

    const { error } = await supabase.from('site_analytics').insert({
      page_path: page_path || null,
      referrer: referrer || null,
      search_keyword,
      ip_address: ip,
      country: geo.country || null,
      country_code: geo.country_code || null,
      region: geo.region || null,
      city: geo.city || null,
      user_agent: user_agent || null
    });

    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('track-visit error:', err);
    // Never let tracking failures be visible/disruptive to the visitor
    return res.status(200).json({ ok: false });
  }
}
