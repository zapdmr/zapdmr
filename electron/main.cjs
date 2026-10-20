const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, globalShortcut, powerSaveBlocker, shell, dialog } = require('electron');
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
  ipcMain.removeHandler('zapdmr-save-attachment');
  ipcMain.handle('zapdmr-save-attachment',async(event,value)=>{
    if(event.sender!==window.webContents||new URL(event.senderFrame?.url||'about:blank').origin!==new URL(localServer.url).origin)throw new Error('Origem inválida.');
    const name=String(value?.name||''),base64=String(value?.base64||'');
    if(!name||name.length>140||/[\\/\x00-\x1f\x7f]/.test(name)||! /\.(jpg|jpeg|png|webp|pdf|txt|csv|zip|rar|dat|rdt|bin)$/i.test(name)||base64.length>20971520||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw new Error('Arquivo inválido ou acima de 15 MB.');
    const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>15728640)throw new Error('O limite é de 15 MB.');
    const result=await dialog.showSaveDialog(window,{title:'Salvar anexo do ZapChat',defaultPath:path.join(app.getPath('downloads'),name),buttonLabel:'Salvar arquivo'});
    if(result.canceled||!result.filePath)return {canceled:true};
    await fs.promises.writeFile(result.filePath,bytes);return {saved:true};
  });
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
  window.webContents.setUserAgent(window.webContents.getUserAgent()+' ZapDMR/1.4.1');
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
