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
  SD_DASHBOARD: 'M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 6h7v10h-7V10ZM4 13h7v7H4v-7Z',
  NOTIFICATION: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4a2 2 0 0 0 4 0',
  RENT_MASTER: 'M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3v-2h2v-2h2l1.6-1.6A4 4 0 0 1 15 7Zm1 3h.01',
  RENT_AGREEMENT: 'M7 3h10v18H7V3Zm3 5h4M10 12h4M10 16h2',
  RENT_RULE: 'M4 18 10 12l4 4 6-8M15 8h5v5',
  RENT_WAIVER: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 5.6l12.8 12.8',
  SD_RENT_REPORT: 'M4 20h16M6 16v-4M10 16V8M14 16v-6M18 16V5M5 9l4-3 4 2 6-4',
  RENT_SCHEDULE:'M4 6h16v14H4V6Zm0 4h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0M8 17h2M12 17h2',
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
