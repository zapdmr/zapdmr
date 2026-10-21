// Source contracts complement the pure-JVM packet tests; this is not an Android device test.
const fs=require('fs'),assert=require('assert/strict');
const service=fs.readFileSync('android/app/src/main/java/br/radio/zapdmr/RadioSessionService.java','utf8');
const send=service.slice(service.indexOf('private void sendHbp('),service.indexOf('private void acquireWakeLock('));
assert(send.includes('synchronized(receiveGuard)'));assert(send.indexOf('blocksPacket(bytes')<send.indexOf('active.send('));
const start=service.slice(service.indexOf('private void beginPtt('),service.indexOf('private void armTot('));
assert(start.includes('if(txStopping)'));assert(start.includes('receiveGuard.busy('));assert(start.indexOf('sendDmr(')<start.indexOf('txHeaderSent=true'));
const stop=service.slice(service.indexOf('private void stopPtt('),service.indexOf('private void stopRecorder('));
assert(stop.includes('closeTransmission=txHeaderSent;txHeaderSent=false'));assert(stop.includes('if(closeTransmission&&connected'));assert(stop.includes('finally {txStopping=false;}'));
assert(service.includes('if(ptt.get()||txStopping)'));assert(service.includes('state="disconnected";stateMessage="ZapDMR desconectado."'));
const spp=fs.readFileSync('android/app/src/main/java/br/radio/zapdmr/BluetoothSppController.java','utf8');
assert(spp.includes('ACTION_PTT_'));assert(service.includes('ACTION_PTT_DOWN.equals(action)'));assert(service.includes('private void togglePtt(){if(ptt.get())stopPtt();else startPtt('));
const app=fs.readFileSync('web/operation-controls.js','utf8');assert(app.includes('if(desired&&gatewayStatus.rxBusy)'));assert(!app.includes('await mobileAudio.startPtt(group?.id,group?.slot||settings.defaultSlot||1);mobilePttActive=true'));
console.log('PASS source contracts: all native inputs converge, final UDP guard, no terminator after rejected header, serialized TX cleanup, guarded disconnect and native TX confirmation.');
