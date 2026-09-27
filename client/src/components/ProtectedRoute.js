import React from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from './Navbar';

// Wraps any page that requires the user to be logged in. With `screen`,
// the user also needs View rights on that screen.
export default function ProtectedRoute({ children, screen }) {
  const { user, loading, can } = useAuth();

  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  if (screen && !can(screen, 'view')) {
    return (
      <div>
        <Navbar />
        <div className="page-container">
          <h1>Access denied</h1>
          <p>You do not have permission to open this screen. Ask your administrator to grant access in the User Rights Master.</p>
          <Link to="/dashboard" className="btn btn-secondary">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  return children;
}
