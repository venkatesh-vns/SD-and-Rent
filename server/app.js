// Express application: middleware, routes and error handling.
// server.js starts it; the test suite imports it directly.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// ============================================================
// Global Middleware
// ============================================================

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['Content-Disposition'], // lets the client read download file names
  })
);

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
app.use('/api', reportRoutes); // /api/reports, /api/logs, /api/notifications


// ============================================================
// Health Check
// ============================================================

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      success: true,
      message: 'SD Maintenance API is running.',
      database: 'connected',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'SD Maintenance API is running, but database connection failed.',
      database: 'disconnected',
    });
  }
});


// ============================================================
// Error Handler
// ============================================================

app.use(errorHandler);

module.exports = app;
