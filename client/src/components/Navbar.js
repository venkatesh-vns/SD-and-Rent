import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MENU } from '../config/screens';
import ScreenIcon from './ScreenIcon';
import mark from '../assets/indiqube-mark.png';

const Chevron = () => (
  <svg className="chevron" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

// "finance.user" -> "FU", "admin" -> "AD"
function initials(name = '') {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

export default function Navbar() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const visible = MENU.map((g) => ({ ...g, items: g.items.filter((i) => can(i.screen, 'view')) }));
  const groups = visible.filter((g) => g.group !== 'Administration' && g.items.length > 0);
  const adminItems = visible.find((g) => g.group === 'Administration')?.items || [];

  return (
    <nav className="navbar">
      <div className="navbar-brand" title="Security Deposit & Rent Management">
        <img src={mark} alt="IndiQube" className="navbar-logo" />
        {/* Two short lines, so the menu and Logout fit on one row */}
        <span className="navbar-name"><span>Security Deposit &amp;</span><span>Rent Management</span></span>
      </div>
      <div className="navbar-links">
        <NavLink to="/dashboard" className="nav-link">Dashboard</NavLink>
        {groups.map((g) => (
          <div className="nav-menu" key={g.group}>
            <button type="button" className="nav-menu-title">{g.group}<Chevron /></button>
            <div className="nav-menu-items">
              {g.items.map((i) => (
                <NavLink key={i.path} to={i.path}><ScreenIcon screen={i.screen} size={18} />{i.label}</NavLink>
              ))}
            </div>
          </div>
        ))}
        <div className="nav-menu">
          <button type="button" className="nav-menu-title">Administration<Chevron /></button>
          <div className="nav-menu-items">
            {adminItems.map((i) => (
              <NavLink key={i.path} to={i.path}><ScreenIcon screen={i.screen} size={18} />{i.label}</NavLink>
            ))}
            {user?.isAdmin && <NavLink to="/system-health"><ScreenIcon screen="SD_DASHBOARD" size={18} />System Health</NavLink>}
            {(adminItems.length > 0 || user?.isAdmin) && <hr />}
            <NavLink to="/profile"><ScreenIcon screen="USER" size={18} />User Profile</NavLink>
            <NavLink to="/change-password"><ScreenIcon screen="USER_RIGHTS" size={18} />Change Password</NavLink>
            <button type="button" onClick={handleLogout}><ScreenIcon screen="SD_TRANSACTION" size={18} />Logout</button>
          </div>
        </div>
      </div>
      <div className="navbar-user">
        <span className="user-chip" title={user?.userEmail}>
          <span className="avatar">{initials(user?.userName)}</span>
          <span className="user-name">{user?.userName}</span>
        </span>
        <button onClick={handleLogout} className="btn btn-nav">Logout</button>
      </div>
    </nav>
  );
}
