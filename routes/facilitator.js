const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');
const PDFDocument = require('pdfkit');

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

        // Expected progress = how far through the qualification's duration the
        // cohort should be by now, based on the DEAL's start date (uniform
        // across the roster rather than each learner's individual enrolment date).
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

            // Risk status:
            //  - never signed attendance at all -> flagged regardless of progress
            //  - any gap behind expected -> at least "watch" (amber)
            //  - gap of more than 5 points -> "at risk", needs immediate intervention
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

        // Same expected-% and risk logic as the deal roster, computed live off
        // the deal's start date rather than the (potentially stale) risk_flags table.
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

// ── GET /api/facilitator/attendance/report.pdf?deal_number=&from=&to= ─
// Generates a downloadable PDF attendance report (sign-in / sign-out) for a
// date range — the front end drives this with week/month presets or a
// custom range, then hands the two dates straight through here.
router.get('/api/facilitator/attendance/report.pdf', async (req, res) => {
    try {
        const facilitatorId = req.session.user.id;
        const { deal_number, from, to } = req.query;

        if (!from || !to) {
            return res.status(400).json({ success: false, message: 'from and to dates are required' });
        }

        const conditions = [
            'd.facilitator_id = $1', 'd.is_deleted = FALSE',
            'ar.attendance_date >= $2', 'ar.attendance_date <= $3',
        ];
        const values = [facilitatorId, from, to];
        let idx = 4;

        if (deal_number) {
            conditions.push(`d.deal_number = $${idx++}`);
            values.push(deal_number);
        }

        const [recordsResult, facilitatorResult] = await Promise.all([
            pool.query(
                `SELECT
                    u.name, u.surname,
                    d.deal_number, d.sponsor,
                    ar.attendance_date, ar.status,
                    ar.check_in_time, ar.check_out_time,
                    ar.geo_verified, ar.checkout_geo_verified
                 FROM attendance_records ar
                 JOIN learners l ON l.learner_id = ar.learner_id
                 JOIN users u    ON u.user_id = l.learner_id
                 JOIN deals d    ON d.deal_number = l.deal_number
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY d.deal_number, u.surname, u.name, ar.attendance_date`,
                values
            ),
            pool.query(`SELECT name, surname FROM users WHERE user_id = $1`, [facilitatorId]),
        ]);

        const rows = recordsResult.rows;
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
            { key: 'status',  label: 'Status',       width: 70 },
            { key: 'signin',  label: 'Sign in',      width: 90 },
            { key: 'signout', label: 'Sign out',     width: 90 },
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

        // Report header
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#171717')
           .text('Nkanyezi Academy — Attendance Report', doc.page.margins.left, doc.y);
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9).fillColor('#5b5b58')
           .text(`Facilitator: ${facilitator.name || ''} ${facilitator.surname || ''}`)
           .text(`Period: ${fmtDate(from)} — ${fmtDate(to)}`)
           .text(deal_number ? `Deal: #${deal_number}` : 'All assigned deals')
           .text(`Generated: ${new Date().toLocaleString('en-ZA')}`);
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
            doc.fontSize(9).fillColor('#1f1f1f');
            doc.text(`${r.name} ${r.surname}`, colX[0], y, { width: cols[0].width });
            doc.text(`#${r.deal_number} ${r.sponsor || ''}`, colX[1], y, { width: cols[1].width });
            doc.text(fmtDate(r.attendance_date), colX[2], y, { width: cols[2].width });
            doc.text(r.status, colX[3], y, { width: cols[3].width });
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
// PoE / assessment submissions for the facilitator's learners
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

        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid submission ID' });
        }
        if (score === undefined || score === null || Number.isNaN(Number(score))) {
            return res.status(400).json({ success: false, message: 'A numeric score is required' });
        }

        // Ownership check + fetch max_score for validation
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

module.exports = router;