// Device activation is an opaque, single-use capability issued only to a verified session.
export function onboarding(config,h){
 const db=config.db,TTL=600000;
 function code(value){const normalized=String(value||'').replace(/-/g,'').toUpperCase();if(!/^[A-F0-9]{32}$/.test(normalized))throw h.failure(401,'Código de ativação inválido, expirado ou já utilizado.');return normalized;}
 async function issue(me){
  if(!me.whatsapp_verified)throw h.failure(403,'Confirme seu WhatsApp antes de ativar outro dispositivo.');
  const plain=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(),now=Date.now();
  await db.batch([db.prepare('DELETE FROM app_activations WHERE user_id=? OR expires_at<=?').bind(me.id,now),db.prepare('INSERT INTO app_activations(hash,user_id,expires_at) VALUES(?,?,?)').bind(await h.hash(config,'activate:'+plain),me.id,now+TTL)]);
  return{activationCode:plain.match(/.{4}/g).join('-'),expiresInSeconds:TTL/1000,singleUse:true};
 }
 async function redeem(value){
  const digest=await h.hash(config,'activate:'+code(value));
  // DELETE RETURNING is atomic: two devices cannot redeem the same capability.
  const ticket=await db.prepare('DELETE FROM app_activations WHERE hash=? AND expires_at>? RETURNING user_id').bind(digest,Date.now()).first();
  if(!ticket)throw h.failure(401,'Código de ativação inválido, expirado ou já utilizado. Gere outro no site.');
  const me=await db.prepare('SELECT * FROM users WHERE id=? AND whatsapp_verified=1').bind(ticket.user_id).first();
  if(!me)throw h.failure(401,'Cadastro não disponível. Confirme seu número novamente.');
  const service=h.sessions(),p=await service.prepare(me.id);
  await db.batch([db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').bind(p.hash,me.id,p.value.accessExpiresAt),...service.issueStatements(p,p.hash)]);
  return{...p.value,user:await h.publicUser(config,me,true)};
 }
 function preferences(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['preferredNetwork','theme','chatSound'].includes(k)))throw h.failure(400,'Preferências não autorizadas.');
  const out={};
  if(raw.preferredNetwork!==undefined){if(!['dmr','xlx'].includes(raw.preferredNetwork))throw h.failure(400,'Rede inválida.');out.preferredNetwork=raw.preferredNetwork;}
  if(raw.theme!==undefined){if(!['auto','light','dark'].includes(raw.theme))throw h.failure(400,'Tema inválido.');out.theme=raw.theme;}
  if(raw.chatSound!==undefined){if(typeof raw.chatSound!=='boolean')throw h.failure(400,'Som inválido.');out.chatSound=raw.chatSound;}
  return out;
 }
 async function read(me){const row=await db.prepare('SELECT * FROM app_preferences WHERE user_id=?').bind(me.id).first();return{revision:row?.revision||0,preferences:row?preferences(JSON.parse(await h.unseal(config,row.cipher))):{}};}
 async function save(me,raw){
  const revision=Number(raw.revision);if(!Number.isSafeInteger(revision)||revision<0||revision>2147483646)throw h.failure(400,'Revisão inválida.');
  const value=preferences(raw.preferences),cipher=await h.seal(config,JSON.stringify(value));
  const row=await db.prepare(`INSERT INTO app_preferences(user_id,revision,cipher,updated_at) SELECT ?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM app_preferences WHERE user_id=? AND revision=?)
   ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,cipher=excluded.cipher,updated_at=excluded.updated_at WHERE app_preferences.revision=excluded.revision-1 RETURNING revision`).bind(me.id,revision+1,cipher,Date.now(),revision,me.id,revision).first();
  if(!row)throw h.failure(409,'As preferências mudaram em outro dispositivo. Carregue novamente antes de salvar.');
  return{revision:row.revision,preferences:value};
 }
 return{issue,redeem,read,save,preferences};
}
