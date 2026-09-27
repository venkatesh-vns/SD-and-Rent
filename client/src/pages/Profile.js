import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';

const FLAGS = [
  ['canView', 'View'], ['canAdd', 'Add'], ['canEdit', 'Edit'], ['canDelete', 'Delete'], ['canUpload', 'Upload'],
];

export default function Profile() {
  const { user } = useAuth();
  const granted = (user.rights || []).filter((r) => r.canView);

  return (
    <div>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <h1>User Profile</h1>
          <Link to="/change-password" className="btn btn-secondary">Change Password</Link>
        </div>

        <div className="card profile-card">
          <div><span className="hint">User Name</span><strong>{user.userName}</strong></div>
          <div><span className="hint">User Email ID</span><strong>{user.userEmail}</strong></div>
          <div><span className="hint">Role</span><strong>{user.isAdmin ? 'Administrator' : 'User'}</strong></div>
        </div>

        <h3>My access</h3>
        {granted.length === 0 ? (
          <p className="empty-state">You have not been given access to any screen yet. Contact your administrator.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Screen</th>{FLAGS.map(([, label]) => <th key={label} className="center">{label}</th>)}</tr>
              </thead>
              <tbody>
                {granted.map((r) => (
                  <tr key={r.screenCode}>
                    <td>{r.screenName}</td>
                    {FLAGS.map(([key, label]) => (
                      <td key={label} className="center">{r[key] ? '✓' : '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
