/**
 * Seeds a default Active admin user (is_admin = full access to every screen) into the `users` table using a
 * properly generated bcrypt hash (rather than a hard-coded hash value).
 *
 * Usage (from the /server folder, after configuring .env and running
 * `npm run migrate`):
 *   npm run seed
 *   npm run seed -- --username=admin --email=admin@yourcompany.com --password=YourPassword123
 *
 * If no flags are passed, defaults are used:
 *   username: admin
 *   email:    admin@sdmaintenance.com
 *   password: Admin@123   (CHANGE THIS after first login)
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

function getArg(name, fallback) {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : fallback;
}

async function run() {
  const userName = getArg('username', 'admin');
  const userEmail = getArg('email', 'admin@sdmaintenance.com');
  const password = getArg('password', 'Admin@123');

  const existing = await pool.query(
    'SELECT user_id FROM users WHERE user_name = $1 OR user_email = $2',
    [userName, userEmail]
  );

  if (existing.rows.length > 0) {
    console.log(`A user with username '${userName}' or email '${userEmail}' already exists. Nothing to do.`);
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO users (user_name, user_email, password_hash, status, is_admin, created_by)
     VALUES ($1, $2, $3, 'Active', TRUE, 'seed-script')`,
    [userName, userEmail, passwordHash]
  );

  console.log('Default admin user created successfully:');
  console.log(`  User Name : ${userName}`);
  console.log(`  Email     : ${userEmail}`);
  console.log(`  Password  : ${password}`);
  console.log('IMPORTANT: log in and change this password immediately.');

  await pool.end();
}

run().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
