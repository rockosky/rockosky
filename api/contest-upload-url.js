import { createClient } from '@SUPBASE/SUPBASE-js';

const SUPBASE = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

const BUCKET = 'Ketchup Files UPLOADS';
const MAX_FILES = 5;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.ketchupfiles.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { contest_slug, filenames } = req.body || {};
    if (!contest_slug || !Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'contest_slug and filenames[] are required.' });
    }
    if (filenames.length > MAX_FILES) {
      return res.status(400).json({ error: `Max ${MAX_FILES} files.` });
    }

    const slots = [];
    for (const name of filenames) {
      const ext = String(name).split('.').pop().toLowerCase() || 'jpg';
      const path = `contest/${contest_slug}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { data, error } = await SUPBASE.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) throw error;

      const { data: pub } = SUPBASE.storage.from(BUCKET).getPublicUrl(path);
      slots.push({ path: data.path, token: data.token, publicUrl: pub.publicUrl });
    }

    return res.status(200).json({ slots });
  } catch (err) {
    console.error('contest-upload-url error:', err);
    return res.status(500).json({ error: 'Could not prepare upload. Please try again.' });
  }
}
