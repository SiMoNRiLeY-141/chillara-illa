const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getFirebaseConfig: () => ipcRenderer.invoke('get-firebase-config'),
  getLocalApiCredentials: () => ipcRenderer.invoke('get-local-api-credentials')
});
