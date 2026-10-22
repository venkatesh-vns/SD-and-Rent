import React, { useEffect, useState, useCallback } from 'react';
import Toast from '../components/Toast';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import ActiveSessions from '../components/ActiveSessions';
import ExcelUpload from '../components/ExcelUpload';
import FilterBar from '../components/FilterBar';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';
import { PASSWORD_HINT } from '../utils/password';

const columns = [
  { key: 'userName', label: 'User Name' },
  { key: 'userEmail', label: 'User Email ID' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
];

export default function UserMaster() {
  const { user: me, can } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({ search: '', status: [] });
  const [modal, setModal] = useState(null); // 'edit' | 'add' | 'password'
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ userName: '', userEmail: '', password: '', status: 'Active' });
  const search = useDebounce(filters.search);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/users', { params: { search, status: filters.status } });
      setUsers(res.data.data.map((u) => ({
        id: u.user_id,
        userName: u.user_name,
        userEmail: u.user_email,
        status: u.status,
        isAdmin: u.is_admin,
        role: u.is_admin ? 'Administrator' : 'User',
      })));
    } catch (err) {
      setError(errorMessage(err, 'Failed to load users.'));
    } finally {
      setLoading(false);
    }
  }, [search, filters.status]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const open = (kind, row = null) => {
    setEditingUser(row);
    setForm(row
      ? { userName: row.userName, userEmail: row.userEmail, password: '', status: row.status }
      : { userName: '', userEmail: '', password: '', status: 'Active' });
    setError('');
    setModal(kind);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    try {
      let res;
      if (modal === 'password') {
        res = await api.put(`/users/${editingUser.id}/password`, { newPassword: form.password });
      } else if (modal === 'edit') {
        res = await api.put(`/users/${editingUser.id}`, {
          userName: form.userName, userEmail: form.userEmail, status: form.status,
        });
      } else {
        res = await api.post('/users', form);
      }
      setNotice(res.data.message);
      setModal(null);
      fetchUsers();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save user.'));
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete user '${row.userName}'? To keep their history, set them Inactive instead.`)) return;
    setError('');
    try {
      const res = await api.delete(`/users/${row.id}`);
      setNotice(res.data.message);
      fetchUsers();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete user.'));
    }
  };

  const handleExport = () => {
    downloadFile('/users/export', { search, status: filters.status }, 'Users.xlsx')
      .catch(() => setError('Export failed.'));
  };

  const canEdit = can(SCREENS.USER, 'edit');
  const canDelete = can(SCREENS.USER, 'delete');

  return (
    <div>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <h1>User Master</h1>
          {can(SCREENS.USER, 'add') && (
            <button className="btn btn-primary" onClick={() => open('add')}>+ Add New User</button>
          )}
        </div>

        {error && !modal && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} duration={notice.includes('User Rights') ? 7000 : 4000}>
          {notice.includes('User Rights') && can(SCREENS.USER_RIGHTS, 'edit') && <Link to="/user-rights">Open User Rights</Link>}
        </Toast>

        {can(SCREENS.USER, 'upload') && (
          <ExcelUpload endpoint="/users" templateName="User_Template.xlsx" onUploaded={fetchUsers} />
        )}

        <FilterBar
          search={filters.search}
          status={filters.status}
          onChange={setFilters}
          onExport={handleExport}
          placeholder="Search name or email"
        />

        {loading ? <p>Loading...</p> : (
          <DataTable
            columns={columns}
            rows={users}
            onEdit={canEdit ? (row) => open('edit', row) : null}
            onDelete={canDelete ? handleDelete : null}
            canDeleteRow={(row) => !row.isAdmin && row.id !== me.userId}
            extraActions={canEdit ? (row) => (
              <button className="btn btn-small btn-secondary" onClick={() => open('password', row)}>Reset Password</button>
            ) : null}
          />
        )}

        {me.isAdmin && <ActiveSessions onNotice={setNotice} />}

        {modal && (
          <Modal
            title={modal === 'password' ? `Reset Password - ${editingUser.userName}` : modal === 'edit' ? 'Edit User' : 'Add New User'}
            onClose={() => setModal(null)}
          >
            <form onSubmit={handleSave}>
              {error && <div className="alert alert-error">{error}</div>}

              {modal !== 'password' && (
                <>
                  <label>User Name</label>
                  <input
                    type="text" value={form.userName} maxLength={100} autoFocus
                    onChange={(e) => setForm({ ...form, userName: e.target.value })} required
                  />

                  <label>User Email ID</label>
                  <input
                    type="email" value={form.userEmail}
                    onChange={(e) => setForm({ ...form, userEmail: e.target.value })} required
                  />
                </>
              )}

              {modal !== 'edit' && (
                <>
                  <label>{modal === 'password' ? 'New Password' : 'Password'}</label>
                  <input
                    type="password" value={form.password} autoComplete="new-password"
                    onChange={(e) => setForm({ ...form, password: e.target.value })} required
                  />
                  <small className="hint">{PASSWORD_HINT}</small>
                </>
              )}

              {modal !== 'password' && (
                <>
                  <label>Status</label>
                  <select
                    value={form.status}
                    disabled={editingUser && (editingUser.isAdmin || editingUser.id === me.userId)}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </>
              )}

              <button type="submit" className="btn btn-primary btn-block">
                {modal === 'password' ? 'Reset Password' : 'Save'}
              </button>
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
