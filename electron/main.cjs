const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const path = require("path");
const { pathToFileURL } = require("url");
const http = require("http");
const https = require("https");
const fs = require("fs");

const DEFAULT_BACKEND_PORT = app.isPackaged ? 18000 + (process.pid % 10000) : 8000;
const BACKEND_PORT = Number(process.env.BIDMANAGER_PORT || DEFAULT_BACKEND_PORT);
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const BACKEND_STARTUP_TIMEOUT_MS = 180000;
const DEV_FRONTEND_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:5173";
const isDev = !app.isPackaged || process.env.ELECTRON_DEV === "1";
const BACKEND_INSTANCE_TOKEN = randomUUID();
const DESKTOP_BACKEND_CONFIG_FILE = "backend-config.json";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "bidmanager",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let mainWindow = null;
let backendProc = null;
let activeBackendConfig = { mode: "local", url: "" };
const projectWindows = new Set();
const WINDOW_STATE_FILE = "window-state.json";
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function normalizeBackendConfig(value = {}) {
  const mode = String(value.mode || value.backend_mode || "local").trim().toLowerCase();
  const url = String(value.url || value.backend_url || "").trim().replace(/\/+$/, "");
  return { mode: mode === "remote" && url ? "remote" : "local", url };
}

function readDesktopBackendConfig() {
  try {
    const filePath = path.join(app.getPath("userData"), DESKTOP_BACKEND_CONFIG_FILE);
    return normalizeBackendConfig(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (_) {
    return { mode: "local", url: "" };
  }
}

function writeDesktopBackendConfig(value) {
  const config = normalizeBackendConfig(value);
  const filePath = path.join(app.getPath("userData"), DESKTOP_BACKEND_CONFIG_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
  return config;
}

function rendererUrl(projectId = null) {
  const params = new URLSearchParams();
  if (activeBackendConfig.mode === "remote") params.set("apiBase", activeBackendConfig.url);
  if (projectId) params.set("projectId", String(projectId));
  const query = params.toString();
  if (isDev) return `${DEV_FRONTEND_URL}${query ? `?${query}` : ""}`;
  if (activeBackendConfig.mode === "remote") {
    return `bidmanager://app/index.html${query ? `?${query}` : ""}`;
  }
  return `${BACKEND_URL}${query ? `?${query}` : ""}`;
}

function registerRendererProtocol() {
  protocol.handle("bidmanager", (request) => {
    const requestUrl = new URL(request.url);
    const frontendRoot = path.resolve(process.resourcesPath, "frontend", "dist");
    let relativePath = decodeURIComponent(requestUrl.pathname || "/").replace(/^\/+/, "");
    if (!relativePath) relativePath = "index.html";
    let filePath = path.resolve(frontendRoot, relativePath);
    if (filePath !== frontendRoot && !filePath.startsWith(`${frontendRoot}${path.sep}`)) {
      filePath = path.join(frontendRoot, "index.html");
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(frontendRoot, "index.html");
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

ipcMain.handle("desktop:open-path", async (_event, targetPath) => {
  const pathTxt = String(targetPath || "").trim();
  if (!pathTxt) return { ok: false, message: "Path is empty." };
  try {
    const resolved = path.resolve(pathTxt);
    if (!fs.existsSync(resolved)) {
      return { ok: false, message: "Path does not exist." };
    }
    const err = await shell.openPath(resolved);
    if (err) return { ok: false, message: err };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle("desktop:path-exists", async (_event, targetPath) => {
  try {
    const pathTxt = String(targetPath || "").trim();
    if (!pathTxt) return { ok: false, exists: false, isDir: false, message: "Path is empty." };
    const resolved = path.resolve(pathTxt);
    if (!fs.existsSync(resolved)) return { ok: true, exists: false, isDir: false, resolved };
    const stat = fs.statSync(resolved);
    return { ok: true, exists: true, isDir: stat.isDirectory(), resolved };
  } catch (err) {
    return { ok: false, exists: false, isDir: false, message: String(err?.message || err) };
  }
});

ipcMain.handle("desktop:pick-path", async (_event, options = {}) => {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const pickFile = Boolean(opts.file);
    const title = String(opts.title || "").trim() || "Select Path";
    const properties = pickFile ? ["openFile"] : ["openDirectory", "createDirectory"];
    const result = await dialog.showOpenDialog({
      title,
      properties,
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: result.filePaths[0] };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle("desktop:open-project-window", async (_event, projectId) => {
  const pid = Number(projectId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, message: "Invalid project id." };
  }
  try {
    const child = new BrowserWindow({
      width: 1350,
      height: 850,
      minWidth: 1000,
      minHeight: 650,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await child.loadURL(rendererUrl(pid));
    projectWindows.add(child);
    child.on("closed", () => projectWindows.delete(child));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle("desktop:get-backend-config", () => readDesktopBackendConfig());

ipcMain.handle("desktop:set-backend-config", (_event, value) => {
  try {
    return { ok: true, ...writeDesktopBackendConfig(value), restart_required: true };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle("desktop:rename-path", async (_event, payload = {}) => {
  try {
    const oldPath = String(payload.oldPath || "").trim();
    const newPath = String(payload.newPath || "").trim();
    if (!oldPath || !newPath) return { ok: false, message: "Both old and new paths are required." };
    const src = path.resolve(oldPath);
    const dst = path.resolve(newPath);
    if (!fs.existsSync(src)) return { ok: false, message: "Source path does not exist." };
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return { ok: true, path: dst };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle("desktop:delete-file", async (_event, targetPath) => {
  try {
    const txt = String(targetPath || "").trim();
    if (!txt) return { ok: false, message: "Path is empty." };
    const resolved = path.resolve(txt);
    if (!fs.existsSync(resolved)) return { ok: false, message: "File not found." };
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { ok: false, message: "Path is not a file." };
    fs.unlinkSync(resolved);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle("desktop:copy-file-to-folder", async (_event, payload = {}) => {
  try {
    const sourcePath = String(payload.sourcePath || "").trim();
    const targetDir = String(payload.targetDir || "").trim();
    const targetName = String(payload.targetName || "").trim();
    if (!sourcePath || !targetDir) {
      return { ok: false, message: "sourcePath and targetDir are required." };
    }
    const src = path.resolve(sourcePath);
    if (!fs.existsSync(src)) return { ok: false, message: "Source file not found." };
    const stat = fs.statSync(src);
    if (!stat.isFile()) return { ok: false, message: "Source is not a file." };
    fs.mkdirSync(targetDir, { recursive: true });
    const finalName = targetName || path.basename(src);
    const dest = path.join(targetDir, finalName);
    fs.copyFileSync(src, dest);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle("desktop:ensure-project-folders", async (_event, targetPath) => {
  try {
    const txt = String(targetPath || "").trim();
    if (!txt) return { ok: false, message: "Path is empty." };
    const root = path.resolve(txt);
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(root, "Ready Docs"), { recursive: true });
    fs.mkdirSync(path.join(root, "Tender Docs"), { recursive: true });
    fs.mkdirSync(path.join(root, "Working Docs"), { recursive: true });
    return { ok: true, path: root };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle("desktop:write-json-file", async (_event, payload = {}) => {
  try {
    const filePath = String(payload.filePath || "").trim();
    const data = payload.data;
    if (!filePath) return { ok: false, message: "filePath is required." };
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const temp = `${resolved}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data ?? {}, null, 2), "utf8");
    fs.renameSync(temp, resolved);
    return { ok: true, path: resolved };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

function testBackendUrl(rawUrl) {
  const base = String(rawUrl || "").trim().replace(/\/+$/, "");
  if (!base) return { ok: false, message: "Backend URL is required." };

  let parsed;
  try {
    parsed = new URL(`${base}/health`);
  } catch (_) {
    return { ok: false, message: "Backend URL is invalid." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, message: "Backend URL must start with http:// or https://." };
  }

  const client = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = client.get(parsed, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          resolve({ ok: false, message: `HTTP ${res.statusCode || "unknown"}` });
          return;
        }
        try {
          const parsedBody = JSON.parse(body);
          resolve({ ok: true, version: String(parsedBody.version || "unknown") });
        } catch (_) {
          resolve({ ok: false, message: "Health endpoint did not return JSON." });
        }
      });
    });
    req.on("error", (err) => {
      resolve({ ok: false, message: String(err?.message || err) });
    });
    req.setTimeout(20000, () => {
      req.destroy(new Error("Connection timed out."));
    });
  });
}

ipcMain.handle("desktop:test-backend-url", (_event, rawUrl) => testBackendUrl(rawUrl));

if (isDev) {
  try {
    const devUserData = path.join(app.getPath("temp"), "BidManager-dev");
    fs.mkdirSync(devUserData, { recursive: true });
    app.setPath("userData", devUserData);
  } catch (_) {
    // Fall back to Electron default if temp path cannot be used.
  }
}

function readWindowState() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath("userData"), WINDOW_STATE_FILE), "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const state = {
    ...bounds,
    isMaximized: win.isMaximized(),
  };
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(
      path.join(app.getPath("userData"), WINDOW_STATE_FILE),
      JSON.stringify(state, null, 2),
      "utf8"
    );
  } catch (_) {
    // Ignore persistence failures.
  }
}

function waitForBackend(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      if (backendProc && backendProc.exitCode !== null) {
        reject(new Error(`Backend exited during startup with code ${backendProc.exitCode}.`));
        return;
      }
      const req = http.get(`${url}/health`, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          let token = "";
          try {
            token = String(JSON.parse(body)?.instance_token || "");
          } catch (_) {
            token = "";
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300 && token === BACKEND_INSTANCE_TOKEN) {
            resolve();
          } else if (Date.now() >= deadline) {
            reject(new Error(`Backend health check failed or another server is using port ${BACKEND_PORT}.`));
          } else {
            setTimeout(tryOnce, 500);
          }
        });
      });
      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error("Backend did not become ready in time."));
        } else {
          setTimeout(tryOnce, 500);
        }
      });
      req.setTimeout(2500, () => req.destroy());
    };
    tryOnce();
  });
}

function startBackend() {
  const env = {
    ...process.env,
    BIDMANAGER_PORT: String(BACKEND_PORT),
    BIDMANAGER_INSTANCE_TOKEN: BACKEND_INSTANCE_TOKEN,
  };
  const spawnOpts = {
    env,
    windowsHide: true,
    stdio: isDev ? "inherit" : "ignore",
  };

  if (isDev) {
    const scriptPath = path.join(app.getAppPath(), "backend", "api_server.py");
    backendProc = spawn("python", [scriptPath], {
      ...spawnOpts,
      cwd: path.dirname(scriptPath),
    });
    return;
  }

  const backendExe = path.join(process.resourcesPath, "backend", "BidManagerBackend.exe");
  backendProc = spawn(backendExe, [], spawnOpts);
}

function stopBackend() {
  if (!backendProc || backendProc.killed) return;
  try {
    backendProc.kill();
  } catch (_) {
    // Ignore shutdown race conditions.
  }
}

async function createMainWindow() {
  activeBackendConfig = readDesktopBackendConfig();
  const savedState = readWindowState();

  mainWindow = new BrowserWindow({
    width: Number(savedState.width) || 1400,
    height: Number(savedState.height) || 900,
    x: Number.isFinite(savedState.x) ? savedState.x : undefined,
    y: Number.isFinite(savedState.y) ? savedState.y : undefined,
    minWidth: 1000,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const startupHtml = encodeURIComponent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>BidManager</title>
        <style>
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fb; color: #172033; font-family: "Segoe UI", sans-serif; }
          main { text-align: center; }
          h1 { margin: 0 0 12px; font-size: 28px; }
          p { margin: 0; color: #60708a; }
        </style>
      </head>
      <body><main><h1>BidManager</h1><p>Starting the application...</p></main></body>
    </html>
  `);
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${startupHtml}`);
  mainWindow.show();

  if (activeBackendConfig.mode === "local") {
    startBackend();
    await waitForBackend(BACKEND_URL, BACKEND_STARTUP_TIMEOUT_MS);
  } else {
    const remoteHealth = await testBackendUrl(activeBackendConfig.url);
    if (!remoteHealth.ok) throw new Error(`Cloud backend is unavailable: ${remoteHealth.message}`);
  }

  const targetUrls = [rendererUrl()];
  if (isDev && activeBackendConfig.mode === "local") targetUrls.push("http://127.0.0.1:5173");
  let lastErr = null;
  for (const url of targetUrls) {
    try {
      await mainWindow.loadURL(url);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  if (savedState.isMaximized) {
    mainWindow.maximize();
  }
  mainWindow.show();

  mainWindow.on("resize", () => saveWindowState(mainWindow));
  mainWindow.on("move", () => saveWindowState(mainWindow));
  mainWindow.on("maximize", () => saveWindowState(mainWindow));
  mainWindow.on("unmaximize", () => saveWindowState(mainWindow));

  mainWindow.on("closed", () => {
    saveWindowState(mainWindow);
    mainWindow = null;
  });
}

app.on("ready", async () => {
  try {
    registerRendererProtocol();
    await createMainWindow();
  } catch (err) {
    dialog.showErrorBox("BidManager startup failed", String(err?.message || err));
    stopBackend();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});
