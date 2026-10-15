// electron-builder settings for the UAT installer:  npm run dist:uat
// Same app as production, built as "SD and Rent UAT" (see lib/channel.js).
const base = require('../package.json').build;

const UAT_VERSION = process.env.UAT_VERSION || '2.0.0-uat.1';

module.exports = {
  ...base,
  appId: 'com.indiqube.sdrent.uat',
  productName: 'SD and Rent UAT',
  extraMetadata: { sdmChannel: 'uat', version: UAT_VERSION, productName: 'SD and Rent UAT' },
  win: { ...base.win, artifactName: 'SD-and-Rent-UAT-Setup-${version}.${ext}' },
  nsis: { ...base.nsis, shortcutName: 'SD and Rent UAT' },
};
