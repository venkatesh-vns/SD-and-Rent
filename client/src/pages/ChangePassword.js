import React, { useState } from 'react';
import Toast from '../components/Toast';
import Navbar from '../components/Navbar';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PASSWORD_HINT, passwordPolicyError } from '../utils/password';

export default function ChangePassword() {
  const { replaceToken } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    const policyError = passwordPolicyError(form.newPassword);
    if (policyError) {
      setError(policyError);
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      replaceToken(res.data.token);
      setMessage(`${res.data.message} You have been signed out on other devices.`);
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(errorMessage(err, 'Unable to change password.'));
    } finally {
      setLoading(false);
    }
  };

  const field = (key, label, autoComplete) => (
    <>
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        type="password"
        autoComplete={autoComplete}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        required
      />
    </>
  );

  return (
    <div>
      <Navbar />
      <div className="page-container narrow">
        <h1>Change Password</h1>
        <form className="card" onSubmit={handleSubmit}>
          <Toast message={message} onClose={() => setMessage('')} duration={6000} />
          {error && <div className="alert alert-error">{error}</div>}
          {field('currentPassword', 'Current Password', 'current-password')}
          {field('newPassword', 'New Password', 'new-password')}
          <small className="hint">{PASSWORD_HINT}</small>
          {field('confirmPassword', 'Confirm New Password', 'new-password')}
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Saving...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
