// Error carrying an HTTP status; the central errorHandler sends it as-is.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { httpError };
