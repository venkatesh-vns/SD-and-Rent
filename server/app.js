// Express application: middleware, routes and error handling.
// server.js starts it; the test suite imports it directly.
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { pool } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const costCenterRoutes = require('./routes/costCenterRoutes');
const userRightsRoutes = require('./routes/userRightsRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const locationRoutes = require('./routes/locationRoutes');
const sdMasterRoutes = require('./routes/sdMasterRoutes');
const lookupRoutes = require('./routes/lookupRoutes');
const sdTransactionRoutes = require('./routes/sdTransactionRoutes');
const reportRoutes = require('./routes/reportRoutes');
const notificationTemplateRoutes = require('./routes/notificationTemplateRoutes');
const mailSettingsRoutes = require('./routes/mailSettingsRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const rentRoutes = require('./routes/rentRoutes');
const sdRentReportRoutes = require('./routes/sdRentReportRoutes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// ============================================================
// Global Middleware
// ============================================================

// Default security headers, except "upgrade-insecure-requests": the app is
// opened over plain http on the office network (http://<pc>:<port>), where
// upgrading every request to https would stop the screens loading.
app.use(helmet({
  contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
}));

// Browser origins allowed to call the API: CLIENT_URL plus the same client
// port under this machine's other names (localhost, 127.0.0.1 and its network
// IP addresses), so the app works however this PC is addressed.
function allowedOrigins() {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const origins = new Set([clientUrl.replace(/\/+$/, '')]);
  try {
    const url = new URL(clientUrl);
    const hosts = ['localhost', '127.0.0.1', ...Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4').map((i) => i.address)];
    hosts.forEach((h) => origins.add(`${url.protocol}//${h}${url.port ? `:${url.port}` : ''}`));
  } catch {
    // CLIENT_URL is not a URL: allow it as written
  }
  return [...origins];
}

app.use(
  cors({
    origin: allowedOrigins(),
    credentials: true,
    exposedHeaders: ['Content-Disposition'], // lets the client read download file names
  })
);

// gzip responses (JSON lists, the screens' files): far less to send over the office network
app.use(compression());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// ============================================================
// Rate Limiting
// ============================================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT) || 20, // attempts per 15 minutes per IP
  message: {
    success: false,
    message: 'Too many attempts. Please try again later.',
  },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/change-password', authLimiter);


// ============================================================
// Routes
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cost-centers', costCenterRoutes);
app.use('/api/user-rights', userRightsRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/sd-master', sdMasterRoutes);
app.use('/api/lookups', lookupRoutes);
app.use('/api/sd-transactions', sdTransactionRoutes);
app.use('/api/notification-templates', notificationTemplateRoutes);
app.use('/api/mail-settings', mailSettingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/rent', rentRoutes); // Rent Transaction menu
app.use('/api/reports/sd-rent', sdRentReportRoutes); // SD & Rent Transaction Summary Report
app.use('/api', reportRoutes); // /api/reports, /api/logs, /api/notifications


// ============================================================
// Health Check
// ============================================================

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      success: true,
      message: 'SD and Rent Maintenance API is running.',
      database: 'connected',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'SD and Rent Maintenance API is running, but database connection failed.',
      database: 'disconnected',
    });
  }
});


// ============================================================
// Web screens (desktop / single-port installs)
// ============================================================
// When CLIENT_BUILD_DIR points at the built React app, the API also serves
// the screens, so one address (http://<pc>:<port>) is all users need.

const clientBuild = process.env.CLIENT_BUILD_DIR;
if (clientBuild && fs.existsSync(path.join(clientBuild, 'index.html'))) {
  app.use(express.static(clientBuild, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api(\/|$)).*/, (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}


// ============================================================
// Error Handler
// ============================================================

app.use(errorHandler);

module.exports = app;
