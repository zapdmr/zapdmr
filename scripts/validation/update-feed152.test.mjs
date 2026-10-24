import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../../site/cloudflare/worker.mjs';
import {sendOfficialRelease} from '../../site/cloudflare/whatsapp-official.mjs';
const feed=JSON.parse(fs.readFileSync('site/public/updates/stable.json','utf8'));let db=0;
const env={PUBLIC_ORIGIN:'https://www.zapdmr.com.br',ASSETS:{fetch:async()=>new Response(JSON.stringify(feed),{headers:{'Content-Type':'application/json'}})}};
Object.defineProperty(env,'DB',{get(){db++;throw Error('Update reads must not use D1');}});
for(const p of ['/updates/stable.json','/v1/app-releases/android']){const r=await worker.fetch(new Request(env.PUBLIC_ORIGIN+p),env,{});assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');const data=await r.json();assert.equal(p.startsWith('/v1')?data.release.version:data.platforms.android.version,'1.5.1');}
assert.equal(db,0);assert.equal(feed.channel,'stable');assert.equal(feed.platforms.windows.version,'1.5.1');assert.equal(feed.platforms.android.versionCode,23);
assert.deepEqual(await sendOfficialRelease({}, {},()=>{throw Error('must not send')}),{status:'pending_configuration',sent:false});
console.log('PASS static feed and legacy endpoint: zero D1 access/writes, 1.5.1 stable unchanged, WhatsApp pending configuration sends nothing.');
