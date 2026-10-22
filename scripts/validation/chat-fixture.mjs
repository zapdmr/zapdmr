import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHmac} from 'node:crypto';
import {handleApi,cleanup} from '../../site/cloudflare/api.mjs';
export async function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(await readFile(new URL('../../site/cloudflare/schema.sql',import.meta.url),'utf8'));
 let queries=0;
 const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values);},async first(){queries++;return sqlite.prepare(sql).get(...args.map(fix))??null;},async run(){queries++;const r=sqlite.prepare(sql).run(...args.map(fix));return{success:true,results:[],meta:{changes:Number(r.changes)}};},async all(){queries++;return{results:sqlite.prepare(sql).all(...args.map(fix))};},sql,args});
 const fix=x=>x instanceof ArrayBuffer?new Uint8Array(x):x;
 const db={prepare:wrap,withSession(){return this;},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements){queries++;const stmt=sqlite.prepare(s.sql);let rows=[];if(stmt.columns().length)rows=stmt.all(...s.args.map(fix));else stmt.run(...s.args.map(fix));result.push({success:true,results:rows,meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}});}sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const key=randomBytes(32).toString('hex'),env={DB:db,DATA_ENCRYPTION_KEY:key,DOWNLOAD_SECRET:randomBytes(32).toString('hex'),ADMIN_PASSWORD:randomBytes(25).toString('hex'),PUBLIC_ORIGIN:'https://www.zapdmr.com.br',OWNER_NAME:'Local test',PRIVACY_EMAIL:'test@example.invalid'};
 const aes=await crypto.subtle.importKey('raw',Buffer.from(key,'hex'),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12)),phoneCipher=Buffer.concat([iv,Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode('+15555550101')))]).toString('base64');
 const tokens={},users={};for(const [i,call]of ['TEST1A','TEST1B','TEST1C'].entries()){const id=crypto.randomUUID(),token=randomBytes(32).toString('base64url');users[call]=id;tokens[call]=token;sqlite.prepare('INSERT INTO users(id,callsign,dmr_id,phone_cipher,phone_hash,share_phone,created_at,verified_at,whatsapp_verified,verification_method) VALUES(?,?,?,?,?,0,?,?,1,?)').run(id,call,String(1000000+i),phoneCipher,randomBytes(32).toString('hex'),Date.now(),Date.now(),'local-fixture');sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHmac('sha256',Buffer.from(key,'hex')).update(token).digest('hex'),id,Date.now()+3600000);}
 async function request(call,route,data,method){queries=0;const binary=data instanceof Uint8Array,req=new Request('http://localhost'+route,{method:method||(data?'POST':'GET'),headers:{...(call?{Authorization:'Bearer '+tokens[call]}:{}),'Content-Type':binary?'application/octet-stream':'application/json'},...(data?{body:binary?data:JSON.stringify(data)}:{})});const response=await handleApi(req,env);return{response,async json(){const result=await response.json();return result;},get queries(){return queries;}};}
 return{sqlite,env,tokens,users,request,cleanup:()=>cleanup(env)};
}
