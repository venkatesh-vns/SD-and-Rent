import React, { useEffect, useState, useCallback } from 'react';
import Toast from '../components/Toast';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import DataTable from '../components/DataTable';
import Pager from '../components/Pager';
import Modal from '../components/Modal';
import ExcelUpload from '../components/ExcelUpload';
import FilterBar from '../components/FilterBar';
import MultiSelect from '../components/MultiSelect';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';

const LEVELS = [1, 2, 3];

const COLUMNS = {
  1: [
    { key: 'code', label: 'Level 1 Code' },
    { key: 'name', label: 'Level 1 Name' },
    { key: 'status', label: 'Status' },
  ],
  2: [
    { key: 'l1Name', label: 'Level 1' },
    { key: 'code', label: 'Level 2 Code' },
    { key: 'name', label: 'Level 2 Name' },
    { key: 'status', label: 'Status' },
  ],
  3: [
    { key: 'l1Name', label: 'Level 1' },
    { key: 'l2Name', label: 'Level 2' },
    { key: 'code', label: 'Level 3 Code' },
    { key: 'name', label: 'Level 3 Name' },
    { key: 'status', label: 'Status' },
  ],
};

function toRow(level, r) {
  const prefix = `l${level}`;
  return {
    id: r[`${prefix}_id`],
    code: r[`${prefix}_code`],
    name: r[`${prefix}_name`],
    status: r.status,
    l1Id: r.l1_id,
    l2Id: r.l2_id,
    l1Name: r.l1_name,
    l2Name: r.l2_name,
  };
}

// Options for a parent dropdown: Active records, plus the record's current
// parent even if it has since been made Inactive
function parentOptions(list, level, currentId) {
  return list.filter((p) => p.status === 'Active' || p[`l${level}_id`] === currentId);
}

