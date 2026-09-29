// Screen codes - must match the `screens` table on the server
export const SCREENS = {
  COST_CENTER: 'COST_CENTER',
  USER: 'USER',
  USER_RIGHTS: 'USER_RIGHTS',
  LOCATION: 'LOCATION',
  SD_MASTER: 'SD_MASTER',
  SD_TRANSACTION: 'SD_TRANSACTION',
  SD_REPORT: 'SD_REPORT',
  EMAIL_LOG: 'EMAIL_LOG',
  AUDIT_LOG: 'AUDIT_LOG',
  NOTIFICATION: 'NOTIFICATION',
};

// Screens that are built, in menu order. Add an entry here as each module
// ships; the menu and dashboard only show screens the user can View.
// The Administration group is merged into the fixed Administration menu
// (profile, change password, logout).
export const MENU = [
  {
    group: 'Masters',
    items: [
      { screen: SCREENS.COST_CENTER, label: 'Cost Center Master', path: '/cost-centers', description: 'Cost centers used across SD records.' },
      { screen: SCREENS.USER, label: 'User Master', path: '/users', description: 'Application users, status and passwords.' },
      { screen: SCREENS.LOCATION, label: 'Location Master', path: '/locations', description: 'Three-level location hierarchy (Level 1 > Level 2 > Level 3).' },
      { screen: SCREENS.NOTIFICATION, label: 'Email Notification Master', path: '/email-templates', description: 'Email templates, recipients and reminder days for SD notifications.' },
      { screen: SCREENS.SD_MASTER, label: 'SD Master', path: '/sd-master', description: 'Lease and Security Deposit master records, one per SD Code.' },
      { screen: SCREENS.USER_RIGHTS, label: 'User Rights Master', path: '/user-rights', description: 'Who can view, add, edit, delete and upload on each screen.' },
    ],
  },
  {
    group: 'Transactions',
    items: [
      { screen: SCREENS.SD_TRANSACTION, label: 'SD Transaction', path: '/sd-transactions', description: 'SD Paid, Transfer, Adjustment and Refund per SD Code, with balances.' },
    ],
  },
  {
    group: 'Reports',
    items: [
      { screen: SCREENS.SD_REPORT, label: 'SD Balance Report', path: '/reports/sd-balance', description: 'Balances and repayable amounts per SD Code, with totals and export.' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { screen: SCREENS.EMAIL_LOG, label: 'Email Log', path: '/email-log', description: 'Every notification and reminder email, with its status.' },
      { screen: SCREENS.AUDIT_LOG, label: 'Audit Log', path: '/audit-log', description: 'Who changed what, and when, across all screens.' },
    ],
  },
];
