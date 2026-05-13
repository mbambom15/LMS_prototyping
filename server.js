const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt'); 
require('dotenv').config();

/*Importing my own code here for authentication */
const authRoutes = require('./routes/auth');
const { isAuthenticated, isRole } = require('./middleware/auth');
const pool = require('./db/pool');
/**Creating my app like flask.run() */
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true })); // to parse POST form data
app.use(express.json());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,   // set to true if using HTTPS
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Serve static files from 'public' folder (login page, admin dashboard, etc.)
app.use(express.static('public'));

// Mount auth routes (login, logout)
app.use(authRoutes);

// Protect the /admin/* routes: require authentication AND admin role
app.use('/admin', isAuthenticated, isRole('admin'), express.static('public/admin'));

// Optional: redirect root to login
app.get('/', (req, res) => {
  res.redirect('/login');
});

//create new userrs
app.post('/api/create-user', isAuthenticated, isRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { first_name, last_name, email, password, id_number, phone, gender, role, status, qualification } = req.body;

        if (!first_name || !last_name || !email || !password || !role) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await client.query('BEGIN');

        // Insert into users
        const userResult = await client.query(
            `INSERT INTO users (name, surname, email, password_hashed, sa_id, phone_number, gender, role, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING user_id`,
            [first_name, last_name, email, hashedPassword, id_number || null, phone || null, gender || null, role, status || 'active']
        );
        const newUserId = userResult.rows[0].user_id;

        // Role-specific tables
        if (role === 'learner') {
            await client.query(`INSERT INTO learners (learner_id, status) VALUES ($1, $2)`, [newUserId, status || 'active']);
        } else if (role === 'facilitator') {
            await client.query(`INSERT INTO facilitators (facilitator_id) VALUES ($1)`, [newUserId]);
        } else if (role === 'assessor') {
            await client.query(`INSERT INTO assessors (assessor_id) VALUES ($1)`, [newUserId]);
        }

        // Enrolment if learner + qualification
        if (role === 'learner' && qualification && qualification.trim() !== '') {
            const qualRes = await client.query(
                `SELECT qualification_id FROM qualifications WHERE title ILIKE $1 LIMIT 1`,
                [`%${qualification}%`]
            );
            if (qualRes.rows.length) {
                await client.query(
                    `INSERT INTO enrolments (learner_id, qualification_id, start_date, status, progress_pct)
                     VALUES ($1, $2, CURRENT_DATE, 'active', 0)`,
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

// 404 handler
app.use((req, res) => {
  res.status(404).send('Page not found');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});