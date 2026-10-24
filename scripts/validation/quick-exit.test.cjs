const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.textContent='';this.open=false;}
 append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this[k]=v;}addEventListener(){}
 querySelector(q){return this.children.find(c=>c.tag===q);}showModal(){this.open=true;}close(){this.open=false;}
}
(async()=>{
 const dialogs=[],power=new Element('button'),notices=[];let completeExit,calls=0;
 const context={document:{body:{append:d=>dialogs.push(d)},createElement:t=>new Element(t),getElementById:()=>power,querySelectorAll:()=>[]},mobileAudio:{isAndroid:()=>true,quickExit:()=>{calls++;return new Promise(r=>completeExit=r);}},gatewayStatus:{connected:false,rxBusy:true},mobilePttActive:false,mobilePttPending:false,stopTalkgroupScan:()=>{},toast:s=>notices.push(s),window:{},navigator:{}};
 vm.runInNewContext(fs.readFileSync('web/participant-actions.js','utf8'),context);
 const dialog=dialogs[1],exit=dialog.children[3];
 assert.equal(dialog.children[0].textContent,'Deseja desconectar e fechar o ZapDMR?');assert.equal(exit.textContent,'Sair');
 power.onclick();assert(dialog.open,'May close even disconnected');await dialog.children[2].onclick();assert(!dialog.open&&calls===0,'Cancel has no side effects');
 context.mobilePttActive=true;power.onclick();assert(!dialog.open);assert.equal(notices.pop(),'Encerre a transmissão antes de sair.');
 context.mobilePttActive=false;power.onclick();context.mobilePttPending=true;await exit.onclick();assert.equal(calls,0,'Second TX check on confirmation');
 context.mobilePttPending=false;const done=exit.onclick();assert(dialog.open&&exit.disabled,'Wait for native cleanup');assert.equal(calls,1,'RX does not prevent exit');completeExit({closed:true});await done;assert(!dialog.open);
 // Execute production startup function with synthetic profile, without touching any account or network.
 const app=fs.readFileSync('web/app.js','utf8');const fn=app.slice(app.indexOf('async function reconnectMobileAfterOpen(){'),app.indexOf('\nasync function importMobileFirmware('));
 const settings={callsign:'TEST1A',dmrId:'1234567',essid:'02',masterHost:'test.invalid',masterPort:54006,selectedTalkgroupId:91,autoConnectOnStartup:false,autoReconnect:true};
 let resume=true,complete=true,fail=false;const attempts=[],messages=[];
 const startup={settings,mobileSecureConfig:{hotspotPassword:'fixture'},mobileAudio:{takeQuickExitResume:async()=>({resume}),connectRadio:async(...args)=>{if(fail)throw Error('Autorize as permissões do Android.');attempts.push(args);}},window:{ZapDMRCommunity:{isComplete:()=>complete}},setActiveScreen:()=>{},setActiveSettingsPane:()=>{},toast:m=>messages.push(m)};
 vm.createContext(startup);vm.runInContext(fn,startup);const before=JSON.stringify(settings);
 await startup.reconnectMobileAfterOpen();assert.equal(attempts.length,1);assert.equal(attempts[0][0],settings);assert.equal(attempts[0][2],true);assert.equal(JSON.stringify(settings),before,'Saved auto-connect preference/profile unchanged');
 resume=false;await startup.reconnectMobileAfterOpen();assert.equal(attempts.length,1,'Manual startup preference preserved after one-shot resume');
 settings.autoConnectOnStartup=true;await startup.reconnectMobileAfterOpen();assert.equal(attempts[1][2],false,'Existing normal startup unchanged');
 startup.mobileSecureConfig.hotspotPassword='';await startup.reconnectMobileAfterOpen();assert(messages.pop().includes('Hotspot Security Password'));assert.equal(attempts.length,2);
 startup.mobileSecureConfig.hotspotPassword='fixture';complete=false;await startup.reconnectMobileAfterOpen();assert(messages.pop().includes('WhatsApp'));complete=true;
 fail=true;await startup.reconnectMobileAfterOpen();assert.equal(messages.pop(),'Autorize as permissões do Android.');assert(!fn.includes('startPtt')&&!fn.includes('4000'));
 // Execute actual bridge: closing must not consume resume or accept a competing connect.
 let release,requests=0,reads=0;const plugin={quickExit:()=>new Promise(r=>release=r),connectRadio:async()=>requests++,takeQuickExitResume:async()=>{reads++;return{resume:true};}};
 const bridgeContext={window:{Capacitor:{getPlatform:()=> 'android',Plugins:{MobileAudio:plugin}}}};vm.runInNewContext(fs.readFileSync('web/mobile-audio.js','utf8'),bridgeContext);const bridge=bridgeContext.window.ZapDMRMobileAudio;
 const pending=bridge.quickExit();await assert.rejects(()=>bridge.connectRadio(settings,'fixture'));assert.equal(requests,0);assert.equal((await bridge.takeQuickExitResume()).resume,false);assert.equal(reads,0);release({closed:true});await pending;
 // Native wiring contracts complement functional JS/JVM tests.
 const service=fs.readFileSync('android/app/src/main/java/br/radio/zapdmr/RadioSessionService.java','utf8');
 const shutdown=service.slice(service.indexOf('if(ACTION_QUICK_EXIT.equals(action)){'),service.indexOf('if (ACTION_CONNECT.equals(action)) {'));
 assert(shutdown.includes('if(ptt.get()||txStopping)'));assert(shutdown.includes('sessionDesired=false;autoReconnect=false;'));assert(shutdown.includes('removeCallbacksAndMessages(null)'));assert(shutdown.includes('linkWorker.shutdownNow()'));assert(shutdown.includes('stopNetwork(true)'));assert(shutdown.includes('stopForeground(STOP_FOREGROUND_REMOVE)'));
 assert(service.includes('if(QuickExitState.blocked()){stopSelf();return START_NOT_STICKY;}'));assert(service.includes('if(!sessionDesired||QuickExitState.blocked())throw'));assert(service.includes('if(startupReceiveOnly||QuickExitState.blocked())return;'));
 const nativeBridge=fs.readFileSync('android/app/src/main/java/br/radio/zapdmr/MobileAudioPlugin.java','utf8');
 assert(nativeBridge.includes('"quickExitResult".equals(event)'));assert(nativeBridge.includes('exitRequest.equals(data.optString("requestId"))'));assert(nativeBridge.indexOf('if(!data.optBoolean("ok"))')<nativeBridge.indexOf('finishAndRemoveTask()'));assert(nativeBridge.includes('aprs.disconnect()'));
 assert(!/killProcess|System\.exit\(|Runtime\.getRuntime\(\)\.exit/.test(nativeBridge+service));
 console.log('PASS quick-exit UI, cancel/TX/RX, cleanup acknowledgement, one-shot resume, exact saved profile, missing credentials/permissions, bridge race guards and native cleanup contracts. No real network/device used.');
})().catch(e=>{console.error(e);process.exitCode=1;});
