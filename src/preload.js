const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("roulette", {
  getState: () => ipcRenderer.invoke("state:get"),
  command: (name, payload) => ipcRenderer.invoke("command", { name, payload }),
  getSecretsSummary: () => ipcRenderer.invoke("secrets:summary"),
  saveAndConnectChzzk: (credentials) => ipcRenderer.invoke("chzzk:authorize", credentials),
  reconnectChzzk: () => ipcRenderer.invoke("chzzk:reconnect"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.off("state", listener);
  },
  onChzzkStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("chzzk:status", listener);
    return () => ipcRenderer.off("chzzk:status", listener);
  }
});
