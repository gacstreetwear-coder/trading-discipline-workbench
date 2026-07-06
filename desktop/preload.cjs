const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tradingWorkbench", {
  onUpdateStatus(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
});
