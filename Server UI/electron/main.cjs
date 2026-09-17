const { app, BrowserWindow, dialog, net, protocol } = require("electron");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const path = require("path");
const { pathToFileURL } = require("url");
const http = require("http");
const fs = require("fs");

// Trimmed sibling of the main app's electron/main.cjs, pointed at the
// standalone admin-console backend (Server UI/server) instead. The console
// already does its own prod/staging/local switching client-side (its own
// `env` selector hits whichever base URL is chosen directly), so this shell
// only needs to spawn ONE local backend and load its page — no remote-backend
// protocol handler, no project sub-windows, no file-management IPC.

const DEFAULT_BACKEND_PORT = app.isPackaged ? 28000 + (process.pid % 10000) : 8090;
const BACKEND_PORT = Number(process.env.BIDMANAGER_PORT || DEFAULT_BACKEND_PORT);
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const BACKEND_STARTUP_TIMEOUT_MS = 180000;
const DEV_FRONTEND_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:5174";
const isDev = !app.isPackaged || process.env.ELECTRON_DEV === "1";
const BACKEND_INSTANCE_TOKEN = randomUUID();
const WINDOW_STATE_FILE = "window-state.json";
const APP_SCHEME = "bidmanager";
const APP_ORIGIN = `${APP_SCHEME}://app`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
let backendProc = null;

function shellLog(message) {
  try {
    const localData = process.env.LOCALAPPDATA || app.getPath("userData");
    const logDir = path.join(localData, "BidManagerControl");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "electron-shell.log"),
      `[${new Date().toISOString()}] ${String(message)}\n`,
      "utf8"
    );
  } catch (_) {
    // Logging must never prevent startup.
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}
app.on("second-instance", async () => {
  shellLog("A second launch requested the existing window.");
  if (!mainWindow || mainWindow.isDestroyed()) {
    try {
      await createMainWindow();
    } catch (err) {
      shellLog(`Window recreation failed: ${err?.stack || err}`);
      dialog.showErrorBox("BidManager Control startup failed", String(err?.message || err));
    }
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (isDev) {
  try {
    const devUserData = path.join(app.getPath("temp"), "BidManagerControl-dev");
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
  const state = { ...bounds, isMaximized: win.isMaximized() };
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
        if (Date.now() >= deadline) reject(new Error("Backend did not become ready in time."));
        else setTimeout(tryOnce, 500);
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
  const spawnOpts = { env, windowsHide: true, stdio: isDev ? "inherit" : "ignore" };

  if (isDev) {
    const scriptPath = path.join(app.getAppPath(), "..", "server", "api_server.py");
    backendProc = spawn("python", [scriptPath], { ...spawnOpts, cwd: path.dirname(scriptPath) });
    return;
  }

  const backendExe = path.join(process.resourcesPath, "backend", "BidManagerControlBackend.exe");
  backendProc = spawn(backendExe, [], spawnOpts);
  shellLog(`Started packaged backend PID ${backendProc.pid || "unknown"} on ${BACKEND_URL}.`);
  backendProc.on("error", (err) => shellLog(`Backend process error: ${err?.stack || err}`));
  backendProc.on("exit", (code, signal) => shellLog(`Backend exited (code=${code}, signal=${signal || "none"}).`));
}

function stopBackend() {
  if (!backendProc || backendProc.killed) return;
  try {
    backendProc.kill();
  } catch (_) {
    // Ignore shutdown race conditions.
  }
}

function registerFrontendProtocol() {
  if (isDev) return;
  const frontendRoot = path.resolve(process.resourcesPath, "frontend", "dist");
  protocol.handle(APP_SCHEME, (request) => {
    const requestUrl = new URL(request.url);
    let relativePath = decodeURIComponent(requestUrl.pathname || "/");
    if (relativePath === "/") relativePath = "/index.html";

    let filePath = path.resolve(frontendRoot, `.${relativePath}`);
    const staysInsideFrontend = filePath === frontendRoot || filePath.startsWith(`${frontendRoot}${path.sep}`);
    if (!staysInsideFrontend || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(frontendRoot, "index.html");
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

async function createMainWindow() {
  shellLog("Creating main window.");
  const savedState = readWindowState();

  mainWindow = new BrowserWindow({
    width: Number(savedState.width) || 1280,
    height: Number(savedState.height) || 860,
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
      additionalArguments: [`--bidmanager-backend-url=${BACKEND_URL}`],
    },
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    shellLog(`Page load failed (${code} ${description}) for ${url}.`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    shellLog(`Renderer process ended: ${JSON.stringify(details)}.`);
  });
  mainWindow.on("unresponsive", () => shellLog("Main window became unresponsive."));

  startBackend();
  await waitForBackend(BACKEND_URL, BACKEND_STARTUP_TIMEOUT_MS);

  const targetUrls = [isDev ? DEV_FRONTEND_URL : `${APP_ORIGIN}/`];
  if (isDev) targetUrls.push(BACKEND_URL);
  let lastErr = null;
  for (const url of targetUrls) {
    try {
      await mainWindow.loadURL(url);
      shellLog(`Loaded ${url}.`);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw new Error(`Could not load ${targetUrls.join(" or ")}: ${lastErr.message || lastErr}`);
  if (savedState.isMaximized) mainWindow.maximize();
  mainWindow.show();
  mainWindow.focus();
  shellLog("Main window shown.");

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
  if (!hasSingleInstanceLock) return;
  try {
    shellLog(`Application ready (version ${app.getVersion()}).`);
    registerFrontendProtocol();
    await createMainWindow();
  } catch (err) {
    shellLog(`Startup failed: ${err?.stack || err}`);
    dialog.showErrorBox("BidManager Control startup failed", String(err?.message || err));
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
  if (!hasSingleInstanceLock) return;
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});
