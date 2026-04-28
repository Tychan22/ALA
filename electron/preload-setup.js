'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alaSetup', {
  getVersion:  ()     => ipcRenderer.invoke('get-version'),
  validateKey: (key)  => ipcRenderer.invoke('validate-license', key),
  saveSetup:   (data) => ipcRenderer.invoke('save-setup', data),
  onMode:      (cb)   => ipcRenderer.on('set-mode',      (_e, mode) => cb(mode)),
  onStatus:    (cb)   => ipcRenderer.on('setup-status',  (_e, msg)  => cb(msg)),
  quit:        ()     => ipcRenderer.send('quit-app'),
});
