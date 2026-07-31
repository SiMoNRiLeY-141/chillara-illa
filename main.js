const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const FIREBASE_WEB_CONFIG_FIELDS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
  'measurementId'
];

function getFirebaseWebConfig(configPath) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (typeof config.apiKey !== 'string' || typeof config.projectId !== 'string') return null;

    return Object.fromEntries(
      FIREBASE_WEB_CONFIG_FIELDS
        .filter((field) => typeof config[field] === 'string')
        .map((field) => [field, config[field]])
    );
  } catch {
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'public', 'logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const indexPath = path.join(__dirname, 'public', 'index.html');
  mainWindow.loadFile(indexPath);
}

ipcMain.handle('get-firebase-config', () => {
  const paths = [
    path.join(app.getPath('userData'), 'firebase-config.json'),
    path.join(process.cwd(), 'firebase-config.json'),
    path.join(__dirname, 'firebase-config.json')
  ];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    const config = getFirebaseWebConfig(p);
    if (config) return config;
  }
  return null;
});


app.whenReady().then(() => {
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
