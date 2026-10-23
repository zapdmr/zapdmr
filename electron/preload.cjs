const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ZapDMRDesktop', {
  configure: (options) => ipcRenderer.invoke('zapdmr-operation', options),
  openExternal: (url) => ipcRenderer.invoke('zapdmr-external',url),
  saveAttachment: (file) => ipcRenderer.invoke('zapdmr-save-attachment',file),
  updateStatus: () => ipcRenderer.invoke('zapdmr-update','status'),
  checkUpdates: () => ipcRenderer.invoke('zapdmr-update','check'),
  installUpdate: () => ipcRenderer.invoke('zapdmr-update','install'),
  onUpdate: (callback) => {const listener=(_event,value)=>callback(value);ipcRenderer.on('zapdmr-update-state',listener);return ()=>ipcRenderer.removeListener('zapdmr-update-state',listener);},
  onPtt: (callback) => { ipcRenderer.on('zapdmr-ptt-key', () => callback()); },
  onScan: (callback) => { ipcRenderer.on('zapdmr-scan-key', () => callback()); }
});
