import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handleApi} from '../../site/cloudflare/api.mjs';
import {fixture} from './chat-fixture.mjs';

const f=await fixture();
const webhookToken='fixture-whatsapp-bridge-token-'.repeat(2);
Object.assign(f.env,{
  WHATSAPP_CONFIRM_NUMBER:'+15550002222',
  WHATSAPP_WEBHOOK_TOKEN:webhookToken,
  WHATSAPP_LOCAL_BRIDGE:'1'
});

const aes=await crypto.subtle.importKey('raw',Buffer.from(f.env.DATA_ENCRYPTION_KEY,'hex'),'AES-GCM',false,['decrypt']);
async function decryptChallenge(registrationId){
  const cipher=f.sqlite.prepare('SELECT challenge_cipher FROM codes WHERE registration_id=?').get(registrationId).challenge_cipher;
  const data=Buffer.from(cipher,'base64'),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:data.subarray(0,12),tagLength:128},aes,data.subarray(12));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function register(callsign,dmrId,whatsapp){
  const result=await f.request(null,'/v1/registrations',{callsign,dmrId,whatsapp,platform:'android',noticeAccepted:true,requestVerification:true});
  assert.equal(result.response.status,201);
  return result.json();
}
async function status(registrationId,challengeToken){
  return (await f.request(null,'/v1/auth/status',{registrationId,challengeToken})).json();
}
async function webhook(number,text){
  const request=new Request('http://localhost/v1/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+webhookToken},body:JSON.stringify({number,text})});
  const response=await handleApi(request,f.env);
  assert.equal(response.status,200);
  return response.json();
}
function setDelivery(registrationId,statusValue,ageMs){
  const now=Date.now();
  f.sqlite.prepare('UPDATE codes SET requested_at=? WHERE registration_id=?').run(now-ageMs,registrationId);
  f.sqlite.prepare('UPDATE whatsapp_outbox SET status=?,attempts=1,lease_until=0 WHERE registration_id=?').run(statusValue,registrationId);
}

try{
  f.sqlite.prepare('INSERT INTO whatsapp_bridge_state(id,last_seen_at,connected) VALUES(1,?,1)').run(Date.now());

  const sent=await register('HOT1A','1000011','+15550001111');
  assert.equal(sent.challenge.mode,'bridge');
  setDelivery(sent.registrationId,'sent',89000);
  assert.equal((await status(sent.registrationId,sent.challenge.challengeToken)).challenge.mode,'bridge','sent remains bridge before 90 seconds');
  setDelivery(sent.registrationId,'sent',91000);
  const fallback=await status(sent.registrationId,sent.challenge.challengeToken);
  assert.equal(fallback.challenge.mode,'reverse','sent without delivered must fall back after 90 seconds');
  assert.match(fallback.challenge.whatsappUrl,/^https:\/\/wa\.me\//);
  assert.match(fallback.challenge.displayCode,/^\d{6}$/);

  const sentPlain=await decryptChallenge(sent.registrationId);
  const wrong=await webhook('+15550003333',`ZapDMR CONFIRMAR ${sentPlain.token} ${sentPlain.code}`);
  assert.equal(wrong.confirmed,false,'a different sender cannot confirm the challenge');
  assert.equal(f.sqlite.prepare('SELECT reverse_confirmed_at FROM codes WHERE registration_id=?').get(sent.registrationId).reverse_confirmed_at,null);
  const confirmed=await webhook('+15550001111',`ZapDMR CONFIRMAR ${sentPlain.token} ${sentPlain.code}`);
  assert.equal(confirmed.confirmed,true);
  assert.equal((await status(sent.registrationId,sentPlain.token)).status,'confirmed');
  const reverseVerify=await f.request(null,'/v1/auth/verify',{registrationId:sent.registrationId,challengeToken:sentPlain.token,code:sentPlain.code});
  assert.equal(reverseVerify.response.status,200,'confirmed reverse challenge accepts the code');

  const lateReceipt=await register('HOT2B','1000012','+15550001112');
  setDelivery(lateReceipt.registrationId,'delivered',91000);
  const deliveredStatus=await status(lateReceipt.registrationId,lateReceipt.challenge.challengeToken);
  assert.equal(deliveredStatus.challenge.mode,'bridge','delivered receipt prevents reverse fallback');
  assert.equal(deliveredStatus.challenge.delivered,true);

  const noReceipt=await register('HOT3C','1000013','+15550001113');
  f.sqlite.prepare("UPDATE whatsapp_outbox SET status='sent' WHERE registration_id=?").run(noReceipt.registrationId);
  const noReceiptPlain=await decryptChallenge(noReceipt.registrationId);
  const bridgeVerify=await f.request(null,'/v1/auth/verify',{registrationId:noReceipt.registrationId,code:noReceiptPlain.code});
  assert.equal(bridgeVerify.response.status,200,'a correct bridge code remains valid without a delivered receipt');
  assert.equal((await bridgeVerify.json()).user.verificationMethod,'bridge');

  const official=await register('HOT4D','1000014','+15550002222');
  setDelivery(official.registrationId,'sent',91000);
  const officialStatus=await status(official.registrationId,official.challenge.challengeToken);
  assert.equal(officialStatus.challenge.mode,'bridge','the official number cannot self-confirm through reverse fallback');

  const site=fs.readFileSync('site/public/site.js','utf8'),app=fs.readFileSync('web/community.js','utf8');
  assert.match(site,/data\.challenge\?\.mode === 'reverse' && flow\.mode === 'bridge'/,'current download page handles bridge-to-reverse transition');
  assert.match(app,/\['mode','sent','challengeToken','whatsappUrl'\].*setChallenge\(next,true\)/,'current application client applies a changed challenge mode');

  console.log('PASS: sent is not treated as delivered; 90 s reverse fallback, sender binding, delivered preservation, no-receipt OTP verification, official-number guard, and current-client compatibility. No WhatsApp message sent.');
}finally{f.sqlite.close();}
