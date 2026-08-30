

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'orders@ketchupfiles.com'; // reuse the same sending address as receipts, or swap for a dedicated one like welcome@ketchupfiles.com

const CHAT_URL = 'https://www.ketchupfiles.com/chat';
const SEARCH_URL = 'https://www.ketchupfiles.com/fashion-week-stock-images-street-style-images';
const GALLERY_ARCHIVE_URL = 'https://www.ketchupfiles.com/shows-directory-archive'; // placeholder -- confirm this is the real gallery/archive page URL
const KF_LOGO_URL = 'https://vercel-publish-fawn.vercel.app/kf-logo.png';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (!RESEND_API_KEY) {
    res.status(500).json({ error: 'Missing Vercel environment variable: RESEND_API_KEY' });
    return;
  }

  try {
    const { email, username } = req.body || {};
    if (!email) {
      res.status(400).json({ ok: false, error: 'No email provided.' });
      return;
    }

    await sendWelcomeEmail({ to: email, username });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-welcome-email failed:', err);
    res.status(500).json({ ok: false, error: 'Could not send welcome email -- check logs.' });
  }
};

async function sendWelcomeEmail({ to, username }) {
  const greetingName = username ? username : 'there';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to Ketchup Files</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4; font-family:'Helvetica Neue', Arial, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4; padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#000000; max-width:600px; width:100%;">

        <tr>
          <td align="center" style="padding:32px 24px 24px; border-bottom:1px solid #ffffff22;">
            <img src="${KF_LOGO_URL}" alt="Ketchup Files" width="160" style="display:block; height:auto;">
          </td>
        </tr>

        <tr>
          <td style="padding:40px 40px 8px;">
            <p style="margin:0; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#e2231a; font-weight:700;">Welcome to the community</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 16px;">
            <h1 style="margin:0; font-size:28px; line-height:1.3; color:#ffffff; font-weight:700;">You're in, ${escapeHtml(greetingName)}.</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 36px;">
            <p style="margin:0; font-size:14px; line-height:1.6; color:#a8a8a8;">A community for photographers, journalists, and media who love fashion from the street up. Here's where to start:</p>
          </td>
        </tr>

        <!-- Three CTAs -->
        <tr>
          <td style="padding:0 40px 14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ffffff22;">
              <tr>
                <td style="padding:20px;">
                  <p style="margin:0 0 4px; font-size:14px; color:#ffffff; font-weight:700;">Chat</p>
                  <p style="margin:0 0 14px; font-size:12px; color:#a8a8a8;">Talk shop with other photographers and media, share your work, swap strategy.</p>
                  <a href="${CHAT_URL}" style="display:inline-block; padding:11px 20px; background:#ffffff; color:#000000; text-decoration:none; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Enter Chat</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ffffff22;">
              <tr>
                <td style="padding:20px;">
                  <p style="margin:0 0 4px; font-size:14px; color:#ffffff; font-weight:700;">Search</p>
                  <p style="margin:0 0 14px; font-size:12px; color:#a8a8a8;">Find coverage from any fashion week, city, or season.</p>
                  <a href="${SEARCH_URL}" style="display:inline-block; padding:11px 20px; background:#ffffff; color:#000000; text-decoration:none; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Search Now</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ffffff22;">
              <tr>
                <td style="padding:20px;">
                  <p style="margin:0 0 4px; font-size:14px; color:#ffffff; font-weight:700;">Gallery Archive</p>
                  <p style="margin:0 0 14px; font-size:12px; color:#a8a8a8;">Browse the full show directory and archive, year by year, city by city.</p>
                  <a href="${GALLERY_ARCHIVE_URL}" style="display:inline-block; padding:11px 20px; background:#ffffff; color:#000000; text-decoration:none; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Watch Gallery Archive</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px; border-top:1px solid #ffffff22;" align="center">
            <p style="margin:0 0 6px; font-size:11px; color:#666666;">© 2026 Ketchup Files Street Style Images</p>
            <p style="margin:0; font-size:11px; color:#666666;">Ketchup is a trademark created by Cocora Creatives LLC</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: 'Welcome to Ketchup Files',
      html,
    }),
  });
  if (!res.ok) {
    console.error('send-welcome-email: send failed:', res.status, await res.text());
  }
}

function escapeHtml(str) {
  return String(str).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}
