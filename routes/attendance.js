const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');

// ── HELPER: get today's session for a learner ─────────────────
async function getTodaySession(client, learnerId) {
    const today = new Date().toISOString().slice(0, 10);
    const res = await client.query(
        `SELECT s.id AS session_id, s.start_time, s.end_time, s.qualification_id
         FROM attendance_sessions s
         JOIN enrolments e ON e.qualification_id = s.qualification_id
         WHERE e.learner_id = $1
           AND s.session_date = $2
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [learnerId, today]
    );
    return res.rows[0] || null;
}

// ── Haversine ─────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── GET /api/me ───────────────────────────────────────────────
router.get('/api/me', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT user_id, display_name, name, surname, email, role FROM users WHERE user_id = $1`,
            [req.session.user.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── GET /api/attendance/history ───────────────────────────────
router.get('/api/attendance/history', isAuthenticated, async (req, res) => {
    try {
        const learnerId = req.session.user.id;
        const result = await pool.query(
            `SELECT
                ar.id,
                TO_CHAR(s.session_date, 'DD Mon YYYY')                                       AS date,
                COALESCE(s.session_label, 'Session')                                         AS session,
                TO_CHAR(ar.check_in_time  AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')     AS "signIn",
                TO_CHAR(ar.check_out_time AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')     AS "signOut",
                ROUND(ar.geo_latitude::numeric,  4)                                          AS lat,
                ROUND(ar.geo_longitude::numeric, 4)                                          AS lng,
                ar.status,
                ar.geo_verified,
                TRUE AS scheduled
             FROM attendance_records ar
             JOIN attendance_sessions s ON s.id = ar.session_id
             WHERE ar.learner_id = $1
             ORDER BY s.session_date DESC`,
            [learnerId]
        );
        res.json({ records: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── GET /api/attendance/today-status ─────────────────────────
// Returns whether the learner has signed in / out for today's session.
// Used by the dashboard button to reflect current state.
router.get('/api/attendance/today-status', isAuthenticated, async (req, res) => {
    try {
        const learnerId = req.session.user.id;
        const today     = new Date().toISOString().slice(0, 10);

        const result = await pool.query(
            `SELECT ar.status, ar.check_in_time, ar.check_out_time
             FROM attendance_records ar
             JOIN attendance_sessions s ON s.id = ar.session_id
             WHERE ar.learner_id = $1
               AND s.session_date = $2
             LIMIT 1`,
            [learnerId, today]
        );

        if (!result.rows.length) {
            return res.json({ signedIn: false, signedOut: false, status: null });
        }

        const row = result.rows[0];
        res.json({
            signedIn:  !!row.check_in_time,
            signedOut: !!row.check_out_time,
            status:    row.status,
            checkIn:   row.check_in_time,
            checkOut:  row.check_out_time
        });
    } catch (err) {
        console.error('today-status error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── POST /api/attendance/signin ───────────────────────────────
router.post('/api/attendance/signin', isAuthenticated, isRole('learner'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { geo_latitude, geo_longitude, geo_verified, check_in_time, is_late } = req.body;
        const learnerId = req.session.user.id;

        if (!geo_latitude || !geo_longitude) {
            return res.status(400).json({ success: false, message: 'Coordinates are required' });
        }

        await client.query('BEGIN');

        const session = await getTodaySession(client, learnerId);
        if (!session) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'No session scheduled for today' });
        }

        const VENUE_LAT      = -25.82731638243808;
        const VENUE_LNG      =  28.2034515438192;
        const distKm         = haversineKm(geo_latitude, geo_longitude, VENUE_LAT, VENUE_LNG);
        const status         = is_late ? 'late' : 'present';
        const checkInTimeStr = check_in_time || new Date().toISOString();

        // Check for existing record
        const existing = await client.query(
            `SELECT id, status FROM attendance_records WHERE session_id = $1 AND learner_id = $2`,
            [session.session_id, learnerId]
        );

        if (existing.rows.length) {
            // Only overwrite if currently marked absent
            if (existing.rows[0].status === 'absent') {
                await client.query(
                    `UPDATE attendance_records
                     SET status = $1, check_in_time = $2,
                         geo_latitude = $3, geo_longitude = $4,
                         geo_verified = $5, geo_distance_km = $6,
                         venue_latitude = $7, venue_longitude = $8,
                         capture_method = 'geo_self'
                     WHERE session_id = $9 AND learner_id = $10`,
                    [status, checkInTimeStr, geo_latitude, geo_longitude,
                     geo_verified, distKm.toFixed(4), VENUE_LAT, VENUE_LNG,
                     session.session_id, learnerId]
                );
            }
        } else {
            await client.query(
                `INSERT INTO attendance_records
                    (session_id, learner_id, status, check_in_time,
                     geo_latitude, geo_longitude, geo_verified, geo_distance_km,
                     venue_latitude, venue_longitude, capture_method, captured_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'geo_self',$11)`,
                [session.session_id, learnerId, status, checkInTimeStr,
                 geo_latitude, geo_longitude, geo_verified, distKm.toFixed(4),
                 VENUE_LAT, VENUE_LNG, learnerId]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, status, message: is_late ? 'Signed in — marked as late' : 'Signed in' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Sign-in error:', err);
        res.status(500).json({ success: false, message: 'Server error during sign-in' });
    } finally {
        client.release();
    }
});

// ── POST /api/attendance/signout ──────────────────────────────
router.post('/api/attendance/signout', isAuthenticated, isRole('learner'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { geo_latitude, geo_longitude, check_out_time } = req.body;
        const learnerId = req.session.user.id;

        await client.query('BEGIN');

        const session = await getTodaySession(client, learnerId);
        if (!session) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'No session scheduled for today' });
        }

        const checkOutTimeStr = check_out_time || new Date().toISOString();

        const updated = await client.query(
            `UPDATE attendance_records
             SET check_out_time = $1,
                 geo_longitude  = COALESCE(geo_longitude, $2),
                 geo_latitude   = COALESCE(geo_latitude,  $3)
             WHERE session_id = $4 AND learner_id = $5
             RETURNING id`,
            [checkOutTimeStr, geo_longitude, geo_latitude, session.session_id, learnerId]
        );

        if (!updated.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'No sign-in record found to sign out from' });
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Signed out successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Sign-out error:', err);
        if (err.code === '42703') {
            // check_out_time column not yet migrated — succeed gracefully
            return res.json({ success: true, message: 'Signed out (run migration to persist check_out_time)' });
        }
        res.status(500).json({ success: false, message: 'Server error during sign-out' });
    } finally {
        client.release();
    }
});

module.exports = router;