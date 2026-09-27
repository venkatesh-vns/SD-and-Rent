import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MENU } from '../config/screens';

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
      <div className="navbar-brand">SD Maintenance Application</div>
      <div className="navbar-links">
        <NavLink to="/dashboard">Dashboard</NavLink>
        {groups.map((g) => (
          <div className="nav-menu" key={g.group}>
            <button type="button" className="nav-menu-title">{g.group} ▾</button>
            <div className="nav-menu-items">
              {g.items.map((i) => <NavLink key={i.path} to={i.path}>{i.label}</NavLink>)}
            </div>
          </div>
        ))}
        <div className="nav-menu">
          <button type="button" className="nav-menu-title">Administration ▾</button>
          <div className="nav-menu-items">
            {adminItems.map((i) => <NavLink key={i.path} to={i.path}>{i.label}</NavLink>)}
            {adminItems.length > 0 && <hr />}
            <NavLink to="/profile">User Profile</NavLink>
            <NavLink to="/change-password">Change Password</NavLink>
            <button type="button" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </div>
      <div className="navbar-user">
        <span>{user?.userName}</span>
        <button onClick={handleLogout} className="btn btn-secondary">Logout</button>
      </div>
    </nav>
  );
}
