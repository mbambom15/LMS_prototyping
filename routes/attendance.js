const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');

// ── CONFIG — mirrors attendance.js client config ───────────────
const VENUE_LAT          = -25.82731638243808;
const VENUE_LNG          =  28.2034515438192;
const MAX_GEO_KM         = 0.05;            // 50 m radius
const LATE_THRESHOLD_MIN = 8 * 60 + 30;     // 08:30 → late
const SIGNIN_OPEN_MIN    = 7 * 60;          // 07:00
const SIGNOUT_OPEN_MIN   = 14 * 60 + 30;    // 14:30
const SIGNOUT_CLOSE_MIN  = 15 * 60;         // 15:00

// ── Haversine ─────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getSAMinutesNow() {
    // Server clock minutes-of-day in Africa/Johannesburg, independent of host TZ.
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Johannesburg',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(new Date());
    const hour = Number(parts.find(p => p.type === 'hour').value);
    const minute = Number(parts.find(p => p.type === 'minute').value);
    return hour * 60 + minute;
}

function getSADateToday() {
    // YYYY-MM-DD in Africa/Johannesburg, used as the attendance_date key.
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Johannesburg',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return `${y}-${m}-${d}`;
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
                TO_CHAR(ar.attendance_date, 'DD Mon YYYY')                                   AS date,
                TO_CHAR(ar.check_in_time  AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')     AS "signIn",
                TO_CHAR(ar.check_out_time AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')     AS "signOut",
                ROUND(ar.geo_latitude::numeric,  4)                                          AS lat,
                ROUND(ar.geo_longitude::numeric, 4)                                          AS lng,
                ar.status,
                ar.geo_verified,
                TRUE AS scheduled
             FROM attendance_records ar
             WHERE ar.learner_id = $1
             ORDER BY ar.attendance_date DESC`,
            [learnerId]
        );
        res.json({ records: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── GET /api/attendance/today-status ─────────────────────────
// Returns whether the learner has signed in / out for today.
router.get('/api/attendance/today-status', isAuthenticated, async (req, res) => {
    try {
        const learnerId = req.session.user.id;
        const today     = getSADateToday();

        const result = await pool.query(
            `SELECT status, check_in_time, check_out_time
             FROM attendance_records
             WHERE learner_id = $1 AND attendance_date = $2
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
        const { geo_latitude, geo_longitude, check_in_time } = req.body;
        const learnerId = req.session.user.id;

        if (geo_latitude == null || geo_longitude == null) {
            return res.status(400).json({ success: false, message: 'Coordinates are required' });
        }

        const today      = getSADateToday();
        const nowMin      = getSAMinutesNow();
        const distKm      = haversineKm(geo_latitude, geo_longitude, VENUE_LAT, VENUE_LNG);
        const geoVerified = distKm <= MAX_GEO_KM;
        const isLate      = nowMin > LATE_THRESHOLD_MIN;
        const status       = isLate ? 'late' : 'present';
        const checkInTimeStr = check_in_time || new Date().toISOString();

        if (nowMin < SIGNIN_OPEN_MIN) {
            return res.status(400).json({ success: false, message: 'Sign-in window has not opened yet (from 07:00)' });
        }

        await client.query('BEGIN');

        const existing = await client.query(
            `SELECT id, check_in_time FROM attendance_records WHERE learner_id = $1 AND attendance_date = $2 FOR UPDATE`,
            [learnerId, today]
        );

        let savedRow;

        if (existing.rows.length) {
            if (existing.rows[0].check_in_time) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, message: 'Already signed in today' });
            }
            const upd = await client.query(
                `UPDATE attendance_records
                 SET status = $1, check_in_time = $2,
                     geo_latitude = $3, geo_longitude = $4,
                     geo_verified = $5, geo_distance_km = $6,
                     venue_latitude = $7, venue_longitude = $8,
                     capture_method = 'geo_self'
                 WHERE learner_id = $9 AND attendance_date = $10
                 RETURNING id, status, check_in_time, check_out_time, geo_verified`,
                [status, checkInTimeStr, geo_latitude, geo_longitude,
                 geoVerified, distKm.toFixed(4), VENUE_LAT, VENUE_LNG,
                 learnerId, today]
            );
            savedRow = upd.rows[0];
        } else {
            const ins = await client.query(
                `INSERT INTO attendance_records
                    (learner_id, attendance_date, status, check_in_time,
                     geo_latitude, geo_longitude, geo_verified, geo_distance_km,
                     venue_latitude, venue_longitude, capture_method, captured_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'geo_self',$11)
                 RETURNING id, status, check_in_time, check_out_time, geo_verified`,
                [learnerId, today, status, checkInTimeStr,
                 geo_latitude, geo_longitude, geoVerified, distKm.toFixed(4),
                 VENUE_LAT, VENUE_LNG, learnerId]
            );
            savedRow = ins.rows[0];
        }

        await client.query('COMMIT');

        // Respond with exactly what was persisted (not the pre-write locals)
        // so the frontend never has to guess at status independently.
        res.json({
            success: true,
            status: savedRow.status,
            check_in_time: savedRow.check_in_time,
            check_out_time: savedRow.check_out_time,
            geo_verified: savedRow.geo_verified,
            distance_km: Number(distKm.toFixed(4)),
            message: savedRow.status === 'late' ? 'Signed in — marked as late' : 'Signed in'
        });
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
        const today      = getSADateToday();
        const nowMin     = getSAMinutesNow();

        if (geo_latitude == null || geo_longitude == null) {
            return res.status(400).json({ success: false, message: 'Coordinates are required' });
        }

        if (nowMin < SIGNOUT_OPEN_MIN) {
            return res.status(400).json({ success: false, message: 'Sign-out window has not opened yet (from 14:30)' });
        }
        if (nowMin > SIGNOUT_CLOSE_MIN) {
            return res.status(400).json({ success: false, message: 'Sign-out window has closed (deadline 15:00)' });
        }

        const distKm          = haversineKm(geo_latitude, geo_longitude, VENUE_LAT, VENUE_LNG);
        const geoVerified     = distKm <= MAX_GEO_KM;
        const checkOutTimeStr = check_out_time || new Date().toISOString();

        await client.query('BEGIN');

        const updated = await client.query(
            `UPDATE attendance_records
             SET check_out_time = $1,
                 checkout_geo_latitude = $2,
                 checkout_geo_longitude = $3,
                 checkout_geo_verified = $4,
                 checkout_geo_distance_km = $5
             WHERE learner_id = $6 AND attendance_date = $7
               AND check_in_time IS NOT NULL
             RETURNING id, status, check_in_time, check_out_time, geo_verified, checkout_geo_verified`,
            [checkOutTimeStr, geo_latitude, geo_longitude, geoVerified, distKm.toFixed(4), learnerId, today]
        );

        if (!updated.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'No sign-in record found to sign out from' });
        }

        await client.query('COMMIT');

        const savedRow = updated.rows[0];
        res.json({
            success: true,
            status: savedRow.status,
            check_in_time: savedRow.check_in_time,
            check_out_time: savedRow.check_out_time,
            geo_verified: savedRow.checkout_geo_verified,
            message: 'Signed out successfully'
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Sign-out error:', err);
        res.status(500).json({ success: false, message: 'Server error during sign-out' });
    } finally {
        client.release();
    }
});

module.exports = router;