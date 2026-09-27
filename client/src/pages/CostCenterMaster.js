import React, { useEffect, useState, useCallback } from 'react';
import Navbar from '../components/Navbar';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import ExcelUpload from '../components/ExcelUpload';
import FilterBar from '../components/FilterBar';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';

const columns = [
  { key: 'code', label: 'Cost Center Code' },
  { key: 'name', label: 'Cost Center Name' },
  { key: 'status', label: 'Status' },
  { key: 'modified', label: 'Last Changed' },
];

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('en-GB') : '';
}

export default function CostCenterMaster() {
  const { can } = useAuth();
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState({ name: '', status: 'Active' });
  const search = useDebounce(filters.search);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/cost-centers', { params: { search, status: filters.status } });
      setCostCenters(res.data.data.map((c) => ({
        id: c.cost_center_id,
        code: c.cost_center_code,
        name: c.cost_center_name,
        status: c.status,
        modified: `${formatDate(c.modified_date || c.created_date)} by ${c.modified_by || c.created_by || '-'}`,
      })));
    } catch (err) {
      setError(errorMessage(err, 'Failed to load cost centers.'));
    } finally {
      setLoading(false);
    }
  }, [search, filters.status]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAddModal = () => {
    setEditingItem(null);
    setForm({ name: '', status: 'Active' });
    setError('');
    setShowModal(true);
  };

  const openEditModal = (row) => {
    setEditingItem(row);
    setForm({ name: row.name, status: row.status });
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = editingItem
        ? await api.put(`/cost-centers/${editingItem.id}`, form)
        : await api.post('/cost-centers', form);
      setNotice(res.data.message);
      setShowModal(false);
      fetchData();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save cost center.'));
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete cost center '${row.code} - ${row.name}'?`)) return;
    setError('');
    try {
      const res = await api.delete(`/cost-centers/${row.id}`);
      setNotice(res.data.message);
      fetchData();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete cost center.'));
    }
  };

  const handleExport = () => {
    downloadFile('/cost-centers/export', { search, status: filters.status }, 'CostCenters.xlsx')
      .catch(() => setError('Export failed.'));
  };

  return (
    <div>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <h1>Cost Center Master</h1>
          {can(SCREENS.COST_CENTER, 'add') && (
            <button className="btn btn-primary" onClick={openAddModal}>+ Add New Cost Center</button>
          )}
        </div>

        {error && !showModal && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success" onClick={() => setNotice('')}>{notice}</div>}

        {can(SCREENS.COST_CENTER, 'upload') && (
          <ExcelUpload endpoint="/cost-centers" templateName="CostCenter_Template.xlsx" onUploaded={fetchData} />
        )}

        <FilterBar
          search={filters.search}
          status={filters.status}
          onChange={setFilters}
          onExport={handleExport}
          placeholder="Search code or name"
        />

        {loading ? <p>Loading...</p> : (
          <DataTable
            columns={columns}
            rows={costCenters}
            onEdit={can(SCREENS.COST_CENTER, 'edit') ? openEditModal : null}
            onDelete={can(SCREENS.COST_CENTER, 'delete') ? handleDelete : null}
          />
        )}

        {showModal && (
          <Modal title={editingItem ? `Edit Cost Center ${editingItem.code}` : 'Add New Cost Center'} onClose={() => setShowModal(false)}>
            <form onSubmit={handleSave}>
              {error && <div className="alert alert-error">{error}</div>}

              <label>Cost Center Code</label>
              <input type="text" value={editingItem ? editingItem.code : 'Auto-generated on save'} disabled />

              <label>Cost Center Name</label>
              <input
                type="text" value={form.name} maxLength={150} autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })} required
              />

              <label>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
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
