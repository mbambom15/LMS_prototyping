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

/** Format a DATE/TIMESTAMPTZ value as e.g. "06 July 2026", or a fallback string if null */
function fmtDate(d, fallback = 'Not set') {
    if (!d) return fallback;
    return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Add N months to a date and return the resulting Date (used to derive an
 *  expected end date, since the deals table has no end_date column — the
 *  only source of truth for duration is qualifications.duration_months). */
function addMonths(date, months) {
    if (!date || months == null) return null;
    const d = new Date(date);
    d.setMonth(d.getMonth() + Number(months));
    return d;
}

/* ══════════════════════════════════════════════════════════
   DEAL ASSIGNED TO FACILITATOR
   Sent when an admin assigns/reassigns a facilitator to a deal
   via PUT /api/deals/:number/facilitator.
══════════════════════════════════════════════════════════ */
function dealAssignedHtml({ firstName, sponsor, dealNumber, qualificationTitle, startDate, endDate, learnerCount }) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e5e5;border-radius:8px">
      <h2 style="color:#185fa5;margin-top:0">You've been assigned a new deal</h2>
      <p>Hi ${firstName},</p>
      <p>You have been assigned as the facilitator for the following deal on Nkanyezi LMS:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
        <tr>
          <td style="padding:8px 0;color:#666;width:160px">Deal name</td>
          <td style="padding:8px 0;font-weight:bold">${sponsor}</td>
        </tr>
        <tr style="border-top:1px solid #eee">
          <td style="padding:8px 0;color:#666">Deal number</td>
          <td style="padding:8px 0;font-weight:bold">#${dealNumber}</td>
        </tr>
        <tr style="border-top:1px solid #eee">
          <td style="padding:8px 0;color:#666">Qualification</td>
          <td style="padding:8px 0;font-weight:bold">${qualificationTitle || 'Not set'}</td>
        </tr>
        <tr style="border-top:1px solid #eee">
          <td style="padding:8px 0;color:#666">Start date</td>
          <td style="padding:8px 0;font-weight:bold">${fmtDate(startDate)}</td>
        </tr>
        <tr style="border-top:1px solid #eee">
          <td style="padding:8px 0;color:#666">Expected end date</td>
          <td style="padding:8px 0;font-weight:bold">${fmtDate(endDate)}</td>
        </tr>
        <tr style="border-top:1px solid #eee">
          <td style="padding:8px 0;color:#666">Learner count</td>
          <td style="padding:8px 0;font-weight:bold">${learnerCount ?? 0}</td>
        </tr>
      </table>
      <p style="font-size:13px;color:#666">Log in to Nkanyezi LMS to view learners linked to this deal and manage their progress.</p>
      <p>— Nkanyezi LMS Team</p>
    </div>`;
}

async function sendDealAssignedEmail({ to, firstName, sponsor, dealNumber, qualificationTitle, startDate, durationMonths, learnerCount }) {
    const endDate = addMonths(startDate, durationMonths);
    return sendWithRetry({
        from: FROM_EMAIL,
        to,
        subject: `New deal assigned: ${sponsor} (#${dealNumber})`,
        html: dealAssignedHtml({ firstName, sponsor, dealNumber, qualificationTitle, startDate, endDate, learnerCount }),
    });
}

/* ══════════════════════════════════════════════════════════
   LEARNERS ASSIGNED TO FACILITATOR'S DEAL
   Sent when an admin links one or more learners to a deal
   via POST /api/deals/:number/learners, to that deal's
   facilitator (if one is assigned).
══════════════════════════════════════════════════════════ */
function learnersAssignedHtml({ firstName, sponsor, dealNumber, qualificationTitle, learners }) {
    const rows = learners.map(l => `
      <tr style="border-top:1px solid #eee">
        <td style="padding:8px 0">${l.fullName}</td>
        <td style="padding:8px 0">${l.idNumber || '—'}</td>
      </tr>`).join('');

    return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e5e5;border-radius:8px">
      <h2 style="color:#185fa5;margin-top:0">New learner${learners.length === 1 ? '' : 's'} assigned to your deal</h2>
      <p>Hi ${firstName},</p>
      <p>${learners.length} learner${learners.length === 1 ? ' has' : 's have'} been linked to your deal:</p>
      <p style="background:#f1f6fb;padding:10px 14px;border-radius:6px;font-size:14px;margin:12px 0">
        <strong>${sponsor}</strong> — Deal #${dealNumber}<br>
        <span style="color:#666">${qualificationTitle || 'No qualification set'}</span>
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
        <tr>
          <td style="padding:8px 0;color:#666;font-weight:bold">Full name</td>
          <td style="padding:8px 0;color:#666;font-weight:bold">ID number</td>
        </tr>
        ${rows}
      </table>
      <p style="font-size:13px;color:#666">Log in to Nkanyezi LMS to view these learners' full details and progress.</p>
      <p>— Nkanyezi LMS Team</p>
    </div>`;
}

async function sendLearnersAssignedEmail({ to, firstName, sponsor, dealNumber, qualificationTitle, learners }) {
    if (!learners || !learners.length) return; // nothing to notify about
    return sendWithRetry({
        from: FROM_EMAIL,
        to,
        subject: `${learners.length} learner${learners.length === 1 ? '' : 's'} assigned to ${sponsor} (#${dealNumber})`,
        html: learnersAssignedHtml({ firstName, sponsor, dealNumber, qualificationTitle, learners }),
    });
}

/* ══════════════════════════════════════════════════════════
   LEARNER FEEDBACK EMAIL
   Sent by a facilitator to a specific learner — auto-generated
   draft, reviewed/edited by the facilitator, then sent using the
   FACILITATOR'S OWN @nkanyezionline.co.za address as the real
   From (the whole domain is verified with Resend, so this isn't
   a display-name trick — the learner can reply directly to the
   facilitator).
══════════════════════════════════════════════════════════ */
function learnerFeedbackHtml({ message }) {
    const paragraphs = message
        .split(/\n\n+/)
        .map(p => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
        .join('');

    return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e5e5;border-radius:8px;color:#171717;font-size:14px;line-height:1.5">
      ${paragraphs}
      <p style="font-size:11px;color:#9a9a97;margin-top:20px;border-top:1px solid #eee;padding-top:12px">
        Sent via Nkanyezi LMS on behalf of your facilitator.
      </p>
    </div>`;
}

async function sendLearnerFeedbackEmail({ to, subject, message, facilitatorName, facilitatorEmail }) {
    return sendWithRetry({
        from: `${facilitatorName} <${facilitatorEmail}>`,
        to,
        cc: facilitatorEmail,
        subject,
        html: learnerFeedbackHtml({ message }),
    });
}

module.exports = {
    sendWelcomeEmail,
    sendUserDetailsEmail,
    sendDealAssignedEmail,
    sendLearnersAssignedEmail,
    sendLearnerFeedbackEmail,
};