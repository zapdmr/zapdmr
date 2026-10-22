/* Optional FCM HTTP v1. Only opaque routing IDs leave the community, never message bodies. */
const oauthCache=new Map(),enc=new TextEncoder();
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export function pushConfigured(env){return Boolean(/^[a-z][a-z0-9-]{4,62}$/.test(env.FCM_PROJECT_ID||'')&&/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(env.FCM_CLIENT_EMAIL||'')&&String(env.FCM_PRIVATE_KEY||'').includes('BEGIN PRIVATE KEY'));}
async function accessToken(env,fetcher){
 const cacheKey=env.FCM_CLIENT_EMAIL+':'+env.FCM_PRIVATE_KEY,cached=oauthCache.get(cacheKey);if(cached?.expires>Date.now()+60000)return cached.token;
 const now=Math.floor(Date.now()/1000),header=b64url(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'}))),payload=b64url(enc.encode(JSON.stringify({iss:env.FCM_CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})));
 const pem=env.FCM_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/-----[^-]+-----|\s/g,''),key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(header+'.'+payload));
 const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:header+'.'+payload+'.'+b64url(new Uint8Array(signature))}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('FCM_AUTH_FAILED');const result=await response.json();if(!result.access_token)throw new Error('FCM_AUTH_FAILED');
 if(oauthCache.size>3)oauthCache.clear();oauthCache.set(cacheKey,{token:result.access_token,expires:Date.now()+Math.min(3600,Number(result.expires_in)||3600)*1000});return result.access_token;
}
export function chatPush(config,env,h,fetcher=fetch){
 const db=config.db;
 async function register(me,request,raw){
  if(!pushConfigured(env))throw h.failure(503,'Notificações com o aplicativo fechado aguardam configuração do Firebase.');
  if(raw.consent!==true||typeof raw.token!=='string'||raw.token.length<40||raw.token.length>4096||/[\s\x00-\x1f]/.test(raw.token))throw h.failure(400,'Autorize as notificações neste dispositivo.');
  const access=(request.headers.get('Authorization')||'').replace(/^Bearer /,''),device=await db.prepare('SELECT d.device_id FROM session_devices d JOIN auth_devices a ON a.id=d.device_id WHERE d.session_hash=? AND a.user_id=? AND a.revoked_at IS NULL').bind(await h.hash(config,access),me.id).first();
  if(!device)throw h.failure(409,'Renove a sessão para registrar este dispositivo.');
  const tokenHash=await h.hash(config,'fcm:'+raw.token);
  await db.batch([db.prepare('DELETE FROM push_devices WHERE token_hash=? AND device_id<>?').bind(tokenHash,device.device_id),db.prepare('INSERT INTO push_devices(device_id,user_id,token_hash,token_cipher,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET token_hash=excluded.token_hash,token_cipher=excluded.token_cipher,updated_at=excluded.updated_at').bind(device.device_id,me.id,tokenHash,await h.seal(config,raw.token),Date.now())]);
  return{enabled:true};
 }
 async function unregister(me,request){const access=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');await db.prepare('DELETE FROM push_devices WHERE user_id=? AND device_id IN(SELECT device_id FROM session_devices WHERE session_hash=?)').bind(me.id,await h.hash(config,access)).run();return{enabled:false};}
 function enqueue(id,to){return db.prepare('INSERT OR IGNORE INTO push_outbox(message_id,device_id,next_at,expires_at) SELECT ?,p.device_id,?,? FROM push_devices p JOIN auth_devices a ON a.id=p.device_id WHERE p.user_id=? AND a.revoked_at IS NULL AND a.refresh_expires_at>?').bind(id,Date.now(),Date.now()+86400000,to,Date.now());}
 async function drain(){
  if(!pushConfigured(env))return{configured:false,sent:0};let sent=0;
  await db.prepare('DELETE FROM push_outbox WHERE expires_at<? OR attempts>=5 OR message_id IN(SELECT id FROM messages WHERE read_at IS NOT NULL OR delivered_at IS NOT NULL) OR device_id IN(SELECT id FROM auth_devices WHERE revoked_at IS NOT NULL OR refresh_expires_at<?)').bind(Date.now(),Date.now()).run();
  const due=await db.prepare('SELECT o.*,p.token_cipher,m.sender,m.recipient FROM push_outbox o JOIN push_devices p ON p.device_id=o.device_id JOIN messages m ON m.id=o.message_id WHERE o.next_at<=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.owner=m.sender AND b.peer=m.recipient) OR (b.owner=m.recipient AND b.peer=m.sender)) ORDER BY o.next_at LIMIT 20').bind(Date.now()).all();
  for(const row of due.results){const lease=await db.prepare('UPDATE push_outbox SET next_at=?,attempts=attempts+1 WHERE message_id=? AND device_id=? AND next_at<=? RETURNING attempts').bind(Date.now()+60000,row.message_id,row.device_id,Date.now()).first();if(!lease)continue;
   try{const token=await h.unseal(config,row.token_cipher),access=await accessToken(env,fetcher),response=await fetcher('https://fcm.googleapis.com/v1/projects/'+env.FCM_PROJECT_ID+'/messages:send',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({message:{token,notification:{title:'ZapDMR · ZapChat',body:'Você tem uma nova mensagem. Toque para abrir.'},data:{zapdmrPeer:row.sender,zapdmrMessage:row.message_id},android:{priority:'normal',ttl:'86400s',collapse_key:row.sender,notification:{channel_id:'zapchat_messages',tag:row.message_id}}}}),signal:AbortSignal.timeout(10000)});
    if(response.ok){sent++;await db.prepare('DELETE FROM push_outbox WHERE message_id=? AND device_id=?').bind(row.message_id,row.device_id).run();}
    else{let result={};try{result=await response.json();}catch{}if(result.error?.details?.some(d=>d.errorCode==='UNREGISTERED'))await db.prepare('DELETE FROM push_devices WHERE device_id=?').bind(row.device_id).run();else throw new Error('FCM_SEND_FAILED');}
   }catch{await db.prepare('UPDATE push_outbox SET next_at=? WHERE message_id=? AND device_id=?').bind(Date.now()+Math.min(3600000,60000*2**lease.attempts),row.message_id,row.device_id).run();}
  }return{configured:true,sent};
 }
 return{register,unregister,enqueue,drain};
}
