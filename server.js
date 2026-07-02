const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const qualificationsRoutes = require('./routes/qualifications');
const dealsRoutes = require('./routes/deals');
const dashboardRoutes = require('./routes/dashboard');
require('dotenv').config();
require('./jobs/scheduler');

const crypto = require('crypto');
const { sendWelcomeEmail, sendUserDetailsEmail } = require('./utils/emailService');

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const { isAuthenticated, isRole } = require('./middleware/auth');
const pool = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

// Static files
app.use(express.static('public'));

// Routes
app.use(authRoutes);
app.use(attendanceRoutes);
app.use(qualificationsRoutes);
app.use(dealsRoutes);
app.use(dashboardRoutes);

// Protect /admin
app.use('/admin', isAuthenticated, isRole('admin'), express.static('public/admin'));

// Protect /learner attendance page
app.use('/learner', isAuthenticated, isRole('learner'), express.static('public/learner'));

app.get('/', (req, res) => res.redirect('/login'));

// Create user (admin only)
app.post('/api/create-user', isAuthenticated, isRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { first_name, last_name, email, password, id_number, phone, gender, role, status, qualification, schedule_day_1, schedule_day_2 } = req.body;

        if (!first_name || !last_name || !email || !password || !role) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await client.query('BEGIN');

        const userResult = await client.query(
            `INSERT INTO users (name, surname, email, password_hashed, sa_id, phone_number, gender, role, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING user_id`,
            [first_name, last_name, email, hashedPassword, id_number || null,
                phone || null, gender || null, role, status || 'active']
        );
        const newUserId = userResult.rows[0].user_id;

        if (role === 'learner') {
            await client.query(`INSERT INTO learners (learner_id, status) VALUES ($1,$2)`, [newUserId, status || 'active']);
        } else if (role === 'facilitator') {
            await client.query(`INSERT INTO facilitators (facilitator_id) VALUES ($1)`, [newUserId]);
        } else if (role === 'assessor') {
            await client.query(`INSERT INTO assessors (assessor_id) VALUES ($1)`, [newUserId]);
        }

        if (role === 'learner' && qualification?.trim()) {
            await client.query(
                `INSERT INTO enrolments (learner_id, qualification_id, start_date, status, progress_pct)
         VALUES ($1,$2,CURRENT_DATE,'active',0)`,
                [newUserId, qualification]
            );
        }

        // Attendance schedule — learners only. day_1 is required on the
        // client, but guard server-side too in case of a direct API call.
        if (role === 'learner') {
            const day1 = schedule_day_1 !== undefined && schedule_day_1 !== '' ? parseInt(schedule_day_1, 10) : null;
            const day2 = schedule_day_2 !== undefined && schedule_day_2 !== '' ? parseInt(schedule_day_2, 10) : null;

            if (day1 === null || Number.isNaN(day1)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Attendance day 1 is required for learners' });
            }

            await client.query(
                `INSERT INTO attendance_schedules (learner_id, day_of_week_1, day_of_week_2)
                 VALUES ($1, $2, $3)`,
                [newUserId, day1, Number.isNaN(day2) ? null : day2]
            );
        }

        await client.query('COMMIT');

        // Send the welcome email with the exact password the admin typed/generated.
        // Don't let an email failure roll back or fail the user creation itself.
        let emailSent = true;
        try {
            await sendWelcomeEmail({
                to: email,
                firstName: first_name,
                password
            });
        } catch (emailErr) {
            emailSent = false;
            console.error('Welcome email failed for', email, ':', emailErr.message);
        }

        res.json({
            success: true,
            message: emailSent
                ? 'User created successfully and welcome email sent'
                : 'User created successfully, but the welcome email failed to send',
            userId: newUserId,
            emailSent,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        if (err.code === '23505') return res.status(400).json({ success: false, message: 'Email or SA ID already exists' });
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ── GET /api/users  (admin: read all users — excludes soft-deleted) ──
app.get('/api/users', isAuthenticated, isRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                u.user_id,
                u.name,
                u.surname,
                u.email,
                u.role,
                u.status,
                u.phone_number,
                u.sa_id,
                u.gender,
                u.created_at,
                -- qualification title for learners (NULL for other roles)
                q.title AS qualification
             FROM users u
             LEFT JOIN learners l   ON l.learner_id = u.user_id
             LEFT JOIN enrolments e ON e.learner_id = l.learner_id
             LEFT JOIN qualifications q ON q.qualification_id = e.qualification_id
             WHERE u.is_deleted = FALSE
             ORDER BY u.created_at DESC`
        );
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error('GET /api/users error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});
app.post('/api/users/:id/send-details', isAuthenticated, isRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        const userResult = await pool.query(
            `SELECT user_id, name, surname, email FROM users WHERE user_id = $1 AND is_deleted = FALSE`,
            [id]
        );
        if (!userResult.rows.length) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const user = userResult.rows[0];
        if (!user.email) {
            return res.status(400).json({ success: false, message: 'User has no email address on file' });
        }

        const newPassword = generateTempPassword();
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await pool.query(
            `UPDATE users SET password_hashed = $1, updated_at = NOW() WHERE user_id = $2`,
            [hashedPassword, id]
        );

        await sendUserDetailsEmail({ to: user.email, firstName: user.name, password: newPassword });

        res.json({ success: true, message: `Details sent to ${user.email} (password was reset).` });
    } catch (err) {
        console.error('POST /api/users/:id/send-details error:', err);
        res.status(500).json({ success: false, message: 'Failed to send user details: ' + err.message });
    }
});

/** Random temp password: 12 chars, no ambiguous characters */
function generateTempPassword(length = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    const bytes = crypto.randomBytes(length);
    let pw = '';
    for (let i = 0; i < length; i++) pw += chars[bytes[i] % chars.length];
    return pw;
}

// ── PUT /api/users/:id  (admin: update role / status) ────────────
app.put('/api/users/:id', isAuthenticated, isRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { role, status, first_name, last_name, email, phone, gender } = req.body;

        // Validate UUID
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        await client.query('BEGIN');

        // Fetch current role so we can handle role-table bookkeeping
        const current = await client.query(
            `SELECT role FROM users WHERE user_id = $1`, [id]
        );
        if (!current.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const oldRole = current.rows[0].role;

        // Build a dynamic SET clause for users table
        const fields = [];
        const values = [];
        let idx = 1;

        if (first_name !== undefined) { fields.push(`name = $${idx++}`); values.push(first_name); }
        if (last_name !== undefined) { fields.push(`surname = $${idx++}`); values.push(last_name); }
        if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
        if (phone !== undefined) { fields.push(`phone_number = $${idx++}`); values.push(phone); }
        if (gender !== undefined) { fields.push(`gender = $${idx++}`); values.push(gender); }
        if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
        if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }

        fields.push(`updated_at = NOW()`);

        if (fields.length > 1) {   // more than just updated_at
            values.push(id);
            await client.query(
                `UPDATE users SET ${fields.join(', ')} WHERE user_id = $${idx}`,
                values
            );
        }

        // ── Role-table bookkeeping (only when role actually changes) ──
        if (role && role !== oldRole) {
            // Remove from old role table
            if (oldRole === 'learner') await client.query(`DELETE FROM learners      WHERE learner_id      = $1`, [id]);
            if (oldRole === 'facilitator') await client.query(`DELETE FROM facilitators  WHERE facilitator_id  = $1`, [id]);
            if (oldRole === 'assessor') await client.query(`DELETE FROM assessors     WHERE assessor_id     = $1`, [id]);

            // Insert into new role table
            if (role === 'learner') await client.query(`INSERT INTO learners      (learner_id, status)      VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, status || 'active']);
            if (role === 'facilitator') await client.query(`INSERT INTO facilitators  (facilitator_id)          VALUES ($1)     ON CONFLICT DO NOTHING`, [id]);
            if (role === 'assessor') await client.query(`INSERT INTO assessors     (assessor_id)             VALUES ($1)     ON CONFLICT DO NOTHING`, [id]);
        }

        // Sync learners.status when status changes for a learner
        if (status && (role === 'learner' || oldRole === 'learner')) {
            await client.query(
                `UPDATE learners SET status = $1 WHERE learner_id = $2`,
                [status, id]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'User updated successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('PUT /api/users/:id error:', err);
        if (err.code === '23505') return res.status(400).json({ success: false, message: 'Email already in use' });
        res.status(500).json({ success: false, message: 'Failed to update user' });
    } finally {
        client.release();
    }
});

