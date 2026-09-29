import React from 'react';

// Line icons for each screen (24x24, stroke = currentColor)
const PATHS = {
  COST_CENTER: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6M8 11h.01M12 11h.01M16 11h.01',
  USER: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  LOCATION: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  USER_RIGHTS: 'M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Zm-3 9 2 2 4-4',
  SD_MASTER: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6M10 17h6',
  SD_TRANSACTION: 'M4 8h13l-3-3M20 16H7l3 3',
  SD_REPORT: 'M4 20h16M7 16v-5M12 16V7M17 16v-8',
  EMAIL_LOG: 'M4 6h16v12H4V6Zm0 1 8 6 8-6',
  AUDIT_LOG: 'M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v4h-4',
  NOTIFICATION: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4a2 2 0 0 0 4 0',
};

export default function ScreenIcon({ screen, size = 22 }) {
  const d = PATHS[screen];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
