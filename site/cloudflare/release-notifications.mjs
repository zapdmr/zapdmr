// Optional release notices are independent of account/OTP and phone-directory consent.
// Each version/user is unique. Once dispatch starts, uncertain outcomes are never
// retried automatically: WhatsApp does not provide an exactly-once send primitive.
const CONSENT_VERSION='2026-10-20-whatsapp-updates-1',WEEK=604800000;
const VERSION=/^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LEASE=/^[A-Za-z0-9_-]{43}$/;
function canonicalVersion(value){const match=VERSION.exec(String(value||''));return match?'v'+match.slice(1).map(Number).join('.'):null;}
function newerVersion(next,prior){const left=canonicalVersion(next)?.slice(1).split('.').map(Number),right=canonicalVersion(prior)?.slice(1).split('.').map(Number);if(!left)return false;if(!right)return true;for(let i=0;i<3;i++){if(left[i]!==right[i])return left[i]>right[i];}return false;}
function configuredVersion(config,platform){try{const url=new URL(config.downloads[platform]);return canonicalVersion(decodeURIComponent(url.pathname.split('/')[5]));}catch{return null;}}
export function createReleaseNotifications(h){
  async function preference(config,userId){const row=await config.db.prepare('SELECT update_notifications,update_consent_at FROM users WHERE id=?').bind(userId).first();return {updateNotifications:Boolean(row?.update_notifications),updateNotificationsConsentAt:row?.update_consent_at||null};}
  async function setPreference(config,userId,enabled,at=Date.now()){
    if(typeof enabled!=='boolean')return preference(config,userId);
    const row=await config.db.prepare('SELECT phone_hash,phone_cipher FROM users WHERE id=?').bind(userId).first();if(!row)throw h.failure(404,'Perfil não encontrado.');
    const statements=[config.db.prepare('UPDATE users SET update_notifications=?,update_consent_at=?,update_consent_version=? WHERE id=?').bind(enabled?1:0,enabled?at:null,enabled?CONSENT_VERSION:null,userId)];
    if(enabled){const phone=await h.unseal(config,row.phone_cipher),hashes=await Promise.all(h.phoneVariants(phone).map(number=>h.hash(config,number)));for(const hash of hashes)statements.push(config.db.prepare('DELETE FROM release_notification_suppressions WHERE phone_hash=?').bind(hash));}
    else statements.push(config.db.prepare("UPDATE release_notification_outbox SET status='canceled' WHERE user_id=? AND status IN('queued','leased')").bind(userId));
    await config.db.batch(statements);return preference(config,userId);
  }
  async function registrationConsent(config,id,enabled){if(typeof enabled!=='boolean')return;await config.db.prepare('UPDATE registrations SET update_notifications=?,update_consent_at=? WHERE id=?').bind(enabled?1:0,enabled?Date.now():null,id).run();}
  async function activateConsent(config,registrationId,userId){const row=await config.db.prepare('SELECT update_notifications,update_consent_at FROM registrations WHERE id=? AND whatsapp_verified=1').bind(registrationId).first();if(row&&row.update_notifications!==null)await setPreference(config,userId,row.update_notifications===1,row.update_consent_at||Date.now());}
  async function markDownload(config,registrationId,platform,version){
    const release=canonicalVersion(version)||configuredVersion(config,platform);if(!release)return;const now=Date.now();
    await config.db.batch([
      config.db.prepare('UPDATE registrations SET downloaded_at=?,downloaded_version=? WHERE id=? AND whatsapp_verified=1').bind(now,release,registrationId),
      config.db.prepare(`UPDATE users SET downloaded_at=?,downloaded_version=? WHERE whatsapp_verified=1 AND EXISTS(SELECT 1 FROM registrations r WHERE r.id=? AND r.whatsapp_verified=1 AND r.callsign=users.callsign AND r.dmr_id=users.dmr_id AND r.phone_hash=users.phone_hash)`).bind(now,release,registrationId)
    ]);
  }
  async function stop(config,raw){
    if(!/^(STOP|PARAR|SAIR)$/i.test(String(raw.text||'').trim()))return {accepted:true,stopped:false};
    const number=h.normalizePhone(raw.number),hashes=await Promise.all(h.phoneVariants(number).map(value=>h.hash(config,value))),now=Date.now(),marks=hashes.map(()=>'?').join(',');
    await config.db.batch([
      ...hashes.map(hash=>config.db.prepare('INSERT INTO release_notification_suppressions(phone_hash,stopped_at) VALUES(?,?) ON CONFLICT(phone_hash) DO UPDATE SET stopped_at=excluded.stopped_at').bind(hash,now)),
      config.db.prepare(`UPDATE users SET update_notifications=0,update_consent_at=NULL,update_consent_version=NULL WHERE phone_hash IN(${marks})`).bind(...hashes),
      config.db.prepare(`UPDATE registrations SET update_notifications=0,update_consent_at=NULL WHERE phone_hash IN(${marks})`).bind(...hashes),
      config.db.prepare(`UPDATE release_notification_outbox SET status='canceled' WHERE status IN('queued','leased') AND user_id IN(SELECT id FROM users WHERE phone_hash IN(${marks}))`).bind(...hashes)
    ]);return {accepted:true,stopped:true};
  }
  async function officialRelease(version){
    const tag=version&&canonicalVersion(version);if(version&&!tag)throw h.failure(400,'Informe uma versão no formato 1.4.0.');
    // /latest excludes GitHub prerelease metadata. ZapDMR's published beta
    // channel uses ordinary semantic tags, so inspect published releases too.
    let response;try{response=await fetch('https://api.github.com/repos/zapdmr/zapdmr/releases'+(tag?'/tags/'+encodeURIComponent(tag):'?per_page=10'),{headers:{Accept:'application/vnd.github+json','User-Agent':'ZapDMR-release-notifications','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(7000)});}catch{throw h.failure(503,'Não foi possível consultar a publicação oficial.');}
    if(!response.ok){await response.body?.cancel();throw h.failure(503,'A versão ainda não está publicada no repositório oficial.');}
    const payload=await response.json(),releases=tag?[payload]:(Array.isArray(payload)?payload:[]);
    const valid=releases.filter(raw=>raw&&canonicalVersion(raw.tag_name)&&!raw.draft&&Number.isFinite(Date.parse(raw.published_at||''))&&Date.parse(raw.published_at)<=Date.now()+300000&&raw.html_url==='https://github.com/zapdmr/zapdmr/releases/tag/'+raw.tag_name);
    valid.sort((left,right)=>newerVersion(left.tag_name,right.tag_name)?-1:newerVersion(right.tag_name,left.tag_name)?1:Date.parse(right.published_at)-Date.parse(left.published_at));
    const raw=valid[0],canonical=canonicalVersion(raw?.tag_name),published=Date.parse(raw?.published_at||'');
    if(!raw||!canonical||tag&&canonical!==tag)throw h.failure(409,'A versão não é uma publicação válida.');
    const assets=Array.isArray(raw.assets)?raw.assets:[];
    if(!assets.some(asset=>asset.state==='uploaded'&&/\.apk$/i.test(asset.name||'')&&asset.size>0)||!assets.some(asset=>asset.state==='uploaded'&&/\.exe$/i.test(asset.name||'')&&asset.size>0))throw h.failure(409,'Publique primeiro os instaladores Windows e Android desta versão.');
    return {version:canonical,url:raw.html_url,publishedAt:published};
  }
  async function queueRelease(config,release){
    // The portal must already serve this release; never advertise unavailable downloads.
    if(!['android','windows'].every(platform=>configuredVersion(config,platform)===release.version))return {queued:0,complete:true,skipped:'downloads-not-current',version:release.version};
    const now=Date.now();if(release.publishedAt<now-WEEK)return {queued:0,complete:true,skipped:'release-too-old',version:release.version};
    await config.db.prepare('INSERT OR IGNORE INTO release_announcements(version,release_url,published_at,created_at) VALUES(?,?,?,?)').bind(release.version,release.url,release.publishedAt,now).run();
    const candidates=await config.db.prepare(`SELECT u.id,u.callsign,u.phone_cipher,u.downloaded_version FROM users u WHERE u.whatsapp_verified=1 AND u.update_notifications=1 AND u.update_consent_at<? AND u.downloaded_at IS NOT NULL AND u.downloaded_at<? AND NOT EXISTS(SELECT 1 FROM release_notification_suppressions s WHERE s.phone_hash=u.phone_hash) AND NOT EXISTS(SELECT 1 FROM release_notification_outbox q WHERE q.release_version=? AND q.user_id=u.id) ORDER BY u.id LIMIT 30`).bind(release.publishedAt,release.publishedAt,release.version).all();
    const statements=[];
    for(const user of candidates.results){
      const eligible=newerVersion(release.version,user.downloaded_version),number=eligible?await h.unseal(config,user.phone_cipher):null;
      const text=eligible?`*ZapDMR:* Olá ${user.callsign}, a versão ${release.version} já está disponível. Baixe pelo site oficial: https://www.zapdmr.com.br/#downloads . Para deixar de receber avisos, responda PARAR. Forte 73!`:'';
      // Record skipped current/newer installations as canceled to keep pagination progressing.
      statements.push(config.db.prepare(`INSERT OR IGNORE INTO release_notification_outbox(id,release_version,user_id,payload_cipher,status,created_at,expires_at) SELECT ?,?,?,?, ?,?,? WHERE EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.whatsapp_verified=1 AND u.update_notifications=1 AND u.update_consent_at<? AND NOT EXISTS(SELECT 1 FROM release_notification_suppressions s WHERE s.phone_hash=u.phone_hash))`).bind(crypto.randomUUID(),release.version,user.id,await h.seal(config,JSON.stringify(eligible?{number,text,version:release.version}:{})),eligible?'queued':'canceled',now,release.publishedAt+WEEK,user.id,release.publishedAt));
    }
    const results=statements.length?await config.db.batch(statements):[];
    return {version:release.version,queued:results.reduce((total,result,index)=>total+(candidates.results[index]&&newerVersion(release.version,candidates.results[index].downloaded_version)?Number(result.meta?.changes||0):0),0),complete:candidates.results.length<30};
  }
  async function discoverLatestRelease(config){return queueRelease(config,await officialRelease());}
  async function handleApi(request,env,url,config){
    if(url.pathname==='/admin/releases/notify'){
      if(request.method!=='POST')return h.json(405,{message:'Método não permitido.'},{Allow:'POST'});
      await h.rate(config,request,'release-admin',10,60000);let credentials='';try{const header=request.headers.get('Authorization')||'';if(header.startsWith('Basic '))credentials=new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)),value=>value.charCodeAt(0)));}catch{}
      if(!await h.sameHash(config,credentials,await h.hash(config,'admin:'+env.ADMIN_PASSWORD)))return h.json(401,{message:'Autenticação administrativa necessária.'},{'WWW-Authenticate':'Basic realm="ZapDMR"'});
      const raw=await h.body(request);return h.json(200,await queueRelease(config,await officialRelease(raw.version)));
    }
    if(!/^\/v1\/whatsapp\/updates\/(pull|start|ack|stop)$/.test(url.pathname))return null;
    if(request.method!=='POST')return h.json(405,{message:'Método não permitido.'},{Allow:'POST'});
    await h.bridgeAuth(config,env,request);await h.rate(config,request,'release-bridge',80,60000);const raw=await h.body(request),now=Date.now(),db=config.db;
    if(url.pathname.endsWith('/stop'))return h.json(200,await stop(config,raw));
    if(url.pathname.endsWith('/pull')){
      const provided=h.normalizePhone(raw.number),official=h.normalizePhone(env.WHATSAPP_CONFIRM_NUMBER);
      if(!h.phoneVariants(provided).includes(official))throw h.failure(403,'A ponte deve usar o número oficial.');
      if(raw.connected!==true)return h.json(200,{jobs:[]});
      const candidate=await db.prepare(`SELECT q.id FROM release_notification_outbox q JOIN users u ON u.id=q.user_id WHERE (q.status='queued' OR(q.status='leased' AND q.lease_until<?)) AND q.expires_at>? AND u.whatsapp_verified=1 AND u.update_notifications=1 AND NOT EXISTS(SELECT 1 FROM release_notification_suppressions s WHERE s.phone_hash=u.phone_hash) AND NOT EXISTS(SELECT 1 FROM whatsapp_outbox o WHERE o.status IN('queued','sending') AND o.expires_at>?) ORDER BY q.created_at,q.id LIMIT 1`).bind(now,now,now).first();
      if(!candidate)return h.json(200,{jobs:[]});
      const allowed=await db.prepare('UPDATE release_notification_throttle SET next_dispatch_at=? WHERE id=1 AND next_dispatch_at<=? RETURNING id').bind(now+30000,now).first();if(!allowed)return h.json(200,{jobs:[]});
      const leaseId=h.randomToken(),job=await db.prepare(`UPDATE release_notification_outbox SET status='leased',lease_id=?,lease_until=? WHERE id=? AND(status='queued' OR(status='leased' AND lease_until<?)) AND expires_at>? RETURNING id,payload_cipher`).bind(leaseId,now+60000,candidate.id,now,now).first();
      return h.json(200,{jobs:job?[{id:job.id,leaseId,kind:'release',...JSON.parse(await h.unseal(config,job.payload_cipher))}]:[]});
    }
    const id=String(raw.id||''),leaseId=String(raw.leaseId||'');if(!UUID.test(id)||!LEASE.test(leaseId))throw h.failure(400,'Resultado de aviso inválido.');
    if(url.pathname.endsWith('/start')){
      const row=await db.prepare(`UPDATE release_notification_outbox SET status='sending',started_at=?,lease_until=? WHERE id=? AND lease_id=? AND status='leased' AND lease_until>? AND expires_at>? AND EXISTS(SELECT 1 FROM users u WHERE u.id=release_notification_outbox.user_id AND u.update_notifications=1 AND u.whatsapp_verified=1 AND NOT EXISTS(SELECT 1 FROM release_notification_suppressions s WHERE s.phone_hash=u.phone_hash)) RETURNING id`).bind(now,now+120000,id,leaseId,now,now).first();return h.json(200,{allowed:Boolean(row)});
    }
    if(!['sent','delivered','failed','unknown'].includes(raw.status))throw h.failure(400,'Estado do aviso inválido.');
    const fields=raw.status==='delivered'?'delivered_at=?':raw.status==='sent'?'submitted_at=?':'lease_until=?';
    await db.prepare(`UPDATE release_notification_outbox SET status=?,${fields} WHERE id=? AND lease_id=? AND status IN('sending','sent','unknown'${raw.status==='failed'?",'leased'":''})`).bind(raw.status,raw.status==='unknown'?0:now,id,leaseId).run();return h.json(200,{ok:true});
  }
  function cleanupStatements(config,now){return [
    config.db.prepare("UPDATE release_notification_outbox SET status='unknown' WHERE status='sending' AND lease_until<?").bind(now),
    config.db.prepare("UPDATE release_notification_outbox SET status='expired' WHERE status IN('queued','leased') AND expires_at<?").bind(now),
    // Keep compact id/version/user tombstones for dedup, discard recipient/text ciphertext.
    config.db.prepare("UPDATE release_notification_outbox SET payload_cipher='' WHERE expires_at<? AND payload_cipher<>''").bind(now)
  ];}
  return {handleApi,preference,setPreference,registrationConsent,activateConsent,markDownload,discoverLatestRelease,cleanupStatements};
}
