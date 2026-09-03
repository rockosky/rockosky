// rockosky.vercel.app/api/media-kit-request
// POST: capture a brand/agency lead from the Media Kit page's form,
// and email a notification to the admin inbox (plus a short auto-reply
// to whoever submitted it).
//
// IMPORTANT: this uses env vars SMTP_HOST / SMTP_PORT / SMTP_USER /
// SMTP_PASS / ADMIN_NOTIFICATION_EMAIL, which is the common nodemailer
// pattern -- but if fulfill-order.js already sends email under
// DIFFERENT env var names, swap the names in createTransport() below
// to match exactly, so this reuses the same working SMTP credentials
// instead of needing a second set configured.

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.supabase_URL,
  process.env.supabase_SERVICE_ROLE_KEY
);

const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'creators@ketchupfiles.com';

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    // Without these, a missing/wrong SMTP_HOST just hangs the whole
    // connection attempt for a long time (sometimes past Vercel's
    // function timeout), which is what left the media kit form stuck
    // on "Sending…" -- fail fast instead so email errors don't block
    // the response back to the browser.
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { contact_name, company, email, message } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const { error } = await supabase.from('media_kit_requests').insert({
      contact_name: contact_name || null,
      company: company || null,
      email,
      message: message || null
    });
    if (error) throw error;

    // Email sending is best-effort -- if SMTP isn't configured or
    // fails, the request is still saved in Supabase either way, so
    // nothing gets lost even if this part breaks.
    try {
      const transport = getTransport();

      await transport.sendMail({
        from: `"Ketchup Files" <${process.env.SMTP_USER}>`,
        to: ADMIN_EMAIL,
        replyTo: email,
        subject: `New Media Kit Request${company ? ' — ' + company : ''}`,
        text: [
          `Name: ${contact_name || '(not given)'}`,
          `Company: ${company || '(not given)'}`,
          `Email: ${email}`,
          '',
          'Message:',
          message || '(no message)'
        ].join('\n')
      });

      await transport.sendMail({
        from: `"Ketchup Files" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Thanks for reaching out — Ketchup Files',
        text: `Hi ${contact_name || 'there'},\n\nThanks for your interest in Ketchup Files. We received your request and will follow up shortly with our media kit and rate card.\n\n— Ketchup Files`
      });
    } catch (emailErr) {
      console.error('media-kit-request email error (non-fatal):', emailErr);
    }

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('media-kit-request error:', err);
    return res.status(500).json({ error: err.message });
  }
}
