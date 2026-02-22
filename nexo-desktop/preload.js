const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexoStore', {
  getAll: () => ipcRenderer.invoke('store:getAll'),
  setAll: (data) => ipcRenderer.invoke('store:setAll', data),
  patch: (partial) => ipcRenderer.invoke('store:patch', partial),
  backupNow: () => ipcRenderer.invoke('store:backupNow'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  exportBackup: () => ipcRenderer.invoke('app:exportBackup'),
  importContactsChunk: (payload) => ipcRenderer.invoke('store:importContactsChunk', payload)
});

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  installUpdateAssisted: () => ipcRenderer.invoke('updater:installAssisted'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  zoomIn: () => ipcRenderer.invoke('zoom:in'),
  zoomOut: () => ipcRenderer.invoke('zoom:out'),
  zoomReset: () => ipcRenderer.invoke('zoom:reset'),
  onUpdaterStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  }
});
