const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  setFullscreen: (value) => ipcRenderer.invoke("app:set-fullscreen", value),
  getVersion: () => ipcRenderer.invoke("app:get-version")
});
