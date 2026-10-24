/* Quick access to existing protected profiles. Never copies passwords. */
(() => {
  const scan=document.getElementById('pttScan');if(!scan)return;
  const shell=document.createElement('div');shell.className='reception-profile-shell';scan.before(shell);shell.append(scan);
  const nav=document.createElement('nav');nav.className='quick-profile-switch';nav.setAttribute('aria-label','Trocar perfil de rádio');shell.append(nav);
  let busy=false;
  const buttons={};
  const kind=p=>p.serverType==='brandmeister'?'dmr':p.serverType==='other'&&(p.xlxModule==='C'||String(p.masterHost||'').toLowerCase()==='xlx026.net')?'xlx':null;
  const dialog=document.createElement('dialog');dialog.className='talkgroup-dialog quick-profile-dialog';dialog.setAttribute('aria-label','Selecionar perfil salvo');document.body.append(dialog);
  function unavailable(type){setActiveScreen('settings');setActiveSettingsPane('profile');toast(type==='xlx'?'Adicione e configure um perfil XLX026 nas Definições → Perfil.':'Configure um perfil BrandMeister nas Definições → Perfil.');}
  async function activate(p){
    if(busy||changingProfile)return;
    if(gatewayStatus.pttArmed||gatewayStatus.transmitting||mobilePttActive||mobilePttPending)return toast('Encerre a transmissão antes de trocar de perfil.');
    busy=true;dialog.close();render();
    try{await activateSavedProfile(p.id);}catch(error){toast(error.message);}finally{busy=false;render();}
  }
  function choose(type){
    if(busy||changingProfile)return;
    const list=profiles.filter(p=>kind(p)===type);
    if(!list.length){if(type==='xlx'&&window.ZapDMROnboarding)return window.ZapDMROnboarding.open();return unavailable(type);}
    if(list.length===1)return void activate(list[0]);
    const heading=document.createElement('h2');heading.textContent=type==='dmr'?'Perfis DMR salvos':'Perfis XLX salvos';dialog.replaceChildren(heading);
    for(const p of list){const b=document.createElement('button');b.type='button';b.className='button secondary';b.textContent=p.name+' · '+(p.callsign||'sem indicativo')+(p.id===activeProfileId?' · atual':'');b.onclick=()=>void activate(p);dialog.append(b);}
    const cancel=document.createElement('button');cancel.type='button';cancel.className='button secondary';cancel.textContent='Cancelar';cancel.onclick=()=>dialog.close();dialog.append(cancel);dialog.showModal();
  }
  for(const [type,label] of [['dmr','DMR'],['xlx','XLX026']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label','Usar perfil '+label+' salvo');b.onclick=()=>choose(type);nav.append(b);buttons[type]=b;}
  function render(){
    const active=profiles.find(p=>p.id===activeProfileId),type=active?kind(active):(isXlx()?'xlx':settings.serverType==='brandmeister'?'dmr':null);
    const locked=busy||changingProfile||Boolean(gatewayStatus.pttArmed||gatewayStatus.transmitting||mobilePttActive||mobilePttPending)||['resolving','waiting-login','waiting-auth','waiting-config','reconnecting'].includes(gatewayStatus.state);
    for(const [key,b] of Object.entries(buttons)){const confirmed=type===key&&gatewayStatus.connected===true;b.disabled=locked;b.setAttribute('aria-pressed',String(confirmed));b.dataset.loaded=String(type===key);b.title=busy?'Trocando perfil…':type===key?(gatewayStatus.connected?'Perfil conectado':'Perfil carregado · desconectado'):'Carregar perfil '+key.toUpperCase()+' salvo';}
    nav.setAttribute('aria-busy',String(busy||changingProfile));
    document.getElementById('scanTalkgroups').disabled=isXlx()||busy||changingProfile;
    scan.disabled=isXlx()||busy||changingProfile;
  }
  window.ZapDMRQuickProfiles={render,switching:()=>busy};
  window.addEventListener('zapdmr:radio-event',event=>{if(['status','ptt','settings'].includes(event.detail?.event))render();});
  window.addEventListener('zapdmr:ready',render);render();
})();
