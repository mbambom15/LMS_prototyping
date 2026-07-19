// routes/learner.js
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');

/**
 * GET /api/learner/qualification
 * The learner's active qualification title — used for the dashboard
 * welcome bar instead of a hardcoded "MICT SETA" string.
 *
 * Test: curl -b cookie.txt http://localhost:3000/api/learner/qualification
 */
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

/**
 * GET /api/learner/feedback?limit=3
 * Feedback sent to the calling learner, newest first. No limit param
 * returns everything (used by the Messages modal); a limit param
 * is used for the dashboard's "Latest feedback" preview.
 *
 * Test: curl -b cookie.txt "http://localhost:3000/api/learner/feedback?limit=3"
 */
router.get('/api/learner/feedback', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 50, 100) : 100;

    const { rows } = await pool.query(
      `SELECT f.id, f.subject, f.message, f.feedback_type,
              COALESCE(f.sent_at, f.created_at) AS sent_at,
              u.name AS from_name, u.surname AS from_surname
       FROM feedback f
       JOIN users u ON u.user_id = f.from_user_id
       WHERE f.to_learner_id = $1
       ORDER BY COALESCE(f.sent_at, f.created_at) DESC
       LIMIT $2`,
      [learnerId, limit]
    );

    res.json({ success: true, feedback: rows });
  } catch (err) {
    console.error('GET /api/learner/feedback error:', err);
    res.status(500).json({ success: false, message: 'Failed to load feedback' });
  }
});

module.exports = router;