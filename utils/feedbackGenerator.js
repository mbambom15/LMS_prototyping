const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pct(n) {
    return n == null ? 'N/A' : `${Math.round(n)}%`;
}

/**
 * Builds a categorized feedback draft (subject + body) for a learner.
 *
 * @param {Object} params
 * @param {string} params.learnerFirstName
 * @param {string} [params.qualificationTitle]
 * @param {'on-track'|'watch'|'at-risk'} params.riskStatus
 * @param {boolean} params.neverAttended
 * @param {number|null} params.actualPct     - progress_pct
 * @param {number|null} params.expectedPct   - computed expected % from deal start date
 * @param {Object} params.attendance         - { present_count, late_count, absent_count, total_count, rate_pct, mostAbsentDayIndex }
 * @param {string} params.facilitatorName
 * @returns {{ category: string, subject: string, body: string }}
 */
function generateFeedbackDraft({
    learnerFirstName,
    qualificationTitle,
    riskStatus,
    neverAttended,
    actualPct,
    expectedPct,
    attendance,
    facilitatorName,
}) {
    const gap = (actualPct != null && expectedPct != null) ? Math.max(0, expectedPct - actualPct) : null;
    const mostAbsentDay = attendance && attendance.mostAbsentDayIndex != null
        ? WEEKDAYS[attendance.mostAbsentDayIndex]
        : null;
    const totalCount = attendance ? Number(attendance.total_count) : 0;
    const absentCount = attendance ? Number(attendance.absent_count) : 0;
    const ratePct = attendance ? attendance.rate_pct : null;

    const attendanceLine = neverAttended
        ? "You haven't signed in to a single session yet — that's a serious concern and something we need to address immediately."
        : totalCount > 0
            ? `Your attendance rate is currently ${pct(ratePct)}, with ${absentCount} absence${absentCount === 1 ? '' : 's'} out of ${totalCount} recorded session${totalCount === 1 ? '' : 's'}${mostAbsentDay ? `, most frequently on ${mostAbsentDay}s` : ''}.`
            : 'No attendance has been recorded yet.';

    const qualLine = qualificationTitle ? ` — ${qualificationTitle}` : '';
    let category, subject, body;

    if (riskStatus === 'at-risk' || neverAttended) {
        category = 'at-risk';
        subject = `Urgent: let's get you back on track${qualLine}`;
        body =
`Hi ${learnerFirstName},

I wanted to reach out because your progress and attendance need urgent attention.

Progress: you're currently at ${pct(actualPct)} completion${expectedPct != null ? `, but based on your start date you should be at around ${pct(expectedPct)} by now — that's ${gap}% behind where we'd expect you to be at this stage.` : '.'}

Attendance: ${attendanceLine}

This needs to change quickly to keep you on track for completion. Please contact me as soon as possible so we can put a catch-up plan in place together — the sooner we speak, the more options we have.

— ${facilitatorName}`;
    } else if (riskStatus === 'watch') {
        category = 'watch';
        subject = `Checking in — a few things to catch up on${qualLine}`;
        body =
`Hi ${learnerFirstName},

I'm reaching out because you're a little behind where we'd expect at this stage${gap != null ? ` — you're at ${pct(actualPct)}, against an expected ${pct(expectedPct)} (${gap}% behind).` : '.'}

Attendance: ${attendanceLine}

This is still very manageable. If you can prioritise catching up over the next week or two, you'll be right back on pace. Let me know if there's anything getting in the way, or if you'd like to set up a short call to plan it out.

— ${facilitatorName}`;
    } else {
        category = 'on-track';
        subject = `Great progress — keep it up!${qualLine}`;
        body =
`Hi ${learnerFirstName},

Just a quick note to say you're doing really well — you're at ${pct(actualPct)} completion${expectedPct != null ? `, right on pace with (or ahead of) the expected ${pct(expectedPct)}.` : '.'}

Attendance: ${attendanceLine}

Keep up the great work — it's paying off. Reach out any time if you need support with anything upcoming.

— ${facilitatorName}`;
    }

    return { category, subject, body };
}

module.exports = { generateFeedbackDraft, WEEKDAYS };