const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("roulette", {
  getState: () => ipcRenderer.invoke("state:get"),
  command: (name, payload) => ipcRenderer.invoke("command", { name, payload }),
  getSecretsSummary: () => ipcRenderer.invoke("secrets:summary"),
  saveAndConnectChzzk: (credentials) => ipcRenderer.invoke("chzzk:authorize", credentials),
  reconnectChzzk: () => ipcRenderer.invoke("chzzk:reconnect"),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openUpdatePage: () => ipcRenderer.invoke("update:open"),
  getCurrentLocation: () => ipcRenderer.invoke("location:current"),
  copyText: (value) => ipcRenderer.invoke("clipboard:write", value),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.off("state", listener);
  },
  onChzzkStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("chzzk:status", listener);
    return () => ipcRenderer.off("chzzk:status", listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.off("update:status", listener);
  },
  onWheelStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("wheel:status", listener);
    return () => ipcRenderer.off("wheel:status", listener);
  }
});
