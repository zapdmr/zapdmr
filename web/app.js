const $ = (selector) => document.querySelector(selector);
const mobileAudio = window.ZapDMRMobileAudio;
const catalogActivity = window.ZapDMRTalkgroups;
const defaultFrequencyHz = '433500000';
const defaults = window.ZapDMRProtocol.normalize({ callsign: '', dmrId: '', essid: '02', rxFrequencyHz: defaultFrequencyHz, txFrequencyHz: defaultFrequencyHz, masterHost: '', masterPort: 62031, serverType: 'brandmeister', staticTalkgroups: '', locationName: '', latitude: '', longitude: '', defaultSlot: 1, theme: 'auto', autoConnectOnStartup: true, autoReconnect: true, totLimitSeconds: 180, totWarningSeconds: 10, totVisualAlert: true, totSoundAlert: true, txGainPercent: 100, rxVolumePercent: 100, selectedTalkgroupId: 724, favorites: [724] });
let settings = { ...defaults };
let groups = window.ZapDMRCatalog.bundled;
let apiAvailable = false;
let passwordConfigured = false;
let passwordStoreError = false;
let gatewayStatus = { connected: false, pttArmed: false };
let automationStatus = { reconnecting: false };
let talkgroupActivity = {};
let participants = [];
let dmrIdDatabase = { records: 0, bytes: 0, updatedAt: null };
let profiles = [];
let activeProfileId = '';
let totStatus = {};
let disconnectInProgress = false;
let talkgroupBurstStatus = { pending: false, purpose: null, talkgroupId: null };
const audioMeterResetTimers = { TX: undefined, RX: undefined };
const audioLevels = { TX: 0, RX: 0 };
let categoryValue = 'Nacionais';
let quickCatalogScope = 'national';
let activityFilter = 'all';
let catalogActivitySignature = '';
let scanEnabled = false;
let scanBusy = false;
let scanSelectedSince = 0;
let toastTimer;
let mobileSecureConfig = {};
let mobilePttHolding = false;
let mobilePttPending = false;
let mobilePttActive = false;
let mobileFirmwareReady = false;
let privateContact = null;
const transmitTarget=()=>privateContact?{id:Number(privateContact.id),slot:settings.defaultSlot||1,callType:'private'}:{...groupSelected(),callType:'group'};

