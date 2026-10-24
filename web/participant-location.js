/* Public APRS observations and offline city centres. Never requests the operator's GPS. */
(() => {
 const tracks=new Map(),countries=new Map(),cache=new Map();
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const base=v=>String(v||'').toUpperCase().split(/[/-]/).find(v=>/^[A-Z0-9]{3,8}$/.test(v)&&/\d/.test(v)&&/[A-Z]/.test(v))||'';
 const dialog=document.createElement('dialog');dialog.className='radio-actions-dialog participant-location';
 dialog.innerHTML='<h2>Localização do colega</h2><p class="location-info" role="status"></p><div class="location-map" role="img" aria-label="Mapa da localização"><div class="location-tiles"></div><svg class="location-trail" aria-hidden="true"></svg><span class="location-pin"></span></div><div class="location-map-controls"><button type="button" data-zoom="1" aria-label="Aproximar mapa">+</button><button type="button" data-zoom="-1" aria-label="Afastar mapa">−</button><button type="button" data-centre>Centralizar</button></div><p class="location-source"></p><p class="hint tiny">Mapa: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. Cidade aproximada: <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> · CC BY 4.0. A posição APRS só é exibida quando recebida nesta sessão; a cidade cadastrada não representa GPS atual.</p><button type="button" class="button secondary location-close">Fechar</button>';
 document.body.append(dialog);
 let selected=null,version=0,centre=null,point=null,trail=[],zoom=12,drag=null;
 const map=dialog.querySelector('.location-map'),info=dialog.querySelector('.location-info'),source=dialog.querySelector('.location-source');
 const xy=(p,z)=>{const n=2**z,s=Math.sin(Math.max(-85.0511,Math.min(85.0511,p.latitude))*Math.PI/180);return {x:(p.longitude+180)/360*n*256,y:(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n*256};};
 const latlon=(p,z)=>{const n=2**z*256;return {longitude:((p.x/n*360)%360+360)%360-180,latitude:Math.atan(Math.sinh(Math.PI*(1-2*p.y/n)))*180/Math.PI};};
 function draw(){
  map.hidden=!centre;dialog.querySelector('.location-map-controls').hidden=!centre;if(!centre)return;
  const w=map.clientWidth||600,h=map.clientHeight||320,c=xy(centre,zoom),left=c.x-w/2,top=c.y-h/2,n=2**zoom;
  const tiles=map.querySelector('.location-tiles');tiles.replaceChildren();
  for(let y=Math.floor(top/256);y<=Math.floor((top+h)/256);y++)for(let x=Math.floor(left/256);x<=Math.floor((left+w)/256);x++){
   if(y<0||y>=n)continue;const img=document.createElement('img');img.alt='';img.referrerPolicy='strict-origin-when-cross-origin';img.draggable=false;img.src=`https://tile.openstreetmap.org/${zoom}/${((x%n)+n)%n}/${y}.png`;img.style.left=(x*256-left)+'px';img.style.top=(y*256-top)+'px';tiles.append(img);
  }
  const screen=p=>{const a=xy(p,zoom);let dx=a.x-c.x;if(dx>n*128)dx-=n*256;if(dx<-n*128)dx+=n*256;return {x:w/2+dx,y:h/2+a.y-c.y};};
  const svg=map.querySelector('svg');svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();
  if(trail.length>1){const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('points',trail.map(p=>{const s=screen(p);return s.x+','+s.y;}).join(' '));svg.append(line);}
  const pin=map.querySelector('.location-pin'),s=screen(point);pin.textContent=trail.length?selected.callsign:'Cidade cadastrada';pin.style.left=s.x+'px';pin.style.top=s.y+'px';
 }
 function recent(call){return [...tracks.entries()].filter(([key])=>base(key)===base(call)).map(([key,rows])=>({key,rows:rows.filter(p=>Date.now()-p.at<3600000)})).filter(v=>v.rows.length).sort((a,b)=>b.rows.at(-1).at-a.rows.at(-1).at)[0];}
 function useAprs(record){trail=record.rows;point=trail.at(-1);centre={...point};zoom=12;info.textContent='Posição APRS recebida · '+record.key+' · '+new Date(point.at).toLocaleString('pt-BR');source.textContent=`${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)} · rastro com ${trail.length} posição(ões) recebida(s).`;draw();}
 function observe(value){
  const event=value?.event||value?.type,data=value?.data||value;
  const rows=event==='station'?[data]:event==='status'?(data.stations||[]):[];
  for(const row of rows){const lat=Number(row.latitude),lon=Number(row.longitude),at=Number(row.at);if(!base(row.callsign)||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||!Number.isFinite(at)||at>Date.now()+60000||Date.now()-at>3600000)continue;
   const key=String(row.callsign).toUpperCase(),list=(tracks.get(key)||[]).filter(p=>Date.now()-p.at<3600000);
   if(!list.some(p=>p.at===at&&p.latitude===lat&&p.longitude===lon))list.push({latitude:lat,longitude:lon,at});list.sort((a,b)=>a.at-b.at);tracks.set(key,list.slice(-60));
  }
  while(tracks.size>500)tracks.delete(tracks.keys().next().value);
  if(dialog.open&&selected&&rows.some(r=>base(r.callsign)===base(selected.callsign))){const r=recent(selected.callsign);if(r){version++;useAprs(r);}}
 }
 async function countryCode(value,call){
  if(!countries.size){const r=await fetch('/cities/index.json');if(!r.ok)throw Error('Catálogo de cidades indisponível.');const codes=await r.json();for(const code of codes){countries.set(norm(code),code);for(const locale of ['pt','en','es'])try{countries.set(norm(new Intl.DisplayNames([locale],{type:'region'}).of(code.toUpperCase())),code);}catch{}}countries.set('brasil','br');countries.set('usa','us');countries.set('unitedstatesofamerica','us');}
  return countries.get(norm(value))||(/^P[P-Y]/.test(base(call))?'br':null);
 }
 const brStates={AC:'Acre',AL:'Alagoas',AP:'Amapa',AM:'Amazonas',BA:'Bahia',CE:'Ceara',DF:'Distrito Federal',ES:'Espirito Santo',GO:'Goias',MA:'Maranhao',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Para',PB:'Paraiba',PR:'Parana',PE:'Pernambuco',PI:'Piaui',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondonia',RR:'Roraima',SC:'Santa Catarina',SP:'Sao Paulo',SE:'Sergipe',TO:'Tocantins'};
 async function open(peer){
  const token=++version;selected={...peer};point=centre=null;trail=[];info.textContent='Consultando APRS e cidade cadastrada…';source.textContent='';dialog.querySelector('h2').textContent='Localização · '+peer.callsign;if(!dialog.open)dialog.showModal();draw();
  const aprs=recent(peer.callsign);if(aprs){useAprs(aprs);return;}
  try{
   const record=await window.ZapDMRRadioBridge.lookupContact(peer.dmrId||peer.callsign);if(token!==version||!dialog.open)return;
   const city=String(record?.city||'').trim(),state=String(record?.state||'').trim(),country=String(record?.country||'');
   if(!city)throw Error('Sem posição APRS recente nem cidade informada na base DMR ID.');
   info.textContent='Cidade cadastrada: '+[city,state,country].filter(Boolean).join(', ')+'. Sem posição APRS recente.';
   const code=await countryCode(country,peer.callsign);if(!code)throw Error('Cidade cadastrada: '+city+'. País insuficiente para localizar com segurança.');
   if(!cache.has(code)){const response=await fetch('/cities/'+code+'.json');if(!response.ok)throw Error('Catálogo deste país indisponível.');cache.set(code,await response.json());while(cache.size>3)cache.delete(cache.keys().next().value);}
   if(token!==version||!dialog.open)return;
   let matches=cache.get(code).filter(r=>norm(r[0])===norm(city)||norm(r[1])===norm(city));
   if(state){const expected=norm(code==='br'?(brStates[state.toUpperCase()]||state):state);matches=matches.filter(r=>norm(r[4])===expected||norm(r[5])===expected);}
   if(!matches.length)throw Error('Cidade cadastrada: '+[city,state,country].filter(Boolean).join(', ')+'. Centro aproximado não encontrado no catálogo local.');
   if(matches.length>1)throw Error('Há mais de uma cidade com esse nome. Complete o estado na base cadastral para evitar uma localização incorreta.');
   const r=matches[0];point=centre={latitude:r[2],longitude:r[3]};zoom=10;source.textContent='Centro aproximado da cidade · não é a localização atual do operador. '+point.latitude.toFixed(4)+', '+point.longitude.toFixed(4);draw();
  }catch(error){if(token===version&&dialog.open){info.textContent=error.message;draw();}}
 }
 dialog.querySelector('.location-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{version++;selected=null;map.querySelector('.location-tiles').replaceChildren();});
 const aprsFi=document.createElement('button');aprsFi.type='button';aprsFi.className='button secondary';aprsFi.textContent='Abrir aprs.fi no navegador · histórico de 1 hora';aprsFi.onclick=async()=>{const call=base(selected?.callsign);if(!call)return;const url='https://aprs.fi/#!z=11&call='+encodeURIComponent('a/'+call)+'&timerange=3600&tail=3600';try{if(window.ZapDMRMobileAudio?.isAndroid?.())await window.ZapDMRMobileAudio.participantAction(call,'aprs');else if(window.ZapDMRDesktop?.openExternal)await window.ZapDMRDesktop.openExternal(url);else window.open(url,'_blank','noopener,noreferrer');}catch(error){info.textContent=error.message;}};dialog.querySelector('.location-close').before(aprsFi);
 for(const b of dialog.querySelectorAll('[data-zoom]'))b.onclick=()=>{zoom=Math.max(2,Math.min(17,zoom+Number(b.dataset.zoom)));draw();};
 dialog.querySelector('[data-centre]').onclick=()=>{if(point){centre={...point};draw();}};
 map.onpointerdown=e=>{if(e.button!==0||!centre)return;drag={x:e.clientX,y:e.clientY,c:xy(centre,zoom)};map.setPointerCapture(e.pointerId);};
 map.onpointerup=e=>{if(!drag)return;centre=latlon({x:drag.c.x-(e.clientX-drag.x),y:drag.c.y-(e.clientY-drag.y)},zoom);drag=null;draw();};map.onpointercancel=()=>drag=null;
 new ResizeObserver(()=>{if(dialog.open&&centre)draw();}).observe(map);
 window.ZapDMRLocations={observe,open};
})();
