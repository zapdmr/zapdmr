// Opaque access credentials + rotating device refresh credentials. No passwords or tokens in logs.
export function sessionService(config,h){
 const db=config.db,HOUR=3600000,IDLE=180*86400000,GRACE=120000;
 const fail=(code,message)=>h.failure(401,message,{code});
 async function prepare(userId,token=h.randomToken(),bootstrapHash=null){
  const now=Date.now(),refreshToken=h.randomToken(),deviceId=crypto.randomUUID();
  const value={token,refreshToken,deviceId,accessExpiresAt:now+HOUR,refreshExpiresAt:now+IDLE};
  return{value,hash:await h.hash(config,token),refreshHash:await h.hash(config,'refresh:'+refreshToken),cipher:await h.seal(config,JSON.stringify(value)),userId,now,bootstrapHash};
 }
 function issueStatements(p,guardHash){
  return[
   db.prepare(`INSERT INTO auth_devices(id,user_id,refresh_hash,refresh_expires_at,rotated_at,created_at,last_seen_at,token_cipher,bootstrap_hash)
    SELECT ?,?,?,?,?,?,?,?,? FROM sessions s WHERE s.hash=? AND NOT EXISTS(SELECT 1 FROM session_devices d WHERE d.session_hash=?)`).bind(p.value.deviceId,p.userId,p.refreshHash,p.value.refreshExpiresAt,p.now,p.now,p.now,p.cipher,p.bootstrapHash,guardHash,guardHash),
   db.prepare('INSERT INTO session_devices(session_hash,device_id) SELECT ?,id FROM auth_devices WHERE id=? ON CONFLICT(session_hash) DO NOTHING').bind(p.hash,p.value.deviceId)
  ];
 }
 async function bootstrap(user,accessToken){
  const legacyHash=await h.hash(config,accessToken),existing=await db.prepare('SELECT a.* FROM auth_devices a JOIN session_devices d ON d.device_id=a.id WHERE d.session_hash=?').bind(legacyHash).first();
  if(existing){
   if(existing.bootstrap_hash===legacyHash&&!existing.revoked_at&&Date.now()-existing.created_at<GRACE)return JSON.parse(await h.unseal(config,existing.token_cipher));
   throw fail('SESSION_REFRESH_REQUIRED','Renove a sessão com a credencial protegida deste dispositivo.');
  }
  const p=await prepare(user.id,undefined,legacyHash),statements=issueStatements(p,legacyHash);
  // The insert predicate wins once, even if two legacy bootstrap requests arrive together.
  await db.batch([
   statements[0],
   db.prepare('INSERT INTO sessions(hash,user_id,expires_at) SELECT ?,user_id,? FROM auth_devices WHERE id=?').bind(p.hash,p.value.accessExpiresAt,p.value.deviceId),
   statements[1],
   db.prepare('INSERT INTO session_devices(session_hash,device_id) SELECT ?,id FROM auth_devices WHERE id=? ON CONFLICT(session_hash) DO NOTHING').bind(legacyHash,p.value.deviceId),
   db.prepare('UPDATE sessions SET expires_at=MIN(expires_at,?) WHERE hash=? AND EXISTS(SELECT 1 FROM session_devices WHERE session_hash=?)').bind(p.value.accessExpiresAt,legacyHash,legacyHash)
  ]);
  const device=await db.prepare('SELECT a.* FROM auth_devices a JOIN session_devices d ON d.device_id=a.id WHERE d.session_hash=?').bind(legacyHash).first();
  if(!device||device.revoked_at)throw fail('SESSION_REVOKED','Esta sessão foi revogada. Entre novamente.');
  return JSON.parse(await h.unseal(config,device.token_cipher));
 }
 async function revoke(id){
  await db.batch([
   db.prepare('UPDATE auth_devices SET revoked_at=?,token_cipher=? WHERE id=?').bind(Date.now(),'',id),
   db.prepare('DELETE FROM sessions WHERE hash IN(SELECT session_hash FROM session_devices WHERE device_id=?)').bind(id)
  ]);
 }
 async function refresh(refreshToken){
  if(!/^[A-Za-z0-9_-]{43}$/.test(refreshToken||''))throw fail('SESSION_INVALID','Sessão protegida inválida. Entre novamente.');
  const supplied=await h.hash(config,'refresh:'+refreshToken),now=Date.now();
  const device=await db.prepare('SELECT * FROM auth_devices WHERE refresh_hash=? OR previous_hash=? LIMIT 1').bind(supplied,supplied).first();
  if(!device||device.revoked_at)throw fail('SESSION_REVOKED','A sessão deste dispositivo foi revogada. Entre novamente.');
  if(device.refresh_expires_at<=now)throw fail('SESSION_EXPIRED','Sessão encerrada por inatividade. Entre novamente.');
  if(device.previous_hash===supplied){
   if(now-device.rotated_at<=GRACE)return JSON.parse(await h.unseal(config,device.token_cipher));
   await revoke(device.id);throw fail('SESSION_REVOKED','Uma credencial antiga foi reutilizada. Confirme a conta novamente neste dispositivo.');
  }
  const token=h.randomToken(),nextRefresh=h.randomToken(),hash=await h.hash(config,token),nextHash=await h.hash(config,'refresh:'+nextRefresh);
  const value={token,refreshToken:nextRefresh,deviceId:device.id,accessExpiresAt:now+HOUR,refreshExpiresAt:now+IDLE},cipher=await h.seal(config,JSON.stringify(value));
  await db.batch([
   db.prepare(`UPDATE auth_devices SET previous_hash=refresh_hash,refresh_hash=?,refresh_expires_at=?,rotated_at=?,last_seen_at=?,token_cipher=?
    WHERE id=? AND refresh_hash=? AND revoked_at IS NULL AND refresh_expires_at>?`).bind(nextHash,value.refreshExpiresAt,now,now,cipher,device.id,supplied,now),
   db.prepare('INSERT INTO sessions(hash,user_id,expires_at) SELECT ?,user_id,? FROM auth_devices WHERE id=? AND refresh_hash=? AND revoked_at IS NULL').bind(hash,value.accessExpiresAt,device.id,nextHash),
   db.prepare('INSERT INTO session_devices(session_hash,device_id) SELECT ?,id FROM auth_devices WHERE id=? AND refresh_hash=? AND revoked_at IS NULL').bind(hash,device.id,nextHash)
  ]);
  const winner=await db.prepare('SELECT * FROM auth_devices WHERE id=?').bind(device.id).first();
  if(!winner||winner.revoked_at)throw fail('SESSION_REVOKED','Esta sessão foi revogada.');
  if(winner.refresh_hash!==nextHash&&winner.previous_hash!==supplied)throw fail('SESSION_REFRESH_REQUIRED','A sessão foi renovada em outra operação. Tente novamente.');
  return JSON.parse(await h.unseal(config,winner.token_cipher));
 }
 async function logout(request,refreshToken){
  const access=(request.headers.get('Authorization')||'').replace(/^Bearer /,''),hash=/^[A-Za-z0-9_-]{43}$/.test(access)?await h.hash(config,access):'';
  let device=hash?await db.prepare('SELECT d.device_id AS id FROM session_devices d JOIN sessions s ON s.hash=d.session_hash WHERE d.session_hash=? AND s.expires_at>?').bind(hash,Date.now()).first():null;
  if(!device&&/^[A-Za-z0-9_-]{43}$/.test(refreshToken||'')){const supplied=await h.hash(config,'refresh:'+refreshToken);device=await db.prepare('SELECT id FROM auth_devices WHERE revoked_at IS NULL AND refresh_expires_at>? AND (refresh_hash=? OR previous_hash=? AND rotated_at>?)').bind(Date.now(),supplied,supplied,Date.now()-GRACE).first();}
  if(device)await revoke(device.id);else if(hash)await db.prepare('DELETE FROM sessions WHERE hash=?').bind(hash).run();
  return{revoked:true};
 }
 return{prepare,issueStatements,bootstrap,refresh,logout};
}
