const multer = require('multer');

// Centralized error handler - keeps controllers free of try/catch boilerplate noise
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Internal server error.';

  if (err instanceof multer.MulterError) {
    status = 400;
    if (err.code === 'LIMIT_FILE_SIZE') message = `File is too large. The limit is ${req.uploadLimitMb || 5} MB.`;
  } else if (err.code === '23505') {
    // PostgreSQL unique_violation - e.g. two users saving the same name at once
    status = 409;
    message = 'A record with the same unique value already exists.';
  } else if (err.code === '23503' || err.code === '23001') {
    // PostgreSQL foreign_key_violation / restrict_violation - record is still referenced
    status = 409;
    message = 'This record is referenced by other data and cannot be deleted. Mark it Inactive instead.';
  }

  if (status >= 500) console.error(err.stack || err);
  res.status(status).json({
    success: false,
    message: status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error.' : message,
    ...(err.errors && status < 500 ? { errors: err.errors } : {}), // field-level validation list
  });
}

module.exports = { errorHandler };
