import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {handleApi} from '../../site/cloudflare/api.mjs';
import {fixture} from './chat-fixture.mjs';

const f=await fixture(),key=Buffer.from(f.env.DATA_ENCRYPTION_KEY,'hex');
f.env.WHATSAPP_CONFIRM_NUMBER='+15555550199';f.env.WHATSAPP_WEBHOOK_TOKEN=randomBytes(32).toString('hex');f.env.WHATSAPP_LOCAL_BRIDGE='1';
f.sqlite.prepare('INSERT INTO whatsapp_bridge_state(id,last_seen_at,connected) VALUES(1,?,1)').run(Date.now());
const own=f.sqlite.prepare('SELECT * FROM users WHERE callsign=?').get('TEST1A'),registration=crypto.randomUUID();
f.sqlite.prepare(`INSERT INTO registrations(id,callsign,dmr_id,phone_cipher,phone_hash,share_phone,platform,created_at,notice_version,whatsapp_verified,verified_at)
 VALUES(?,?,?,?,?,0,'android',?,?,1,?)`).run(registration,own.callsign,own.dmr_id,own.phone_cipher,own.phone_hash,Date.now(),'test',Date.now());

const hash=value=>createHmac('sha256',key).update(value).digest('hex');
async function api(token,route,data,method='POST',extra={}){const response=await handleApi(new Request('http://localhost'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},...(data!==undefined?{body:JSON.stringify(data)}:{})}),f.env);let value;try{value=await response.json();}catch{value={};}return{response,value};}
async function decrypt(value){const bytes=Buffer.from(value,'base64'),aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},aes,bytes.subarray(12))));}
async function bootstrap(legacyToken){const result=await api(legacyToken,'/v1/auth/session',{});assert.equal(result.response.status,200,JSON.stringify(result.value));return result.value;}

const first=await bootstrap(f.tokens.TEST1A);f.tokens.TEST1A=first.token;
let result=await api(first.token,'/v1/zapchat/activation',undefined,'GET');assert.deepEqual(result.value.authorized,false);
result=await api(first.token,'/v1/inbox',undefined,'GET',{'X-ZapDMR-ZapChat-Protocol':'2'});assert.equal(result.response.status,403);assert.equal(result.value.code,'ZAPCHAT_ACTIVATION_REQUIRED');
const requested=await api(first.token,'/v1/zapchat/activation/request',{platform:'android'});assert.equal(requested.response.status,200,JSON.stringify(requested.value));assert.equal(requested.value.challenge.mode,'bridge');
const queued=f.sqlite.prepare("SELECT * FROM whatsapp_outbox WHERE purpose='zapchat'").get();assert(queued);const pending=f.sqlite.prepare('SELECT * FROM zapchat_activation_codes WHERE device_id=?').get(first.deviceId),plain=await decrypt(pending.challenge_cipher);assert(/^\d{6}$/.test(plain.code));assert.notEqual(pending.hash,plain.code);assert.equal(pending.platform,'android');
const pulled=await api(f.env.WHATSAPP_WEBHOOK_TOKEN,'/v1/whatsapp/bridge/outbox',{number:f.env.WHATSAPP_CONFIRM_NUMBER,connected:true});assert.equal(pulled.response.status,200);assert.equal(pulled.value.jobs.length,1);assert.match(pulled.value.jobs[0].text,/código de confirmação de 6 dígitos/);assert(!pulled.value.jobs[0].text.includes('ZapChat'),'existing strict bridge message contract remains unchanged');
const verified=await api(first.token,'/v1/zapchat/activation/verify',{code:plain.code,challengeToken:requested.value.challenge.challengeToken});assert.equal(verified.value.authorized,true);assert.equal(verified.value.platform,'android');
const replay=await api(first.token,'/v1/zapchat/activation/verify',{code:plain.code,challengeToken:requested.value.challenge.challengeToken});assert.equal(replay.value.authorized,true,'an already authorized device remains idempotently authorized');
result=await api(first.token,'/v1/inbox',undefined,'GET',{'X-ZapDMR-ZapChat-Protocol':'2'});assert.equal(result.response.status,200,JSON.stringify(result.value));

// A second session for the same account becomes a distinct Windows device and needs its own code.
f.sqlite.prepare('DELETE FROM rate_limits');const legacy2=randomBytes(32).toString('base64url');f.sqlite.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run(hash(legacy2),own.id,Date.now()+3600000);const second=await bootstrap(legacy2);assert.notEqual(second.deviceId,first.deviceId);
result=await api(second.token,'/v1/zapchat/activation',undefined,'GET');assert.equal(result.value.authorized,false);
f.sqlite.prepare("DELETE FROM rate_limits WHERE bucket='zapchat-otp-phone'").run();
const secondRequest=await api(second.token,'/v1/zapchat/activation/request',{platform:'windows'});assert.equal(secondRequest.response.status,200,JSON.stringify(secondRequest.value));const secondPending=f.sqlite.prepare('SELECT * FROM zapchat_activation_codes WHERE device_id=?').get(second.deviceId),secondPlain=await decrypt(secondPending.challenge_cipher);assert.equal(secondPending.platform,'windows');
const wrongDevice=await api(second.token,'/v1/zapchat/activation/verify',{code:plain.code,challengeToken:requested.value.challenge.challengeToken});assert.equal(wrongDevice.response.status,401,'Android code cannot authorize Windows');
const secondVerified=await api(second.token,'/v1/zapchat/activation/verify',{code:secondPlain.code,challengeToken:secondRequest.value.challenge.challengeToken});assert.equal(secondVerified.value.authorized,true);assert.equal(secondVerified.value.platform,'windows');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM zapchat_device_authorizations WHERE user_id=?').get(own.id).n,2);

// The production migration preserves trusted pre-existing devices without changing radio/app activation.
const legacy=new DatabaseSync(':memory:');legacy.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE registrations(id TEXT PRIMARY KEY);CREATE TABLE auth_devices(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),refresh_expires_at INTEGER,revoked_at INTEGER,created_at INTEGER,last_seen_at INTEGER);CREATE TABLE whatsapp_outbox(id TEXT PRIMARY KEY,status TEXT,expires_at INTEGER,lease_until INTEGER);INSERT INTO users VALUES('u');INSERT INTO auth_devices VALUES('d','u',${Date.now()+86400000},NULL,${Date.now()-1000},${Date.now()});`);legacy.exec(await readFile(new URL('../../site/cloudflare/migrations/0009_zapchat_device_activation.sql',import.meta.url),'utf8'));const inherited=legacy.prepare('SELECT * FROM zapchat_device_authorizations WHERE device_id=?').get('d');assert.equal(inherited.inherited,1);assert.equal(inherited.platform,'legacy');legacy.close();

f.cleanup();console.log('PASS ZapChat activation: existing-device migration, independent Android/Windows authorization, hashed 6-digit OTP, current WhatsApp bridge queue, protocol gate and persistence. No real WhatsApp message sent.');
