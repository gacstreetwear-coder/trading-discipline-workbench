const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let backendProcess = null;
let backendPort = null;
const BACKEND_PORT = 5199;
let updatePromptOpen = false;
let updateCheckInFlight = false;
let installingUpdate = false;

function projectRoot() {
  return path.resolve(__dirname, "..");
}

function resourcePath(...parts) {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(projectRoot(), ...parts);
}

function appIconPath() {
  return app.isPackaged ? resourcePath("web", "assets", "app-icon.png") : resourcePath("assets", "app-icon.png");
}

function updateLog(message, error) {
  try {
    const line = `[${new Date().toISOString()}] ${message}${error ? ` ${error.stack || error.message || error}` : ""}\n`;
    fs.appendFileSync(path.join(app.getPath("userData"), "update.log"), line);
  } catch {
    // 日志失败不能影响主流程。
  }
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", () => {
      reject(new Error(`本地端口 ${port} 被占用，请关闭已经运行的交易纪律工作台后再打开。`));
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(resolve);
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
  backendPort = BACKEND_PORT;
  await assertPortAvailable(backendPort);
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
    detached: process.platform !== "win32",
  });

  backendProcess.on("exit", (code) => {
    if (!app.isQuiting && code !== 0) {
      dialog.showErrorBox("本地服务已退出", "行情、事件和K线服务异常退出，请重新打开软件。");
    }
  });

  await waitForHealth(backendPort);
}

function stopBackend(timeoutMs = 2000) {
  if (!backendProcess || backendProcess.killed) {
    backendProcess = null;
    return Promise.resolve();
  }

  const processToStop = backendProcess;
  backendProcess = null;
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    processToStop.once("exit", done);
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(processToStop.pid), "/T", "/F"], { windowsHide: true }).once("exit", done);
      } else {
        try {
          process.kill(-processToStop.pid, "SIGTERM");
        } catch {
          processToStop.kill("SIGTERM");
        }
      }
    } catch {
      done();
    }

    setTimeout(() => {
      if (!settled && process.platform !== "win32") {
        try {
          process.kill(-processToStop.pid, "SIGKILL");
        } catch {
          try {
            processToStop.kill("SIGKILL");
          } catch {
            // 已退出。
          }
        }
      }
      done();
    }, timeoutMs);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: "交易纪律工作台",
    backgroundColor: "#f6f7fb",
    icon: appIconPath(),
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

function versionLabel(info) {
  return info?.version ? `v${info.version}` : "新版本";
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (message) => updateLog(`INFO ${message}`),
    warn: (message) => updateLog(`WARN ${message}`),
    error: (message) => updateLog(`ERROR ${message}`),
    debug: (message) => updateLog(`DEBUG ${message}`),
  };

  autoUpdater.on("update-available", async (info) => {
    if (!mainWindow || updatePromptOpen) return;
    updatePromptOpen = true;
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["立即下载", "稍后"],
      defaultId: 0,
      cancelId: 1,
      title: "发现新版本",
      message: `发现 ${versionLabel(info)}`,
      detail: "建议先在「数据管理」里导出备份。确认后软件会在后台下载更新包，下载完成后再提示你重启安装。",
    });
    updatePromptOpen = false;

    if (result.response === 0) {
      updateLog(`download-start ${versionLabel(info)}`);
      mainWindow.setProgressBar(2);
      autoUpdater.downloadUpdate().catch(() => {
        mainWindow?.setProgressBar(-1);
        dialog.showErrorBox("更新下载失败", "请稍后重试，或到 GitHub Releases 手动下载安装包。");
      });
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Number(progress?.percent || 0);
    mainWindow?.setProgressBar(Math.min(Math.max(percent / 100, 0), 1));
  });

  autoUpdater.on("update-downloaded", async (info) => {
    updateLog(`update-downloaded ${versionLabel(info)}`);
    mainWindow?.setProgressBar(-1);
    if (!mainWindow || updatePromptOpen) return;
    updatePromptOpen = true;
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["重启并安装", "稍后"],
      defaultId: 0,
      cancelId: 1,
      title: "更新已下载",
      message: `${versionLabel(info)} 已下载完成`,
      detail: "点击「重启并安装」后，软件会关闭并安装新版本。你的交易数据会保留在本机。",
    });
    updatePromptOpen = false;

    if (result.response === 0) {
      await installDownloadedUpdate();
    }
  });

  autoUpdater.on("error", (error) => {
    updateLog("updater-error", error);
    mainWindow?.setProgressBar(-1);
    if (installingUpdate) {
      installingUpdate = false;
      dialog.showErrorBox("自动更新安装失败", "更新包已下载，但系统安装器没有成功接管。请到 GitHub Releases 手动下载安装包，或重新打开软件后再试。");
    }
  });
}

async function installDownloadedUpdate() {
  if (installingUpdate) return;
  installingUpdate = true;
  app.isQuiting = true;
  updateLog("install-confirmed");

  try {
    mainWindow?.setProgressBar(-1);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeAllListeners("close");
      mainWindow.close();
    }
    await stopBackend(2500);
    updateLog("backend-stopped-before-install");
    setTimeout(() => {
      updateLog("quit-and-install");
      autoUpdater.quitAndInstall(false, true);
    }, 250);
  } catch (error) {
    installingUpdate = false;
    updateLog("install-start-failed", error);
    dialog.showErrorBox("自动更新安装失败", error.message || "无法启动更新安装器，请手动下载安装包。");
  }
}

async function checkForUpdates() {
  if (!app.isPackaged || updateCheckInFlight) return;
  updateCheckInFlight = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // 自动更新失败不能影响软件正常使用。
  } finally {
    updateCheckInFlight = false;
  }
}

async function boot() {
  try {
    await startBackend();
    setupAutoUpdater();
    createWindow();
    setTimeout(checkForUpdates, 6000);
    setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
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
    stopBackend();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
