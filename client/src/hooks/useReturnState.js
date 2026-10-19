import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

const storageKey = (key) => `screen-state:${key}`;
const read = (key) => {
  try { return JSON.parse(sessionStorage.getItem(storageKey(key))) || {}; } catch { return {}; }
};
const write = (key, data) => {
  try { sessionStorage.setItem(storageKey(key), JSON.stringify({ ...read(key), ...data })); } catch { /* storage unavailable */ }
};

// Screens that open SD Transaction with a "Back to ..." button (?from=<key>)
export const RETURN_SCREENS = {
  'sd-master': { label: 'SD Master', path: '/sd-master' },
  'sd-balance': { label: 'SD Balance Report', path: '/reports/sd-balance' },
  'sd-dashboard': { label: 'SD Dashboard', path: '/sd-dashboard' },
};

/**
 * Lets a list screen come back as the user left it (filters, page, scroll)
 * when they return with a "Back to ..." button (navigation state { restore: true }).
 *   saved   - the remembered state on such a return, else null
 *   save    - remember data (called whenever filters / page change)
 *   leave   - remember the scroll position just before opening another screen
 * Pass `ready` = true once the rows are shown, so the scroll position can be restored.
 */
export default function useReturnState(key, ready) {
  const location = useLocation();
  const [saved] = useState(() => (location.state?.restore ? read(key) : null));
  const scrolled = useRef(false);

  const save = useCallback((data) => write(key, data), [key]);
  const leave = useCallback(() => write(key, { scrollY: window.scrollY }), [key]);

  useEffect(() => {
    if (!ready || scrolled.current || !saved?.scrollY) return;
    scrolled.current = true;
    requestAnimationFrame(() => window.scrollTo(0, saved.scrollY));
  }, [ready, saved]);

  return useMemo(() => ({ saved, save, leave }), [saved, save, leave]);
}
