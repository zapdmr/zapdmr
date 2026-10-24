import assert from 'node:assert/strict';
import {fixture} from './chat-fixture.mjs';

const f = await fixture();
try {
  // Reverse-only synthetic numbers keep the exercise entirely in memory: no WhatsApp calls.
  Object.assign(f.env,{WHATSAPP_CONFIRM_NUMBER:'+15550002222',WHATSAPP_WEBHOOK_TOKEN:'test-secret-only-in-memory-'.repeat(2)});
  const profile={callsign:'TEST2Z',dmrId:'1000009',whatsapp:'+15550001111',noticeAccepted:true,requestVerification:true};
  const first=await (await f.request(null,'/v1/registrations',profile)).json();
  assert.equal(first.challenge.mode,'reverse');
  const second=await (await f.request(null,'/v1/registrations',profile)).json();
  assert.equal(second.challenge.mode,'unavailable');
  assert.equal(second.challenge.reason,'rate_limited');
  assert.ok(second.challenge.retryAfterSeconds>0&&second.challenge.retryAfterSeconds<=60);
  assert.equal(second.challenge.displayCode,undefined);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM codes WHERE registration_id=?').get(first.registrationId).n,1);
  let last;
  for(let i=0;i<9;i++)last=await f.request(null,'/v1/registrations',{...profile,requestVerification:false});
  assert.equal(last.response.status,429);
  const limited=await last.json();
  assert.ok(limited.retryAfterSeconds>3500&&limited.retryAfterSeconds<=3600);
  console.log('PASS: phone and IP rate limits report remaining windows, preserve prior OTP, and do not expose a replacement code. No WhatsApp sent.');
} finally { f.sqlite.close(); }
