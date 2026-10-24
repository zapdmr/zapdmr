/* Only authenticated, signed public radio parameters; no account credentials in this catalog. */
(() => {
 const source=window.ZapDMRRadioPresets,storageKey='zapdmr-signed-radio-presets-v1',url='https://www.zapdmr.com.br/config/radio-profiles.json';
 const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 let current,flight,lastFetch=0;
 async function verify(envelope){
  if(!envelope||envelope.keyId!=='radio-presets-2026'||typeof envelope.payload!=='string'||envelope.payload.length>16000||typeof envelope.signature!=='string')throw Error('Configuração pública inválida.');
  const key=await crypto.subtle.importKey('spki',bytes(source.publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes(envelope.signature),bytes(envelope.payload)))throw Error('Assinatura da configuração não confere.');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(envelope.payload)));
  if(value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.profiles)||value.profiles.length!==1)throw Error('Versão da configuração inválida.');
  const p=value.profiles[0],s=p.settings,c=p.credential;
  if(p.id!=='xlx026-brasil'||typeof p.name!=='string'||p.name.length>40||s.serverType!=='other'||s.radioProtocol!=='hbp'||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(s.masterHost)||!Number.isInteger(s.masterPort)||s.masterPort<1||s.masterPort>65535||s.defaultSlot!==2||s.xlxModule!=='C'||s.userUrl!=='C'||s.selectedTalkgroupId!==4003||s.essid!==''||s.staticTalkgroups!==''||s.hbpOptions!==''||c.kind!=='public-shared')throw Error('Parâmetros de rádio inválidos.');
  if(typeof c.value!=='string'||!/^[\x21-\x7e]{1,20}$/.test(c.value))throw Error('Chave pública do refletor inválida.');
  // Rebuild a whitelist: location, arbitrary executable URLs and personal data cannot enter a profile.
  return{revision:value.revision,profile:{id:p.id,name:p.name,settings:{serverType:'other',radioProtocol:'hbp',masterHost:s.masterHost,masterPort:s.masterPort,defaultSlot:2,xlxModule:'C',userUrl:'C',essid:'',staticTalkgroups:'',hbpOptions:'',selectedTalkgroupId:4003,favorites:[4003],autoReconnect:true,autoConnectOnStartup:true},credential:c.value},envelope};
 }
 async function load(){if(current)return current;current=await verify(source.bundled);try{const cached=await verify(JSON.parse(localStorage.getItem(storageKey)));if(cached.revision>=current.revision)current=cached;}catch{}return current;}
 async function refresh(){await load();if(flight)return flight;if(Date.now()-lastFetch<3600000)return current;lastFetch=Date.now();flight=(async()=>{try{const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('offline');const text=await response.text();if(text.length>24000)throw Error('size');const next=await verify(JSON.parse(text));if(next.revision<current.revision||next.revision===current.revision&&next.envelope.payload!==current.envelope.payload)throw Error('Revisão antiga ou divergente.');current=next;try{localStorage.setItem(storageKey,JSON.stringify(next.envelope));}catch{}}catch{/* Use the last authenticated configuration offline. */}return current;})().finally(()=>flight=null);return flight;}
 window.ZapDMROfficialProfiles={load,refresh,verify};
})();
