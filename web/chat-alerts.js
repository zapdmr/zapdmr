/* One gentle mixed tone per burst. No microphone, audio-focus request or radio operation. */
(() => {
 let audio=null,lastTone=0,plugin=null;
 try{if(window.Capacitor?.getPlatform?.()==='android')plugin=window.Capacitor.registerPlugin('ZapChatPush');}catch{}
 const seen=new Set();let account='',latest=null,items=[];
 function context(){if(!audio)audio=new (window.AudioContext||window.webkitAudioContext)();return audio;}
 document.addEventListener('pointerdown',()=>{if(!plugin)try{void context().resume();}catch{}},{once:true,capture:true});
 async function tone(){if(Date.now()-lastTone<1000)return;lastTone=Date.now();
  try{const c=context();await c.resume();if(c.state!=='running')return;const osc=c.createOscillator(),gain=c.createGain(),now=c.currentTime;osc.type='sine';osc.frequency.setValueAtTime(740,now);gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.025,now+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+.14);osc.connect(gain);gain.connect(c.destination);osc.onended=()=>{osc.disconnect();gain.disconnect();};osc.start(now);osc.stop(now+.16);}catch{}
 }
 function reset(id=''){if(account===id)return;account=id;seen.clear();latest=null;items=[];try{for(const id of JSON.parse(localStorage.getItem('zapchat-notified-'+account)||'[]'))seen.add(id);}catch{}render(0);void window.ZapDMRDesktop?.clearChatNotifications?.();}
 function remember(id){seen.add(id);while(seen.size>1000)seen.delete(seen.values().next().value);try{localStorage.setItem('zapchat-notified-'+account,JSON.stringify([...seen]));}catch{}}
 function render(total,conversations=[]){items=conversations;latest=items.find(v=>v.unread>0)?.peer||null;const button=document.querySelector('.rc-top-contact');if(!button)return;let badge=button.querySelector('.chat-unread-badge');if(!badge){badge=document.createElement('span');badge.className='chat-unread-badge';badge.setAttribute('aria-hidden','true');button.append(badge);}badge.hidden=!(total>0);badge.textContent=total>99?'99+':String(total||0);button.setAttribute('aria-label',total?'Abrir ZapChat · '+total+' mensagens não lidas':'Abrir ZapChat');button.title=button.getAttribute('aria-label');}
 async function notify(message,peer,config,open){
  reset(config.account?.id||'');if(!account||!message?.id||seen.has(message.id))return;remember(message.id);
  const sound=config.chatSound!==false;
  const background=document.hidden||!document.hasFocus();
  if(plugin){try{await plugin.localNotice({peerId:peer.id,messageId:message.id,accountId:account,callsign:peer.callsign,sound,background});}catch{}}
  else{if(sound)void tone();if(background&&window.ZapDMRDesktop?.notifyChat)try{await window.ZapDMRDesktop.notifyChat({peerId:peer.id,messageId:message.id,accountId:account,callsign:peer.callsign});}catch{}}
 }
 window.ZapDMRChatAlerts={notify,render,reset,latest:()=>latest};
})();
