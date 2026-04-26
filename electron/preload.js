const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ala', {
  checkPassword: (pwd) => ipcRenderer.invoke('check-password', pwd),
  loginSuccess:  ()    => ipcRenderer.send('login-success'),
  quit:          ()    => ipcRenderer.send('quit-app'),
});
