require('dotenv').config();

const app = require('./app');
const { pool } = require('./config/db');
const { startReminderScheduler } = require('./services/notificationService');

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

  startReminderScheduler();

  app.listen(PORT, () => {
    console.log('');
    console.log('==============================================');
    console.log(`SD Maintenance server running on port ${PORT}`);
    console.log(`API: http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
    console.log('==============================================');
    console.log('');
  });
}

startServer();