function setActiveScreen(name) {
  const selected = ['ptt', 'connection', 'settings'].includes(name) ? name : 'ptt';
  document.querySelectorAll('[data-screen-panel]').forEach((panel) => {
    const active = panel.dataset.screenPanel === selected;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  document.querySelectorAll('.bottom-nav-button[data-screen]').forEach((button) => {
    const active = button.dataset.screen === selected;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function setActiveSettingsPane(name) {
  const selected = [...document.querySelectorAll('[data-settings-pane]')].some(pane=>pane.dataset.settingsPane===name) ? name : 'profile';
  document.querySelectorAll('[data-settings-pane]').forEach((pane) => {
    const active = pane.dataset.settingsPane === selected;
    pane.hidden = !active;
    pane.classList.toggle('active', active);
  });
  document.querySelectorAll('.settings-tab[data-settings-tab]').forEach((button) => {
    const active = button.dataset.settingsTab === selected;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

async function callApi(url, options = {}) {
  try {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000), ...options });
    const data = await response.json();
    return { available: true, ok: response.ok, data };
  } catch {
    return { available: false, ok: false, data: {} };
  }
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function saveLocal() {
  localStorage.setItem('zapdmr-settings', JSON.stringify(settings));
}

function updatePasswordHint() {
  $('#passwordHint').textContent = mobileAudio?.isAndroid?.()
    ? (passwordConfigured ? 'Senha guardada cifrada no armazenamento seguro Android.' : 'A senha ficará cifrada no Android quando guardar o perfil.')
    : passwordStoreError
    ? 'O Windows não conseguiu ler a senha protegida. Digite-a novamente e guarde o perfil.'
    : passwordConfigured
      ? 'Senha guardada localmente com proteção do Windows; não aparece no settings.json.'
      : 'Digite a Hotspot Security Password e guarde o perfil para habilitar a ligação automática.';
}

let changingProfile=false;
async function profileApi(action,payload={}) {
  if(changingProfile)return {ok:false,data:{error:'Aguarde a troca de perfil.'}};
  if(action!=='list'&&(gatewayStatus.pttArmed||gatewayStatus.transmitting))return {ok:false,data:{error:'Termine a transmissão antes de trocar perfil.'}};
  changingProfile=true;
  try{
    if(action!=='list'){stopTalkgroupScan();privateContact=null;++selectionRevision;}
    let result;
    if(mobileAudio?.isAndroid?.()){
      const data=await mobileAudio.radioProfiles({action,...payload});result={ok:true,data};
      mobileSecureConfig=await mobileAudio.loadRadioConfig();passwordConfigured=!!mobileSecureConfig.hotspotPassword;
    }else{
      const path=action==='activate'?`/api/profiles/${encodeURIComponent(payload.id)}/activate`:action==='delete'?`/api/profiles/${encodeURIComponent(payload.id)}`:'/api/profiles';
      result=await callApi(path,action==='list'?{}:{method:action==='delete'?'DELETE':'POST',body:JSON.stringify(payload)});
    }
    if(result.ok&&action!=='list'){gatewayStatus={connected:false,state:'disconnected'};talkgroupActivity={};participants=[];renderAudioMeter();masterLinkInitialized=false;}
    return result;
  }catch(error){return {ok:false,data:{error:error.message||'Não foi possível trocar perfil.'}};}
  finally{changingProfile=false;}
}
function renderProfiles() {
  const select = $('#profileSelect');
  if (!select) return;
  select.replaceChildren(...profiles.map((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.name} · ${profile.callsign || 'sem indicativo'} · ${profile.dmrId || 'sem ID'}`;
    return option;
  }));
  select.value = activeProfileId;
  $('#deleteProfile').disabled = profiles.length <= 1;
}

function applySettingsToForm(value) {
  settings = { ...defaults, ...window.ZapDMRProtocol.normalize(value) };
  settings.favorites = Array.isArray(settings.favorites) ? [...new Set(settings.favorites.map(Number).filter(Number.isInteger))] : [724];
  activeProfileId = value.profileId || activeProfileId;
  if (!mobileAudio?.isAndroid?.()) {
    passwordConfigured = Boolean(value.passwordConfigured);
    passwordStoreError = Boolean(value.passwordStoreError);
  }
  settings.rxFrequencyHz = normalizeFrequency(settings.rxFrequencyHz);
  settings.txFrequencyHz = normalizeFrequency(settings.txFrequencyHz);
  setTheme(settings.theme || 'auto');
  window.ZapDMROperation?.apply();
  window.ZapDMRConsole?.apply(settings);
  window.ZapDMRCommunity?.applyProfile();
  $('#profileName').value = value.profileName || '';
  $('#callsign').value = settings.callsign;
  $('#dmrId').value = settings.dmrId;
  $('#essid').value = settings.essid ?? '01';
  $('#xlxMode').checked=settings.xlxModule==='C';
  $('#userUrl').value=settings.userUrl||'';
  $('#hbpOptions').value=settings.hbpOptions||'';
  $('#rxFrequencyHz').value = settings.rxFrequencyHz;
  $('#txFrequencyHz').value = settings.txFrequencyHz;
  $('#serverType').value = settings.serverType || 'brandmeister';
  $('#master').value = settings.masterHost;
  $('#bmMasterSelect').value = ['master.brandmeister.network', '7242.master.brandmeister.network'].includes(settings.masterHost) ? settings.masterHost : '';
  $('#masterPort').value = settings.masterPort || 62031;
  $('#radioProtocol').value=settings.radioProtocol;updateRadioProtocolForm();
  $('#staticTalkgroups').value = settings.staticTalkgroups || '';
  $('#locationName').value = settings.locationName || '';
  $('#latitude').value = settings.latitude || '';
  $('#longitude').value = settings.longitude || '';
  $('#defaultSlot').value = String(settings.defaultSlot || 1);
  $('#otherServerFields').hidden = settings.serverType !== 'other';
  $('#bmMasterPickerLabel').hidden = settings.serverType === 'other';
  $('#autoConnectOnStartup').checked = Boolean(settings.autoConnectOnStartup);
  $('#autoReconnect').checked = Boolean(settings.autoReconnect);
  $('#totLimitSeconds').value = settings.totLimitSeconds;
  $('#totWarningSeconds').value = settings.totWarningSeconds;
  $('#totVisualAlert').checked = Boolean(settings.totVisualAlert);
  $('#totSoundAlert').checked = Boolean(settings.totSoundAlert);
  $('#txGainPercent').value = settings.txGainPercent;
  $('#rxVolumePercent').value = settings.rxVolumePercent;
  $('#txGainValue').textContent = `${settings.txGainPercent}%`;
  $('#rxVolumeValue').textContent = `${settings.rxVolumePercent}%`;
  updatePasswordHint();
}

function normalizeFrequency(value) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return /^\d{9}$/.test(text) && text !== '000000000' ? text : defaultFrequencyHz;
}

const xlxGroup={id:4003,slot:2,name:'XLX026 · Módulo C · TS2',category:'Nacionais',kind:'group'};
function isXlx(){return settings.serverType==='other'&&settings.xlxModule==='C';}
function groupSelected() {
  if(isXlx())return xlxGroup;
  return groups.find((group) => group.id === Number(settings.selectedTalkgroupId)) || groups[0];
}

function setTheme(value) {
  settings.theme = value;
  document.documentElement.dataset.theme = value;
  $('#theme').value = value;
  saveLocal();
}

function categoryName(value) {
  return value === 'Mundiais' || value === 'Mundiais/Países' ? 'Mundiais' : 'Nacionais';
}

// Preserve older custom TGs while presenting only the two current categories.
function catalogCategory(group) {
  if (group.category === 'Mundiais' || group.category === 'Mundiais/Países') return 'Mundiais';
  if (['Nacionais', 'Regiões', 'Estados'].includes(group.category)) return 'Nacionais';
  const bundled = window.ZapDMRCatalog.bundled.find(item => Number(item.id) === Number(group.id));
  if (bundled?.category === 'Mundiais' || bundled?.category === 'Mundiais/Países') return 'Mundiais';
  if (['Nacionais', 'Regiões', 'Estados'].includes(bundled?.category)) return 'Nacionais';
  return /^724/.test(String(group.id)) || [1, 2, 8, 9, 915, 4000].includes(Number(group.id)) ? 'Nacionais' : 'Mundiais';
}

function catalogCategories() {
  return ['Nacionais', 'Mundiais'];
}

function isNationalGroup(group) {
  return catalogCategory(group) === 'Nacionais';
}

function matchesCatalogCategory(group, category) {
  return category === 'all' || (category === 'Nacionais' ? isNationalGroup(group) : catalogCategory(group) === category);
}

function renderQuickTalkgroups() {
  const visible = settings.xlxModule==='C'?[xlxGroup]:groups.filter(group => quickCatalogScope === 'national' ? isNationalGroup(group)
    : quickCatalogScope === 'world' ? catalogCategory(group) === 'Mundiais' : true);
  const current = groups.find(group => group.id === Number(settings.selectedTalkgroupId));
  const outside = current && !visible.includes(current);
  updateQuickTalkgroupIndicators();
  document.querySelectorAll('[data-quick-catalog-filter]').forEach(button => {
    const active = button.dataset.quickCatalogFilter === quickCatalogScope;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const hint = $('#quickCatalogHint');
  if (hint) hint.textContent = `${visible.length} TGs nesta lista · 🟢 atividade recente · 🔴 sem atividade recente. Filtrar não muda a TG atual.${outside ? ` TG ${current.id} mantida, fora do filtro.` : ''}`;
}

// Freeze catalog, selection and activity when opening. Network refreshes never
// replace a row under the operator's finger or reset the dialog scroll position.
let quickPickerSnapshot = [], quickPickerSelectedId = 0, quickPickerScope = 'all';
function openQuickTalkgroupPicker() {
  if ($('#quickTalkgroupDialog').open) return;
  quickPickerSnapshot = (settings.xlxModule==='C'?[xlxGroup]:groups).map(group => ({...group, category: catalogCategory(group), active: hasRecentActivity(group.id)}));
  quickPickerSelectedId = Number(settings.selectedTalkgroupId);
  quickPickerScope = quickCatalogScope;
  $('#quickTalkgroupSearch').value = '';
  renderQuickTalkgroupPicker();
  $('#quickTalkgroupDialog').showModal();
}
function renderQuickTalkgroupPicker() {
  const query = $('#quickTalkgroupSearch').value.trim().toLocaleLowerCase('pt-BR');
  const visible = quickPickerSnapshot.filter(group =>
    (quickPickerScope === 'all' || group.category === (quickPickerScope === 'national' ? 'Nacionais' : 'Mundiais')) &&
    (!query || `${group.id} ${group.name}`.toLocaleLowerCase('pt-BR').includes(query)));
  const rows = visible.map(group => {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'tg-picker-row'; row.dataset.talkgroupId = String(group.id);
    row.setAttribute('aria-pressed', String(group.id === quickPickerSelectedId));
    row.title = `TG ${group.id} · ${group.name}`;
    const led = document.createElement('i'); led.className = `tg-picker-led${group.active ? ' active' : ''}`;
    led.setAttribute('aria-label', group.active ? 'Atividade recente' : 'Sem atividade recente');
    const id = document.createElement('b'); id.textContent = `TG ${group.id}`;
    const name = document.createElement('span'); name.className = 'tg-picker-name'; name.textContent = group.name;
    const mark = document.createElement('span'); mark.className = 'tg-picker-check'; mark.textContent = group.id === quickPickerSelectedId ? '✓' : '';
    mark.setAttribute('aria-hidden', 'true'); row.append(led,id,name,mark);
    row.onclick = () => { $('#quickTalkgroupDialog').close(); void selectGroup(group.id); };
    return row;
  });
  $('#quickTalkgroupOptions').replaceChildren(...rows);
  $('#quickTalkgroupOptions').scrollTop = 0;
  $('#quickTalkgroupEmpty').hidden = rows.length > 0;
  document.querySelectorAll('[data-picker-filter]').forEach(button => {
    const active = button.dataset.pickerFilter === quickPickerScope;
    button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));
  });
}

function hasRecentActivity(id) {
  return catalogActivity.recent(talkgroupActivity[String(id)]);
}

function callerLabel(id) {
  const activity = talkgroupActivity[String(id)];
  if (!activity || typeof activity !== 'object' || !hasRecentActivity(id)) return '';
  const callsign = typeof activity.lastCallerCallsign === 'string' ? activity.lastCallerCallsign.trim() : '';
  const name = typeof activity.lastCallerName === 'string' ? activity.lastCallerName.trim() : '';
  return callsign && name ? `${callsign} (${name})` : callsign || name;
}

function setLedState(led, active) {
  if (!led) return;
  led.classList.toggle('active', active);
  led.title = active ? 'Tráfego nos últimos 60 segundos' : 'Sem tráfego nos últimos 60 segundos';
  led.setAttribute('aria-label', led.title);
}

function updateQuickTalkgroupIndicators(){
  const button=$('#quickTalkgroupSelect'),group=groupSelected();if(!group)return;
  const label=`${hasRecentActivity(group.id)?'🟢':'🔴'} TG ${group.id} · ${group.name}`;
  if(button.textContent!==label)button.textContent=label;
}
function updateActivityDots() {
  updateQuickTalkgroupIndicators();
  document.querySelectorAll('.talkgroup-led[data-talkgroup-id]').forEach((led) =>
    setLedState(led, hasRecentActivity(led.dataset.talkgroupId)));
  setLedState($('#selectedActivityLed'), hasRecentActivity(groupSelected()?.id));
  document.querySelectorAll('.activity-caller[data-talkgroup-id]').forEach((caller) => {
    const label = callerLabel(caller.dataset.talkgroupId);
    caller.textContent = label;
    caller.hidden = !label;
  });
  const selectedCaller = $('#selectedCaller');
  const selectedLabel = callerLabel(groupSelected()?.id);
  selectedCaller.textContent = selectedLabel;
  selectedCaller.hidden = !selectedLabel;
  window.ZapDMRRadioBridge?.reflectTarget();
}

function renderAudioMeter(data = {}) {
  const direction = data.direction === 'TX' || data.direction === 'RX' ? data.direction : 'IDLE';
  const level = Math.max(0, Math.min(100, Number(data.level) || 0));
  if (direction === 'IDLE') { audioLevels.TX = 0; audioLevels.RX = 0; }
  else audioLevels[direction] = level;
  for (const axis of ['TX', 'RX']) {
    const value = audioLevels[axis];
    const segments = [...$(`#${axis.toLowerCase()}AudioMeterSegments`).children];
    const litCount = Math.ceil((value / 100) * segments.length);
    segments.forEach((segment, index) => segment.classList.toggle('lit', index < litCount));
    $(`#${axis.toLowerCase()}AudioMeterValue`).textContent = value > 0 ? `${Math.round(value * 0.48 - 54)} dBFS` : '— dBFS';
    segments[0]?.closest('[role="meter"]')?.setAttribute('aria-valuenow', String(value));
  }
  const caller = [data.callsign, data.callerName].filter(Boolean);
  const callerLabel = data.callsign && data.callerName ? `${data.callsign} (${data.callerName})` : caller.join('');
  $('#audioMeterCaller').textContent = direction === 'IDLE' ? '' : `${callerLabel}${data.talkgroupId ? ` · TG ${data.talkgroupId}` : ''}`;
}

function updateDisconnectControl() {
  const checkbox = $('#disconnectTalkgroup');
  const busy = disconnectInProgress || Boolean(gatewayStatus.talkgroupBurstActive) || Boolean(talkgroupBurstStatus.pending);
  checkbox.disabled = isXlx() || (!apiAvailable && !mobileAudio?.isAndroid?.()) || !gatewayStatus.connected || Boolean(gatewayStatus.pttArmed) || busy;
  checkbox.checked = disconnectInProgress;
  $('#disconnectTalkgroupText').innerHTML = disconnectInProgress
    ? '<b>A desconectar TG 4000…</b><small>Enviando áudio silencioso</small>'
    : (isXlx()?'<b>XLX · Módulo C</b><small>Use Desligar para encerrar a sessão</small>':gatewayStatus.protocol==='odtp'||settings.radioProtocol==='odtp'?'<b>Cancelar inscrição</b><small>ODTP · sem TG 4000</small>':'<b>Desconectar</b><small>TG 4000 · slot atual</small>');
  $('#quickDisconnectLabel').classList.toggle('busy', disconnectInProgress);
}

function renderSelected() {
  const group = groupSelected();
  if (!group) return;
  $('#pttScreenTitle').textContent='TalkGroup ativa';
  $('#selectedId').textContent = `TG ${group.id}`;
  $('#selectedName').textContent = group.name;
  $('#selectedMeta').textContent = [group.slot ? `TS ${group.slot}` : 'Slot não indicado', group.note].filter(Boolean).join(' · ');
  const selectedCaller = $('#selectedCaller');
  selectedCaller.textContent = callerLabel(group.id);
  selectedCaller.hidden = !selectedCaller.textContent;
  $('#selectedCategory').textContent = categoryName(catalogCategory(group));
  $('#favoriteSelected').textContent = settings.favorites.includes(group.id) ? '★' : '☆';
  updateQuickTalkgroupIndicators();
  $('#selectedActivityLed').dataset.talkgroupId = String(group.id);
  setLedState($('#selectedActivityLed'), hasRecentActivity(group.id));
  renderParticipants();
  window.ZapDMRRadioBridge?.reflectTarget();
}

function renderParticipants() {
  if (window.ZapDMROperation) return window.ZapDMROperation.renderParticipants();
  const selectedId = Number(groupSelected()?.id);
  const cutoff = Date.now() - 30 * 60 * 1000;
  const current = participants.filter((item) => Number(item.talkgroupId) === selectedId && Number(item.at) >= cutoff)
    .sort((left, right) => Number(right.at) - Number(left.at)).slice(0, 50);
  const body = $('#participantsRows');
  body.replaceChildren();
  for (const item of current) {
    const row = document.createElement('tr');
    const time = document.createElement('td');
    time.textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(item.at));
    const callsign = document.createElement('td'); callsign.textContent = item.callsign || '—';
    const name = document.createElement('td'); name.textContent = item.name || '—';
    const location = document.createElement('td');
    location.textContent = [item.location, item.country].filter(Boolean).join(' · ') || '—';
    row.append(time, callsign, name, location);
    body.append(row);
  }
  $('#participantCount').textContent = String(current.length);
  $('#participantsEmpty').hidden = current.length > 0;
}

function updateDmrDatabaseInfo(value = dmrIdDatabase) {
  dmrIdDatabase = { ...dmrIdDatabase, ...(value || {}) };
  const bytes = Number(dmrIdDatabase.bytes) || 0;
  const size = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  const updated = dmrIdDatabase.updatedAt ? new Date(dmrIdDatabase.updatedAt).toLocaleString('pt-BR') : 'sem atualização';
  $('#dmrDatabaseInfo').textContent = `${Number(dmrIdDatabase.records) || 0} registos · ${size} · ${updated}`;
  $('#deleteDmrDatabase').disabled = !(Number(dmrIdDatabase.records) > 0);
}

function updateTotStatus(tot = {}) {
  totStatus = tot || {};
  const element = $('#totState');
  if (!tot.active || !Number(tot.startedAt)) { element.hidden = true; element.textContent = ''; $('#ptt').classList.remove('tot-warning'); return; }
  const elapsed = Math.floor((Date.now() - Number(tot.startedAt)) / 1000);
  const remaining = Math.max(0, Number(tot.limitSeconds || settings.totLimitSeconds) - elapsed);
  element.hidden = false;
  element.textContent = `TOT ativo · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} restantes`;
  const warningSeconds = Number(tot.warningSeconds ?? settings.totWarningSeconds);
  element.classList.toggle('warning', warningSeconds > 0 && remaining <= warningSeconds);
  $('#ptt').classList.toggle('tot-warning',settings.totVisualAlert!==false&&warningSeconds>0&&remaining<=warningSeconds);
}

function playTotAlert() {
  if (!window.AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.12, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.start(); oscillator.stop(context.currentTime + 0.35);
  oscillator.onended = () => void context.close();
}

function renderFavorites() {
  const host = $('#favorites');
  host.replaceChildren();
  const items = groups.filter((group) => settings.favorites.map(Number).includes(group.id));
  $('#favoritesEmpty').hidden = items.length > 0;
  for (const group of items) {
    const button = document.createElement('button');
    button.className = 'favorite-item';
    button.type = 'button';
    const id = document.createElement('b'); id.textContent = group.id;
    const name = document.createElement('span'); name.textContent = group.name;
    const led = document.createElement('i'); led.className = 'activity-led talkgroup-led'; led.dataset.talkgroupId = String(group.id); setLedState(led, hasRecentActivity(group.id)); button.append(led, id, name, document.createTextNode('›'));
    button.onclick = () => selectGroup(group.id);
    host.append(button);
  }
}

function renderGroups() {
  const visible = isXlx()?[xlxGroup]:filteredCatalogGroups();
  const host = $('#groups');
  host.replaceChildren();
  for (const group of visible) {
    const row = document.createElement('article');
    row.setAttribute('role', 'listitem');
    row.className = `group-row${group.id === Number(settings.selectedTalkgroupId) ? ' chosen' : ''}${group.custom ? ' custom' : ''}`;
    const info = document.createElement('div'); info.className = 'group-info';
    const led = document.createElement('i'); led.className = 'activity-led talkgroup-led';
    led.dataset.talkgroupId = String(group.id);
    setLedState(led, hasRecentActivity(group.id));
    const name = document.createElement('b'); name.textContent = group.name;
    const meta = document.createElement('small'); meta.textContent = [`TG ${group.id}`, group.slot ? `TS ${group.slot}` : null, group.region || categoryName(catalogCategory(group))].filter(Boolean).join(' · ');
    const caller = document.createElement('small'); caller.className = 'activity-caller'; caller.dataset.talkgroupId = String(group.id);
    caller.textContent = callerLabel(group.id); caller.hidden = !caller.textContent;
    info.append(name, meta, caller);
    const select = document.createElement('button');
    select.className = 'select'; select.type = 'button';
    select.textContent = group.id === Number(settings.selectedTalkgroupId) ? 'Selecionada' : 'Selecionar';
    select.onclick = () => selectGroup(group.id, { keepScreen: true });
    const star = document.createElement('button');
    star.className = 'row-star'; star.type = 'button';
    star.textContent = settings.favorites.includes(group.id) ? '★' : '☆';
    star.setAttribute('aria-label', settings.favorites.includes(group.id) ? 'Remover favorito' : 'Adicionar favorito');
    star.onclick = () => toggleFavorite(group.id);
    row.append(led, info, select, star);
    if (group.custom) {
      const remove = document.createElement('button');
      remove.className = 'remove-talkgroup'; remove.type = 'button'; remove.textContent = '×';
      remove.title = `Remover TG ${group.id}`; remove.setAttribute('aria-label', `Remover TG ${group.id}`);
      remove.onclick = () => removeTalkgroup(group.id);
      row.append(remove);
    }
    host.append(row);
  }
  $('#count').textContent = `${visible.length}/${groups.length} TGs`;
  $('#empty').hidden = visible.length > 0;
  renderQuickTalkgroups();
  renderSelected();
  renderFavorites();
  updateActivityDots();
  updateActivityFilterCounts();
}

function filteredCatalogGroups(status = activityFilter) {
  const source = groups.filter(group => matchesCatalogCategory(group, categoryValue)
    && (status !== 'favorites' || settings.favorites.map(Number).includes(group.id)));
  return catalogActivity.filter(source, { category: 'all', query: $('#search').value,
    status: status === 'favorites' ? 'all' : status, activity: talkgroupActivity });
}

function updateActivityFilterCounts() {
  const base = filteredCatalogGroups('all');
  const active = base.filter((group) => hasRecentActivity(group.id)).length;
  $('#activeTgCount').textContent = String(active);
  $('#offlineTgCount').textContent = String(base.length - active);
  document.querySelectorAll('[data-activity-filter]').forEach((button) => {
    const selected = button.dataset.activityFilter === activityFilter;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function stopTalkgroupScan() {
  scanEnabled = false;
  $('#scanTalkgroups').textContent = '▶ Scan';
  $('#scanTalkgroups').setAttribute('aria-pressed', 'false');
  $('#scanStatus').textContent = 'Verde: atividade recente · vermelho: sem tráfego observado.';
}

async function scanTalkgroupsTick() {
  if (!scanEnabled || scanBusy) return;
  if (gatewayStatus.pttArmed || gatewayStatus.transmitting || mobilePttActive) {
    $('#scanStatus').textContent = 'Scan pausado durante a transmissão.';
    return;
  }
  const pool=settings.console?.scan?.favoritesOnly?filteredCatalogGroups('all').filter(item=>settings.favorites.includes(item.id)):filteredCatalogGroups('all');
  const target = catalogActivity.scanTarget(pool, talkgroupActivity,
    settings.selectedTalkgroupId, scanSelectedSince,Date.now(),Math.max(0,Math.min(30,Number(settings.console?.scan?.holdSeconds??4)))*1000);
  if (!target) { $('#scanStatus').textContent = 'Scan: a procurar TGs com atividade…'; return; }
  if (target.id !== Number(settings.selectedTalkgroupId)) {
    scanBusy = true;
    try {
      await selectGroup(target.id, { keepScreen: true, fromScan: true });
      scanSelectedSince = Date.now();
    } catch (error) { toast(error.message || 'Falha ao sintonizar durante o scan.'); stopTalkgroupScan(); }
    finally { scanBusy = false; }
  }
  if (scanEnabled) $('#scanStatus').textContent = `Scan: TG ${target.id} · ${catalogActivity.live(talkgroupActivity[String(target.id)]) ? 'em comunicação' : 'atividade recente'} · troca automática`;
}

function refreshCatalogActivity() {
  const signature = groups.map((group) => `${group.id}:${hasRecentActivity(group.id)}`).join('|');
  if (signature !== catalogActivitySignature) { catalogActivitySignature = signature; renderGroups(); }
  else { updateActivityDots(); updateActivityFilterCounts(); }
  void scanTalkgroupsTick();
}

function renderCategories() {
  const values = catalogCategories();
  if (categoryValue !== 'all' && !values.includes(categoryValue)) categoryValue = 'all';
  const select = $('#category');
  select.replaceChildren(new Option('Todas as categorias', 'all'), ...values.map((value) => new Option(value, value)));
  select.value = categoryValue;
  const chips = $('#chips');
  chips.replaceChildren();
  for (const [value, label] of [['all', 'Todas'], ...values.map((value) => [value, value])]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${categoryValue === value ? ' active' : ''}`;
    button.textContent = label;
    button.setAttribute('aria-pressed', String(categoryValue === value));
    if (value === 'Nacionais') button.title = 'Brasil: nacionais, regiões e estados';
    button.onclick = () => { categoryValue = value; select.value = value; renderCategories(); renderGroups(); };
    chips.append(button);
  }
}

async function persist(password = '') {
  if(window.ZapDMRCommunity)await window.ZapDMRCommunity.beforeSave();
  saveLocal();
  if (mobileAudio?.isAndroid?.()) {
    if(changingProfile)throw new Error('Aguarde a troca de perfil.');
    const storedPassword = password || mobileSecureConfig.hotspotPassword || '';
    const community=window.ZapDMRCommunity?.privateConfig()||mobileSecureConfig.community||{};
    await mobileAudio.saveRadioConfig({ settings: { ...settings, profileName: $('#profileName').value.trim() }, customTalkgroups: groups.filter((group) => group.custom), hotspotPassword: storedPassword,community });
    mobileSecureConfig = { settings: { ...settings, profileName: $('#profileName').value.trim() }, hotspotPassword: storedPassword,community };
    const list=await profileApi('list');if(list.ok){profiles=list.data.profiles;activeProfileId=list.data.activeProfileId;renderProfiles();}
    passwordConfigured = Boolean(storedPassword);
    passwordStoreError = false;
    await mobileAudio.configureOperation(settings.operation||{},settings.console||{},settings);
    return;
  }
  if (!apiAvailable) return;
  const result = await callApi('/api/settings', { method: 'POST', body: JSON.stringify({ ...settings, profileName: $('#profileName').value.trim(), hotspotPassword: password }) });
  if (result.ok) {
    passwordConfigured = Boolean(result.data.passwordConfigured);
    passwordStoreError = Boolean(result.data.passwordStoreError);
    if (result.data.profileId) activeProfileId = result.data.profileId;
    const profileList = await callApi('/api/profiles');
    if (profileList.ok) { profiles = profileList.data.profiles || []; activeProfileId = profileList.data.activeProfileId || activeProfileId; renderProfiles(); }
  } else throw new Error(result.data.error || 'Não foi possível guardar as preferências no servidor local.');
}

function readSettingsFromForm() {
  settings.callsign = $('#callsign').value.trim().toUpperCase();
  settings.dmrId = $('#dmrId').value.trim();
  settings.essid = $('#essid').value.trim();
  settings.rxFrequencyHz = normalizeFrequency($('#rxFrequencyHz').value.trim());
  settings.txFrequencyHz = normalizeFrequency($('#txFrequencyHz').value.trim());
  settings.serverType = $('#serverType').value === 'other' ? 'other' : 'brandmeister';
  settings.masterHost = $('#master').value.trim();
  settings.masterPort = Number($('#masterPort').value);
  settings.radioProtocol=$('#radioProtocol').value==='odtp'?'odtp':'hbp';
  settings.xlxModule=$('#xlxMode').checked&&settings.serverType==='other'?'C':undefined;
  settings.userUrl=$('#userUrl').value.trim();settings.hbpOptions=$('#hbpOptions').value.trim();
  if(settings.xlxModule){settings.radioProtocol='hbp';settings.defaultSlot=2;settings.selectedTalkgroupId=4003;}
  settings.staticTalkgroups = $('#staticTalkgroups').value.trim();
  settings.locationName = $('#locationName').value.trim();
  settings.latitude = $('#latitude').value.trim();
  settings.longitude = $('#longitude').value.trim();
  settings.defaultSlot = Number($('#defaultSlot').value) === 2 ? 2 : 1;
  settings.totLimitSeconds = Number($('#totLimitSeconds').value);
  settings.totWarningSeconds = Number($('#totWarningSeconds').value);
  settings.totVisualAlert = $('#totVisualAlert').checked;
  settings.totSoundAlert = $('#totSoundAlert').checked;
  settings.txGainPercent = Number($('#txGainPercent').value);
  settings.rxVolumePercent = Number($('#rxVolumePercent').value);
  if(isXlx()){settings.defaultSlot=2;settings.radioProtocol='hbp';settings.selectedTalkgroupId=4003;}
  return settings;
}

let masterLinkInitialized=false,desktopTunePending=0,selectionRevision=0;
let selectionSaves=Promise.resolve();
async function tuneSelectedTalkgroup(id){
  const group=groups.find(item=>item.id===Number(id));
  if(mobileAudio?.isAndroid?.()){
    if(!gatewayStatus.connected&&!['resolving','waiting-login','waiting-auth','waiting-config','reconnecting'].includes(gatewayStatus.state)){
      const config=await mobileAudio.loadRadioConfig();if(config.hotspotPassword)await mobileAudio.connectRadio(settings,config.hotspotPassword);
    }
    return mobileAudio.tuneTalkgroup(id,group?.slot||settings.defaultSlot||1);
  }
  if(!apiAvailable)return;
  desktopTunePending++;
  try{
    const result=await callApi('/api/link-talkgroup',{method:'POST',body:JSON.stringify({talkgroupId:Number(id),slot:group?.slot||settings.defaultSlot||1})});
    if(!result.ok)throw new Error(result.data?.message||'Falha ao selecionar TalkGroup.');
    masterLinkInitialized=true;
  }finally{desktopTunePending--;}

}
async function selectGroup(id, options = {}) {
  if(isXlx()&&Number(id)!==4003)return toast('Este perfil utiliza XLX026 · Módulo C · TG 4003 · TS2.');
  if ((gatewayStatus.pttArmed||gatewayStatus.transmitting)&&!gatewayStatus.talkgroupBurstActive)return toast('Termine o PTT antes de trocar TG.');
  if (!options.fromScan) stopTalkgroupScan();
  privateContact=null;
  const revision=++selectionRevision;settings.selectedTalkgroupId=id;renderGroups();
  selectionSaves=selectionSaves.catch(()=>{}).then(async()=>{if(revision!==selectionRevision)return;settings.selectedTalkgroupId=id;await persist();});
  try{
    await selectionSaves;if(revision!==selectionRevision)return;
    renderAudioMeter({direction:'RX',level:0});
    if(!options.fromScan)toast(`A trocar para TG ${id}…`);
    await tuneSelectedTalkgroup(id);if(revision!==selectionRevision)return;
    renderGroups();renderReceptionState();if(!options.keepScreen)setActiveScreen('ptt');
    if(!options.fromScan&&!mobileAudio?.isAndroid?.())toast(settings.radioProtocol==='odtp'?`TG ${id} — inscrição ODTP solicitada, aguardando resposta.`:`TG ${id} — filtro HBP selecionado; servidor não oferece inscrição sem PTT.`);
  }catch(error){toast(error.message);if(options.fromScan)stopTalkgroupScan();}
}

async function toggleFavorite(id) {
  const favorites = new Set(settings.favorites);
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  settings.favorites = [...favorites];
  await persist();
  renderGroups();
}

async function refreshTalkgroups() {
  const result = await callApi('/api/talkgroups');
  if (!result.ok) throw new Error(result.data.error || 'Não foi possível atualizar o catálogo de TalkGroups.');
  groups = result.data;
  const previousSelected = settings.selectedTalkgroupId;
  const previousFavorites = settings.favorites;
  settings.favorites = settings.favorites.filter((id) => groups.some((group) => group.id === id));
  if (!isXlx()&&!groups.some((group) => group.id === Number(settings.selectedTalkgroupId))) {
    settings.selectedTalkgroupId = groups.find((group) => group.id === 724)?.id ?? groups[0]?.id ?? 724;
  }
  if (previousSelected !== settings.selectedTalkgroupId || previousFavorites.length !== settings.favorites.length) {
    await persist();
  }
  renderCategories();
  renderGroups();
}

async function removeTalkgroup(id) {
  if (mobileAudio?.isAndroid?.()) {
    groups = groups.filter((group) => group.id !== id || !group.custom);
    settings.favorites = settings.favorites.filter((favorite) => Number(favorite) !== id);
    if (Number(settings.selectedTalkgroupId) === id) settings.selectedTalkgroupId = groups[0]?.id || 724;
    localStorage.setItem('zapdmr-custom-talkgroups', JSON.stringify(groups.filter((group) => group.custom)));
    await persist(); await mobileAudio.watchTalkgroups(groups.map((group) => group.id)); renderCategories(); renderGroups(); return;
  }
  if (!apiAvailable) return toast('Inicie o servidor ZapDMR para alterar o catálogo persistente.');
  const result = await callApi(`/api/talkgroups/${id}`, { method: 'DELETE' });
  if (!result.ok) return toast(result.data.error || 'Não foi possível remover a TG personalizada.');
  try { await refreshTalkgroups(); toast(`TG ${id} removida do catálogo personalizado.`); }
  catch (error) { toast(error.message || 'A TG foi removida, mas o catálogo não atualizou.'); }
}

function showStatus(data) {
  if (data.audioLevel) renderAudioMeter(data.audioLevel);
  const gateway = data.brandmeister || {};
  gatewayStatus = { ...gateway, disconnectingTalkgroup: Boolean(gateway.disconnectingTalkgroup || data.disconnectTalkgroupPending) };
  talkgroupBurstStatus = data.talkgroupBurst || { pending: false, purpose: null, talkgroupId: null };
  const automation = data.connectionAutomation || {};
  automationStatus = automation;
  if (data.talkgroupActivity && typeof data.talkgroupActivity === 'object') talkgroupActivity = data.talkgroupActivity;
  if (Array.isArray(data.participants)) participants = data.participants;
  if (data.dmrIdDatabase) updateDmrDatabaseInfo(data.dmrIdDatabase);
  updateTotStatus(data.tot);
  renderParticipants();
  const connected = Boolean(gateway.connected);
  const armed = Boolean(gateway.pttArmed);
  const reconnecting = Boolean(automation.reconnecting);
  $('#serverState').textContent = data.server === 'ready' ? 'Ativo' : 'Indisponível';
  $('#udpState').textContent = data.udpTelemetry?.enabled ? `127.0.0.1:${data.udpTelemetry.port}` : 'Indisponível';
  $('#gatewayState').textContent = reconnecting ? 'A reconectar…' : connected ? (armed ? 'PTT preparado' : 'Ligado') : (gateway.state === 'error' ? 'Falha na ligação' : 'Desligado');
  $('#gatewayState').classList.toggle('online', connected);
  $('#gatewayState').classList.toggle('error', gateway.state === 'error' && !reconnecting);
  $('#gatewayState').classList.toggle('reconnecting', reconnecting);
  $('#gatewayMessage').textContent = automation.message || gateway.message || 'A sessão de rádio não está ligada.';
  renderReceptionState();
  $('#badge').innerHTML = `<i></i> ${reconnecting ? 'A reconectar…' : connected ? (armed ? 'PTT preparado' : 'Ligado') : 'Painel pronto'}`;
  $('#badge').classList.toggle('online', connected);
  $('#badge').classList.toggle('reconnecting', reconnecting);
  const connectionPending = ['resolving', 'waiting-login', 'waiting-auth', 'waiting-config'].includes(gateway.state);
  $('#connect').textContent = connected ? 'Desligar' : reconnecting || connectionPending ? 'Cancelar ligação' : 'Ligar ao master';
  $('#connect').disabled = disconnectInProgress || Boolean(gateway.talkgroupBurstActive) || Boolean(talkgroupBurstStatus.pending);
  $('#ptt').disabled = !gateway.pttReady || disconnectInProgress || Boolean(gateway.talkgroupBurstActive) || Boolean(talkgroupBurstStatus.pending);
  $('#ptt').textContent = armed ? '■ Desarmar PTT' : '🎙 Preparar PTT';
  const audio = data.audioSidecar || {};
  $('#audioState').textContent = audio.state === 'ready'
    ? 'Áudio auxiliar: pronto.'
    : audio.state === 'reconnecting'
      ? `Áudio auxiliar: ${audio.status || 'reconectando…'}`
      : audio.state === 'error'
        ? `Áudio auxiliar: indisponível. ${audio.status || audio.error?.message || ''}`
        : `Áudio auxiliar: ${audio.status || audio.state || 'a iniciar'}.`;
  if(!gatewayStatus.connected)masterLinkInitialized=false;
  if(!privateContact&&gatewayStatus.connected&&audio.state==='ready'&&!masterLinkInitialized&&!desktopTunePending&&!mobileAudio?.isAndroid?.()){
    masterLinkInitialized=true;void tuneSelectedTalkgroup(settings.selectedTalkgroupId).catch(error=>{masterLinkInitialized=false;console.warn(error.message);});
  }
  if(talkgroupBurstStatus.pending&&talkgroupBurstStatus.purpose==='link')$('#gatewayMessage').textContent=`A trocar para TG ${talkgroupBurstStatus.talkgroupId}…`;
  const lastHeard = data.brandmeisterLastHeard || {};
  $('#lastHeardState').textContent = lastHeard.state === 'connected'
    ? 'Last Heard global: conectado; atividade de TGs em tempo real.'
    : `Last Heard global: ${lastHeard.message || lastHeard.state || 'indisponível'}`;
  $('#catalogActivitySource').textContent = lastHeard.state === 'connected' ? 'Atividade global BrandMeister · janela de 60 s' : 'Monitor global indisponível: indicando apenas o tráfego observado.';
  updateDisconnectControl();
  updateActivityDots();
}

function connectWebSocket() {
  if (!apiAvailable || !window.WebSocket) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.onmessage = (event) => {
    try {
      const packet = JSON.parse(event.data);
      window.dispatchEvent(new CustomEvent('zapdmr:radio-event',{detail:packet}));
      if (packet.event === 'status') showStatus(packet.data);
      if (packet.event === 'audio-level') {
        const direction = packet.data?.direction;
        if (direction === 'TX' || direction === 'RX') clearTimeout(audioMeterResetTimers[direction]);
        renderAudioMeter(packet.data);
        if (packet.data?.level > 0 && (direction === 'TX' || direction === 'RX'))
          audioMeterResetTimers[direction] = setTimeout(() => renderAudioMeter({ direction, level: 0 }), 450);
      }
      if (packet.event === 'talkgroup-activity') {
        const previous = talkgroupActivity[String(packet.data.id)];
        talkgroupActivity[String(packet.data.id)] = {
          ...(previous && typeof previous === 'object' ? previous : {}),
          ...packet.data
        };
        refreshCatalogActivity();
      }
      if (packet.event === 'participant') {
        participants = [packet.data, ...participants.filter((item) => item.key !== packet.data?.key)];
        renderParticipants();
      }
      if (packet.event === 'tot-warning') {
        if (packet.data?.visual) {
          $('#totState').classList.add('warning');
          toast(`Aviso TOT: faltam ${packet.data.secondsRemaining} segundos para liberar o PTT.`);
        }
        if (packet.data?.sound) playTotAlert();
      }
      if (packet.event === 'tot-expired') {
        toast(`TOT: PTT liberado após ${packet.data?.limitSeconds || settings.totLimitSeconds} segundos.`);
        updateTotStatus({ active: false });
      }
    } catch { /* Ignore malformed local status events. */ }
  };
  socket.onclose = () => setTimeout(connectWebSocket, 2500);
}

function displayMobileStatus(data = {}) {
  window.ZapDMRConsole?.updateStatus(data);
  const connected = Boolean(data.connected);
  const reconnecting = data.state === 'reconnecting';
  if(!connected){mobilePttActive=false;mobilePttPending=false;mobilePttHolding=false;}
  gatewayStatus = { ...gatewayStatus, ...data, connected, pttArmed: mobilePttActive, transmitting: mobilePttActive,
    pttReady: Boolean(data.pttReady), state: data.state || (connected ? 'connected' : 'disconnected'), message: data.message || '' };
  automationStatus = { reconnecting, message: data.message || '' };
  $('#serverState').textContent = 'Rádio nativo';
  $('#udpState').textContent = connected ? `UDP · ${settings.masterHost}:${settings.masterPort}` : 'Sessão '+(settings.radioProtocol||'hbp').toUpperCase()+' local';
  $('#gatewayState').textContent = reconnecting ? 'A reconectar…' : connected ? (mobilePttActive ? 'Transmitindo' : 'Ligado') : data.state === 'error' ? 'Falha na ligação' : 'Desligado';
  $('#gatewayState').classList.toggle('online', connected);
  $('#gatewayState').classList.toggle('error', data.state === 'error' && !reconnecting);
  $('#gatewayState').classList.toggle('reconnecting', reconnecting);
  $('#gatewayMessage').textContent = data.message || 'A sessão de rádio não está ligada.';
  renderReceptionState();
  $('#badge').innerHTML = `<i></i> ${reconnecting ? 'A reconectar…' : connected ? 'Ligado' : 'Rádio pronto'}`;
  $('#badge').classList.toggle('online', connected);
  $('#badge').classList.toggle('reconnecting', reconnecting);
  $('#connect').textContent = connected || reconnecting || ['resolving','waiting-login','waiting-auth','waiting-config'].includes(data.state) ? 'Desligar' : 'Ligar ao master';
  $('#connect').disabled = disconnectInProgress;
  $('#ptt').disabled = !connected || !data.pttReady || disconnectInProgress;
  window.ZapDMROperation?.reflectTx();
  $('#audioState').textContent = data.voiceCodecAvailable ? 'Vocoder Android ARM: pronto.' : 'Vocoder Android ARM: indisponível neste build.';
}

function handleMobileRadioEvent(packet) {
  window.dispatchEvent(new CustomEvent('zapdmr:radio-event',{detail:packet}));
  const data = packet?.data || {};
  if(packet?.event==='link')toast(data.message||'Destino selecionado.');
  if(packet?.event==='audioFocus'){document.getElementById('audioState').textContent=data.message;}
  if (packet?.event === 'firmwareDownload') $('#mobileFirmwareHint').textContent = `A baixar ${data.file}: ${data.percent}%`;
  if (packet?.event === 'tot') updateTotStatus(data);
  if (packet?.event === 'status') displayMobileStatus(data);
  if (packet?.event === 'vocoder') {
    mobileFirmwareReady = Boolean(data.ready);
    $('#mobileFirmwareHint').textContent = data.message || (mobileFirmwareReady ? 'Firmware pronto.' : 'Vocoder ainda não pronto.');
  }
  if (packet?.event === 'activity') {
    const key = String(data.talkgroupId);
    if(isXlx()&&data.global)return;
    if (!isXlx()&&!groups.some((group) => group.id === Number(data.talkgroupId))) return;
    const previous = talkgroupActivity[key] || {};
    talkgroupActivity[key] = { ...previous, ...data, active: data.global ? Boolean(data.active) : Boolean(previous.active) };
    refreshCatalogActivity();
    const source = data.sourceId ? String(data.sourceId) : '';
    if (source && Number(data.talkgroupId) === Number(settings.selectedTalkgroupId)) {
      const participantKey = `mobile:${source}`;
      participants = [{ key: participantKey, at: Number(data.lastActivityAt) || Date.now(), talkgroupId: Number(data.talkgroupId),
        callsign: data.lastCallerCallsign || `DMR ${source}`, name: data.lastCallerName || 'Estação recebida', sourceId: source, location: data.location || '—', country: data.country || '' }, ...participants.filter((item) => item.key !== participantKey)].slice(0, 30);
      renderParticipants();
    }
  }
  if (packet?.event === 'lastHeard') {
    const connected = data.state === 'connected';
    $('#lastHeardState').textContent = data.message || 'Monitor global a ligar…';
    $('#catalogActivitySource').textContent = connected ? 'Atividade global BrandMeister · janela de 60 s' : 'Monitor global a reconectar · os estados podem estar desatualizados.';
  }
  if (packet?.event === 'rxBusy') { gatewayStatus.rxBusy=Boolean(data.busy);window.ZapDMROperation?.reflectTx(); return; }
  if (packet?.event === 'ptt') {
    mobilePttActive = Boolean(data.active);
    mobilePttPending = false;
    gatewayStatus.pttArmed = mobilePttActive;
    window.ZapDMROperation?.reflectTx();
  }
  if (packet?.event === 'audioLevel') {
    const direction = data.direction === 'TX' || data.direction === 'RX' ? data.direction : null;
    if (direction) {
      renderAudioMeter(data);
      clearTimeout(audioMeterResetTimers[direction]);
      audioMeterResetTimers[direction] = setTimeout(() => renderAudioMeter({ direction, level: 0 }), 450);
    }
  }
  if (packet?.event === 'error') toast(data.message || 'Erro na sessão de rádio Android.');
}

async function stopMobilePtt() {
  const shouldStop = mobilePttActive || mobilePttPending;
  mobilePttHolding = false;
  mobilePttPending = false;
  if (shouldStop) await mobileAudio?.stopPtt?.().catch((error) => toast(error.message || 'Falha ao libertar PTT.'));
}

async function handleMobilePttDown(event) {
  if (!mobileAudio?.isAndroid?.()) return;
  event.preventDefault();
  if (event.button !== undefined && event.button !== 0) return;
  if (mobilePttHolding || !gatewayStatus.connected || !gatewayStatus.pttReady) return;
  stopTalkgroupScan();
  mobilePttHolding = true;
  mobilePttPending = true;
  const group = groupSelected();
  try {
    await mobileAudio.startPtt(group?.id, group?.slot || settings.defaultSlot || 1);
    if (!mobilePttHolding) await mobileAudio.stopPtt();
    else { mobilePttPending = false; mobilePttActive = true; $('#ptt').textContent = '■ Transmitindo…'; }
  } catch (error) {
    mobilePttHolding = false; mobilePttPending = false;
    toast(error.message || 'Não foi possível iniciar o PTT Android.');
  }
}

async function init() {
  try { settings = { ...defaults, ...window.ZapDMRProtocol.normalize(JSON.parse(localStorage.getItem('zapdmr-settings') || '{}')) }; } catch {}
  settings.favorites = Array.isArray(settings.favorites) ? settings.favorites.map(Number) : [724];
  try { groups = window.ZapDMRCatalog.merge(window.ZapDMRCatalog.bundled, JSON.parse(localStorage.getItem('zapdmr-custom-talkgroups') || '[]')); } catch { groups = window.ZapDMRCatalog.bundled; }
  applySettingsToForm(settings); renderCategories(); renderGroups();
  if (matchMedia('(max-width:760px)').matches) $('.connection-layout').classList.add('catalog-expanded');
  const androidAudioAvailable = Boolean(mobileAudio?.isAndroid?.());
  $('#mobileFirmwareSettings').hidden = !androidAudioAvailable;
  if (androidAudioAvailable) {
    $('#aboutArchitecture').textContent = 'Android 1.4.7 · serviço ODTP/HBP e áudio locais, com vocoder ARM64/ARMv7. Firmware incluído, instalado automaticamente ao abrir o aplicativo.';
    try {
      await Promise.race([mobileAudio.initialize(handleMobileRadioEvent), new Promise((_, reject) => setTimeout(() => reject(new Error('O rádio ainda está a iniciar; o catálogo está disponível.')), 8000))]);
      mobileSecureConfig = await Promise.race([mobileAudio.loadRadioConfig(), new Promise((resolve) => setTimeout(() => resolve({}), 5000))]);
      passwordConfigured = Boolean(mobileSecureConfig.hotspotPassword);
      const firmware = await mobileAudio.firmwareStatus();
      mobileFirmwareReady = Boolean(firmware.ready);
      $('#mobileFirmwareHint').textContent = mobileFirmwareReady
        ? `Firmware guardado na pasta privada do app (D002.032.bin ${firmware.applicationBytes} B; core ${firmware.coreBytes} B).`
        : 'Toque em Ativar / Reparar vocoder para restaurar os ficheiros incluídos no APK.';
    } catch (error) {
      $('#mobileFirmwareHint').textContent = error.message || 'O serviço de rádio Android não iniciou.';
    }
  }
  for (const axis of ['tx', 'rx']) {
    const audioSegments = $(`#${axis}AudioMeterSegments`);
    for (let index = 0; index < 16; index += 1) {
      const segment = document.createElement('i');
      segment.className = 'audio-led';
      audioSegments.append(segment);
    }
  }
  renderAudioMeter();
  try { settings = { ...defaults, ...JSON.parse(localStorage.getItem('zapdmr-settings') || '{}') }; } catch { /* Use defaults. */ }
  if (androidAudioAvailable && mobileSecureConfig.settings) settings = { ...settings, ...window.ZapDMRProtocol.normalize(mobileSecureConfig.settings) };
  if(androidAudioAvailable&&!localStorage.getItem('zapdmr-android-essid-separated')){
    if(!isXlx()&&(!settings.essid||['01','02'].includes(settings.essid)))settings.essid='03';
    await mobileAudio.saveRadioConfig({settings,customTalkgroups:mobileSecureConfig.customTalkgroups||[],hotspotPassword:mobileSecureConfig.hotspotPassword||''});
    localStorage.setItem('zapdmr-android-essid-separated','1');
  }
  settings.favorites = Array.isArray(settings.favorites) ? settings.favorites.map(Number) : [724];
  if (androidAudioAvailable) groups = window.ZapDMRCatalog.merge(groups, mobileSecureConfig.customTalkgroups || []);
  const [talkgroupResponse, settingsResponse, statusResponse, profilesResponse] = await Promise.all([
    ...(androidAudioAvailable ? Array(4).fill(Promise.resolve({ available: false, ok: false, data: {} })) : [callApi('/api/talkgroups'), callApi('/api/settings'), callApi('/api/status'), callApi('/api/profiles')])
  ]);
  apiAvailable = settingsResponse.available;
  if (talkgroupResponse.ok) groups = window.ZapDMRCatalog.merge(window.ZapDMRCatalog.bundled, talkgroupResponse.data);
  try { localStorage.setItem('zapdmr-custom-talkgroups', JSON.stringify(groups.filter((group) => group.custom))); } catch {}
  $('#dmrFirmwareUrl').value = localStorage.getItem('zapdmr-firmware-application-url') || '';
  $('#coreFirmwareUrl').value = localStorage.getItem('zapdmr-firmware-core-url') || '';
  if (androidAudioAvailable) applySettingsToForm(settings);
  else if (settingsResponse.ok) applySettingsToForm(settingsResponse.data);
  if(androidAudioAvailable){const list=await profileApi('list');if(list.ok){profiles=list.data.profiles;activeProfileId=list.data.activeProfileId;renderProfiles();}}
  if (profilesResponse.ok) {
    profiles = profilesResponse.data.profiles || [];
    activeProfileId = profilesResponse.data.activeProfileId || activeProfileId;
    renderProfiles();
  }
  if (!settingsResponse.ok && !androidAudioAvailable) applySettingsToForm(settings);
  if (!isXlx()&&!groups.some((group) => group.id === Number(settings.selectedTalkgroupId))) settings.selectedTalkgroupId = 724;
  updateDmrDatabaseInfo(statusResponse.data?.dmrIdDatabase);
  updatePasswordHint();
  renderCategories();
  renderGroups();
  if (androidAudioAvailable) await mobileAudio.watchTalkgroups?.(groups.map((group) => group.id)).catch((error) => console.warn('Last Heard watch list:', error));
  if (statusResponse.ok) {
    showStatus(statusResponse.data);
    renderAudioMeter(statusResponse.data.audioLevel);
  }
  else {
    $('#serverState').textContent = 'Interface';
    $('#udpState').textContent = 'Offline';
    $('#badge').innerHTML = '<i></i> Consulta local';
  }
  if (androidAudioAvailable) {
    await window.ZapDMRCommunity?.initialize();
    displayMobileStatus();
    await reconnectMobileAfterOpen();
  }
  connectWebSocket();
  setInterval(refreshCatalogActivity, 1000);
  setInterval(() => updateTotStatus(totStatus), 1000);
  window.ZapDMRReady=true;window.dispatchEvent(new Event('zapdmr:ready'));
}

async function reconnectMobileAfterOpen(){
  const resume=Boolean((await mobileAudio.takeQuickExitResume()).resume);
  if(!resume&&!settings.autoConnectOnStartup)return;
  const missing=[];
  if(!settings.callsign)missing.push('indicativo');if(!settings.dmrId)missing.push('Radio ID');
  if(!settings.essid&&settings.xlxModule!=='C')missing.push('ESSID');if(!settings.masterHost)missing.push('master');
  if(!mobileSecureConfig.hotspotPassword)missing.push('Hotspot Security Password');
  if(!window.ZapDMRCommunity?.isComplete())missing.push('WhatsApp do perfil');
  if(missing.length){setActiveScreen('settings');setActiveSettingsPane('profile');toast('Para reconectar, complete: '+missing.join(', ')+'.');return;}
  try{await mobileAudio.connectRadio(settings,mobileSecureConfig.hotspotPassword,resume);}
  catch(error){toast(error.message||'Não foi possível ligar automaticamente ao master. Confira rede, perfil e permissões do Android.');}
}

async function importMobileFirmware(target, useNetwork = false) {
  if (!mobileAudio?.isAndroid?.()) return;
  const buttons = ['activateVocoder','importDmrFirmware','importCoreFirmware','downloadDmrFirmware','downloadCoreFirmware'].map((id) => $('#' + id));
  buttons.forEach((button) => { button.disabled = true; });
  try {
    if (gatewayStatus.connected || mobilePttActive) throw new Error('Desligue o master antes de atualizar o firmware.');
    let result;
    if (useNetwork) {
      const url = (target === 'application' ? $('#dmrFirmwareUrl') : $('#coreFirmwareUrl')).value.trim();
      if (!url) throw new Error('Informe o link HTTPS direto deste firmware nas Definições.');
      if (new URL(url).protocol !== 'https:') throw new Error('O download exige um link HTTPS.');
      localStorage.setItem(`zapdmr-firmware-${target}-url`, url);
      $('#mobileFirmwareHint').textContent = 'A descarregar e verificar o firmware…';
      result = await mobileAudio.downloadFirmware(target, url);
    } else {
      $('#mobileFirmwareHint').textContent = 'A ativar e verificar os ficheiros incluídos no APK…';
      result = await mobileAudio.activateFirmware(target);
    }
    mobileFirmwareReady = Boolean(result.ready);
    $('#mobileFirmwareHint').textContent = mobileFirmwareReady
      ? `Vocoder pronto. Ficheiros verificados e instalados na pasta privada do app. Ligue ao master para iniciar o áudio.`
      : `Ficheiro ${result.file} descarregado. Baixe o outro firmware para habilitar o áudio.`;
    toast(useNetwork ? 'Download verificado e instalado.' : 'Vocoder ativado sem internet.');
  } catch (error) {
    $('#mobileFirmwareHint').textContent = error.message || 'Não foi possível descarregar o firmware.';
    toast($('#mobileFirmwareHint').textContent);
  } finally { buttons.forEach((button) => { button.disabled = false; }); }
}

$('#search').oninput = renderGroups;
$('#category').onchange = (event) => { categoryValue = event.target.value; renderCategories(); renderGroups(); };
document.querySelectorAll('[data-activity-filter]').forEach((button) => {
  button.onclick = () => {
    activityFilter = button.dataset.activityFilter;
    if (activityFilter !== 'active') stopTalkgroupScan();
    renderGroups();
  };
});
$('#scanTalkgroups').onclick = async () => {
  if (scanEnabled) return stopTalkgroupScan();
  privateContact=null;renderSelected();
  scanEnabled = true; scanSelectedSince = 0; activityFilter = 'all';
  $('#scanTalkgroups').textContent = '■ Scan';
  $('#scanTalkgroups').setAttribute('aria-pressed', 'true');
  renderGroups();
  try{await tuneSelectedTalkgroup(settings.selectedTalkgroupId);if(scanEnabled)void scanTalkgroupsTick();}
  catch(error){stopTalkgroupScan();toast(error.message);}
};
$('#toggleConnectionDetails').onclick = () => {
  const expanded = !$('.connection-layout').classList.toggle('catalog-expanded');
  $('#toggleConnectionDetails').setAttribute('aria-expanded', String(expanded));
  $('#toggleConnectionDetails').textContent = expanded ? 'Ocultar ligação e favoritos ▴' : 'Ligação e favoritos ▾';
};
$('#expandCatalog').onclick = () => {
  const expanded = $('.connection-layout').classList.toggle('catalog-expanded');
  $('#expandCatalog').setAttribute('aria-pressed', String(expanded));
  $('#expandCatalog').setAttribute('aria-label', expanded ? 'Mostrar ligação e favoritos' : 'Ampliar catálogo');
  $('#expandCatalog').textContent = expanded ? '↙' : '⛶';
};
$('#theme').onchange = async (event) => { setTheme(event.target.value); await persist(); };
$('#favoriteSelected').onclick = () => { const group = groupSelected(); if (group) toggleFavorite(group.id); };
document.querySelectorAll('.bottom-nav-button[data-screen]').forEach((button) => {
  button.onclick = () => setActiveScreen(button.dataset.screen);
});
document.querySelectorAll('.settings-tab[data-settings-tab]').forEach((button) => {
  button.onclick = () => setActiveSettingsPane(button.dataset.settingsTab);
});
$('#activateVocoder').onclick = () => void importMobileFirmware('all');
$('#downloadDmrFirmware').onclick = () => void importMobileFirmware('application', true);
$('#downloadCoreFirmware').onclick = () => void importMobileFirmware('core', true);
$('#importDmrFirmware').onclick = () => void importMobileFirmware('application');
$('#importCoreFirmware').onclick = () => void importMobileFirmware('core');
$('#quickTalkgroupSelect').onclick = openQuickTalkgroupPicker;
$('#quickTalkgroupClose').onclick = () => $('#quickTalkgroupDialog').close();
$('#quickTalkgroupSearch').oninput = renderQuickTalkgroupPicker;
$('#quickTalkgroupDialog').addEventListener('close', () => { quickPickerSnapshot=[]; });
document.querySelectorAll('[data-picker-filter]').forEach(button => {
  button.onclick = () => { quickPickerScope=button.dataset.pickerFilter; renderQuickTalkgroupPicker(); };
});
document.querySelectorAll('[data-quick-catalog-filter]').forEach(button => {
  button.onclick = () => {
    quickCatalogScope = button.dataset.quickCatalogFilter;
    renderQuickTalkgroups();
    updateQuickTalkgroupIndicators();
  };
});
$('#serverType').onchange = (event) => {
  const other = event.target.value === 'other';
  $('#otherServerFields').hidden = !other;
  $('#bmMasterPickerLabel').hidden = other;
  if (!other && !$('#masterPort').value) $('#masterPort').value = $('#radioProtocol').value==='odtp'?'54006':'62031';
  if (!other && !$('#master').value.trim()) $('#master').value='7242.master.brandmeister.network';
};
$('#bmMasterSelect').onchange = (event) => {
  if (event.target.value) $('#master').value = event.target.value;
};
$('#profileSelect').onchange = async (event) => {
  const id = event.target.value;
  if (!id || id === activeProfileId) return;
  const result = await profileApi('activate',{id});
  if (!result.ok) { renderProfiles(); return toast(result.data.error || 'Não foi possível trocar de perfil.'); }
  profiles = result.data.profiles || profiles;
  activeProfileId = result.data.activeProfileId;
  applySettingsToForm(result.data.settings);
  renderProfiles();
  renderGroups();
  $('#password').value='';
  if(passwordConfigured)$('#connect').click();
  else toast('Perfil carregado. Informe e guarde a senha deste servidor.');
};
$('#addProfile').onclick = () => {
  if (!apiAvailable&&!mobileAudio?.isAndroid?.()) return toast('Inicie o servidor ZapDMR para guardar vários perfis.');
  $('#newProfileName').value = '';$('#newProfileKind').value='copy';
  $('#profileDialog').showModal();
  $('#newProfileName').focus();
};
$('#cancelProfile').onclick = () => $('#profileDialog').close();
$('#profileForm').onsubmit = async (event) => {
  event.preventDefault();
  const name = $('#newProfileName').value.trim();
  const base={...readSettingsFromForm()};
  const preset=$('#newProfileKind').value==='xlx026';
  const payload = { name, settings: preset?{...base,serverType:'other',radioProtocol:'hbp',xlxModule:'C',userUrl:'C',hbpOptions:'',masterHost:'xlx026.net',masterPort:62030,essid:'',defaultSlot:2,staticTalkgroups:'',selectedTalkgroupId:4003,favorites:[4003]}:{...base}, hotspotPassword: '' };
  const result = await profileApi('create',payload);
  if (!result.ok) return toast(result.data.error || 'Não foi possível criar o perfil.');
  profiles = result.data.profiles || [];
  activeProfileId = result.data.activeProfileId;
  applySettingsToForm(result.data.settings);
  $('#password').value = '';
  renderProfiles();
  $('#profileDialog').close();
  renderGroups();
  toast(`Perfil ${name} criado e selecionado.`);
};
$('#deleteProfile').onclick = async () => {
  if (profiles.length <= 1) return toast('Mantenha pelo menos um perfil no ZapDMR.');
  const selected = profiles.find((profile) => profile.id === activeProfileId);
  if (!selected || !window.confirm(`Eliminar o perfil “${selected.name}” deste dispositivo?`)) return;
  const result = await profileApi('delete',{id:activeProfileId});
  if (!result.ok) return toast(result.data.error || 'Não foi possível eliminar o perfil.');
  profiles = result.data.profiles || [];
  activeProfileId = result.data.activeProfileId;
  const loaded = mobileAudio?.isAndroid?.()?{ok:true,data:result.data.settings}:await callApi('/api/settings');
  if (loaded.ok) applySettingsToForm(loaded.data);
  renderProfiles();
  renderGroups();
  toast('Perfil eliminado.');
};
$('#addTalkgroup').onclick = () => {
  if (!apiAvailable && !mobileAudio?.isAndroid?.()) return toast('Inicie o servidor ZapDMR para guardar TGs personalizadas neste dispositivo.');
  $('#talkgroupDialog').showModal();
  $('#newTalkgroupId').focus();
};
$('#cancelTalkgroup').onclick = () => $('#talkgroupDialog').close();
$('#talkgroupForm').onsubmit = async (event) => {
  event.preventDefault();
  const rawId = $('#newTalkgroupId').value.trim();
  if (!/^\d{1,8}$/.test(rawId)) return toast('O número da TG deve conter apenas algarismos.');
  const id = Number(rawId);
  if (id < 1 || id > 0xffffff) return toast('O número deve estar entre 1 e 16777215.');
  if (groups.some((group) => group.id === id)) return toast(`A TG ${id} já existe no catálogo.`);
  const saveButton = $('#saveTalkgroup');
  saveButton.disabled = true;
  const value = { id, name: $('#newTalkgroupName').value.trim(), slot: Number($('#newTalkgroupSlot').value), category: $('#newTalkgroupCategory').value, custom: true };
  if (mobileAudio?.isAndroid?.()) {
    groups = window.ZapDMRCatalog.merge(groups, [value]);
    localStorage.setItem('zapdmr-custom-talkgroups', JSON.stringify(groups.filter((group) => group.custom)));
    await persist(); await mobileAudio.watchTalkgroups(groups.map((group) => group.id));
    saveButton.disabled = false; $('#talkgroupForm').reset(); $('#talkgroupDialog').close(); renderCategories(); renderGroups(); return toast(`TG ${id} guardada no Android.`);
  }
  const result = await callApi('/api/talkgroups', { method: 'POST', body: JSON.stringify({
    id, name: $('#newTalkgroupName').value.trim(), slot: Number($('#newTalkgroupSlot').value),
    category: $('#newTalkgroupCategory').value
  }) });
  saveButton.disabled = false;
  if (!result.ok) return toast(result.data.error || 'Não foi possível cadastrar a TG.');
  groups = result.data;
  $('#talkgroupForm').reset();
  $('#talkgroupDialog').close();
  renderCategories();
  renderGroups();
  toast(`TG ${id} cadastrada e guardada neste dispositivo.`);
};

async function saveAutomationPreference(field, checkbox) {
  const previous = Boolean(settings[field]);
  const enabled = checkbox.checked;
  const password = $('#password').value;
  if (field === 'autoConnectOnStartup' && enabled && !passwordConfigured && !password) {
    checkbox.checked = previous;
    return toast('Digite e guarde a Hotspot Security Password antes de ativar a ligação automática.');
  }
  settings[field] = enabled;
  try {
    await persist(password);
    if (password) $('#password').value = '';
    updatePasswordHint();
    toast(enabled ? 'Opção automática ativada e guardada.' : 'Opção automática desativada e guardada.');
  } catch (error) {
    settings[field] = previous;
    checkbox.checked = previous;
    saveLocal();
    toast(error.message || 'Não foi possível guardar a opção automática.');
  }
}
$('#autoConnectOnStartup').onchange = (event) => saveAutomationPreference('autoConnectOnStartup', event.target);
$('#autoReconnect').onchange = (event) => saveAutomationPreference('autoReconnect', event.target);

$('#txGainPercent').oninput = (event) => { $('#txGainValue').textContent = `${event.target.value}%`; };
$('#rxVolumePercent').oninput = (event) => { $('#rxVolumeValue').textContent = `${event.target.value}%`; };

$('#updateDmrDatabase').onclick = () => {
  if (!apiAvailable) return toast('Inicie o servidor ZapDMR para atualizar a base local.');
  $('#dmrDatabaseFile').click();
};
$('#dmrDatabaseFile').onchange = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) return toast('O CSV deve ter até 25 MB.');
  try {
    const result = await callApi('/api/dmr-id-database/import', {
      method: 'POST', body: JSON.stringify({ csv: await file.text() })
    });
    if (!result.ok) return toast(result.data.error || 'Não foi possível importar o CSV.');
    updateDmrDatabaseInfo(result.data);
    toast(`Base DMR ID atualizada com ${result.data.records} registos.`);
  } catch (error) { toast(error.message || 'Não foi possível ler o ficheiro CSV.'); }
};
$('#deleteDmrDatabase').onclick = async () => {
  if (!apiAvailable || !Number(dmrIdDatabase.records)) return;
  if (!window.confirm('Eliminar a base DMR ID local deste dispositivo?')) return;
  const result = await callApi('/api/dmr-id-database', { method: 'DELETE' });
  if (!result.ok) return toast(result.data.error || 'Não foi possível eliminar a base local.');
  updateDmrDatabaseInfo(result.data);
  toast('Base DMR ID local eliminada.');
};

$('#exportBackup').onclick = async () => {
  if (!apiAvailable) return toast('Inicie o servidor ZapDMR para exportar o backup.');
  try {
    const response = await fetch('/api/backup');
    if (!response.ok) throw new Error('O servidor não conseguiu preparar o backup.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = `ZapDMR-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click(); URL.revokeObjectURL(url);
    toast('Backup ZapDMR exportado.');
  } catch (error) { toast(error.message || 'Não foi possível exportar o backup.'); }
};
$('#importBackupButton').onclick = () => {
  if (!apiAvailable) return toast('Inicie o servidor ZapDMR para restaurar um backup.');
  $('#backupFile').click();
};
$('#backupFile').onchange = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) return toast('O backup deve ter até 30 MB.');
  try {
    const backup = JSON.parse(await file.text());
    const result = await callApi('/api/backup', { method: 'POST', body: JSON.stringify(backup) });
    if (!result.ok) return toast(result.data.error || 'Não foi possível restaurar o backup.');
    toast('Backup restaurado. A interface será atualizada.');
    setTimeout(() => location.reload(), 500);
  } catch (error) { toast(error.message || 'Arquivo de backup inválido.'); }
};

$('#audioTest').onclick = async () => {
  const button = $('#audioTest');
  button.disabled = true;
  $('#audioTestResult').textContent = 'A testar o caminho de áudio e vocoder…';
  const result = await callApi('/api/audio-test', { method: 'POST', body: '{}' });
  button.disabled = false;
  $('#audioTestResult').textContent = result.data.message || 'O teste de áudio falhou.';
  if (result.ok) toast('Teste de áudio/vocoder enviado.');
};

$('#disconnectTalkgroup').onchange = async (event) => {
  const checkbox = event.target;
  if (!checkbox.checked) return;
  if (disconnectInProgress) return;
  disconnectInProgress = true;
  updateDisconnectControl();
  try {
    if(mobileAudio?.isAndroid?.()){await mobileAudio.unlinkTalkgroup();toast(settings.radioProtocol==='odtp'?'Cancelamento de inscrição ODTP solicitado.':'Comando TG 4000 solicitado.');return;}
    const result = await callApi('/api/disconnect-talkgroup', { method: 'POST', body: '{}' });
    if (result.data?.message) toast(result.data.message);
    else if (!result.ok) toast('Não foi possível enviar o comando TG 4000.');
  } finally {
    disconnectInProgress = false;
    checkbox.checked = false;
    const status = await callApi('/api/status');
    if (status.ok) showStatus(status.data);
    updateDisconnectControl();
  }
};

$('#settingsForm').onsubmit = async (event) => {
  event.preventDefault();
  readSettingsFromForm();
  const rxFrequencyHz = $('#rxFrequencyHz').value.trim();
  const txFrequencyHz = $('#txFrequencyHz').value.trim();
  const password = $('#password').value;
  if (!/^\d{7}$/.test(settings.dmrId)) return toast('O Radio ID base deve ter 7 algarismos.');
  if (!(isXlx()?/^(?:\d{2})?$/.test(settings.essid):/^\d{2}$/.test(settings.essid))) return toast('O ESSID deve ter dois algarismos, de 00 a 99.');
  if ((rxFrequencyHz && rxFrequencyHz !== '000000000' && !/^\d{9}$/.test(rxFrequencyHz)) ||
      (txFrequencyHz && txFrequencyHz !== '000000000' && !/^\d{9}$/.test(txFrequencyHz)))
    return toast('As frequências RX e TX devem conter nove algarismos em Hz.');
  if (!Number.isInteger(settings.masterPort) || settings.masterPort < 1 || settings.masterPort > 65535)
    return toast('A porta UDP deve ficar entre 1 e 65535.');
  if (settings.latitude && !Number.isFinite(Number(settings.latitude)) || settings.longitude && !Number.isFinite(Number(settings.longitude)))
    return toast('Informe latitude e longitude como números decimais.');
  if (!Number.isInteger(settings.totLimitSeconds) || settings.totLimitSeconds < 30 || settings.totLimitSeconds > 900)
    return toast('O TOT deve ficar entre 30 e 900 segundos.');
  if (!Number.isInteger(settings.totWarningSeconds) || settings.totWarningSeconds < 0 || settings.totWarningSeconds >= settings.totLimitSeconds)
    return toast('O aviso do TOT deve ser 0 ou menor que o limite configurado.');
  settings.rxFrequencyHz = normalizeFrequency(rxFrequencyHz);
  settings.txFrequencyHz = normalizeFrequency(txFrequencyHz);
  $('#rxFrequencyHz').value = settings.rxFrequencyHz;
  $('#txFrequencyHz').value = settings.txFrequencyHz;
  try {
    await persist(password);
    $('#password').value = '';
    updatePasswordHint();
    toast(mobileAudio?.isAndroid?.()
      ? 'Perfil guardado com proteção Android. Protocolo '+settings.radioProtocol.toUpperCase()+'.'
      : apiAvailable ? 'Perfil guardado. Protocolo '+settings.radioProtocol.toUpperCase()+'.' : 'Perfil guardado neste dispositivo. Inicie o servidor para ligar à BrandMeister.');
    if(settings.autoConnectOnStartup&&passwordConfigured&&!gatewayStatus.connected&&!automationStatus.reconnecting&&!['resolving','waiting-login','waiting-auth','waiting-config','reconnecting'].includes(gatewayStatus.state)&&window.ZapDMRCommunity?.isComplete())await $('#connect').onclick();
  } catch (error) { toast(error.message || 'Não foi possível guardar a configuração.'); }
};

$('#connect').onclick = async () => {
  if (mobileAudio?.isAndroid?.()) {
    const connecting = ['resolving','waiting-login','waiting-auth','waiting-config','reconnecting'].includes(gatewayStatus.state);
    if (gatewayStatus.connected || connecting) {
      await mobileAudio.disconnectRadio();
      return;
    }
    const password = $('#password').value || mobileSecureConfig.hotspotPassword || '';
    if (!password) return toast('Informe e guarde a Hotspot Security Password nas Definições.');
    try {
      if ($('#password').value) await persist($('#password').value);
      await mobileAudio.connectRadio(settings, password);
      $('#password').value = '';
    } catch (error) { toast(error.message || 'Não foi possível iniciar a sessão HBP nativa.'); }
    return;
  }
  if (!apiAvailable) return toast('Inicie o servidor ZapDMR para abrir a ligação HBP.');
  const disconnecting = gatewayStatus.connected || automationStatus.reconnecting ||
    ['resolving', 'waiting-login', 'waiting-auth', 'waiting-config'].includes(gatewayStatus.state);
  const result = await callApi(disconnecting ? '/api/disconnect' : '/api/connect', { method: 'POST', body: '{}' });
  if (result.data) toast(result.data.message || 'Pedido concluído.');
  if (!result.ok && !result.data.message) toast('Não foi possível comunicar com o servidor local.');
  const status = await callApi('/api/status');
  if (status.ok) showStatus(status.data);
};


init().catch((error) => { console.error(error); renderCategories(); renderGroups(); toast('Catálogo local disponível. ' + (error.message || 'Falha ao iniciar o rádio.')); });

function updateRadioProtocolForm(){
  const odtp=$('#radioProtocol').value==='odtp';$('#essid').disabled=odtp;
  $('#radioProtocolHint').textContent=odtp?'ODTP usa o Radio ID base e Hotspot Security Password. Porta habitual 54006; o master precisa oferecer este serviço. ESSID não é enviado. Mudanças de protocolo valem após desligar e voltar a ligar. Sem PTT automático e sem fallback silencioso para HBP.':'HBP usa Radio ID + ESSID, geralmente porta 62031. Não oferece inscrição automática sem transmissão; seleção e Scan filtram apenas o RX local.';
}
$('#radioProtocol').onchange=()=>{const odtp=$('#radioProtocol').value==='odtp',port=Number($('#masterPort').value);if(odtp&&[62030,62031].includes(port))$('#masterPort').value='54006';else if(!odtp&&port===54006)$('#masterPort').value='62031';updateRadioProtocolForm();};
function renderReceptionState(){
  const view=window.ZapDMRProtocol.reception(gatewayStatus,settings,privateContact?.id||settings.selectedTalkgroupId);
  const note=$('#pttScan small');if(note)note.textContent=(gatewayStatus.protocol||settings.radioProtocol)==='odtp'?'ODTP: inscrição no servidor sem áudio de ativação. Clique para iniciar ou parar Scan.':'HBP: seleção local, sem inscrição automática. Clique para iniciar ou parar Scan.';
  const target=$('#receptionState');if(target){target.textContent=view.text;target.dataset.state=view.state;}
  return view;
}
window.ZapDMRReception={render:renderReceptionState};

$('#newProfileKind').onchange=()=>{if($('#newProfileKind').value==='xlx026')$('#newProfileName').value='XLX026';};
$('#xlxMode').onchange=()=>{if($('#xlxMode').checked){$('#serverType').value='other';$('#radioProtocol').value='hbp';$('#defaultSlot').value='2';$('#userUrl').value='C';$('#master').value='xlx026.net';$('#masterPort').value='62030';}updateRadioProtocolForm();};
