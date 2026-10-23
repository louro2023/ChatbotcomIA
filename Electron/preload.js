const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTelegramState: () => ipcRenderer.invoke('telegram:state'),
  connectTelegram: () => ipcRenderer.invoke('telegram:connect'),
  submitTelegramPassword: password => ipcRenderer.invoke('telegram:password', password),
  logoutTelegram: () => ipcRenderer.invoke('telegram:logout'),
  onTelegramStatus: callback => ipcRenderer.on('telegram:status', (_event, data) => callback(data)),
  listTelegramGroups: () => ipcRenderer.invoke('telegram:groups:list'),
  updateTelegramGroup: payload => ipcRenderer.invoke('telegram:groups:update', payload),
  getTelegramGroupRuntime: () => ipcRenderer.invoke('telegram:groups:runtime'),
  getGroupRuntimeStatus: () => ipcRenderer.invoke('groups:runtime-status'),
  onWaQr: (callback) => {
    ipcRenderer.on('wa-qr', (_event, qrUrl) => callback(qrUrl));
  },
  onWaStatus: (callback) => {
    ipcRenderer.on('wa-status', (_event, data) => callback(data));
  },
  logoutAndQuit: () => ipcRenderer.invoke('app:logout-and-quit'),
  getGroupPhoto: payload => ipcRenderer.invoke('groups:photo', payload),
  listGroups: () => ipcRenderer.invoke('groups:list'),
  updateGroup: payload => ipcRenderer.invoke('groups:update', payload),
  readConfig: () => ipcRenderer.invoke('config:read'),
  writeConfig: (config) => ipcRenderer.invoke('config:write', config),
  testGeminiApiKey: (apiKey) => ipcRenderer.invoke('gemini:test-api-key', apiKey),
  getGeminiUsage: () => ipcRenderer.invoke('gemini:get-usage'),
  getMetrics: () => ipcRenderer.invoke('metrics:get'),
  reconnectWhatsApp: () => ipcRenderer.invoke('whatsapp:reconnect'),
  selectWhatsAppAccountType: (accountType) => ipcRenderer.invoke('whatsapp:select-account-type', accountType),
  resetWhatsApp: () => ipcRenderer.invoke('whatsapp:reset'),
  selectBulkImage: () => ipcRenderer.invoke('bulk:select-image'),
  importBulkContacts: () => ipcRenderer.invoke('bulk:import-contacts'),
  importWhatsAppContacts: () => ipcRenderer.invoke('bulk:import-whatsapp-contacts'),
  onBulkImportProgress: (callback) => {
    ipcRenderer.on('bulk:import-progress', (_event, data) => callback(data));
  },
  startBulkSend: (payload) => ipcRenderer.invoke('bulk:start', payload),
  cancelBulkSend: () => ipcRenderer.invoke('bulk:cancel'),
  getBulkSafetyStatus: () => ipcRenderer.invoke('bulk:safety-status'),
  unlockBulkSafety: () => ipcRenderer.invoke('bulk:safety-unlock'),
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
