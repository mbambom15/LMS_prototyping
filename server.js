const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

/*Importing my own code here for authentication */
const authRoutes = require('./routes/auth');
const { isAuthenticated, isRole } = require('./middleware/auth');
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

// 404 handler
app.use((req, res) => {
  res.status(404).send('Page not found');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});