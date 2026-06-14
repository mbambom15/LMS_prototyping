const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const qualificationsRoutes = require('./routes/qualifications');
const dealsRoutes = require('./routes/deals');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance'); // sign-in, sign-out, history, /api/me
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

// Protect /admin
app.use('/admin', isAuthenticated, isRole('admin'), express.static('public/admin'));

// Protect /learner attendance page
app.use('/learner', isAuthenticated, isRole('learner'), express.static('public/learner'));

app.get('/', (req, res) => res.redirect('/login'));

// Create user (admin only)
app.post('/api/create-user', isAuthenticated, isRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { first_name, last_name, email, password, id_number, phone, gender, role, status, qualification } = req.body;

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
            const qualRes = await client.query(
                `SELECT qualification_id FROM qualifications WHERE title ILIKE $1 LIMIT 1`,
                [`%${qualification}%`]
            );
            if (qualRes.rows.length) {
                await client.query(
                    `INSERT INTO enrolments (learner_id, qualification_id, start_date, status, progress_pct)
                     VALUES ($1,$2,CURRENT_DATE,'active',0)`,
                    [newUserId, qualRes.rows[0].qualification_id]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'User created successfully', userId: newUserId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        if (err.code === '23505') return res.status(400).json({ success: false, message: 'Email or SA ID already exists' });
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});
// ── GET /api/users  (admin: read all users) ──────────────────────
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
             ORDER BY u.created_at DESC`
        );
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error('GET /api/users error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

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

// ── DELETE /api/users/:id  (admin: soft-archive then hard-delete) ──
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

        // Soft-archive: mark as terminated before cascade delete
        // (attendance_records, feedback etc. keep their data via SET NULL / CASCADE)
        await client.query(
            `UPDATE users SET status = 'terminated', updated_at = NOW() WHERE user_id = $1`,
            [id]
        );

        // Hard delete — cascades through learners → enrolments, attendance_records, etc.
        const del = await client.query(
            `DELETE FROM users WHERE user_id = $1 RETURNING user_id`, [id]
        );

        if (!del.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'User removed successfully' });
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