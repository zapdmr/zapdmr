(() => {
  const cards=document.getElementById('participantCardsList');
  const tableWrap=document.querySelector('.participant-table-wrap');
  if(!cards||!tableWrap)return;

  const clean=value=>String(value??'').trim();
  const valid=value=>value&&!/^(?:null|undefined|unknown|n\/a|—)$/i.test(value);
  const text=value=>valid(clean(value))?clean(value):'Não informado';
  const countryCode=item=>{
    const raw=clean(item.countryCode||item.country).toUpperCase();
    return /^[A-Z]{2}$/.test(raw)?raw:/^(BRASIL|BRAZIL)$/.test(raw)?'BR':'';
  };
  const flag=item=>{const code=countryCode(item);return code?[...code].map(char=>String.fromCodePoint(127397+char.charCodeAt(0))).join(''):'';};
  const time=value=>{const date=new Date(Number(value));return Number.isFinite(date.getTime())?date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';};
  const identity=item=>clean(item.sourceId||item.id||item.callsign).toUpperCase();
  const location=item=>[clean(item.location||item.city),clean(item.state),clean(item.country)].filter(valid).filter((value,index,list)=>list.indexOf(value)===index).join(', ')||'Não informado';
  const active=(item,index)=>{if(!gatewayStatus?.rxBusy)return false;const source=clean(gatewayStatus?.rxSourceId||gatewayStatus?.sourceId).toUpperCase(),callsign=clean(gatewayStatus?.rxCallsign||gatewayStatus?.callsign).toUpperCase();return source?identity(item)===source:callsign?clean(item.callsign).toUpperCase()===callsign:index===0;};
  let mode=settings.operation?.participantView==='cards'?'cards':'list',fontSize=settings.operation?.participantFontSize||'normal';
  let latest=[],history=[];

  function setMode(next){
    mode=next==='cards'?'cards':'list';
    const desktop=window.matchMedia('(min-width: 761px)').matches;
    const showTable=desktop&&mode==='list';
    cards.hidden=showTable;tableWrap.hidden=!showTable;cards.dataset.view=mode;
  }
  function setFontSize(next){fontSize=['small','large'].includes(next)?next:'normal';cards.dataset.fontSize=fontSize;tableWrap.dataset.fontSize=fontSize;}

  function render(items=[]){
    history=items.slice();const seen=new Set();latest=history.filter(item=>{const key=identity(item);if(!key||seen.has(key))return false;seen.add(key);return true;});
    const priorScroll=cards.scrollTop,keepScroll=priorScroll>12;
    const fragment=document.createDocumentFragment();
    latest.forEach((item,index)=>{
      const button=document.createElement('button');button.type='button';button.className='participant-card';button.setAttribute('role','listitem');button.dataset.dmrId=clean(item.sourceId||item.id);button.dataset.callsign=clean(item.callsign).toUpperCase();
      if(active(item,index))button.classList.add('active-rx');
      const rank=document.createElement('span');rank.className='participant-rank';rank.textContent=String(index+1);
      const isRecent=active(item,index)||Date.now()-Number(item.at)<60000;
      const state=document.createElement('span');state.className=`participant-state ${isRecent?'online':'offline'}`;state.textContent=active(item,index)?'◉':'●';state.setAttribute('aria-label',active(item,index)?'Operador em recepção':isRecent?'Atividade recente':'Sem atividade recente');
      const info=document.createElement('span');info.className='participant-card-info';
      const call=document.createElement('strong');call.textContent=text(item.callsign);
      const name=document.createElement('span');name.textContent=text(item.name);
      const place=document.createElement('small'),code=countryCode(item),emoji=document.createElement('span');emoji.className='participant-country-emoji';emoji.textContent=flag(item);place.append(emoji);
      if(code){const image=document.createElement('img');image.className='participant-country-flag';image.src=`/flags/${code.toLowerCase()}.svg`;image.alt='';image.onerror=()=>image.remove();place.append(image);}
      place.append(document.createTextNode(location(item)));
      info.append(call,name,place);
      const stamp=document.createElement('time');stamp.dateTime=new Date(Number(item.at)||Date.now()).toISOString();stamp.textContent=time(item.at);
      const arrow=document.createElement('span');arrow.className='participant-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');
      button.append(rank,state,info,stamp,arrow);
      button.setAttribute('aria-label',`Detalhes de ${text(item.callsign)}, ${text(item.name)}`);
      button.onclick=()=>window.ZapDMRParticipantActions?.open(item);
      fragment.append(button);
    });
    cards.replaceChildren(fragment);
    if(keepScroll)cards.scrollTop=priorScroll;
    const count=document.getElementById('participantCount');if(count)count.textContent=`${latest.length} ${latest.length===1?'participante':'participantes'}`;
    const empty=document.getElementById('participantsEmpty');if(empty)empty.hidden=latest.length>0;
    setMode(mode);
  }
  setMode(mode);setFontSize(fontSize);
  window.matchMedia('(min-width: 761px)').addEventListener('change',()=>setMode(mode));
  document.getElementById('topSettings').onclick=()=>{setActiveScreen('settings');setActiveSettingsPane('display');};
  document.getElementById('homeButton').onclick=event=>{event.preventDefault();setActiveScreen('ptt');};
  document.getElementById('selectedTalkgroupCard').onclick=()=>document.getElementById('quickTalkgroupSelect').click();
  window.ZapDMRHome={renderParticipants:render,setParticipantView:setMode,setParticipantFontSize:setFontSize,participants:()=>history.slice()};
  if(['localhost','127.0.0.1'].includes(location.hostname)&&new URLSearchParams(location.search).get('preview')==='home20')setTimeout(()=>{
    document.documentElement.dataset.theme='dark';for(const delay of [0,500,1200])setTimeout(()=>{document.querySelector('.onboarding-dialog[open]')?.close();setActiveScreen?.('ptt');},delay);
    const now=Date.now();gatewayStatus.rxBusy=true;gatewayStatus.rxSourceId='7240599';render([
      {at:now,sourceId:'7240599',callsign:'PT9EXU',name:'Andre',location:'Três Lagoas, MS',country:'Brasil',talkgroupId:4003,slot:2},
      {at:now-78000,sourceId:'7240600',callsign:'PU2SUH',name:'Ataide',location:'São Paulo, SP',country:'Brasil',talkgroupId:4003,slot:2},
      {at:now-128000,sourceId:'7240601',callsign:'PT9GTA',name:'Ronaldo',location:'Dourados, MS',country:'Brasil',talkgroupId:4003,slot:2},
      {at:now-171000,sourceId:'7240602',callsign:'PU1MAV',name:'Morais',location:'Rio de Janeiro, RJ',country:'Brasil',talkgroupId:4003,slot:2},
      {at:now-221000,sourceId:'7240603',callsign:'PY2ABC',name:'Carlos',location:'Campinas, SP',country:'Brasil',talkgroupId:4003,slot:2},
      {at:now-280000,sourceId:'7240604',callsign:'PS7JAP',name:'Jairo',location:'Fortaleza, CE',country:'Brasil',talkgroupId:4003,slot:2}
    ]);
  },1000);
})();
