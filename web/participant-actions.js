(() => {
  const valid=value=>typeof value==='string'&&value.length>=3&&value.length<=20&&/[A-Z]/.test(value)&&/\d/.test(value)&&/^[A-Z0-9]{1,8}(?:\/[A-Z0-9]{1,8}){0,2}$/.test(value);
  const native=()=>mobileAudio?.isAndroid?.();
  const transmitting=()=>Boolean(mobilePttActive||mobilePttPending||gatewayStatus.pttArmed||gatewayStatus.transmitting);
  const present=value=>{const text=String(value??'').trim();return text&&!/^(?:null|undefined|unknown|n\/a|—)$/i.test(text)?text:'';};
  const actions=document.createElement('dialog');actions.className='radio-actions-dialog participant-details-dialog';actions.setAttribute('aria-labelledby','participantDetailsTitle');actions.innerHTML=`<header><div><p class="kicker">DETALHES DO PARTICIPANTE</p><h2 id="participantDetailsTitle">Participante</h2></div><button class="gear participant-details-close" type="button" aria-label="Fechar detalhes">×</button></header><div class="participant-profile"><span class="participant-profile-icon" aria-hidden="true">⌁</span><div><strong id="participantDetailsCallsign"></strong><span id="participantDetailsName"></span><small id="participantDetailsLocation"></small></div></div><div class="participant-primary-actions"></div><section><h3>Informações da rodada</h3><dl class="participant-details-list"></dl></section><div class="participant-secondary-actions"></div>`;
  document.body.append(actions);
  actions.querySelector('.participant-details-close').onclick=()=>actions.close();
  actions.addEventListener('click',event=>{if(event.target===actions)actions.close();});
  const primary=actions.querySelector('.participant-primary-actions');
  const secondary=actions.querySelector('.participant-secondary-actions');
  let selected={};
  function action(container,label,fn,className='button secondary'){
    const button=document.createElement('button');button.type='button';button.className=className;button.textContent=label;
    button.onclick=async()=>{button.disabled=true;try{await fn();}catch(error){toast(error.message||'Não foi possível concluir.');}finally{button.disabled=false;}};
    container.append(button);return button;
  }
  const qrzButton=action(primary,'QRZ.com',async()=>{const callsign=present(selected.callsign).toUpperCase();if(!valid(callsign))throw Error('Indicativo inválido.');if(native())await mobileAudio.participantAction(callsign,'qrz');else{const url='https://www.qrz.com/db/'+encodeURIComponent(callsign);if(window.ZapDMRDesktop?.openExternal)await window.ZapDMRDesktop.openExternal(url);else window.open(url,'_blank','noopener,noreferrer');}actions.close();});
  action(primary,'ZapChat',async()=>{if(!window.ZapDMRCommunity)throw Error('ZapChat indisponível neste dispositivo.');const peer={...selected};actions.close();await window.ZapDMRCommunity.openParticipant(peer.callsign,peer.dmrId);});
  const privateButton=action(primary,'Chamada privada',async()=>{const peer={...selected};if(!peer.dmrId)throw Error('Radio ID deste colega indisponível.');await window.ZapDMRRadioBridge.selectContact({id:Number(peer.dmrId),callsign:peer.callsign});actions.close();setActiveScreen('ptt');toast('Destino privado selecionado. Toque no PTT para falar.');});
  const historyButton=action(secondary,'Histórico deste indicativo',async()=>{const matches=(window.ZapDMRHome?.participants()||[]).filter(item=>present(item.callsign).toUpperCase()===present(selected.callsign).toUpperCase());if(matches.length<2)throw Error('Não há transmissões anteriores nesta rodada.');toast(`${matches.length} transmissões deste indicativo na rodada atual.`);});
  action(secondary,'Ver localização',async()=>{const peer={...selected};actions.close();await window.ZapDMRLocations.open(peer);});
  action(secondary,'Copiar indicativo',async()=>{const callsign=present(selected.callsign).toUpperCase();if(!valid(callsign))throw Error('Indicativo inválido.');if(native())await mobileAudio.participantAction(callsign,'copy');else await navigator.clipboard.writeText(callsign);toast('Indicativo copiado.');});

  function detail(label,value){if(!present(value))return null;const term=document.createElement('dt');term.textContent=label;const description=document.createElement('dd');description.textContent=present(value);return [term,description];}
  function open(item={}){
    const group=groupSelected?.()||{};const dmrId=present(item.sourceId||item.id);
    selected={...item,callsign:present(item.callsign).toUpperCase(),dmrId:/^\d{1,8}$/.test(dmrId)?dmrId:''};
    actions.querySelector('#participantDetailsTitle').textContent=selected.callsign||'Participante';
    actions.querySelector('#participantDetailsCallsign').textContent=selected.callsign||'Indicativo não informado';
    actions.querySelector('#participantDetailsName').textContent=present(item.name)||'Nome não informado';
    actions.querySelector('#participantDetailsLocation').textContent=[present(item.location||item.city),present(item.state),present(item.country)].filter(Boolean).join(', ')||'Localização não informada';
    const network=isXlx?.()?'XLX026':'DMR';
    const values=[detail('Última transmissão',item.at?new Date(Number(item.at)).toLocaleString('pt-BR'):''),detail('TalkGroup / destino',item.talkgroupId?`TG ${item.talkgroupId}`:''),detail('Rede / refletor',network),detail('Módulo',isXlx?.()?present(settings.xlxModule):''),detail('Timeslot',item.slot||group.slot||settings.defaultSlot?`TS ${item.slot||group.slot||settings.defaultSlot}`:''),detail('DMR ID',selected.dmrId)].filter(Boolean);
    const list=actions.querySelector('.participant-details-list');list.replaceChildren(...values.flat());
    qrzButton.disabled=!valid(selected.callsign);privateButton.disabled=!selected.dmrId||Number(selected.dmrId)===Number(settings.dmrId);
    const matches=(window.ZapDMRHome?.participants()||[]).filter(value=>present(value.callsign).toUpperCase()===selected.callsign);historyButton.hidden=matches.length<2;
    actions.showModal();
  }
  function decorate(){for(const cell of document.querySelectorAll('#participantsRows td[data-column="callsign"]')){if(cell.querySelector('.participant-action'))continue;const callsign=cell.textContent.trim().toUpperCase();if(!valid(callsign))continue;const button=document.createElement('button');button.type='button';button.className='participant-action';button.textContent=callsign;button.setAttribute('aria-label','Detalhes de '+callsign);button.onclick=()=>open({callsign,name:cell.dataset.participantName||'',sourceId:cell.dataset.dmrId||''});cell.replaceChildren(button);}}

  const power=document.createElement('dialog');power.className='radio-actions-dialog';power.setAttribute('aria-label',native()?'Deseja desconectar e fechar o ZapDMR?':'Deseja desconectar o ZapDMR?');const heading=document.createElement('h2');heading.textContent=power.getAttribute('aria-label');power.append(heading);const info=document.createElement('p');info.textContent=native()?'O rádio será desconectado e o aplicativo fechado. Ao abrir novamente, o último perfil será reconectado automaticamente.':'A recepção e a ligação ao master serão encerradas. Você poderá conectar novamente.';power.append(info);document.body.append(power);
  action(power,'Cancelar',()=>power.close());
  action(power,native()?'Sair':'Desconectar',async()=>{if(transmitting())throw Error(native()?'Encerre a transmissão antes de sair.':'Termine a transmissão antes de desconectar.');stopTalkgroupScan();if(native())await mobileAudio.quickExit();else{const result=await callApi('/api/disconnect',{method:'POST',body:'{}'});if(!result.ok)throw Error(result.data?.message||'Não foi possível desconectar.');const status=await callApi('/api/status');if(status.ok)showStatus(status.data);}power.close();});
  document.getElementById('radioPower').onclick=()=>{if(transmitting())return toast(native()?'Encerre a transmissão antes de sair.':'Termine a transmissão antes de desconectar.');if(!native()&&!gatewayStatus.connected&&!['resolving','waiting-login','waiting-auth','waiting-config','reconnecting'].includes(gatewayStatus.state))return toast('ZapDMR já está desconectado.');power.showModal();};
  if(native()){document.getElementById('radioPower').setAttribute('aria-label','Sair do ZapDMR');document.getElementById('radioPower').title='Saída rápida';}
  window.ZapDMRParticipantActions={decorate,open,valid};decorate();
})();
