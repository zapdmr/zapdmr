import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {renderPublicPage,sitemap,publicPagePaths} from './public-pages.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),prod=process.env.NODE_ENV==='production';
const dataDir=path.resolve(process.env.DATA_DIR||path.join(root,'data')),downloadDir=path.resolve(process.env.DOWNLOAD_DIR||path.join(root,'private/downloads'));
fs.mkdirSync(dataDir,{recursive:true,mode:0o700});fs.mkdirSync(downloadDir,{recursive:true,mode:0o700});
const origin=process.env.PUBLIC_ORIGIN||'http://localhost:3000';
const loopback=value=>['localhost','127.0.0.1','::1','[::1]','::ffff:127.0.0.1'].includes(String(value||'').toLowerCase());
const developmentOtp=process.env.OTP_MODE==='development';
if(developmentOtp&&(prod||!loopback(new URL(origin).hostname)||!loopback(process.env.HOST||'127.0.0.1')))throw new Error('OTP_MODE=development exige ambiente não produtivo com origem e escuta em localhost.');
const pageOptions={origin,owner:process.env.OWNER_NAME,privacyEmail:process.env.PRIVACY_EMAIL,production:prod,assetsVersion:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public/site.js'))).update(fs.readFileSync(path.join(root,'public/site.css'))).digest('hex').slice(0,12)};
if(prod&&(!/^https:\/\/[a-z0-9.-]+$/i.test(origin)||!process.env.OWNER_NAME||!process.env.PRIVACY_EMAIL))throw new Error('Configure PUBLIC_ORIGIN HTTPS, OWNER_NAME e PRIVACY_EMAIL antes de publicar.');
function secret(name){let value=process.env[name];if(!value&&!prod){const file=path.join(dataDir,name.toLowerCase()+'.key');if(!fs.existsSync(file))fs.writeFileSync(file,crypto.randomBytes(32).toString('hex'),{mode:0o600});value=fs.readFileSync(file,'utf8').trim();}if(!/^[a-f\d]{64}$/i.test(value||''))throw new Error(`Configure ${name} com 64 caracteres hexadecimais.`);return Buffer.from(value,'hex');}
const key=secret('DATA_ENCRYPTION_KEY'),downloadKey=secret('DOWNLOAD_SECRET');
if(prod&&crypto.timingSafeEqual(key,downloadKey))throw new Error('DATA_ENCRYPTION_KEY e DOWNLOAD_SECRET devem ser segredos diferentes.');
if(prod&&(process.env.ADMIN_PASSWORD||'').length<16)throw new Error('Configure ADMIN_PASSWORD com pelo menos 16 caracteres.');
// Visible development codes always use their own database, never the production accounts.
const db=new DatabaseSync(path.join(dataDir,developmentOtp?'zapdmr-development.sqlite':'zapdmr.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,callsign TEXT NOT NULL,dmr_id TEXT NOT NULL,phone_cipher TEXT NOT NULL,phone_hash TEXT NOT NULL,share_phone INTEGER NOT NULL,platform TEXT NOT NULL,created_at INTEGER NOT NULL,notice_version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,callsign TEXT UNIQUE NOT NULL,dmr_id TEXT UNIQUE NOT NULL,phone_cipher TEXT NOT NULL,phone_hash TEXT NOT NULL,share_phone INTEGER NOT NULL,created_at INTEGER NOT NULL,verified_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS codes(registration_id TEXT PRIMARY KEY REFERENCES registrations(id) ON DELETE CASCADE,hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,sender TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,recipient TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,body_cipher TEXT NOT NULL,at INTEGER NOT NULL,read_at INTEGER);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(sender,recipient,at);
CREATE INDEX IF NOT EXISTS messages_receipts ON messages(sender,recipient,read_at,id);
CREATE INDEX IF NOT EXISTS messages_at_cursor ON messages(at,id);
CREATE INDEX IF NOT EXISTS messages_read_cursor ON messages(read_at,id);
CREATE TABLE IF NOT EXISTS blocks(owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,peer TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(owner,peer));`);
for(const [table,columns]of Object.entries({registrations:{whatsapp_verified:'INTEGER NOT NULL DEFAULT 0',verified_at:'INTEGER'},users:{whatsapp_verified:'INTEGER NOT NULL DEFAULT 1',verification_method:"TEXT NOT NULL DEFAULT 'direct'"},codes:{requested_at:'INTEGER NOT NULL DEFAULT 0',mode:"TEXT NOT NULL DEFAULT 'direct'",challenge_hash:'TEXT',reverse_confirmed_at:'INTEGER'}})){
  const present=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column=>column.name));
  for(const [name,type]of Object.entries(columns))if(!present.has(name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS codes_challenge ON codes(challenge_hash) WHERE challenge_hash IS NOT NULL;');
const hash=value=>crypto.createHmac('sha256',key).update(value).digest('hex');
const seal=value=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,encrypted,cipher.getAuthTag()]).toString('base64');};
function unseal(value){const data=Buffer.from(value,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(-16));return Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString('utf8');}
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const phone=value=>{const normalized=String(value||'').replace(/[\s().-]/g,'');if(!/^\+[1-9]\d{7,14}$/.test(normalized))throw Object.assign(new Error('Informe WhatsApp com +DDI, DDD e número (ex.: +5543999999999).'),{status:400});return normalized;};
const callsign=value=>{const text=String(value||'').trim().toUpperCase();if(!/^[A-Z0-9]{3,8}$/.test(text)||!/[A-Z]/.test(text)||!/[0-9]/.test(text))throw Object.assign(new Error('Indicativo inválido.'),{status:400});return text;};
const radioId=value=>{const text=String(value||'');if(!/^\d{7}$/.test(text)||Number(text)>0xffffff)throw Object.assign(new Error('DMR ID deve conter 7 dígitos válidos.'),{status:400});return text;};
const limits=new Map(),waiters=new Map();
function rate(req,bucket,max=60,period=60000){const address=process.env.TRUST_LOCAL_PROXY==='1'&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)?String(req.headers['x-real-ip']||req.socket.remoteAddress):req.socket.remoteAddress;const id=bucket+':'+address,now=Date.now(),current=limits.get(id)||{n:0,until:now+period};if(now>current.until){current.n=0;current.until=now+period;}current.n++;limits.set(id,current);if(current.n>max)throw Object.assign(new Error('Muitas tentativas. Aguarde alguns minutos.'),{status:429});}
function json(res,status,value){if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){
  if(!/^application\/json(?:\s*;|\s*$)/i.test(String(req.headers['content-type']||'')))throw Object.assign(new Error('Envie o pedido como application/json.'),{status:415});
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)throw Object.assign(new Error('Pedido demasiado grande.'),{status:413});chunks.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8')||'{}');}catch{throw Object.assign(new Error('JSON inválido.'),{status:400});}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('O pedido JSON deve ser um objeto.'),{status:400});
  return value;
}
function user(req){const token=String(req.headers.authorization||'').replace(/^Bearer /,'');if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Object.assign(new Error('Entre na comunidade com o código recebido no seu número.'),{status:401});const row=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>?').get(hash(token),Date.now());if(!row)throw Object.assign(new Error('Sessão expirada. Confirme novamente o número.'),{status:401});return row;}
const publicUser=(row,own=false)=>({id:row.id,callsign:row.callsign,dmrId:row.dmr_id,verified:Boolean(row.whatsapp_verified),whatsappVerified:Boolean(row.whatsapp_verified),whatsapp_verified:Boolean(row.whatsapp_verified),verificationMethod:row.verification_method,sharePhone:Boolean(row.share_phone),...(own||row.share_phone?{whatsapp:unseal(row.phone_cipher)}:{})});
function installer(platform){return {android:'ZapDMR-Android.apk',windows:'ZapDMR-Windows.exe'}[platform];}
function downloadToken(id,platform){const value=Buffer.from(JSON.stringify({id,platform,expires:Date.now()+900000})).toString('base64url'),signature=crypto.createHmac('sha256',downloadKey).update(value).digest('base64url');return value+'.'+signature;}
function streamFile(file,res){const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}
function download(req,res,token){const [value,signature]=token.split('.');if(!value||!signature||!safeEqual(signature,crypto.createHmac('sha256',downloadKey).update(value).digest('base64url')))return json(res,403,{message:'Link de download inválido.'});let data;try{data=JSON.parse(Buffer.from(value,'base64url').toString());}catch{return json(res,403,{message:'Link inválido.'});}if(data.expires<Date.now()||!db.prepare('SELECT id FROM registrations WHERE id=? AND verified_at IS NOT NULL').get(data.id))return json(res,403,{message:'O link expirou ou o número ainda não foi confirmado. Confirme novamente.'});const name=installer(data.platform);if(!name)return json(res,404,{message:'Plataforma inválida.'});const file=path.join(downloadDir,name);if(!fs.existsSync(file))return json(res,404,{message:'Instalador ainda não publicado.'});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${name}"`,'Content-Length':fs.statSync(file).size,'Cache-Control':'private, no-store'});streamFile(file,res);}
function rowMessage(row,own){return {id:row.id,from:row.sender,to:row.recipient,text:unseal(row.body_cipher),at:row.at,readAt:row.read_at,direction:row.sender===own?'out':'in',state:row.read_at?'read':'sent'};}
function messages(own,peer,after=0){return db.prepare('SELECT * FROM messages WHERE ((sender=? AND recipient=?) OR (sender=? AND recipient=?)) AND at>=? ORDER BY at,id LIMIT 100').all(own,peer,peer,own,after).map(row=>rowMessage(row,own));}
function cursor(value){const number=Number(value);return Number.isSafeInteger(number)&&number>=0?number:0;}
function messageBatch(own,peer,after,receiptAfter,includeReceipts){
  const rows=messages(own,peer,after),receipts=includeReceipts?db.prepare('SELECT id,read_at AS readAt FROM messages WHERE sender=? AND recipient=? AND read_at>=? ORDER BY read_at,id LIMIT 100').all(own,peer,receiptAfter):[];
  return {messages:rows,receipts,nextReceiptCursor:receipts.length?receipts[receipts.length-1].readAt+1:receiptAfter};
}
function nextMessageAt(){return Math.max(Date.now(),Number(db.prepare('SELECT MAX(at) AS at FROM messages').get().at||0)+1);}
function markRead(own,peer){
  db.exec('BEGIN IMMEDIATE');
  try{
    const rows=db.prepare('SELECT id FROM messages WHERE recipient=? AND sender=? AND read_at IS NULL ORDER BY at,id').all(own,peer);
    let readAt=Math.max(Date.now(),Number(db.prepare('SELECT MAX(read_at) AS at FROM messages').get().at||0)+1),changed=0;
    const update=db.prepare('UPDATE messages SET read_at=? WHERE id=? AND read_at IS NULL');
    for(const row of rows){changed+=Number(update.run(readAt++,row.id).changes);}
    db.exec('COMMIT');return changed;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
function wake(id){for(const item of waiters.get(id)||[])item();waiters.delete(id);}
function deliveryConfiguration(){
  const whatsappUrl=String(process.env.WHATSAPP_API_URL||''),whatsappToken=String(process.env.WHATSAPP_API_TOKEN||'');
  const legacyUrl=String(process.env.OTP_DELIVERY_URL||''),legacyToken=String(process.env.OTP_DELIVERY_TOKEN||'');
  let reverseNumber='';try{reverseNumber=phone(process.env.WHATSAPP_CONFIRM_NUMBER);}catch{}
  return {direct:/^https:\/\//i.test(whatsappUrl)&&Boolean(whatsappToken)?{url:whatsappUrl,token:whatsappToken,whatsapp:true}:!whatsappUrl&&!whatsappToken&&/^https:\/\//i.test(legacyUrl)&&Boolean(legacyToken)?{url:legacyUrl,token:legacyToken,whatsapp:false}:null,reverse:reverseNumber&&(process.env.WHATSAPP_WEBHOOK_TOKEN||'').length>=32?reverseNumber:null};
}
function challengeResult(row,challengeToken,code){
  const mode=row.mode||'unavailable',expiresInSeconds=Math.max(0,Math.ceil((row.expires_at-Date.now())/1000)),retryAfterSeconds=Math.max(0,Math.ceil((row.requested_at+60000-Date.now())/1000));
  const result={mode,sent:mode==='direct',expiresInSeconds,retryAfterSeconds,message:mode==='direct'?'Código enviado. Confira as mensagens no seu número de WhatsApp.':mode==='reverse'?'Abra o WhatsApp e envie a mensagem pronta para confirmar que este número é seu. Depois volte ao ZapDMR.':mode==='development'?'Homologação local: este código não confirma um número real de WhatsApp.':'O envio de códigos ainda precisa ser configurado pelo responsável. Nenhum número foi confirmado.'};
  if(challengeToken)result.challengeToken=challengeToken;
  if(mode==='reverse'&&challengeToken&&code){result.displayCode=code;result.whatsappUrl=`https://wa.me/${deliveryConfiguration().reverse.slice(1)}?text=${encodeURIComponent(`ZapDMR CONFIRMAR ${challengeToken} ${code}`)}`;}
  if(mode==='development'&&code)result.displayCode=code;
  return result;
}
function registrationIdentity(row){
  const prior=db.prepare('SELECT * FROM users WHERE callsign=? OR dmr_id=?').all(row.callsign,row.dmr_id);
  if(prior.some(user=>user.phone_hash!==row.phone_hash||user.callsign!==row.callsign||user.dmr_id!==row.dmr_id))throw Object.assign(new Error('Este indicativo ou DMR ID já possui uma conta. Use o número existente ou contacte o responsável.'),{status:409});
  return prior[0];
}
async function issueChallenge(req,row){
  registrationIdentity(row);
  const now=Date.now(),prior=db.prepare('SELECT * FROM codes WHERE registration_id=?').get(row.id),phoneLimitKey='otp-phone:'+row.phone_hash,previousDelivery=limits.get(phoneLimitKey);
  if((prior&&prior.requested_at+60000>now)||(previousDelivery&&previousDelivery.until>now))throw Object.assign(new Error('Aguarde 60 segundos antes de pedir outro código para este número.'),{status:429});
  limits.set(phoneLimitKey,{n:1,until:now+60000});
  const configuration=deliveryConfiguration(),code=String(crypto.randomInt(100000,1000000)),challengeToken=crypto.randomBytes(32).toString('base64url');
  db.prepare("INSERT INTO codes(registration_id,hash,expires_at,attempts,requested_at,mode,challenge_hash,reverse_confirmed_at) VALUES(?,?,?,0,?,'pending',?,NULL) ON CONFLICT(registration_id) DO UPDATE SET hash=excluded.hash,expires_at=excluded.expires_at,attempts=0,requested_at=excluded.requested_at,mode=excluded.mode,challenge_hash=excluded.challenge_hash,reverse_confirmed_at=NULL").run(row.id,hash(row.id+':'+code),now+600000,now,hash(challengeToken));
  let mode='unavailable';
  if(configuration.direct){
    const direct=configuration.direct,number=unseal(row.phone_cipher),text=`*ZapDMR:* Olá ${row.callsign}, seu código de confirmação de 6 dígitos é: *${code}*. Forte 73!`;
    try{const sent=await fetch(direct.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+direct.token},body:JSON.stringify(direct.whatsapp?{number,text}:{phone:number,code,expiresInSeconds:600}),signal:AbortSignal.timeout(12000)});if(sent.ok)mode='direct';}catch{}
  }
  if(mode!=='direct'&&configuration.reverse)mode='reverse';
  if(mode==='unavailable'&&developmentOtp&&loopback(req.socket.remoteAddress))mode='development';
  db.prepare('UPDATE codes SET mode=? WHERE registration_id=? AND challenge_hash=?').run(mode,row.id,hash(challengeToken));
  return challengeResult({...db.prepare('SELECT * FROM codes WHERE registration_id=?').get(row.id),mode},challengeToken,code);
}
function challengeStatus(raw){
  const row=db.prepare('SELECT * FROM codes WHERE registration_id=?').get(String(raw.registrationId||'')),challengeToken=String(raw.challengeToken||'');
  if(!row||!/^[A-Za-z0-9_-]{43}$/.test(challengeToken)||!row.challenge_hash||!safeEqual(row.challenge_hash,hash(challengeToken)))throw Object.assign(new Error('Confirmação não encontrada. Solicite outro código.'),{status:404});
  const expired=row.expires_at<=Date.now()||row.attempts>=5;
  return {status:expired?'expired':row.mode==='reverse'&&row.reverse_confirmed_at?'confirmed':'pending',...challengeResult(row)};
}
async function receiveWhatsApp(req,res){
  const secret=String(process.env.WHATSAPP_WEBHOOK_TOKEN||''),provided=String(req.headers.authorization||'');
  if(secret.length<32||!safeEqual(provided,'Bearer '+secret))throw Object.assign(new Error('Autenticação do webhook necessária.'),{status:401});
  rate(req,'whatsapp-webhook',120);const raw=await body(req),match=String(raw.text||'').trim().match(/^ZapDMR CONFIRMAR ([A-Za-z0-9_-]{43}) (\d{6})$/i);
  if(!match)return json(res,200,{accepted:false});
  let number;try{const supplied=String(raw.number||'');number=phone(supplied.startsWith('+')?supplied:'+'+supplied);}catch{return json(res,200,{accepted:false});}
  const row=db.prepare("SELECT c.*,r.phone_hash FROM codes c JOIN registrations r ON r.id=c.registration_id WHERE c.challenge_hash=? AND c.mode='reverse'").get(hash(match[1]));
  if(!row||row.expires_at<=Date.now()||row.attempts>=5||!safeEqual(row.phone_hash,hash(number))||!safeEqual(row.hash,hash(row.registration_id+':'+match[2])))return json(res,200,{accepted:false});
  db.prepare("UPDATE codes SET reverse_confirmed_at=COALESCE(reverse_confirmed_at,?) WHERE registration_id=? AND challenge_hash=? AND mode='reverse' AND expires_at>? AND attempts<5").run(Date.now(),row.registration_id,row.challenge_hash,Date.now());
  return json(res,200,{accepted:true});
}
async function api(req,res,url){
  const route=url.pathname;
  if(route==='/v1/status'&&req.method==='GET'){const configuration=deliveryConfiguration();return json(res,200,{version:'1.3.1',registration:true,verificationConfigured:Boolean(configuration.direct||configuration.reverse||developmentOtp),verificationMode:configuration.direct?'direct':configuration.reverse?'reverse':developmentOtp?'development':'unavailable',verificationRequired:true,downloadRequiresVerification:true,developmentMode:developmentOtp,owner:process.env.OWNER_NAME||'Responsável a configurar',privacyEmail:process.env.PRIVACY_EMAIL||null,downloads:Object.fromEntries(['android','windows'].map(platform=>{const file=path.join(downloadDir,installer(platform));return [platform,fs.existsSync(file)?{available:true,bytes:fs.statSync(file).size}: {available:false}];}))});}
  if(route==='/v1/whatsapp/webhook'&&req.method==='POST')return receiveWhatsApp(req,res);
  if(route==='/v1/registrations'&&req.method==='POST'){
    rate(req,'registration',10,3600000);const raw=await body(req);if(raw.noticeAccepted!==true)throw Object.assign(new Error('Leia e aceite a utilização dos dados para o cadastro.'),{status:400});const call=callsign(raw.callsign),id=radioId(raw.dmrId),number=phone(raw.whatsapp),platform=raw.platform==='windows'?'windows':'android',registrationId=crypto.randomUUID();
    db.prepare('INSERT INTO registrations(id,callsign,dmr_id,phone_cipher,phone_hash,share_phone,platform,created_at,notice_version) VALUES(?,?,?,?,?,?,?,?,?)').run(registrationId,call,id,seal(number),hash(number),raw.sharePhone===true?1:0,platform,Date.now(),'2026-10-20');
    const available=fs.existsSync(path.join(downloadDir,installer(platform))),row=db.prepare('SELECT * FROM registrations WHERE id=?').get(registrationId),challenge=raw.requestVerification===true?await issueChallenge(req,row):undefined;
    return json(res,201,{registrationId,verified:false,verificationRequired:true,downloadAvailable:available,downloadUrl:null,...(challenge?{challenge}:{}),message:'Cadastro recebido. Confirme o seu WhatsApp para liberar o download e o ZapChat.'});
  }
  if(route==='/v1/auth/request-code'&&req.method==='POST'){
    rate(req,'otp',5,600000);const raw=await body(req),row=db.prepare('SELECT * FROM registrations WHERE id=?').get(String(raw.registrationId||''));if(!row)throw Object.assign(new Error('Faça primeiro o cadastro.'),{status:404});
    return json(res,200,await issueChallenge(req,row));
  }
  if(route==='/v1/auth/status'&&req.method==='POST'){rate(req,'otp-status',120);return json(res,200,challengeStatus(await body(req)));}
  if(route==='/v1/auth/verify'&&req.method==='POST'){
    rate(req,'verify',20,600000);const raw=await body(req),row=db.prepare('SELECT r.*,c.hash AS code_hash,c.expires_at,c.attempts,c.mode,c.challenge_hash,c.reverse_confirmed_at FROM registrations r JOIN codes c ON c.registration_id=r.id WHERE r.id=?').get(String(raw.registrationId||''));
    if(!row||row.expires_at<=Date.now()||row.attempts>=5||!['direct','reverse','development'].includes(row.mode))throw Object.assign(new Error('Código expirado ou indisponível. Solicite outro.'),{status:401});
    if(row.mode==='reverse'&&(!/^[A-Za-z0-9_-]{43}$/.test(String(raw.challengeToken||''))||!safeEqual(row.challenge_hash||'',hash(String(raw.challengeToken)))||!row.reverse_confirmed_at))throw Object.assign(new Error('Envie primeiro a mensagem pronta pelo WhatsApp do número cadastrado. A confirmação precisa chegar ao servidor.'),{status:401});
    if(row.mode==='development'&&(!developmentOtp||!loopback(req.socket.remoteAddress)))throw Object.assign(new Error('Homologação permitida somente neste servidor local.'),{status:403});
    db.prepare('UPDATE codes SET attempts=attempts+1 WHERE registration_id=?').run(row.id);if(!/^\d{6}$/.test(String(raw.code||''))||!safeEqual(hash(row.id+':'+String(raw.code)),row.code_hash))throw Object.assign(new Error('Código incorreto.'),{status:401});
    const existing=registrationIdentity(row),id=existing?.id||crypto.randomUUID(),now=Date.now(),isVerified=row.mode==='development'?0:1,token=crypto.randomBytes(32).toString('base64url');
    db.exec('BEGIN IMMEDIATE');
    try{
      if(!existing)db.prepare('INSERT INTO users(id,callsign,dmr_id,phone_cipher,phone_hash,share_phone,created_at,verified_at,whatsapp_verified,verification_method) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,row.callsign,row.dmr_id,row.phone_cipher,row.phone_hash,row.share_phone,now,now,isVerified,row.mode);
      else db.prepare('UPDATE users SET share_phone=?,verified_at=?,whatsapp_verified=?,verification_method=? WHERE id=?').run(row.share_phone,now,isVerified,row.mode,id);
      db.prepare('UPDATE registrations SET whatsapp_verified=?,verified_at=? WHERE id=?').run(isVerified,now,row.id);
      if(Number(db.prepare('DELETE FROM codes WHERE registration_id=? AND hash=?').run(row.id,row.code_hash).changes)!==1)throw new Error('Código já utilizado.');
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),id,now+30*86400000);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    const available=fs.existsSync(path.join(downloadDir,installer(row.platform)));
    return json(res,200,{token,user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id),true),expiresInDays:30,downloadAvailable:available,downloadUrl:available?`/download/${downloadToken(row.id,row.platform)}`:null});
  }
  const me=user(req);rate(req,'authenticated',240);
  if(route==='/v1/me'&&req.method==='GET')return json(res,200,{user:publicUser(me,true)});
  if(route==='/v1/me'&&req.method==='PATCH'){const raw=await body(req);db.prepare('UPDATE users SET share_phone=? WHERE id=?').run(raw.sharePhone===true?1:0,me.id);return json(res,200,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(me.id),true)});}
  if(route==='/v1/me'&&req.method==='DELETE'){db.prepare('DELETE FROM registrations WHERE phone_hash=? AND callsign=?').run(me.phone_hash,me.callsign);db.prepare('DELETE FROM users WHERE id=?').run(me.id);wake(me.id);return json(res,200,{deleted:true});}
  if(route==='/v1/directory'&&req.method==='GET'){const query=String(url.searchParams.get('query')||'').trim().toUpperCase();if(!/^[A-Z0-9]{3,8}$/.test(query))throw Object.assign(new Error('Pesquise um indicativo ou Radio ID exato.'),{status:400});rate(req,'directory',30);const found=db.prepare('SELECT u.* FROM users u WHERE (callsign=? OR dmr_id=?) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.owner=? AND b.peer=u.id) OR (b.owner=u.id AND b.peer=?))').get(query,query,me.id,me.id);return json(res,200,{user:found?publicUser(found):null});}
  if(route==='/v1/blocks'&&req.method==='POST'){const raw=await body(req);if(raw.blocked===false)db.prepare('DELETE FROM blocks WHERE owner=? AND peer=?').run(me.id,String(raw.peer));else db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?)').run(me.id,String(raw.peer));return json(res,200,{ok:true});}
  if(route==='/v1/messages'&&req.method==='POST'){rate(req,'messages',30);const raw=await body(req),to=String(raw.to||''),text=String(raw.text||'').trim();if(!to||to===me.id||!text||text.length>2000)throw Object.assign(new Error('Destino inválido ou mensagem fora do limite de 2.000 caracteres.'),{status:400});if(!db.prepare('SELECT id FROM users WHERE id=?').get(to)||db.prepare('SELECT 1 FROM blocks WHERE (owner=? AND peer=?) OR (owner=? AND peer=?)').get(me.id,to,to,me.id))throw Object.assign(new Error('Este contacto não está disponível.'),{status:404});const id=crypto.randomUUID();db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,NULL)').run(id,me.id,to,seal(text),nextMessageAt());wake(to);return json(res,201,rowMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(id),me.id));}
  if(route==='/v1/messages'&&req.method==='GET'){
    const peer=String(url.searchParams.get('peer')||''),after=cursor(url.searchParams.get('after')),receiptAfter=cursor(url.searchParams.get('receiptAfter')),includeReceipts=url.searchParams.has('receiptAfter');
    if(!db.prepare('SELECT id FROM users WHERE id=?').get(peer))throw Object.assign(new Error('Contacto não encontrado.'),{status:404});
    const batch=messageBatch(me.id,peer,after,receiptAfter,includeReceipts);
    if(batch.messages.length||batch.receipts.length||url.searchParams.get('wait')!=='1')return json(res,200,batch);
    const list=waiters.get(me.id)||new Set();if(list.size>=4)throw Object.assign(new Error('Feche as outras sessões de conversa.'),{status:429});
    const reply=()=>{clearTimeout(timer);list.delete(reply);try{json(res,200,messageBatch(me.id,peer,after,receiptAfter,includeReceipts));}catch{json(res,500,{message:'Não foi possível atualizar a conversa. Tente novamente.'});}};
    const timer=setTimeout(reply,25000);list.add(reply);waiters.set(me.id,list);
    res.on('close',()=>{clearTimeout(timer);list.delete(reply);if(!list.size&&waiters.get(me.id)===list)waiters.delete(me.id);});return;
  }
  if(route==='/v1/messages/read'&&req.method==='POST'){const raw=await body(req),peer=String(raw.peer||''),changed=markRead(me.id,peer);if(changed)wake(peer);return json(res,200,{ok:true,changed});}
  return json(res,404,{message:'Recurso não encontrado.'});
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");if(prod)res.setHeader('Strict-Transport-Security','max-age=31536000');
  const requestOrigin=req.headers.origin;if(requestOrigin){if(requestOrigin!==origin&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(requestOrigin)&&requestOrigin!=='capacitor://localhost')return json(res,403,{message:'Origem não autorizada.'});res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  try{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/v1/'))return await api(req,res,url);if(url.pathname.startsWith('/download/'))return download(req,res,url.pathname.slice(10));if(url.pathname==='/source'){const source=path.join(downloadDir,'ZapDMR-source.zip');if(!fs.existsSync(source))return json(res,404,{message:'Arquivo de código-fonte ainda não publicado.'});res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename=ZapDMR-1.3.1-source.zip','Content-Length':fs.statSync(source).size});streamFile(source,res);return;}if(url.pathname==='/admin'||url.pathname==='/admin/'){rate(req,'admin',10);const credential=Buffer.from(String(req.headers.authorization||'').replace(/^Basic /,''),'base64').toString();if(!process.env.ADMIN_PASSWORD||!safeEqual(credential,'admin:'+process.env.ADMIN_PASSWORD)){res.setHeader('WWW-Authenticate','Basic realm="ZapDMR"');return json(res,401,{message:'Autenticação administrativa necessária.'});}return json(res,200,{registrations:db.prepare('SELECT callsign,dmr_id,platform,created_at FROM registrations ORDER BY created_at DESC LIMIT 200').all(),verifiedUsers:db.prepare('SELECT count(*) AS n FROM users').get().n});}
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{message:'Método não permitido.'});
    let pathname=decodeURIComponent(url.pathname);
    if(pathname==='/healthz'){db.prepare('SELECT 1').get();return json(res,200,{ok:true,version:'1.3.1'});}
    const aliases={'/downloads':'/#downloads','/downloads/':'/#downloads','/recursos':'/#recursos','/recursos/':'/#recursos','/comunidade':'/#comunidade','/comunidade/':'/#comunidade','/privacidade':'/privacidade/','/termos':'/termos/','/index.html':'/'};
    if(aliases[pathname]){res.writeHead(308,{Location:aliases[pathname]});return res.end();}
    if(pathname==='/robots.txt'||pathname==='/sitemap.xml'){
      const isMap=pathname==='/sitemap.xml',text=isMap?sitemap(origin):prod?`User-agent: *\nDisallow: /v1/\nDisallow: /admin\nDisallow: /download/\nSitemap: ${origin}/sitemap.xml\n`:'User-agent: *\nDisallow: /\n';
      res.writeHead(200,{'Content-Type':isMap?'application/xml; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'public, max-age=300'});return res.end(req.method==='HEAD'?undefined:text);
    }
    if(publicPagePaths.includes(pathname)){
      const html=renderPublicPage(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),pathname,pageOptions);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(req.method==='HEAD'?undefined:html);
    }
    const file=path.resolve(root,'public','.'+pathname),publicRoot=path.join(root,'public')+path.sep;
    if(!file.startsWith(publicRoot)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{message:'Página não encontrada.'});
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'public, max-age=3600'});if(req.method==='HEAD')return res.end();streamFile(file,res);
  }catch(error){json(res,error.status||500,{message:error.status?error.message:'Não foi possível concluir o pedido. Tente novamente.'});}
});
server.headersTimeout=15000;server.requestTimeout=30000;
setInterval(()=>{const now=Date.now();for(const [id,item]of limits)if(item.until<now)limits.delete(id);if(limits.size>10000)limits.clear();db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now);db.prepare('DELETE FROM codes WHERE expires_at<?').run(now);db.prepare('DELETE FROM registrations WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM users WHERE users.callsign=registrations.callsign AND users.phone_hash=registrations.phone_hash)').run(now-30*86400000);},60000).unref();
server.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log(`ZapDMR portal: http://${process.env.HOST||'127.0.0.1'}:${Number(process.env.PORT)||3000}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const list of waiters.values())for(const reply of list)reply();server.close(()=>{db.close();process.exit(0);});});
