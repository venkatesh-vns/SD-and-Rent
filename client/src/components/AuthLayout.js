import React from 'react';
import Scene3D from './Scene3D';
import logo from '../assets/indiqube-logo.png';
import mark from '../assets/indiqube-mark.png';

// Shared layout for Login, Forgot Password and Reset Password:
// brand panel with the 3D scene on the left, the form card on the right.
export default function AuthLayout({ children }) {
  const year = new Date().getFullYear();
  return (
    <div className="auth-shell">
      <section className="auth-brand">
        <div className="auth-glow auth-glow-1" />
        <div className="auth-glow auth-glow-2" />

        <header className="auth-brand-head">
          <img src={mark} alt="" className="auth-logo" />
          <div>
            <strong>SD and Rent Maintenance</strong>
            <span>by IndiQube</span>
          </div>
        </header>

        <div className="auth-brand-copy">
          <p className="auth-eyebrow">Security Deposit &amp; Lease Management</p>
          <h1>Every deposit, lease and balance in one controlled place.</h1>
          <p>
            Track SD payments, transfers, adjustments and refunds against every lease,
            with automatic balances, reminders and a complete audit trail.
          </p>
        </div>

        <div className="auth-scene">
          <Scene3D />
          <div className="float-card float-card-1">
            <span className="float-dot dot-blue" />
            <div><strong>Balances tracked</strong><small>SD Balance &amp; Repayable, live</small></div>
          </div>
          <div className="float-card float-card-2">
            <span className="float-dot dot-amber" />
            <div><strong>15-day reminders</strong><small>Lease &amp; rent dates</small></div>
          </div>
          <div className="float-card float-card-3">
            <span className="float-dot dot-green" />
            <div><strong>Audit-ready</strong><small>Every change recorded</small></div>
          </div>
        </div>

        <footer className="auth-brand-foot">
          <span>&copy; {year} IndiQube · SD and Rent Maintenance Application</span>
          <span>Authorised users only</span>
        </footer>
      </section>

      <main className="auth-panel">
        <div className="auth-panel-inner">
          <img src={logo} alt="IndiQube - Grow your business" className="auth-card-logo" />
          {children}
          <p className="auth-secure">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1 14-4-4 1.4-1.4L11 13.2l4.6-4.6L17 10l-6 6Z" />
            </svg>
            Secure access · Sessions end after 30 minutes of inactivity
          </p>
        </div>
      </main>
    </div>
  );
}
