const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, globalShortcut, powerSaveBlocker, shell } = require('electron');
if (require('electron-squirrel-startup')) app.quit();
const { startServer } = require('../dist/server/index.js');

let localServer;
let shuttingDown = false;
let powerBlocker, pttShortcut, mediaShortcut, scanShortcut;
function resolveAudioSidecarExe() {
  if (process.env.ZAPDMR_AUDIO_SIDECAR_EXE) return process.env.ZAPDMR_AUDIO_SIDECAR_EXE;
  const packagedExe = path.join(process.resourcesPath, 'ZapDMRAudio.exe');
  const developmentExe = path.resolve(__dirname, '..', 'native', 'build', 'audio-sidecar-vs2022', 'bin', 'ZapDMRAudio.exe');
  if (fs.existsSync(packagedExe)) return packagedExe;
  if (fs.existsSync(developmentExe)) return developmentExe;
  return undefined;
}
function resolveAudioAssetsDir() {
  if (process.env.ZAPDMR_AUDIO_ASSETS_DIR) return process.env.ZAPDMR_AUDIO_ASSETS_DIR;
  if (app.isPackaged) return path.join(process.resourcesPath, 'vocoder');
  return path.join(app.getPath('userData'), 'assets', 'vocoder');
}
async function openWindow() {
  localServer = await startServer({
    userDataDir: app.getPath('userData'),
    udpPort: 42040,
    audioSidecarExe: resolveAudioSidecarExe(),
    audioAssetsDir: resolveAudioAssetsDir()
  });
  const window = new BrowserWindow({
    width: 1280, height: 840, minWidth: 360, minHeight: 620, title: 'ZapDMR',
    icon: path.join(__dirname, '..', 'assets', 'ZapDMR.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') }
  });
  ipcMain.removeHandler('zapdmr-operation');
  ipcMain.removeHandler('zapdmr-external');
  ipcMain.handle('zapdmr-external',(event,value)=>{
    if(event.sender!==window.webContents||!event.senderFrame?.url.startsWith(localServer.url))throw new Error('Origem inválida.');
    if(!/^https:\/\/wa\.me\/[1-9]\d{7,14}$/.test(String(value)))throw new Error('Destino externo inválido.');
    return shell.openExternal(value);
  });
  window.webContents.setWindowOpenHandler(({url})=>{try{const target=new URL(url);if(target.protocol==='https:'&&['wa.me','www.openstreetmap.org','radioid.net','www.zapdmr.com.br'].includes(target.hostname))void shell.openExternal(url);}catch{}return {action:'deny'};});
  ipcMain.handle('zapdmr-operation', (event, options = {}) => {
    if(event.sender !== window.webContents || !event.senderFrame?.url.startsWith(localServer.url)) throw new Error('Origem inválida.');
    if(options.keepScreenOn === true && powerBlocker === undefined) powerBlocker=powerSaveBlocker.start('prevent-display-sleep');
    if(options.keepScreenOn !== true && powerBlocker !== undefined){powerSaveBlocker.stop(powerBlocker);powerBlocker=undefined;}
    window.setFullScreen(options.hideStatusBar === true);
    if(pttShortcut)globalShortcut.unregister(pttShortcut);
    pttShortcut='F9';
    const shortcutRegistered=globalShortcut.register(pttShortcut,()=>window.webContents.send('zapdmr-ptt-key'));
    if(mediaShortcut){globalShortcut.unregister(mediaShortcut);mediaShortcut=undefined;}
    if(options.bluetoothPtt === true){mediaShortcut='MediaPlayPause';globalShortcut.register(mediaShortcut,()=>window.webContents.send('zapdmr-ptt-key'));}
    if(scanShortcut){globalShortcut.unregister(scanShortcut);scanShortcut=undefined;}
    const scanKey=options.scanKey;
    if(['F7','F8'].includes(scanKey)){scanShortcut=scanKey;globalShortcut.register(scanShortcut,()=>window.webContents.send('zapdmr-scan-key'));}
    return { shortcutRegistered };
  });
  window.webContents.setUserAgent(window.webContents.getUserAgent()+' ZapDMR/1.3.1');
  await window.loadURL(localServer.url);
}
app.whenReady().then(openWindow);
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) openWindow(); });
app.on('before-quit', (event) => {
  globalShortcut.unregisterAll();
  if(powerBlocker !== undefined){powerSaveBlocker.stop(powerBlocker);powerBlocker=undefined;}
  if (!localServer || shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  Promise.resolve(localServer.close()).finally(() => app.exit(0));
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
