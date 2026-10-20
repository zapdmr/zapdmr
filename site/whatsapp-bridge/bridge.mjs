import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import makeWASocket,{BufferJSON,DisconnectReason,initAuthCreds,jidNormalizedUser,proto} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';

const here=path.dirname(fileURLToPath(import.meta.url));
const configArg=process.argv.indexOf('--config');
const configPath=path.resolve(configArg>=0?process.argv[configArg+1]:path.join(here,'../../work/whatsapp-bridge/config.dpapi'));
const authPath=path.join(path.dirname(configPath),'session.dpapi');
const lockPath=path.join(path.dirname(configPath),'bridge.lock');
const logger=pino({level:'silent'}),port=4193,host='127.0.0.1';
// libsignal logs entire session objects through console.info/warn. Never persist
// these diagnostics: only fixed, explicitly authored operational lines may leave this process.
const operationalLog=message=>process.stdout.write(message+'\n');
for(const method of ['log','info','warn','debug','error'])console[method]=()=>{};
const localOrigin=`http://${host}:${port}`,controlToken=crypto.randomBytes(32).toString('hex');
if(process.platform!=='win32')throw new Error('Esta ponte exige Windows DPAPI para proteger a sessão.');
function dpapi(mode,value){return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(here,'dpapi.ps1'),'-Mode',mode],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const chunks=[];let bytes=0;const timer=setTimeout(()=>{child.kill();reject(new Error('Não foi possível acessar a proteção do Windows.'));},30000);
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>64*1024*1024){child.kill();return;}chunks.push(chunk);});
  // PowerShell diagnostics may contain private paths; never forward stdout/stderr to logs.
  child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new Error('Proteção do Windows indisponível.'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0||bytes>64*1024*1024)return reject(new Error('Proteção do Windows indisponível para este usuário.'));resolve(Buffer.concat(chunks).toString('utf8'));});
  child.stdin.on('error',()=>{});child.stdin.end(value);
});}
let config;
try{config=JSON.parse(await dpapi('Unprotect',(await fs.readFile(configPath)).toString('base64')));}catch{throw new Error('Não foi possível abrir a configuração privada DPAPI neste usuário do Windows.');}
const origin=String(process.env.WHATSAPP_BRIDGE_ORIGIN||config.origin||'https://www.zapdmr.com.br').replace(/\/$/,'');
const expectedNumber=String(process.env.WHATSAPP_BRIDGE_NUMBER||config.number||'+5543996741200');
const apiToken=String(process.env.WHATSAPP_WEBHOOK_TOKEN||config.token||'');
if(!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(origin)||!/^[+][1-9]\d{7,14}$/.test(expectedNumber)||apiToken.length<32)throw new Error('Configuração privada inválida. Configure origem HTTPS, número e token da ponte.');
await fs.mkdir(path.dirname(authPath),{recursive:true});
// A second process must never open the same WhatsApp session concurrently.
let lock;
try{lock=await fs.open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));}
catch{let alive=true;try{const pid=Number(await fs.readFile(lockPath,'utf8'));if(!Number.isInteger(pid)||pid<1)throw new Error();process.kill(pid,0);}catch{alive=false;}
  if(alive)throw new Error('A ponte já está aberta neste usuário. Use o painel existente.');
  await fs.unlink(lockPath);lock=await fs.open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));}

