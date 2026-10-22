require('dotenv').config();

const { pool } = require('./config/db');
const { startCluster, workerCount } = require('./cluster');

// Test PostgreSQL connection
async function testDatabaseConnection() {
  try {
    const result = await pool.query('SELECT NOW()');

    console.log('PostgreSQL database connected successfully.');
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`Host: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    console.log(`Server time: ${result.rows[0].now}`);

    return true;
  } catch (error) {
    console.error('PostgreSQL database connection failed!');
    console.error('Error:', error.message);

    return false;
  }
}


// ============================================================
// Start Server
// ============================================================

const PORT = process.env.PORT || 5000;

async function startServer() {
  const databaseConnected = await testDatabaseConnection();

  if (!databaseConnected) {
    console.error('');
    console.error('Server was NOT started because PostgreSQL connection failed.');
    console.error('Please check your .env database settings.');
    process.exit(1);
  }

  // Several web workers share the port (WEB_WORKERS, default one per core up to 4);
  // WEB_WORKERS=1 runs everything in this process
  const workers = workerCount();
  if (workers > 1) {
    await pool.end();
    await startCluster({ count: workers });
  } else {
    process.env.RUN_REMINDERS = 'true';
    require('./worker');
  }

  console.log('');
  console.log('==============================================');
  console.log(`Security Deposit & Rent Management server running on port ${PORT} (${workers} web worker${workers > 1 ? 's' : ''})`);
  console.log(`API: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log('==============================================');
  console.log('');
}

startServer();
