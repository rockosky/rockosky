// api/submit-contest.js
// Drop into the ketchup-files-api Vercel project (same one that serves
// publish-product.js / fulfill-order.js at rockosky.vercel.app).
//
// Add to package.json dependencies: "formidable": "^3.5.1"
// (Remember the earlier gotcha: the manifest file MUST be named
// package.json, not package.js, or the deploy silently breaks.)
//
// Uses the existing env vars SUPBASE_URL / SUPBASE_SERVICE_ROLE_KEY
// (the "no A" typo-turned-convention — keep it, don't "fix" it).

import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: { bodyParser: false },
};

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

const BUCKET = 'Ketchup Files UPLOADS';
const MAX_IMAGES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB per image

export default async function handler(req, res) {
  // Basic CORS so the Squarespace page (a different origin) can call this.
  res.setHeader('Access-Control-Allow-Origin', 'https://www.ketchupfiles.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = formidable({
      multiples: true,
      maxFiles: MAX_IMAGES,
      maxFileSize: MAX_FILE_BYTES,
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const contestSlug = String(fields.contest_slug || 'street-style-50');
    const displayName = String(fields.display_name || '').trim();
    const instagram = String(fields.instagram_handle || '').trim().replace(/^@/, '');
    const state = String(fields.roster_state || '').trim();
    const city = String(fields.roster_city || '').trim();
    const caption = String(fields.caption || '').trim();

    if (!displayName || !state) {
      return res.status(400).json({ error: 'Name and state are required.' });
    }

    // Confirm the contest is real, active, and still open
    const { data: contest, error: contestErr } = await supabase
      .from('contests')
      .select('id, active, ends_at')
      .eq('slug', contestSlug)
      .single();

    if (contestErr || !contest || !contest.active) {
      return res.status(400).json({ error: 'This contest is not currently open.' });
    }
    if (contest.ends_at && new Date(contest.ends_at) < new Date()) {
      return res.status(400).json({ error: 'Submissions are closed.' });
    }

    // Normalize the file input into an array, cap at MAX_IMAGES
    let uploaded = files.images;
    if (!uploaded) {
      return res.status(400).json({ error: 'At least one image is required.' });
    }
    if (!Array.isArray(uploaded)) uploaded = [uploaded];
    uploaded = uploaded.slice(0, MAX_IMAGES);

    const imageUrls = [];
    for (const file of uploaded) {
      const buffer = fs.readFileSync(file.filepath);
      const ext = (file.originalFilename || 'jpg').split('.').pop().toLowerCase();
      const path = `contest/${contestSlug}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: file.mimetype || 'image/jpeg' });

      if (uploadErr) throw uploadErr;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      imageUrls.push(pub.publicUrl);
    }

    // If this Instagram handle matches an existing contributor, link the
    // submission to their profile so a win can flow into roster status.
    let userId = null;
    if (instagram) {
      const { data: existing } = await supabase
        .from('creator_profiles')
        .select('user_id')
        .eq('instagram_handle', instagram)
        .maybeSingle();
      if (existing) userId = existing.user_id;
    }

    const { data: submission, error: insertErr } = await supabase
      .from('contest_submissions')
      .insert({
        contest_id: contest.id,
        user_id: userId,
        display_name: displayName,
        instagram_handle: instagram,
        roster_state: state,
        roster_city: city,
        caption,
        image_urls: imageUrls,
        status: 'pending',
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    return res.status(200).json({ success: true, submission_id: submission.id });
  } catch (err) {
    console.error('submit-contest error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