export default function LocationMaster() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const level = LEVELS.includes(Number(params.get('level'))) ? Number(params.get('level')) : 1;

  const [rows, setRows] = useState([]);
  // Newest first, 10 per page (the list API also serves dropdowns, so paging is done here)
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({ search: '', status: [], l1Id: [], l2Id: [] });
  const [allL1, setAllL1] = useState([]);
  const [filterL2, setFilterL2] = useState([]); // Level 2 options for the Level 3 filter
  const [formL2, setFormL2] = useState([]); // Level 2 options for the Level 3 form
  const [modal, setModal] = useState(null); // null | { editing }
  const [form, setForm] = useState({ name: '', status: 'Active', l1Id: '', l2Id: '' });
  const search = useDebounce(filters.search);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/locations/${level}`, {
        params: { search, status: filters.status, l1Id: filters.l1Id, l2Id: filters.l2Id },
      });
      setRows(res.data.data.map((r) => toRow(level, r)).sort((a, b) => b.id - a.id));
    } catch (err) {
      setError(errorMessage(err, 'Failed to load locations.'));
    } finally {
      setLoading(false);
    }
  }, [level, search, filters.status, filters.l1Id, filters.l2Id]);

  const fetchL1 = useCallback(async () => {
    try {
      const res = await api.get('/locations/1');
      setAllL1(res.data.data);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load Level 1 list.'));
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { setPage(1); }, [level, search, filters.status, filters.l1Id, filters.l2Id]);
  // Stay on a page that still exists after a delete
  const pages = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { fetchL1(); }, [fetchL1]);

  // Level 3 filter: Level 2 choices follow the chosen Level 1
  useEffect(() => {
    if (level !== 3 || !filters.l1Id.length) {
      setFilterL2([]);
      return;
    }
    api.get('/locations/2', { params: { l1Id: filters.l1Id } }).then((res) => {
      setFilterL2(res.data.data);
      // Drop Level 2 picks that no longer belong to the chosen Level 1s
      const valid = new Set(res.data.data.map((p) => String(p.l2_id)));
      setFilters((f) => (f.l2Id.every((id) => valid.has(String(id))) ? f : { ...f, l2Id: f.l2Id.filter((id) => valid.has(String(id))) }));
    }).catch(() => setFilterL2([]));
  }, [level, filters.l1Id]);

  // Level 3 form: Level 2 choices follow the chosen Level 1
  useEffect(() => {
    if (!modal || level !== 3 || !form.l1Id) {
      setFormL2([]);
      return;
    }
    api.get('/locations/2', { params: { l1Id: form.l1Id } }).then((res) => setFormL2(res.data.data)).catch(() => setFormL2([]));
  }, [modal, level, form.l1Id]);

  const switchLevel = (next) => {
    setParams({ level: String(next) });
    setFilters({ search: '', status: [], l1Id: [], l2Id: [] });
    setError('');
    setNotice('');
  };

  const openModal = (row = null) => {
    setForm(row
      ? { name: row.name, status: row.status, l1Id: row.l1Id || '', l2Id: row.l2Id || '' }
      : { name: '', status: 'Active', l1Id: filters.l1Id.length === 1 ? filters.l1Id[0] : '', l2Id: filters.l2Id.length === 1 ? filters.l2Id[0] : '' });
    setError('');
    setModal({ editing: row });
  };

  const afterChange = (message) => {
    setNotice(message);
    fetchRows();
    if (level === 1) fetchL1();
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = modal.editing
        ? await api.put(`/locations/${level}/${modal.editing.id}`, form)
        : await api.post(`/locations/${level}`, form);
      setModal(null);
      if (!modal.editing) setPage(1);
      afterChange(res.data.message);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save location.'));
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete ${row.code} - ${row.name}?`)) return;
    setError('');
    try {
      const res = await api.delete(`/locations/${level}/${row.id}`);
      afterChange(res.data.message);
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete location.'));
    }
  };

  const handleExport = () => {
    downloadFile(`/locations/${level}/export`, { search, status: filters.status, l1Id: filters.l1Id, l2Id: filters.l2Id }, `Location_Level${level}.xlsx`)
      .catch(() => setError('Export failed.'));
  };

  const editing = modal?.editing;

  return (
    <div>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <h1>Location Master</h1>
          {can(SCREENS.LOCATION, 'add') && (
            <button className="btn btn-primary" onClick={() => openModal()}>+ Add Level {level}</button>
          )}
        </div>

        <div className="tabs" role="tablist">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={l === level}
              className={l === level ? 'active' : ''}
              onClick={() => switchLevel(l)}
            >
              Level {l}
            </button>
          ))}
        </div>

        {error && !modal && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} />

        {can(SCREENS.LOCATION, 'upload') && (
          <ExcelUpload
            key={level}
            endpoint={`/locations/${level}`}
            templateName={`Location_Level${level}_Template.xlsx`}
            onUploaded={() => afterChange('')}
          />
        )}

        {level >= 2 && (
          <div className="filter-bar">
            <MultiSelect
              allLabel="All Level 1" noun="Level 1"
              options={allL1.map((p) => ({ value: p.l1_id, label: p.l1_name }))}
              value={filters.l1Id} onChange={(v) => setFilters({ ...filters, l1Id: v })}
            />
            {level === 3 && (
              <MultiSelect
                allLabel={filters.l1Id.length ? 'All Level 2' : 'Choose Level 1 first'} noun="Level 2" disabled={!filters.l1Id.length}
                options={filterL2.map((p) => ({ value: p.l2_id, label: p.l2_name }))}
                value={filters.l2Id} onChange={(v) => setFilters({ ...filters, l2Id: v })}
              />
            )}
          </div>
        )}
        <FilterBar
          search={filters.search}
          status={filters.status}
          onChange={(f) => setFilters({ ...filters, ...f })}
          onExport={handleExport}
          placeholder={`Search Level ${level} code or name`}
        />

        {loading ? <p>Loading...</p> : (
          <>
            <DataTable
              columns={COLUMNS[level]}
              rows={pageRows}
              onEdit={can(SCREENS.LOCATION, 'edit') ? openModal : null}
              onDelete={can(SCREENS.LOCATION, 'delete') ? handleDelete : null}
            />
            <Pager page={page} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} />
          </>
        )}

        {modal && (
          <Modal title={editing ? `Edit Level ${level} ${editing.code}` : `Add Level ${level}`} onClose={() => setModal(null)}>
            <form onSubmit={handleSave}>
              {error && <div className="alert alert-error">{error}</div>}

              <label>Level {level} Code</label>
              <input type="text" value={editing ? editing.code : 'Auto-generated on save'} disabled />

              {level >= 2 && (
                <>
                  <label htmlFor="loc-l1">Level 1</label>
                  <select
                    id="loc-l1"
                    value={form.l1Id}
                    required
                    onChange={(e) => setForm({ ...form, l1Id: e.target.value, l2Id: '' })}
                  >
                    <option value="">Select Level 1</option>
                    {parentOptions(allL1, 1, editing?.l1Id).map((p) => (
                      <option key={p.l1_id} value={p.l1_id}>
                        {p.l1_name}{p.status !== 'Active' ? ' (Inactive)' : ''}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {level === 3 && (
                <>
                  <label htmlFor="loc-l2">Level 2</label>
                  <select
                    id="loc-l2"
                    value={form.l2Id}
                    required
                    disabled={!form.l1Id}
                    onChange={(e) => setForm({ ...form, l2Id: e.target.value })}
                  >
                    <option value="">{form.l1Id ? 'Select Level 2' : 'Select Level 1 first'}</option>
                    {parentOptions(formL2, 2, editing?.l2Id).map((p) => (
                      <option key={p.l2_id} value={p.l2_id}>
                        {p.l2_name}{p.status !== 'Active' ? ' (Inactive)' : ''}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <label htmlFor="loc-name">Level {level} Name</label>
              <input
                id="loc-name"
                type="text" value={form.name} maxLength={150} autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })} required
              />

              <label htmlFor="loc-status">Status</label>
              <select id="loc-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>

              <button type="submit" className="btn btn-primary btn-block">Save</button>
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
