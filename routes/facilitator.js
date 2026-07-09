const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');

// Every route below is scoped to the logged-in facilitator
router.use('/api/facilitator', isAuthenticated, isRole('facilitator'));

// ── GET /api/facilitator/me ───────────────────────────────────────
router.get('/api/facilitator/me', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const result = await pool.query(
            `SELECT name, surname, email FROM users WHERE user_id = $1`,
            [facilitatorId]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: 'Facilitator not found' });
        res.json({ success: true, facilitator: result.rows[0] });
    } catch (err) {
        console.error('GET /api/facilitator/me error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch facilitator profile' });
    }
});

// ── GET /api/facilitator/deals?search=&status= ───────────────────

// Deal management list: filterable + searchable, scoped to this facilitator
router.get('/api/facilitator/deals', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { search, status } = req.query;

        const conditions = ['d.facilitator_id = $1', 'd.is_deleted = FALSE'];
        const values = [facilitatorId];
        let idx = 2;

        if (status && status !== 'all') {
            conditions.push(`d.registration_status = $${idx++}`);
            values.push(status);
        }
        if (search && search.trim()) {
            conditions.push(`(
                d.sponsor ILIKE $${idx} OR
                CAST(d.deal_number AS TEXT) ILIKE $${idx} OR
                q.title ILIKE $${idx}
            )`);
            values.push(`%${search.trim()}%`);
            idx++;
        }

        const result = await pool.query(
            `SELECT
                d.deal_number,
                d.sponsor,
                q.title      AS qualification,
                q.nqf_level,
                d.registration_status,
                d.learners_count,
                d.start_date
             FROM deals d
             LEFT JOIN qualifications q ON q.qualification_id = d.qualification_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY d.start_date DESC NULLS LAST`,
            values
        );

        res.json({ success: true, deals: result.rows });
    } catch (err) {
        console.error('GET /api/facilitator/deals error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch deals' });
    }
});

// ── GET /api/facilitator/deals/statuses ──────────────────────────
// Distinct statuses actually in use for this facilitator's deals, to build the filter dropdown dynamically
router.get('/api/facilitator/deals/statuses', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const result = await pool.query(
            `SELECT DISTINCT registration_status
             FROM deals
             WHERE facilitator_id = $1 AND is_deleted = FALSE AND registration_status IS NOT NULL
             ORDER BY registration_status`,
            [facilitatorId]
        );
        res.json({ success: true, statuses: result.rows.map(r => r.registration_status) });
    } catch (err) {
        console.error('GET /api/facilitator/deals/statuses error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch statuses' });
    }
});

// ── GET /api/facilitator/dashboard-stats ─────────────────────────
router.get('/api/facilitator/dashboard-stats', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;

        const result = await pool.query(
            `WITH my_learners AS (
                SELECT l.learner_id
                FROM learners l
                JOIN deals d ON d.deal_number = l.deal_number
                WHERE d.facilitator_id = $1 AND d.is_deleted = FALSE
             ),
             risk AS (
                SELECT rf.learner_id, rf.risk_level
                FROM learner_risk_flags rf
                WHERE rf.resolved_at IS NULL
                  AND rf.learner_id IN (SELECT learner_id FROM my_learners)
             ),
             attendance AS (
                SELECT learner_id,
                       ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('present','late')) / NULLIF(COUNT(*),0), 0) AS pct
                FROM attendance_records
                WHERE learner_id IN (SELECT learner_id FROM my_learners)
                GROUP BY learner_id
             )
             SELECT
                (SELECT COUNT(*) FROM my_learners)                                        AS total_learners,
                (SELECT COUNT(*) FROM risk WHERE risk_level = 'high')                      AS at_risk,
                (SELECT COUNT(*) FROM risk WHERE risk_level = 'medium')                    AS behind_schedule,
                (SELECT COUNT(*) FROM my_learners) - (SELECT COUNT(*) FROM risk)           AS on_track,
                (SELECT ROUND(AVG(pct)) FROM attendance)                                   AS avg_attendance`,
            [facilitatorId]
        );

        res.json({ success: true, stats: result.rows[0] });
    } catch (err) {
        console.error('GET /api/facilitator/dashboard-stats error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
    }
});

