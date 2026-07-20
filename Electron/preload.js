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
  },
  testEmailConnection: (payload) => ipcRenderer.invoke('email:test-connection', payload),
  selectEmailAttachments: () => ipcRenderer.invoke('email:select-attachments'),
  importEmailContacts: () => ipcRenderer.invoke('email:import-contacts'),
  startEmailSend: (payload) => ipcRenderer.invoke('email:start', payload),
  cancelEmailSend: () => ipcRenderer.invoke('email:cancel'),
  onEmailProgress: (callback) => {
    ipcRenderer.on('email:progress', (_event, data) => callback(data));
  },
  openInstagramLogin: () => ipcRenderer.invoke('instagram:open-login'),
  checkInstagramSession: () => ipcRenderer.invoke('instagram:check-session'),
  startInstagramMonitor: (payload) => ipcRenderer.invoke('instagram:start', payload),
  stopInstagramMonitor: () => ipcRenderer.invoke('instagram:stop'),
  processVisibleInstagramComments: () => ipcRenderer.invoke('instagram:process-visible'),
  getInstagramStatus: () => ipcRenderer.invoke('instagram:get-status'),
  onInstagramStatus: (callback) => {
    ipcRenderer.on('instagram:status', (_event, data) => callback(data));
  },
  onInstagramLog: (callback) => {
    ipcRenderer.on('instagram:log', (_event, data) => callback(data));
  }
});
