// ZapChat authorization is independent from radio/app activation and is bound to one authenticated device.
export function zapchatActivation(config,h){
 const db=config.db,TTL=600000;
 const platform=value=>value==='windows'?'windows':'android';
 async function device(me){
  if(!me.session_device_id)throw h.failure(409,'Atualize a sessão protegida deste dispositivo antes de ativar o ZapChat.',{code:'SESSION_REFRESH_REQUIRED'});
  const row=await db.prepare('SELECT * FROM auth_devices WHERE id=? AND user_id=? AND revoked_at IS NULL AND refresh_expires_at>?').bind(me.session_device_id,me.id,Date.now()).first();
  if(!row)throw h.failure(401,'A sessão deste dispositivo foi revogada.',{code:'SESSION_REVOKED'});return row;
 }
 async function authorization(me){
  if(!me.session_device_id)return null;
  return db.prepare('SELECT * FROM zapchat_device_authorizations WHERE device_id=? AND user_id=? AND revoked_at IS NULL').bind(me.session_device_id,me.id).first();
 }
 async function read(me){const row=await authorization(me);return{authorized:Boolean(row),deviceId:me.session_device_id||null,platform:row?.platform||null,inherited:Boolean(row?.inherited),authorizedAt:row?.authorized_at||null};}
 async function requireAuthorization(me,request){
  if(request.headers.get('X-ZapDMR-ZapChat-Protocol')!=='2')return;
  const row=await authorization(me);if(!row)throw h.failure(403,'Ative o ZapChat uma vez neste dispositivo.',{code:'ZAPCHAT_ACTIVATION_REQUIRED'});
  if(Date.now()-Number(row.last_seen_at)>60000)await db.prepare('UPDATE zapchat_device_authorizations SET last_seen_at=? WHERE device_id=? AND revoked_at IS NULL').bind(Date.now(),row.device_id).run();
 }
 async function registration(me){
  if(me.verification_method==='email'&&me.email_verified===1){const row=await db.prepare(`SELECT r.* FROM email_registrations r WHERE r.callsign=? AND r.dmr_id=? AND r.email_hash=? AND r.verified_at IS NOT NULL ORDER BY r.verified_at DESC,r.created_at DESC LIMIT 1`).bind(me.callsign,me.dmr_id,me.email_hash).first();if(row)return{channel:'email',row};}
  const row=await db.prepare(`SELECT r.* FROM registrations r WHERE r.callsign=? AND r.dmr_id=? AND r.phone_hash=? AND r.whatsapp_verified=1 ORDER BY r.verified_at DESC,r.created_at DESC LIMIT 1`).bind(me.callsign,me.dmr_id,me.phone_hash).first();
  if(!row)throw h.failure(409,'O cadastro confirmado desta conta não está disponível. Preserve a conta e confirme os dados com o administrador.');return{channel:'whatsapp',row};
 }
 async function issue(me,request,raw){
  const current=await authorization(me);if(current)return{authorized:true,deviceId:current.device_id};
  const authDevice=await device(me),registrationInfo=await registration(me),channel=registrationInfo.channel,row=registrationInfo.row,now=Date.now(),prior=await db.prepare('SELECT requested_at FROM zapchat_activation_codes WHERE device_id=?').bind(authDevice.id).first();
  if(prior&&prior.requested_at+60000>now)throw h.failure(429,'Aguarde para reenviar o código do ZapChat.',{retryAfterSeconds:Math.ceil((prior.requested_at+60000-now)/1000)});
  if(channel==='email'){
   await h.rate(config,request,'zapchat-otp-email',1,60000,row.email_hash);const code=h.otpCode(),codeHash=await h.hash(config,`zapchat:${me.id}:${authDevice.id}:${code}`),cipher=await h.seal(config,JSON.stringify({code})),targetPlatform=platform(raw.platform);
   await db.prepare(`INSERT INTO zapchat_activation_codes(device_id,user_id,registration_id,channel,platform,hash,expires_at,attempts,requested_at,mode,challenge_hash,challenge_cipher,reverse_confirmed_at)
    VALUES(?,?,?,'email',?,?,?,0,?,'email',?,?,NULL) ON CONFLICT(device_id) DO UPDATE SET registration_id=excluded.registration_id,channel='email',platform=excluded.platform,hash=excluded.hash,expires_at=excluded.expires_at,attempts=0,requested_at=excluded.requested_at,mode='email',challenge_hash=excluded.challenge_hash,challenge_cipher=excluded.challenge_cipher,reverse_confirmed_at=NULL`).bind(authDevice.id,me.id,row.id,targetPlatform,codeHash,now+TTL,now,await h.hash(config,'zapchat-email:'+authDevice.id+':'+now),cipher).run();
   try{const email=await h.unseal(config,row.email_cipher),destination=await h.sendZapchatEmailCode(h.env,row,email,code,request,h.failure);return{authorized:false,deviceId:authDevice.id,challenge:{mode:'email',sent:true,expiresInSeconds:TTL/1000,retryAfterSeconds:60,destination,message:'Código do ZapChat enviado por e-mail. Verifique também a caixa de spam.'}};}catch(error){await db.prepare("DELETE FROM zapchat_activation_codes WHERE device_id=? AND hash=? AND channel='email'").bind(authDevice.id,codeHash).run();throw error;}
  }
  let mode=await h.verificationMode(config,h.env);if(mode==='unavailable')return{authorized:false,challenge:{mode,sent:false,expiresInSeconds:600,retryAfterSeconds:60,message:'A confirmação aguarda a conexão da ponte WhatsApp oficial.'}};
  if(mode==='reverse'&&await h.isOfficialPhoneHash(config,h.env,row.phone_hash))return{authorized:false,challenge:h.officialConfirmationUnavailable()};
  await h.rate(config,request,'zapchat-otp-phone',1,60000,row.phone_hash);
  const plain={code:h.otpCode(),token:h.randomToken()},codeHash=await h.hash(config,`zapchat:${me.id}:${authDevice.id}:${plain.code}`),challengeHash=await h.hash(config,'zapchat-challenge:'+plain.token),cipher=await h.seal(config,JSON.stringify(plain)),targetPlatform=platform(raw.platform);
  await db.batch([
   db.prepare("DELETE FROM whatsapp_outbox WHERE registration_id=? AND purpose='zapchat'").bind(row.id),
   db.prepare(`INSERT INTO zapchat_activation_codes(device_id,user_id,registration_id,channel,platform,hash,expires_at,attempts,requested_at,mode,challenge_hash,challenge_cipher,reverse_confirmed_at)
    VALUES(?,?,?,'whatsapp',?,?,?,0,?,?,?,?,NULL) ON CONFLICT(device_id) DO UPDATE SET registration_id=excluded.registration_id,channel='whatsapp',platform=excluded.platform,hash=excluded.hash,expires_at=excluded.expires_at,attempts=0,requested_at=excluded.requested_at,mode=excluded.mode,challenge_hash=excluded.challenge_hash,challenge_cipher=excluded.challenge_cipher,reverse_confirmed_at=NULL`).bind(authDevice.id,me.id,row.id,targetPlatform,codeHash,now+TTL,now,mode,challengeHash,cipher)
  ]);
  if(mode==='direct')try{await h.deliverCode(config,h.env,request,row,plain.code);}catch(error){
   const official=await h.isOfficialPhoneHash(config,h.env,row.phone_hash);if(!h.reverseConfigured(h.env)||official){await db.prepare('DELETE FROM zapchat_activation_codes WHERE device_id=? AND hash=?').bind(authDevice.id,codeHash).run();return{authorized:false,challenge:official?h.officialConfirmationUnavailable():{mode:'unavailable',sent:false,expiresInSeconds:600,retryAfterSeconds:60,message:error.message}};}mode='reverse';await db.prepare("UPDATE zapchat_activation_codes SET mode='reverse' WHERE device_id=? AND hash=?").bind(authDevice.id,codeHash).run();
  }
  if(mode==='bridge')await db.prepare("INSERT INTO whatsapp_outbox(id,registration_id,code_hash,purpose,payload_cipher,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),row.id,codeHash,'zapchat',await h.seal(config,JSON.stringify({number:await h.unseal(config,row.phone_cipher),text:h.otpMessage(row.callsign,plain.code)})),'queued',now,now+TTL).run();
  return{authorized:false,deviceId:authDevice.id,challenge:await h.challengeView(config,h.env,{registration_id:row.id,hash:codeHash,requested_at:now,expires_at:now+TTL,mode},plain)};
 }
 async function status(me,raw){
  const auth=await authorization(me);if(auth)return{authorized:true,deviceId:auth.device_id};const authDevice=await device(me),token=String(raw.challengeToken||'');if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw h.failure(400,'Confirmação do ZapChat inválida.');
  const row=await db.prepare('SELECT c.*,r.phone_hash FROM zapchat_activation_codes c JOIN registrations r ON r.id=c.registration_id WHERE c.device_id=? AND c.user_id=? AND c.challenge_hash=?').bind(authDevice.id,me.id,await h.hash(config,'zapchat-challenge:'+token)).first();
  if(!row||row.expires_at<=Date.now()||row.attempts>=5)return{authorized:false,status:'expired',expiresInSeconds:0,retryAfterSeconds:0};
  const plain=JSON.parse(await h.unseal(config,row.challenge_cipher)),challenge=await h.challengeView(config,h.env,row,plain);return{authorized:false,status:row.mode==='reverse'&&row.reverse_confirmed_at?'confirmed':'pending',challenge,expiresInSeconds:challenge.expiresInSeconds,retryAfterSeconds:challenge.retryAfterSeconds};
 }
 async function verify(me,raw){
  const current=await authorization(me);if(current)return{authorized:true,deviceId:current.device_id,inherited:Boolean(current.inherited)};const authDevice=await device(me),code=String(raw.code||''),now=Date.now();if(!/^\d{6}$/.test(code))throw h.failure(400,'Digite exatamente os seis dígitos do ZapChat.');
  const pending=await db.prepare('SELECT * FROM zapchat_activation_codes WHERE device_id=? AND user_id=? AND expires_at>? AND attempts<5').bind(authDevice.id,me.id,now).first();if(!pending)throw h.failure(401,'Código do ZapChat expirado ou bloqueado. Solicite outro.');
  if(pending.mode==='reverse'){if(!/^[A-Za-z0-9_-]{43}$/.test(String(raw.challengeToken||''))||!await h.sameHash(config,'zapchat-challenge:'+raw.challengeToken,pending.challenge_hash))throw h.failure(401,'Confirmação do ZapChat inválida.');if(!pending.reverse_confirmed_at)throw h.failure(409,'Ainda aguardamos a confirmação enviada pelo WhatsApp cadastrado.');}
  const attempt=await db.prepare('UPDATE zapchat_activation_codes SET attempts=attempts+1 WHERE device_id=? AND hash=? AND expires_at>? AND attempts<5 RETURNING *').bind(authDevice.id,pending.hash,now).first();if(!attempt||!await h.sameHash(config,`zapchat:${me.id}:${authDevice.id}:${code}`,attempt.hash))throw h.failure(401,'Código do ZapChat incorreto.');
  const consumed=await db.prepare('DELETE FROM zapchat_activation_codes WHERE device_id=? AND user_id=? AND hash=? AND expires_at>? RETURNING *').bind(authDevice.id,me.id,attempt.hash,now).first();if(!consumed)throw h.failure(401,'O código do ZapChat já foi utilizado. Solicite outro.');
  const statements=[
   db.prepare('INSERT INTO zapchat_device_authorizations(device_id,user_id,platform,authorized_at,inherited,last_seen_at,revoked_at) VALUES(?,?,?,?,0,?,NULL) ON CONFLICT(device_id) DO NOTHING').bind(authDevice.id,me.id,consumed.platform,now,now),
  ];if(consumed.channel==='whatsapp')statements.push(db.prepare("DELETE FROM whatsapp_outbox WHERE registration_id=? AND code_hash=? AND purpose='zapchat'").bind(consumed.registration_id,consumed.hash));await db.batch(statements);
  return{authorized:true,deviceId:authDevice.id,platform:consumed.platform,inherited:false};
 }
 async function confirmReverse(token,code,from){
  const now=Date.now(),row=await db.prepare("SELECT c.*,r.phone_hash FROM zapchat_activation_codes c JOIN registrations r ON r.id=c.registration_id WHERE c.channel='whatsapp' AND c.challenge_hash=? AND c.expires_at>? AND c.attempts<5 AND c.mode='reverse'").bind(await h.hash(config,'zapchat-challenge:'+token),now).first();if(!row||!await h.sameHash(config,`zapchat:${row.user_id}:${row.device_id}:${code}`,row.hash))return false;
  const fromHashes=await Promise.all(h.phoneVariants(from).map(number=>h.hash(config,number)));if(!fromHashes.includes(row.phone_hash))return false;await db.prepare("UPDATE zapchat_activation_codes SET reverse_confirmed_at=? WHERE device_id=? AND hash=? AND expires_at>? AND mode='reverse'").bind(now,row.device_id,row.hash,now).run();return true;
 }
 return{read,issue,status,verify,requireAuthorization,confirmReverse};
}
