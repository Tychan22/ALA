const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alaUpdater', {
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', () => cb()),
  onUpdateReady:     (cb) => ipcRenderer.on('update-ready',     () => cb()),
  installUpdate:     ()   => ipcRenderer.send('install-update'),
});
