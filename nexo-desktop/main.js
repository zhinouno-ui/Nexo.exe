const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MIN_UPDATE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_UPDATE_SIZE_BYTES = 500 * 1024 * 1024;

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
let downloadedUpdateMeta = null;

function getDbPath() {
  return path.join(app.getPath('userData'), 'nexo-db.json');
}

function getErrorLogPath() {
  return path.join(app.getPath('userData'), 'nexo-error.log');
}

function getUpdateCacheDir() {
  return path.join(app.getPath('userData'), 'update-cache');
}

async function appendErrorLog(scope, error, extra = {}) {
  try {
    const err = normalizeError(error);
    const line = JSON.stringify({
      at: new Date().toISOString(),
      scope,
      message: err.message,
      name: err.name,
      stack: err.stack,
      code: err.code,
      ...extra
    });
    await fs.appendFile(getErrorLogPath(), `${line}\n`, 'utf8');
  } catch (_e) {
    // best effort log
  }
}

function normalizeError(error) {
  if (!error) return { name: 'Error', message: 'Error vacío', stack: '', code: '' };
  if (typeof error === 'string') return { name: 'Error', message: error, stack: '', code: '' };
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || '',
    code: error.code || ''
  };
}

function perfLog(scope, message, extra = {}) {
  try { console.log(`[nexo:${scope}] ${message}`, extra); } catch (_) {}
}

