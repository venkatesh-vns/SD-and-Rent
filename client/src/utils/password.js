// Mirrors server/utils/validators.js passwordPolicyError
export const PASSWORD_HINT = 'At least 8 characters, with at least one letter and one number.';

export function passwordPolicyError(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}
