const { app, BrowserWindow, clipboard, dialog, shell } = require("electron");
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
let backendShutdownInProgress = false;
let latestUpdateStatus = null;

function projectRoot() {
  return path.resolve(__dirname, "..");
}

function resourcePath(...parts) {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(projectRoot(), ...parts);
}

function appIconPath() {
  return app.isPackaged ? resourcePath("web", "assets", "app-icon.png") : resourcePath("assets", "app-icon.png");
}

function preloadPath() {
  return path.join(__dirname, "preload.cjs");
}

function updateLog(message, error) {
  try {
    const line = `[${new Date().toISOString()}] ${message}${error ? ` ${error.stack || error.message || error}` : ""}\n`;
    fs.appendFileSync(path.join(app.getPath("userData"), "update.log"), line);
  } catch {
    // 日志失败不能影响主流程。
  }
}

function tailFile(filePath, maxChars = 6000) {
  try {
    if (!fs.existsSync(filePath)) return "";
    const content = fs.readFileSync(filePath, "utf8");
    return content.slice(-maxChars);
  } catch {
    return "";
  }
}

function diagnosticReport(context, error) {
  const userData = app.getPath("userData");
  return [
    "交易纪律工作台诊断信息",
    `时间：${new Date().toISOString()}`,
    `场景：${context}`,
    `版本：${app.getVersion()}`,
    `系统：${process.platform} ${process.arch}`,
    `Electron：${process.versions.electron}`,
    `Node：${process.versions.node}`,
    `应用路径：${app.getPath("exe")}`,
    `数据目录：${userData}`,
    `本地端口：${backendPort || BACKEND_PORT}`,
    `后台服务PID：${backendProcess?.pid || "无"}`,
    "",
    "错误信息：",
    error?.stack || error?.message || String(error || "无"),
    "",
    "最近更新日志：",
    tailFile(path.join(userData, "update.log")) || "无",
  ].join("\n");
}

async function showDiagnosticDialog(title, message, error, context) {
  updateLog(`diagnostic-${context}`, error);
  const result = await dialog.showMessageBox(mainWindow || undefined, {
    type: "error",
    buttons: ["复制诊断信息", "关闭"],
    defaultId: 0,
    cancelId: 1,
    title,
    message: title,
    detail: `${message}\n\n如果需要我排查，点击「复制诊断信息」，然后粘贴到 Codex 对话里。`,
  });
  if (result.response === 0) {
    clipboard.writeText(diagnosticReport(context, error));
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runQuietProcess(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    let child = null;
    try {
      child = spawn(command, args, {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      finish();
      return;
    }

    child.once("error", finish);
    child.once("exit", finish);
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        // 进程可能已经退出。
      }
      finish();
    }, timeoutMs);
  });
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      resolve(available);
    };

    const server = net.createServer();
    server.on("error", () => {
      finish(false);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => finish(true));
    });
  });
}

async function cleanupStaleBackend(port) {
  updateLog(`backend-port-${port}-busy-cleanup-start`);
  if (process.platform === "win32") {
    await runQuietProcess("taskkill", ["/IM", "trading-workbench-server.exe", "/T", "/F"]);
  } else {
    await runQuietProcess("pkill", ["-f", "trading-workbench-server"]);
  }
  await delay(800);
}

