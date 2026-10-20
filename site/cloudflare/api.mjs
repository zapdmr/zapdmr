// GPL-3.0-only. Cloudflare Workers + D1 API; no Node compatibility flag required.
// Route handling, CORS, security headers, static assets and scheduled cleanup
// are composed by the Worker entry point. No credentials are generated here.
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const configs=new WeakMap();
const NOTICE_VERSION='2026-10-19',DAY=86400000;

function failure(status,message,details={}){return Object.assign(new Error(message),{status,...details});}
function json(status,value,headers={}){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});}
function errorResponse(error){return json(error.status||500,{message:error.status?error.message:'Não foi possível concluir o pedido. Tente novamente.',...(Number.isInteger(error.retryAfterSeconds)?{retryAfterSeconds:error.retryAfterSeconds}:{})});}
function hex(bytes){return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');}
function unhex(value){return Uint8Array.from(value.match(/../g),part=>parseInt(part,16));}
function base64(bytes){let text='';for(const byte of new Uint8Array(bytes))text+=String.fromCharCode(byte);return btoa(text);}
function unbase64(value){return Uint8Array.from(atob(value),character=>character.charCodeAt(0));}
function base64url(bytes){return base64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64url(value){if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw failure(403,'Link de download inválido.');const raw=value.replace(/-/g,'+').replace(/_/g,'/');try{return unbase64(raw+'='.repeat((4-raw.length%4)%4));}catch{throw failure(403,'Link de download inválido.');}}
function randomToken(){return base64url(crypto.getRandomValues(new Uint8Array(32)));}
function otpCode(){const max=4294967296,range=900000,limit=max-max%range;let value;do{value=crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=limit);return String(100000+value%range);}
function cursor(value){const number=Number(value);return Number.isSafeInteger(number)&&number>=0?number:0;}
function normalizePhone(value){const number=String(value||'').replace(/[\s().-]/g,'');if(!/^\+[1-9]\d{7,14}$/.test(number))throw failure(400,'Informe WhatsApp com +DDI, DDD e número (ex.: +5543999999999).');return number;}
function normalizeCallsign(value){const call=String(value||'').trim().toUpperCase();if(!/^[A-Z0-9]{3,8}$/.test(call)||!/[A-Z]/.test(call)||!/[0-9]/.test(call))throw failure(400,'Indicativo inválido.');return call;}
function normalizeRadioId(value){const id=String(value||'');if(!/^\d{7}$/.test(id)||Number(id)>0xffffff)throw failure(400,'DMR ID deve conter 7 dígitos válidos.');return id;}
function validReleaseUrl(value){
  if(!value)return null;
  let url;try{url=new URL(value);}catch{throw failure(503,'A configuração dos downloads precisa ser corrigida pelo responsável.');}
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname))throw failure(503,'Os instaladores devem usar URLs HTTPS de GitHub Releases.');
  return url.href;
}
function validOtpUrl(value){
  if(!value)return null;
  let url;try{url=new URL(value);}catch{throw failure(503,'A configuração da entrega de códigos precisa ser corrigida.');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw failure(503,'O adaptador de códigos deve usar HTTPS.');
  return url.href;
}
async function configuration(env){
  if(!env?.DB||typeof env.DB.prepare!=='function')throw failure(503,'O banco da comunidade ainda não foi configurado.');
  if(!/^[a-f\d]{64}$/i.test(env.DATA_ENCRYPTION_KEY||'')||!/^[a-f\d]{64}$/i.test(env.DOWNLOAD_SECRET||'')||env.DATA_ENCRYPTION_KEY.toLowerCase()===env.DOWNLOAD_SECRET.toLowerCase()||(env.ADMIN_PASSWORD||'').length<16)throw failure(503,'Os segredos de produção ainda não foram configurados.');
  let origin;try{origin=new URL(env.PUBLIC_ORIGIN);}catch{throw failure(503,'Configure o domínio HTTPS da comunidade.');}
  if(origin.protocol!=='https:'||origin.origin!==env.PUBLIC_ORIGIN||origin.username||origin.password||!String(env.OWNER_NAME||'').trim()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.PRIVACY_EMAIL||''))throw failure(503,'Configure domínio HTTPS, responsável e contacto de privacidade.');
  let pending=configs.get(env);
  if(!pending){
    pending=(async()=>{
      const bytes=unhex(env.DATA_ENCRYPTION_KEY),downloadBytes=unhex(env.DOWNLOAD_SECRET);
      const [aes,hmac,downloadHmac]=await Promise.all([
        crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']),
        crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']),
        crypto.subtle.importKey('raw',downloadBytes,{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])
      ]);
      if(env.OTP_MODE==='development')throw failure(503,'Códigos visíveis de homologação são permitidos somente no servidor local isolado.');
      return {aes,hmac,downloadHmac,origin:origin.origin,otpUrl:validOtpUrl(env.OTP_DELIVERY_URL),whatsappUrl:validOtpUrl(env.WHATSAPP_API_URL),downloads:{android:validReleaseUrl(env.DOWNLOAD_ANDROID_URL),windows:validReleaseUrl(env.DOWNLOAD_WINDOWS_URL),source:validReleaseUrl(env.SOURCE_URL)}};
    })();configs.set(env,pending);
  }
  return {...await pending,db:typeof env.DB.withSession==='function'?env.DB.withSession('first-primary'):env.DB};
}
async function hash(config,value){return hex(await crypto.subtle.sign('HMAC',config.hmac,encoder.encode(value)));}
async function sameHash(config,value,expected){if(!/^[a-f\d]{64}$/i.test(expected||''))return false;return crypto.subtle.verify('HMAC',config.hmac,unhex(expected),encoder.encode(value));}
async function seal(config,value){const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128},config.aes,encoder.encode(value))),data=new Uint8Array(iv.length+cipher.length);data.set(iv);data.set(cipher,iv.length);return base64(data);}
async function unseal(config,value){const data=unbase64(value);if(data.length<28)throw new Error('Invalid encrypted data');return decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12),tagLength:128},config.aes,data.slice(12)));}
async function body(request){
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type')||''))throw failure(415,'Envie o pedido como application/json.');
  if(Number(request.headers.get('Content-Length'))>8192)throw failure(413,'Pedido demasiado grande.');
  const reader=request.body?.getReader(),chunks=[];let length=0;
  if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();throw failure(413,'Pedido demasiado grande.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let value;try{value=JSON.parse(decoder.decode(bytes)||'{}');}catch{throw failure(400,'JSON inválido.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw failure(400,'O pedido JSON deve ser um objeto.');return value;
}
async function rate(config,request,bucket,max=60,period=60000,identity){
  // cf is supplied by the edge. A local emulator uses one fixed identity and
  // cannot impersonate visitors by supplying forwarding headers.
  const subject=identity||await hash(config,'rate-ip:'+(request.cf?request.headers.get('CF-Connecting-IP')||'unknown':'local'));
  const now=Date.now(),row=await config.db.prepare(`INSERT INTO rate_limits(bucket,identity,n,expires_at) VALUES(?,?,1,?)
    ON CONFLICT(bucket,identity) DO UPDATE SET n=CASE WHEN rate_limits.expires_at<=? THEN 1 ELSE rate_limits.n+1 END,
    expires_at=CASE WHEN rate_limits.expires_at<=? THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING n,expires_at`).bind(bucket,subject,now+period,now,now).first();
  if(row.n>max)throw failure(429,'Muitas tentativas. Aguarde alguns minutos.');
}
async function currentUser(config,request){
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw failure(401,'Entre na comunidade com o código recebido no seu número.');
  const row=await config.db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>?').bind(await hash(config,token),Date.now()).first();
  if(!row)throw failure(401,'Sessão expirada. Confirme novamente o número.');return row;
}
async function publicUser(config,row,own=false){return {id:row.id,callsign:row.callsign,dmrId:row.dmr_id,verified:Boolean(row.whatsapp_verified),whatsapp_verified:Boolean(row.whatsapp_verified),verificationMethod:row.verification_method,sharePhone:Boolean(row.share_phone),...(own||row.share_phone?{whatsapp:await unseal(config,row.phone_cipher)}:{})};}
async function publicMessage(config,row,own){return {id:row.id,from:row.sender,to:row.recipient,text:await unseal(config,row.body_cipher),at:row.at,readAt:row.read_at,direction:row.sender===own?'out':'in',state:row.read_at?'read':'sent'};}
function downloadMetadata(env,config,platform){
  if(!config.downloads[platform])return {available:false};
  const prefix=platform==='android'?'DOWNLOAD_ANDROID':'DOWNLOAD_WINDOWS',bytes=Number(env[prefix+'_BYTES']),sha256=env[prefix+'_SHA256'];
  return {available:true,...(Number.isSafeInteger(bytes)&&bytes>0?{bytes}:{}),...(/^[a-f\d]{64}$/i.test(sha256||'')?{sha256:sha256.toLowerCase()}:{})};
}
async function downloadToken(config,id,platform){const value=base64url(encoder.encode(JSON.stringify({id,platform,expires:Date.now()+900000}))),signature=base64url(await crypto.subtle.sign('HMAC',config.downloadHmac,encoder.encode(value)));return value+'.'+signature;}
async function pairAvailable(config,own,peer){return config.db.prepare('SELECT u.id FROM users u WHERE u.id=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.owner=? AND b.peer=u.id) OR (b.owner=u.id AND b.peer=?))').bind(peer,own,own).first();}
async function messageBatch(config,own,peer,after,receiptAfter,includeReceipts){
  const statements=[config.db.prepare('SELECT * FROM messages WHERE ((sender=? AND recipient=?) OR (sender=? AND recipient=?)) AND at>=? ORDER BY at,id LIMIT 100').bind(own,peer,peer,own,after)];
  if(includeReceipts)statements.push(config.db.prepare('SELECT id,read_at AS readAt FROM messages WHERE sender=? AND recipient=? AND read_at>=? ORDER BY read_at,id LIMIT 100').bind(own,peer,receiptAfter));
  const results=await config.db.batch(statements),receipts=includeReceipts?results[1].results:[];
  return {messages:await Promise.all(results[0].results.map(row=>publicMessage(config,row,own))),receipts,nextReceiptCursor:receipts.length?receipts[receipts.length-1].readAt+1:receiptAfter};
}
function waitForMessages(signal){return new Promise((resolve,reject)=>{if(signal.aborted)return reject(failure(499,'Pedido cancelado.'));const finish=()=>{signal.removeEventListener('abort',abort);resolve();},timer=setTimeout(finish,25000),abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(failure(499,'Pedido cancelado.'));};signal.addEventListener('abort',abort,{once:true});});}
async function deliverCode(config,env,request,row,code){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000),abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});
  try{const number=await unseal(config,row.phone_cipher),modern=Boolean(config.whatsappUrl&&env.WHATSAPP_API_TOKEN);const response=await fetch(modern?config.whatsappUrl:config.otpUrl,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(modern?env.WHATSAPP_API_TOKEN:env.OTP_DELIVERY_TOKEN)},body:JSON.stringify(modern?{number,text:otpMessage(row.callsign,code)}:{phone:number,code,expiresInSeconds:600}),signal:controller.signal});const accepted=response.ok;await response.body?.cancel();if(!accepted)throw new Error('Delivery rejected');}
  catch{throw failure(503,'O serviço de códigos não aceitou o envio. Tente mais tarde.');}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
}

