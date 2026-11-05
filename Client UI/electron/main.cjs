const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const isDev = !app.isPackaged || process.env.ELECTRON_DEV === '1';
const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000';
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');
let mainWindow = null;

if (!app.requestSingleInstanceLock()) app.quit();

// Chromium refuses to load file:// subresources from the renderer — in dev the
// page is served from http://localhost, and a packaged file:// page is an
// opaque origin — so the checklist preview's <img>, <iframe> and fetch() all
// came back empty. This scheme hands those bytes over through the main
// process instead. Must be declared before the app is ready.
protocol.registerSchemesAsPrivileged([{
  scheme: 'bmfile',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
}]);

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
    // The packaged .exe carries the icon itself, so this mainly fixes the
    // window/taskbar icon in development. Lives beside this file because
    // electron-builder's `files` list only packages electron/**/*.
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (isDev) {
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      console.log('[renderer] process gone:', details);
    });
    win.webContents.on('did-fail-load', (_event, code, description) => {
      console.log('[renderer] did-fail-load:', code, description);
    });
  }
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

// A raw deep link into a government tender portal often lands on that
// portal's own "Stale Session" error page — these sites only hand out a
// valid session when you arrive via their own search/listing flow. Opening
// the tender in-app (instead of the OS default browser) lets us detect that
// same signature the scraper backend already checks for
// (ScraperBackend._download_page_is_stale in Server UI/server/app_core.py)
// and recover by re-navigating through the org's listing page first — a
// single retry, not a loop, since some portals just don't offer a working
// listing URL either.
function pageTitleLooksStale(win) {
  try {
    const title = String(win.webContents.getTitle() || '').trim().toLowerCase();
    return title.includes('stale session') || title === 'error';
  } catch {
    return false;
  }
}

ipcMain.handle('desktop:open-tender-url', async (_event, payload = {}) => {
  const tenderUrl = String(payload.tenderUrl || '').trim();
  const listingUrl = String(payload.listingUrl || '').trim();
  if (!tenderUrl) return { ok: false, message: 'No tender URL to open.' };
  const win = new BrowserWindow({
    width: 1200,
    height: 850,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  const waitForLoad = () => new Promise((resolve) => {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', resolve);
  });
  win.loadURL(tenderUrl);
  await waitForLoad();
  if (!win.isDestroyed() && listingUrl && pageTitleLooksStale(win)) {
    win.loadURL(listingUrl);
    await waitForLoad();
    if (!win.isDestroyed()) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      win.loadURL(tenderUrl);
      await waitForLoad();
    }
  }
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
  const resolved = path.resolve(String(targetPath || ''));
  if (!String(targetPath || '').trim()) throw new Error('Path is empty.');
  fs.mkdirSync(resolved, { recursive: true });
  return { ok: true, path: resolved };
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
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Unsupported client API method.');
    // /client/auth/register and /client/auth/login are the only routes that
    // legitimately have no key yet — that's the point of signing in.
    const isAuthRoute = route.startsWith('/client/auth/register') || route.startsWith('/client/auth/login');
    const clientKey = String(payload.clientKey || '').trim();
    if (!clientKey && !isAuthRoute) throw new Error('Please sign in.');
    const headers = { Accept: 'application/json' };
    if (clientKey) headers['x-client-key'] = clientKey;
    const options = { method, headers };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload.body ?? {});
    }
    const response = await net.fetch(`${baseUrl.toString().replace(/\/$/, '')}${route}`, options);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!response.ok) {
      const detail = data?.detail;
      const message = Array.isArray(detail)
        ? detail.map((d) => d.msg || d.type).join('; ')
        : (detail && typeof detail === 'object' ? detail.message : detail)
          || `Client API returned HTTP ${response.status}.`;
      return { ok: false, status: response.status, message, detail };
    }
    return { ok: true, data, status: response.status };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

// Multipart sibling of desktop:client-api-request. That handler is JSON-only,
// and an IPC payload is structured-cloned so a renderer File/FormData can't
// survive the hop — with sandbox:true the renderer can't read the bytes at all.
// So the main process reads the file and posts it, through the same net.fetch
// (not CORS-constrained) and returning the same result shape, because callers
// branch on detail.reason for the server's 409 "first upload wins".
ipcMain.handle('desktop:upload-file', async (_event, payload = {}) => {
  try {
    const baseUrl = new URL(String(payload.baseUrl || '').trim());
    if (!['https:', 'http:'].includes(baseUrl.protocol)) throw new Error('Backend URL must use HTTP or HTTPS.');
    const route = String(payload.route || '');
    if (!route.startsWith('/client/')) throw new Error('Only /client/* API routes are allowed.');
    const clientKey = String(payload.clientKey || '').trim();
    if (!clientKey) throw new Error('Please sign in.');
    const filePath = String(payload.filePath || '').trim();
    if (!filePath) throw new Error('Upload file path is empty.');
    const source = path.resolve(filePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('File to upload was not found.');

    const form = new FormData();
    for (const [key, value] of Object.entries(payload.fields || {})) {
      if (value === undefined || value === null) continue;
      form.append(key, String(value));
    }
    const bytes = fs.readFileSync(source);
    form.append('file', new Blob([bytes], { type: String(payload.contentType || 'application/octet-stream') }), path.basename(source));

    // Ten minutes, not download-file's 60s: the cap is the server's
    // max_file_size_mb (80 MB by default) and an upload link is the slow one.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000);
    let response;
    try {
      // No Content-Type here on purpose — net.fetch derives the multipart
      // boundary from the FormData, and setting it by hand breaks parsing.
      response = await net.fetch(`${baseUrl.toString().replace(/\/$/, '')}${route}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'x-client-key': clientKey },
        body: form,
        signal: controller.signal,
      });
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') throw new Error('Upload timed out.');
      throw fetchError;
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!response.ok) {
      const detail = data?.detail;
      const message = Array.isArray(detail)
        ? detail.map((d) => d.msg || d.type).join('; ')
        : (detail && typeof detail === 'object' ? detail.message : detail)
          || `Upload failed with HTTP ${response.status}.`;
      return { ok: false, status: response.status, message, detail };
    }
    return { ok: true, data, status: response.status };
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
    // Without a timeout, a hung/unresponsive backend leaves this fetch never
    // resolving — the renderer's mutation stays "pending" forever, silently
    // disabling that tender's Download button with no error and no way to
    // retry short of restarting the app.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let response;
    try {
      // Only the client token may be forwarded (bid-pack files need it); any
      // other header from the renderer is ignored.
      const clientKey = String(payload.headers?.['x-client-key'] || '').trim();
      const headers = clientKey ? { 'x-client-key': clientKey } : undefined;
      response = await net.fetch(url, { signal: controller.signal, headers });
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') throw new Error('Download timed out.');
      throw fetchError;
    } finally {
      clearTimeout(timeout);
    }
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

// bmfile://local/<absolute path> → the file's bytes. Streamed by net.fetch
// rather than read into memory, so a large PDF previews without being
// buffered. Only ever serves an existing regular file.
function serveLocalFile(request) {
  try {
    const target = path.resolve(decodeURIComponent(new URL(request.url).pathname).replace(/^\//, ''));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  } catch (error) {
    return new Response(String(error?.message || error), { status: 400 });
  }
}

app.whenReady().then(() => {
  protocol.handle('bmfile', serveLocalFile);
  mainWindow = createWindow();
});
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(); });