// ── GET /api/facilitator/at-risk-learners ────────────────────────
router.get('/api/facilitator/at-risk-learners', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;

        const result = await pool.query(
            `SELECT
                u.user_id,
                u.name,
                u.surname,
                d.deal_number,
                rf.risk_level,
                rf.attendance_pct,
                rf.progress_pct,
                rf.days_since_login,
                rf.flag_low_attendance,
                rf.flag_behind_schedule,
                rf.flag_no_login,
                rf.flag_poe_overdue
             FROM learner_risk_flags rf
             JOIN learners l ON l.learner_id = rf.learner_id
             JOIN users u    ON u.user_id = l.learner_id
             JOIN deals d    ON d.deal_number = l.deal_number
             WHERE d.facilitator_id = $1 AND d.is_deleted = FALSE AND rf.resolved_at IS NULL
             ORDER BY
                CASE rf.risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                rf.attendance_pct ASC NULLS LAST`,
            [facilitatorId]
        );

        res.json({ success: true, learners: result.rows });
    } catch (err) {
        console.error('GET /api/facilitator/at-risk-learners error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch at-risk learners' });
    }
});

// ── GET /api/facilitator/deals/:dealNumber ────────────────────────
// Deal detail page: deal header info + the full learner roster for that deal
router.get('/api/facilitator/deals/:dealNumber', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const dealNumber = parseInt(req.params.dealNumber, 10);
        if (Number.isNaN(dealNumber)) {
            return res.status(400).json({ success: false, message: 'Invalid deal number' });
        }

        const dealResult = await pool.query(
            `SELECT
                d.deal_number,
                d.sponsor,
                d.registration_status,
                d.learners_count,
                d.start_date,
                q.qualification_id,
                q.title AS qualification,
                q.nqf_level,
                q.duration_months
             FROM deals d
             LEFT JOIN qualifications q ON q.qualification_id = d.qualification_id
             WHERE d.deal_number = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE`,
            [dealNumber, facilitatorId]
        );

        if (!dealResult.rows.length) {
            return res.status(404).json({ success: false, message: 'Deal not found or not assigned to you' });
        }
        const deal = dealResult.rows[0];

        const learnersResult = await pool.query(
            `SELECT
                u.user_id,
                u.name,
                u.surname,
                u.email,
                u.phone_number,
                u.last_login,
                u.status,
                e.progress_pct,
                e.start_date AS enrolment_start
             FROM learners l
             JOIN users u ON u.user_id = l.learner_id
             LEFT JOIN enrolments e
                ON e.learner_id = l.learner_id
               AND e.qualification_id = $2
             WHERE l.deal_number = $1
             ORDER BY u.name, u.surname`,
            [dealNumber, deal.qualification_id]
        );

        // Expected progress = how far through the qualification's duration the
        // learner should be by now, based on their enrolment start date.
        const durationDays = (deal.duration_months || 0) * 30;
        const learners = learnersResult.rows.map(l => {
            let expectedPct = null;
            const startDate = l.enrolment_start || deal.start_date;
            if (startDate && durationDays > 0) {
                const daysElapsed = (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24);
                expectedPct = Math.max(0, Math.min(100, Math.round((daysElapsed / durationDays) * 100)));
            }
            return { ...l, expected_pct: expectedPct };
        });

        res.json({ success: true, deal, learners });
    } catch (err) {
        console.error('GET /api/facilitator/deals/:dealNumber error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch deal detail' });
    }
});

