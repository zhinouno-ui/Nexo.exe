const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
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
  const dir = path.dirname(dbPath);
  await fs.mkdir(dir, { recursive: true });
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'nexo.html'));
}

ipcMain.handle('store:getAll', async () => readDb());
ipcMain.handle('store:setAll', async (_event, data) => {
  await queueWrite(data && typeof data === 'object' ? data : {});
  return readDb();
});
ipcMain.handle('store:patch', async (_event, partial) => {
  const current = await readDb();
  const next = {
    ...current,
    ...(partial && typeof partial === 'object' ? partial : {})
  };
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
