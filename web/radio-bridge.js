/* Platform adapters for the shared radio console. Credentials never enter localStorage. */
(() => {
  const ui=window.ZapDMRConsole;if(!ui)return;
  const native=()=>Boolean(mobileAudio?.isAndroid?.());
  let aprsPlugin;try{aprsPlugin=window.Capacitor?.Plugins?.Aprs||window.Capacitor?.registerPlugin?.('Aprs');}catch{}
  let lastStatus={},lastConnection,rxActive=false,lastIncoming=0,contactsSignature='',lastPosition=null,targetPendingUntil=0;
  const checked=async(url,options={})=>{const result=await callApi(url,options);if(!result.ok)throw new Error(result.data?.message||result.data?.error||'O serviço local não respondeu.');return result.data;};
  const post=(url,data={})=>checked(url,{method:'POST',body:JSON.stringify(data),signal:AbortSignal.timeout(25000)});
  window.ZapDMRDesktop?.onScan(()=>$('#scanTalkgroups').click());
  const notify=(title,body)=>{
    if(native())return;const p=settings.console?.notifications||{};
    if(p.sound!==false)try{playTotAlert();}catch{}
    if(p.vibrate!==false)navigator.vibrate?.(120);
    if('Notification'in window&&Notification.permission==='granted')try{new Notification(title,{body,icon:'/ZapDMR.png'});}catch{}
  };
  const aprsEvent=value=>{ui.aprsEvent(value);if(value?.event==='status'){for(const row of value.data?.messages||[])ui.aprsEvent({event:'message',data:row});for(const row of value.data?.stations||[])ui.aprsEvent({event:'station',data:row});}};
  async function locate(){const position=native()?await aprsPlugin.requestPosition():await new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}),reject,{enableHighAccuracy:true,maximumAge:0,timeout:20000}):reject(new Error('A localização não está disponível.')));lastPosition=position;return position;}
  async function savePatch(patch){
    const previous=settings;settings={...settings,...patch};
    if(patch.console)settings.console={...previous.console,...patch.console};
    if(patch.operation)settings.operation={...previous.operation,...patch.operation};
    // APRS passcodes are connection arguments only, including after restoring older exports.
    if(settings.console?.aprs){delete settings.console.aprs.passcode;delete settings.console.aprs.password;}
    try{await persist();await window.ZapDMROperation?.apply();applySettingsToForm(settings);}catch(error){settings=previous;throw error;}
  }
  async function target(contact){
    if(gatewayStatus.pttArmed||mobilePttActive)throw new Error('Termine o PTT antes de escolher o contacto.');
    if(!gatewayStatus.connected)throw new Error('Ligue primeiro ao master para escolher uma chamada privada.');
    if(talkgroupBurstStatus.pending||gatewayStatus.linkPending)throw new Error('Aguarde a troca de canal terminar.');stopTalkgroupScan();const id=Number(contact?.id);if(contact&&(!Number.isInteger(id)||id<1||id>0xffffff))throw new Error('Radio ID inválido.');
    const command={destinationId:contact?id:0,callType:contact?'private':'group',slot:settings.defaultSlot||1};
    if(native())await mobileAudio.radioControl({action:'target',...command});else await post('/api/voice-target',command);
    targetPendingUntil=Date.now()+1500;privateContact=contact?{...contact,id}:null;renderSelected();reflectTarget();renderAudioMeter({direction:'RX',level:0});
    if(!contact)await tuneSelectedTalkgroup(settings.selectedTalkgroupId);
  }
  function reflectTarget(){
    if(!privateContact)return;
    $('#selectedId').textContent='ID '+privateContact.id;$('#selectedName').textContent=privateContact.callsign||'Chamada individual';$('#selectedMeta').textContent=privateContact.name||'Destino privado · prima PTT para falar';$('#selectedCategory').textContent='Individual';$('#selectedCaller').hidden=true;
    $('#selectedActivityLed').classList.toggle('active',audioLevels.RX>0);$('#selectedActivityLed').setAttribute('aria-label','Destino individual selecionado');$('#pttScreenTitle').textContent='Chamada privada';
  }
  window.ZapDMRRadioBridge={reflectTarget};
  ui.init({platform:native()?'android':'windows',getSettings:()=>settings,getStatus:()=>lastStatus,toast,openSettings:id=>{setActiveScreen('settings');setActiveSettingsPane(id);},toggleScan:()=>$('#scanTalkgroups').click(),
    persist:savePatch,
    lookup:async query=>{if(native())return mobileAudio.dmrDatabase('lookup',[String(query)]);return post('/api/dmr-id-database/lookup',{ids:[String(query)]});},
    selectContact:target,
    requestPosition:locate,
    connectAprs:async raw=>{const {passcode,...prefs}=raw;const base=String(prefs.callsign||settings.callsign||'').toUpperCase().replace(/-\d{1,2}$/,'');const config={...prefs,callsign:base+(Number(prefs.ssid)?'-'+Number(prefs.ssid):''),beacon:prefs.positionEnabled===true,smartBeacon:prefs.smartBeaconing===true,symbol:prefs.symbol,...(lastPosition||{})};const result=native()?await aprsPlugin.connect({config,passcode:passcode||'-1'}):await post('/api/aprs/connect',{config,passcode:passcode||'-1'});aprsEvent({event:'status',data:result});return result;},
    disconnectAprs:async()=>{const result=native()?await aprsPlugin.disconnect():await post('/api/aprs/disconnect');aprsEvent({event:'status',data:{state:'disconnected',verified:false}});return result;},
    sendMessage:async data=>{const result=native()?await aprsPlugin.sendMessage(data):await post('/api/aprs/message',data);aprsEvent({event:'message',data:result});return result;},
    sendPosition:async position=>{if(position){lastPosition=position;if(native())await aprsPlugin.position(position);else await post('/api/aprs/position',position);}return native()?aprsPlugin.beacon():post('/api/aprs/beacon');},
    listSpp:async()=>{if(native()){await mobileAudio.requestOperationPermission('bluetooth');return mobileAudio.bluetoothSpp({action:'devices'});}return checked('/api/spp');},
    selectSpp:async address=>{settings.operation={...settings.operation,sppEnabled:true,sppDeviceAddress:address};await persist();return native()?mobileAudio.bluetoothSpp({action:'status'}):(await checked('/api/spp')).status;},
    learnSpp:async({action})=>native()?mobileAudio.bluetoothSpp({action:'learn',binding:action}):post('/api/spp',{action:'learn',binding:action}),
    cancelSppLearning:async()=>native()?mobileAudio.bluetoothSpp({action:'cancelLearn'}):post('/api/spp',{action:'cancelLearn'}),
    stopSpp:async()=>{settings.operation={...settings.operation,sppEnabled:false};await persist();if(native())return mobileAudio.bluetoothSpp({action:'status'});return (await checked('/api/spp')).status;},
    openSppSettings:async()=>{if(native())return mobileAudio.bluetoothSpp({action:'openSettings'});return window.ZapDMRDesktop?.openBluetooth?.();},
    requestNotifications:async()=>native()?mobileAudio.requestOperationPermission('notifications'):Notification.requestPermission(),
    incomingMessage:row=>{if(Date.now()-Number(row.at)<5000)notify('ZapDMR · '+row.from,row.text);},
    clearLog:async()=>native()?mobileAudio.radioControl({action:'logClear'}):checked('/api/system-log',{method:'DELETE'}),
    contactsChanged:async contacts=>{const signature=JSON.stringify(contacts);if(signature===contactsSignature)return;contactsSignature=signature;settings.console={...settings.console,contacts};try{await persist();}catch(error){ui.log({level:'error',message:error.message});}}
  });
  window.addEventListener('zapdmr:radio-event',async({detail:packet})=>{
    const data=packet?.data||{},event=packet?.event;
    if(event==='aprs')aprsEvent(data);
    if(event==='usage')ui.updateStatus({dataUsage:data});
    if(event==='sppStatus')ui.updateSpp(data);
    if(event==='sppLearned'){settings.operation={...settings.operation,...data.operation};await persist().catch(error=>toast(error.message));ui.updateSpp(data);ui.apply(settings);}
    if(event==='hardwareScan'||event==='hardwareButton'&&data.action==='scan')$('#scanTalkgroups').click();
    if(event==='hardwareButton'&&data.action!=='scan'){const on=data.action==='pttDown'?true:data.action==='pttUp'?false:!(gatewayStatus.pttArmed||mobilePttActive);void window.ZapDMROperation?.requestPtt(on);}
    if(event==='systemLog')ui.log(data);
    if(event==='systemLogSnapshot')for(const entry of data.entries||[])ui.log(entry);
    if(event==='status'){
      lastStatus=data;const gateway=data.brandmeister||data;ui.updateStatus({...data,dataUsage:data.usage||gateway.usage});
      if(data.spp)ui.updateSpp(data.spp);
      const connected=Boolean(gateway.connected);if(lastConnection!==undefined&&lastConnection!==connected){ui.log({source:'rede',message:connected?'Ligação HBP estabelecida.':'Ligação HBP perdida.'});if(!data.talkgroupBurst?.pending&&settings.console?.notifications?.connection!==false)notify('ZapDMR',connected?'Ligação estabelecida.':'Ligação perdida.');}lastConnection=connected;
      if(data.target?.callType==='private'&&Number(privateContact?.id)!==Number(data.target.id)){privateContact={id:data.target.id,callsign:'Radio ID '+data.target.id};reflectTarget();}else if(data.target?.callType==='group'&&privateContact&&Date.now()>targetPendingUntil){privateContact=null;renderSelected();}
    }
    if(event==='audio-level'||event==='audioLevel'){
      if(data.direction==='RX'){const active=Number(data.level)>0;if(active&&!rxActive&&Date.now()-lastIncoming>5000){lastIncoming=Date.now();if(settings.console?.notifications?.incoming===true)notify('ZapDMR · chamada recebida',data.callsign||'Áudio recebido no destino selecionado.');}rxActive=active;}
    }
    if(event==='tot-warning'||event==='error')ui.log({level:event==='error'?'error':'warning',source:'rádio',message:data.message||'Aviso TOT: '+data.secondsRemaining+' segundos.'});
  });
  document.addEventListener('keydown',event=>{if(event.repeat||['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName))return;ui.log({source:'tecla',message:event.code});});
  async function refresh(){try{if(native()){await aprsPlugin.addListener('aprsEvent',aprsEvent);aprsEvent({event:'status',data:await aprsPlugin.initialize()});const entries=await mobileAudio.radioControl({action:'logSnapshot'});for(const entry of entries.entries||[])ui.log(entry);}else if(apiAvailable){aprsEvent({event:'status',data:await checked('/api/aprs')});for(const entry of (await checked('/api/system-log')).entries||[])ui.log(entry);}}catch(error){ui.log({source:'sistema',level:'error',message:error.message});}}
  // app.js loads its profile asynchronously; wait for its initial settings request.
  if(window.ZapDMRReady){ui.apply(settings);void refresh();}else window.addEventListener('zapdmr:ready',()=>{ui.apply(settings);void refresh();},{once:true});
})();
