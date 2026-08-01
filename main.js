const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { startLocalServer } = require('./server');

let mainWindow;
let localServer;
const localSecret = crypto.randomBytes(32).toString('hex');
const FIREBASE_WEB_CONFIG_FIELDS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];

function getFirebaseWebConfig() {
  const paths = [path.join(app.getPath('userData'), 'firebase-config.json'), path.join(process.cwd(), 'firebase-config.json'), path.join(__dirname, 'firebase-config.json')];
  for (const configPath of paths) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (typeof config.apiKey !== 'string' || typeof config.projectId !== 'string') continue;
      return Object.fromEntries(FIREBASE_WEB_CONFIG_FIELDS.filter((field) => typeof config[field] === 'string').map((field) => [field, config[field]]));
    } catch { /* Try the next permitted local config location. */ }
  }
  return null;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'public', 'logo.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const localOrigin = `http://127.0.0.1:${port}`;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(localOrigin)) event.preventDefault(); });
  mainWindow.loadURL(localOrigin);
}

ipcMain.handle('get-firebase-config', () => getFirebaseWebConfig());
ipcMain.handle('get-local-api-credentials', () => ({ secret: localSecret, origin: `http://127.0.0.1:${localServer.port}` }));

app.whenReady().then(async () => {
  localServer = await startLocalServer({
    dbFile: path.join(app.getPath('userData'), 'invoices.db'),
    clientSecret: localSecret,
    publicDir: path.join(__dirname, 'public'),
    firebaseConfigProvider: getFirebaseWebConfig
  });
  createWindow(localServer.port);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(localServer.port); });
}).catch((error) => { console.error('Unable to start Chillara Illa:', error); app.quit(); });

app.on('before-quit', () => { if (localServer) localServer.server.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
