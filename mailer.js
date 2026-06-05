const nodemailer = require('nodemailer');

/*
  Required environment variables:
    EMAIL_HOST    — SMTP host          (e.g. smtp.gmail.com)
    EMAIL_PORT    — SMTP port          (default: 587)
    EMAIL_SECURE  — "true" for SSL/465 (default: false → STARTTLS)
    EMAIL_USER    — SMTP username / address
    EMAIL_PASS    — SMTP password or app-password
    EMAIL_FROM    — Display name + address  (e.g. "Scrubbed" <hello@scrubbed.app>)
    APP_URL       — Public base URL    (default: http://localhost:3000)
*/

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   parseInt(process.env.EMAIL_PORT || '587', 10),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const FROM    = process.env.EMAIL_FROM || '"Scrubbed" <hello@scrubbed.app>';
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

function welcomeHtml(email) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to Scrubbed</title></head>
<body style="margin:0;padding:0;background:#EDE8DF;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDE8DF;padding:48px 20px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">

        <!-- wordmark header -->
        <tr>
          <td style="padding:0 0 20px">
            <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-weight:700;font-size:20px;letter-spacing:-0.03em;color:#1F1B16">Scrubbed.</div>
          </td>
        </tr>

        <!-- main card -->
        <tr>
          <td style="background:#FBF7EE;border:1px solid #E5DDCD;border-radius:12px;overflow:hidden">

            <!-- card body -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:36px 36px 28px">
                  <h1 style="margin:0 0 14px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:26px;font-weight:700;letter-spacing:-0.03em;color:#1F1B16;line-height:1.15">You&rsquo;re in.</h1>
                  <p style="margin:0 0 24px;font-size:15px;line-height:1.68;color:#5C544A">Thanks for signing up. You&rsquo;re one of the first people to get access to Scrubbed, and we built it for exactly where you are right now: somewhere between AMCAS submission and the secondary flood.</p>

                  <!-- Vault feature block -->
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px">
                    <tr>
                      <td style="background:#F6F1E8;border-left:3px solid #B5563A;border-radius:0 6px 6px 0;padding:16px 20px">
                        <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#A89C8A;margin-bottom:7px">The Vault</div>
                        <div style="font-size:14px;line-height:1.65;color:#1F1B16">Every clinical hour, research project, volunteer shift, letter, and essay in one place. Structured, searchable, and ready when a secondary prompt asks about something you did two years ago.</div>
                      </td>
                    </tr>
                  </table>

                  <!-- Secondary Essays feature block -->
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
                    <tr>
                      <td style="background:#F6F1E8;border-left:3px solid #B5563A;border-radius:0 6px 6px 0;padding:16px 20px">
                        <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#A89C8A;margin-bottom:7px">Secondary Essays</div>
                        <div style="font-size:14px;line-height:1.65;color:#1F1B16">When schools open their secondaries, Scrubbed pulls from your Vault to give you school-specific outlines for each prompt. From what you actually did. Not templates. Not guesses.</div>
                      </td>
                    </tr>
                  </table>

                  <!-- CTA button -->
                  <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
                    <tr>
                      <td style="background:#B5563A;border-radius:8px">
                        <a href="https://getscrubbed.netlify.app/" style="display:inline-block;padding:13px 28px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:14px;font-weight:600;color:#FBF7EE;text-decoration:none;letter-spacing:0.01em;white-space:nowrap">Visit Homepage &rarr;</a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:0;font-size:13px;line-height:1.6;color:#A89C8A">You&rsquo;re one of the first. Your feedback shapes what gets built next. Reply to this email anytime.</p>
                </td>
              </tr>

              <!-- card footer -->
              <tr>
                <td style="padding:18px 36px;border-top:1px solid #E5DDCD">
                  <p style="margin:0;font-size:12px;color:#A89C8A">&copy; 2026 Scrubbed &middot; Built for the applicant who did the work.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- outer footer -->
        <tr>
          <td style="padding:20px 0 0;text-align:center">
            <p style="margin:0;font-size:11px;color:#A89C8A">You received this because you signed up at scrubbed.app with ${email}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendWelcomeEmail(toEmail) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('[mailer] Email env vars not set — skipping welcome email for', toEmail);
    return;
  }
  try {
    await transporter.sendMail({
      from:    FROM,
      to:      toEmail,
      subject: 'Welcome to Scrubbed — you\'re in.',
      html:    welcomeHtml(toEmail),
    });
    console.log('[mailer] Welcome email sent to', toEmail);
  } catch (err) {
    console.error('[mailer] Failed to send welcome email to', toEmail, '—', err.message);
  }
}

function otpHtml(otp) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Scrubbed code</title></head>
<body style="margin:0;padding:0;background:#EDE8DF;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDE8DF;padding:48px 20px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
        <tr><td style="padding:0 0 20px"><div style="font-weight:700;font-size:20px;letter-spacing:-0.03em;color:#1F1B16">Scrubbed.</div></td></tr>
        <tr><td style="background:#FBF7EE;border:1px solid #E5DDCD;border-radius:12px;overflow:hidden">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:36px 36px 28px">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1F1B16">Verification code</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5C544A">Use this code to complete your sign-in. It expires in 10 minutes.</p>
              <div style="background:#F6F1E8;border:1px solid #E5DDCD;border-radius:10px;padding:20px;text-align:center;letter-spacing:0.25em;font-size:32px;font-weight:700;color:#1F1B16;font-family:'Courier New',monospace">${otp}</div>
              <p style="margin:20px 0 0;font-size:12px;color:#A89C8A">If you didn't request this, you can safely ignore this email.</p>
            </td></tr>
            <tr><td style="padding:16px 36px;border-top:1px solid #E5DDCD"><p style="margin:0;font-size:12px;color:#A89C8A">&copy; 2026 Scrubbed</p></td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendOtpEmail(toEmail, otp) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('[mailer] Email env vars not set — skipping OTP email for', toEmail);
    return;
  }
  try {
    await transporter.sendMail({
      from:    FROM,
      to:      toEmail,
      subject: `${otp} is your Scrubbed verification code`,
      html:    otpHtml(otp),
    });
  } catch (err) {
    console.error('[mailer] Failed to send OTP to', toEmail, '—', err.message);
  }
}

module.exports = { sendWelcomeEmail, sendOtpEmail };
