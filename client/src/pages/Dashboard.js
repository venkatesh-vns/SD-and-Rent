import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ScreenIcon from '../components/ScreenIcon';
import { useAuth } from '../context/AuthContext';
import { MENU } from '../config/screens';

function greeting(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const now = new Date();
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const groups = MENU
    .map((g) => ({ ...g, items: g.items.filter((i) => can(i.screen, 'view')) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <Navbar />
      <div className="page-container">
        <section className="welcome-hero">
          <div>
            <p className="eyebrow">{today}</p>
            <h1>{greeting(now.getHours())}, {user?.userName}</h1>
            <p className="welcome-sub">
              {user?.isAdmin ? 'Administrator' : 'User'} · SD and Rent Maintenance Application
            </p>
          </div>
          <div className="welcome-mark" aria-hidden="true">
            <ScreenIcon screen="SD_REPORT" size={40} />
          </div>
        </section>

        {groups.length === 0 ? (
          <div className="alert alert-info">
            You have not been given access to any screen yet. Contact your administrator to assign User Rights.
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.group} className="dash-group">
              <h2 className="section-title">{g.group}</h2>
              <div className="dashboard-grid">
                {g.items.map((c) => (
                  <Link key={c.path} to={c.path} className="dashboard-card">
                    <span className="dash-icon"><ScreenIcon screen={c.screen} /></span>
                    <span className="dash-text">
                      <h3>{c.label}</h3>
                      <p>{c.description}</p>
                    </span>
                    <span className="dash-arrow" aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
