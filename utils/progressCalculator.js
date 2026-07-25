/**
 * Shared expected-progress calculator — same formula used across the
 * facilitator portal (deal-detail, learner-detail, feedback drafts).
 * durationMonths is converted to days at a flat 30 days/month.
 */
function calculateExpectedProgress(startDate, durationMonths) {
  if (!startDate || !durationMonths) return null;
  const durationDays = durationMonths * 30;
  if (durationDays <= 0) return null;

  const daysElapsed = (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.min(100, Math.round((daysElapsed / durationDays) * 100)));
}

module.exports = { calculateExpectedProgress };