async function prepareBackendPort() {
  if (await isPortAvailable(BACKEND_PORT)) {
    return BACKEND_PORT;
  }

  await cleanupStaleBackend(BACKEND_PORT);
  if (await isPortAvailable(BACKEND_PORT)) {
    updateLog(`backend-port-${BACKEND_PORT}-recovered`);
    return BACKEND_PORT;
  }

  for (let offset = 1; offset <= 20; offset += 1) {
    const candidate = BACKEND_PORT + offset;
    if (await isPortAvailable(candidate)) {
      updateLog(`backend-port-fallback-${candidate}`);
      return candidate;
    }
  }

  throw new Error(`本地服务端口 ${BACKEND_PORT} 附近都被占用。请重启电脑后再打开交易纪律工作台。`);
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
  backendPort = await prepareBackendPort();
  const webRoot = resourcePath("web");
  const { command, args, cwd } = backendCommand();
  backendProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(backendPort),
      APP_STATIC_ROOT: webRoot,
      APP_VERSION: app.getVersion(),
      APP_USER_DATA: app.getPath("userData"),
    },
    stdio: app.isPackaged ? "ignore" : "inherit",
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  backendProcess.on("exit", (code) => {
    if (!app.isQuiting && code !== 0) {
      showDiagnosticDialog(
        "本地服务已退出",
        "行情、事件和K线服务异常退出，请重新打开软件。",
        new Error(`backend exited with code ${code}`),
        "后台服务异常退出",
      ).catch((error) => updateLog("diagnostic-dialog-failed", error));
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

async function quitAfterBackendStops(event) {
  if (!backendProcess || backendShutdownInProgress || installingUpdate) {
    app.isQuiting = true;
    return;
  }

  event.preventDefault();
  backendShutdownInProgress = true;
  app.isQuiting = true;
  await stopBackend(2500);
  app.exit(0);
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
      preload: preloadPath(),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`);
  mainWindow.webContents.on("did-finish-load", () => {
    if (latestUpdateStatus) {
      mainWindow.webContents.send("update-status", latestUpdateStatus);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function versionLabel(info) {
  return info?.version ? `v${info.version}` : "新版本";
}

function updaterCacheDir() {
  return path.join(app.getPath("cache"), "trading-discipline-workbench-updater");
}

function currentAppBundlePath() {
  if (process.platform !== "darwin") return "";
  const marker = ".app/Contents/MacOS/";
  const index = process.execPath.indexOf(marker);
  if (index < 0) return "";
  return `${process.execPath.slice(0, index)}.app`;
}

function newestFile(paths) {
  return paths
    .filter((filePath) => {
      try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    })
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
}

function pendingMacZipPath(version = "") {
  const pendingDir = path.join(updaterCacheDir(), "pending");
  const candidates = [];
  try {
    const files = fs.readdirSync(pendingDir);
    const zipFiles = files
      .filter((file) => file.endsWith(".zip"))
      .filter((file) => !version || file.includes(version));
    candidates.push(...zipFiles.map((file) => path.join(pendingDir, file)));
  } catch {
    // pending 目录可能还没有创建。
  }
  candidates.push(path.join(updaterCacheDir(), "update.zip"));
  return newestFile(candidates);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function createMacInstallScript(zipPath) {
  const appBundle = currentAppBundlePath();
  if (!appBundle) {
    throw new Error("无法定位当前 Mac 应用包路径。");
  }

  const helperDir = path.join(app.getPath("temp"), `trading-workbench-update-${Date.now()}`);
  const scriptPath = path.join(helperDir, "install-mac-update.sh");
  const stageDir = path.join(helperDir, "stage");
  const logPath = path.join(app.getPath("userData"), "mac-install.log");
  fs.mkdirSync(helperDir, { recursive: true });

  const content = `#!/bin/bash
set -euo pipefail
LOG=${shellQuote(logPath)}
exec >> "$LOG" 2>&1
echo "[$(/bin/date -u +"%Y-%m-%dT%H:%M:%SZ")] custom mac installer started"
ZIP=${shellQuote(zipPath)}
TARGET=${shellQuote(appBundle)}
STAGE=${shellQuote(stageDir)}
APP_PID=${process.pid}

/bin/rm -rf "$STAGE"
/bin/mkdir -p "$STAGE"
/usr/bin/ditto -x -k "$ZIP" "$STAGE"
NEW_APP="$(/usr/bin/find "$STAGE" -maxdepth 3 -name '*.app' -type d | /usr/bin/head -n 1)"
if [[ -z "$NEW_APP" ]]; then
  echo "no .app found in update zip"
  exit 2
fi

for i in {1..80}; do
  if /bin/kill -0 "$APP_PID" 2>/dev/null; then
    /bin/sleep 0.25
  else
    break
  fi
done

/usr/bin/pkill -f "${path.basename(appBundle)}/Contents/Resources/backend/trading-workbench-server" || true
/bin/sleep 0.4
/bin/rm -rf "$TARGET"
/usr/bin/ditto "$NEW_APP" "$TARGET"
/usr/bin/xattr -cr "$TARGET" || true
/bin/rm -rf ${shellQuote(path.join(updaterCacheDir(), "pending"))} ${shellQuote(path.join(updaterCacheDir(), "update.zip"))} || true
echo "[$(/bin/date -u +"%Y-%m-%dT%H:%M:%SZ")] custom mac installer finished"
/usr/bin/open "$TARGET"
`;
  fs.writeFileSync(scriptPath, content, "utf8");
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function sendUpdateStatus(status) {
  latestUpdateStatus = {
    time: new Date().toISOString(),
    ...status,
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", latestUpdateStatus);
  }
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

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({
      phase: "checking",
      title: "正在检查更新",
      message: "正在确认是否有新版本。",
      percent: 0,
    });
  });

  autoUpdater.on("update-available", async (info) => {
    if (!mainWindow || updatePromptOpen) return;
    sendUpdateStatus({
      phase: "available",
      title: "发现新版本",
      message: `${versionLabel(info)} 可下载。`,
      version: info?.version || "",
      percent: 0,
    });
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
      sendUpdateStatus({
        phase: "downloading",
        title: "正在下载更新",
        message: `${versionLabel(info)} 下载中。`,
        version: info?.version || "",
        percent: 0,
      });
      mainWindow.setProgressBar(2);
      autoUpdater.downloadUpdate().catch(() => {
        mainWindow?.setProgressBar(-1);
        sendUpdateStatus({
          phase: "error",
          title: "更新下载失败",
          message: "请稍后重试，或到 GitHub Releases 手动下载安装包。",
          percent: 0,
        });
        dialog.showErrorBox("更新下载失败", "请稍后重试，或到 GitHub Releases 手动下载安装包。");
      });
    } else {
      sendUpdateStatus({
        phase: "idle",
        title: "",
        message: "",
        percent: 0,
      });
    }
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus({
      phase: "idle",
      title: "",
      message: "",
      percent: 0,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Number(progress?.percent || 0);
    mainWindow?.setProgressBar(Math.min(Math.max(percent / 100, 0), 1));
    const speed = Number(progress?.bytesPerSecond || 0);
    const transferred = Number(progress?.transferred || 0);
    const total = Number(progress?.total || 0);
    sendUpdateStatus({
      phase: "downloading",
      title: "正在下载更新",
      message: "下载完成后会提示你重启安装。",
      percent,
      bytesPerSecond: speed,
      transferred,
      total,
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    updateLog(`update-downloaded ${versionLabel(info)}`);
    mainWindow?.setProgressBar(-1);
    sendUpdateStatus({
      phase: "downloaded",
      title: "更新已下载",
      message: `${versionLabel(info)} 已下载完成，等待重启安装。`,
      version: info?.version || "",
      percent: 100,
    });
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
    const pendingZip = process.platform === "darwin" ? pendingMacZipPath(latestUpdateStatus?.version || "") : "";
    if (pendingZip && /Code signature|Squirrel|validation/i.test(error?.message || "")) {
      updateLog(`mac-native-validation-ignored ${pendingZip}`);
      sendUpdateStatus({
        phase: "downloaded",
        title: "更新已下载",
        message: "Mac 原生签名校验未接管，稍后将使用内置安装助手安装。",
        version: latestUpdateStatus?.version || "",
        percent: 100,
      });
      return;
    }
    sendUpdateStatus({
      phase: "error",
      title: "更新失败",
      message: error?.message || "更新过程出现异常。",
      percent: 0,
    });
    if (installingUpdate) {
      installingUpdate = false;
      showDiagnosticDialog(
        "自动更新安装失败",
        "更新包已下载，但系统安装器没有成功接管。请到 GitHub Releases 手动下载安装包，或重新打开软件后再试。",
        error,
        "自动更新安装失败",
      );
    }
  });
}

async function installDownloadedUpdate() {
  if (installingUpdate) return;
  if (process.platform === "darwin") {
    await installDownloadedMacUpdate();
    return;
  }

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
    await showDiagnosticDialog("自动更新安装失败", error.message || "无法启动更新安装器，请手动下载安装包。", error, "自动更新启动失败");
  }
}

async function installDownloadedMacUpdate() {
  if (installingUpdate) return;
  installingUpdate = true;
  app.isQuiting = true;
  updateLog("mac-custom-install-confirmed");

  try {
    const version = latestUpdateStatus?.version || "";
    const zipPath = pendingMacZipPath(version);
    if (!zipPath) {
      throw new Error("没有找到已下载的 Mac 更新包，请重新下载更新。");
    }
    const scriptPath = createMacInstallScript(zipPath);
    updateLog(`mac-custom-installer-created ${scriptPath}`);
    sendUpdateStatus({
      phase: "installing",
      title: "正在安装更新",
      message: "软件会退出，安装完成后自动重新打开。",
      percent: 100,
    });
    const child = spawn("/bin/bash", [scriptPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    await stopBackend(2500);
    app.exit(0);
  } catch (error) {
    installingUpdate = false;
    app.isQuiting = false;
    updateLog("mac-custom-install-start-failed", error);
    await showDiagnosticDialog("自动更新安装失败", error.message || "无法启动 Mac 安装助手，请手动下载安装包。", error, "Mac自动更新安装失败");
  }
}

async function checkForUpdates() {
  if (!app.isPackaged || updateCheckInFlight) return;
  updateCheckInFlight = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    sendUpdateStatus({
      phase: "error",
      title: "检查更新失败",
      message: error?.message || "暂时无法检查更新。",
      percent: 0,
    });
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
    await showDiagnosticDialog("交易纪律工作台启动失败", error.message || "本地服务无法启动。", error, "启动失败");
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

  app.on("before-quit", quitAfterBackendStops);

  app.on("window-all-closed", () => {
    app.quit();
  });
}
