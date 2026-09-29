import React, { useEffect, useRef, useState } from 'react';
import Toast from '../components/Toast';
import Navbar from '../components/Navbar';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';
import MailServerSettings from '../components/MailServerSettings';

const FIELDS = ['is_enabled', 'to_recipients', 'cc_recipients', 'days_before', 'subject', 'body', 'include_details'];

// Each notification has its own colour and icon so the list is easy to scan
const LOOK = {
  LEASE_COMMENCEMENT_REMINDER: { color: '#1d4ed8', bg: '#eff6ff', icon: 'M4 6h16v14H4V6Zm0 4h16M8 3v4M16 3v4M9 15l2 2 4-4' },
  RENT_COMMENCEMENT_REMINDER: { color: '#0f766e', bg: '#f0fdfa', icon: 'M7 5h10M7 9h10M13 20 7 13h2a4 4 0 0 0 0-8' },
  LEASE_END_REMINDER: { color: '#b45309', bg: '#fffbeb', icon: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9' },
  LANDLORD_STATUS_PASSIVE: { color: '#be123c', bg: '#fff1f2', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0' },
  BUILDING_STATUS_PASSIVE: { color: '#6d28d9', bg: '#f5f3ff', icon: 'M4 21h16M6 21V4h9v17M15 9h3v12M9 8h2M9 12h2M9 16h2' },
};
const FALLBACK_LOOK = { color: '#475569', bg: '#f1f5f9', icon: 'M4 6h16v12H4V6Zm0 1 8 6 8-6' };
const lookOf = (type) => LOOK[type] || FALLBACK_LOOK;
const lookStyle = (type) => ({ '--tc': lookOf(type).color, '--tc-bg': lookOf(type).bg });

function TplIcon({ type, size = 18 }) {
  return (
    <span className="tpl-icon" style={lookStyle(type)} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={lookOf(type).icon} />
      </svg>
    </span>
  );
}

const toForm = (t) => Object.fromEntries(FIELDS.map((f) => [f, t[f] ?? (f === 'days_before' ? '' : '')]));

export default function EmailTemplates() {
  const { can, user } = useAuth();
  const canEdit = can(SCREENS.NOTIFICATION, 'edit');
  const [tab, setTab] = useState('templates'); // 'templates' | 'server'
  const [templates, setTemplates] = useState([]);
  const [defaultRecipients, setDefaultRecipients] = useState('');
  const [selected, setSelected] = useState(null); // notification_type
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [formErrors, setFormErrors] = useState([]);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const lastField = useRef('body'); // where a clicked placeholder goes
  const debouncedForm = useDebounce(form, 400);

  const current = templates.find((t) => t.notification_type === selected);
  const dirty = form && JSON.stringify(form) !== saved;

  const load = async (keep) => {
    try {
      const res = await api.get('/notification-templates');
      setTemplates(res.data.data);
      setDefaultRecipients(res.data.defaultRecipients);
      const first = keep || res.data.data[0]?.notification_type;
      if (first) select(first, res.data.data);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load email templates.'));
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function select(type, list = templates) {
    const t = list.find((x) => x.notification_type === type);
    if (!t) return;
    const f = toForm(t);
    setSelected(type);
    setForm(f);
    setSaved(JSON.stringify(f));
    setFormErrors([]);
    setNotice('');
  }

  const choose = (type) => {
    if (type === selected) return;
    if (dirty && !window.confirm('Discard unsaved changes to this template?')) return;
    select(type);
  };

  // Live preview of the unsaved form
  useEffect(() => {
    if (!debouncedForm || !selected) return;
    api.post(`/notification-templates/${selected}/preview`, debouncedForm)
      .then((res) => setPreview(res.data.data))
      .catch(() => setPreview(null));
  }, [debouncedForm, selected]);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  // Insert {{name}} at the cursor of the subject or body, whichever was used last
  const insertPlaceholder = (name) => {
    if (!canEdit) return;
    const key = lastField.current;
    const el = key === 'subject' ? subjectRef.current : bodyRef.current;
    const token = `{{${name}}}`;
    const value = form[key] || '';
    const start = el ? el.selectionStart ?? value.length : value.length;
    const end = el ? el.selectionEnd ?? value.length : value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    setForm({ ...form, [key]: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setFormErrors([]);
    setNotice('');
    try {
      const res = await api.put(`/notification-templates/${selected}`, form);
      setNotice(res.data.message);
      await load(selected);
    } catch (err) {
      const list = err.response?.data?.errors;
      setFormErrors(list?.length ? list : [{ field: '', error: errorMessage(err, 'Failed to save the template.') }]);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(`Restore the default wording and settings for "${current.name}"? Your changes to this template will be replaced.`)) return;
    try {
      const res = await api.post(`/notification-templates/${selected}/reset`);
      setNotice(res.data.message);
      await load(selected);
    } catch (err) {
      setError(errorMessage(err, 'Failed to restore the default.'));
    }
  };

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <div>
            <h1>Email Notification Master</h1>
            <p className="hint">Choose who receives each SD notification, when reminders are sent, and what the email says.</p>
          </div>
        </div>

        {user?.isAdmin && (
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'templates'} className={tab === 'templates' ? 'active' : ''}
              onClick={() => setTab('templates')}>Notifications</button>
            <button type="button" role="tab" aria-selected={tab === 'server'} className={tab === 'server' ? 'active' : ''}
              onClick={() => { if (!dirty || window.confirm('Discard unsaved changes to this template?')) { if (dirty) setForm(JSON.parse(saved)); setTab('server'); } }}>
              Mail Server (SMTP)
            </button>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        {tab === 'server' && user?.isAdmin && <MailServerSettings />}

        <div className="tpl-layout" hidden={tab !== 'templates'}>
          <aside className="tpl-list">
            {[['Date reminders', true], ['Status alerts', false]].map(([heading, reminder]) => {
              const group = templates.filter((t) => Boolean(t.is_reminder) === reminder);
              if (!group.length) return null;
              return (
                <div key={heading} className="tpl-group">
                  <h3 className="tpl-group-title">{heading}</h3>
                  {group.map((t) => (
                    <button
                      key={t.notification_type}
                      type="button"
                      style={lookStyle(t.notification_type)}
                      className={[t.notification_type === selected ? 'active' : '', t.is_enabled ? '' : 'is-off'].filter(Boolean).join(' ') || undefined}
                      onClick={() => choose(t.notification_type)}
                    >
                      <TplIcon type={t.notification_type} />
                      <span className="tpl-list-text">
                        <span className="tpl-list-name">{t.name}</span>
                        <span className="tpl-list-meta">
                          <span className={`tpl-state ${t.is_enabled ? 'on' : 'off'}`}>{t.is_enabled ? 'On' : 'Off'}</span>
                          <span className={`tpl-when-chip ${t.is_reminder ? 'reminder' : 'status'}`}>
                            {t.is_reminder ? `${t.days_before} day(s) before` : 'On status change'}
                          </span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </aside>

          {current && form && (
            <section className="tpl-editor card" style={lookStyle(current.notification_type)}>
              <div className="tpl-editor-head">
                <TplIcon type={current.notification_type} size={22} />
                <div className="tpl-editor-title">
                  <h2>{current.name}</h2>
                  <p className="hint">{current.description}</p>
                </div>
                <label className="switch" title={canEdit ? 'Switch this notification on or off' : undefined}>
                  <input type="checkbox" checked={form.is_enabled} disabled={!canEdit} onChange={set('is_enabled')} />
                  <span className="switch-track"><span className="switch-thumb" /></span>
                  <span className="switch-label">{form.is_enabled ? 'On' : 'Off'}</span>
                </label>
              </div>

              <Toast message={notice} onClose={() => setNotice('')} />
              {formErrors.length > 0 && (
                <div className="alert alert-error">
                  <strong>Please correct the following:</strong>
                  <ul>{formErrors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.error}</li>)}</ul>
                </div>
              )}

              <fieldset disabled={!canEdit}>
                {current.is_reminder ? (
                  <div className="tpl-when">
                    <span>Send</span>
                    <input
                      type="number" min={0} max={365} className="tpl-days"
                      value={form.days_before} onChange={set('days_before')} aria-label="Trigger days"
                    />
                    <span>day(s) before the <strong>{current.date_label}</strong>, once per SD Code.</span>
                  </div>
                ) : (
                  <div className="tpl-when">
                    <span>Sent <strong>immediately</strong> when the status changes from Active to Passive (form or Excel upload).</span>
                  </div>
                )}

                <div className="form-grid">
                  <div>
                    <label htmlFor="tpl-to">To</label>
                    <input
                      id="tpl-to" type="text" value={form.to_recipients} onChange={set('to_recipients')}
                      placeholder={defaultRecipients ? `Default: ${defaultRecipients}` : 'name@company.com, team@company.com'}
                    />
                    <span className="hint">Separate addresses with commas. Leave blank to use the default mailbox.</span>
                  </div>
                  <div>
                    <label htmlFor="tpl-cc">CC</label>
                    <input id="tpl-cc" type="text" value={form.cc_recipients} onChange={set('cc_recipients')} placeholder="Optional" />
                  </div>
                </div>

                <label htmlFor="tpl-subject">Subject</label>
                <input
                  id="tpl-subject" ref={subjectRef} type="text" maxLength={255}
                  value={form.subject} onChange={set('subject')} onFocus={() => { lastField.current = 'subject'; }}
                />

                <label htmlFor="tpl-body">Email body</label>
                <textarea
                  id="tpl-body" ref={bodyRef} rows={9}
                  value={form.body} onChange={set('body')} onFocus={() => { lastField.current = 'body'; }}
                />

                <div className="tpl-placeholders">
                  <span className="hint">Insert a field (click to add it where your cursor is):</span>
                  <div className="chips">
                    {Object.entries(current.placeholders).map(([name, label]) => (
                      <button key={name} type="button" className="chip" title={label} onClick={() => insertPlaceholder(name)}>
                        {`{{${name}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="inline-check tpl-details">
                  <input type="checkbox" checked={form.include_details} onChange={set('include_details')} />
                  Add the SD details table (SD Code, lease, location, landlord, dates) below the message
                </label>
              </fieldset>

              {canEdit && (
                <div className="form-actions">
                  <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={handleSave}>
                    {saving ? 'Saving...' : 'Save template'}
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => setForm(JSON.parse(saved))}>
                    Undo changes
                  </button>
                  <button type="button" className="btn btn-secondary tpl-reset" onClick={handleReset}>Restore default</button>
                </div>
              )}

              <div className="tpl-preview">
                <div className="tpl-preview-head">
                  <strong>Preview</strong>
                  <span className="hint">Sample SD data · {dirty ? 'unsaved changes' : 'as saved'}</span>
                </div>
                {preview && (
                  <div className="tpl-mail">
                    <dl>
                      <div><dt>To</dt><dd>{preview.to}</dd></div>
                      {preview.cc && <div><dt>CC</dt><dd>{preview.cc}</dd></div>}
                      <div><dt>Subject</dt><dd><strong>{preview.subject}</strong></dd></div>
                    </dl>
                    {preview.errors?.length > 0 && (
                      <div className="alert alert-error">{preview.errors.map((e) => `${e.field}: ${e.error}`).join(' ')}</div>
                    )}
                    <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="tpl-frame" />
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
