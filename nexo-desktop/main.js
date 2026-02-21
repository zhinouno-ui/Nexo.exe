const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_DB = {
  contactsData: [],
  contactsHistory: [],
  whatsappTemplate: 'Hola {usuario}, ¿cómo estás? Te escribo por la propuesta que vimos.',
  duplicateMergeMode: 'phone-auto',
  lastExportAt: null,
  backups: {},
  extraStorage: {}
};

let mainWindow = null;

function getDbPath() {
  return path.join(app.getPath('userData'), 'nexo-db.json');
}

async function readDb() {
  const dbPath = getDbPath();
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_DB,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      backups: parsed?.backups && typeof parsed.backups === 'object' ? parsed.backups : {},
      extraStorage: parsed?.extraStorage && typeof parsed.extraStorage === 'object' ? parsed.extraStorage : {}
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { ...DEFAULT_DB };
    throw error;
  }
}

async function writeDb(data) {
  const dbPath = getDbPath();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const tmpPath = `${dbPath}.tmp`;
  const payload = JSON.stringify({ ...DEFAULT_DB, ...data }, null, 2);
  await fs.writeFile(tmpPath, payload, 'utf8');
  await fs.rename(tmpPath, dbPath);
}

let writeQueue = Promise.resolve();
function queueWrite(data) {
  writeQueue = writeQueue.then(() => writeDb(data));
  return writeQueue;
}

function sendUpdaterStatus(status, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updater:status', { status, ...payload });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => sendUpdaterStatus('checking'));
  autoUpdater.on('update-available', (info) => {
    sendUpdaterStatus('available', {
      version: info?.version || '',
      message: 'Descargando actualización…'
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    sendUpdaterStatus('not-available', {
      version: info?.version || app.getVersion(),
      message: 'Estás en la última versión'
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendUpdaterStatus('download-progress', {
      percent: Math.round(progress?.percent || 0)
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdaterStatus('downloaded', {
      version: info?.version || '',
      message: 'Actualización lista. Reiniciar ahora'
    });
  });
  autoUpdater.on('error', (error) => {
    const readable = error?.message || String(error);
    sendUpdaterStatus('error', { message: `Error de actualización: ${readable}` });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/whatsapp\.com|wa\.me/i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (/whatsapp\.com|wa\.me/i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'nexo.html'));
}

ipcMain.handle('store:getAll', async () => readDb());
ipcMain.handle('store:setAll', async (_event, data) => {
  await queueWrite(data && typeof data === 'object' ? data : {});
  return readDb();
});
ipcMain.handle('store:patch', async (_event, partial) => {
  const current = await readDb();
  const next = { ...current, ...(partial && typeof partial === 'object' ? partial : {}) };
  await queueWrite(next);
  return readDb();
});
ipcMain.handle('store:backupNow', async () => {
  const current = await readDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `manual_${stamp}`;
  current.backups = { ...(current.backups || {}), [key]: current.contactsData || [] };
  await queueWrite(current);
  return key;
});
ipcMain.handle('app:openDataFolder', async () => shell.openPath(app.getPath('userData')));
ipcMain.handle('app:exportBackup', async () => {
  const target = await dialog.showSaveDialog({
    title: 'Exportar backup de Nexo',
    defaultPath: `nexo-db-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (target.canceled || !target.filePath) return { canceled: true };
  await fs.copyFile(getDbPath(), target.filePath);
  return { canceled: false, filePath: target.filePath };
});
ipcMain.handle('external:open', async (_event, url) => {
  if (!url || typeof url !== 'string') throw new Error('URL inválida');
  await shell.openExternal(url);
  return true;
});
ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) {
    sendUpdaterStatus('error', { message: 'Auto-update solo funciona en app instalada (NSIS), no en modo desarrollo.' });
    return { ok: false, message: 'Not packaged' };
  }
  try {
    await autoUpdater.checkForUpdatesAndNotify();
    return { ok: true };
  } catch (error) {
    const message = error?.message || String(error);
    sendUpdaterStatus('error', { message: `Error de actualización: ${message}` });
    return { ok: false, message };
  }
});
ipcMain.handle('updater:install', async () => {
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return { ok: true };
});

app.whenReady().then(async () => {
  createWindow();
  setupAutoUpdater();
  if (!app.isPackaged) {
    sendUpdaterStatus('not-available', { message: 'Modo desarrollo: auto-update desactivado.' });
  } else try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    sendUpdaterStatus('error', { message: `Error de actualización: ${error?.message || error}` });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
