// rockosky.vercel.app/api/geo-pricing
// GET: resolve the visitor's IP (or an explicit ?country= override) to
// a currency, price multiplier, and licensing tier from pricing_regions.

import { createClient } from '@supabase/supabase-js';

const DEFAULT_REGION = { country_code: 'US', country_name: 'United States', currency_code: 'USD', currency_symbol: '$', price_multiplier: 1.0, licensing_tier: 'standard' };

async function lookupCountryFromIp(ip) {
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return null;
  try {
    const res = await fetch(`https://ipwho.is/${ip}`);
    const data = await res.json();
    return data.success ? data.country_code : null;
  } catch (err) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const missing = [];
    if (!process.env.SUPBASE_URL) missing.push('SUPBASE_URL');
    if (!process.env.SUPBASE_SERVICE_ROLE_KEY) missing.push('SUPBASE_SERVICE_ROLE_KEY');
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variable(s): ${missing.join(', ')}` });
    }
    const supabase = createClient(process.env.SUPBASE_URL, process.env.SUPBASE_SERVICE_ROLE_KEY);

    let countryCode = req.query.country;

    if (!countryCode) {
      const forwardedFor = req.headers['x-forwarded-for'];
      const ip = (forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket?.remoteAddress) || null;
      countryCode = await lookupCountryFromIp(ip);
    }

    if (!countryCode) return res.status(200).json(DEFAULT_REGION);

    const { data, error } = await supabase
      .from('pricing_regions')
      .select('*')
      .eq('country_code', countryCode.toUpperCase())
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json(data || { ...DEFAULT_REGION, country_code: countryCode.toUpperCase() });
  } catch (err) {
    console.error('geo-pricing error:', err);
    return res.status(200).json(DEFAULT_REGION); // never break pricing display on error
  }
}
