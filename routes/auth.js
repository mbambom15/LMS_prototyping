/*Import all the classes we would use like in java Eg: import za.ac.tut.EnterprseBean to use its methods*/
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const router = express.Router();

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
    // future roles:
    // case 'facilitator': return res.redirect('/facilitator/dashboard.html');
    // case 'learner': return res.redirect('/learner/dashboard.html');
    default:
      return res.status(403).send('No dashboard defined for your role.');
  }
}

module.exports = router;