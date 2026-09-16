// lib/mail.js
// Thin wrapper around Resend's API for transactional emails (password resets
// today; order confirmations could use this same helper later).
//
// Requires RESEND_API_KEY and RESEND_FROM_EMAIL to be set as environment
// variables — see .env.example. If they're not set, sendEmail() logs a
// warning and returns without sending, rather than crashing the request
// that triggered it (e.g. a password reset still responds successfully to
// the customer even if email delivery isn't configured yet).

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    console.warn(`Email not sent (RESEND_API_KEY/RESEND_FROM_EMAIL not configured) — subject: "${subject}"`);
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromEmail, to, subject, html }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend email send failed:', errText);
      return { sent: false, reason: errText };
    }
    return { sent: true };
  } catch (e) {
    console.error('Resend email send error:', e);
    return { sent: false, reason: e.message };
  }
}

module.exports = { sendEmail };
