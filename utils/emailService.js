const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Nkanyezi LMS <onboarding@resend.dev>';

/** Retry wrapper — Resend can occasionally 5xx or rate-limit */
async function sendWithRetry(payload, retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const { data, error } = await resend.emails.send(payload);
            if (error) throw new Error(error.message || JSON.stringify(error));
            return data;
        } catch (err) {
            lastErr = err;
            console.error(`Resend send attempt ${attempt + 1} failed:`, err.message);
            if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
    throw lastErr;
}

function detailsHtml({ firstName, email, password, heading, intro }) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e5e5;border-radius:8px">
      <h2 style="color:#185fa5;margin-top:0">${heading}</h2>
      <p>Hi ${firstName},</p>
      <p>${intro}</p>
      <p style="background:#f1f6fb;padding:12px 16px;border-radius:6px;font-size:14px">
        <strong>Website:</strong> nkanyezionline.co.za<br>
        <strong>Username:</strong> ${email}<br>
        <strong>Password:</strong> ${password}
      </p>
      <p style="font-size:13px;color:#a32d2d;font-weight:bold">Please do not share your password with anyone.</p>
      <p style="font-size:13px;color:#666">Please log in and change your password as soon as possible.</p>
      <p>— Nkanyezi LMS Team</p>
    </div>`;
}

async function sendWelcomeEmail({ to, firstName, password }) {
    return sendWithRetry({
        from: FROM_EMAIL,
        to,
        subject: 'Welcome to Nkanyezi LMS!',
        html: detailsHtml({
            firstName,
            email: to,
            password,
            heading: 'Welcome to Nkanyezi LMS!',
            intro: 'Your account has been created. Here are your login details:',
        }),
    });
}

async function sendUserDetailsEmail({ to, firstName, password }) {
    return sendWithRetry({
        from: FROM_EMAIL,
        to,
        subject: 'Your Nkanyezi LMS account details',
        html: detailsHtml({
            firstName,
            email: to,
            password,
            heading: 'Your Nkanyezi LMS account details',
            intro: 'As requested, here are your current login details:',
        }),
    });
}

module.exports = { sendWelcomeEmail, sendUserDetailsEmail };