let stored;
try{stored=JSON.parse(await dpapi('Unprotect',(await fs.readFile(authPath)).toString('base64')),BufferJSON.reviver);}catch(error){if(error.code!=='ENOENT')throw new Error('Sessão protegida ilegível. A sessão existente foi preservada.');}
const auth={creds:stored?.creds||initAuthCreds(),keys:stored?.keys||{}};
let completed=new Map((stored?.completed||[]).filter(item=>Array.isArray(item)&&item[1]>Date.now()-86400000));
let persistence=Promise.resolve(),socket=null,started=false,stopping=false,polling=false,reconnecting=null,qrValue='',qrImage=null,revision=0;
let state={status:'idle',connected:false,number:expectedNumber,message:'Clique em Gerar QR para vincular o WhatsApp do ZapDMR.',qrAvailable:false,lastPollAt:null,lastIncomingAt:null};
function setState(change){state={...state,...change};revision++;}
function failClosed(){started=false;qrValue='';qrImage=null;const old=socket;socket=null;old?.end(new Error('Proteção da sessão indisponível.'));setState({status:'error',connected:false,qrAvailable:false,message:'Não foi possível proteger a sessão no Windows. A ponte foi interrompida.'});}
function persist(){
  const snapshot=JSON.stringify({version:1,creds:auth.creds,keys:auth.keys,completed:[...completed.entries()].slice(-200)},BufferJSON.replacer);
  const task=persistence.then(async()=>{const protectedText=await dpapi('Protect',snapshot);await fs.writeFile(authPath+'.new',Buffer.from(protectedText,'base64'),{mode:0o600});await fs.rename(authPath+'.new',authPath);});
  persistence=task.catch(()=>{failClosed();});return task;
}
const authentication={creds:auth.creds,keys:{
  get:async(type,ids)=>{const values={};for(const id of ids){let value=auth.keys[type]?.[id];if(type==='app-state-sync-key'&&value)value=proto.Message.AppStateSyncKeyData.fromObject(value);values[id]=value;}return values;},
  set:async(data)=>{for(const [type,values]of Object.entries(data)){auth.keys[type]??={};for(const [id,value]of Object.entries(values)){if(value)auth.keys[type][id]=value;else delete auth.keys[type][id];}}await persist();}
}};
async function api(route,payload){
  const response=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiToken},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw new Error('Serviço de confirmação indisponível.');
  if(!String(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Resposta do serviço inválida.');
  return response.json();
}
async function heartbeat(connected){try{await api('/v1/whatsapp/bridge/heartbeat',{number:expectedNumber,connected});}catch{if(connected)setState({message:'WhatsApp conectado. Não foi possível atualizar o servidor; tentando novamente.'});}}
function sessionNumber(sock){const jid=jidNormalizedUser(sock.user?.id||auth.creds.me?.id||'');return /^\d+@s\.whatsapp\.net$/.test(jid)?'+'+jid.split('@')[0]:null;}
function sameOfficialNumber(number){
  if(number===expectedNumber)return true;
  const mobile=expectedNumber.match(/^(\+55\d{2})9([6-9]\d{7})$/),legacy=expectedNumber.match(/^(\+55\d{2})([6-9]\d{7})$/);
  return Boolean(mobile&&number===mobile[1]+mobile[2]||legacy&&number===legacy[1]+'9'+legacy[2]);
}
function stopConnection(message='Ponte pausada. Clique em Gerar QR / conectar para retomar.'){
  started=false;clearTimeout(reconnecting);reconnecting=null;qrValue='';qrImage=null;const old=socket;socket=null;old?.end(new Error('Ponte pausada pelo operador.'));setState({status:'paused',connected:false,qrAvailable:false,message});void heartbeat(false);
}
async function incoming(event,sock){
  if(!state.connected||socket!==sock||!sameOfficialNumber(sessionNumber(sock))||event.type!=='notify')return;
  for(const message of event.messages||[]){
    if(message.key?.fromMe)continue;
    const primary=String(message.key?.remoteJid||''),alternate=String(message.key?.remoteJidAlt||''),senderPn=String(message.key?.senderPn||'');
    // No groups, status broadcasts, histories, attachments, calls or arbitrary conversations.
    if(primary.includes('@g.us')||primary.includes('@broadcast')||primary==='status@broadcast')continue;
    const jid=[senderPn,primary,alternate].map(jidNormalizedUser).find(value=>/^\d+@s\.whatsapp\.net$/.test(value));
    if(!jid)continue;
    let content=message.message;
    for(let depth=0;depth<3&&content?.ephemeralMessage?.message;depth++)content=content.ephemeralMessage.message;
    const text=String(content?.conversation||content?.extendedTextMessage?.text||'').trim();
    if(!/^ZapDMR CONFIRMAR [A-Za-z0-9_-]{43} \d{6}$/i.test(text))continue;
    const number='+'+jid.split('@')[0];
    try{const result=await api('/v1/whatsapp/webhook',{number,text});setState({lastIncomingAt:Date.now(),message:result.confirmed===false?'Mensagem recebida. O servidor não confirmou um desafio válido para este remetente.':'Confirmação recebida e encaminhada ao ZapDMR.'});}
    catch{setState({message:'Não foi possível encaminhar uma confirmação. O usuário pode reenviar a mensagem pronta.'});}
  }
}
async function connect(){
  if(stopping||socket)return;
  started=true;setState({status:'connecting',connected:false,message:'Conectando ao WhatsApp para gerar o QR…'});
  const sock=makeWASocket({auth:authentication,logger,browser:['ZapDMR','Chrome','1.0.0'],printQRInTerminal:false,syncFullHistory:false,shouldSyncHistoryMessage:()=>false,markOnlineOnConnect:false,emitOwnEvents:false,getMessage:async()=>undefined,generateHighQualityLinkPreview:false,connectTimeoutMs:20000,defaultQueryTimeoutMs:20000,shouldIgnoreJid:jid=>jid.endsWith('@g.us')||jid.endsWith('@broadcast')});
  socket=sock;
  sock.ev.on('creds.update',update=>{Object.assign(auth.creds,update);void persist().catch(()=>{});});
  sock.ev.on('messages.upsert',event=>{void incoming(event,sock).catch(()=>{});});
  sock.ev.on('connection.update',update=>{void (async()=>{
    if(socket!==sock||stopping)return;
    if(update.qr){qrValue=update.qr;const image=await QRCode.toBuffer(qrValue,{type:'png',errorCorrectionLevel:'M',width:420,margin:3});if(socket!==sock)return;qrImage=image;setState({status:'qr',connected:false,qrAvailable:true,message:'No WhatsApp do número indicado, abra Aparelhos conectados → Conectar aparelho e escaneie o QR.'});}
    if(update.connection==='open'){
      const actual=sessionNumber(sock);qrValue='';qrImage=null;
      if(!sameOfficialNumber(actual)){started=false;socket=null;sock.end(new Error('Número vinculado diferente do configurado.'));setState({status:'wrong-number',connected:false,qrAvailable:false,message:'O WhatsApp vinculado não corresponde ao número oficial. A sessão foi preservada e a ponte foi interrompida.'});await heartbeat(false);return;}
      setState({status:'connected',connected:true,qrAvailable:false,message:'WhatsApp oficial conectado. A ponte está pronta para códigos e confirmações.'});await persist().catch(()=>{});await heartbeat(state.connected);if(state.connected)void poll();
    }
    if(update.connection==='close'){
      const code=update.lastDisconnect?.error?.output?.statusCode;socket=null;qrValue='';qrImage=null;setState({connected:false,qrAvailable:false,status:code===DisconnectReason.loggedOut?'logged-out':'reconnecting',message:code===DisconnectReason.loggedOut?'A vinculação foi encerrada no WhatsApp. A sessão foi preservada; reinicie com uma nova configuração de sessão.':'Conexão interrompida. A ponte tentará reconectar.'});void heartbeat(false);
      if(code===DisconnectReason.loggedOut){started=false;return;}
      if(started&&!stopping){clearTimeout(reconnecting);reconnecting=setTimeout(()=>{void connect().catch(()=>setState({status:'error',message:'Não foi possível reconectar. Clique em Gerar QR / conectar.'}));},3000);}
    }
  })().catch(()=>{if(socket===sock)stopConnection('Não foi possível atualizar a conexão. Clique em Gerar QR / conectar para tentar novamente.');});});
}
const otpText=/^\*ZapDMR:\* Olá [A-Z0-9]{3,8}, seu código de confirmação de 6 dígitos é: \*\d{6}\*\. Forte 73!$/;
async function poll(){
  if(polling||stopping||!state.connected||!socket||!sameOfficialNumber(sessionNumber(socket)))return;
  polling=true;
  try{
    const result=await api('/v1/whatsapp/bridge/outbox',{number:expectedNumber,connected:true});
    if(!Array.isArray(result.jobs))throw new Error();
    setState({lastPollAt:Date.now(),message:'WhatsApp oficial conectado. Aguardando solicitações de confirmação.'});
    for(const job of result.jobs.slice(0,5)){
      if(!state.connected||!socket)break;
      const id=String(job.id||''),number=String(job.number||''),text=String(job.text||''),leaseId=String(job.leaseId||'');
      if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!/^[A-Za-z0-9_-]{1,128}$/.test(leaseId)||!/^[+][1-9]\d{7,14}$/.test(number)||!otpText.test(text)){if(id&&leaseId)await api('/v1/whatsapp/bridge/ack',{id,status:'failed',leaseId}).catch(()=>{});continue;}
      if(completed.has(id)){await api('/v1/whatsapp/bridge/ack',{id,status:'sent',leaseId}).catch(()=>{});continue;}
      try{
        await socket.sendMessage(number.slice(1)+'@s.whatsapp.net',{text});
        completed.set(id,Date.now());for(const [key,at]of completed)if(at<Date.now()-86400000)completed.delete(key);while(completed.size>200)completed.delete(completed.keys().next().value);
        await persist();await api('/v1/whatsapp/bridge/ack',{id,status:'sent',leaseId});
      }catch{if(!completed.has(id))await api('/v1/whatsapp/bridge/ack',{id,status:'failed',leaseId}).catch(()=>{});setState({message:'Houve uma falha de entrega ou confirmação. A fila será consultada novamente.'});}
    }
  }catch{setState({message:'WhatsApp conectado. A fila do servidor está indisponível; tentando novamente.'});}
  finally{polling=false;}
}

