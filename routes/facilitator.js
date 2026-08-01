const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const { generateFeedbackDraft } = require('../utils/feedbackGenerator');
const { sendLearnerFeedbackEmail } = require('../utils/emailService');
const { getSasUrl } = require('../utils/blobStorage');
const { syncEnrolmentProgress } = require('../utils/gradeCalculator');

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every route below is scoped to the logged-in facilitator
router.use('/api/facilitator', isAuthenticated, isRole('facilitator'));

// ── Shared: dynamic learner risk computation ──────────────────────
// Computed live from enrolments/attendance/deals rather than read from
// the static learner_risk_flags table (nothing populates that table on
// its own, which is why "behind schedule" was always 0). Both
// dashboard-stats and at-risk-learners read from this single query so
// the two views can never disagree, and every percentage returned here
// is exactly what the database has — no rounding is applied anywhere
// in this function.
//
// risk_level (this is what drives the on_track / behind_schedule /
// at_risk counters):
//   high   — poor attendance (never attended, or attendance_pct < 75)
//            AND behind on progress (more than 5 points behind expected
//            pace, OR 0% progress outright)
//   medium — progress is more than 5 points behind expected pace, but
//            attendance is NOT poor (good attendance alone doesn't
//            excuse being behind, but it keeps them out of the
//            critical/high bucket)
//   low    — on pace or ahead, OR behind-attendance but still on/ahead
//            of expected progress (this is "on track")
//
// Attendance quality is still tracked and returned separately
// (good/fair/poor, flag_poor_attendance) so the UI can show a poor-
// attendance badge on an otherwise on-track learner without that
// learner counting against on_track/behind_schedule/at_risk.
async function getLearnerRiskRows(facilitatorId) {
    const result = await pool.query(
        `WITH my_learners AS (
            SELECT
                l.learner_id, u.name, u.surname, u.last_login,
                d.deal_number, d.start_date AS deal_start_date,
                q.duration_months,
                e.progress_pct
            FROM learners l
            JOIN users u ON u.user_id = l.learner_id
            JOIN deals d ON d.deal_number = l.deal_number
            LEFT JOIN qualifications q ON q.qualification_id = d.qualification_id
            LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.qualification_id = d.qualification_id
            WHERE d.facilitator_id = $1 AND d.is_deleted = FALSE
         ),
         attendance AS (
            SELECT
                learner_id,
                ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('present','late')) / NULLIF(COUNT(*),0), 2) AS pct,
                COUNT(*) AS total_days
            FROM attendance_records
            WHERE learner_id IN (SELECT learner_id FROM my_learners)
            GROUP BY learner_id
         ),
         computed AS (
            SELECT
                ml.learner_id, ml.name, ml.surname, ml.deal_number, ml.last_login,
                COALESCE(ml.progress_pct, 0) AS progress_pct,
                att.pct                       AS attendance_pct,
                COALESCE(att.total_days, 0)   AS attendance_days,
                CASE
                    WHEN ml.deal_start_date IS NOT NULL AND ml.duration_months > 0 THEN
                        LEAST(100, GREATEST(0, ROUND(
                            100.0 * EXTRACT(EPOCH FROM (NOW() - ml.deal_start_date::timestamptz))
                            / (ml.duration_months * 30 * 86400)
                        , 2)))
                    ELSE NULL
                END AS expected_pct
            FROM my_learners ml
            LEFT JOIN attendance att ON att.learner_id = ml.learner_id
         )
         SELECT
            learner_id, name, surname, deal_number, last_login,
            CASE WHEN last_login IS NOT NULL THEN EXTRACT(DAY FROM NOW() - last_login)::int ELSE NULL END AS days_since_login,
            progress_pct, attendance_pct, expected_pct,
            (attendance_days = 0) AS never_attended,
            (expected_pct IS NOT NULL AND (expected_pct - progress_pct) > 5)  AS flag_behind_schedule,
            (attendance_days = 0 OR (attendance_pct IS NOT NULL AND attendance_pct < 75)) AS flag_poor_attendance,
            CASE
                WHEN attendance_days = 0 THEN 'poor'
                WHEN attendance_pct IS NULL THEN NULL
                WHEN attendance_pct >= 80 THEN 'good'
                WHEN attendance_pct >= 75 THEN 'fair'
                ELSE 'poor'
            END AS attendance_quality,
            -- at_risk (high) = poor attendance AND behind on progress
            -- (gap > 5, or 0% progress outright). Behind schedule alone
            -- (good attendance, gap > 5) is 'medium'. Everyone else —
            -- including poor-attendance learners still on/ahead of
            -- pace — is 'low' (on track).
            CASE
                WHEN (attendance_days = 0 OR (attendance_pct IS NOT NULL AND attendance_pct < 75))
                 AND (
                    (expected_pct IS NOT NULL AND (expected_pct - progress_pct) > 5)
                    OR progress_pct = 0
                 )
                    THEN 'high'
                WHEN (expected_pct IS NOT NULL AND (expected_pct - progress_pct) > 5)
                    THEN 'medium'
                ELSE 'low'
            END AS risk_level
         FROM computed`,
        [facilitatorId]
    );
    return result.rows;
}

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
// Rebuilt on top of getLearnerRiskRows so on_track/behind_schedule/
// at_risk always reflect the same computation as the at-risk list —
// behind_schedule now actually populates instead of always reading 0.
router.get('/api/facilitator/dashboard-stats', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const rows = await getLearnerRiskRows(facilitatorId);

        const attendanceVals = rows.map(r => r.attendance_pct).filter(v => v != null);
        const avgAttendance = attendanceVals.length
            ? Math.round((attendanceVals.reduce((a, b) => a + Number(b), 0) / attendanceVals.length) * 100) / 100
            : null;

        res.json({
            success: true,
            stats: {
                total_learners: rows.length,
                on_track: rows.filter(r => r.risk_level === 'low').length,
                behind_schedule: rows.filter(r => r.risk_level === 'medium').length,
                at_risk: rows.filter(r => r.risk_level === 'high').length,
                avg_attendance: avgAttendance,
            },
        });
    } catch (err) {
        console.error('GET /api/facilitator/dashboard-stats error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
    }
});

