/* Site activation adds profiles. It never replaces an operator's saved radio configuration. */
(() => {
 const dialog=document.createElement('dialog');dialog.className='talkgroup-dialog onboarding-dialog';dialog.setAttribute('aria-labelledby','onboardingTitle');
 dialog.innerHTML=`<h2 id="onboardingTitle">Bem-vindo ao ZapDMR!</h2><p>Ative este dispositivo gratuitamente pelo e-mail. O código de seis dígitos é solicitado somente na primeira ativação deste aparelho.</p><label>Indicativo<input id="onboardingCallsign" maxlength="8" autocomplete="username" placeholder="PU5RZS"></label><label>DMR ID<input id="onboardingDmrId" inputmode="numeric" maxlength="7" placeholder="7240000"></label><label>E-mail<input id="onboardingEmail" type="email" maxlength="254" autocomplete="email" placeholder="operador@exemplo.com"></label><button id="onboardingSendEmail" type="button" class="button primary">Enviar código de 6 dígitos</button><section id="onboardingEmailStep" hidden><label>Código recebido<input id="onboardingEmailCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"></label><button id="onboardingConfirmEmail" type="button" class="button primary">Confirmar e ativar</button></section><details><summary>Ativação antiga pelo site</summary><p>Disponível para usuários que já receberam o código longo da versão anterior.</p><label>Código de ativação<input id="deviceActivationCode" autocomplete="off" spellcheck="false" maxlength="39" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"></label><button id="activateFromSite" type="button" class="button secondary">Trazer cadastro antigo</button></details><button id="addRecommendedXlx" type="button" class="button secondary">Adicionar perfil XLX026 recomendado</button><p id="onboardingStatus" class="hint" role="status"></p><button id="onboardingConnect" class="button primary" type="button" hidden>CONECTAR AO XLX026</button><button id="onboardingAudio" class="button secondary" type="button">Testar microfone e áudio</button><details><summary>Usar preferências em outro aparelho</summary><p>Sincroniza apenas rede preferida, tema e som do ZapChat. Não copia senhas pessoais, áudio, Bluetooth ou permissões. A conexão simultânea com o mesmo Radio ID pode ser recusada pelo servidor; desconecte o outro aparelho.</p><button id="saveCloudPreferences" class="button secondary" type="button">Guardar preferências na conta</button><button id="loadCloudPreferences" class="button secondary" type="button">Trazer preferências da conta</button></details><button id="onboardingClose" type="button" class="button secondary">Agora não</button>`;
 document.body.append(dialog);
 const el=id=>document.getElementById(id),report=t=>el('onboardingStatus').textContent=t;
 let busy=false,targetId='',cloudRevision=null,cloudValue={},emailRetryUntil=0,emailRetryTimer=null;
 const locked=()=>changingProfile||gatewayStatus.pttArmed||gatewayStatus.transmitting||gatewayStatus.rxBusy||mobilePttActive||mobilePttPending;
 function renderEmailRetry(){const remaining=Math.max(0,Math.ceil((emailRetryUntil-Date.now())/1000)),button=el('onboardingSendEmail');if(!remaining){clearInterval(emailRetryTimer);emailRetryTimer=null;if(!busy)button.disabled=false;return;}button.disabled=true;const minutes=Math.floor(remaining/60),seconds=String(remaining%60).padStart(2,'0');report(`Limite temporário de segurança. Tente novamente em ${minutes}:${seconds}.`);}
 function startEmailRetry(seconds){emailRetryUntil=Date.now()+Math.max(1,Number(seconds)||60)*1000;clearInterval(emailRetryTimer);emailRetryTimer=setInterval(renderEmailRetry,1000);renderEmailRetry();}
 async function run(fn){if(busy)return;if(locked())return report('Aguarde o fim da transmissão ou recepção antes de configurar perfis.');busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){if(e.status===429&&e.retryAfterSeconds)startEmailRetry(e.retryAfterSeconds);else report(e.message||'Não foi possível concluir.');}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);renderEmailRetry();}}
 function identity(user){if(!/^[A-Z0-9]{3,8}$/.test(user.callsign)||!/^\d{7}$/.test(String(user.dmrId)))throw Error('O cadastro não contém um indicativo e DMR ID válidos.');return{callsign:user.callsign,dmrId:String(user.dmrId)};}
 async function add(name,values,password=''){
  const result=await profileApi('create',{name,settings:values,hotspotPassword:password,select:false});
  if(!result.ok)throw Error(result.data.error||'Não foi possível guardar o perfil.');
  profiles=result.data.profiles;activeProfileId=result.data.activeProfileId;renderProfiles();return result.data.createdProfileId;
 }
 async function recommended(user){
  const id=identity(user),catalog=await window.ZapDMROfficialProfiles.refresh(),p=catalog.profile;
  // Audio and local permissions remain device-specific. No personal credential is copied.
  const existing=profiles.find(x=>x.callsign===id.callsign&&String(x.dmrId)===id.dmrId&&(x.officialPresetId===p.id&&x.officialPresetRevision===catalog.revision||!x.officialPresetId&&x.masterHost===p.settings.masterHost&&x.xlxModule==='C'));
  if(existing){targetId=existing.id;report('Seu perfil XLX026 existente foi preservado. Confira as configurações antes de conectar.');}
  else{
   const base={...defaults,txGainPercent:settings.txGainPercent,rxVolumePercent:settings.rxVolumePercent,theme:settings.theme,...id};
   targetId=await add(p.name,{...base,...p.settings,officialPresetId:p.id,officialPresetRevision:catalog.revision},p.credential);
   report('Seu indicativo e seu DMR ID foram configurados com sucesso. Seu perfil XLX026 BRASIL está pronto.');
  }
  if(!profiles.some(x=>x.serverType==='brandmeister'&&x.callsign===id.callsign&&String(x.dmrId)===id.dmrId))await add('BrandMeister · '+id.callsign,{...defaults,...id,serverType:'brandmeister',radioProtocol:'odtp',masterHost:'7242.master.brandmeister.network',masterPort:54006,essid:'02',defaultSlot:1,selectedTalkgroupId:724,staticTalkgroups:'',autoConnectOnStartup:true,autoReconnect:true});
  el('onboardingConnect').hidden=false;
 }
 async function activate(){const code=el('deviceActivationCode').value.trim();if(!/^[a-fA-F0-9-]{32,39}$/.test(code))throw Error('Cole o código completo gerado no site. Ele é diferente do código WhatsApp.');const user=await window.ZapDMRCommunity.activateDevice(code);el('deviceActivationCode').value='';await recommended(user);}
 async function useAuthenticated(){const user=await window.ZapDMRCommunity.activationIdentity();await recommended(user);}
 async function sendEmailActivation(){const challenge=await window.ZapDMRCommunity.beginEmailActivation({callsign:el('onboardingCallsign').value,dmrId:el('onboardingDmrId').value,email:el('onboardingEmail').value});el('onboardingEmailStep').hidden=false;el('onboardingEmailCode').focus();report(challenge.message||`Código enviado para ${challenge.destination}.`);}
 async function confirmEmailActivation(){const user=await window.ZapDMRCommunity.completeEmailActivation(el('onboardingEmailCode').value);el('onboardingEmailCode').value='';el('onboardingEmailStep').hidden=true;await recommended(user);report('Dispositivo ativado por e-mail. Seus perfis existentes foram preservados.');}
 function open(){el('onboardingCallsign').value=settings.callsign||'';el('onboardingDmrId').value=settings.dmrId||'';if(!dialog.open)dialog.showModal();}
 el('onboardingSendEmail').onclick=()=>void run(sendEmailActivation);
 el('onboardingConfirmEmail').onclick=()=>void run(confirmEmailActivation);
 el('onboardingEmailCode').oninput=()=>{el('onboardingEmailCode').value=el('onboardingEmailCode').value.replace(/\D/g,'').slice(0,6);};
 el('onboardingEmailCode').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void run(confirmEmailActivation);}};
 el('activateFromSite').onclick=()=>void run(activate);
 el('addRecommendedXlx').onclick=()=>void run(useAuthenticated);
 el('onboardingConnect').onclick=()=>void run(async()=>{if(!targetId)throw Error('Adicione primeiro o perfil recomendado.');dialog.close();await activateSavedProfile(targetId);});
 el('onboardingClose').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 el('onboardingAudio').onclick=()=>{dialog.close();setActiveScreen('settings');setActiveSettingsPane('audio');toast('Use o teste local de microfone/áudio. Ele não transmite na rede.');};
 el('saveCloudPreferences').onclick=()=>void run(async()=>{const service=window.ZapDMRCommunity;if(cloudRevision===null){const loaded=await service.cloudPreferences();cloudRevision=loaded.revision;}const c=service.privateConfig(),preferences={preferredNetwork:isXlx()?'xlx':'dmr',theme:settings.theme,chatSound:c.chatSound!==false};const next=await service.cloudPreferences({revision:cloudRevision,preferences});cloudRevision=next.revision;report('Preferências guardadas. Nenhuma senha pessoal ou permissão foi enviada.');});
 el('loadCloudPreferences').onclick=()=>void run(async()=>{const data=await window.ZapDMRCommunity.cloudPreferences();cloudRevision=data.revision;cloudValue=data.preferences;await useAuthenticated();await window.ZapDMRCommunity.applyImportedPreferences(cloudValue);report('Preferências importadas. Rede preferida: '+(cloudValue.preferredNetwork==='dmr'?'DMR':'XLX026')+'. Seus perfis e a conexão atual foram preservados. Selecione a rede quando desejar conectar.');});
 const launch=document.createElement('button');launch.type='button';launch.className='button secondary';launch.textContent='Ativar cadastro / adicionar XLX026 recomendado';launch.onclick=open;document.querySelector('[data-settings-pane="profile"] .settings-card')?.append(launch);
 window.ZapDMROnboarding={open,recommended};
 async function firstAccess(){await window.ZapDMRCommunity.initialize();await window.ZapDMROfficialProfiles.load();if(!settings.callsign&&!settings.dmrId)open();}
 if(window.ZapDMRReady)void firstAccess().catch(()=>{});else window.addEventListener('zapdmr:ready',()=>void firstAccess().catch(()=>{}),{once:true});
})();
