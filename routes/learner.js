// routes/learner.js
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');
const { calculateExpectedProgress } = require('../utils/progressCalculator');
const { getLearnerGrade } = require('../utils/gradeCalculator');

router.get('/api/learner/qualification', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const { rows } = await pool.query(
      `SELECT q.title, q.nqf_level
       FROM enrolments e
       JOIN qualifications q ON q.qualification_id = e.qualification_id
       WHERE e.learner_id = $1 AND e.status = 'active'
       LIMIT 1`,
      [learnerId]
    );
    res.json({ success: true, qualification: rows[0] || null });
  } catch (err) {
    console.error('GET /api/learner/qualification error:', err);
    res.status(500).json({ success: false, message: 'Failed to load qualification' });
  }
});

// ── GET /api/learner/progress ─────────────────────────────────────
// Actual progress vs expected progress (deal start_date + qualification
// duration, unchanged). actual_pct is computed LIVE from learner_grades
// via getLearnerGrade — not read from enrolments.progress_pct — so this
// is always correct the instant it's requested, with no dependency on
// something else having triggered a sync first (a quiz submit, a future
// facilitator grading action, an admin publishing a new quiz that
// changes the denominator). enrolments.progress_pct still gets kept in
// sync by syncEnrolmentProgress() for other consumers (admin/facilitator
// views, risk flags) that read it directly, but this endpoint no longer
// depends on that being fresh.
router.get('/api/learner/progress', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const { rows } = await pool.query(
      `SELECT e.qualification_id, d.start_date AS deal_start_date, q.duration_months
       FROM enrolments e
       JOIN learners l ON l.learner_id = e.learner_id
       LEFT JOIN deals d ON d.deal_number = l.deal_number
       LEFT JOIN qualifications q ON q.qualification_id = e.qualification_id
       WHERE e.learner_id = $1 AND e.status = 'active'
       LIMIT 1`,
      [learnerId]
    );

    if (!rows.length) {
      return res.json({ success: true, progress: null });
    }

    const row = rows[0];
    const grade = await getLearnerGrade(pool, learnerId, row.qualification_id);
    const actualPct = grade.overall_pct; // live, full precision — no Math.round here, decimals kept for display
    const expectedPct = calculateExpectedProgress(row.deal_start_date, row.duration_months);

    res.json({
      success: true,
      progress: {
        actual_pct: actualPct,
        expected_pct: expectedPct,
        is_behind: expectedPct !== null ? actualPct < expectedPct : false,
      },
    });
  } catch (err) {
    console.error('GET /api/learner/progress error:', err);
    res.status(500).json({ success: false, message: 'Failed to load progress' });
  }
});

router.get('/api/learner/feedback', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 50, 100) : 100;

    const { rows } = await pool.query(
      `SELECT f.id, f.parent_id, f.subject, f.message, f.feedback_type, f.from_role,
              COALESCE(f.sent_at, f.created_at) AS sent_at,
              u.name AS from_name, u.surname AS from_surname
       FROM feedback f
       JOIN users u ON u.user_id = f.from_user_id
       WHERE f.to_learner_id = $1
       ORDER BY COALESCE(f.sent_at, f.created_at) ASC
       LIMIT $2`,
      [learnerId, limit]
    );

    res.json({ success: true, feedback: rows });
  } catch (err) {
    console.error('GET /api/learner/feedback error:', err);
    res.status(500).json({ success: false, message: 'Failed to load feedback' });
  }
});

router.post('/api/learner/feedback/:id/reply', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const { id } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    const { rows } = await pool.query(
      `SELECT id, parent_id, to_learner_id, facilitator_id FROM feedback WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Original message not found' });
    }
    const target = rows[0];
    if (target.to_learner_id !== learnerId) {
      return res.status(403).json({ success: false, message: 'Not your message thread' });
    }
    const rootId = target.parent_id || target.id;

    const inserted = await pool.query(
      `INSERT INTO feedback (to_learner_id, facilitator_id, from_user_id, from_role, feedback_type, parent_id, message, is_auto_generated, sent_at, delivery_method)
       VALUES ($1, $2, $3, 'learner', 'message', $4, $5, FALSE, NOW(), 'in-app')
       RETURNING id, parent_id, subject, message, from_role, sent_at`,
      [learnerId, target.facilitator_id, learnerId, rootId, message.trim()]
    );

    res.json({ success: true, feedback: inserted.rows[0] });
  } catch (err) {
    console.error('POST /api/learner/feedback/:id/reply error:', err);
    res.status(500).json({ success: false, message: 'Failed to send reply' });
  }
});

/** Resolve the learner's facilitator via their deal (learners.deal_number -> deals.facilitator_id) */
async function getLearnerFacilitatorId(learnerId) {
  const { rows } = await pool.query(
    `SELECT d.facilitator_id
     FROM learners l
     JOIN deals d ON d.deal_number = l.deal_number
     WHERE l.learner_id = $1 AND d.is_deleted = FALSE AND d.facilitator_id IS NOT NULL
     LIMIT 1`,
    [learnerId]
  );
  return rows[0]?.facilitator_id || null;
}

router.post('/api/learner/feedback', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const { subject, message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    const facilitatorId = await getLearnerFacilitatorId(learnerId);
    if (!facilitatorId) {
      return res.status(400).json({ success: false, message: 'No facilitator assigned yet — contact your administrator' });
    }

    const inserted = await pool.query(
      `INSERT INTO feedback (to_learner_id, facilitator_id, from_user_id, from_role, feedback_type, subject, message, is_auto_generated, sent_at, delivery_method)
       VALUES ($1, $2, $3, 'learner', 'message', $4, $5, FALSE, NOW(), 'in-app')
       RETURNING id, parent_id, subject, message, from_role, sent_at`,
      [learnerId, facilitatorId, learnerId, subject?.trim() || null, message.trim()]
    );

    res.json({ success: true, feedback: inserted.rows[0] });
  } catch (err) {
    console.error('POST /api/learner/feedback error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

module.exports = router;