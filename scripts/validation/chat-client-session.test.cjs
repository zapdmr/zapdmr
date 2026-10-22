const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),{webcrypto}=require('node:crypto');
(async()=>{const context={window:{},fetch,AbortSignal,crypto:webcrypto,Date,Error};vm.runInNewContext(fs.readFileSync('web/community-session.js','utf8'),context);vm.runInNewContext(fs.readFileSync('web/community-outbox.js','utf8'),context);
 let config={token:'old',refreshToken:'refresh',account:{id:'A'},accessExpiresAt:0},saved=0,rotations=0,mode='ok',revoked=0;
 const session=context.window.createCommunitySession({getConfig:()=>config,save:async()=>saved++,endpoint:()=> 'https://example.invalid',onRevoked:()=>revoked++,fetcher:async(url,options)=>{
  if(url.endsWith('/auth/refresh')){rotations++;if(mode==='offline')throw Error('offline');if(mode==='revoked')return Response.json({code:'SESSION_REVOKED',message:'revogada'},{status:401});return Response.json({token:'new',refreshToken:'newrefresh',accessExpiresAt:Date.now()+3600000});}
  if(url.endsWith('/auth/verify'))return Response.json({message:'OTP incorreto'},{status:401});return Response.json({ok:true});
 }});
 await Promise.all([session.remote('/v1/inbox'),session.remote('/v1/inbox')]);assert.equal(rotations,1);assert.equal(config.token,'new');
 await assert.rejects(session.remote('/v1/auth/verify',{code:'000000'}));assert.equal(config.token,'new','OTP failure does not clear chat session');
 mode='offline';await assert.rejects(session.renew());assert.equal(config.token,'new','network failure retains protected account');
 let fail=true,received=new Map();const outbox=context.window.createCommunityOutbox({getConfig:()=>config,save:async()=>saved++,remote:async(path,data)=>{received.set(data.clientId,data);if(fail)throw Error('reply lost');return{id:'server'};}});
 const pending=await outbox.enqueue('B','Rádio');await outbox.drain();assert.equal(outbox.list()[0].state,'failed');const snapshot=JSON.stringify(config);
 config=JSON.parse(snapshot);fail=false;await outbox.drain();assert.equal(received.size,1,'reopening and retry retains identical id');assert.equal(outbox.list().length,0);
 mode='revoked';await assert.rejects(session.renew());assert.equal(config.token,undefined);assert.equal(revoked,1);
 assert.ok(saved>=5);console.log('PASS: refresh single-flight, OTP/network failure retains login, confirmed revocation clears login, durable retry after reopen without duplicate ID.');
})().catch(error=>{console.error(error);process.exitCode=1;});
