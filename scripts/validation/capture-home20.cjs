const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'release/home-v20-correction-screenshots');
async function shot(window,name){const image=await window.webContents.capturePage();await fs.writeFile(path.join(output,name),image.toPNG());}
async function run(window,code){return window.webContents.executeJavaScript(code);}
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true});
  const window=new BrowserWindow({show:false,width:430,height:932,webPreferences:{sandbox:true,contextIsolation:true}});window.setContentSize(430,932);
  await window.loadURL('http://127.0.0.1:4173/?preview=home20');await new Promise(resolve=>setTimeout(resolve,1900));
  await run(window,`document.documentElement.dataset.theme='dark';document.querySelector('.onboarding-dialog[open]')?.close();setActiveScreen('ptt');
    gatewayStatus.connected=true;gatewayStatus.pttReady=true;gatewayStatus.rxBusy=false;gatewayStatus.rxSourceId='';
    ZapDMRHome.setParticipantView('list');ZapDMRHome.setParticipantFontSize('normal');ZapDMRHome.renderParticipants(window.__homePreviewParticipants=[
      {at:Date.now(),sourceId:'7240599',callsign:'PY2VS',name:'Luciano',location:'Votuporanga, SP',country:'Brasil',talkgroupId:724,slot:1},
      {at:Date.now()-5000,sourceId:'7240600',callsign:'PY3TG',name:'Tierres',location:'São José do Rio Preto, SP',country:'Brasil',talkgroupId:724,slot:1},
      {at:Date.now()-42000,sourceId:'7240601',callsign:'PY2RDT',name:'Ronaldo',location:'Dourados, MS',country:'Brasil',talkgroupId:724,slot:1},
      {at:Date.now()-109000,sourceId:'7240602',callsign:'PY1XPQ',name:'Paulo',location:'Rio de Janeiro, RJ',country:'Brasil',talkgroupId:724,slot:1},
      {at:Date.now()-183000,sourceId:'7240603',callsign:'PU2SUH',name:'Ataide',location:'Campinas, SP',country:'Brasil',talkgroupId:724,slot:1},
      {at:Date.now()-255000,sourceId:'7240604',callsign:'PS7JAP',name:'Jairo',location:'Fortaleza, CE',country:'Brasil',talkgroupId:724,slot:1}
    ]);document.getElementById('badge').innerHTML='<i></i> Online';document.getElementById('operationNetwork').textContent='DMR';document.getElementById('operationTalkgroup').textContent='TG 724';ZapDMROperation.reflectTx();`);
  await run(window,`document.documentElement.dataset.theme='dark';ZapDMRHome.renderParticipants(window.__homePreviewParticipants);scanEnabled=true;document.getElementById('pttScan').setAttribute('aria-pressed','true');document.getElementById('pttScanLabel').textContent='SCAN ativo · TGs configuradas';`);await shot(window,'02-SCAN-ativo.png');
  await run(window,`document.documentElement.dataset.theme='dark';setActiveScreen('ptt');scanEnabled=false;document.getElementById('pttScan').setAttribute('aria-pressed','false');document.getElementById('pttScanLabel').textContent='SCAN pronto · pressione para ativar';gatewayStatus.connected=true;gatewayStatus.pttReady=true;gatewayStatus.rxBusy=false;gatewayStatus.rxSourceId='';ZapDMRHome.setParticipantView('list');ZapDMRHome.setParticipantFontSize('normal');ZapDMRHome.renderParticipants(window.__homePreviewParticipants);ZapDMROperation.reflectTx();`);
  await shot(window,'01-PTT-pronto-lista.png');
  await run(window,`gatewayStatus.rxBusy=true;gatewayStatus.rxSourceId='7240599';ZapDMRHome.renderParticipants(ZapDMRHome.participants());ZapDMROperation.reflectTx();`);await shot(window,'03-RX-ocupado.png');
  await run(window,`gatewayStatus.rxBusy=false;mobilePttActive=true;ZapDMROperation.reflectTx();`);await shot(window,'04-TX-visual-sintetico.png');
  await run(window,`mobilePttActive=false;ZapDMROperation.reflectTx();ZapDMRHome.renderParticipants(window.__homePreviewParticipants);ZapDMRHome.setParticipantView('cards');`);await new Promise(resolve=>setTimeout(resolve,80));await shot(window,'05-Cartoes.png');
  await run(window,`document.getElementById('topSettings').click();window.scrollTo(0,0);`);await new Promise(resolve=>setTimeout(resolve,250));await shot(window,'06-Aparencia.png');
  window.setContentSize(1440,900);await run(window,`document.getElementById('homeButton').click();const selectedId=Number(groupSelected()?.id||724),base=window.__homePreviewParticipants;participants=Array.from({length:24},(_,index)=>index<base.length?({...base[index],talkgroupId:selectedId}):({at:Date.now()-index*31000,sourceId:String(7300000+index),callsign:'T'+String(index).padStart(2,'0')+'BR',name:'Operador '+(index+1),location:'Cidade '+(index+1)+', SP',country:'Brasil',talkgroupId:selectedId,slot:1}));window.__windowsPreviewParticipants=participants;ZapDMROperation.renderParticipants(false);ZapDMRHome.setParticipantView('list');ZapDMRHome.setParticipantFontSize('normal');`);await new Promise(resolve=>setTimeout(resolve,300));await shot(window,'07-Windows-lista.png');
  await run(window,`ZapDMRHome.setParticipantView('cards');`);await new Promise(resolve=>setTimeout(resolve,120));await shot(window,'08-Windows-cartoes.png');
  await run(window,`document.getElementById('topSettings').click();window.scrollTo(0,0);`);await new Promise(resolve=>setTimeout(resolve,180));await shot(window,'09-Windows-aparencia.png');
  window.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
