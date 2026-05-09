// scripts/hashAdmin.js
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

async function hashAdminPassword() {
  const email = 'admin.nhlakanipho@nkanyezi.co.za';
  const plainPassword = 'Sudo#1307a';

  try {
    const hashed = await bcrypt.hash(plainPassword, 10);
    const result = await pool.query(
      'UPDATE users SET password_hashed = $1 WHERE email = $2 RETURNING *',
      [hashed, email]
    );
    if (result.rowCount === 0) {
      console.log('Admin user not found, please insert manually.');
    } else {
      console.log('Admin password hashed successfully.');
    }
    await pool.end();
  } catch (err) {
    console.error('Error hashing admin password:', err);
  }
}

hashAdminPassword();