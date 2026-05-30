const express = require('express');
const session = require('express-session');
const path    = require('path');
const bcrypt  = require('bcrypt');
require('dotenv').config();

const authRoutes       = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance'); // sign-in, sign-out, history, /api/me
const { isAuthenticated, isRole } = require('./middleware/auth');
const pool = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret:            process.env.SESSION_SECRET,
    resave:            false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

// Static files
app.use(express.static('public'));

// Routes
app.use(authRoutes);
app.use(attendanceRoutes);

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

app.use((req, res) => res.status(404).send('Page not found'));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));