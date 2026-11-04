const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
async function shot(window,name,width,height){
  window.setContentSize(width,height);
  await new Promise(resolve=>setTimeout(resolve,500));
  const image=await window.webContents.capturePage();
  await fs.writeFile(path.join(root,'release/home-preview-screenshots',name),image.toPNG());
}
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{sandbox:true,contextIsolation:true}});
  await window.loadURL('http://127.0.0.1:4173/?preview=home20');await new Promise(resolve=>setTimeout(resolve,2000));
  await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark';document.querySelector('.onboarding-dialog[open]')?.close();setActiveScreen('ptt');gatewayStatus.rxBusy=true;gatewayStatus.rxSourceId='7240599';ZapDMRHome.renderParticipants([
    {at:Date.now(),sourceId:'7240599',callsign:'PT9EXU',name:'Andre',location:'Três Lagoas, MS',country:'Brasil',talkgroupId:4003,slot:2},
    {at:Date.now()-78000,sourceId:'7240600',callsign:'PU2SUH',name:'Ataide',location:'São Paulo, SP',country:'Brasil',talkgroupId:4003,slot:2},
    {at:Date.now()-128000,sourceId:'7240601',callsign:'PT9GTA',name:'Ronaldo',location:'Dourados, MS',country:'Brasil',talkgroupId:4003,slot:2},
    {at:Date.now()-171000,sourceId:'7240602',callsign:'PU1MAV',name:'Morais',location:'Rio de Janeiro, RJ',country:'Brasil',talkgroupId:4003,slot:2},
    {at:Date.now()-221000,sourceId:'7240603',callsign:'PY2ABC',name:'Carlos',location:'Campinas, SP',country:'Brasil',talkgroupId:4003,slot:2}
  ]);`);
  await shot(window,'ZapDMR-2.0-Windows.png',1440,900);await shot(window,'ZapDMR-2.0-Android.png',430,932);window.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
