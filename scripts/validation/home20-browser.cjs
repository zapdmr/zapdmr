const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:430,height:900,webPreferences:{sandbox:true,contextIsolation:true}});
  await window.loadURL('http://127.0.0.1:4173/?preview=home20');await new Promise(resolve=>setTimeout(resolve,1800));
  const result=await window.webContents.executeJavaScript(`(()=>{
    document.querySelector('.onboarding-dialog[open]')?.close();setActiveScreen('ptt');gatewayStatus.rxBusy=true;gatewayStatus.rxSourceId='7000000';
    const items=Array.from({length:80},(_,index)=>({at:Date.now()-index*1000,sourceId:String(7000000+index),callsign:'T'+String(index).padStart(2,'0')+'ABC',name:'Operador '+index,location:'Cidade '+index,country:'Brasil',talkgroupId:724,slot:1}));items.push({...items[0],at:Date.now()-120000});
    ZapDMRHome.renderParticipants(items);
    const cards=document.getElementById('participantCardsList'),first=cards.querySelector('.participant-card');first.click();
    const modal=document.querySelector('.participant-details-dialog');const modalData={open:modal.open,title:modal.querySelector('#participantDetailsTitle')?.textContent,details:modal.querySelectorAll('.participant-details-list dd').length,historyVisible:![...modal.querySelectorAll('.participant-secondary-actions button')].find(button=>button.textContent.includes('Histórico'))?.hidden};modal.close();
    document.getElementById('participantCompactView').click();
    return {cards:cards.children.length,scrolling:cards.scrollHeight>cards.clientHeight,compact:!document.querySelector('.participant-table-wrap').hidden,cardsHidden:cards.hidden,count:document.getElementById('participantCount').textContent,bottom:document.querySelectorAll('.bottom-nav-button').length,pttBlocked:document.getElementById('ptt').disabled,chatLabel:document.querySelector('.rc-top-contact')?.getAttribute('aria-label'),modalData};
  })()`);
  assert.equal(result.cards,80);assert(result.scrolling);assert(result.compact&&result.cardsHidden);assert.match(result.count,/80 participantes/);assert.equal(result.bottom,4);assert(result.pttBlocked);assert.match(result.chatLabel,/Abrir ZapChat/);assert(result.modalData.open);assert.equal(result.modalData.title,'T00ABC');assert(result.modalData.details>=4);assert(result.modalData.historyVisible);
  console.log('PASS browser UI: 80 Last Heard cards with vertical scroll, Compact toggle, participant details, RX PTT block, four-item navigation and ZapChat header shortcut.');
  window.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
