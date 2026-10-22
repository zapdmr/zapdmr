export function chatInbox(config,h){
 const db=config.db;
 const peerView=row=>({id:row.id,callsign:row.callsign,dmrId:row.dmr_id,displayName:row.display_name||row.callsign});
 async function conversations(me,before=0){
  const rows=await db.prepare(`WITH threads AS (
   SELECT CASE WHEN sender=? THEN recipient ELSE sender END AS peer,MAX(at) AS last_at,
    SUM(CASE WHEN recipient=? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
   FROM messages WHERE sender=? OR recipient=? GROUP BY peer)
   SELECT u.*,t.last_at,t.unread FROM threads t JOIN users u ON u.id=t.peer
   WHERE u.whatsapp_verified=1 AND (?=0 OR t.last_at<?) AND NOT EXISTS(
    SELECT 1 FROM blocks b WHERE (b.owner=? AND b.peer=u.id) OR (b.owner=u.id AND b.peer=?))
   ORDER BY t.last_at DESC,u.id LIMIT 50`).bind(me.id,me.id,me.id,me.id,before,before,me.id,me.id).all();
  return{conversations:rows.results.map(row=>({peer:peerView(row),lastAt:row.last_at,unread:Number(row.unread)})),hasMore:rows.results.length===50,before:rows.results.at(-1)?.last_at||0};
 }
 async function inbox(me){
  const summary=await conversations(me),pending=await db.prepare(h.messageSelect+` JOIN users sender ON sender.id=m.sender
   WHERE m.recipient=? AND m.delivered_at IS NULL AND m.read_at IS NULL AND sender.whatsapp_verified=1
   AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.owner=? AND b.peer=m.sender) OR (b.owner=m.sender AND b.peer=?))
   ORDER BY m.at,m.id LIMIT 50`).bind(me.id,me.id,me.id).all();
  const unread=await db.prepare(`SELECT COUNT(*) AS total FROM messages m WHERE m.recipient=? AND m.read_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.owner=? AND b.peer=m.sender) OR (b.owner=m.sender AND b.peer=?))`).bind(me.id,me.id,me.id).first();
  return{...summary,unreadTotal:Number(unread?.total||0),pendingMessages:await Promise.all(pending.results.map(async row=>({...await h.publicMessage(config,row,me.id),peerId:row.sender})))};
 }
 async function delivered(me,ids){
  if(!Array.isArray(ids)||ids.length<1||ids.length>50||ids.some(id=>!/^[a-f0-9-]{32,64}$/i.test(id)))throw h.failure(400,'Confirmação de recebimento inválida.');
  const unique=[...new Set(ids)],marks=unique.map(()=>'?').join(',');
  const changed=await db.prepare(`WITH base AS MATERIALIZED (
   SELECT MAX(?,COALESCE(MAX(MAX(COALESCE(read_at,0),COALESCE(delivered_at,0))),0)+1) AS first_at FROM messages),
   pending AS MATERIALIZED (SELECT id,ROW_NUMBER() OVER(ORDER BY at,id)-1 AS ordinal FROM messages m
    WHERE recipient=? AND delivered_at IS NULL AND id IN(${marks})
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.owner=? AND b.peer=m.sender) OR (b.owner=m.sender AND b.peer=?)))
   UPDATE messages SET delivered_at=(SELECT first_at FROM base)+(SELECT ordinal FROM pending WHERE pending.id=messages.id)
   WHERE id IN(SELECT id FROM pending)`).bind(Date.now(),me.id,...unique,me.id,me.id).run();
  return{ok:true,changed:Number(changed.meta.changes||0)};
 }
 return{conversations,inbox,delivered};
}
