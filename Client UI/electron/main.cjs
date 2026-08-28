const { app, BrowserWindow, dialog, ipcMain, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const isDev = !app.isPackaged || process.env.ELECTRON_DEV === '1';
const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5180';
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');
let mainWindow = null;

if (!app.requestSingleInstanceLock()) app.quit();

function safeResult(fn) {
  try { return fn(); } catch (error) { return { ok: false, message: String(error?.message || error) }; }
}

function readWindowState() {
  try { return JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')); } catch (_) { return {}; }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true });
  fs.writeFileSync(windowStateFile(), JSON.stringify({ ...bounds, isMaximized: win.isMaximized() }, null, 2));
}

function createWindow(projectId = null) {
  const saved = projectId ? {} : readWindowState();
  const win = new BrowserWindow({
    width: saved.width || 1400,
    height: saved.height || 900,
    x: saved.x,
    y: saved.y,
    minWidth: 1000,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  if (isDev) win.loadURL(`${rendererUrl}${query}`);
  else win.loadFile(path.join(process.resourcesPath, 'client', 'dist', 'index.html'), { query: projectId ? { projectId: String(projectId) } : {} });
  if (saved.isMaximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  if (!projectId) {
    ['resize', 'move', 'maximize', 'unmaximize'].forEach((event) => win.on(event, () => saveWindowState(win)));
    win.on('closed', () => { saveWindowState(win); mainWindow = null; });
  }
  return win;
}

ipcMain.handle('desktop:open-path', async (_event, targetPath) => {
  const resolved = path.resolve(String(targetPath || ''));
  if (!fs.existsSync(resolved)) return { ok: false, message: 'Path does not exist.' };
  const message = await shell.openPath(resolved);
  return message ? { ok: false, message } : { ok: true };
});

ipcMain.handle('desktop:path-exists', (_event, targetPath) => safeResult(() => {
  const resolved = path.resolve(String(targetPath || ''));
  const exists = fs.existsSync(resolved);
  return { ok: true, exists, isDir: exists && fs.statSync(resolved).isDirectory(), resolved };
}));

ipcMain.handle('desktop:pick-path', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog({
    title: String(options.title || 'Select path'),
    properties: options.file ? ['openFile'] : ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? { ok: false, canceled: true } : { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('desktop:open-project-window', (_event, projectId) => {
  const id = Number(projectId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, message: 'Invalid project id.' };
  createWindow(id);
  return { ok: true };
});

ipcMain.handle('desktop:rename-path', (_event, payload = {}) => safeResult(() => {
  const source = path.resolve(String(payload.oldPath || ''));
  const destination = path.resolve(String(payload.newPath || ''));
  if (!fs.existsSync(source)) throw new Error('Source path does not exist.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(source, destination);
  return { ok: true, path: destination };
}));

ipcMain.handle('desktop:delete-file', (_event, targetPath) => safeResult(() => {
  const resolved = path.resolve(String(targetPath || ''));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('File not found.');
  fs.unlinkSync(resolved);
  return { ok: true };
}));

ipcMain.handle('desktop:copy-file-to-folder', (_event, payload = {}) => safeResult(() => {
  const source = path.resolve(String(payload.sourcePath || ''));
  const targetDir = path.resolve(String(payload.targetDir || ''));
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Source file not found.');
  fs.mkdirSync(targetDir, { recursive: true });
  const destination = path.join(targetDir, String(payload.targetName || path.basename(source)));
  fs.copyFileSync(source, destination);
  return { ok: true, path: destination };
}));

ipcMain.handle('desktop:ensure-project-folders', (_event, targetPath) => safeResult(() => {
  const root = path.resolve(String(targetPath || ''));
  if (!String(targetPath || '').trim()) throw new Error('Project path is empty.');
  ['Ready Docs', 'Tender Docs', 'Working Docs'].forEach((name) => fs.mkdirSync(path.join(root, name), { recursive: true }));
  return { ok: true, path: root };
}));

ipcMain.handle('desktop:ensure-directory', (_event, targetPath) => safeResult(() => {
  const root = path.resolve(String(targetPath || ''));
  if (!String(targetPath || '').trim()) throw new Error('Folder path is empty.');
  fs.mkdirSync(root, { recursive: true });
  return { ok: true, path: root };
}));

ipcMain.handle('desktop:write-json-file', (_event, payload = {}) => safeResult(() => {
  const destination = path.resolve(String(payload.filePath || ''));
  if (!String(payload.filePath || '').trim()) throw new Error('File path is empty.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload.data ?? {}, null, 2), 'utf8');
  fs.renameSync(temp, destination);
  return { ok: true, path: destination };
}));

ipcMain.handle('desktop:client-api-request', async (_event, payload = {}) => {
  try {
    const baseUrl = new URL(String(payload.baseUrl || '').trim());
    if (!['https:', 'http:'].includes(baseUrl.protocol)) throw new Error('Backend URL must use HTTP or HTTPS.');
    const route = String(payload.route || '');
    if (!route.startsWith('/client/')) throw new Error('Only /client/* API routes are allowed.');
    const method = String(payload.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new Error('Unsupported client API method.');
    const clientKey = String(payload.clientKey || '').trim();
    // Auth routes (/client/auth/register, /client/auth/login) are called
    // before a token exists, so an empty key is valid — the server decides
    // whether the route requires one.
    const headers = { Accept: 'application/json' };
    if (clientKey) headers['x-client-key'] = clientKey;
    const options = { method, headers };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload.body ?? {});
    }
    const response = await net.fetch(`${baseUrl.toString().replace(/\/$/, '')}${route}`, options);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!response.ok) {
      const detail = data?.detail;
      const message = (detail && typeof detail === 'object' ? detail.message : detail)
        || `Client API returned HTTP ${response.status}.`;
      const reason = detail && typeof detail === 'object' ? detail.reason : null;
      return { ok: false, status: response.status, reason, message };
    }
    return { ok: true, data, status: response.status };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle('desktop:open-tender', async (_event, payload = {}) => {
  try {
    const initUrl = String(payload.initUrl || '').trim();
    const tenderUrl = String(payload.tenderUrl || '').trim();
    if (!tenderUrl) return { ok: false, message: 'Tender URL is empty.' };
    const win = new BrowserWindow({ show: true, autoHideMenuBar: true, width: 1280, height: 900 });
    if (initUrl) await win.loadURL(initUrl);
    await win.loadURL(tenderUrl);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle('desktop:download-file', async (_event, payload = {}) => {
  try {
    const url = String(payload.url || '').trim();
    if (!url) throw new Error('Download URL is empty.');
    let parsed;
    try { parsed = new URL(url); } catch (_) { throw new Error('Invalid download URL.'); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Download URL must be HTTP or HTTPS.');
    const destinationPath = String(payload.destinationPath || '').trim();
    if (!destinationPath) throw new Error('Destination path is empty.');
    const destination = path.resolve(destinationPath);
    const response = await net.fetch(url);
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temp = `${destination}.part`;
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, destination);
    return { ok: true, path: destination, bytes: buffer.length };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

app.whenReady().then(() => { mainWindow = createWindow(); });
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(); });
