/*Import all the classes we would use like in java Eg: import za.ac.tut.EnterprseBean to use its methods*/
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const { sendUserDetailsEmail } = require('../utils/emailService');
const router = express.Router();

/** Random temp password: 12 chars, no ambiguous characters */
function generateTempPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(length);
  let pw = '';
  for (let i = 0; i < length; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

router.get('/login', (req, res) => {
  if (req.session.user) {
    redirectToDashboard(req.session.user.role, res);
  }
  res.sendFile('login.html', { root: 'public' });
});

// Handle login form POST
router.post('/login', async (req, res) => {
  const { uname, psw } = req.body;
  if (!uname || !psw) {
    return res.redirect('/login?error=' + encodeURIComponent('Email and password required'));
  }

  try {
    // Fetch user by email (case‑insensitive)
    const result = await pool.query(
      'SELECT user_id, email, password_hashed, role, status FROM users WHERE LOWER(email) = LOWER($1)',
      [uname]
    );
    const user = result.rows[0];

    if (!user) {
      return res.redirect('/login?error=' + encodeURIComponent('Invalid email or password'));
    }

    // Check account status
    if (user.status !== 'active') {
      return res.redirect('/login?error=' + encodeURIComponent('Account is not active. Contact support.'));
    }

    // Compare password with bcrypt hash
    const match = await bcrypt.compare(psw, user.password_hashed);
    if (!match) {
      return res.status(401).send('Invalid email or password');
    }

    // Update last_login timestamp
    await pool.query('UPDATE users SET last_login = NOW() WHERE user_id = $1', [user.user_id]);

    // Store user in session
    req.session.user = {
      id: user.user_id,
      email: user.email,
      role: user.role,
    };

    // Redirect based on role
    redirectToDashboard(user.role, res);
  } catch (err) {
    console.error('Login error:', err);
    return res.redirect('/login?error=' + encodeURIComponent('Internal server error. Please try again.'));
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error(err);
    res.redirect('/login');
  });
});

// Helper: redirect to the appropriate dashboard
function redirectToDashboard(role, res) {
  switch (role) {
    case 'admin':
      return res.redirect('/admin/dashboard.html');
    case 'learner':
      return res.redirect('/learner/ldashboard.html');
    case 'facilitator':
      return res.redirect('/facilitator/fdashboard.html');
    default:
      return res.status(403).send('No dashboard defined for your role.');
  }
}

// POST /api/forgot-password — self-service: verify identity by
// name + surname + email + SA ID, then reset & re-send credentials.
// No auth required — this IS the "I'm locked out" entry point.
router.post('/api/forgot-password', async (req, res) => {
  try {
    const { first_name, last_name, email, id_number } = req.body;

    if (!first_name || !last_name || !email || !id_number) {
      return res.status(400).json({ success: false, message: 'Please fill in all fields.' });
    }

    // Match all four case-insensitively (ID number is digits-only anyway).
    // Deliberately generic on failure — don't reveal which field was wrong.
    const userResult = await pool.query(
      `SELECT user_id, name, email
       FROM users
       WHERE is_deleted = FALSE
         AND LOWER(name) = LOWER($1)
         AND LOWER(surname) = LOWER($2)
         AND LOWER(email) = LOWER($3)
         AND sa_id = $4`,
      [first_name.trim(), last_name.trim(), email.trim(), id_number.trim()]
    );

    if (!userResult.rows.length) {
      return res.status(400).json({ success: false, message: 'We could not verify those details. Please check and try again.' });
    }

    const user = userResult.rows[0];
    const newPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users SET password_hashed = $1, updated_at = NOW() WHERE user_id = $2`,
      [hashedPassword, user.user_id]
    );

    await sendUserDetailsEmail({ to: user.email, firstName: user.name, password: newPassword });

    res.json({ success: true, message: 'A new password has been emailed to you.' });
  } catch (err) {
    console.error('POST /api/forgot-password error:', err);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again in a moment.' });
  }
});

module.exports = router;