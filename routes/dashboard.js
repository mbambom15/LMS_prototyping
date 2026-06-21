const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');

/* ══════════════════════════════════════════════════════════
   GET /api/dashboard/stats
   Backed by the admin_dashboard_stats SQL view — one row of
   KPI numbers for the four cards on the Dashboard tab.
══════════════════════════════════════════════════════════ */
router.get('/api/dashboard/stats', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM admin_dashboard_stats');
    const stats = result.rows[0] || {};
    res.json({ success: true, stats });
  } catch (err) {
    console.error('GET /api/dashboard/stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard stats' });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/dashboard/activity?limit=10
   Backed by the admin_recent_activity SQL view — recent
   submissions, grading, risk flags and material uploads.
══════════════════════════════════════════════════════════ */
router.get('/api/dashboard/activity', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const result = await pool.query(
      `SELECT activity_type, occurred_at, description
         FROM admin_recent_activity
         ORDER BY occurred_at DESC NULLS LAST
         LIMIT $1`,
      [limit]
    );
    res.json({ success: true, activity: result.rows });
  } catch (err) {
    console.error('GET /api/dashboard/activity error:', err);
    res.status(500).json({ success: false, message: 'Failed to load recent activity' });
  }
});

module.exports = router;