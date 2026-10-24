// Prepared adapter only: not called by a cron, bridge or production endpoint.
// Credentials are secrets; template/category approval belongs to Meta.
export function officialWhatsAppReady(env){return /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION||'')&&/^\d+$/.test(env.META_PHONE_NUMBER_ID||'')&&Boolean(env.META_WHATSAPP_TOKEN&&env.META_RELEASE_TEMPLATE&&env.META_RELEASE_LANGUAGE);}
export async function sendOfficialRelease(env,{number,consented,version},fetcher=fetch){
  if(!officialWhatsAppReady(env))return {status:'pending_configuration',sent:false};
  if(consented!==true||!/^\+[1-9]\d{7,14}$/.test(number||'')||!/^\d+\.\d+\.\d+$/.test(version||''))throw new Error('Destinatário, versão ou consentimento inválido.');
  const response=await fetcher(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bearer '+env.META_WHATSAPP_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp',to:number.slice(1),type:'template',template:{name:env.META_RELEASE_TEMPLATE,language:{code:env.META_RELEASE_LANGUAGE},components:[{type:'body',parameters:[{type:'text',text:version}]}]}})
  });
  if(!response.ok)throw new Error('A plataforma oficial recusou o envio. Verifique a configuração no painel Meta.');
  const result=await response.json();const messageId=result.messages?.[0]?.id;if(!messageId)throw new Error('Envio sem identificação confirmada pela Meta.');
  // Accepted is not delivered. A signed webhook is required to confirm delivery.
  return {status:'accepted',sent:false,messageId};
}