// ── DELETE /api/users/:id  (admin: soft delete — preserves audit trail) ──
app.delete('/api/users/:id', isAuthenticated, isRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;

        // Prevent admin from deleting themselves
        if (req.session.user?.id === id) {
            return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
        }

        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        await client.query('BEGIN');

        // Soft delete only — status flips to terminated and is_deleted/deleted_at
        // are set, but the row (and everything referencing it: enrolments,
        // attendance_records, assessment_submissions, learner_risk_flags) is kept
        // for SETA audit purposes. Nothing is ever hard-deleted from users.
        const result = await client.query(
            `UPDATE users
             SET status = 'terminated', is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
             WHERE user_id = $1 AND is_deleted = FALSE
             RETURNING user_id`,
            [id]
        );

        if (!result.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found or already removed' });
        }

        // Mirror status onto learners.status so existing role-aware queries
        // (e.g. admin_dashboard_stats active_learners) stay correct without
        // needing to know about is_deleted on the users table.
        await client.query(
            `UPDATE learners SET status = 'terminated' WHERE learner_id = $1`,
            [id]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: 'User removed (archived for audit — not permanently deleted)' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('DELETE /api/users/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to remove user' });
    } finally {
        client.release();
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error('Logout error:', err);
        res.clearCookie('connect.sid'); // clear session cookie
        res.redirect('/login');
    });
});

app.use((req, res) => res.status(404).send('Page not found'));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));