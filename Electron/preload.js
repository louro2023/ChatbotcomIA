const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onWaQr: (callback) => {
    ipcRenderer.on('wa-qr', (_event, qrUrl) => callback(qrUrl));
  },
  onWaStatus: (callback) => {
    ipcRenderer.on('wa-status', (_event, data) => callback(data));
  },
  logoutAndQuit: () => ipcRenderer.invoke('app:logout-and-quit'),
  readConfig: () => ipcRenderer.invoke('config:read'),
  writeConfig: (config) => ipcRenderer.invoke('config:write', config),
  testGeminiApiKey: (apiKey) => ipcRenderer.invoke('gemini:test-api-key', apiKey),
  getGeminiUsage: () => ipcRenderer.invoke('gemini:get-usage'),
  getMetrics: () => ipcRenderer.invoke('metrics:get'),
  reconnectWhatsApp: () => ipcRenderer.invoke('whatsapp:reconnect'),
  resetWhatsApp: () => ipcRenderer.invoke('whatsapp:reset'),
  selectBulkImage: () => ipcRenderer.invoke('bulk:select-image'),
  importBulkContacts: () => ipcRenderer.invoke('bulk:import-contacts'),
  importWhatsAppContacts: () => ipcRenderer.invoke('bulk:import-whatsapp-contacts'),
  startBulkSend: (payload) => ipcRenderer.invoke('bulk:start', payload),
  cancelBulkSend: () => ipcRenderer.invoke('bulk:cancel'),
  onBulkProgress: (callback) => {
    ipcRenderer.on('bulk:progress', (_event, data) => callback(data));
  }
});
