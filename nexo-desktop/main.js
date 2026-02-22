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
let currentZoomFactor = 1.0;
let dbCache = null;
let dbCacheLoadedAt = 0;

function getDbPath() {
  return path.join(app.getPath('userData'), 'nexo-db.json');
}

async function readDb({ force = false } = {}) {
  if (!force && dbCache) return JSON.parse(JSON.stringify(dbCache));
  const dbPath = getDbPath();
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    dbCache = {
      ...DEFAULT_DB,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      backups: parsed?.backups && typeof parsed.backups === 'object' ? parsed.backups : {},
      extraStorage: parsed?.extraStorage && typeof parsed.extraStorage === 'object' ? parsed.extraStorage : {}
    };
    dbCacheLoadedAt = Date.now();
    return JSON.parse(JSON.stringify(dbCache));
  } catch (error) {
    if (error.code === 'ENOENT') {
      dbCache = { ...DEFAULT_DB };
      dbCacheLoadedAt = Date.now();
      return JSON.parse(JSON.stringify(dbCache));
    }
    throw error;
  }
}

function setDbCache(data) {
  dbCache = {
    ...DEFAULT_DB,
    ...(data && typeof data === 'object' ? data : {}),
    backups: data?.backups && typeof data.backups === 'object' ? data.backups : {},
    extraStorage: data?.extraStorage && typeof data.extraStorage === 'object' ? data.extraStorage : {}
  };
  dbCacheLoadedAt = Date.now();
}

async function writeDb(data) {
  const dbPath = getDbPath();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const tmpPath = `${dbPath}.tmp`;
  const normalized = { ...DEFAULT_DB, ...data };
  setDbCache(normalized);
  const payload = JSON.stringify(normalized, null, 2);
  await fs.writeFile(tmpPath, payload, 'utf8');
  await fs.rename(tmpPath, dbPath);
}

let writeQueue = Promise.resolve();
function queueWrite(data) {
  const started = Date.now();
  writeQueue = writeQueue.then(async () => {
    await writeDb(data);
    perfLog('store', 'write ok', { ms: Date.now() - started });
  }).catch((error) => {
    perfLog('store', 'write error', { ms: Date.now() - started, message: error?.message || String(error) });
    throw error;
  });
  return writeQueue;
}

function sendUpdaterStatus(status, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updater:status', { status, ...payload });
}

function perfLog(scope, message, extra = {}) {
  try { console.log(`[nexo:${scope}] ${message}`, extra); } catch (_) {}
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

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


function clampZoom(value) {
  return Math.min(3, Math.max(0.5, value));
}

function applyZoomDelta(delta) {
  if (!mainWindow || mainWindow.isDestroyed()) return currentZoomFactor;
  currentZoomFactor = clampZoom((mainWindow.webContents.getZoomFactor?.() || currentZoomFactor) + delta);
  mainWindow.webContents.setZoomFactor(currentZoomFactor);
  return currentZoomFactor;
}

function applyZoomReset() {
  if (!mainWindow || mainWindow.isDestroyed()) return 1;
  currentZoomFactor = 1;
  mainWindow.webContents.setZoomFactor(1);
  return currentZoomFactor;
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

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!input.control) return;
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    if (['+', '=', 'plus', 'numadd'].includes(key)) {
      event.preventDefault();
      applyZoomDelta(0.1);
      return;
    }
    if (['-', '_', 'minus', 'numsub'].includes(key)) {
      event.preventDefault();
      applyZoomDelta(-0.1);
      return;
    }
    if (key === '0' || key === 'num0') {
      event.preventDefault();
      applyZoomReset();
    }
  });

  mainWindow.webContents.on('zoom-changed', (_event, zoomDirection) => {
    if (zoomDirection === 'in') applyZoomDelta(0.1);
    else if (zoomDirection === 'out') applyZoomDelta(-0.1);
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'nexo.html'));
}

ipcMain.handle('store:getAll', async () => readDb());
ipcMain.handle('store:getCacheMeta', async () => ({ cached: !!dbCache, loadedAt: dbCacheLoadedAt || null }));
ipcMain.handle('store:setAll', async (_event, data) => {
  const started = Date.now();
  try {
    perfLog('store:setAll', 'start');
    await queueWrite(data && typeof data === 'object' ? data : {});
    const db = await readDb();
    perfLog('store:setAll', 'done', { ms: Date.now() - started });
    return db;
  } catch (error) {
    perfLog('store:setAll', 'error', { ms: Date.now() - started, message: error?.message || String(error) });
    throw new Error(`store:setAll failed: ${error?.message || String(error)}`);
  }
});
ipcMain.handle('store:patch', async (_event, partial) => {
  const started = Date.now();
  try {
    perfLog('store:patch', 'start');
    const current = await readDb();
    const next = { ...current, ...(partial && typeof partial === 'object' ? partial : {}) };
    await queueWrite(next);
    const db = await readDb();
    perfLog('store:patch', 'done', { ms: Date.now() - started });
    return db;
  } catch (error) {
    perfLog('store:patch', 'error', { ms: Date.now() - started, message: error?.message || String(error) });
    throw new Error(`store:patch failed: ${error?.message || String(error)}`);
  }
});
ipcMain.handle('store:importContactsChunk', async (_event, payload) => {
  const started = Date.now();
  try {
    const chunk = Array.isArray(payload?.chunk) ? payload.chunk : [];
    const reset = !!payload?.reset;
    perfLog('store:importChunk', 'start', { reset, size: chunk.length });
    const current = await readDb();
    const prev = Array.isArray(current.contactsData) ? current.contactsData : [];
    current.contactsData = reset ? chunk : prev.concat(chunk);
    await queueWrite(current);
    perfLog('store:importChunk', 'done', { ms: Date.now() - started, total: current.contactsData.length });
    return { ok: true, total: current.contactsData.length };
  } catch (error) {
    perfLog('store:importChunk', 'error', { ms: Date.now() - started, message: error?.message || String(error) });
    throw new Error(`store:importContactsChunk failed: ${error?.message || String(error)}`);
  }
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
ipcMain.handle('app:getVersion', async () => app.getVersion());
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
ipcMain.handle('zoom:in', async () => ({ zoomFactor: applyZoomDelta(0.1) }));
ipcMain.handle('zoom:out', async () => ({ zoomFactor: applyZoomDelta(-0.1) }));
ipcMain.handle('zoom:reset', async () => ({ zoomFactor: applyZoomReset() }));
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
  try { await readDb(); } catch (error) { console.warn('No se pudo precalentar cache local:', error?.message || error); }
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
