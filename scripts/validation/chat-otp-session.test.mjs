import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {fixture} from './chat-fixture.mjs';
const f=await fixture(),h=value=>createHmac('sha256',Buffer.from(f.env.DATA_ENCRYPTION_KEY,'hex')).update(value).digest('hex');
async function registerModern(call,id,modern){const registrationId=crypto.randomUUID(),code='123456',cipher=f.sqlite.prepare('SELECT phone_cipher FROM users LIMIT 1').get().phone_cipher;
 f.sqlite.prepare('INSERT INTO registrations(id,callsign,dmr_id,phone_cipher,phone_hash,share_phone,platform,created_at,notice_version) VALUES(?,?,?,?,?,0,?,?,?)').run(registrationId,call,id,cipher,randomBytes(32).toString('hex'),'android',Date.now(),'local-test');
 f.sqlite.prepare('INSERT INTO codes(registration_id,hash,expires_at,attempts,mode) VALUES(?,?,?,0,?)').run(registrationId,h(registrationId+':'+code),Date.now()+600000,'bridge');
 const raw={registrationId,code,...(modern?{sessionProtocol:2}:{})},result=await f.request(null,'/v1/auth/verify',raw),data=await result.json();assert.equal(result.response.status,200,JSON.stringify(data));
 assert.equal((await f.request(null,'/v1/auth/verify',raw)).response.status,401,'OTP remains single use');return data;
}
const modern=await registerModern('TEST2D','1000008',true);assert.equal(modern.expiresInSeconds,3600);assert.equal(modern.refreshToken.length,43);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM session_devices').get().n,1);
const refresh=await (await f.request(null,'/v1/auth/refresh',{refreshToken:modern.refreshToken})).json();assert.notEqual(refresh.refreshToken,modern.refreshToken);
const legacy=await registerModern('TEST3D','1000018',false);assert.equal(legacy.expiresInDays,30);assert.equal(legacy.refreshToken,undefined);
console.log('PASS: real OTP verification handler issues renewable v2 session atomically, preserves legacy 30-day clients and rejects OTP replay. Synthetic code inserted in local SQLite; no WhatsApp sent.');
