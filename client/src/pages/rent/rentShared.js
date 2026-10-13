import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { formatAmount, formatDate } from '../../utils/format';

// The nine Rent Agreement components (same order and codes as the server)
export const COMPONENTS = [
  { code: 'ADDITIONAL_PARKING', label: 'Additional Parking Charges', unit: 'count' },
  { code: 'FITOUTS', label: 'Rent - Fitouts (Exp)', unit: 'sqft' },
  { code: 'CAFE', label: 'Rent to Landlord - Cafe', unit: 'sqft' },
  { code: 'CAR_PARK', label: 'Rent to Landlord - Car Park Rent', unit: 'count' },
  { code: 'OFFICE', label: 'Rent to Landlord - Office Rent', unit: 'sqft' },
  { code: 'SIGNAGE', label: 'Rent to Landlord - Signage Space', unit: 'month' },
  { code: 'SOLAR', label: 'Rent to Landlord - Solar', unit: 'month' },
  { code: 'TERRACE', label: 'Rent to Landlord - Terrace', unit: 'sqft' },
  { code: 'MAINTENANCE', label: 'Maintenance Charges - Landlord', unit: 'sqft' },
];
export const COMPONENT_LABEL = Object.fromEntries(COMPONENTS.map((c) => [c.code, c.label]));
// "Applies to" of a rule / waiver: no list = all components
export const appliesToLabel = (codes) => (!codes || !codes.length ? 'All components' : codes.map((k) => COMPONENT_LABEL[k] || k).join(', '));
export const COMPONENT_OPTIONS = COMPONENTS.map((c) => ({ value: c.code, label: c.label }));

export const triggerName = (c) => (c.unit === 'sqft' ? 'Sq.Ft' : c.unit === 'count' ? 'No.' : 'Rate / Month');

// Quantity x Rate x % (Signage / Solar: Rate x %)
export function monthlyAmount({ quantity, rate, percentage }) {
  const n = (v) => Number(String(v ?? '').replace(/[,\s₹%]/g, ''));
  const q = quantity === undefined || quantity === null || quantity === '' ? 1 : n(quantity);
  const r = n(rate);
  const p = n(percentage);
  return Number.isFinite(q * r * p) ? (q * r * p) / 100 : 0;
}

export const agreementTotal = (components = []) => components.reduce((s, c) => s + monthlyAmount(c), 0);

// Lists the Rent Transaction screens pick from: Rent Codes, SD Codes, floors, landlords
export function useRentLookups() {
  const [data, setData] = useState({ rents: [], sds: [], floors: [], landlords: [] });
  const reload = useCallback(() => {
    api.get('/rent/lookups').then((res) => setData(res.data.data)).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { ...data, reload };
}

export const rentLabel = (r) => `${r.rent_code} · ${r.landlord_name} · ${r.sd_code} · ${r.floor}${r.ll_status === 'Inactive' ? ' (Inactive)' : ''}`;

// DD/MM/YYYY text input, like the SD screens
export function DateInput({ id, label, value, onChange, required = false, disabled = false }) {
  return (
    <div>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      <input
        id={id} type="text" inputMode="numeric" placeholder="DD/MM/YYYY" maxLength={10} required={required} disabled={disabled}
        pattern="\d{1,2}/\d{1,2}/\d{4}" title="DD/MM/YYYY" value={value} onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function FormErrors({ errors }) {
  if (!errors.length) return null;
  return (
    <div className="alert alert-error">
      <strong>Please correct the following:</strong>
      <ul>{errors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.error}</li>)}</ul>
    </div>
  );
}

// The SD-sourced dates of a Rent Code, shown read-only on every Rent screen
export function LeaseDates({ rec }) {
  if (!rec) return null;
  return (
    <dl className="rent-facts">
      <div><dt>SD Code</dt><dd>{rec.sd_code}</dd></div>
      <div><dt>Cost Center</dt><dd>{rec.cost_center_name || '—'}</dd></div>
      <div><dt>Floor</dt><dd>{rec.floor || '—'}</dd></div>
      <div><dt>LCD</dt><dd>{formatDate(rec.lcd) || '—'}</dd></div>
      <div><dt>RCD</dt><dd>{formatDate(rec.rcd) || '—'}</dd></div>
      <div><dt>LED</dt><dd>{formatDate(rec.led) || '—'}</dd></div>
    </dl>
  );
}

export const money = (v) => `₹${formatAmount(v)}`;
