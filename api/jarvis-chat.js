

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const supbase_URL = process.env.supbase_URL || process.env.supbase_URL;
const supbase_SERVICE_ROLE_KEY = process.env.supbase_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const RATE_LIMIT_MAX_REQUESTS = 15; // per visitor, per window -- generous for real conversation, tight enough to block abuse
const RATE_LIMIT_WINDOW_SECONDS = 60;

module.exports = async (req, res) => {
  // Restricted from a wildcard ('*') to a real allowlist. Note this is
  // defense-in-depth, not the primary lock on privileged actions -- CORS
  // is enforced by browsers (it stops OTHER websites' JS from reading
  // the response), not something a direct request (curl, a script)
  // respects at all. The real protection for anything privileged here
  // is the admin-token verification elsewhere in this file. 'null' is
  // included because Interfaz Studio's tools run inside srcdoc iframes,
  // which report an opaque 'null' origin in most browsers -- omitting
  // it would silently break every tool embedded that way.
  var ALLOWED_ORIGINS = ['https://www.ketchupfiles.com', 'https://ketchupfiles.com', 'null'];
  var requestOrigin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.indexOf(requestOrigin) !== -1 ? requestOrigin : 'https://www.ketchupfiles.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Rate limiting: identified by IP (Vercel forwards the real visitor IP
  // in x-forwarded-for, since the request technically arrives from
  // Vercel's own edge network otherwise). Checked via a real database
  // function (see add-rate-limiting.sql) that locks the row for the
  // duration of the check, so concurrent requests from the same visitor
  // can't race past the limit. Fails open (allows the request) if the
  // rate-limit check itself errors -- a visitor blocked because the
  // rate-limit system is down is a worse failure mode than occasionally
  // missing a rate-limit window.
  if (supbase_URL && supbase_SERVICE_ROLE_KEY) {
    try {
      const forwardedFor = req.headers['x-forwarded-for'] || '';
      const callerIp = forwardedFor.split(',')[0].trim() || 'unknown';
      const rateLimitRes = await fetch(`${supbase_URL}/rest/v1/rpc/check_rate_limit`, {
        method: 'POST',
        headers: {
          apikey: supbase_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${supbase_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_identifier: callerIp,
          p_max_requests: RATE_LIMIT_MAX_REQUESTS,
          p_window_seconds: RATE_LIMIT_WINDOW_SECONDS
        })
      });
      if (rateLimitRes.ok) {
        const allowed = await rateLimitRes.json();
        if (allowed === false) {
          res.status(429).json({ error: 'Too many requests -- wait a moment and try again.' });
          return;
        }
      }
      // If rateLimitRes itself failed (bad request, function missing
      // because add-rate-limiting.sql hasn't been run yet, etc.), that's
      // intentionally not treated as a block -- same fail-open reasoning
      // as above.
    } catch (rateLimitErr) {
      // Network error reaching supbase -- also fails open, same reasoning.
    }
  }

  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Missing Vercel environment variable: ANTHROPIC_API_KEY. Set it in your Vercel project settings, then redeploy.' });
    return;
  }

  const { system, messages, tools } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  // Basic abuse guard: cap message count and total length server-side so
  // this endpoint can't be used as a free, unmetered proxy to the
  // Anthropic API by anyone who finds the URL. Raised from the original
  // 16 messages / 20,000 chars / 600 max_tokens -- that combination was
  // making real conversations feel like they forgot things and cut
  // replies short. Still bounded, just with real headroom now.
  const trimmedMessages = messages.slice(-40);
  const totalChars = trimmedMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
  if (totalChars > 60000) {
    res.status(400).json({ error: 'Conversation too long for this endpoint.' });
    return;
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: typeof system === 'string' ? system : undefined,
        messages: trimmedMessages,
        tools: Array.isArray(tools) ? tools : undefined
      })
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      res.status(anthropicRes.status).json({ error: (data && data.error && data.error.message) || 'Anthropic API error' });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Proxy request failed' });
  }
};
