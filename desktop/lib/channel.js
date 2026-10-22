// Production or UAT build of the desktop app. The UAT installer (npm run dist:uat)
// sets "sdmChannel": "uat" in the packaged package.json; it then installs and runs
// side by side with the production app: own name, data folder (AppData\<name>),
// ports and firewall rule, and emails in dry-run mode (logged, never sent).
const pkg = require('../package.json');

const UAT = pkg.sdmChannel === 'uat';

module.exports = {
  UAT,
  APP_NAME: UAT ? 'SD and Rent UAT' : 'Security Deposit & Rent Management', // shown in windows and dialogs
  HTTP_PORT: UAT ? 5250 : 5050,
  PG_PORT: UAT ? 5545 : 5544,
  EMAIL_DRY_RUN: UAT,
};
