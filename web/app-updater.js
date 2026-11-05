/* One optional offer per launch. Android owns download validation and installation. */
(() => {
 let plugin,info=null,busy=false,radioPrepared=false,mandatory=false,inFlight=false,lastCheckAt=0,offered='',retry=null,offerTimer=null,interval=3600000,lastError='',offeredAt=0,reminderMs=86400000;
 try{if(window.Capacitor?.getPlatform?.()==='android')plugin=window.Capacitor.registerPlugin('ZapAppUpdate');}catch{}
 const dialog=document.createElement('dialog');dialog.className='radio-actions-dialog app-update-dialog';dialog.innerHTML='<h2>NOVA ATUALIZAÇÃO DISPONÍVEL</h2><strong></strong><p class="update-installed"></p><button type="button" class="button secondary update-notes">VER NOVIDADES</button><pre hidden></pre><p class="app-update-reason"></p><p>Deseja atualizar o ZapDMR agora?</p><p class="app-update-status" role="status"></p><button type="button" class="button primary update-yes">ATUALIZAR AGORA</button><button type="button" class="button secondary update-no">MAIS TARDE</button><button type="button" class="button secondary update-resume" hidden>Voltar ao ZapDMR</button>';document.body.append(dialog);
 const status=message=>dialog.querySelector('.app-update-status').textContent=message;
 const transmitting=()=>Boolean(typeof mobilePttActive!=='undefined'&&(mobilePttActive||mobilePttPending)||typeof gatewayStatus!=='undefined'&&(gatewayStatus.pttArmed||gatewayStatus.transmitting));
 const controls=()=>{dialog.querySelector('.update-yes').disabled=busy;dialog.querySelector('.update-no').disabled=busy;};
 function valid(release){return release&&/^\d+\.\d+\.\d+$/.test(release.version||'')&&Number.isSafeInteger(Number(release.minSupportedCode||0))&&Number(release.minSupportedCode||0)>=0&&Number(release.minSupportedCode||0)<=release.versionCode&&(!release.channel||release.channel==='stable')&&Number.isSafeInteger(release.versionCode)&&release.versionCode>0&&Number.isSafeInteger(release.bytes)&&release.bytes>=1024&&release.bytes<=157286400&&/^[a-f0-9]{64}$/.test(release.sha256||'')&&/^https:\/\/github\.com\/zapdmr\/zapdmr\/releases\/download\/v[0-9.]+\/ZapDMR-Android-[0-9.]+\.apk$/.test(release.apkUrl||'')&&release.apkUrl==='https://github.com/zapdmr/zapdmr/releases/download/v'+release.version+'/ZapDMR-Android-'+release.version+'.apk';}
 const radioBusy=()=>transmitting()||Boolean(typeof gatewayStatus!=='undefined'&&gatewayStatus.rxBusy);
 const otherActivity=()=>document.hidden||radioBusy()||Boolean(document.querySelector('dialog[open]:not(.app-update-dialog)'))||['INPUT','TEXTAREA'].includes(document.activeElement?.tagName);
 function offer(release,manual=false){
   clearTimeout(offerTimer);if(!release||radioPrepared||busy||offered===release.version&&!manual&&Date.now()-offeredAt<reminderMs)return;
   if(otherActivity()){offerTimer=setTimeout(()=>offer(release,manual),5000);return;}
   mandatory=Number(release.minSupportedCode)>info.versionCode;offered=release.version;offeredAt=Date.now();
   dialog.querySelector('strong').textContent='Disponível: ZapDMR '+release.version;
   dialog.querySelector('.update-installed').textContent='Versão instalada: '+info.version+(release.publishedAt?' · Publicada em '+new Date(release.publishedAt).toLocaleDateString():'');
   dialog.querySelector('pre').textContent=release.changelog||'';
   dialog.querySelector('.app-update-reason').textContent=mandatory?(release.requiredReason||'Atualização necessária para compatibilidade.'):'Atualização opcional. Seus dados serão preservados.';
   dialog.querySelector('.update-no').hidden=mandatory;status('');if(!dialog.open)dialog.showModal();
 }
 async function check(force=false){
   if(!plugin||inFlight||busy||radioPrepared||Date.now()-lastCheckAt<(force?60000:interval))return;
   inFlight=true;lastCheckAt=Date.now();clearTimeout(retry);
   try{info=await plugin.info();if(info.experimental){lastError='';if(manualStatus)manualStatus.textContent='Versão experimental independente. Atualizações automáticas oficiais estão desativadas.';return;}const data=await plugin.check(),release=data.release;
     if(release&&!valid(release))throw new Error('O servidor retornou um manifesto inválido.');
     const minutes=Number(release?.notificationPolicy?.checkIntervalMinutes);if(Number.isFinite(minutes))interval=Math.max(15,Math.min(1440,minutes))*60000;
     reminderMs=Math.max(1,Math.min(168,Number(release?.notificationPolicy?.remindAfterHours)||24))*3600000;
     lastError='';if(manualStatus)manualStatus.textContent='Versão instalada: '+info.version+'. '+(release&&release.versionCode>info.versionCode?'Nova versão '+release.version+' disponível.':'Você já está na versão estável mais recente.');
     if(release&&release.versionCode>info.versionCode)offer(release,force);
   }catch(error){lastError=error.message||'Sem conexão com o servidor de atualizações.';if(manualStatus)manualStatus.textContent=lastError+' O rádio continua disponível.';retry=setTimeout(()=>void check(true),120000);}
   finally{inFlight=false;}
 }
 dialog.querySelector('.update-notes').onclick=()=>{const notes=dialog.querySelector('pre');notes.hidden=!notes.hidden;};
 let manualStatus=null;
 if(plugin){const pane=document.querySelector('[data-settings-pane="data"]');if(pane){const card=document.createElement('div');card.className='settings-card span-all';card.innerHTML='<h3>Atualizações Android</h3><p class="android-update-status" role="status">Verificação automática ao abrir e ao retornar ao aplicativo.</p><button type="button" class="button secondary">Verificar atualizações</button>';manualStatus=card.querySelector('p');card.querySelector('button').onclick=()=>{offered='';void check(true);};pane.append(card);}}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check(false);});
 window.addEventListener('online',()=>void check(true));
 window.addEventListener('beforeunload',()=>{clearTimeout(retry);clearTimeout(offerTimer);});
 dialog.querySelector('.update-no').onclick=()=>{if(!busy&&!mandatory)dialog.close();};
 dialog.addEventListener('cancel',event=>{if(busy||mandatory)event.preventDefault();});
 dialog.querySelector('.update-yes').onclick=async()=>{if(busy)return;if(radioBusy()){status('Aguarde terminar a transmissão ou recepção antes de atualizar.');return;}busy=true;controls();try{
    status('Baixando e verificando a atualização…');await plugin.download();if(radioBusy())throw new Error('Aguarde terminar a transmissão ou recepção e tente atualizar novamente.');
    status('Encerrando a sessão de rádio com segurança…');await window.ZapDMRMobileAudio.prepareAppUpdate();radioPrepared=true;
    status('Confirme a instalação na tela do Android.');await plugin.install();status('Instalador aberto. Se cancelar a instalação, use Voltar ao ZapDMR.');
   }catch(error){status(error.message||'Não foi possível atualizar. Tente novamente.');}finally{busy=false;controls();dialog.querySelector('.update-resume').hidden=!radioPrepared||mandatory;}};
 dialog.querySelector('.update-resume').onclick=async()=>{if(!radioPrepared||mandatory)return;try{await window.ZapDMRMobileAudio.resumeAfterAppUpdate();radioPrepared=false;dialog.close();await reconnectMobileAfterOpen();}catch(error){status(error.message);}};
 if(plugin)void plugin.addListener('progress',value=>status('Baixando atualização: '+Math.min(100,Math.round(value.bytes/value.total*100))+'%'));
 window.ZapDMRUpdater={check,valid,headers:()=>info?{'X-ZapDMR-Platform':'android','X-ZapDMR-Version-Code':String(info.versionCode)}:{}};
 window.addEventListener('zapdmr:update-required',()=>void check(true));
 setTimeout(()=>void check(),2000);
 window.addEventListener('zapdmr:ready',()=>void check(),{once:true});
})();
