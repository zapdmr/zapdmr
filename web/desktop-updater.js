/* Windows-only bridge: downloads never depend on a community login or D1. */
(() => {
  const desktop=window.ZapDMRDesktop;
  if(!desktop?.checkUpdates)return;
  const pane=document.querySelector('[data-settings-pane="data"]');
  if(!pane)return;
  const card=document.createElement('div');card.className='settings-card span-all';
  card.innerHTML='<h3>Atualização do ZapDMR Windows</h3><p class="hint tiny">Verificamos ao abrir e ao retornar ao aplicativo. Você escolhe quando baixar e reiniciar.</p><p class="desktop-update-status" role="status"></p><button type="button" class="button secondary desktop-check-update">Verificar atualizações</button><button type="button" class="button primary desktop-apply-update" hidden>Reiniciar e atualizar</button>';
  pane.append(card);
  const status=card.querySelector('.desktop-update-status'),check=card.querySelector('.desktop-check-update'),apply=card.querySelector('.desktop-apply-update');
  const modal=document.createElement('dialog');modal.className='radio-actions-dialog app-update-dialog';
  modal.innerHTML='<h2>Atualização pronta</h2><strong></strong><p class="desktop-update-meta"></p><button type="button" class="button secondary desktop-notes">Ver novidades</button><pre hidden></pre><p class="desktop-update-explanation">A nova versão já foi baixada e verificada. Deseja desconectar o rádio e reiniciar o ZapDMR para atualizar?</p><p>Seus perfis, senhas protegidas e preferências serão preservados.</p><p class="desktop-update-result" role="status"></p><button type="button" class="button primary desktop-restart">Reiniciar e atualizar</button><button type="button" class="button secondary desktop-later">Agora não</button>';
  document.body.append(modal);
  let value={},offered='',notified='',retry=null,installing=false,offeredAt=0;
  const tx=()=>Boolean(typeof gatewayStatus!=='undefined'&&(gatewayStatus.pttArmed||gatewayStatus.transmitting));
  function offer(){
    clearTimeout(retry);if(!['available','ready'].includes(value.state)||offered===value.state+value.version&&Date.now()-offeredAt<(Number(value.remindAfterHours)||24)*3600000)return;
    if(tx()||gatewayStatus.rxBusy||document.hidden||document.querySelector('dialog[open]:not(.app-update-dialog)')||['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){retry=setTimeout(offer,5000);return;}
    offered=value.state+value.version;offeredAt=Date.now();modal.querySelector('h2').textContent=value.state==='available'?'Nova atualização disponível!':'Atualização pronta';modal.querySelector('strong').textContent='Disponível: ZapDMR '+value.version;modal.querySelector('.desktop-update-meta').textContent='Instalada: '+value.currentVersion+(value.publishedAt?' · Publicada em '+new Date(value.publishedAt).toLocaleDateString():'');modal.querySelector('pre').textContent=value.notes||'';modal.querySelector('.desktop-restart').textContent=value.state==='available'?'Atualizar agora':'Reiniciar e atualizar';modal.querySelector('.desktop-update-explanation').textContent=value.state==='available'?'Deseja baixar a atualização oficial? Você poderá continuar usando o aplicativo durante o download.':'O pacote foi verificado. Reinicie quando terminar sua operação.';
    modal.querySelector('.desktop-update-result').textContent='';if(!modal.open)modal.showModal();
  }
  function render(next){
    value=next||{};
    status.textContent=(value.currentVersion?'Versão instalada: '+value.currentVersion+'. ':'')+(value.message||'')+
      (value.state==='downloading'&&Number.isFinite(value.progress)?' '+value.progress+'%':'');
    check.disabled=installing||['checking','downloading','staging','installing'].includes(value.state);
    apply.hidden=!['available','ready'].includes(value.state);apply.textContent=value.state==='available'?'Atualizar agora':'Reiniciar e atualizar';
    if(value.state==='downloading'&&notified!==value.version){notified=value.version;toast('Nova versão '+value.version+' disponível. Baixando em segundo plano.');}
    if(['available','ready'].includes(value.state))offer();
  }
  check.onclick=async()=>{offered='';try{render(await desktop.checkUpdates());}catch(error){status.textContent=error.message;}};
  apply.onclick=()=>{offered='';offer();};
  modal.querySelector('.desktop-notes').onclick=()=>{const notes=modal.querySelector('pre');notes.hidden=!notes.hidden;};
  modal.querySelector('.desktop-later').onclick=()=>{if(!installing)modal.close();};
  modal.addEventListener('cancel',event=>{if(installing)event.preventDefault();});
  modal.querySelector('.desktop-restart').onclick=async()=>{
    if(installing)return;
    const result=modal.querySelector('.desktop-update-result');
    if(tx()||gatewayStatus.rxBusy){result.textContent='Aguarde terminar a transmissão ou recepção antes de atualizar.';return;}
    if(value.state==='available'){modal.close();offered='';try{render(await desktop.downloadUpdate());}catch(error){status.textContent=error.message;}return;}
    installing=true;
    modal.querySelector('.desktop-restart').disabled=true;modal.querySelector('.desktop-later').disabled=true;
    try{await desktop.installUpdate();}
    catch(error){result.textContent=error.message||'Não foi possível reiniciar agora.';installing=false;modal.querySelector('.desktop-restart').disabled=false;modal.querySelector('.desktop-later').disabled=false;}
  };
  const unsubscribe=desktop.onUpdate(render);
  void desktop.updateStatus().then(render).catch(()=>{});
  window.addEventListener('beforeunload',()=>{clearTimeout(retry);unsubscribe?.();},{once:true});
})();
