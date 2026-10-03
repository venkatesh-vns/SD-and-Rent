// Bridge for the app's own setup / error pages (file://). The main process
// refuses these calls from any other page, including the SD Maintenance screens.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sdm', {
  info: () => ipcRenderer.invoke('sdm:info'),
  testServer: (address) => ipcRenderer.invoke('sdm:test-server', address),
  setupClient: (address) => ipcRenderer.invoke('sdm:setup-client', address),
  setupServer: (admin) => ipcRenderer.invoke('sdm:setup-server', admin),
  retry: () => ipcRenderer.invoke('sdm:retry'),
  settings: () => ipcRenderer.invoke('sdm:settings'),
  openLogs: () => ipcRenderer.invoke('sdm:open-logs'),
});
