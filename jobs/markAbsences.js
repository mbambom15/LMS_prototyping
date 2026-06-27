// jobs/markAbsences.js
//
// Runs once a day, after the sign-out window closes (15:00 SAST).
// Marks any learner as 'absent' for today if:
//   1. Today matches one of their qualification's scheduled_day_1/2, AND
//   2. They have an active enrolment on that qualification, AND
//   3. They have no attendance_records row for today already.
//
// No sessions table involved — schedule lives on qualifications,
// attendance lives standalone keyed on (learner_id, attendance_date).

const pool = require('../db/pool');

function getSADateToday() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Johannesburg',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return `${y}-${m}-${d}`;
}

async function markAbsences() {
    const client = await pool.connect();
    try {
        const today = getSADateToday();

        await client.query('BEGIN');

        // EXTRACT(DOW FROM date) in Postgres: 0=Sunday..6=Saturday.
        // Our scheduled_day_1/2 use 0=Monday..6=Sunday, so convert:
        // postgres_dow -> our_dow is ((postgres_dow + 6) % 7)
        const result = await client.query(
            `INSERT INTO attendance_records (learner_id, attendance_date, status, capture_method)
             SELECT DISTINCT l.learner_id, $1::date, 'absent', 'system_auto'
             FROM learners l
             JOIN enrolments e   ON e.learner_id = l.learner_id AND e.status = 'active'
             JOIN qualifications q ON q.qualification_id = e.qualification_id
             WHERE l.status = 'active'
               AND ((EXTRACT(DOW FROM $1::date)::int + 6) % 7) IN (q.scheduled_day_1, q.scheduled_day_2)
               AND NOT EXISTS (
                 SELECT 1 FROM attendance_records ar
                 WHERE ar.learner_id = l.learner_id
                   AND ar.attendance_date = $1::date
               )
             RETURNING learner_id`,
            [today]
        );

        await client.query('COMMIT');
        console.log(`[markAbsences] ${today}: marked ${result.rowCount} learner(s) absent.`);
        return result.rowCount;
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[markAbsences] failed:', err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { markAbsences, getSADateToday };