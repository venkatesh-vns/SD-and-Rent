import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';

const UserIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z" /></svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 9V7a5 5 0 0 0-10 0v2H5v13h14V9h-2Zm-8-2a3 3 0 0 1 6 0v2H9V7Zm4 10.7V19h-2v-1.3a2 2 0 1 1 2 0Z" /></svg>
);
const EyeIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 5C6.5 5 2.7 9.1 1.5 12c1.2 2.9 5 7 10.5 7s9.3-4.1 10.5-7C21.3 9.1 17.5 5 12 5Zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
    {off && <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
  </svg>
);

export default function Login() {
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reason = params.get('reason');
  const sessionNote = params.get('idle') || reason === 'Idle timeout'
    ? 'You were logged out after 30 minutes without activity. Please log in again.'
    : reason === 'Ended by administrator' ? 'An administrator ended your session. Please log in again.'
      : params.get('expired') ? 'Your session has ended. Please log in again.' : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!userName || !password) {
      setError('Please enter both User Name and Password.');
      return;
    }
    setLoading(true);
    try {
      await login(userName, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <h2>Welcome back</h2>
        <p className="auth-subtitle">Sign in to the SD Maintenance Application with your company account.</p>

        {sessionNote && !error && <div className="alert alert-info">{sessionNote}</div>}
        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <label htmlFor="login-user">User Name</label>
        <div className="field">
          <UserIcon />
          <input
            id="login-user"
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Enter your user name"
            autoComplete="username"
            autoFocus
          />
        </div>

        <div className="label-row">
          <label htmlFor="login-password">Password</label>
          <Link to="/forgot-password" className="auth-link-inline">Forgot password?</Link>
        </div>
        <div className="field">
          <LockIcon />
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
          <button
            type="button"
            className="field-action"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            title={showPassword ? 'Hide password' : 'Show password'}
          >
            <EyeIcon off={showPassword} />
          </button>
        </div>

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
          {loading ? <><span className="spinner" /> Signing in...</> : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
