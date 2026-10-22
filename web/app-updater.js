/* One optional offer per launch. Android owns download validation and installation. */
(() => {
 let plugin,info=null,checked=false,busy=false,radioPrepared=false,mandatory=false;
 try{if(window.Capacitor?.getPlatform?.()==='android')plugin=window.Capacitor.registerPlugin('ZapAppUpdate');}catch{}
 const dialog=document.createElement('dialog');dialog.className='radio-actions-dialog app-update-dialog';dialog.innerHTML='<h2>NOVA ATUALIZAÇÃO DISPONÍVEL</h2><strong></strong><pre></pre><p class="app-update-reason"></p><p>Deseja atualizar o ZapDMR agora?</p><p class="app-update-status" role="status"></p><button type="button" class="button primary update-yes">SIM, ATUALIZAR</button><button type="button" class="button secondary update-no">NÃO, AGORA NÃO</button><button type="button" class="button secondary update-resume" hidden>Voltar ao ZapDMR</button>';document.body.append(dialog);
 const status=message=>dialog.querySelector('.app-update-status').textContent=message;
 const transmitting=()=>Boolean(typeof mobilePttActive!=='undefined'&&(mobilePttActive||mobilePttPending)||typeof gatewayStatus!=='undefined'&&(gatewayStatus.pttArmed||gatewayStatus.transmitting));
 const controls=()=>{dialog.querySelector('.update-yes').disabled=busy;dialog.querySelector('.update-no').disabled=busy;};
 function valid(release){return release&&Number.isSafeInteger(release.versionCode)&&release.versionCode>0&&Number.isSafeInteger(release.bytes)&&release.bytes>=1024&&release.bytes<=157286400&&/^[a-f0-9]{64}$/.test(release.sha256||'')&&/^https:\/\/github\.com\/zapdmr\/zapdmr\/releases\/download\/v[0-9.]+\/ZapDMR-Android-[0-9.]+\.apk$/.test(release.apkUrl||'');}
 async function check(force=false){if(!plugin||checked&&!force)return;checked=true;try{info=await plugin.info();const data=await plugin.check(),release=data.release;if(!valid(release)||release.versionCode<=info.versionCode)return;mandatory=Number(release.minSupportedCode)>info.versionCode;
   if(transmitting()){setTimeout(()=>void check(true),1500);return;}
   dialog.querySelector('strong').textContent='ZapDMR — Versão '+release.version;dialog.querySelector('pre').textContent=release.changelog||'';dialog.querySelector('.app-update-reason').textContent=mandatory?(release.requiredReason||'Esta versão precisa ser atualizada para usar o servidor.'):'Atualização opcional. Seus dados serão preservados.';dialog.querySelector('.update-no').hidden=mandatory;status('');if(!dialog.open)dialog.showModal();
  }catch{/* Offline launch preserves normal use. The server enforces compatibility when reconnecting. */}}
 dialog.querySelector('.update-no').onclick=()=>{if(!busy&&!mandatory)dialog.close();};
 dialog.addEventListener('cancel',event=>{if(busy||mandatory)event.preventDefault();});
 dialog.querySelector('.update-yes').onclick=async()=>{if(busy)return;if(transmitting()){status('Encerre a transmissão antes de atualizar.');return;}busy=true;controls();try{
    status('Baixando e verificando a atualização…');await plugin.download();if(transmitting())throw new Error('Encerre a transmissão e tente atualizar novamente.');
    status('Encerrando a sessão de rádio com segurança…');await window.ZapDMRMobileAudio.prepareAppUpdate();radioPrepared=true;
    status('Confirme a instalação na tela do Android.');await plugin.install();status('Instalador aberto. Se cancelar a instalação, use Voltar ao ZapDMR.');
   }catch(error){status(error.message||'Não foi possível atualizar. Tente novamente.');}finally{busy=false;controls();dialog.querySelector('.update-resume').hidden=!radioPrepared||mandatory;}};
 dialog.querySelector('.update-resume').onclick=async()=>{if(!radioPrepared||mandatory)return;try{await window.ZapDMRMobileAudio.resumeAfterAppUpdate();radioPrepared=false;dialog.close();await reconnectMobileAfterOpen();}catch(error){status(error.message);}};
 if(plugin)void plugin.addListener('progress',value=>status('Baixando atualização: '+Math.min(100,Math.round(value.bytes/value.total*100))+'%'));
 window.ZapDMRUpdater={check,valid,headers:()=>info?{'X-ZapDMR-Platform':'android','X-ZapDMR-Version-Code':String(info.versionCode)}:{}};
 window.addEventListener('zapdmr:update-required',()=>void check(true));
 if(window.ZapDMRReady)void check();else window.addEventListener('zapdmr:ready',()=>void check(),{once:true});
})();