// ── GET /api/facilitator/at-risk-learners ────────────────────────
// Returns every learner who is behind on progress (medium/high
// risk_level) OR has poor attendance (<75%), even if their progress is
// otherwise fine — attendance alone is a valid reason to show up here,
// it just doesn't move the on_track/behind_schedule/at_risk counters.
// Raw attendance/progress/expected percentages are sent exactly as the
// database returned them — no rounding.
router.get('/api/facilitator/at-risk-learners', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const rows = await getLearnerRiskRows(facilitatorId);

        const order = { high: 0, medium: 1, low: 2 };
        const learners = rows
            .filter(r => r.risk_level === 'medium' || r.risk_level === 'high' || r.flag_poor_attendance)
            .map(r => ({
                user_id: r.learner_id,
                name: r.name,
                surname: r.surname,
                deal_number: r.deal_number,
                risk_level: r.risk_level,
                attendance_pct: r.attendance_pct,
                attendance_quality: r.attendance_quality,
                progress_pct: r.progress_pct,
                expected_pct: r.expected_pct,
                never_attended: r.never_attended,
                flag_behind_schedule: r.flag_behind_schedule,
                flag_poor_attendance: r.flag_poor_attendance,
                days_since_login: r.days_since_login,
            }))
            .sort((a, b) => order[a.risk_level] - order[b.risk_level] || (a.attendance_pct ?? 999) - (b.attendance_pct ?? 999));

        res.json({ success: true, learners });
    } catch (err) {
        console.error('GET /api/facilitator/at-risk-learners error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch at-risk learners' });
    }
});

