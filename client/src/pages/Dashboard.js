import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { MENU } from '../config/screens';

export default function Dashboard() {
  const { user, can } = useAuth();
  const cards = MENU.flatMap((g) => g.items).filter((i) => can(i.screen, 'view'));

  return (
    <div>
      <Navbar />
      <div className="page-container">
        <h1>Welcome, {user?.userName}</h1>
        <p className="auth-subtitle">SD Maintenance Application - Main Dashboard</p>

        {cards.length === 0 ? (
          <div className="alert alert-info">
            You have not been given access to any screen yet. Contact your administrator to assign User Rights.
          </div>
        ) : (
          <div className="dashboard-grid">
            {cards.map((c) => (
              <Link key={c.path} to={c.path} className="dashboard-card">
                <h3>{c.label}</h3>
                <p>{c.description}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