function sendUpdaterStatus(status, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updater:status', { status, ...payload });
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
    await appendErrorLog('readDb', error);
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
  }).catch(async (error) => {
    perfLog('store', 'write error', { ms: Date.now() - started, message: error?.message || String(error) });
    await appendErrorLog('queueWrite', error);
    throw error;
  });
  return writeQueue;
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

  mainWindow.webContents.on('render-process-gone', async (_event, details) => {
    await appendErrorLog('renderer-gone', new Error('Renderer process gone'), details || {});
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

function versionToParts(version) {
  return String(version || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
}

function compareVersions(a, b) {
  const ap = versionToParts(a);
  const bp = versionToParts(b);
  for (let i = 0; i < 3; i++) {
    if ((ap[i] || 0) > (bp[i] || 0)) return 1;
    if ((ap[i] || 0) < (bp[i] || 0)) return -1;
  }
  return 0;
}

function detectVersionFromName(filePath) {
  const base = path.basename(filePath || '');
  const match = base.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : '0.0.0';
}

async function cacheDownloadedInstaller(installerPath, version) {
  try {
    if (!installerPath) return null;
    const cacheDir = getUpdateCacheDir();
    await fs.mkdir(cacheDir, { recursive: true });
    const safeVersion = String(version || detectVersionFromName(installerPath) || 'unknown').replace(/[^\d.]/g, '') || 'unknown';
    const ext = path.extname(installerPath) || '.exe';
    const target = path.join(cacheDir, `Nexo-${safeVersion}-cached${ext}`);
    await fs.copyFile(installerPath, target);
    return target;
  } catch (error) {
    await appendErrorLog('cacheDownloadedInstaller', error, { installerPath, version });
    return null;
  }
}

async function resolveRollbackInstaller() {
  const cacheDir = getUpdateCacheDir();
  const currentVersion = app.getVersion();
  let files = [];
  try {
    files = await fs.readdir(cacheDir);
  } catch {
    return null;
  }
  const candidates = files
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .map((name) => {
      const fullPath = path.join(cacheDir, name);
      const version = detectVersionFromName(name);
      return { name, fullPath, version };
    })
    .filter((x) => compareVersions(x.version, currentVersion) < 0)
    .sort((a, b) => compareVersions(b.version, a.version));

  return candidates[0] || null;
}

async function startInstallerAndQuit(installerPath) {
  const child = spawn(installerPath, ['/S'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  setTimeout(() => app.quit(), 100);
}

async function handleUpdateDownloaded(info) {
  const downloadedFile = info?.downloadedFile || '';
  const version = info?.version || detectVersionFromName(downloadedFile) || '';
  let sizeBytes = 0;
  let suspicious = false;
  let suspicionReason = '';

  try {
    if (downloadedFile) {
      const stat = await fs.stat(downloadedFile);
      sizeBytes = stat.size || 0;
    }
  } catch (error) {
    suspicious = true;
    suspicionReason = `No se pudo verificar tamaño del instalador: ${error?.message || error}`;
    await appendErrorLog('update-downloaded-stat', error, { downloadedFile, version });
  }

  if (!suspicious) {
    if (sizeBytes < MIN_UPDATE_SIZE_BYTES) {
      suspicious = true;
      suspicionReason = `Instalador demasiado pequeño (${Math.round(sizeBytes / (1024 * 1024))}MB).`;
    }
    if (sizeBytes > MAX_UPDATE_SIZE_BYTES) {
      suspicious = true;
      suspicionReason = `Instalador demasiado grande (${Math.round(sizeBytes / (1024 * 1024))}MB).`;
    }
  }

  const cachedPath = await cacheDownloadedInstaller(downloadedFile, version);
  downloadedUpdateMeta = { version, downloadedFile, sizeBytes, suspicious, suspicionReason, cachedPath };

  if (suspicious) {
    sendUpdaterStatus('suspicious-update', {
      version,
      sizeBytes,
      message: `⚠️ Update sospechosa: ${suspicionReason}`
    });
    await appendErrorLog('update-suspicious', new Error('Suspicious update package'), downloadedUpdateMeta);
  }

  sendUpdaterStatus('downloaded', {
    version,
    sizeBytes,
    suspicious,
    message: suspicious ? 'Update descargada con advertencia. Revisá antes de instalar.' : 'Actualización lista. Reiniciar ahora'
  });
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
    handleUpdateDownloaded(info).catch(async (error) => {
      await appendErrorLog('update-downloaded', error, { info: info || {} });
      sendUpdaterStatus('error', { message: `Error validando update descargada: ${error?.message || error}` });
    });
  });
  autoUpdater.on('error', (error) => {
    const readable = error?.message || String(error);
    appendErrorLog('autoUpdater', error).catch(() => {});
    sendUpdaterStatus('error', { message: `Error de actualización: ${readable}` });
  });
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
    await appendErrorLog('store:setAll', error);
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
    await appendErrorLog('store:patch', error);
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
    await appendErrorLog('store:importContactsChunk', error, { payloadMeta: { reset: !!payload?.reset, size: payload?.chunk?.length || 0 } });
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
ipcMain.handle('app:getErrorLogPath', async () => getErrorLogPath());
ipcMain.handle('app:openErrorLog', async () => {
  const p = getErrorLogPath();
  if (!fssync.existsSync(p)) await fs.writeFile(p, '', 'utf8');
  await shell.openPath(p);
  return p;
});
ipcMain.handle('app:logError', async (_event, payload) => {
  const { scope = 'renderer', message = '', stack = '', extra = {} } = payload || {};
  await appendErrorLog(scope, { message, stack, name: payload?.name || 'RendererError', code: payload?.code || '' }, extra);
  return { ok: true };
});
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
    await appendErrorLog('updater:check', error);
    sendUpdaterStatus('error', { message: `Error de actualización: ${message}` });
    return { ok: false, message };
  }
});

ipcMain.handle('updater:install', async (_event, payload) => {
  const force = !!payload?.force;
  if (downloadedUpdateMeta?.suspicious && !force) {
    return {
      ok: false,
      requiresForce: true,
      message: downloadedUpdateMeta.suspicionReason || 'Update sospechosa detectada'
    };
  }
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return { ok: true };
});

ipcMain.handle('updater:rollbackPrevious', async () => {
  try {
    const candidate = await resolveRollbackInstaller();
    if (!candidate) {
      return { ok: false, message: 'No hay instalador anterior en cache para rollback.' };
    }
    await appendErrorLog('rollback', new Error('Rollback requested'), { targetVersion: candidate.version, installer: candidate.fullPath });
    await startInstallerAndQuit(candidate.fullPath);
    return { ok: true, version: candidate.version };
  } catch (error) {
    await appendErrorLog('rollback', error);
    return { ok: false, message: error?.message || String(error) };
  }
});

app.whenReady().then(async () => {
  try { await readDb(); } catch (error) { console.warn('No se pudo precalentar cache local:', error?.message || error); }
  createWindow();
  setupAutoUpdater();
  if (!app.isPackaged) {
    sendUpdaterStatus('not-available', { message: 'Modo desarrollo: auto-update desactivado.' });
  } else {
    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      await appendErrorLog('autoUpdater-initial-check', error);
      sendUpdaterStatus('error', { message: `Error de actualización: ${error?.message || error}` });
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

process.on('uncaughtException', (error) => {
  appendErrorLog('process-uncaughtException', error).catch(() => {});
});
process.on('unhandledRejection', (reason) => {
  appendErrorLog('process-unhandledRejection', reason).catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