// ── GET /api/facilitator/deals/:dealNumber ────────────────────────
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
                e.start_date AS enrolment_start,
                COALESCE(ac.attendance_count, 0) AS attendance_count
             FROM learners l
             JOIN users u ON u.user_id = l.learner_id
             LEFT JOIN enrolments e
                ON e.learner_id = l.learner_id
               AND e.qualification_id = $2
             LEFT JOIN (
                SELECT learner_id, COUNT(*) AS attendance_count
                FROM attendance_records
                GROUP BY learner_id
             ) ac ON ac.learner_id = l.learner_id
             WHERE l.deal_number = $1
             ORDER BY u.name, u.surname`,
            [dealNumber, deal.qualification_id]
        );

        const durationDays = (deal.duration_months || 0) * 30;
        const learners = learnersResult.rows.map(l => {
            let expectedPct = null;
            const startDate = deal.start_date;
            if (startDate && durationDays > 0) {
                const daysElapsed = (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24);
                expectedPct = Math.max(0, Math.min(100, Math.round((daysElapsed / durationDays) * 100)));
            }

            const neverAttended = Number(l.attendance_count) === 0;
            const actualPct = l.progress_pct != null ? Math.round(l.progress_pct) : null;

            let riskStatus = 'on-track';
            if (neverAttended) {
                riskStatus = 'at-risk';
            } else if (actualPct != null && expectedPct != null) {
                const gap = expectedPct - actualPct;
                if (gap > 5) riskStatus = 'at-risk';
                else if (gap > 0) riskStatus = 'watch';
            }

            return {
                ...l,
                expected_pct: expectedPct,
                never_attended: neverAttended,
                risk_status: riskStatus,
            };
        });

        res.json({ success: true, deal, learners });
    } catch (err) {
        console.error('GET /api/facilitator/deals/:dealNumber error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch deal detail' });
    }
});

// ── GET /api/facilitator/learners/:learnerId ─────────────────────
router.get('/api/facilitator/learners/:learnerId', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { learnerId } = req.params;
        if (!uuidRe.test(learnerId)) {
            return res.status(400).json({ success: false, message: 'Invalid learner ID' });
        }

        const result = await pool.query(
            `SELECT
                u.user_id, u.name, u.surname, u.email, u.phone_number,
                u.alternative_number, u.sa_id, u.gender, u.status, u.last_login,
                d.deal_number, d.sponsor, d.start_date AS deal_start_date,
                q.title AS qualification, q.nqf_level, q.duration_months,
                e.start_date AS enrolment_start, e.expected_end_date, e.progress_pct,
                e.employer_name, e.workplace_address,
                rf.risk_level, rf.attendance_pct AS risk_attendance_pct,
                rf.flag_low_attendance, rf.flag_behind_schedule, rf.flag_no_login, rf.flag_poe_overdue,
                COALESCE(ac.attendance_count, 0) AS attendance_count
             FROM learners l
             JOIN users u ON u.user_id = l.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.qualification_id = d.qualification_id
             LEFT JOIN qualifications q ON q.qualification_id = d.qualification_id
             LEFT JOIN learner_risk_flags rf ON rf.learner_id = l.learner_id AND rf.resolved_at IS NULL
             LEFT JOIN (
                SELECT learner_id, COUNT(*) AS attendance_count
                FROM attendance_records
                GROUP BY learner_id
             ) ac ON ac.learner_id = l.learner_id
             WHERE l.learner_id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE`,
            [learnerId, facilitatorId]
        );

        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Learner not found or not in one of your deals' });
        }

        const l = result.rows[0];

        const durationDays = (l.duration_months || 0) * 30;
        let expectedPct = null;
        if (l.deal_start_date && durationDays > 0) {
            const daysElapsed = (Date.now() - new Date(l.deal_start_date).getTime()) / (1000 * 60 * 60 * 24);
            expectedPct = Math.max(0, Math.min(100, Math.round((daysElapsed / durationDays) * 100)));
        }
        const neverAttended = Number(l.attendance_count) === 0;
        const actualPct = l.progress_pct != null ? Math.round(l.progress_pct) : null;

        let riskStatus = 'on-track';
        if (neverAttended) {
            riskStatus = 'at-risk';
        } else if (actualPct != null && expectedPct != null) {
            const gap = expectedPct - actualPct;
            if (gap > 5) riskStatus = 'at-risk';
            else if (gap > 0) riskStatus = 'watch';
        }

        res.json({
            success: true,
            learner: { ...l, expected_pct: expectedPct, never_attended: neverAttended, risk_status: riskStatus },
        });
    } catch (err) {
        console.error('GET /api/facilitator/learners/:learnerId error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch learner detail' });
    }
});

// ── GET /api/facilitator/learners ─────────────────────────────────
// Flat list of this facilitator's learners — used to populate the
// "New message" learner picker.
router.get('/api/facilitator/learners', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const result = await pool.query(
            `SELECT u.user_id, u.name, u.surname, d.deal_number, d.sponsor
             FROM learners l
             JOIN users u ON u.user_id = l.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             WHERE d.facilitator_id = $1 AND d.is_deleted = FALSE
             ORDER BY u.name, u.surname`,
            [facilitatorId]
        );
        res.json({ success: true, learners: result.rows });
    } catch (err) {
        console.error('GET /api/facilitator/learners error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch learners' });
    }
});

// ── GET /api/facilitator/learners/:learnerId/attendance ──────────
router.get('/api/facilitator/learners/:learnerId/attendance', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { learnerId } = req.params;
        if (!uuidRe.test(learnerId)) {
            return res.status(400).json({ success: false, message: 'Invalid learner ID' });
        }

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

// ── Shared helper: recorded attendance + computed missing-scheduled-day absences ──
async function getAttendanceReportRows(facilitatorId, { deal_number, from, to }) {
    const dealFilter = deal_number || null;
    const fromFilter = from || null;
    const toFilter = to || null;

    const recordedResult = await pool.query(
        `SELECT
            u.user_id AS learner_id, u.name, u.surname,
            d.deal_number, d.sponsor,
            ar.attendance_date, ar.status,
            ar.check_in_time, ar.check_out_time,
            ar.geo_verified, ar.checkout_geo_verified,
            FALSE AS is_computed
         FROM attendance_records ar
         JOIN learners l ON l.learner_id = ar.learner_id
         JOIN users u    ON u.user_id = l.learner_id
         JOIN deals d    ON d.deal_number = l.deal_number
         WHERE d.facilitator_id = $1
           AND d.is_deleted = FALSE
           AND ($2::int IS NULL OR d.deal_number = $2)
           AND ($3::date IS NULL OR ar.attendance_date >= $3)
           AND ($4::date IS NULL OR ar.attendance_date <= $4)`,
        [facilitatorId, dealFilter, fromFilter, toFilter]
    );

    let computedRows = [];
    if (fromFilter && toFilter) {
        const scheduledResult = await pool.query(
            `WITH date_range AS (
                SELECT generate_series($3::date, $4::date, interval '1 day')::date AS d
             ),
             scheduled AS (
                SELECT
                    l.learner_id, u.name, u.surname, d.deal_number, d.sponsor,
                    dr.d AS attendance_date
                FROM learners l
                JOIN attendance_schedules sch ON sch.learner_id = l.learner_id
                JOIN users u ON u.user_id = l.learner_id
                JOIN deals d ON d.deal_number = l.deal_number
                CROSS JOIN date_range dr
                WHERE d.facilitator_id = $1
                  AND d.is_deleted = FALSE
                  AND ($2::int IS NULL OR d.deal_number = $2)
                  AND EXTRACT(DOW FROM dr.d)::int IN (sch.day_of_week_1, COALESCE(sch.day_of_week_2, -1))
             )
             SELECT s.*
             FROM scheduled s
             LEFT JOIN attendance_records ar
                ON ar.learner_id = s.learner_id AND ar.attendance_date = s.attendance_date
             WHERE ar.id IS NULL`,
            [facilitatorId, dealFilter, fromFilter, toFilter]
        );

        computedRows = scheduledResult.rows.map(r => ({
            learner_id: r.learner_id,
            name: r.name,
            surname: r.surname,
            deal_number: r.deal_number,
            sponsor: r.sponsor,
            attendance_date: r.attendance_date,
            status: 'absent',
            check_in_time: null,
            check_out_time: null,
            geo_verified: false,
            checkout_geo_verified: false,
            is_computed: true,
        }));
    }

    const rows = [...recordedResult.rows, ...computedRows];
    rows.sort((a, b) => {
        if (a.deal_number !== b.deal_number) return a.deal_number - b.deal_number;
        const nameCmp = `${a.surname}${a.name}`.localeCompare(`${b.surname}${b.name}`);
        if (nameCmp !== 0) return nameCmp;
        return new Date(a.attendance_date) - new Date(b.attendance_date);
    });

    return rows;
}

// ── GET /api/facilitator/attendance?deal_number=&from=&to= ───────
router.get('/api/facilitator/attendance', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { deal_number, from, to } = req.query;

        const rows = await getAttendanceReportRows(facilitatorId, { deal_number, from, to });
        res.json({ success: true, records: rows });
    } catch (err) {
        console.error('GET /api/facilitator/attendance error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch attendance records' });
    }
});

// ── GET /api/facilitator/attendance/report.pdf?deal_number=&from=&to= ─
router.get('/api/facilitator/attendance/report.pdf', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { deal_number, from, to } = req.query;

        if (!from || !to) {
            return res.status(400).json({ success: false, message: 'from and to dates are required' });
        }

        const [rows, facilitatorResult] = await Promise.all([
            getAttendanceReportRows(facilitatorId, { deal_number, from, to }),
            pool.query(`SELECT name, surname FROM users WHERE user_id = $1`, [facilitatorId]),
        ]);

        const facilitator = facilitatorResult.rows[0] || {};

        const fmtDate = d => new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
        const fmtTime = t => t ? new Date(t).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—';

        const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
        const filename = `attendance-report_${from}_to_${to}${deal_number ? `_deal-${deal_number}` : ''}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const cols = [
            { key: 'learner', label: 'Learner',    width: 150 },
            { key: 'deal',    label: 'Deal',        width: 140 },
            { key: 'date',    label: 'Date',        width: 90 },
            { key: 'status',  label: 'Status',       width: 80 },
            { key: 'signin',  label: 'Sign in',      width: 85 },
            { key: 'signout', label: 'Sign out',     width: 85 },
            { key: 'geo',     label: 'Geo verified', width: 90 },
        ];
        const colX = [];
        let cursor = doc.page.margins.left;
        cols.forEach(c => { colX.push(cursor); cursor += c.width; });

        function drawHeader(y) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e1e1f');
            cols.forEach((c, i) => doc.text(c.label, colX[i], y, { width: c.width }));
            doc.font('Helvetica').fillColor('#1f1f1f');
            doc.moveTo(doc.page.margins.left, y + 14)
               .lineTo(doc.page.margins.left + pageWidth, y + 14)
               .strokeColor('#d4d4cf').lineWidth(0.5).stroke();
        }

        doc.font('Helvetica-Bold').fontSize(16).fillColor('#171717')
           .text('Nkanyezi Academy — Attendance Report', doc.page.margins.left, doc.y);
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9).fillColor('#5b5b58')
           .text(`Facilitator: ${facilitator.name || ''} ${facilitator.surname || ''}`)
           .text(`Period: ${fmtDate(from)} — ${fmtDate(to)}`)
           .text(deal_number ? `Deal: #${deal_number}` : 'All assigned deals')
           .text(`Generated: ${new Date().toLocaleString('en-ZA')}`)
           .text('* = no captured record for a scheduled day, shown as absent automatically', { oblique: true });
        doc.moveDown(0.8);

        let y = doc.y;
        drawHeader(y);
        y += 20;

        if (!rows.length) {
            doc.fontSize(10).fillColor('#8d8d89').text('No attendance records found for this period.', doc.page.margins.left, y);
        }

        rows.forEach(r => {
            if (y > doc.page.height - doc.page.margins.bottom - 30) {
                doc.addPage();
                y = doc.page.margins.top;
                drawHeader(y);
                y += 20;
            }
            doc.fontSize(9).fillColor(r.is_computed ? '#b45309' : '#1f1f1f');
            doc.text(`${r.name} ${r.surname}`, colX[0], y, { width: cols[0].width });
            doc.text(`#${r.deal_number} ${r.sponsor || ''}`, colX[1], y, { width: cols[1].width });
            doc.text(fmtDate(r.attendance_date), colX[2], y, { width: cols[2].width });
            doc.text(r.is_computed ? `${r.status}*` : r.status, colX[3], y, { width: cols[3].width });
            doc.text(fmtTime(r.check_in_time), colX[4], y, { width: cols[4].width });
            doc.text(fmtTime(r.check_out_time), colX[5], y, { width: cols[5].width });
            doc.text(r.geo_verified ? 'Yes' : 'No', colX[6], y, { width: cols[6].width });
            y += 16;
        });

        doc.end();
    } catch (err) {
        console.error('GET /api/facilitator/attendance/report.pdf error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate PDF report' });
    }
});

