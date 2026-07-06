const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

let mainWindow = null;
let backendProcess = null;
let backendPort = null;

function projectRoot() {
  return path.resolve(__dirname, "..");
}

function resourcePath(...parts) {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(projectRoot(), ...parts);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function backendCommand() {
  const exeName = process.platform === "win32" ? "trading-workbench-server.exe" : "trading-workbench-server";
  const packagedBackend = resourcePath("backend", exeName);
  if (fs.existsSync(packagedBackend)) {
    try {
      fs.chmodSync(packagedBackend, 0o755);
    } catch {
      // Windows and signed bundles may ignore chmod.
    }
    return { command: packagedBackend, args: [], cwd: path.dirname(packagedBackend) };
  }

  const serverScript = path.join(projectRoot(), "server.py");
  const python = process.platform === "win32" ? "python" : "python3";
  return { command: python, args: [serverScript], cwd: projectRoot() };
}

function waitForHealth(port, timeoutMs = 20000) {
  const startedAt = Date.now();
  const url = `http://127.0.0.1:${port}/api/health`;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      request.on("error", retry);
      request.setTimeout(1200, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("本地服务启动超时"));
        return;
      }
      setTimeout(tick, 350);
    };
    tick();
  });
}

async function startBackend() {
  backendPort = await freePort();
  const webRoot = resourcePath("web");
  const { command, args, cwd } = backendCommand();
  backendProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(backendPort),
      APP_STATIC_ROOT: webRoot,
    },
    stdio: app.isPackaged ? "ignore" : "inherit",
    windowsHide: true,
  });

  backendProcess.on("exit", (code) => {
    if (!app.isQuiting && code !== 0) {
      dialog.showErrorBox("本地服务已退出", "行情、事件和K线服务异常退出，请重新打开软件。");
    }
  });

  await waitForHealth(backendPort);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: "交易纪律工作台",
    backgroundColor: "#f6f7fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

async function boot() {
  try {
    await startBackend();
    createWindow();
  } catch (error) {
    dialog.showErrorBox("交易纪律工作台启动失败", error.message || "本地服务无法启动。");
    app.quit();
  }
}

const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(boot);

  app.on("before-quit", () => {
    app.isQuiting = true;
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill();
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
