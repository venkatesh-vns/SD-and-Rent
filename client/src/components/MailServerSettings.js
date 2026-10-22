import React, { useEffect, useState } from 'react';
import Toast from './Toast';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';

const FIELDS = ['from_name', 'from_email', 'default_recipients', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user'];

// Security options for the port field
const SECURITY = [
  { value: '', label: 'Use server setting (.env)' },
  { value: 'false', label: 'STARTTLS / none (usually port 587 or 25)' },
  { value: 'true', label: 'SSL/TLS (usually port 465)' },
];

const toForm = (d) => ({
  ...Object.fromEntries(FIELDS.map((f) => [f, d[f] ?? ''])),
  smtp_port: d.smtp_port === null || d.smtp_port === undefined ? '' : String(d.smtp_port),
  smtp_secure: d.smtp_secure === null || d.smtp_secure === undefined ? '' : String(d.smtp_secure),
  password: '',
  clear_password: false,
});

// Mail server (SMTP) and sender settings - administrators only
export default function MailServerSettings() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState('');
  const [errors, setErrors] = useState([]);
  const [notice, setNotice] = useState('');
  const [testTo, setTestTo] = useState(user?.userEmail || '');
  const [testResult, setTestResult] = useState(null); // { ok, message }
  const [busy, setBusy] = useState('');

  const apply = (d) => {
    const f = toForm(d);
    setData(d);
    setForm(f);
    setSaved(JSON.stringify(f));
  };

  useEffect(() => {
    api.get('/mail-settings')
      .then((res) => apply(res.data.data))
      .catch((err) => setErrors([{ field: '', error: errorMessage(err, 'Failed to load mail server settings.') }]));
  }, []);

  if (!form) return errors.length ? <div className="alert alert-error">{errors[0].error}</div> : <p>Loading...</p>;

  const dirty = JSON.stringify(form) !== saved;
  const env = data.env;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const envHint = (value) => (value ? `Server default: ${value}` : 'Not set in the server .env');

  const body = () => ({
    ...form,
    smtp_secure: form.smtp_secure === '' ? null : form.smtp_secure === 'true',
  });

  const handleSave = async () => {
    setBusy('save');
    setErrors([]);
    setNotice('');
    try {
      const res = await api.put('/mail-settings', body());
      apply(res.data.data);
      setNotice(res.data.message);
    } catch (err) {
      const list = err.response?.data?.errors;
      setErrors(list?.length ? list : [{ field: '', error: errorMessage(err, 'Failed to save the settings.') }]);
    } finally {
      setBusy('');
    }
  };

  const handleTest = async () => {
    setBusy('test');
    setTestResult(null);
    try {
      const res = await api.post('/mail-settings/test', { ...body(), to: testTo });
      setTestResult({ ok: true, message: res.data.message });
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err, 'The test email could not be sent.') });
    } finally {
      setBusy('');
    }
  };

  const passwordState = data.password_unreadable
    ? 'The saved password can no longer be read (the server secret changed). Enter it again.'
    : data.has_password ? 'A password is saved. Leave blank to keep it.'
      : env.has_password ? 'Using the password from the server .env. Enter one to replace it.' : 'No password set.';

  return (
    <section className="card mail-settings">
      <div className="tpl-editor-head">
        <div>
          <h2>Mail server and sender</h2>
          <p className="hint">
            Used for every email the application sends. Leave a field blank to use the server default (.env).
            {data.modified_by && ` Last changed by ${data.modified_by}.`}
          </p>
        </div>
        <span className="badge badge-passive" title="Only administrators can see and change these settings">Administrators only</span>
      </div>

      {data.dry_run && (
        <div className="alert alert-info">
          Dry-run mode is on for this server (EMAIL_DRY_RUN=true): emails are written to the Email Log but not sent.
        </div>
      )}
      <Toast message={notice} onClose={() => setNotice('')} />
      {errors.length > 0 && (
        <div className="alert alert-error">
          <strong>Please correct the following:</strong>
          <ul>{errors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.error}</li>)}</ul>
        </div>
      )}

      <h3 className="form-section">Sender</h3>
      <div className="form-grid">
        <div>
          <label htmlFor="ms-from-name">Sender name</label>
          <input id="ms-from-name" type="text" maxLength={150} value={form.from_name} onChange={set('from_name')} placeholder={env.from_name || 'e.g. SD and Rent Maintenance'} />
          <span className="hint">Shown as "From" in the recipient's inbox.</span>
        </div>
        <div>
          <label htmlFor="ms-from-email">Sender email</label>
          <input id="ms-from-email" type="email" value={form.from_email} onChange={set('from_email')} placeholder={env.from_email || 'no-reply@company.com'} />
          <span className="hint">{envHint(env.from_email)}</span>
        </div>
        <div className="span-2">
          <label htmlFor="ms-default-to">Default recipients</label>
          <input id="ms-default-to" type="text" value={form.default_recipients} onChange={set('default_recipients')} placeholder={env.default_recipients || 'team@company.com, finance@company.com'} />
          <span className="hint">Used by any notification whose To is left blank. Separate addresses with commas.</span>
        </div>
      </div>

      <h3 className="form-section">SMTP server</h3>
      <div className="form-grid three">
        <div>
          <label htmlFor="ms-host">SMTP server</label>
          <input id="ms-host" type="text" value={form.smtp_host} onChange={set('smtp_host')} placeholder={env.smtp_host || 'smtp.office365.com'} autoComplete="off" />
          <span className="hint">{envHint(env.smtp_host)}</span>
        </div>
        <div>
          <label htmlFor="ms-port">Port</label>
          <input id="ms-port" type="number" min={1} max={65535} value={form.smtp_port} onChange={set('smtp_port')} placeholder={env.smtp_port} />
          <span className="hint">{envHint(env.smtp_port)}</span>
        </div>
        <div>
          <label htmlFor="ms-secure">Security</label>
          <select id="ms-secure" value={form.smtp_secure} onChange={set('smtp_secure')}>
            {SECURITY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="hint">Server default: {env.smtp_secure ? 'SSL/TLS' : 'STARTTLS / none'}</span>
        </div>
      </div>
      <div className="form-grid">
        <div>
          <label htmlFor="ms-user">Username</label>
          <input id="ms-user" type="text" value={form.smtp_user} onChange={set('smtp_user')} placeholder={env.smtp_user || 'Often the sender email'} autoComplete="off" />
          <span className="hint">{envHint(env.smtp_user)}</span>
        </div>
        <div>
          <label htmlFor="ms-password">Password</label>
          <input
            id="ms-password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password"
            placeholder={data.has_password ? '•••••••• (saved)' : ''} disabled={form.clear_password}
          />
          <span className="hint">{passwordState}</span>
          {data.has_password && (
            <label className="inline-check ms-clear">
              <input type="checkbox" checked={form.clear_password} onChange={set('clear_password')} />
              Remove the saved password (use the server .env)
            </label>
          )}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy === 'save'} onClick={handleSave}>
          {busy === 'save' ? 'Saving...' : 'Save settings'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => setForm(JSON.parse(saved))}>Undo changes</button>
      </div>

      <div className="ms-test">
        <h3 className="form-section">Send a test email</h3>
        <p className="hint">Checks the connection and login, then sends a short test message using the values above (saved or not).</p>
        <div className="ms-test-row">
          <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send the test to" aria-label="Send the test to" />
          <button type="button" className="btn btn-outline" disabled={!testTo || busy === 'test'} onClick={handleTest}>
            {busy === 'test' ? <><span className="spinner spinner-dark" /> Sending...</> : 'Send test email'}
          </button>
        </div>
        {testResult && <div className={`alert ${testResult.ok ? 'alert-success' : 'alert-error'}`}>{testResult.message}</div>}
      </div>
    </section>
  );
}
