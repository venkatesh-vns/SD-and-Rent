const STATUSES = ['Active', 'Inactive'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

// Returns an error message, or null when the password meets the policy.
function passwordPolicyError(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

module.exports = { STATUSES, isValidEmail, passwordPolicyError };
