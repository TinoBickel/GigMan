const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { createDownloader } = require('./youtube.cjs');
const { exportArchive, importArchive } = require('./archive.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'gigman', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
if (process.env.GIGMAN_DATA_DIR) app.setPath('userData', path.resolve(process.env.GIGMAN_DATA_DIR));
let window, root;
let mayClose = false;
let saveQueue = Promise.resolve();
const empty = () => ({ version: 1, setlists: [], settings: { tempo: 1, pitch: 0, count: 4, bpm: 100, volume: 0.8 } });
async function load() {
  try { return JSON.parse(await fs.readFile(path.join(root, 'library.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return empty(); throw new Error('Die Bibliothek konnte nicht gelesen werden. Die gespeicherte Datei wurde nicht verändert.'); }
}
async function importPaths(paths) {
  const songs = [], errors = [];
  for (const source of paths) {
    if (path.extname(source).toLowerCase() !== '.mp3') continue;
    const id = randomUUID();
    try {
      await fs.copyFile(source, path.join(root, 'audio', `${id}.mp3`));
      songs.push({ id, title: path.basename(source, path.extname(source)), file: `${id}.mp3`, sections: [], gap: 0, duration: 0 });
    } catch { errors.push(path.basename(source)); }
  }
  return { songs, errors };
}
app.whenReady().then(async () => {
  root = app.getPath('userData');
  await fs.mkdir(path.join(root, 'audio'), { recursive: true });
  const youtube = createDownloader({ root, tools: app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.resolve(__dirname, '../tools/runtime'), runtime: process.execPath, progress: update => { if (window && !window.isDestroyed()) window.webContents.send('youtube:progress', update); } });
  ipcMain.handle('youtube:download', (_event, url) => youtube.download(url));
  ipcMain.handle('youtube:cancel', () => youtube.cancel());
  app.on('before-quit', () => youtube.cancel());
  protocol.handle('gigman', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Nicht gefunden', { status: 404 });
    if (url.pathname.startsWith('/audio/')) {
      const file = url.pathname.slice(7);
      if (!/^[a-f0-9-]+\.mp3$/.test(file)) return new Response('Nicht gefunden', { status: 404 });
      return net.fetch(pathToFileURL(path.join(root, 'audio', file)).toString());
    }
    const dist = path.resolve(__dirname, '../dist');
    const file = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(dist + path.sep)) return new Response('Nicht gefunden', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  ipcMain.handle('library:load', load);
  let archiveBusy = false;
  ipcMain.handle('archive:export', async (_event, library) => {
    if (archiveBusy) throw new Error('Eine Sicherung wird bereits verarbeitet.');
    archiveBusy = true;
    try {
      const date = new Date().toISOString().slice(0, 10);
      const name = library.setlists.length === 1 ? library.setlists[0].name : 'GigMan-Bibliothek';
      const result = await dialog.showSaveDialog(window, { title: 'Setlisten mit MP3s sichern', defaultPath: `${String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-${date}.gigman`, filters: [{ name: 'GigMan-Sicherung', extensions: ['gigman'] }] });
      if (result.canceled || !result.filePath) return null;
      await saveQueue.catch(() => {});
      return await exportArchive(root, result.filePath, library);
    } finally { archiveBusy = false; }
  });
  ipcMain.handle('archive:import', async () => {
    if (archiveBusy) throw new Error('Eine Sicherung wird bereits verarbeitet.');
    archiveBusy = true;
    try {
      const result = await dialog.showOpenDialog(window, { title: 'GigMan-Sicherung laden', properties: ['openFile'], filters: [{ name: 'GigMan-Sicherung', extensions: ['gigman'] }] });
      return result.canceled ? null : await importArchive(root, result.filePaths[0]);
    } finally { archiveBusy = false; }
  });
  ipcMain.on('window:close-ready', event => {
    if (window && event.sender === window.webContents) { mayClose = true; window.close(); }
  });
  ipcMain.handle('library:save', (_event, state) => {
    if (state?.version !== 1 || !Array.isArray(state.setlists)) throw new Error('Ungültige Bibliothek');
    const content = JSON.stringify(state, null, 2);
    const task = saveQueue.catch(() => {}).then(async () => {
      const temp = path.join(root, 'library.tmp');
      await fs.writeFile(temp, content, 'utf8');
      await fs.rename(temp, path.join(root, 'library.json'));
    });
    saveQueue = task;
    return task;
  });
  ipcMain.handle('audio:import-folder', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'MP3-Verzeichnis importieren', properties: ['openDirectory'] });
    if (result.canceled) return null;
    const dir = result.filePaths[0];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return importPaths(entries.filter(e => e.isFile()).map(e => path.join(dir, e.name)));
  });
  ipcMain.handle('audio:import-files', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'MP3s hinzufügen', properties: ['openFile', 'multiSelections'], filters: [{ name: 'MP3-Audio', extensions: ['mp3'] }] });
    return result.canceled ? null : importPaths(result.filePaths);
  });
  function createWindow() {
    mayClose = false;
    window = new BrowserWindow({ width: 1440, height: 960, minWidth: 1000, minHeight: 680, backgroundColor: '#101114', title: 'GigMan', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', event => {
      if (!mayClose && !window.webContents.isDestroyed()) { event.preventDefault(); window.webContents.send('library:closing'); }
    });
    window.loadURL('gigman://app/index.html');
  }
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
