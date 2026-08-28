const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bidmanagerDesktop", {
  platform: process.platform,
  openPath: (targetPath) => ipcRenderer.invoke("desktop:open-path", targetPath),
  pathExists: (targetPath) => ipcRenderer.invoke("desktop:path-exists", targetPath),
  pickPath: (options) => ipcRenderer.invoke("desktop:pick-path", options),
  openProjectWindow: (projectId) => ipcRenderer.invoke("desktop:open-project-window", projectId),
  renamePath: (payload) => ipcRenderer.invoke("desktop:rename-path", payload),
  deleteFile: (targetPath) => ipcRenderer.invoke("desktop:delete-file", targetPath),
  copyFileToFolder: (payload) => ipcRenderer.invoke("desktop:copy-file-to-folder", payload),
  ensureProjectFolders: (targetPath) => ipcRenderer.invoke("desktop:ensure-project-folders", targetPath),
  writeJsonFile: (payload) => ipcRenderer.invoke("desktop:write-json-file", payload),
});
