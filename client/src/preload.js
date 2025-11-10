const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
    onFileOpened: (callback) => ipcRenderer.on('file-opened', (_event, file) => callback(file)),
    getClientVersion: () => ipcRenderer.invoke('get-app-version'),
    onBackgroundUploadStart: (callback) => ipcRenderer.on('background-upload-start', (_event, details) => callback(details)),
    uploadProgress: (progressData) => ipcRenderer.send('upload-progress', progressData),
    onUpdateUI: (callback) => ipcRenderer.on('update-ui', (_event, data) => callback(data)),
    uploadFinished: (result) => ipcRenderer.send('upload-finished', result),
    readFileFromPath: (filePath) => ipcRenderer.invoke('read-file-from-path', filePath),
    rendererReady: () => ipcRenderer.send('renderer-ready')
});