// ── GET /api/facilitator/submissions?status=&deal_number=&search= ─
// NOTE: this grades the OLDER assessments/assessment_submissions system.
// The NEW projects/project_submissions system (below) is a separate,
// unrelated table pair — see /api/facilitator/project-submissions.
router.get('/api/facilitator/submissions', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { status, deal_number, search } = req.query;

        const conditions = ['d.facilitator_id = $1', 'd.is_deleted = FALSE'];
        const values = [facilitatorId];
        let idx = 2;

        if (status && status !== 'all') {
            conditions.push(`asub.status = $${idx++}`);
            values.push(status);
        }
        if (deal_number) {
            conditions.push(`d.deal_number = $${idx++}`);
            values.push(deal_number);
        }
        if (search && search.trim()) {
            conditions.push(`(
                u.name ILIKE $${idx} OR
                u.surname ILIKE $${idx} OR
                a.title ILIKE $${idx}
            )`);
            values.push(`%${search.trim()}%`);
            idx++;
        }

        const result = await pool.query(
            `SELECT
                asub.id,
                asub.submitted_at,
                asub.score,
                asub.feedback,
                asub.file_url,
                asub.status,
                a.id AS assessment_id,
                a.title AS assessment_title,
                a.assessment_type,
                a.max_score,
                a.pass_mark,
                un.unit_number,
                un.title AS unit_title,
                u.user_id AS learner_id,
                u.name, u.surname,
                d.deal_number, d.sponsor
             FROM assessment_submissions asub
             JOIN learners l ON l.learner_id = asub.learner_id
             JOIN users u ON u.user_id = l.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             JOIN assessments a ON a.id = asub.assessment_id
             JOIN units un ON un.id = a.unit_id
             WHERE ${conditions.join(' AND ')} AND asub.submitted_at IS NOT NULL
             ORDER BY asub.submitted_at ASC`,
            values
        );

        res.json({ success: true, submissions: result.rows });
    } catch (err) {
        console.error('GET /api/facilitator/submissions error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch submissions' });
    }
});

// ── POST /api/facilitator/submissions/:id/grade ───────────────────
router.post('/api/facilitator/submissions/:id/grade', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { id } = req.params;
        const { score, feedback } = req.body;

        if (!uuidRe.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid submission ID' });
        }
        if (score === undefined || score === null || Number.isNaN(Number(score))) {
            return res.status(400).json({ success: false, message: 'A numeric score is required' });
        }

        const owns = await pool.query(
            `SELECT asub.id, a.max_score
             FROM assessment_submissions asub
             JOIN learners l ON l.learner_id = asub.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             JOIN assessments a ON a.id = asub.assessment_id
             WHERE asub.id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE`,
            [id, facilitatorId]
        );
        if (!owns.rows.length) {
            return res.status(404).json({ success: false, message: 'Submission not found or not one of your learners' });
        }
        const maxScore = owns.rows[0].max_score;
        if (maxScore != null && Number(score) > Number(maxScore)) {
            return res.status(400).json({ success: false, message: `Score cannot exceed ${maxScore}` });
        }

        await pool.query(
            `UPDATE assessment_submissions
             SET score = $1, feedback = $2, graded_by = $3, graded_at = NOW(), status = 'graded'
             WHERE id = $4`,
            [score, feedback || null, facilitatorId, id]
        );

        res.json({ success: true, message: 'Submission graded' });
    } catch (err) {
        console.error('POST /api/facilitator/submissions/:id/grade error:', err);
        if (err.code === '23503') {
            return res.status(400).json({
                success: false,
                message: 'graded_by foreign key still points to assessors — see the schema note for the required ALTER TABLE.',
            });
        }
        res.status(500).json({ success: false, message: 'Failed to grade submission' });
    }
});

// ═══════════════════════ PROJECT GRADING (new system) ═══════════════════════
// Grades projects/project_submissions — the table pair the quiz/grade-
// weighting work (40% quiz / 60% project) is actually built on. This is
// deliberately kept separate from /api/facilitator/submissions above
// rather than merged, since that endpoint grades a different, older
// table pair (assessments/assessment_submissions) with its own schema.

// ── GET /api/facilitator/project-submissions?status=&deal_number=&search= ──
// Only shows submissions the learner has actually submitted (drafts —
// files staged but not yet locked in — are never visible to a facilitator).
router.get('/api/facilitator/project-submissions', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { status, deal_number, search } = req.query;

        const conditions = ["d.facilitator_id = $1", "d.is_deleted = FALSE", "ps.status IN ('submitted','graded')"];
        const values = [facilitatorId];
        let idx = 2;

        if (status && status !== 'all') {
            conditions.push(`ps.status = $${idx++}`);
            values.push(status);
        }
        if (deal_number) {
            conditions.push(`d.deal_number = $${idx++}`);
            values.push(deal_number);
        }
        if (search && search.trim()) {
            conditions.push(`(u.name ILIKE $${idx} OR u.surname ILIKE $${idx} OR p.title ILIKE $${idx})`);
            values.push(`%${search.trim()}%`);
            idx++;
        }

        const result = await pool.query(
            `SELECT
                ps.id, ps.attempt_number, ps.submitted_at, ps.status, ps.score, ps.feedback,
                ps.file_url AS submission_blob, ps.file_name AS submission_file_name,
                p.id AS project_id, p.title AS project_title, p.total_marks, p.pass_mark_pct,
                un.unit_number, un.title AS unit_title,
                u.user_id AS learner_id, u.name, u.surname,
                d.deal_number, d.sponsor
             FROM project_submissions ps
             JOIN projects p ON p.id = ps.project_id
             JOIN units un ON un.id = p.unit_id
             JOIN learners l ON l.learner_id = ps.learner_id
             JOIN users u ON u.user_id = l.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             WHERE ${conditions.join(' AND ')}
             ORDER BY ps.submitted_at ASC`,
            values
        );

        const submissions = result.rows.map(r => ({
            ...r,
            file_url: r.submission_blob ? getSasUrl(r.submission_blob) : null,
        }));

        res.json({ success: true, submissions });
    } catch (err) {
        console.error('GET /api/facilitator/project-submissions error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch project submissions' });
    }
});

