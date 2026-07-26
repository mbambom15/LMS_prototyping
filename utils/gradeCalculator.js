// utils/gradeCalculator.js
//
// Quizzes (auto-graded) contribute 40% of the qualification grade.
// Projects (facilitator-graded) contribute the remaining 60%.
// Both are mark-weighted internally (see the learner_grades view in
// 003_assessment_attempts.sql) rather than a flat average per assessment,
// so a 50-mark item counts proportionally more than a 10-mark one.

const QUIZ_WEIGHT = 0.4;
const PROJECT_WEIGHT = 0.6;

async function getLearnerGrade(pool, learnerId, qualificationId) {
  const { rows } = await pool.query(
    `SELECT quiz_pct, project_pct, overall_pct
     FROM learner_grades
     WHERE learner_id = $1 AND qualification_id = $2`,
    [learnerId, qualificationId]
  );
  const row = rows[0];
  return {
    quiz_pct: row?.quiz_pct != null ? Number(row.quiz_pct) : null,
    project_pct: row?.project_pct != null ? Number(row.project_pct) : null,
    overall_pct: row?.overall_pct != null ? Number(row.overall_pct) : 0,
    weights: { quiz: QUIZ_WEIGHT, project: PROJECT_WEIGHT },
  };
}

// The dashboard's "Progress: X% — On track/Behind" line (routes/learner.js
// GET /api/learner/progress) reads enrolments.progress_pct directly — it
// was never connected to quiz/project grades before. This writes the
// learner_grades view's overall_pct into that column, so the dashboard
// reflects it. This is the single place that column gets updated by
// grading; call it after ANY event that changes a learner's grade —
// today that's just quiz submission (routes/learner-assessments.js's
// POST /submit), and it needs the same call added wherever facilitator
// project grading lands once that's built, so a graded project updates
// progress the same way a graded quiz does.
async function syncEnrolmentProgress(pool, learnerId, qualificationId) {
  const grade = await getLearnerGrade(pool, learnerId, qualificationId);
  await pool.query(
    `UPDATE enrolments SET progress_pct = $1, updated_at = NOW()
     WHERE learner_id = $2 AND qualification_id = $3 AND status = 'active'`,
    [grade.overall_pct, learnerId, qualificationId]
  );
  return grade;
}

module.exports = { getLearnerGrade, syncEnrolmentProgress, QUIZ_WEIGHT, PROJECT_WEIGHT };