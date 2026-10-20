const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ZapDMRDesktop', {
  configure: (options) => ipcRenderer.invoke('zapdmr-operation', options),
  openExternal: (url) => ipcRenderer.invoke('zapdmr-external',url),
  saveAttachment: (file) => ipcRenderer.invoke('zapdmr-save-attachment',file),
  onPtt: (callback) => { ipcRenderer.on('zapdmr-ptt-key', () => callback()); },
  onScan: (callback) => { ipcRenderer.on('zapdmr-scan-key', () => callback()); }
});