// ── GET /api/facilitator/project-submissions/:id ────────────────────
// Full detail for the grading page: learner info, project brief +
// submission file (both as signed download links), marks/pass mark,
// and the current grade if this has been graded already (so the page
// can pre-fill and support re-grading).
router.get('/api/facilitator/project-submissions/:id', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { id } = req.params;
        if (!uuidRe.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid submission ID' });
        }

        const result = await pool.query(
            `SELECT
                ps.id, ps.submitted_at, ps.status, ps.score, ps.feedback,
                ps.file_url AS submission_file_url, ps.file_name AS submission_file_name, ps.file_size_bytes,
                p.id AS project_id, p.title AS project_title, p.description AS project_description,
                p.total_marks, p.pass_mark_pct, p.duration_days,
                p.brief_file_url, p.brief_file_name,
                un.unit_number, un.title AS unit_title, un.qualification_id,
                u.user_id AS learner_id, u.name, u.surname, u.email,
                d.deal_number, d.sponsor
             FROM project_submissions ps
             JOIN projects p ON p.id = ps.project_id
             JOIN units un ON un.id = p.unit_id
             JOIN learners l ON l.learner_id = ps.learner_id
             JOIN users u ON u.user_id = l.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             WHERE ps.id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE
               AND ps.status IN ('submitted','graded')`,
            [id, facilitatorId]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Submission not found or not one of your learners' });
        }
        const s = result.rows[0];

        res.json({
            success: true,
            submission: {
                ...s,
                submission_file_download_url: s.submission_file_url
                    ? getSasUrl(s.submission_file_url, { download: true, fileName: s.submission_file_name })
                    : null,
                submission_file_view_url: s.submission_file_url
                    ? getSasUrl(s.submission_file_url)
                    : null,
                brief_url: s.brief_file_url
                    ? getSasUrl(s.brief_file_url, { download: true, fileName: s.brief_file_name })
                    : null,
            },
        });
    } catch (err) {
        console.error('GET /api/facilitator/project-submissions/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch submission detail' });
    }
});

// ── POST /api/facilitator/project-submissions/:id/grade ─────────────
// Sets score + feedback, marks the submission 'graded', and immediately
// syncs the learner's enrolments.progress_pct — this is the piece the
// dashboard progress bar needed all along: a graded project now updates
// it exactly like a graded quiz already does.
router.post('/api/facilitator/project-submissions/:id/grade', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { id } = req.params;
        const { score, feedback } = req.body;

        if (!uuidRe.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid submission ID' });
        }
        if (score === undefined || score === null || Number.isNaN(Number(score))) {
            return res.status(400).json({ success: false, message: 'A numeric score is required' });
        }

        const owns = await pool.query(
            `SELECT ps.id, ps.learner_id, p.total_marks, un.qualification_id
             FROM project_submissions ps
             JOIN projects p ON p.id = ps.project_id
             JOIN units un ON un.id = p.unit_id
             JOIN learners l ON l.learner_id = ps.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             WHERE ps.id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE
               AND ps.status IN ('submitted','graded')`,
            [id, facilitatorId]
        );
        if (!owns.rows.length) {
            return res.status(404).json({ success: false, message: 'Submission not found or not one of your learners' });
        }
        const { learner_id: learnerId, total_marks: totalMarks, qualification_id: qualificationId } = owns.rows[0];
        if (Number(score) > Number(totalMarks) || Number(score) < 0) {
            return res.status(400).json({ success: false, message: `Score must be between 0 and ${totalMarks}` });
        }

        await pool.query(
            `UPDATE project_submissions
             SET score = $1, feedback = $2, graded_by = $3, graded_at = NOW(), status = 'graded'
             WHERE id = $4`,
            [score, feedback || null, facilitatorId, id]
        );

        try {
            await syncEnrolmentProgress(pool, learnerId, qualificationId);
        } catch (syncErr) {
            console.error('syncEnrolmentProgress error (grade was still saved):', syncErr);
        }

        res.json({ success: true, message: 'Project graded' });
    } catch (err) {
        console.error('POST /api/facilitator/project-submissions/:id/grade error:', err);
        res.status(500).json({ success: false, message: 'Failed to grade project' });
    }
});

// ═══════════════════════ MATERIALS ACCESS (view-only) ═══════════════════════
// Facilitators can view/preview materials for qualifications tied to
// their own deals — no upload/manage capability, just the same
// view-only rows learners see. Mirrors the shape of the learner/admin
// materials endpoints in routes/materials.js so materials.js's existing
// unit-accordion rendering (renderUnit(unit, false)) works unmodified.

// ── GET /api/facilitator/qualifications ──────────────────────────
// Distinct qualifications across this facilitator's deals, for the
// materials page's qualification picker.
router.get('/api/facilitator/qualifications', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const result = await pool.query(
            `SELECT DISTINCT q.qualification_id AS id, q.title, q.nqf_level
             FROM deals d
             JOIN qualifications q ON q.qualification_id = d.qualification_id
             WHERE d.facilitator_id = $1 AND d.is_deleted = FALSE
             ORDER BY q.title`,
            [facilitatorId]
        );
        res.json({ success: true, qualifications: result.rows });
    } catch (err) {
        console.error('GET /api/facilitator/qualifications error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch qualifications' });
    }
});

// ── GET /api/facilitator/qualifications/:qualId/units ────────────
// Bare units list (no materials nested) — same two-step pattern the
// admin materials browser already uses: fetch units here, then fetch
// each unit's materials via the existing GET /api/units/:unitId/materials.
router.get('/api/facilitator/qualifications/:qualId/units', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { qualId } = req.params;
        if (!uuidRe.test(qualId)) {
            return res.status(400).json({ success: false, message: 'Invalid qualification ID' });
        }

        const owns = await pool.query(
            `SELECT 1 FROM deals WHERE facilitator_id = $1 AND qualification_id = $2 AND is_deleted = FALSE LIMIT 1`,
            [facilitatorId, qualId]
        );
        if (!owns.rows.length) {
            return res.status(404).json({ success: false, message: 'Qualification not found among your deals' });
        }

        const result = await pool.query(
            `SELECT id, unit_number, title FROM units WHERE qualification_id = $1 ORDER BY unit_number`,
            [qualId]
        );
        res.json({ success: true, units: result.rows });
    } catch (err) {
        console.error('GET /api/facilitator/qualifications/:qualId/units error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch units' });
    }
});

