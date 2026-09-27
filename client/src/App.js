import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { SCREENS } from './config/screens';

import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import UserMaster from './pages/UserMaster';
import CostCenterMaster from './pages/CostCenterMaster';
import UserRightsMaster from './pages/UserRightsMaster';
import ChangePassword from './pages/ChangePassword';
import Profile from './pages/Profile';
import LocationMaster from './pages/LocationMaster';
import SdMaster from './pages/SdMaster';
import SdTransactions from './pages/SdTransactions';
import SdBalanceReport from './pages/SdBalanceReport';
import EmailLog from './pages/EmailLog';
import AuditLog from './pages/AuditLog';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />

          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute screen={SCREENS.USER}><UserMaster /></ProtectedRoute>} />
          <Route path="/cost-centers" element={<ProtectedRoute screen={SCREENS.COST_CENTER}><CostCenterMaster /></ProtectedRoute>} />
          <Route path="/locations" element={<ProtectedRoute screen={SCREENS.LOCATION}><LocationMaster /></ProtectedRoute>} />
          <Route path="/sd-master" element={<ProtectedRoute screen={SCREENS.SD_MASTER}><SdMaster /></ProtectedRoute>} />
          <Route path="/sd-transactions" element={<ProtectedRoute screen={SCREENS.SD_TRANSACTION}><SdTransactions /></ProtectedRoute>} />
          <Route path="/reports/sd-balance" element={<ProtectedRoute screen={SCREENS.SD_REPORT}><SdBalanceReport /></ProtectedRoute>} />
          <Route path="/email-log" element={<ProtectedRoute screen={SCREENS.EMAIL_LOG}><EmailLog /></ProtectedRoute>} />
          <Route path="/audit-log" element={<ProtectedRoute screen={SCREENS.AUDIT_LOG}><AuditLog /></ProtectedRoute>} />
          <Route path="/user-rights" element={<ProtectedRoute screen={SCREENS.USER_RIGHTS}><UserRightsMaster /></ProtectedRoute>} />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
