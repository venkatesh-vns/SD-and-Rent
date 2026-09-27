const { Pool, types } = require('pg');
require('dotenv').config();

// Return DATE columns as plain 'YYYY-MM-DD' strings. The default converts
// them to JS Dates at local midnight, which can shift the day in transit.
types.setTypeParser(types.builtins.DATE, (value) => value);

// PostgreSQL connection pool
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT, 10) || 5432,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// getPool kept for naming consistency with the rest of the app;
// simply returns the shared pg Pool instance.
async function getPool() {
  return pool;
}

// Runs fn(client) inside BEGIN/COMMIT, rolling back if it throws.
// Models accept the client as their `db` argument so a record change and
// its audit row are saved together or not at all.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, getPool, withTransaction };
