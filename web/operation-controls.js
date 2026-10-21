/* Shared operational settings for the native Android client and Electron. */
(() => {
  const prefDefaults = { rxProtectionMs:500, pttMode:'toggle', hardwareKey:'F9', bluetoothPtt:false, allowLocked:false,
    hidePttButton:false, beepStart:false, beepStop:false, beepIncoming:false, keepScreenOn:false,
    hideStatusBar:false, showMeters:true, voxEnabled:false, voxThreshold:-35, voxHangMs:1200,
    columns:{time:true,callsign:true,name:true,location:true,city:true,state:true,country:true,talkgroup:false,flags:true,splitLocation:false} };
  const prefs = () => ({...prefDefaults,...settings.operation,columns:{...prefDefaults.columns,...settings.operation?.columns}});
  const native = () => Boolean(mobileAudio?.isAndroid?.());
  const active = () => Boolean(mobilePttActive || mobilePttPending || (gatewayStatus.pttArmed&&!gatewayStatus.talkgroupBurstActive));
  const controls = document.querySelector('.settings-pane-container');
  const switchRow = (id,label) => `<label class="option-switch"><input id="${id}" type="checkbox"> ${label}</label>`;
  for(const [id,label] of [['ptt-options','Premir para falar'],['display','Ecrã e energia']]) {
    const button=document.createElement('button');button.type='button';button.className='settings-tab';
    button.dataset.settingsTab=id;button.textContent=label;button.onclick=()=>setActiveSettingsPane(id);
    document.querySelector('.settings-tabs').append(button);
  }
  const pttPane=document.createElement('section');pttPane.className='settings-pane settings-grid';pttPane.dataset.settingsPane='ptt-options';pttPane.hidden=true;
  pttPane.innerHTML=`<div class="settings-card"><h3>Premir para falar</h3><p class="hint tiny">Modo, botões, tons</p>
    <label>Modo do botão de falar<select id="pttMode"><option value="toggle">Tocar — um toque liga, outro desliga</option><option value="hold">Manter — manter premido para transmitir</option></select></label>
    <label>Mapeamento do botão físico<select id="hardwareKey"><option value="F9">F9</option><option value="VolumeUp">Volume + (Android)</option><option value="VolumeDown">Volume − (Android)</option></select></label>
    <label>Proteção após RX no Android (ms)<input id="rxProtectionMs" type="number" min="0" max="3000" step="100" ${native()?'':'disabled'}></label><p class="hint tiny">No Android, bloqueia o PTT durante RX local e por este intervalo após a fala. Não garante que toda a rede esteja livre.</p>
    ${switchRow('bluetoothPtt','PTT Bluetooth / botão de auscultadores')}
    <p class="hint tiny">Botões de média ou HID padrão. A compatibilidade depende do acessório e do sistema. F9 global no Windows alterna TX.</p>
    ${switchRow('allowLocked','Falar com o ecrã bloqueado (Android)')}
    ${switchRow('hidePttButton','Ocultar botão TX no ecrã')}
    <p class="hint tiny">O botão de parada de emergência permanece disponível.</p>
    ${switchRow('beepStart','Bip ao começar a falar')}${switchRow('beepStop','Bip ao parar de falar')}${switchRow('beepIncoming','Bip de chamada recebida')}
    <button id="emergencyStop" type="button" class="button danger">Parar transmissão / desativar VOX</button></div>
    <div class="settings-card"><h3>VOX avançado</h3><button id="voxUnlock" class="button secondary" type="button">Mantenha premido durante cinco segundos para mostrar as definições de VOX</button>
    <div id="voxOptions" hidden><p class="hint tiny">Pode transmitir com ruído ambiente. Use auscultadores; o TOT limita cada fala. No Windows, requer acesso ao microfone e janela ativa.</p>
    ${switchRow('voxEnabled','Ativar transmissão por voz')}<label>Limiar de voz (dBFS)<input id="voxThreshold" type="number" min="-60" max="-10" value="-35"></label><label>Espera após silêncio (ms)<input id="voxHangMs" type="number" min="300" max="5000" step="100" value="1200"></label><p id="voxState" class="hint tiny">VOX desligado.</p></div></div>`;
  const displayPane=document.createElement('section');displayPane.className='settings-pane settings-grid';displayPane.dataset.settingsPane='display';displayPane.hidden=true;
  displayPane.innerHTML=`<div class="settings-card"><h3>Ecrã e energia</h3><p class="hint tiny">Tema, manter ecrã ligado, barra de estado</p>
    <label>Tema<select id="operationTheme"><option value="auto">Automático</option><option value="light">Claro</option><option value="dark">Escuro</option></select></label>
    ${switchRow('keepScreenOn','Manter ecrã ligado')}${switchRow('hideStatusBar','Ocultar barra de estado / título')}${switchRow('showMeters','Medidores TX/RX em tempo real')}
    <button id="batterySettings" type="button" class="button secondary">Gerir otimizações de bateria (Android)</button><p class="hint tiny">A exceção é escolhida nas definições do Android. No Windows, o bloqueio de suspensão usa a gestão de energia do sistema.</p></div>
    <div class="settings-card"><h3>Colunas do registo de chamadas</h3><div id="columnOptions"></div><p class="hint tiny">Localização cadastral DMR ID, não GPS. Dados ausentes aparecem como não informados.</p><div class="column-preview"><table><thead id="columnPreviewHead"></thead><tbody id="columnPreviewBody"></tbody></table></div></div>`;
  controls.append(pttPane,displayPane);
  for(const [id,label] of Object.entries({time:'Hora',callsign:'Indicativo',name:'Nome',location:'Localização',city:'Cidade',state:'Estado / Distrito',country:'País',talkgroup:'Talkgroup',flags:'Bandeiras dos países',splitLocation:'Localização em colunas separadas'})) {
    const wrapper=document.createElement('div');wrapper.innerHTML=switchRow('column-'+id,label);$('#columnOptions').append(wrapper.firstChild);
  }
  $('#updateDmrDatabase').textContent='Atualizar';$('#deleteDmrDatabase').textContent='Eliminar base de dados';
  const dbCard=$('#dmrDatabaseInfo').closest('.settings-card');
  dbCard.querySelector('h3').textContent='Base de dados DMR ID';
  dbCard.querySelector('p:last-child').textContent='Resolver IDs para indicativos offline. Atualização direta do RadioID; o cadastro fica somente neste dispositivo.';
  const search=document.createElement('label');search.textContent='Consultar ID DMR';
  const searchInput=document.createElement('input');searchInput.id='directorySearch';searchInput.inputMode='numeric';searchInput.placeholder='Ex.: 7246584';search.append(searchInput);dbCard.append(search);
  const searchResult=document.createElement('p');searchResult.id='directoryResult';searchResult.className='hint tiny';dbCard.append(searchResult);

  const recordCache=new Map();let lookupPending=false,dbUpdating=false;
  try{for(const record of JSON.parse(localStorage.getItem('zapdmr-directory-cache')||'[]'))if(record&&record.id&&record.callsign){recordCache.set(String(record.id),record);recordCache.set(String(record.callsign).toUpperCase(),record);}}catch{}

  async function database(action='stats',ids=[]) {
    if(native())return mobileAudio.dmrDatabase(action,ids);
    const path=action==='lookup'?'/api/dmr-id-database/lookup':action==='update'?'/api/dmr-id-database/update':'/api/dmr-id-database';
    const result=await callApi(path,{method:action==='delete'?'DELETE':['update','lookup'].includes(action)?'POST':'GET',
      ...(['update','lookup'].includes(action)?{body:JSON.stringify({ids})}:{}),signal:AbortSignal.timeout(action==='update'?180000:10000)});
    if(!result.ok)throw new Error(result.data?.error||'A base local não está disponível.');return result.data;
  }
  const cleanPlace = value => typeof value==='string' && /\p{L}/u.test(value) && !/^(unknown|undefined|null|n\/a|no ta|localiza[çc][ãa]o|location|cidade|city|estado|state|pa[íi]s|country|n[aã]o informad[ao]|(?:slot|ts|time\s*slot)\s*[:#-]?\s*\d+)$/i.test(value.trim())?value.trim():'';
  const countryCodes=new Map([['brasil','BR'],['brazil','BR'],['usa','US'],['united states of america','US'],['uk','GB'],['england','GB']]);
  try{for(const locale of ['en','pt']){const names=new Intl.DisplayNames([locale],{type:'region'});for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b),name=names.of(code);if(name&&name!==code)countryCodes.set(name.toLowerCase(),code);}}}catch{}
  const flag = country => {const code=countryCodes.get(String(country).toLowerCase())||(/^[A-Za-z]{2}$/.test(country)?country.toUpperCase():'');return code?[...code].map(char=>String.fromCodePoint(127397+char.charCodeAt(0))).join(''):'';};
  const brazilStates=new Map(Object.entries({'acre':'AC','alagoas':'AL','amapa':'AP','amazonas':'AM','bahia':'BA','ceara':'CE','distrito federal':'DF','espirito santo':'ES','goias':'GO','maranhao':'MA','mato grosso':'MT','mato grosso do sul':'MS','minas gerais':'MG','para':'PA','paraiba':'PB','parana':'PR','pernambuco':'PE','piaui':'PI','rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS','rondonia':'RO','roraima':'RR','santa catarina':'SC','sao paulo':'SP','sergipe':'SE','tocantins':'TO'}));
  function stateText(item){const value=cleanPlace(item.state),country=cleanPlace(item.country);return flag(country)==='🇧🇷'?(brazilStates.get(value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase())||value):value;}
  function enriched(item){const id=String(item.sourceId||String(item.callsign||'').match(/(?:ID|DMR)\s+(\d+)/)?.[1]||item.callsign||'').toUpperCase();const record=recordCache.get(id)||recordCache.get(String(item.callsign||'').toUpperCase());const own=String(item.sourceId||'')===String(settings.dmrId)||String(item.callsign||'').toUpperCase()===String(settings.callsign||'').toUpperCase();item={...item,location:cleanPlace(item.location)||(own?cleanPlace(settings.locationName):'')};return {...item,...(record?{callsign:record.callsign,name:record.name,city:record.city,state:record.state,country:record.country,location:[record.city,record.state].filter(Boolean).join(', ')}:{})};}
  function locationText(item){const columns=prefs().columns;const city=cleanPlace(item.city)||cleanPlace(item.location);const state=stateText(item);const country=cleanPlace(item.country);let pieces=[];if(columns.city)pieces.push(city);if(columns.state&&state&&!city.includes(state))pieces.push(state);if(columns.country)pieces.push(country);pieces=[...new Set(pieces.filter(Boolean))];return [columns.flags?flag(country):'',pieces.join(', ')||'—'].filter(Boolean).join(' ');}
  function columnDefinitions(){const c=prefs().columns;
    const columns=[['time','Hora',item=>new Date(item.at).toLocaleTimeString('pt-BR')],['callsign','Indic.',item=>item.callsign||'—'],['name','Nome',item=>item.name||'—']].filter(([key])=>c[key]);
    if(c.location){
      if(c.splitLocation){
        if(c.city)columns.push(['city','Cidade',item=>cleanPlace(item.city)||cleanPlace(item.location)||'—']);
        if(c.state)columns.push(['state','Estado / Distrito',item=>stateText(item)||'—']);
        if(c.country)columns.push(['country','País',item=>[c.flags?flag(cleanPlace(item.country)):'',cleanPlace(item.country)||'—'].filter(Boolean).join(' ')]);
      }else columns.push(['location','Localização',locationText]);
    }
    if(c.talkgroup)columns.push(['talkgroup','TG',item=>String(item.talkgroupId)]);
    return columns;
  }
  function populate(head,body,items){head.replaceChildren();body.replaceChildren();const columns=columnDefinitions();const heading=document.createElement('tr');for(const [,title]of columns){const th=document.createElement('th');th.textContent=title;heading.append(th);}head.append(heading);for(const item of items){const tr=document.createElement('tr');for(const [key,,value] of columns){const td=document.createElement('td');td.dataset.column=key;if(key==='callsign'){td.dataset.participantName=item.name||'';td.dataset.dmrId=String(item.sourceId||item.id||'');}td.textContent=value(item);td.title=td.textContent;if(prefs().columns.flags&&['location','country'].includes(key)){const country=cleanPlace(item.country);const code=countryCodes.get(country.toLowerCase())||(/^[A-Za-z]{2}$/.test(country)?country.toUpperCase():'');if(code){td.textContent=td.textContent.replace(flag(country),'').trim();const image=document.createElement('img');image.className='country-flag';image.src='/flags/'+code.toLowerCase()+'.svg';image.alt='Bandeira: '+country;image.onerror=()=>image.remove();td.prepend(image);}}tr.append(td);}body.append(tr);}}
  async function resolveParticipants(){
    if(lookupPending)return;const ids=[...new Set(participants.flatMap(item=>[String(item.sourceId||''),String(item.callsign||'').toUpperCase()]).filter(id=>/^[A-Z0-9/]{2,16}$/.test(id)&&!recordCache.has(id)))].slice(0,4);
    if(!ids.length)return;lookupPending=true;for(const id of ids)recordCache.set(id,null);try{const data=await database('lookup',ids);for(const id of ids)recordCache.set(id,null);for(const record of data.records||[]){recordCache.set(String(record.id),record);recordCache.set(String(record.callsign).toUpperCase(),record);}try{localStorage.setItem('zapdmr-directory-cache',JSON.stringify([...new Map([...recordCache.values()].filter(Boolean).map(record=>[record.id,record])).values()].slice(-2000)));}catch{}renderParticipantsView(false);}catch{}finally{lookupPending=false;if(participants.some(item=>[String(item.sourceId||''),String(item.callsign||'').toUpperCase()].some(id=>/^[A-Z0-9/]{2,16}$/.test(id)&&!recordCache.has(id))))setTimeout(resolveParticipants,300);}
  }
  function renderParticipantsView(resolve=true){
    const current=(privateContact?[]:participants).filter(item=>Number(item.talkgroupId)===Number(groupSelected()?.id)&&Number(item.at)>Date.now()-1800000).sort((a,b)=>b.at-a.at).slice(0,50).map(enriched);
    populate(document.querySelector('.participant-table thead'),$('#participantsRows'),current);$('#participantCount').textContent=String(current.length);$('#participantsEmpty').hidden=current.length>0;$('#participantsEmpty').textContent=privateContact?'Destino individual selecionado. O RX está limitado ao interlocutor escolhido.':'Aguardando atividade da TalkGroup selecionada.';
    if(resolve)void resolveParticipants();
  }
  function renderPreview(){populate($('#columnPreviewHead'),$('#columnPreviewBody'),[{at:Date.now(),callsign:'PY2EX',name:'Exemplo',city:'Mongaguá',state:'SP',country:'Brazil',talkgroupId:724}]);}
  $('#updateDmrDatabase').onclick=async()=>{
    if(dbUpdating)return;dbUpdating=true;$('#updateDmrDatabase').disabled=true;$('#deleteDmrDatabase').disabled=true;$('#dmrDatabaseInfo').textContent='A descarregar e atualizar a base… A base anterior permanece disponível se houver falha.';
    try{const data=await database('update');recordCache.clear();updateDmrDatabaseInfo(data);renderParticipantsView();toast(`${data.records} registos atualizados.`);}catch(error){toast(error.message);try{updateDmrDatabaseInfo(await database());}catch{}}finally{dbUpdating=false;$('#updateDmrDatabase').disabled=false;}
  };
  $('#deleteDmrDatabase').onclick=async()=>{if(dbUpdating||!confirm('Eliminar a base local DMR ID deste dispositivo?'))return;try{updateDmrDatabaseInfo(await database('delete'));recordCache.clear();renderParticipantsView();toast('Base local eliminada.');}catch(error){toast(error.message);}};
  let searchTimer;
  searchInput.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{const id=searchInput.value.trim();if(!/^\d{1,8}$/.test(id)){searchResult.textContent='Informe um ID DMR numérico.';return;}try{const data=await database('lookup',[id]);const record=data.records?.[0];searchResult.textContent=record?`${record.callsign} · ${record.name} · ${locationText(record)}`:'ID não encontrado na base local.';}catch(error){searchResult.textContent=error.message;}},300);};

  let localAudioTestActive=false;
  let pttBusy=false,wantTransmit=false,lastTxState=false,lastRxBeep=0,wasReceiving=false,wakeLock,desktopVox,voxSilence=0,voxTriggered=false,voxNeedsQuiet=false,voxActivation=0,desktopShortcutReady=false;
  function beep(){if(native())return;try{playTotAlert();}catch{}}
  async function requestPtt(desired){
    if(desired&&gatewayStatus.rxBusy){toast("RX OCUPADO — AGUARDE");return;}
    if(desired&&window.ZapDMRConsole?.isLearning?.()){toast('Termine a aprendizagem do botão SPP antes de transmitir.');return;}
    if(desired&&(localAudioTestActive||gatewayStatus.talkgroupBurstActive||talkgroupBurstStatus.pending)){toast(localAudioTestActive?'Aguarde o teste local de áudio terminar.':'Aguarde a troca de TalkGroup terminar.');return;}
    wantTransmit=Boolean(desired);if(pttBusy){if(!wantTransmit&&native())void mobileAudio.stopPtt();return;}pttBusy=true;
    try{
      while(wantTransmit!==active()){
        const on=wantTransmit;if(on&&!gatewayStatus.connected){wantTransmit=false;throw new Error('Ligue primeiro ao master.');}
        if(on)stopTalkgroupScan();
        if(native()){
          if(on){mobilePttHolding=true;mobilePttPending=true;const group=transmitTarget();await mobileAudio.startPtt(group?.id,group?.slot||settings.defaultSlot||1);reflectTx();break; /* Native PTT event confirms acceptance. */}
          else{mobilePttHolding=false;mobilePttPending=false;await mobileAudio.stopPtt();mobilePttActive=false;gatewayStatus.pttArmed=false;}
        }else{
          const result=await callApi('/api/ptt',{method:'POST',body:JSON.stringify({active:on,talkgroupId:transmitTarget()?.id,slot:transmitTarget()?.slot||settings.defaultSlot||1})});
          if(!result.ok)throw new Error(result.data?.message||'O PTT não foi aceito pelo servidor.');gatewayStatus.pttArmed=on;
        }
        reflectTx();
      }
    }catch(error){wantTransmit=false;mobilePttHolding=false;mobilePttPending=false;if(native())void mobileAudio.stopPtt();toast(error.message);}finally{pttBusy=false;}
  }
  function reflectTx(){const tx=active();if(tx!==lastTxState){if(!native()&&(tx?prefs().beepStart:prefs().beepStop))beep();lastTxState=tx;}
    $('#ptt').classList.toggle('transmitting',tx);$('#ptt').disabled=!tx&&(!gatewayStatus.connected||!gatewayStatus.pttReady||Boolean(gatewayStatus.rxBusy)||Boolean(gatewayStatus.talkgroupBurstActive));$('#ptt').textContent=!tx&&gatewayStatus.rxBusy?'RX OCUPADO — AGUARDE':tx?'■ TX · transmitir / parar':prefs().pttMode==='toggle'?'🎙 TX · tocar para falar':'🎙 TX · manter para falar';$('#ptt').hidden=prefs().hidePttButton&&!tx;}
  const txButton=$('#ptt');txButton.style.touchAction='none';
  txButton.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();if(prefs().pttMode==='hold'){txButton.setPointerCapture?.(event.pointerId);void requestPtt(true);}});
  for(const eventName of ['pointerup','pointercancel','lostpointercapture'])txButton.addEventListener(eventName,()=>{if(prefs().pttMode==='hold')void requestPtt(false);});
  txButton.onclick=event=>{event.preventDefault();if(prefs().pttMode==='toggle'||event.detail===0)void requestPtt(!active());};
  txButton.oncontextmenu=event=>event.preventDefault();
  document.addEventListener('keydown',event=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||event.repeat)return;
    if((native()||desktopShortcutReady)&&prefs().hardwareKey==='F9'&&event.code==='F9')return; // native Activity owns hardware keys
    if(event.code===prefs().hardwareKey||(['Space','Enter'].includes(event.code)&&event.target===txButton)){
      event.preventDefault();void requestPtt(prefs().pttMode==='toggle'?!active():true);
    }
    if(event.code==='Escape'){wantTransmit=false;void requestPtt(false);}
  });
  document.addEventListener('keyup',event=>{if(prefs().pttMode==='hold'&&(event.code===prefs().hardwareKey||(['Space','Enter'].includes(event.code)&&event.target===txButton)))void requestPtt(false);});
  $('#emergencyStop').onclick=async()=>{settings.operation={...prefs(),voxEnabled:false};$('#voxEnabled').checked=false;void stopDesktopVox();await requestPtt(false);await saveOptions();};
  window.addEventListener('blur',()=>{if(!native()||!prefs().allowLocked||prefs().pttMode==='hold')void requestPtt(false);if(!native())void stopDesktopVox();});
  window.addEventListener('beforeunload',()=>{if(!native()||!prefs().allowLocked)void requestPtt(false);});
  window.ZapDMRDesktop?.onPtt(()=>void requestPtt(!active()));
  $('#pttScan').onclick=()=>{$('#scanTalkgroups').click();setActiveScreen('ptt');};

  async function stopDesktopVox(){if(!desktopVox)return;cancelAnimationFrame(desktopVox.animation);desktopVox.stream.getTracks().forEach(track=>track.stop());await desktopVox.context.close().catch(()=>{});desktopVox=null;if(voxTriggered){voxTriggered=false;void requestPtt(false);}}
  async function startDesktopVox(){
    if(native()||desktopVox||!prefs().voxEnabled||document.hidden)return;
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});const context=new AudioContext();const analyser=context.createAnalyser();analyser.fftSize=1024;context.createMediaStreamSource(stream).connect(analyser);const samples=new Float32Array(analyser.fftSize);desktopVox={stream,context,animation:0};
      const frame=()=>{if(!desktopVox)return;analyser.getFloatTimeDomainData(samples);let sum=0;for(const sample of samples)sum+=sample*sample;const db=20*Math.log10(Math.max(1e-6,Math.sqrt(sum/samples.length)));const now=Date.now();
        if(!gatewayStatus.connected){voxTriggered=false;}
        else if(db>=prefs().voxThreshold){voxSilence=now;if(voxTriggered&&!active()&&!pttBusy&&now-voxActivation>1000){voxNeedsQuiet=true;voxTriggered=false;}if(!active()&&!voxTriggered&&!voxNeedsQuiet){voxTriggered=true;voxActivation=now;void requestPtt(true);}}
        else if((voxNeedsQuiet=false,voxTriggered)&&now-voxSilence>=prefs().voxHangMs){voxTriggered=false;void requestPtt(false);}
        $('#voxState').textContent=`VOX · ${Math.round(db)} dBFS${active()?' · TX':''}`;desktopVox.animation=requestAnimationFrame(frame);};frame();
    }catch(error){settings.operation={...prefs(),voxEnabled:false};$('#voxEnabled').checked=false;toast('Não foi possível iniciar VOX: '+error.message);}
  }
  let unlockTimer,unlockStarted=0;
  const unlock=$('#voxUnlock');
  function beginUnlock(){if(unlockTimer)return;unlockStarted=Date.now();unlockTimer=setTimeout(()=>{unlockTimer=null;$('#voxOptions').hidden=false;unlock.textContent='Definições VOX desbloqueadas';},5000);}
  function cancelUnlock(){if(unlockTimer)clearTimeout(unlockTimer);unlockTimer=null;}
  unlock.onpointerdown=event=>{if(event.button===0){unlock.setPointerCapture?.(event.pointerId);beginUnlock();}};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])unlock.addEventListener(name,cancelUnlock);
  unlock.onkeydown=event=>{if(['Space','Enter'].includes(event.code)&&!event.repeat){event.preventDefault();beginUnlock();}};unlock.onkeyup=cancelUnlock;unlock.onblur=cancelUnlock;

  const audioCard=$('#audioTest').parentElement;
  const micTest=document.createElement('button');micTest.id='microphoneTest';micTest.type='button';micTest.className='button secondary span-all';micTest.textContent='Testar microfone · gravar 3 s e ouvir';audioCard.insertBefore(micTest,$('#audioTestResult'));
  const audioApplied=document.createElement('p');audioApplied.className='hint tiny span-all';audioApplied.id='audioLevelsApplied';audioApplied.textContent='Ganho e volume são aplicados imediatamente, sem reconectar.';audioCard.append(audioApplied);
  let audioTimer;
  function labelGain(id,value){const db=value>0?(20*Math.log10(value/100)).toFixed(1)+' dB':'silenciado';$('#'+id).textContent=value+'% ('+db+')';}
  function queueAudioLevels(){
    optionsSave=optionsSave.catch(()=>{}).then(async()=>{
      const tx=settings.txGainPercent,rx=settings.rxVolumePercent;
      if(native()){await mobileAudio.setAudioLevels(tx,rx);await persist();audioApplied.textContent='Aplicado no Android: microfone '+tx+'%, recepção '+rx+'%.';}
      else{const result=await callApi('/api/audio-levels',{method:'POST',body:JSON.stringify({txGainPercent:tx,rxVolumePercent:rx})});if(!result.ok)throw new Error(result.data?.error||'Não foi possível aplicar o ganho no motor.');saveLocal();audioApplied.textContent=result.data.message;}
    }).catch(error=>{audioApplied.textContent=error.message;toast(error.message);});return optionsSave;
  }
  for(const [id,field,label]of [['txGainPercent','txGainPercent','txGainValue'],['rxVolumePercent','rxVolumePercent','rxVolumeValue']]){
    $('#'+id).oninput=event=>{const value=Math.max(0,Math.min(200,Number(event.target.value)));settings[field]=value;labelGain(label,value);audioApplied.textContent='A aplicar no motor…';clearTimeout(audioTimer);audioTimer=setTimeout(()=>void queueAudioLevels(),150);};
    $('#'+id).onchange=()=>{clearTimeout(audioTimer);void queueAudioLevels();};
  }
  async function runLocalTest(microphone){
    if(active()||localAudioTestActive)return toast('Termine a transmissão ou o teste atual.');
    localAudioTestActive=true;$('#audioTest').disabled=true;micTest.disabled=true;
    const resumeVox=Boolean(desktopVox);await stopDesktopVox();
    $('#audioTestResult').textContent=microphone?'Fale durante 3 segundos. Depois ouvirá a sua voz localmente, sem transmitir.':'A testar o vocoder e a saída local, sem transmitir…';
    try{
      clearTimeout(audioTimer);await queueAudioLevels();
      let result;
      if(native()){if(microphone)await mobileAudio.requestOperationPermission('microphone');result=await mobileAudio.audioTest(microphone);}
      else{const response=await callApi('/api/audio-test',{method:'POST',body:JSON.stringify({microphone}),signal:AbortSignal.timeout(25000)});if(!response.ok)throw new Error(response.data?.message||'O servidor local não respondeu ao teste de áudio.');result=response.data;}
      $('#audioTestResult').textContent=result.message;toast('Teste local concluído. Confirme o som no dispositivo.');
    }catch(error){$('#audioTestResult').textContent=error.message||'Falha no teste local de áudio.';toast($('#audioTestResult').textContent);}
    finally{localAudioTestActive=false;$('#audioTest').disabled=false;micTest.disabled=false;if(resumeVox&&prefs().voxEnabled)void startDesktopVox();}
  }
  $('#audioTest').onclick=()=>void runLocalTest(false);micTest.onclick=()=>void runLocalTest(true);
  const optionKeys=Object.keys(prefDefaults).filter(key=>key!=='columns');
  let applyRunning=false;
  async function apply(){
    const value=prefs();for(const id of optionKeys){const input=$('#'+id);if(!input)continue;if(input.type==='checkbox')input.checked=Boolean(value[id]);else input.value=String(value[id]);}
    for(const [key,on]of Object.entries(value.columns)){const input=$('#column-'+key);if(input)input.checked=Boolean(on);}
    $('#voxState').textContent=value.voxEnabled?(native()?(gatewayStatus.connected?'VOX configurado no serviço Android.':'VOX configurado · aguarda ligação ao master.'):'VOX configurado · requer janela ativa.'):'VOX desligado.';
    const hint=document.querySelector('.operation-hint');if(hint)hint.textContent=value.pttMode==='toggle'?'Toque para iniciar e toque novamente para parar. Trocar de TG não transmite voz. ODTP solicita inscrição no master.':'Mantenha premido para transmitir. Soltar libera o PTT.';
    $('#operationTheme').value=settings.theme;$('#audioMeters').hidden=!value.showMeters;
    $('#batterySettings').disabled=!native();$('#allowLocked').disabled=!native();
    document.body.classList.toggle('hide-window-title',value.hideStatusBar&&!native());reflectTx();renderPreview();renderParticipantsView();
    if(applyRunning)return;applyRunning=true;
    try{
      if(native())await mobileAudio.configureOperation(value,settings.console||{},settings);
      else if(window.ZapDMRDesktop){const result=await window.ZapDMRDesktop.configure({...value,scanKey:settings.console?.scan?.key||''});desktopShortcutReady=Boolean(result.shortcutRegistered);}
      else if(value.keepScreenOn&&navigator.wakeLock&&!wakeLock)wakeLock=await navigator.wakeLock.request('screen');
      if(!value.keepScreenOn&&wakeLock){await wakeLock.release();wakeLock=null;}
      if(!value.voxEnabled)await stopDesktopVox();
    }catch(error){console.warn('Operational settings:',error.message);}finally{applyRunning=false;}
  }
  let optionsSave=Promise.resolve();
  function saveOptions(){optionsSave=optionsSave.catch(()=>{}).then(()=>persist()).then(()=>apply());return optionsSave;}
  for(const key of optionKeys){const input=$('#'+key);if(!input)continue;input.onchange=async()=>{
    const old=prefs();let value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
    if(key==='rxProtectionMs')value=Math.max(0,Math.min(3000,Number.isFinite(value)?value:500));
    if(key==='voxThreshold')value=Math.max(-60,Math.min(-10,value));if(key==='voxHangMs')value=Math.max(300,Math.min(5000,value));
    try{
      if(native()&&value&&['bluetoothPtt','allowLocked','voxEnabled'].includes(key))await mobileAudio.requestOperationPermission(key==='bluetoothPtt'?'bluetooth':'microphone');
      if(key==='pttMode')await requestPtt(false);
      settings.operation={...old,[key]:value};await saveOptions();if(key==='voxEnabled'&&value&&!native())await startDesktopVox();
    }catch(error){settings.operation=old;await apply();toast(error.message);}
  };}
  for(const key of Object.keys(prefDefaults.columns))$('#column-'+key).onchange=async()=>{const value=prefs();value.columns[key]=$('#column-'+key).checked;if(!['time','callsign','name','location','talkgroup'].some(id=>value.columns[id])){value.columns.callsign=true;$('#column-callsign').checked=true;}settings.operation=value;try{await saveOptions();}catch(error){toast(error.message);}};
  $('#operationTheme').onchange=async event=>{setTheme(event.target.value);$('#theme').value=event.target.value;await persist();};
  $('#batterySettings').onclick=()=>void mobileAudio.batterySettings().catch(error=>toast(error.message));
  window.ZapDMROperation={apply,renderParticipants:renderParticipantsView,requestPtt,reflectTx};
  setInterval(()=>{
    reflectTx();const reception=window.ZapDMRReception?.render();$('#pttScan').setAttribute('aria-pressed',String(scanEnabled));$('#pttScanLabel').textContent=(gatewayStatus.talkgroupBurstActive||talkgroupBurstStatus.pending)?`A trocar para TG ${groupSelected()?.id||'—'}…`:privateContact?`Individual: ${privateContact.callsign||privateContact.id} · PTT para responder`:scanEnabled?$('#scanStatus').textContent:gatewayStatus.connected?(reception?.text||`TG ${groupSelected()?.id||'—'} — aguardando estado RX`):'A procurar… · ligue ao master para escutar';
    if(!native()&&prefs().beepIncoming&&audioLevels.RX>0&&!wasReceiving&&Date.now()-lastRxBeep>3000){lastRxBeep=Date.now();beep();}wasReceiving=audioLevels.RX>0;

  },250);
  void apply();void database().then(updateDmrDatabaseInfo).catch(()=>{});
})();
