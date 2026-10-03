const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gigman', {
  load: () => ipcRenderer.invoke('library:load'),
  save: state => ipcRenderer.invoke('library:save', state),
  importFolder: () => ipcRenderer.invoke('audio:import-folder'),
  importFiles: () => ipcRenderer.invoke('audio:import-files'),
  downloadYouTube: url => ipcRenderer.invoke('youtube:download', url),
  cancelYouTube: () => ipcRenderer.invoke('youtube:cancel'),
  onDownloadProgress: handler => {
    const listener = (_event, update) => handler(update);
    ipcRenderer.on('youtube:progress', listener);
    return () => ipcRenderer.removeListener('youtube:progress', listener);
  },
  onClosing: handler => ipcRenderer.on('library:closing', async () => {
    try { await handler(); ipcRenderer.send('window:close-ready'); } catch { /* Renderer explains the save failure and keeps the window open. */ }
  })
});