const otpMessage=(callsign,code)=>`*ZapDMR:* Olá ${callsign}, seu código de confirmação de 6 dígitos é: *${code}*. Forte 73!`;
function reverseNumber(env){try{return normalizePhone(env.WHATSAPP_CONFIRM_NUMBER);}catch{return null;}}
function reverseConfigured(env){return Boolean(reverseNumber(env)&&String(env.WHATSAPP_WEBHOOK_TOKEN||'').length>=32);}
async function bridgeConnected(config,env){if(env.WHATSAPP_LOCAL_BRIDGE!=='1')return false;const state=await config.db.prepare('SELECT * FROM whatsapp_bridge_state WHERE id=1').first();return Boolean(state?.connected&&state.last_seen_at>Date.now()-20000);}
async function verificationMode(config,env){
  if((config.whatsappUrl&&env.WHATSAPP_API_TOKEN)||(config.otpUrl&&env.OTP_DELIVERY_TOKEN))return 'direct';
  if(reverseConfigured(env))return env.WHATSAPP_LOCAL_BRIDGE==='1'&&await bridgeConnected(config,env)?'bridge':'reverse';
  return 'unavailable';
}
async function bridgeAuth(config,env,request){const expected=String(env.WHATSAPP_WEBHOOK_TOKEN||'');if(expected.length<32)throw failure(503,'Configure o segredo privado da ponte WhatsApp.');const supplied=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');if(supplied.length>256||!await sameHash(config,'whatsapp-bridge:'+supplied,await hash(config,'whatsapp-bridge:'+expected)))throw failure(401,'Autenticação da ponte necessária.');}
async function assertIdentity(config,row){const prior=await config.db.prepare('SELECT * FROM users WHERE callsign=? OR dmr_id=? LIMIT 1').bind(row.callsign,row.dmr_id).first();if(prior&&(prior.phone_hash!==row.phone_hash||prior.callsign!==row.callsign||prior.dmr_id!==row.dmr_id))throw failure(409,'Este indicativo já possui uma conta. Use o número existente ou contacte o responsável.');return prior;}
function phoneVariants(number){const digits=number.slice(1),variants=[number];if(/^55\d{2}[6-9]\d{7}$/.test(digits))variants.push('+'+digits.slice(0,4)+'9'+digits.slice(4));if(/^55\d{2}9[6-9]\d{7}$/.test(digits))variants.push('+'+digits.slice(0,4)+digits.slice(5));return variants;}
async function challengeView(config,env,codeRow,plain){
  const now=Date.now(),mode=codeRow.mode,result={mode,sent:mode==='direct',expiresInSeconds:Math.max(0,Math.ceil((codeRow.expires_at-now)/1000)),retryAfterSeconds:Math.max(0,Math.ceil((codeRow.requested_at+60000-now)/1000)),challengeToken:plain.token};
  if(mode==='reverse'){
    result.displayCode=plain.code;
    result.whatsappUrl='https://wa.me/'+reverseNumber(env).slice(1)+'?text='+encodeURIComponent(`ZapDMR CONFIRMAR ${plain.token} ${plain.code}`);
    result.message='Envie a mensagem pelo WhatsApp do número cadastrado. A confirmação acontece após a ponte receber e conferir o remetente.';
  }else if(mode==='bridge'){const job=await config.db.prepare('SELECT status FROM whatsapp_outbox WHERE registration_id=? AND code_hash=? ORDER BY created_at DESC LIMIT 1').bind(codeRow.registration_id,codeRow.hash).first();result.sent=job?.status==='sent';result.queued=!result.sent;result.message=result.sent?'Código enviado pelo WhatsApp. Digite os seis dígitos recebidos.':'Código na fila da ponte WhatsApp. Aguarde o recebimento no número cadastrado.';}
  else result.message='Código enviado ao número cadastrado. Expira em 10 minutos.';
  return result;
}
async function issueChallenge(config,env,request,row){
  await assertIdentity(config,row);
  const prior=await config.db.prepare('SELECT requested_at FROM codes WHERE registration_id=?').bind(row.id).first(),now=Date.now();
  if(prior&&prior.requested_at+60000>now)throw failure(429,'Aguarde para reenviar o código.',{retryAfterSeconds:Math.ceil((prior.requested_at+60000-now)/1000)});
  let mode=await verificationMode(config,env);
  if(mode==='unavailable')return {mode,sent:false,expiresInSeconds:600,retryAfterSeconds:60,message:'A confirmação aguarda a conexão do WhatsApp oficial. O número ainda não foi validado.'};
  await rate(config,request,'otp-phone',1,60000,row.phone_hash);
  const plain={code:otpCode(),token:randomToken()},codeHash=await hash(config,row.id+':'+plain.code),challengeHash=await hash(config,'otp-challenge:'+plain.token),cipher=await seal(config,JSON.stringify(plain));
  await config.db.batch([
    config.db.prepare('DELETE FROM whatsapp_outbox WHERE registration_id=?').bind(row.id),
    config.db.prepare(`INSERT INTO codes(registration_id,hash,expires_at,attempts,requested_at,mode,challenge_hash,challenge_cipher,reverse_confirmed_at) VALUES(?,?,?,0,?,?,?,?,NULL)
      ON CONFLICT(registration_id) DO UPDATE SET hash=excluded.hash,expires_at=excluded.expires_at,attempts=0,requested_at=excluded.requested_at,mode=excluded.mode,challenge_hash=excluded.challenge_hash,challenge_cipher=excluded.challenge_cipher,reverse_confirmed_at=NULL`).bind(row.id,codeHash,now+600000,now,mode,challengeHash,cipher)
  ]);
  if(mode==='direct')try{await deliverCode(config,env,request,row,plain.code);}catch(error){if(!reverseConfigured(env)){await config.db.prepare('DELETE FROM codes WHERE registration_id=? AND hash=?').bind(row.id,codeHash).run();return {mode:'unavailable',sent:false,expiresInSeconds:600,retryAfterSeconds:60,message:error.message};}mode='reverse';await config.db.prepare("UPDATE codes SET mode='reverse' WHERE registration_id=? AND hash=?").bind(row.id,codeHash).run();}
  if(mode==='bridge')await config.db.prepare('INSERT INTO whatsapp_outbox(id,registration_id,code_hash,payload_cipher,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),row.id,codeHash,await seal(config,JSON.stringify({number:await unseal(config,row.phone_cipher),text:otpMessage(row.callsign,plain.code)})),'queued',now,now+600000).run();
  return challengeView(config,env,{registration_id:row.id,hash:codeHash,requested_at:now,expires_at:now+600000,mode},plain);
}

export async function handleApi(request,env,url=new URL(request.url)){
  try{return await api(request,env,url,await configuration(env));}catch(error){return errorResponse(error);}
}
async function api(request,env,url,config){
  const route=url.pathname,method=request.method,db=config.db;
  if(route==='/v1/status'&&method==='GET'){const mode=await verificationMode(config,env);return json(200,{version:'1.3.1',registration:true,verificationConfigured:mode!=='unavailable',verificationMode:mode,developmentMode:false,bridgeConnected:await bridgeConnected(config,env),downloadRequiresVerification:true,owner:env.OWNER_NAME,privacyEmail:env.PRIVACY_EMAIL,downloads:{android:downloadMetadata(env,config,'android'),windows:downloadMetadata(env,config,'windows')}});}
  if(route.startsWith('/v1/whatsapp/')&&method==='POST'){
    await bridgeAuth(config,env,request);await rate(config,request,'whatsapp-bridge',120);const raw=await body(request),now=Date.now();
    if(route==='/v1/whatsapp/webhook'){
      const match=/^ZapDMR CONFIRMAR ([A-Za-z0-9_-]{43}) (\d{6})$/.exec(String(raw.text||'').trim());
      if(!match)return json(200,{accepted:true,confirmed:false});
      const from=normalizePhone(raw.number),row=await db.prepare('SELECT c.*,r.phone_hash FROM codes c JOIN registrations r ON r.id=c.registration_id WHERE c.challenge_hash=? AND c.expires_at>? AND c.attempts<5 AND c.mode=?').bind(await hash(config,'otp-challenge:'+match[1]),now,'reverse').first();
      if(!row||!await sameHash(config,row.registration_id+':'+match[2],row.hash))return json(200,{accepted:true,confirmed:false});
      const fromHashes=await Promise.all(phoneVariants(from).map(number=>hash(config,number)));
      if(!fromHashes.includes(row.phone_hash))return json(200,{accepted:true,confirmed:false});
      await db.prepare('UPDATE codes SET reverse_confirmed_at=? WHERE registration_id=? AND hash=? AND expires_at>? AND mode=?').bind(now,row.registration_id,row.hash,now,'reverse').run();return json(200,{accepted:true,confirmed:true});
    }
    if(route==='/v1/whatsapp/bridge/heartbeat'||route==='/v1/whatsapp/bridge/outbox'){
      const provided=normalizePhone(raw.number),official=reverseNumber(env);if(!official||!phoneVariants(provided).includes(official))throw failure(403,'A ponte deve usar o WhatsApp oficial configurado.');
      const connected=raw.connected===true;await db.prepare('INSERT INTO whatsapp_bridge_state(id,last_seen_at,connected) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,connected=excluded.connected').bind(now,connected?1:0).run();
      if(route.endsWith('/heartbeat'))return json(200,{ok:true});if(!connected)return json(200,{jobs:[]});
      const leaseId=randomToken(),jobs=await db.prepare(`UPDATE whatsapp_outbox SET status='sending',lease_until=?,lease_id=?,attempts=attempts+1 WHERE id IN(
        SELECT q.id FROM whatsapp_outbox q JOIN codes c ON c.registration_id=q.registration_id AND c.hash=q.code_hash
        WHERE (q.status='queued' OR (q.status='sending' AND q.lease_until<?)) AND q.attempts<2 AND q.expires_at>? AND c.mode='bridge' AND c.expires_at>?
        ORDER BY q.created_at LIMIT 5) RETURNING id,payload_cipher,lease_id`).bind(now+60000,leaseId,now,now,now).all();
      return json(200,{jobs:await Promise.all(jobs.results.map(async job=>({id:job.id,leaseId:job.lease_id,...JSON.parse(await unseal(config,job.payload_cipher))})))});
    }
    if(route==='/v1/whatsapp/bridge/ack'){
      if(!['sent','failed'].includes(raw.status)||!/^[-a-f0-9]{36}$/i.test(String(raw.id||''))||!/^[A-Za-z0-9_-]{43}$/.test(String(raw.leaseId||'')))throw failure(400,'Resultado de envio inválido.');
      const job=await db.prepare('UPDATE whatsapp_outbox SET status=?,lease_until=0,lease_id=NULL WHERE id=? AND status=? AND lease_id=? RETURNING registration_id,code_hash').bind(raw.status,raw.id,'sending',raw.leaseId).first();
      if(job&&raw.status==='failed'&&reverseConfigured(env))await db.prepare("UPDATE codes SET mode='reverse' WHERE registration_id=? AND hash=? AND mode='bridge'").bind(job.registration_id,job.code_hash).run();return json(200,{ok:true});
    }
    return json(404,{message:'Recurso da ponte não encontrado.'});
  }
  if(route==='/admin'||route==='/admin/'){
    if(method!=='GET')return json(405,{message:'Método não permitido.'},{Allow:'GET'});
    await rate(config,request,'admin',10);let credentials='';
    try{const header=request.headers.get('Authorization')||'';if(header.startsWith('Basic '))credentials=decoder.decode(unbase64(header.slice(6)));}catch{}
    const expected=await hash(config,'admin:'+env.ADMIN_PASSWORD);
    if(!await sameHash(config,credentials,expected))return json(401,{message:'Autenticação administrativa necessária.'},{'WWW-Authenticate':'Basic realm="ZapDMR"'});
    const rows=await db.batch([db.prepare('SELECT callsign,dmr_id,platform,created_at FROM registrations ORDER BY created_at DESC LIMIT 200'),db.prepare('SELECT count(*) AS n FROM users')]);
    return json(200,{registrations:rows[0].results,verifiedUsers:rows[1].results[0].n});
  }
  if(route==='/v1/registrations'&&method==='POST'){
    await rate(config,request,'registration',10,3600000);const raw=await body(request);
    if(raw.noticeAccepted!==true)throw failure(400,'Leia e aceite a utilização dos dados para o cadastro.');
    const call=normalizeCallsign(raw.callsign),id=normalizeRadioId(raw.dmrId),number=normalizePhone(raw.whatsapp),platform=raw.platform==='windows'?'windows':'android',registrationId=crypto.randomUUID();
    await db.prepare('INSERT INTO registrations(id,callsign,dmr_id,phone_cipher,phone_hash,share_phone,platform,created_at,notice_version) VALUES(?,?,?,?,?,?,?,?,?)').bind(registrationId,call,id,await seal(config,number),await hash(config,number),raw.sharePhone===true?1:0,platform,Date.now(),NOTICE_VERSION).run();
    const available=Boolean(config.downloads[platform]),row=await db.prepare('SELECT * FROM registrations WHERE id=?').bind(registrationId).first();
    let challenge;
    if(raw.requestVerification===true)try{challenge=await issueChallenge(config,env,request,row);}catch(error){if(error.status!==429)throw error;challenge={mode:'unavailable',sent:false,expiresInSeconds:600,retryAfterSeconds:error.retryAfterSeconds||60,message:error.message};}
    return json(201,{registrationId,verified:false,verificationRequired:true,downloadAvailable:available,downloadUrl:null,...(challenge?{challenge}:{}),message:'Cadastro recebido. Confirme o WhatsApp para liberar o download e o ZapChat.'});
  }
  if(route==='/v1/auth/request-code'&&method==='POST'){
    await rate(config,request,'otp',5,600000);const raw=await body(request),row=await db.prepare('SELECT * FROM registrations WHERE id=?').bind(String(raw.registrationId||'')).first();
    if(!row)throw failure(404,'Faça primeiro o cadastro.');
    return json(200,await issueChallenge(config,env,request,row));
  }
  if(route==='/v1/auth/status'&&method==='POST'){
    await rate(config,request,'otp-status',120);const raw=await body(request),token=String(raw.challengeToken||'');if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw failure(400,'Confirmação inválida.');
    const row=await db.prepare('SELECT * FROM codes WHERE registration_id=? AND challenge_hash=?').bind(String(raw.registrationId||''),await hash(config,'otp-challenge:'+token)).first();
    if(!row||row.expires_at<=Date.now()||row.attempts>=5)return json(200,{status:'expired',expiresInSeconds:0,retryAfterSeconds:0});
    if(row.mode==='bridge'&&Date.now()>row.requested_at+90000){const job=await db.prepare('SELECT status,attempts,lease_until FROM whatsapp_outbox WHERE registration_id=? AND code_hash=?').bind(row.registration_id,row.hash).first();if(job?.status!=='sent'&&(!await bridgeConnected(config,env)||job?.attempts>=2&&job.lease_until<Date.now())){await db.prepare("UPDATE codes SET mode='reverse' WHERE registration_id=? AND hash=?").bind(row.registration_id,row.hash).run();row.mode='reverse';}}
    const plain=JSON.parse(await unseal(config,row.challenge_cipher)),challenge=await challengeView(config,env,row,plain);
    return json(200,{status:row.mode==='reverse'&&row.reverse_confirmed_at?'confirmed':'pending',expiresInSeconds:challenge.expiresInSeconds,retryAfterSeconds:challenge.retryAfterSeconds,challenge});
  }
  if(route==='/v1/auth/verify'&&method==='POST'){
    await rate(config,request,'verify',20,600000);const raw=await body(request),registrationId=String(raw.registrationId||''),now=Date.now();
    if(!/^\d{6}$/.test(String(raw.code||'')))throw failure(400,'Digite os 6 dígitos recebidos.');
    const pending=await db.prepare('SELECT * FROM codes WHERE registration_id=? AND expires_at>? AND attempts<5').bind(registrationId,now).first();if(!pending)throw failure(401,'Código expirado ou bloqueado. Solicite outro.');
    if(pending.mode==='reverse'){if(!/^[A-Za-z0-9_-]{43}$/.test(String(raw.challengeToken||''))||!await sameHash(config,'otp-challenge:'+raw.challengeToken,pending.challenge_hash))throw failure(401,'Confirmação inválida.');if(!pending.reverse_confirmed_at)throw failure(409,'Ainda aguardamos a mensagem enviada pelo seu WhatsApp.');}
    if(!['direct','bridge','reverse'].includes(pending.mode))throw failure(401,'Este código não permite confirmar o número.');
    const attempts=await db.batch([db.prepare('UPDATE codes SET attempts=attempts+1 WHERE registration_id=? AND hash=? AND expires_at>? AND attempts<5 RETURNING *').bind(registrationId,pending.hash,now),db.prepare('SELECT * FROM registrations WHERE id=?').bind(registrationId)]),codeRow=attempts[0].results[0],row=attempts[1].results[0];
    if(!codeRow||!row)throw failure(401,'Código expirado ou bloqueado. Solicite outro.');
    if(!await sameHash(config,row.id+':'+String(raw.code||''),codeRow.hash))throw failure(401,'Código incorreto.');
    const existing=await db.prepare('SELECT * FROM users WHERE callsign=? OR dmr_id=? LIMIT 1').bind(row.callsign,row.dmr_id).first();
    if(existing&&(existing.phone_hash!==row.phone_hash||existing.callsign!==row.callsign||existing.dmr_id!==row.dmr_id))throw failure(409,'O perfil já está vinculado a outra conta.');
    const token=randomToken(),sessionHash=await hash(config,token),id=existing?.id||crypto.randomUUID();
    let result;try{result=await db.batch([
      db.prepare(`INSERT INTO users(id,callsign,dmr_id,phone_cipher,phone_hash,share_phone,created_at,verified_at,whatsapp_verified,verification_method)
        SELECT ?,r.callsign,r.dmr_id,r.phone_cipher,r.phone_hash,r.share_phone,?,?,1,c.mode FROM registrations r JOIN codes c ON c.registration_id=r.id
        WHERE r.id=? AND c.hash=? AND c.expires_at>? AND c.attempts<=5 AND (c.mode<>'reverse' OR c.reverse_confirmed_at IS NOT NULL)
        ON CONFLICT(callsign) DO UPDATE SET share_phone=excluded.share_phone,whatsapp_verified=1,verified_at=excluded.verified_at,verification_method=excluded.verification_method
        WHERE users.dmr_id=excluded.dmr_id AND users.phone_hash=excluded.phone_hash RETURNING *`).bind(id,now,now,row.id,codeRow.hash,now),
      db.prepare(`INSERT INTO sessions(hash,user_id,expires_at) SELECT ?,u.id,? FROM users u JOIN registrations r ON u.callsign=r.callsign AND u.dmr_id=r.dmr_id AND u.phone_hash=r.phone_hash
        JOIN codes c ON c.registration_id=r.id WHERE r.id=? AND c.hash=? AND c.expires_at>? AND c.attempts<=5 AND (c.mode<>'reverse' OR c.reverse_confirmed_at IS NOT NULL)`).bind(sessionHash,now+30*DAY,row.id,codeRow.hash,now),
      db.prepare('UPDATE registrations SET whatsapp_verified=1,verified_at=? WHERE id=? AND EXISTS(SELECT 1 FROM sessions WHERE hash=?)').bind(now,row.id,sessionHash),
      db.prepare('DELETE FROM codes WHERE registration_id=? AND hash=?').bind(row.id,codeRow.hash),
      db.prepare('DELETE FROM whatsapp_outbox WHERE registration_id=? AND code_hash=?').bind(row.id,codeRow.hash)
    ]);}catch(error){if(String(error.message).includes('UNIQUE constraint'))throw failure(409,'O perfil já está vinculado a outra conta.');throw error;}
    if(!result[0].results.length||!result[1].meta.changes)throw failure(401,'O código já foi utilizado. Solicite outro.');
    const available=Boolean(config.downloads[row.platform]);return json(200,{token,user:await publicUser(config,result[0].results[0],true),expiresInDays:30,downloadAvailable:available,downloadUrl:available?'/download/'+await downloadToken(config,row.id,row.platform):null});
  }
  const me=await currentUser(config,request);await rate(config,request,'authenticated',240);
  if(route==='/v1/me'&&method==='GET')return json(200,{user:await publicUser(config,me,true)});
  if(route==='/v1/me'&&method==='PATCH'){const raw=await body(request),updated=await db.prepare('UPDATE users SET share_phone=? WHERE id=? RETURNING *').bind(raw.sharePhone===true?1:0,me.id).first();return json(200,{user:await publicUser(config,updated,true)});}
  if(route==='/v1/me'&&method==='DELETE'){await db.batch([db.prepare('DELETE FROM registrations WHERE phone_hash=? AND callsign=?').bind(me.phone_hash,me.callsign),db.prepare('DELETE FROM users WHERE id=?').bind(me.id)]);return json(200,{deleted:true});}
  if(route==='/v1/directory'&&method==='GET'){
    const query=String(url.searchParams.get('query')||'').trim().toUpperCase();if(!/^[A-Z0-9]{3,8}$/.test(query))throw failure(400,'Pesquise um indicativo ou Radio ID exato.');
    await rate(config,request,'directory',30);const found=await db.prepare('SELECT u.* FROM users u WHERE (callsign=? OR dmr_id=?) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.owner=? AND b.peer=u.id) OR (b.owner=u.id AND b.peer=?)) LIMIT 1').bind(query,query,me.id,me.id).first();return json(200,{user:found?await publicUser(config,found):null});
  }
  if(route==='/v1/blocks'&&method==='POST'){
    const raw=await body(request),peer=String(raw.peer||'');if(peer===me.id||!await db.prepare('SELECT id FROM users WHERE id=?').bind(peer).first())throw failure(404,'Contacto não encontrado.');
    if(raw.blocked===false)await db.prepare('DELETE FROM blocks WHERE owner=? AND peer=?').bind(me.id,peer).run();else await db.prepare('INSERT OR IGNORE INTO blocks(owner,peer) VALUES(?,?)').bind(me.id,peer).run();return json(200,{ok:true});
  }
  if(route==='/v1/messages'&&method==='POST'){
    await rate(config,request,'messages',30);const raw=await body(request),to=String(raw.to||''),text=String(raw.text||'').trim();
    if(!to||to===me.id||!text||text.length>2000)throw failure(400,'Destino inválido ou mensagem fora do limite de 2.000 caracteres.');if(!await pairAvailable(config,me.id,to))throw failure(404,'Este contacto não está disponível.');
    const id=crypto.randomUUID(),row=await db.prepare('INSERT INTO messages(id,sender,recipient,body_cipher,at,read_at) VALUES(?,?,?,?,(SELECT MAX(?,COALESCE(MAX(at),0)+1) FROM messages),NULL) RETURNING *').bind(id,me.id,to,await seal(config,text),Date.now()).first();return json(201,await publicMessage(config,row,me.id));
  }
  if(route==='/v1/messages'&&method==='GET'){
    const peer=String(url.searchParams.get('peer')||''),after=cursor(url.searchParams.get('after')),receiptAfter=cursor(url.searchParams.get('receiptAfter')),includeReceipts=url.searchParams.has('receiptAfter');
    if(!await pairAvailable(config,me.id,peer))throw failure(404,'Este contacto não está disponível.');
    let batch=await messageBatch(config,me.id,peer,after,receiptAfter,includeReceipts);
    if(!batch.messages.length&&!batch.receipts.length&&url.searchParams.get('wait')==='1'){
      // Workers on different isolates cannot notify each other through a Map.
      // One final query after sleeping bounds D1 requests per long poll.
      await waitForMessages(request.signal);
      await currentUser(config,request);if(!await pairAvailable(config,me.id,peer))throw failure(404,'Este contacto não está disponível.');
      batch=await messageBatch(config,me.id,peer,after,receiptAfter,includeReceipts);
    }
    return json(200,batch);
  }
  if(route==='/v1/messages/read'&&method==='POST'){
    const raw=await body(request),peer=String(raw.peer||'');if(!await pairAvailable(config,me.id,peer))throw failure(404,'Este contacto não está disponível.');
    // Materialized CTEs freeze the old maximum and pending rows for this atomic
    // update, assigning a distinct increasing read_at to every receipt.
    const changed=await db.prepare(`WITH base AS MATERIALIZED (SELECT MAX(?,COALESCE(MAX(read_at),0)+1) AS first_at FROM messages),
      pending AS MATERIALIZED (SELECT id,ROW_NUMBER() OVER(ORDER BY at,id)-1 AS ordinal FROM messages WHERE recipient=? AND sender=? AND read_at IS NULL)
      UPDATE messages SET read_at=(SELECT first_at FROM base)+(SELECT ordinal FROM pending WHERE pending.id=messages.id) WHERE id IN(SELECT id FROM pending)`).bind(Date.now(),me.id,peer).run();
    return json(200,{ok:true,changed:Number(changed.meta.changes||0)});
  }
  return json(404,{message:'Recurso não encontrado.'});
}

export async function handleDownload(request,env,url=new URL(request.url)){
  try{
    if(!['GET','HEAD'].includes(request.method))return json(405,{message:'Método não permitido.'},{Allow:'GET, HEAD'});
    if(url.pathname==='/source'){const source=validReleaseUrl(env.SOURCE_URL);if(!source)throw failure(404,'Arquivo de código-fonte ainda não publicado.');return new Response(null,{status:302,headers:{Location:source,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
    const config=await configuration(env);
    if(!url.pathname.startsWith('/download/'))return json(404,{message:'Recurso não encontrado.'});
    await rate(config,request,'download',60);
    const token=url.pathname.slice(10);if(token.length>1500)throw failure(403,'Link de download inválido.');
    const parts=token.split('.');if(parts.length!==2||!await crypto.subtle.verify('HMAC',config.downloadHmac,unbase64url(parts[1]),encoder.encode(parts[0])))throw failure(403,'Link de download inválido.');
    let data;try{data=JSON.parse(decoder.decode(unbase64url(parts[0])));}catch{throw failure(403,'Link de download inválido.');}
    if(!data||!Number.isSafeInteger(data.expires)||data.expires<Date.now()||!['android','windows'].includes(data.platform)||!await config.db.prepare('SELECT id FROM registrations WHERE id=? AND whatsapp_verified=1 AND verified_at IS NOT NULL').bind(String(data.id||'')).first())throw failure(403,'Confirme o WhatsApp para liberar o download ou solicite um novo link.');
    const target=config.downloads[data.platform];if(!target)throw failure(404,'Instalador ainda não publicado.');
    return new Response(null,{status:302,headers:{Location:target,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
  }catch(error){return errorResponse(error);}
}

// Call from the entry point's scheduled handler with ctx.waitUntil(cleanup(env)).
// It is intentionally not run on every request, to conserve the free D1 quota.
export async function cleanup(env){
  const config=await configuration(env),now=Date.now();
  return config.db.batch([
    config.db.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now),
    config.db.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now),
    config.db.prepare('DELETE FROM codes WHERE expires_at<?').bind(now),
    config.db.prepare('DELETE FROM whatsapp_outbox WHERE expires_at<?').bind(now),
    config.db.prepare('DELETE FROM registrations WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM users WHERE users.callsign=registrations.callsign AND users.phone_hash=registrations.phone_hash)').bind(now-30*DAY)
  ]);
}
