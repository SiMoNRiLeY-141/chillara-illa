const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getFirebaseConfig: () => ipcRenderer.invoke('get-firebase-config')
});
