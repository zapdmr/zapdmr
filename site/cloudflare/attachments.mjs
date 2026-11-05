// Private encrypted attachments on the existing D1 database. No public bucket URLs.
const MAX=15*1024*1024,CHUNK=512*1024,USER_QUOTA=75*1024*1024,GLOBAL_QUOTA=250*1024*1024;
const enc=new TextEncoder();
const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp4:'video/mp4',webm:'audio/webm',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',wav:'audio/wav',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',zip:'application/zip',rar:'application/vnd.rar',dat:'application/octet-stream',rdt:'application/octet-stream',bin:'application/octet-stream'};
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function attachmentName(value){const name=String(value||'').normalize('NFC').trim();if(!name||name.length>140||/[\\/\x00-\x1f\x7f]/.test(name)||name==='.'||name==='..'||!Object.hasOwn(types,name.split('.').pop().toLowerCase()))throw fail(400,'Formato de arquivo não permitido. Escolha uma foto, documento ou codeplug da lista.');return name;}
function mimeFor(name){return types[name.split('.').pop().toLowerCase()];}
function checkContent(bytes,mime){
  const starts=(...v)=>v.every((n,i)=>bytes[i]===n),ascii=(at,n)=>String.fromCharCode(...bytes.subarray(at,at+n));
  if(mime==='image/jpeg'&&!starts(255,216,255)||mime==='image/png'&&!starts(137,80,78,71,13,10,26,10)||mime==='image/webp'&&!(ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP')||['video/mp4','audio/mp4'].includes(mime)&&ascii(4,4)!=='ftyp'||mime==='audio/webm'&&!starts(26,69,223,163)||mime==='audio/ogg'&&ascii(0,4)!=='OggS'||mime==='audio/wav'&&!(ascii(0,4)==='RIFF'&&ascii(8,4)==='WAVE')||mime==='audio/aac'&&!(bytes[0]===255&&(bytes[1]&246)===240)||mime==='application/pdf'&&ascii(0,5)!=='%PDF-'||mime==='application/zip'&&!(starts(80,75,3,4)||starts(80,75,5,6)||starts(80,75,7,8))||mime==='application/vnd.rar'&&!(starts(82,97,114,33,26,7,0)||starts(82,97,114,33,26,7,1,0)))throw fail(400,'O conteúdo do arquivo não corresponde à extensão.');
  if(mime.startsWith('text/')){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw fail(400,'O documento de texto precisa estar em UTF-8.');}if(bytes.includes(0))throw fail(400,'O documento contém dados binários.');}
}
async function readBounded(request,limit=MAX,limitMessage='O limite é de 15 MB por arquivo.'){
  const declared=Number(request.headers.get('Content-Length'));if(declared>limit)throw fail(413,limitMessage);
  const reader=request.body?.getReader();if(!reader)throw fail(400,'Escolha um arquivo.');let size=0;const parts=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw fail(413,limitMessage);}parts.push(value);}}finally{reader.releaseLock();}
  if(!size)throw fail(400,'O arquivo está vazio.');const bytes=new Uint8Array(size);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length;}return bytes;
}
export function attachments(config,{seal,unseal,pairAvailable,rate,json}){
  const db=config.db;
  const metadata=async row=>({id:row.id,name:await unseal(config,row.name_cipher),size:row.size,mime:row.mime,kind:row.mime.startsWith('image/')?'image':row.mime.startsWith('video/')?'video':row.mime.startsWith('audio/')?'audio':'document'});
  async function upload(request,url,me){
    const to=String(url.searchParams.get('to')||''),name=attachmentName(url.searchParams.get('name')),mime=mimeFor(name);
    if(to===me.id||!await pairAvailable(config,me.id,to))throw fail(404,'Este contacto não está disponível.');
    await rate(config,request,'uploads',12,3600000,me.id);
    const bytes=await readBounded(request);checkContent(bytes,mime);const id=crypto.randomUUID(),now=Date.now();
    // Quota reservation is one atomic SQLite statement, so concurrent uploads cannot overbook it.
    const row=await db.prepare(`INSERT INTO attachments(id,sender,recipient,name_cipher,mime,size,created_at,ready)
      SELECT ?,?,?,?,?,?,?,0 WHERE (SELECT COALESCE(SUM(size),0) FROM attachments)+?<=?
      AND (SELECT COALESCE(SUM(size),0) FROM attachments WHERE sender=?)+?<=?
      AND (SELECT COUNT(*) FROM attachments a WHERE a.sender=? AND NOT EXISTS(SELECT 1 FROM message_attachments ma WHERE ma.attachment_id=a.id))<3 RETURNING *`)
      .bind(id,me.id,to,await seal(config,name),mime,bytes.length,now,bytes.length,GLOBAL_QUOTA,me.id,bytes.length,USER_QUOTA,me.id).first();
    if(!row)throw fail(507,'O espaço gratuito para anexos está cheio ou há envios pendentes. Cancele o envio pendente ou tente mais tarde.');
    try{
      // 30 chunks at most; stays below the free plan's 50 statements per request.
      const statements=[];
      for(let at=0,index=0;at<bytes.length;at+=CHUNK,index++){
        const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(id+':'+index)},config.aes,bytes.subarray(at,at+CHUNK));
        statements.push(db.prepare('INSERT INTO attachment_chunks(attachment_id,part,iv,cipher) VALUES(?,?,?,?)').bind(id,index,iv.buffer,cipher));
      }
      statements.push(db.prepare('UPDATE attachments SET ready=1 WHERE id=?').bind(id));await db.batch(statements);
      return json(201,{attachment:await metadata(row)});
    }catch(error){await db.prepare('DELETE FROM attachments WHERE id=?').bind(id).run();throw error;}
  }
  async function remove(id,me){await db.prepare('DELETE FROM attachments WHERE id=? AND sender=? AND NOT EXISTS(SELECT 1 FROM message_attachments ma WHERE ma.attachment_id=attachments.id)').bind(id,me.id).run();return json(200,{deleted:true});}
  async function download(id,request,url,me){
    const row=await db.prepare('SELECT a.* FROM attachments a JOIN message_attachments ma ON ma.attachment_id=a.id WHERE a.id=? AND a.ready=1 AND (a.sender=? OR a.recipient=?)').bind(id,me.id,me.id).first();
    if(!row||!await pairAvailable(config,me.id,row.sender===me.id?row.recipient:row.sender))throw fail(404,'Arquivo indisponível.');
    const name=await unseal(config,row.name_cipher),disposition=/^(image|audio|video)\//.test(row.mime)&&url.searchParams.get('download')!=='1'?'inline':'attachment';
    let part=0,remaining=row.size;
    const stream=new ReadableStream({async pull(controller){try{
      if(request.signal.aborted){controller.error(new Error('Pedido cancelado.'));return;}
      const chunk=await db.prepare('SELECT iv,cipher FROM attachment_chunks WHERE attachment_id=? AND part=?').bind(id,part).first();
      if(!chunk)throw new Error('Arquivo incompleto.');
      const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(chunk.iv),additionalData:enc.encode(id+':'+part)},config.aes,new Uint8Array(chunk.cipher)));
      part++;remaining-=plain.length;controller.enqueue(plain);if(remaining===0)controller.close();else if(remaining<0)throw new Error('Arquivo inválido.');
    }catch(error){controller.error(error);}}});
    return new Response(stream,{headers:{'Content-Type':row.mime,'Content-Length':String(row.size),'Content-Disposition':`${disposition}; filename="zapdmr.${name.split('.').pop().toLowerCase()}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  return {upload,remove,download,metadata};
}

// Authenticated profile photos. They are encrypted at rest in D1 and are
// never exposed through a public bucket URL or fetched from QRZ.com.
export function profilePhotos(config,{pairAvailable,rate,json}){
  const db=config.db,limit=2*1024*1024,allowed=new Set(['image/jpeg','image/png','image/webp']);
  async function upload(request,me){
    await rate(config,request,'profile-photos',10,86400000,me.id);
    const mime=String(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
    if(!allowed.has(mime))throw fail(400,'Use uma foto JPG, PNG ou WebP.');
    const bytes=await readBounded(request,limit,'A foto deve ter no máximo 2 MB.');checkContent(bytes,mime);
    const version=Date.now(),statements=[
      db.prepare('DELETE FROM profile_photo_chunks WHERE user_id=?').bind(me.id),
      db.prepare(`INSERT INTO profile_photos(user_id,mime,size,version,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime,size=excluded.size,version=excluded.version,updated_at=excluded.updated_at`).bind(me.id,mime,bytes.length,version,version)
    ];
    for(let at=0,part=0;at<bytes.length;at+=CHUNK,part++){
      const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`profile:${me.id}:${version}:${part}`)},config.aes,bytes.subarray(at,at+CHUNK));
      statements.push(db.prepare('INSERT INTO profile_photo_chunks(user_id,part,iv,cipher) VALUES(?,?,?,?)').bind(me.id,part,iv.buffer,cipher));
    }
    await db.batch(statements);return json(200,{photo:{version,url:`/v1/users/${me.id}/photo?v=${version}`}});
  }
  async function remove(me){await db.prepare('DELETE FROM profile_photos WHERE user_id=?').bind(me.id).run();return json(200,{deleted:true});}
  async function download(userId,request,me){
    if(userId!==me.id&&!await pairAvailable(config,me.id,userId))throw fail(404,'Foto indisponível.');
    const row=await db.prepare('SELECT p.* FROM profile_photos p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND u.whatsapp_verified=1').bind(userId).first();
    if(!row)throw fail(404,'Foto indisponível.');
    if(request.headers.get('If-None-Match')===`"${row.version}"`)return new Response(null,{status:304,headers:{ETag:`"${row.version}"`,'Cache-Control':'private, max-age=3600'}});
    const chunks=await db.prepare('SELECT part,iv,cipher FROM profile_photo_chunks WHERE user_id=? ORDER BY part').bind(userId).all(),plain=[];let size=0;
    for(const chunk of chunks.results){const value=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(chunk.iv),additionalData:enc.encode(`profile:${userId}:${row.version}:${chunk.part}`)},config.aes,new Uint8Array(chunk.cipher)));plain.push(value);size+=value.length;}
    if(size!==Number(row.size))throw fail(500,'Foto incompleta.');
    const bytes=new Uint8Array(size);let offset=0;for(const value of plain){bytes.set(value,offset);offset+=value.length;}
    return new Response(bytes,{headers:{'Content-Type':row.mime,'Content-Length':String(size),'Cache-Control':'private, max-age=3600','ETag':`"${row.version}"`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  return{upload,remove,download};
}
