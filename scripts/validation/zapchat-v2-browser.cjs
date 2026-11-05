const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const output=path.resolve(__dirname,'../../release/zapchat-test-screenshots');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function shot(window,name){const image=await window.webContents.capturePage();await fs.writeFile(path.join(output,name),image.toPNG());}
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true});
  const window=new BrowserWindow({show:false,width:430,height:932,webPreferences:{sandbox:true,contextIsolation:true}});
  window.setContentSize(430,932);await window.loadURL('http://127.0.0.1:4194/');await wait(1200);
  await window.webContents.executeJavaScript(`window.participants=[{callsign:'TEST1B',sourceId:'1000001',at:Date.now()}];window.gatewayStatus={rxBusy:false,rxSourceId:''};window.ZapDMRConsole={getContacts:()=>[{id:1000002,callsign:'TEST1C',name:'Carlos'}]};document.documentElement.dataset.theme='dark';document.getElementById('qa-open').click();`);await wait(5200);
  const inbox=await window.webContents.executeJavaScript(`(()=>{const dialog=document.getElementById('communityDialog'),rows=[...document.querySelectorAll('.chat-conversations:not([hidden]) .zapchat-conversation')],pane=document.querySelector('.zapchat-inbox');return{open:dialog.open,v2:dialog.classList.contains('zapchat-v2'),tabs:document.querySelectorAll('.zapchat-inbox-tabs button').length,rows:rows.length,online:rows[0]?.querySelector('.zapchat-presence')?.classList.contains('online'),radioLabel:rows[0]?.querySelector('.zapchat-conversation-meta small')?.textContent,accountClosed:!document.getElementById('communityAccount').open,inboxVisible:getComputedStyle(pane).display!=='none'&&pane.getBoundingClientRect().height>100};})()`);
  assert(inbox.open&&inbox.v2&&inbox.tabs===2&&inbox.rows>=1&&inbox.online&&inbox.radioLabel==='online'&&inbox.accountClosed&&inbox.inboxVisible);await shot(window,'01-conversas.png');
  const contacts=await window.webContents.executeJavaScript(`(()=>{document.querySelector('[data-zapchat-tab="contacts"]').click();const rows=[...document.querySelectorAll('.zapchat-contacts .zapchat-conversation')],offline=rows.find(row=>row.textContent.includes('TEST1C'));return{rows:rows.length,visible:getComputedStyle(document.querySelector('.zapchat-contacts')).display!=='none',offline:Boolean(offline?.querySelector('.zapchat-presence.offline')),label:offline?.querySelector('.zapchat-conversation-meta small')?.textContent};})()`);assert(contacts.visible&&contacts.rows>=2&&contacts.offline&&contacts.label==='offline');await wait(100);await shot(window,'01b-contatos.png');
  await window.webContents.executeJavaScript(`document.querySelector('[data-zapchat-tab="conversations"]').click()`);
  await window.webContents.executeJavaScript(`document.querySelector('.zapchat-conversation').click()`);await wait(1100);
  const conversation=await window.webContents.executeJavaScript(`(()=>{const dialog=document.getElementById('communityDialog'),chat=document.querySelector('.community-chat');return{hasPeer:dialog.classList.contains('has-peer'),chatVisible:getComputedStyle(chat).display!=='none',inboxHidden:getComputedStyle(document.querySelector('.zapchat-inbox')).display==='none',peer:document.querySelector('.zapchat-peer-identity b')?.textContent,messages:document.querySelectorAll('#communityMessages li').length,qrz:document.querySelector('.zapchat-qrz')?.textContent,back:Boolean(document.querySelector('.zapchat-back'))};})()`);
  assert(conversation.hasPeer&&conversation.chatVisible&&conversation.inboxHidden&&conversation.peer==='TEST1B'&&conversation.messages>=1&&conversation.qrz==='QRZ.com'&&conversation.back);await shot(window,'02-conversa-aberta.png');
  console.log(JSON.stringify({inbox,contacts,conversation}));console.log('PASS: ZapChat 2.0 messenger layout, conversations/contacts tabs, online/offline radio presence, private conversation and QRZ action.');window.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
