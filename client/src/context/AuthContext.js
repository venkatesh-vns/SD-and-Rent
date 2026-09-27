import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

// Logs the user out after this many minutes without mouse/keyboard activity
const IDLE_MINUTES = Number(process.env.REACT_APP_IDLE_MINUTES) || 30;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];

const ACTION_FLAGS = {
  view: 'canView',
  add: 'canAdd',
  edit: 'canEdit',
  delete: 'canDelete',
  upload: 'canUpload',
};

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(true);

  const saveUser = (u) => {
    localStorage.setItem('user', JSON.stringify(u));
    setUser(u);
  };

  // Re-reads the current user and rights (e.g. after rights change)
  const refresh = useCallback(async () => {
    const res = await api.get('/auth/me');
    saveUser(res.data.user);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setLoading(false);
      return;
    }
    refresh()
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const login = async (userName, password) => {
    const res = await api.post('/auth/login', { userName, password });
    localStorage.setItem('token', res.data.token);
    saveUser(res.data.user);
    return res.data;
  };

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      // Session may already be gone; clear the local copy regardless
    }
    clearSession();
    setUser(null);
  }, []);

  // Keeps this session alive after a password change (other sessions end)
  const replaceToken = (token) => localStorage.setItem('token', token);

  // can('COST_CENTER', 'edit')
  const can = useCallback(
    (screenCode, action = 'view') => {
      if (!user) return false;
      if (user.isAdmin) return true;
      const right = user.rights?.find((r) => r.screenCode === screenCode);
      return Boolean(right && right[ACTION_FLAGS[action]]);
    },
    [user]
  );

  // Idle timeout
  useEffect(() => {
    if (!user) return undefined;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await logout();
        window.location.href = '/login?idle=1';
      }, IDLE_MINUTES * 60 * 1000);
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{ user, login, logout, refresh, replaceToken, can, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