// ── GET /api/facilitator/materials/:materialId/view?download=1 ───
// Signed URL only — no material_views insert (that table tracks
// learner completion progress, which doesn't apply to a facilitator
// previewing a file). Mirrors the admin equivalent in routes/materials.js.
router.get('/api/facilitator/materials/:materialId/view', async (req, res) => {
    try {
        const { materialId } = req.params;
        const wantsDownload = req.query.download === '1';

        const { rows } = await pool.query(
            `SELECT id, file_url, file_name, title FROM materials WHERE id = $1`,
            [materialId]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Material not found' });

        const url = getSasUrl(rows[0].file_url, { download: wantsDownload, fileName: rows[0].file_name });
        res.json({ success: true, url, file_name: rows[0].file_name });
    } catch (err) {
        console.error('GET /api/facilitator/materials/:materialId/view error:', err);
        res.status(500).json({ success: false, message: 'Failed to open material' });
    }
});

// ── GET /api/facilitator/learners/:learnerId/feedback/draft ──────
router.get('/api/facilitator/learners/:learnerId/feedback/draft', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { learnerId } = req.params;
        if (!uuidRe.test(learnerId)) {
            return res.status(400).json({ success: false, message: 'Invalid learner ID' });
        }

        const learnerResult = await pool.query(
            `SELECT
                u.name, u.email,
                d.deal_number, d.start_date AS deal_start_date,
                q.title AS qualification, q.duration_months,
                e.progress_pct,
                COALESCE(ac.attendance_count, 0) AS attendance_count
             FROM learners l
             JOIN users u ON u.user_id = l.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             LEFT JOIN qualifications q ON q.qualification_id = d.qualification_id
             LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.qualification_id = d.qualification_id
             LEFT JOIN (
                SELECT learner_id, COUNT(*) AS attendance_count FROM attendance_records GROUP BY learner_id
             ) ac ON ac.learner_id = l.learner_id
             WHERE l.learner_id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE`,
            [learnerId, facilitatorId]
        );
        if (!learnerResult.rows.length) {
            return res.status(404).json({ success: false, message: 'Learner not found or not in one of your deals' });
        }
        const l = learnerResult.rows[0];

        const durationDays = (l.duration_months || 0) * 30;
        let expectedPct = null;
        if (l.deal_start_date && durationDays > 0) {
            const daysElapsed = (Date.now() - new Date(l.deal_start_date).getTime()) / (1000 * 60 * 60 * 24);
            expectedPct = Math.max(0, Math.min(100, Math.round((daysElapsed / durationDays) * 100)));
        }
        const neverAttended = Number(l.attendance_count) === 0;
        const actualPct = l.progress_pct != null ? Math.round(l.progress_pct) : null;

        let riskStatus = 'on-track';
        if (neverAttended) {
            riskStatus = 'at-risk';
        } else if (actualPct != null && expectedPct != null) {
            const gap = expectedPct - actualPct;
            if (gap > 5) riskStatus = 'at-risk';
            else if (gap > 0) riskStatus = 'watch';
        }

        const [statsResult, absentDayResult, facilitatorResult] = await Promise.all([
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE status IN ('present','late')) AS present_count,
                    COUNT(*) FILTER (WHERE status = 'late') AS late_count,
                    COUNT(*) FILTER (WHERE status = 'absent') AS absent_count,
                    COUNT(*) AS total_count,
                    ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('present','late')) / NULLIF(COUNT(*),0), 0) AS rate_pct
                 FROM attendance_records WHERE learner_id = $1`,
                [learnerId]
            ),
            pool.query(
                `SELECT EXTRACT(DOW FROM attendance_date)::int AS dow, COUNT(*) AS cnt
                 FROM attendance_records
                 WHERE learner_id = $1 AND status = 'absent'
                 GROUP BY dow ORDER BY cnt DESC LIMIT 1`,
                [learnerId]
            ),
            pool.query(`SELECT name, surname FROM users WHERE user_id = $1`, [facilitatorId]),
        ]);

        const attendance = {
            ...statsResult.rows[0],
            mostAbsentDayIndex: absentDayResult.rows[0] ? absentDayResult.rows[0].dow : null,
        };
        const facilitator = facilitatorResult.rows[0];

        const draft = generateFeedbackDraft({
            learnerFirstName: l.name,
            qualificationTitle: l.qualification,
            riskStatus,
            neverAttended,
            actualPct,
            expectedPct,
            attendance,
            facilitatorName: `${facilitator.name} ${facilitator.surname}`,
        });

        res.json({
            success: true,
            draft,
            context: { riskStatus, neverAttended, actualPct, expectedPct, learnerEmail: l.email },
        });
    } catch (err) {
        console.error('GET .../feedback/draft error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate feedback draft' });
    }
});

// ── POST /api/facilitator/learners/:learnerId/feedback/send ──────
router.post('/api/facilitator/learners/:learnerId/feedback/send', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { learnerId } = req.params;
        const { subject, message } = req.body;

        if (!uuidRe.test(learnerId)) {
            return res.status(400).json({ success: false, message: 'Invalid learner ID' });
        }
        if (!subject || !subject.trim() || !message || !message.trim()) {
            return res.status(400).json({ success: false, message: 'Subject and message are required' });
        }

        const result = await pool.query(
            `SELECT
                u.email, u.name, d.qualification_id,
                (SELECT id FROM enrolments
                  WHERE learner_id = l.learner_id AND qualification_id = d.qualification_id
                  LIMIT 1) AS enrolment_id
             FROM learners l
             JOIN users u ON u.user_id = l.learner_id
             JOIN deals d ON d.deal_number = l.deal_number
             WHERE l.learner_id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE`,
            [learnerId, facilitatorId]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Learner not found or not in one of your deals' });
        }
        const learner = result.rows[0];
        if (!learner.email) {
            return res.status(400).json({ success: false, message: 'This learner has no email address on file' });
        }

        const facilitatorResult = await pool.query(`SELECT name, surname, email FROM users WHERE user_id = $1`, [facilitatorId]);
        const facilitator = facilitatorResult.rows[0];
        if (!facilitator.email) {
            return res.status(400).json({ success: false, message: 'Your facilitator account has no email address on file — cannot send from it' });
        }

        await sendLearnerFeedbackEmail({
            to: learner.email,
            subject,
            message,
            facilitatorName: `${facilitator.name} ${facilitator.surname}`,
            facilitatorEmail: facilitator.email,
        });

        // facilitator_id added — required now that it's NOT NULL on the feedback table
        await pool.query(
            `INSERT INTO feedback (from_user_id, to_learner_id, facilitator_id, enrolment_id, feedback_type, subject, message, is_auto_generated, sent_at, delivery_method)
             VALUES ($1, $2, $3, $4, 'progress', $5, $6, TRUE, NOW(), 'email')`,
            [facilitatorId, learnerId, facilitatorId, learner.enrolment_id || null, subject, message]
        );

        res.json({ success: true, message: `Feedback email sent to ${learner.email}` });
    } catch (err) {
        console.error('POST .../feedback/send error:', err);
        res.status(500).json({ success: false, message: 'Failed to send feedback email: ' + err.message });
    }
});

// ── GET /api/facilitator/feedback/history?search=&deal_number= ───
router.get('/api/facilitator/feedback/history', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { search, deal_number } = req.query;

        const conditions = ['f.from_user_id = $1'];
        const values = [facilitatorId];
        let idx = 2;

        if (deal_number) {
            conditions.push(`d.deal_number = $${idx++}`);
            values.push(deal_number);
        }
        if (search && search.trim()) {
            conditions.push(`(
                receiver.name ILIKE $${idx} OR
                receiver.surname ILIKE $${idx} OR
                f.subject ILIKE $${idx}
            )`);
            values.push(`%${search.trim()}%`);
            idx++;
        }

        const result = await pool.query(
            `SELECT
                f.id,
                f.subject,
                f.message,
                f.feedback_type,
                f.is_auto_generated,
                f.sent_at,
                f.created_at,
                sender.name AS sender_name, sender.surname AS sender_surname, sender.email AS sender_email,
                receiver.user_id AS receiver_id,
                receiver.name AS receiver_name, receiver.surname AS receiver_surname, receiver.email AS receiver_email,
                d.deal_number, d.sponsor
             FROM feedback f
             JOIN users sender    ON sender.user_id = f.from_user_id
             JOIN learners l      ON l.learner_id = f.to_learner_id
             JOIN users receiver  ON receiver.user_id = l.learner_id
             LEFT JOIN deals d    ON d.deal_number = l.deal_number
             WHERE ${conditions.join(' AND ')}
             ORDER BY COALESCE(f.sent_at, f.created_at) DESC`,
            values
        );

        res.json({ success: true, history: result.rows });
    } catch (err) {
        console.error('GET /api/facilitator/feedback/history error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch feedback history' });
    }
});

// ── GET /api/facilitator/messages ─────────────────────────────────
// All two-way threads (root messages + replies, both directions) across
// this facilitator's learners. Separate from feedback/history above, which
// stays as the log of categorized progress feedback the facilitator sent.
router.get('/api/facilitator/messages', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const result = await pool.query(
            `SELECT
                f.id, f.parent_id, f.subject, f.message, f.feedback_type, f.from_role,
                f.to_learner_id,
                COALESCE(f.sent_at, f.created_at) AS sent_at,
                sender.name AS from_name, sender.surname AS from_surname,
                learner_u.name AS learner_name, learner_u.surname AS learner_surname,
                d.deal_number, d.sponsor
             FROM feedback f
             JOIN users sender    ON sender.user_id = f.from_user_id
             JOIN learners l      ON l.learner_id = f.to_learner_id
             JOIN users learner_u ON learner_u.user_id = l.learner_id
             JOIN deals d         ON d.deal_number = l.deal_number
             WHERE f.facilitator_id = $1 AND d.is_deleted = FALSE
             ORDER BY COALESCE(f.sent_at, f.created_at) ASC`,
            [facilitatorId]
        );
        res.json({ success: true, messages: result.rows });
    } catch (err) {
        console.error('GET /api/facilitator/messages error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch messages' });
    }
});

// ── POST /api/facilitator/messages ────────────────────────────────
// Start a new thread to a specific learner — a quick message, distinct
// from the categorized draft/email feedback flow above.
router.post('/api/facilitator/messages', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { learnerId, subject, message } = req.body;
        if (!uuidRe.test(learnerId || '')) {
            return res.status(400).json({ success: false, message: 'Invalid learner ID' });
        }
        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: 'Message cannot be empty' });
        }

        const owns = await pool.query(
            `SELECT 1 FROM learners l JOIN deals d ON d.deal_number = l.deal_number
             WHERE l.learner_id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE`,
            [learnerId, facilitatorId]
        );
        if (!owns.rows.length) {
            return res.status(404).json({ success: false, message: 'Learner not found or not in one of your deals' });
        }

        const inserted = await pool.query(
            `INSERT INTO feedback (from_user_id, to_learner_id, facilitator_id, from_role, feedback_type, subject, message, is_auto_generated, sent_at, delivery_method)
             VALUES ($1, $2, $3, 'facilitator', 'message', $4, $5, FALSE, NOW(), 'in-app')
             RETURNING id, parent_id, subject, message, from_role, sent_at`,
            [facilitatorId, learnerId, facilitatorId, subject?.trim() || null, message.trim()]
        );

        res.json({ success: true, message: inserted.rows[0] });
    } catch (err) {
        console.error('POST /api/facilitator/messages error:', err);
        res.status(500).json({ success: false, message: 'Failed to send message' });
    }
});

// ── POST /api/facilitator/messages/:id/reply ──────────────────────
router.post('/api/facilitator/messages/:id/reply', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
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
        if (String(target.facilitator_id) !== String(facilitatorId)) {
            return res.status(403).json({ success: false, message: 'Not your message thread' });
        }
        const rootId = target.parent_id || target.id;

        const inserted = await pool.query(
            `INSERT INTO feedback (from_user_id, to_learner_id, facilitator_id, from_role, feedback_type, parent_id, message, is_auto_generated, sent_at, delivery_method)
             VALUES ($1, $2, $3, 'facilitator', 'message', $4, $5, FALSE, NOW(), 'in-app')
             RETURNING id, parent_id, subject, message, from_role, sent_at`,
            [facilitatorId, target.to_learner_id, facilitatorId, rootId, message.trim()]
        );

        res.json({ success: true, message: inserted.rows[0] });
    } catch (err) {
        console.error('POST /api/facilitator/messages/:id/reply error:', err);
        res.status(500).json({ success: false, message: 'Failed to send reply' });
    }
});

// ── GET /api/facilitator/learners/:learnerId/submissions ─────────
router.get('/api/facilitator/learners/:learnerId/submissions', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { learnerId } = req.params;
        if (!uuidRe.test(learnerId)) {
            return res.status(400).json({ success: false, message: 'Invalid learner ID' });
        }

        const owns = await pool.query(
            `SELECT 1 FROM learners l JOIN deals d ON d.deal_number = l.deal_number
             WHERE l.learner_id = $1 AND d.facilitator_id = $2 AND d.is_deleted = FALSE`,
            [learnerId, facilitatorId]
        );
        if (!owns.rows.length) {
            return res.status(404).json({ success: false, message: 'Learner not found or not in one of your deals' });
        }

        const result = await pool.query(
            `SELECT
                asub.id, asub.submitted_at, asub.score, asub.feedback, asub.file_url, asub.status,
                a.title AS assessment_title, a.assessment_type, a.max_score, a.pass_mark,
                un.unit_number, un.title AS unit_title
             FROM assessment_submissions asub
             JOIN assessments a ON a.id = asub.assessment_id
             JOIN units un ON un.id = a.unit_id
             WHERE asub.learner_id = $1
             ORDER BY asub.submitted_at DESC NULLS LAST, asub.created_at DESC`,
            [learnerId]
        );

        res.json({ success: true, submissions: result.rows });
    } catch (err) {
        console.error('GET .../learners/:learnerId/submissions error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch learner submissions' });
    }
});

// ── GET /api/facilitator/learners/:learnerId/compliance-report.pdf ─
// Layout notes (updated):
//   - More vertical breathing room after the profile header block
//     before the first section title.
//   - sectionTitle now leaves more space above/below the underline.
//   - Table rows are taller (18px vs 14px) and zebra-striped for
//     readability; headers get more clearance below their rule.
router.get('/api/facilitator/learners/:learnerId/compliance-report.pdf', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { learnerId } = req.params;
        if (!uuidRe.test(learnerId)) {
            return res.status(400).json({ success: false, message: 'Invalid learner ID' });
        }

        const profileResult = await pool.query(
            `SELECT * FROM learner_compliance_profile WHERE learner_id = $1 AND facilitator_id = $2`,
            [learnerId, facilitatorId]
        );
        if (!profileResult.rows.length) {
            return res.status(404).json({ success: false, message: 'Learner not found or not in one of your deals' });
        }
        const profile = profileResult.rows[0];

        const [attendanceResult, feedbackResult, unitsResult] = await Promise.all([
            pool.query(`SELECT * FROM learner_attendance_log WHERE learner_id = $1`, [learnerId]),
            pool.query(`SELECT * FROM learner_feedback_history WHERE learner_id = $1`, [learnerId]),
            pool.query(`SELECT * FROM learner_unit_grades WHERE learner_id = $1`, [learnerId]),
        ]);
        const attendance = attendanceResult.rows;
        const feedback = feedbackResult.rows;
        const units = unitsResult.rows;

        const fmtDate = d => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
        const fmtDateTime = d => d ? new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        const fmtTime = t => t ? new Date(t).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—';

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const filename = `compliance-report_${profile.surname}-${profile.name}_${new Date().toISOString().slice(0, 10)}.pdf`
            .replace(/\s+/g, '-');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        const marginLeft = doc.page.margins.left;
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const pageBottom = doc.page.height - doc.page.margins.bottom;

        function ensureSpace(needed) {
            if (doc.y + needed > pageBottom) doc.addPage();
        }

        function sectionTitle(text) {
            ensureSpace(36);
            doc.moveDown(1);
            doc.font('Helvetica-Bold').fontSize(12).fillColor('#171717').text(text);
            doc.moveDown(0.3);
            doc.moveTo(marginLeft, doc.y).lineTo(marginLeft + pageWidth, doc.y)
               .strokeColor('#d4d4cf').lineWidth(0.5).stroke();
            doc.moveDown(0.6);
        }

        function drawTable(cols, rows, rowRenderer, emptyText) {
            const colX = [];
            let cursor = marginLeft;
            cols.forEach(c => { colX.push(cursor); cursor += c.width; });

            function drawHeader() {
                ensureSpace(24);
                doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e1e1f');
                cols.forEach((c, i) => doc.text(c.label, colX[i], doc.y, { width: c.width }));
                doc.moveDown(0.5);
                doc.moveTo(marginLeft, doc.y).lineTo(marginLeft + pageWidth, doc.y)
                   .strokeColor('#e5e5e0').lineWidth(0.5).stroke();
                doc.moveDown(0.5);
            }

            drawHeader();
            if (!rows.length) {
                doc.font('Helvetica').fontSize(9).fillColor('#8d8d89').text(emptyText);
                doc.moveDown(0.4);
                return;
            }

            doc.font('Helvetica').fontSize(8.5).fillColor('#1f1f1f');
            rows.forEach((row, i) => {
                ensureSpace(20);
                const y = doc.y;

                if (i % 2 === 1) {
                    doc.save();
                    doc.rect(marginLeft, y - 3, pageWidth, 18).fillOpacity(0.04).fill('#000000');
                    doc.restore();
                    doc.fillColor('#1f1f1f');
                }

                const cells = rowRenderer(row);
                cells.forEach((val, j) => doc.text(val, colX[j], y, { width: cols[j].width }));
                doc.y = y + 18;

                if (doc.y > pageBottom - 20) { doc.addPage(); drawHeader(); }
            });
            doc.moveDown(0.4);
        }

        doc.font('Helvetica-Bold').fontSize(16).fillColor('#171717')
           .text('Nkanyezi Academy — Learner Compliance Report');
        doc.moveDown(0.8);

        doc.font('Helvetica-Bold').fontSize(11).fillColor('#171717')
           .text(`${profile.name} ${profile.surname}`);
        doc.moveDown(0.2);
        doc.font('Helvetica').fontSize(9).fillColor('#5b5b58')
           .text(`ID number: ${profile.id_number || '—'}`)
           .text(`Email: ${profile.email || '—'}`)
           .text(`Qualification: ${profile.qualification_title || '—'} (${profile.nqf_level || '—'})`)
           .text(`SETA: ${profile.seta || '—'}`)
           .text(`Deal: #${profile.deal_number ?? '—'} — ${profile.sponsor || ''}`)
           .text(`Enrolment status: ${profile.enrolment_status || '—'} · Progress: ${profile.progress_pct != null ? Math.round(profile.progress_pct) + '%' : '—'}`)
           .text(`Generated: ${new Date().toLocaleString('en-ZA')}`);

        doc.moveDown(1.2);

        sectionTitle('Attendance log');
        drawTable(
            [
                { label: 'Date', width: 90 },
                { label: 'Status', width: 80 },
                { label: 'Sign in', width: 90 },
                { label: 'Sign out', width: 90 },
                { label: 'Geo verified', width: 100 },
            ],
            attendance,
            r => [fmtDate(r.attendance_date), r.status, fmtTime(r.check_in_time), fmtTime(r.check_out_time), r.geo_verified ? 'Yes' : 'No'],
            'No attendance records on file.'
        );

        sectionTitle('Feedback history');
        drawTable(
            [
                { label: 'Date', width: 110 },
                { label: 'From', width: 110 },
                { label: 'Type', width: 80 },
                { label: 'Subject', width: 150 },
            ],
            feedback,
            r => [fmtDateTime(r.sent_at || r.created_at), `${r.sender_name} ${r.sender_surname}`, r.feedback_type, r.subject || '—'],
            'No feedback sent yet.'
        );

        sectionTitle('Units — submissions and grades');
        drawTable(
            [
                { label: 'Unit', width: 30 },
                { label: 'Assessment', width: 150 },
                { label: 'Submitted', width: 80 },
                { label: 'Score', width: 60 },
                { label: 'Graded', width: 60 },
                { label: 'Status', width: 80 },
            ],
            units,
            r => [
                String(r.unit_number),
                r.assessment_title,
                fmtDate(r.submitted_at),
                `${Math.round(r.score)} / ${r.max_score}`,
                r.is_graded ? 'Yes' : 'No (0)',
                r.submission_status,
            ],
            'No assessments found for this qualification.'
        );

        doc.end();
    } catch (err) {
        console.error('GET .../compliance-report.pdf error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate compliance report' });
    }
});

module.exports = router;