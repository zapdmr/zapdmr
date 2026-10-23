/* Windows-only bridge: downloads never depend on a community login or D1. */
(() => {
  const desktop=window.ZapDMRDesktop;
  if(!desktop?.checkUpdates)return;
  const pane=document.querySelector('[data-settings-pane="data"]');
  if(!pane)return;
  const card=document.createElement('div');card.className='settings-card span-all';
  card.innerHTML='<h3>Atualização do ZapDMR Windows</h3><p class="hint tiny">Novas versões são verificadas ao abrir e baixadas em segundo plano. Você escolhe quando reiniciar para concluir.</p><p class="desktop-update-status" role="status"></p><button type="button" class="button secondary desktop-check-update">Verificar atualizações</button><button type="button" class="button primary desktop-apply-update" hidden>Reiniciar e atualizar</button>';
  pane.append(card);
  const status=card.querySelector('.desktop-update-status'),check=card.querySelector('.desktop-check-update'),apply=card.querySelector('.desktop-apply-update');
  const modal=document.createElement('dialog');modal.className='radio-actions-dialog app-update-dialog';
  modal.innerHTML='<h2>Atualização pronta</h2><strong></strong><p>A nova versão já foi baixada e verificada. Deseja desconectar o rádio e reiniciar o ZapDMR para atualizar?</p><p>Seus perfis, senhas protegidas e preferências serão preservados.</p><p class="desktop-update-result" role="status"></p><button type="button" class="button primary desktop-restart">Reiniciar e atualizar</button><button type="button" class="button secondary desktop-later">Agora não</button>';
  document.body.append(modal);
  let value={},offered='',notified='',retry=null,installing=false;
  const tx=()=>Boolean(typeof gatewayStatus!=='undefined'&&(gatewayStatus.pttArmed||gatewayStatus.transmitting));
  function offer(){
    clearTimeout(retry);if(value.state!=='ready'||offered===value.version)return;
    if(tx()){retry=setTimeout(offer,1000);return;}
    offered=value.version;modal.querySelector('strong').textContent='ZapDMR '+value.version;
    modal.querySelector('.desktop-update-result').textContent='';if(!modal.open)modal.showModal();
  }
  function render(next){
    value=next||{};
    status.textContent=(value.currentVersion?'Versão instalada: '+value.currentVersion+'. ':'')+(value.message||'')+
      (value.state==='downloading'&&Number.isFinite(value.progress)?' '+value.progress+'%':'');
    check.disabled=installing||['checking','downloading','staging','installing'].includes(value.state);
    apply.hidden=value.state!=='ready';
    if(value.state==='downloading'&&notified!==value.version){notified=value.version;toast('Nova versão '+value.version+' disponível. Baixando em segundo plano.');}
    if(value.state==='ready')offer();
  }
  check.onclick=async()=>{try{render(await desktop.checkUpdates());}catch(error){status.textContent=error.message;}};
  apply.onclick=()=>{offered='';offer();};
  modal.querySelector('.desktop-later').onclick=()=>{if(!installing)modal.close();};
  modal.addEventListener('cancel',event=>{if(installing)event.preventDefault();});
  modal.querySelector('.desktop-restart').onclick=async()=>{
    if(installing)return;
    const result=modal.querySelector('.desktop-update-result');
    if(tx()){result.textContent='Encerre a transmissão antes de reiniciar e atualizar.';return;}
    installing=true;
    modal.querySelector('.desktop-restart').disabled=true;modal.querySelector('.desktop-later').disabled=true;
    try{await desktop.installUpdate();}
    catch(error){result.textContent=error.message||'Não foi possível reiniciar agora.';installing=false;modal.querySelector('.desktop-restart').disabled=false;modal.querySelector('.desktop-later').disabled=false;}
  };
  const unsubscribe=desktop.onUpdate(render);
  void desktop.updateStatus().then(render).catch(()=>{});
  window.addEventListener('beforeunload',()=>{clearTimeout(retry);unsubscribe?.();},{once:true});
})();
