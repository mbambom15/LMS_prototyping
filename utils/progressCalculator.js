/**
 * Shared expected-progress calculator. The docstring below still says
 * "shared across the facilitator portal" for historical accuracy, but
 * routes/facilitator.js's deal-detail / learner-detail / feedback-draft
 * code duplicates this exact formula inline rather than importing this
 * function — so this file only actually controls what routes/learner.js
 * (the learner dashboard) shows. Changing the rounding here does NOT
 * touch the facilitator portal's numbers; those three inline copies
 * would need the same edit separately if that's ever wanted too.
 *
 * durationMonths is converted to days at a flat 30 days/month.
 */
function calculateExpectedProgress(startDate, durationMonths) {
  if (!startDate || !durationMonths) return null;
  const durationDays = durationMonths * 30;
  if (durationDays <= 0) return null;

  const daysElapsed = (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24);
  const pct = (daysElapsed / durationDays) * 100;
  // 2 decimal places of real precision, not Math.round to a whole number —
  // the extra Math.round here is just to kill floating-point noise
  // (e.g. 7.2799999999999) at a fixed precision, not to coarsen the value.
  const pct2dp = Math.round(pct * 100) / 100;
  return Math.max(0, Math.min(100, pct2dp));
}

module.exports = { calculateExpectedProgress };