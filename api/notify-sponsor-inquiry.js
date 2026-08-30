

const nodemailer = require('nodemailer');

const SPONSOR_NOTIFY_RECIPIENT = process.env.SPONSOR_NOTIFY_RECIPIENT;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missingEnvVars = [];
  if (!SPONSOR_NOTIFY_RECIPIENT) missingEnvVars.push('SPONSOR_NOTIFY_RECIPIENT');
  if (!process.env.SMTP_HOST) missingEnvVars.push('SMTP_HOST');
  if (!process.env.SMTP_USER) missingEnvVars.push('SMTP_USER');
  if (!process.env.SMTP_PASS) missingEnvVars.push('SMTP_PASS');
  if (!process.env.SMTP_FROM) missingEnvVars.push('SMTP_FROM');
  if (missingEnvVars.length) {
    // Deliberately still 200 here -- the inquiry itself already saved
    // successfully before this was ever called; a missing env var
    // shouldn't look like the person's submission failed.
    console.error(`notify-sponsor-inquiry: missing env var(s): ${missingEnvVars.join(', ')}`);
    res.status(200).json({ ok: false, notified: false });
    return;
  }

  try {
    const { company_name, contact_name, email, tier_interest } = req.body || {};

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const html = `
<!DOCTYPE html>
<html><body style="margin:0; padding:0; background:#ffffff; font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; border:2px solid #16140f;">
        <tr><td style="background:#16140f; padding:16px 24px;">
          <div style="font-family:Arial,sans-serif; font-weight:bold; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#ffffff;">New Sponsor Inquiry</div>
        </tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 10px; font-size:14px; color:#16140f;"><strong>${escapeHtml(company_name || 'Unknown company')}</strong></p>
          <p style="margin:0 0 4px; font-size:13px; color:#4a463c;">Contact: ${escapeHtml(contact_name || '')}</p>
          <p style="margin:0 0 4px; font-size:13px; color:#4a463c;">Email: ${escapeHtml(email || '')}</p>
          <p style="margin:0 0 16px; font-size:13px; color:#4a463c;">Interested in: ${escapeHtml(tier_interest || 'not specified')}</p>
          <p style="margin:0; font-size:11px; color:#8a8578;">Full details (budget, message) are in the sponsor_inquiries table in Supabase.</p>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: SPONSOR_NOTIFY_RECIPIENT,
      replyTo: email || undefined, // hitting Reply goes straight to the sponsor, not back into a dead-end inbox
      subject: `New sponsor inquiry -- ${company_name || 'Unknown company'}`,
      html
    });

    res.status(200).json({ ok: true, notified: true });
  } catch (err) {
    console.error('notify-sponsor-inquiry failed:', err);
    res.status(200).json({ ok: false, notified: false });
  }
};

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
