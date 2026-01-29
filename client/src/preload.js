const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
    onFileOpened: (callback) => ipcRenderer.on('file-opened', (_event, file) => callback(file)),
    getClientVersion: () => ipcRenderer.invoke('get-client-version'),
    onBackgroundUploadStart: (callback) => ipcRenderer.on('background-upload-start', (_event, details) => callback(details)),
    uploadProgress: (progressData) => ipcRenderer.send('upload-progress', progressData),
    onUpdateUI: (callback) => ipcRenderer.on('update-ui', (_event, data) => callback(data)),
    uploadFinished: (result) => ipcRenderer.send('upload-finished', result),
    cancelUpload: () => ipcRenderer.send('cancel-upload'),
    onCancelUpload: (callback) => ipcRenderer.on('cancel-upload-trigger', (_event) => callback()),
    rendererReady: () => ipcRenderer.send('renderer-ready'),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    showWindow: () => ipcRenderer.send('show-window')
});