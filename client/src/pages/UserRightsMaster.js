import React, { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';

const FLAGS = [
  { key: 'canView', label: 'View' },
  { key: 'canAdd', label: 'Add' },
  { key: 'canEdit', label: 'Edit' },
  { key: 'canDelete', label: 'Delete' },
  { key: 'canUpload', label: 'Upload' },
];

export default function UserRightsMaster() {
  const { user: me, can, refresh } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // { userId, userName, isAdmin }
  const [rights, setRights] = useState([]);
  const [saved, setSaved] = useState('[]'); // JSON of rights as loaded, to detect unsaved changes
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const canEdit = can(SCREENS.USER_RIGHTS, 'edit');

  useEffect(() => {
    api.get('/user-rights/users')
      .then((res) => setUsers(res.data.data))
      .catch((err) => setError(errorMessage(err, 'Failed to load users.')));
  }, []);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => !term
      || u.user_name.toLowerCase().includes(term)
      || u.user_email.toLowerCase().includes(term));
  }, [users, search]);

  const dirty = JSON.stringify(rights) !== saved;

  const selectUser = async (u) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setError('');
    setNotice('');
    try {
      const res = await api.get(`/user-rights/${u.user_id}`);
      setSelected(res.data.data);
      setRights(res.data.data.rights);
      setSaved(JSON.stringify(res.data.data.rights));
    } catch (err) {
      setError(errorMessage(err, 'Failed to load rights.'));
    }
  };

  const toggle = (screenCode, flag) => {
    setRights((prev) => prev.map((r) => {
      if (r.screenCode !== screenCode) return r;
      const next = { ...r, [flag]: !r[flag] };
      // Other rights need View; removing View removes everything
      if (flag !== 'canView' && next[flag]) next.canView = true;
      if (flag === 'canView' && !next.canView) FLAGS.forEach((f) => { next[f.key] = false; });
      return next;
    }));
  };

  const setRow = (screenCode, value) => {
    setRights((prev) => prev.map((r) => (r.screenCode === screenCode
      ? { ...r, ...Object.fromEntries(FLAGS.map((f) => [f.key, value])) }
      : r)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/user-rights/${selected.userId}`, { rights });
      setRights(res.data.data);
      setSaved(JSON.stringify(res.data.data));
      setNotice(res.data.message);
      if (selected.userId === me.userId) refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save rights.'));
    } finally {
      setSaving(false);
    }
  };

  const locked = !canEdit || selected?.isAdmin;

  return (
    <div>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <h1>User Rights Master</h1>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}

        <div className="rights-layout">
          <aside className="rights-users">
            <input type="search" placeholder="Search users" value={search} onChange={(e) => setSearch(e.target.value)} />
            <ul>
              {filteredUsers.map((u) => (
                <li key={u.user_id}>
                  <button
                    type="button"
                    className={selected?.userId === u.user_id ? 'active' : ''}
                    onClick={() => selectUser(u)}
                  >
                    <span>{u.user_name}</span>
                    <small>{u.is_admin ? 'Administrator' : u.status}</small>
                  </button>
                </li>
              ))}
              {filteredUsers.length === 0 && <li className="empty-state">No users found.</li>}
            </ul>
          </aside>

          <section className="rights-grid">
            {!selected ? (
              <p className="empty-state">Select a user to see and change their access.</p>
            ) : (
              <>
                <h3>{selected.userName}</h3>
                {selected.isAdmin && (
                  <div className="alert alert-info">Administrators always have full access. Their rights cannot be changed.</div>
                )}
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Screen</th>
                        {FLAGS.map((f) => <th key={f.key} className="center">{f.label}</th>)}
                        {!locked && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {rights.map((r) => (
                        <tr key={r.screenCode}>
                          <td>{r.screenName}<br /><small className="hint">{r.menuGroup}</small></td>
                          {FLAGS.map((f) => (
                            <td key={f.key} className="center">
                              <input
                                type="checkbox"
                                className="checkbox"
                                aria-label={`${r.screenName} ${f.label}`}
                                checked={r[f.key]}
                                disabled={locked}
                                onChange={() => toggle(r.screenCode, f.key)}
                              />
                            </td>
                          ))}
                          {!locked && (
                            <td className="actions-cell">
                              <button type="button" className="btn btn-small btn-secondary" onClick={() => setRow(r.screenCode, true)}>All</button>
                              <button type="button" className="btn btn-small btn-secondary" onClick={() => setRow(r.screenCode, false)}>None</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!locked && (
                  <div className="form-actions">
                    <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={handleSave}>
                      {saving ? 'Saving...' : 'Save Rights'}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => setRights(JSON.parse(saved))}>
                      Undo changes
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
