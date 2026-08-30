
// /api/jarvis-chat.js
//
// Proxies conversation requests from the Jarvis widgets (the floating
// companion dot, and the full Jarvis Network view in Interfaz Studio) to
// the real Anthropic API. This exists ONLY because a browser cannot call
// api.anthropic.com directly with no key and expect a response -- the key
// has to live somewhere that isn't shipped to every visitor's browser.
// This function holds it as a Vercel environment variable instead.
//
// Deploy this alongside your other /api functions (same project as
// publish-product.js), then set an Anthropic API key as an environment
// variable named ANTHROPIC_API_KEY in the Vercel project settings.
// Get a key at https://console.anthropic.com/settings/keys -- note this
// is a paid API, billed per request, separate from any Claude.ai
// subscription.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Missing Vercel environment variable: ANTHROPIC_API_KEY. Set it in your Vercel project settings, then redeploy.' });
    return;
  }

  const { system, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  // Basic abuse guard: cap message count and total length server-side so
  // this endpoint can't be used as a free, unmetered proxy to the
  // Anthropic API by anyone who finds the URL. Adjust these caps if
  // legitimate conversations are getting cut off.
  const trimmedMessages = messages.slice(-16);
  const totalChars = trimmedMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
  if (totalChars > 20000) {
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
        max_tokens: 600,
        system: typeof system === 'string' ? system : undefined,
        messages: trimmedMessages
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
