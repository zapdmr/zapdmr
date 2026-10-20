/* Profile migration and truthful receive status, shared by both platforms. */
(() => {
  function normalize(value={}) {
    const explicit=['hbp','odtp'].includes(value.radioProtocol);
    const legacyPort=Number(value.masterPort)||62031;
    const radioProtocol=explicit?value.radioProtocol:value.serverType==='other'||![62030,62031,54006].includes(legacyPort)?'hbp':'odtp';
    const serverType=value.serverType==='other'?'other':'brandmeister';
    return {...value,serverType,radioProtocol,
      masterHost:String(value.masterHost||'').trim()||(serverType==='brandmeister'?'7242.master.brandmeister.network':''),
      masterPort:!explicit&&radioProtocol==='odtp'&&[62030,62031].includes(legacyPort)?54006:legacyPort,
      autoConnectOnStartup:value.autoConnectOnStartup!==false,autoReconnect:value.autoReconnect!==false};
  }
  function reception(gateway={},settings={},target=0) {
    const protocol=gateway.protocol||settings.radioProtocol||'hbp';
    if(!gateway.connected)return {state:gateway.state||'disconnected',text:['resolving','waiting-login','waiting-auth','waiting-config','reconnecting'].includes(gateway.state)?`Conectando ao servidor ${protocol.toUpperCase()}…`:`${protocol.toUpperCase()} · ligue ao master para receber.`};
    if(protocol==='hbp')return {state:'unsupported',text:'HBP: servidor não oferece inscrição sem PTT. Recepção depende de TG estática ou do primeiro PTT. Para inscrição automática, escolha ODTP num master compatível.'};
    const rx=gateway.reception;
    if(!rx||Number(rx.targetTalkgroupId)!==Number(target))return {state:'subscribing',text:`TG ${target} — solicitando inscrição ODTP…`};
    return {state:rx.state,text:rx.message||`TG ${target} — aguardando resposta ODTP.`};
  }
  window.ZapDMRProtocol={normalize,reception};
})();
