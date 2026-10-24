/* Durable retry IDs live in the existing encrypted native profile, never localStorage. */
(() => {
 window.createCommunityOutbox=({getConfig,save,remote,changed=()=>{}})=>{
  let flight=null;
  const list=()=>{const c=getConfig();return (Array.isArray(c.outbox)?c.outbox:[]).filter(row=>row.owner===c.account?.id);};
  async function enqueue(to,text,attachmentId,clientId){const c=getConfig();if(!c.account?.id||!c.token)throw new Error('Entre no ZapChat para enviar.');
   const rows=list();if(rows.length>=100)throw new Error('Há 100 mensagens pendentes. Reenvie ou remova uma antes de continuar.');
   const id=clientId||crypto.randomUUID().replace(/-/g,''),prior=rows.find(row=>row.clientId===id);if(prior)return prior;
   const row={owner:c.account.id,to,text,clientId:id,at:Date.now(),state:'pending',...(attachmentId?{attachmentId}:{})};c.outbox=[...rows,row];try{await save();}catch(error){c.outbox=c.outbox.filter(item=>item.clientId!==id);throw error;}changed();return row;
  }
  async function drain(){if(flight)return flight;flight=(async()=>{const owner=getConfig().account?.id;if(!owner||!getConfig().token)return;
    for(const row of list()){if(getConfig().account?.id!==owner)return;row.state='sending';changed();
     try{await remote('/v1/messages',{to:row.to,text:row.text,clientId:row.clientId,...(row.attachmentId?{attachmentId:row.attachmentId}:{})});if(getConfig().account?.id!==owner)return;getConfig().outbox=list().filter(item=>item.clientId!==row.clientId);await save();changed();}
     catch(error){if(getConfig().account?.id!==owner)return;row.state='failed';row.error=error.message;await save();changed();break;}
    }
   })().finally(()=>{flight=null;});return flight;}
  async function remove(id){getConfig().outbox=list().filter(row=>row.clientId!==id);await save();changed();}
  return{enqueue,drain,list,remove};
 };
})();
