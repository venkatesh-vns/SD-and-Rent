import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionNote = params.get('idle')
    ? 'You were logged out after a period of inactivity.'
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
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h2>SD Maintenance Application</h2>
        <p className="auth-subtitle">Sign in to continue</p>

        {sessionNote && !error && <div className="alert alert-info">{sessionNote}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <label>User Name</label>
        <input
          type="text"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="Enter your user name"
          autoFocus
        />

        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
        />

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? 'Signing in...' : 'Login'}
        </button>

        <Link to="/forgot-password" className="auth-link">Forgot Password?</Link>
      </form>
    </div>
  );
}
