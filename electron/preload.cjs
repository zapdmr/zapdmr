const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ZapDMRDesktop', {
  configure: (options) => ipcRenderer.invoke('zapdmr-operation', options),
  openExternal: (url) => ipcRenderer.invoke('zapdmr-external',url),
  onPtt: (callback) => { ipcRenderer.on('zapdmr-ptt-key', () => callback()); },
  onScan: (callback) => { ipcRenderer.on('zapdmr-scan-key', () => callback()); }
});
