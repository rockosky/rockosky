

const nodemailer = require('nodemailer');

const FELIPE_EMAIL = 'felipe@ketchupfiles.com';
const MAX_MESSAGE_LENGTH = 5000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!process.env.SMTP_HOST) missingEnvVars.push('SMTP_HOST');
  if (!process.env.SMTP_USER) missingEnvVars.push('SMTP_USER');
  if (!process.env.SMTP_PASS) missingEnvVars.push('SMTP_PASS');
  if (!process.env.SMTP_FROM) missingEnvVars.push('SMTP_FROM');
  if (missingEnvVars.length) {
    res.status(500).json({ error: `Missing Vercel environment variable(s): ${missingEnvVars.join(', ')}` });
    return;
  }

  const { senderName, senderEmail, message } = req.body || {};

  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
    return;
  }
  // Basic sanity check -- not strict validation, just enough to avoid
  // sending to something that clearly isn't an email address at all.
  const emailLooksValid = typeof senderEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail);
  if (!emailLooksValid) {
    res.status(400).json({ error: 'senderEmail is missing or invalid' });
    return;
  }

  const safeName = (typeof senderName === 'string' && senderName.trim()) ? senderName.trim() : 'Someone';

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: FELIPE_EMAIL,
      replyTo: senderEmail, // hitting Reply goes straight back to them, not through this system
      subject: `Message from ${safeName}`,
      text: message,
      html: `<div style="font-family:Georgia,serif; font-size:15px; color:#333; line-height:1.6; white-space:pre-wrap;">${escapeHtml(message)}</div>
             <p style="font-family:Arial,sans-serif; font-size:12px; color:#999; margin-top:20px;">From ${escapeHtml(safeName)} (${escapeHtml(senderEmail)}) via the simple message page</p>`
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('message-felipe send failed:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