const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZapDMR · Conectar WhatsApp</title><link rel="stylesheet" href="/panel.css"></head><body><main><span class="label">ZAPDMR · PONTE LOCAL</span><h1>Conectar WhatsApp</h1><p>Use somente o WhatsApp do número oficial <strong id="number"></strong>.</p><p id="state" role="status">Carregando…</p><div id="qrbox" hidden><img id="qr" alt="QR para vincular o WhatsApp oficial"><p>WhatsApp → Aparelhos conectados → Conectar aparelho</p></div><div class="actions"><button id="connect">Gerar QR / conectar</button><button id="pause" class="secondary">Pausar ponte</button></div><p class="note">Este painel funciona apenas neste computador. Mantenha a ponte e a conexão de internet ativas para enviar os códigos. A sessão fica cifrada com proteção do Windows. Mensagens pessoais não são arquivadas pela ponte.</p><p class="note">A integração usa Baileys, um cliente independente e sem vínculo oficial com a Meta.</p></main><script src="/panel.js" data-token="${controlToken}"></script></body></html>`;
const css=`:root{font:16px/1.55 system-ui;color:#17392f;background:#edf6f1}body{margin:0;padding:24px}main{max-width:650px;margin:20px auto;padding:30px;background:white;border:1px solid #d4e5dc;border-radius:22px}h1{font-size:2rem;margin:.4em 0}.label{color:#087c50;letter-spacing:.13em;font-size:.75rem;font-weight:800}.actions{display:flex;flex-wrap:wrap;gap:12px}button{padding:14px 20px;background:#098957;color:white;border:0;border-radius:12px;cursor:pointer;font:inherit;font-weight:700}button.secondary{background:#e8f2ed;color:#20573f}button:disabled{opacity:.55;cursor:wait}.note{font-size:.85rem;color:#607b6f;margin-top:24px}#state{background:#e8f6ee;padding:16px;border-radius:12px}#qrbox{text-align:center}img{width:min(100%,420px);height:auto}`;
const js=`const token=document.currentScript.dataset.token;let previous=-1;const state=document.getElementById('state'),qr=document.getElementById('qr'),box=document.getElementById('qrbox');async function refresh(){try{const response=await fetch('/status',{cache:'no-store'});const value=await response.json();state.textContent=value.message;document.getElementById('number').textContent=value.number;box.hidden=!value.qrAvailable;if(value.qrAvailable&&value.revision!==previous)qr.src='/qr?v='+value.revision;previous=value.revision;}catch{state.textContent='A ponte foi encerrada. Abra novamente para continuar.';box.hidden=true;}}async function control(action){const button=document.getElementById(action);button.disabled=true;try{const response=await fetch('/control',{method:'POST',headers:{'Content-Type':'application/json','X-ZapDMR-Control':token},body:JSON.stringify({action})});if(!response.ok)state.textContent='Não foi possível executar a ação. Tente novamente.';}finally{button.disabled=false;await refresh();}}document.getElementById('connect').onclick=()=>control('connect');document.getElementById('pause').onclick=()=>control('pause');refresh();setInterval(refresh,2000);`;
const server=http.createServer(async(req,res)=>{
  const allowedHost=[`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host);
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  if(!allowedHost){res.writeHead(403);return res.end('Origem não autorizada.');}
  const route=new URL(req.url,localOrigin).pathname;
  function response(code,type,value){res.writeHead(code,{'Content-Type':type});res.end(value);}
  if(req.method==='GET'&&route==='/')return response(200,'text/html; charset=utf-8',html);
  if(req.method==='GET'&&route==='/panel.css')return response(200,'text/css; charset=utf-8',css);
  if(req.method==='GET'&&route==='/panel.js')return response(200,'application/javascript; charset=utf-8',js);
  if(req.method==='GET'&&route==='/status')return response(200,'application/json',JSON.stringify({...state,revision}));
  if(req.method==='GET'&&route==='/qr')return qrImage?response(200,'image/png',qrImage):response(404,'text/plain; charset=utf-8','QR ainda não disponível.');
  if(req.method==='POST'&&route==='/control'){
    if(![localOrigin,`http://localhost:${port}`].includes(req.headers.origin)||req.headers['x-zapdmr-control']!==controlToken)return response(403,'text/plain','Origem não autorizada.');
    try{let text='';for await(const chunk of req){text+=chunk;if(text.length>512)throw new Error();}const command=JSON.parse(text);
      if(command.action==='pause')stopConnection();else if(command.action==='connect')await connect();else throw new Error();return response(200,'application/json','{"ok":true}');
    }catch{return response(400,'application/json','{"message":"Não foi possível iniciar esta ação."}');}
  }
  return response(404,'text/plain; charset=utf-8','Recurso não encontrado.');
});
server.headersTimeout=10000;server.requestTimeout=15000;
const pollTimer=setInterval(()=>{if(state.connected)void poll();},5000);
server.on('error',async()=>{clearInterval(pollTimer);await lock.close().catch(()=>{});await fs.unlink(lockPath).catch(()=>{});operationalLog('Não foi possível abrir o painel local da ponte.');process.exit(1);});
server.listen(port,host,()=>{
  operationalLog(`ZapDMR WhatsApp: ${localOrigin}`);
  // Baileys 6.7.24 QR pairing persists `me` and the signed account, but does
  // not set `registered=true`. Its own socket uses `creds.me` for resuming.
  // Require both pairing artifacts and the official number; never resume
  // a fresh initAuthCreds state or a session belonging to another account.
  const paired=Boolean(auth.creds.me?.id&&auth.creds.account);
  if(paired&&sameOfficialNumber(sessionNumber({user:auth.creds.me})))void connect().catch(()=>setState({status:'error',message:'Não foi possível retomar a sessão. Use Gerar QR / conectar.'}));
});
async function shutdown(){if(stopping)return;stopping=true;clearInterval(pollTimer);stopConnection('Ponte encerrada.');await heartbeat(false);await persistence.catch(()=>{});server.close();await lock.close().catch(()=>{});await fs.unlink(lockPath).catch(()=>{});process.exit(0);}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown();});