// ── GET /api/facilitator/learners/:learnerId ─────────────────────
// Full detail card for the "View details" modal — ownership enforced via the learner's deal
router.get('/api/facilitator/learners/:learnerId', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { learnerId } = req.params;
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(learnerId)) {
            return res.status(400).json({ success: false, message: 'Invalid learner ID' });
        }

        const result = await pool.query(
            `SELECT
                u.user_id, u.name, u.surname, u.email, u.phone_number,
                u.alternative_number, u.sa_id, u.gender, u.status, u.last_login,
                d.deal_number, d.sponsor,
                q.title AS qualification, q.nqf_level, q.duration_months,
                e.start_date AS enrolment_start, e.expected_end_date, e.progress_pct,
                e.employer_name, e.workplace_address,
                rf.risk_level, rf.attendance_pct AS risk_attendance_pct,
                rf.flag_low_attendance, rf.flag_behind_schedule, rf.flag_no_login, rf.flag_poe_overdue
             FROM learners l
             JOIN users u ON u.user_id = l.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.qualification_id = d.qualification_id
             LEFT JOIN qualifications q ON q.qualification_id = d.qualification_id
             LEFT JOIN learner_risk_flags rf ON rf.learner_id = l.learner_id AND rf.resolved_at IS NULL
             WHERE l.learner_id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE`,
            [learnerId, facilitatorId]
        );

        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Learner not found or not in one of your deals' });
        }

        res.json({ success: true, learner: result.rows[0] });
    } catch (err) {
        console.error('GET /api/facilitator/learners/:learnerId error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch learner detail' });
    }
});

// ── GET /api/facilitator/learners/:learnerId/attendance ──────────
router.get('/api/facilitator/learners/:learnerId/attendance', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { learnerId } = req.params;
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(learnerId)) {
            return res.status(400).json({ success: false, message: 'Invalid learner ID' });
        }

        // Ownership check
        const owns = await pool.query(
            `SELECT 1 FROM learners l JOIN deals d ON d.deal_number = l.deal_number
             WHERE l.learner_id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE`,
            [learnerId, facilitatorId]
        );
        if (!owns.rows.length) {
            return res.status(404).json({ success: false, message: 'Learner not found or not in one of your deals' });
        }

        const summaryResult = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE status IN ('present','late')) AS days_present,
                COUNT(*) FILTER (WHERE status = 'absent')             AS days_absent,
                COUNT(*)                                               AS total_days,
                ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('present','late')) / NULLIF(COUNT(*),0), 0) AS rate_pct
             FROM attendance_records
             WHERE learner_id = $1`,
            [learnerId]
        );

        const result = await pool.query(
            `SELECT attendance_date, status, check_in_time, check_out_time, geo_verified, geo_distance_km
             FROM attendance_records
             WHERE learner_id = $1
             ORDER BY attendance_date DESC
             LIMIT 30`,
            [learnerId]
        );

        res.json({ success: true, records: result.rows, summary: summaryResult.rows[0] });
    } catch (err) {
        console.error('GET /api/facilitator/learners/:learnerId/attendance error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch learner attendance' });
    }
});

// ── GET /api/facilitator/attendance?deal_number=&from=&to= ───────
router.get('/api/facilitator/attendance', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { deal_number, from, to } = req.query;

        const conditions = ['d.facilitator_id = $1', 'd.is_deleted = FALSE'];
        const values = [facilitatorId];
        let idx = 2;

        if (deal_number) {
            conditions.push(`d.deal_number = $${idx++}`);
            values.push(deal_number);
        }
        if (from) {
            conditions.push(`ar.attendance_date >= $${idx++}`);
            values.push(from);
        }
        if (to) {
            conditions.push(`ar.attendance_date <= $${idx++}`);
            values.push(to);
        }

        const result = await pool.query(
            `SELECT
                u.name, u.surname,
                ar.attendance_date, ar.status,
                ar.check_in_time, ar.check_out_time,
                ar.geo_verified, ar.geo_distance_km,
                d.deal_number
             FROM attendance_records ar
             JOIN learners l ON l.learner_id = ar.learner_id
             JOIN users u    ON u.user_id = l.learner_id
             JOIN deals d    ON d.deal_number = l.deal_number
             WHERE ${conditions.join(' AND ')}
             ORDER BY ar.attendance_date DESC`,
            values
        );

        res.json({ success: true, records: result.rows });
    } catch (err) {
        console.error('GET /api/facilitator/attendance error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch attendance records' });
    }
});

module.exports = router;