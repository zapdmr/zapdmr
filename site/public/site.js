(() => {
  const form = document.querySelector('#downloadForm');
  const result = document.querySelector('#downloadResult');
  const button = document.querySelector('#registrationContinue');
  const fieldsPanel = document.querySelector('#registrationFields');
  const downloadLink = document.querySelector('#downloadLink');
  const availability = document.querySelector('#downloadAvailability');
  const communityAvailability = document.querySelector('#communityAvailability');
  const owner = document.querySelector('#siteOwner');
  const panel = document.querySelector('#verificationPanel');
  const codeInput = document.querySelector('#verificationCode');
  const verifyButton = document.querySelector('#verificationSubmit');
  const resendButton = document.querySelector('#verificationResend');
  const correctButton = document.querySelector('#verificationCorrect');
  const codeStatus = document.querySelector('#verificationStatus');
  const timerText = document.querySelector('#verificationTimer');
  const whatsappLink = document.querySelector('#verificationWhatsApp');
  const developmentNotice = document.querySelector('#verificationDevelopment');
  const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  // Pending challenges and the token exist only in this page's memory.
  // The portal does not persist login in cookies, localStorage, URLs or form fields.
  let pending = null, sessionToken = '', service = null, pollTimer = null;
  const activationPanel=document.createElement('section');activationPanel.hidden=true;activationPanel.className='activation-panel';
  const activationHeading=document.createElement('h3');activationHeading.textContent='Compatibilidade com o ZapDMR 1.5.6';
  const activationHint=document.createElement('p');activationHint.textContent='Somente enquanto o instalador 1.5.6 continuar publicado: após instalar, abra Ativar cadastro no ZapDMR e cole este código temporário. A próxima versão fará a ativação diretamente pelos seis dígitos do e-mail.';
  const activationButton=document.createElement('button');activationButton.type='button';activationButton.className='button primary';activationButton.textContent='Gerar código de ativação';
  const activationValue=document.createElement('input');activationValue.readOnly=true;activationValue.autocomplete='off';activationValue.setAttribute('aria-label','Código temporário de ativação');activationValue.hidden=true;
  const activationCopy=document.createElement('button');activationCopy.type='button';activationCopy.className='button secondary';activationCopy.textContent='Copiar código';activationCopy.hidden=true;
  const activationStatus=document.createElement('p');activationStatus.setAttribute('role','status');let activationExpiry=0,activationTimer;
  activationPanel.append(activationHeading,activationHint,activationButton,activationValue,activationCopy,activationStatus);downloadLink.after(activationPanel);
  function clearActivation(){clearInterval(activationTimer);activationValue.value='';activationValue.hidden=true;activationCopy.hidden=true;activationExpiry=0;}
  activationCopy.onclick=async()=>{if(Date.now()>=activationExpiry){clearActivation();return;}try{await navigator.clipboard.writeText(activationValue.value);activationStatus.textContent='Código copiado. Cole somente no aplicativo ZapDMR oficial.';}catch{activationValue.focus();activationValue.select();activationStatus.textContent='Selecione e copie o código.';}};
  activationButton.onclick=async()=>{if(!sessionToken)return;activationButton.disabled=true;clearActivation();try{const data=await requestJson('/v1/onboarding/activation',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessionToken},body:'{}'});if(!/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(data.activationCode))throw Error('Código de ativação inválido.');activationValue.value=data.activationCode;activationValue.hidden=false;activationCopy.hidden=false;activationExpiry=Date.now()+Math.min(600,Math.max(0,Number(data.expiresInSeconds)||0))*1000;const tick=()=>{const sec=Math.max(0,Math.ceil((activationExpiry-Date.now())/1000));activationStatus.textContent=sec?'Válido por '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')+' · uso único.':'Código expirado. Gere outro.';if(!sec)clearActivation();};tick();activationTimer=setInterval(tick,1000);}catch(e){activationStatus.textContent=e.message||'Não foi possível gerar o código.';}finally{activationButton.disabled=false;}};


  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      let response;
      try { response = await fetch(path, {...options, cache: 'no-store', signal: controller.signal}); }
      catch { throw new Error('Não foi possível comunicar com o servidor. Verifique a ligação e tente novamente.'); }
      let data;
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        try { data = await response.json(); } catch { /* A proxy page is not an API response. */ }
      }
      if (!response.ok) {
        const fallback = response.status === 429 ? 'Muitas tentativas. Aguarde antes de tentar novamente.' : 'O serviço está temporariamente indisponível. Tente novamente mais tarde.';
        const error = new Error(typeof data?.message === 'string' && data.message.length <= 400 ? data.message : fallback);
        error.status = response.status;
        error.retryAfterSeconds = Number(data?.retryAfterSeconds || response.headers.get('Retry-After')) || 0;
        throw error;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('O servidor não respondeu como esperado. Tente novamente mais tarde.');
      return data;
    } finally { clearTimeout(timeout); }
  }
  const post = (path, body) => requestJson(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const seconds = (value, fallback, max = 600) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Number(value))) : fallback;
  const remaining = value => Math.max(0, Math.ceil((value - Date.now()) / 1000));
  const maskedEmail = value => { const [name, domain] = String(value).split('@'); return name.slice(0, 2) + '•••@' + domain; };

  function report(message, error = false) {
    if (!codeStatus) return;
    codeStatus.classList.toggle('error', error);
    codeStatus.setAttribute('role', error ? 'alert' : 'status');
    codeStatus.setAttribute('aria-live', error ? 'assertive' : 'polite');
    if (codeStatus.textContent !== message) codeStatus.textContent = message;
  }
  function hideDownload() {
    downloadLink.hidden = true;
    downloadLink.removeAttribute('href');
  }
  function whatsappUrl(value) {
    if (typeof value !== 'string') return null;
    let url; try { url = new URL(value); } catch { return null; }
    if (url.origin !== 'https://wa.me' || url.username || url.password || url.hash || !/^\/[1-9]\d{7,14}$/.test(url.pathname) || [...url.searchParams.keys()].some(key => key !== 'text')) return null;
    return url.href;
  }
  function refreshControls() {
    if (!pending) return;
    const retry = remaining(pending.retryAt), expires = remaining(pending.expiresAt);
    verifyButton.disabled = pending.busy || !pending.registrationId || pending.mode === 'unavailable' || !expires || pending.complete;
    codeInput.disabled = verifyButton.disabled;
    resendButton.disabled = pending.busy || !pending.registrationId || retry > 0 || pending.complete;
    resendButton.textContent = retry > 0 ? 'Reenviar código em ' + retry + 's' : 'Reenviar código';
    correctButton.disabled = false;
    timerText.textContent = pending.complete ? 'E-mail confirmado nesta sessão.'
      : pending.registrationId && pending.mode !== 'unavailable'
        ? (expires ? 'Código válido por ' + Math.floor(expires / 60) + ':' + String(expires % 60).padStart(2, '0') + '.' : 'Código expirado. Solicite outro ou corrija o e-mail.') : '';
    if (!expires && pending.mode !== 'unavailable' && !pending.complete) {
      clearTimeout(pollTimer);
      whatsappLink.hidden = true;
      whatsappLink.removeAttribute('href');
    }
  }
  function busy(value, flow = pending) {
    if (flow !== pending || !flow) return;
    flow.busy = value;
    panel.setAttribute('aria-busy', String(value));
    refreshControls();
  }
  function begin(email, platform) {
    clearTimeout(pollTimer);
    sessionToken = '';
    pending = {email, platform, registrationId: '', mode: 'unavailable', challengeToken: '', displayCode: '', retryAt: Date.now() + 60000, expiresAt: 0, busy: true, complete: false};
    fieldsPanel.hidden = true;
    panel.hidden = false;
    document.querySelector('#verificationPhone').textContent = maskedEmail(email);
    codeInput.value = '';
    codeInput.readOnly = false;
    codeInput.setCustomValidity('');
    whatsappLink.hidden = true;
    whatsappLink.removeAttribute('href');
    developmentNotice.hidden = true;
    hideDownload();
    result.textContent = '';
    document.querySelector('#verificationHeading').textContent = 'Confirme o seu e-mail';
    report('A enviar o código de seis dígitos para o seu e-mail…');
    busy(true);
    document.querySelector('#verificationHeading').focus();
    return pending;
  }
  function schedulePoll(flow, delay = 4000) {
    clearTimeout(pollTimer);
    if (flow !== pending || !['reverse', 'bridge'].includes(flow.mode) || flow.complete || !remaining(flow.expiresAt) || document.hidden) return;
    pollTimer = setTimeout(() => void checkReverse(flow), delay);
  }
  function applyChallenge(raw, flow, fromPoll = false) {
    if (flow !== pending) return;
    clearTimeout(pollTimer);
    const challenge = raw?.challenge || raw;
    if (!challenge || !['email', 'unavailable'].includes(challenge.mode)) throw new Error('O servidor não disponibilizou uma confirmação por e-mail válida. Pode reenviar ou corrigir o endereço.');
    if (challenge.mode === 'development' && !(localHost && service?.developmentMode === true)) throw new Error('A confirmação de desenvolvimento não está permitida neste endereço.');
    flow.mode = challenge.mode;
    flow.challengeToken = typeof challenge.challengeToken === 'string' ? challenge.challengeToken : '';
    flow.displayCode = '';
    flow.expiresAt = Date.now() + seconds(challenge.expiresInSeconds, 600) * 1000;
    flow.retryAt = Date.now() + Math.max(fromPoll ? 0 : 1, seconds(challenge.retryAfterSeconds, 60, 3600)) * 1000;
    codeInput.value = '';
    codeInput.readOnly = false;
    codeInput.setCustomValidity('');
    whatsappLink.hidden = true;
    whatsappLink.removeAttribute('href');
    developmentNotice.hidden = true;
    const fallback = flow.mode === 'unavailable' ? 'A confirmação por e-mail está indisponível. O cadastro foi preservado; tente novamente mais tarde.'
      : 'Código enviado. Digite os seis dígitos recebidos no seu e-mail.';
    const message = typeof challenge.message === 'string' && challenge.message.length <= 500 ? challenge.message : fallback;
    report(message, flow.mode === 'unavailable');
    refreshControls();
    if (flow.mode === 'email') codeInput.focus();
  }
  async function completeVerification(flow, code) {
    if (flow !== pending || flow.complete) return;
    busy(true, flow);
    try {
      const data = await post('/v1/email/verify', {registrationId: flow.registrationId, code, sessionProtocol: 2});
      if (flow !== pending) return;
      if (data.user?.verified !== true || data.user?.email_verified !== true || typeof data.token !== 'string' || !data.token) throw new Error('O servidor não confirmou o seu e-mail. O download permanece bloqueado.');
      sessionToken = data.token;
      activationPanel.hidden=false;clearActivation();
      flow.complete = true;
      flow.challengeToken = '';
      flow.displayCode = '';
      codeInput.value = '';
      developmentNotice.hidden = true;
      whatsappLink.hidden = true;
      whatsappLink.removeAttribute('href');
      clearTimeout(pollTimer);
      panel.dataset.state = 'confirmed';
      document.querySelector('#verificationHeading').textContent = 'E-mail confirmado';
      report('E-mail confirmado. O instalador está liberado para este cadastro.');
      result.classList.remove('error');
      result.setAttribute('role', 'status');
      if (data.downloadAvailable === true && typeof data.downloadUrl === 'string') {
        const url = new URL(data.downloadUrl, location.origin);
        if (url.origin !== location.origin || url.username || url.password || !url.pathname.startsWith('/download/') || url.hash) throw new Error('Número confirmado, mas o endereço do instalador não pôde ser validado. Tente novamente mais tarde.');
        downloadLink.href = url.href;
        downloadLink.textContent = 'Baixar ' + (flow.platform === 'windows' ? 'Windows (.exe)' : 'Android (.apk)');
        downloadLink.hidden = false;
        result.textContent = 'Download solicitado. Se não começar, use o botão abaixo.';
        downloadLink.focus();
        downloadLink.click();
      } else result.textContent = 'E-mail confirmado. O instalador desta plataforma ainda aguarda publicação.';
    } catch (error) {
      if (flow === pending) report(error.message || 'Não foi possível validar o código. Tente novamente.', true);
    } finally { busy(false, flow); }
  }
  async function checkReverse(flow, manual = false) {
    if (flow !== pending || !['reverse', 'bridge'].includes(flow.mode) || flow.complete || flow.polling || flow.busy) return;
    if (!remaining(flow.expiresAt)) { refreshControls(); return; }
    flow.polling = true;
    let delay = 4000;
    try {
      const data = await post('/v1/auth/status', {registrationId: flow.registrationId, challengeToken: flow.challengeToken});
      if (flow !== pending || flow.complete) return;
      if (flow.busy) return;
      if (data.challenge?.mode === 'unavailable') {
        applyChallenge(data.challenge, flow, true);
        return;
      }
      if (data.status === 'confirmed') {
        if (flow.mode === 'reverse') await completeVerification(flow, flow.displayCode);
        return;
      }
      if (data.status === 'expired') {
        flow.expiresAt = Date.now();
        report('Esta confirmação expirou. Solicite outro código ou corrija o WhatsApp.', true);
        refreshControls();
        return;
      }
      if (data.status !== 'pending') throw new Error('Não foi possível consultar a confirmação. O cadastro foi preservado.');
      if (data.challenge?.mode === 'reverse' && flow.mode === 'bridge') {
        applyChallenge(data.challenge, flow, true);
        return;
      }
      if (flow.mode === 'bridge' && data.challenge?.mode === 'bridge') {
        const message = typeof data.challenge.message === 'string' && data.challenge.message.length <= 500 ? data.challenge.message : '';
        report(message || (data.challenge.sent ? 'Encaminhado ao WhatsApp; aguardando entrega.' : 'Aguardando o envio pela ponte WhatsApp.'), data.challenge.deliveryStatus === 'failed');
      }
      // retryAfterSeconds controls code resends; confirmation polls have their own cadence.
      delay = 4000;
      if (manual) report('Ainda aguardamos a mensagem do seu número. Abra o WhatsApp, envie a mensagem preparada e aguarde a confirmação.');
    } catch (error) {
      if (flow === pending) report(error.message || 'A confirmação continua pendente. Tente novamente.', true);
      delay = Math.max(10000, seconds(error.retryAfterSeconds, 10, 60) * 1000);
    } finally {
      flow.polling = false;
      if (flow === pending) schedulePoll(flow, delay);
    }
  }
  async function verify() {
    const flow = pending;
    if (!flow || verifyButton.disabled) return;
    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      codeInput.setCustomValidity('Digite os seis dígitos do código.');
      codeInput.reportValidity();
      codeInput.focus();
      return;
    }
    codeInput.setCustomValidity('');
    await completeVerification(flow, code);
  }
  async function resend() {
    const flow = pending;
    if (!flow || resendButton.disabled) return;
    busy(true, flow);
    flow.retryAt = Date.now() + 60000;
    report('A solicitar outro código…');
    try { applyChallenge(await post('/v1/email/request-code', {registrationId: flow.registrationId}), flow); }
    catch (error) {
      if (flow === pending) {
        flow.retryAt = Date.now() + Math.max(1, seconds(error.retryAfterSeconds, 60, 3600)) * 1000;
        report((error.message || 'O código não foi reenviado.') + ' O cadastro foi preservado.', true);
      }
    } finally { busy(false, flow); if (flow === pending) schedulePoll(flow); }
  }
  function correct() {
    clearTimeout(pollTimer);
    pending = null;
    sessionToken = '';
    panel.hidden = true;
    panel.removeAttribute('data-state');
    fieldsPanel.hidden = false;
    form.removeAttribute('aria-busy');
    button.disabled = false;
    codeInput.disabled = true;
    codeInput.value = '';
    codeInput.setCustomValidity('');
    hideDownload();
    result.textContent = '';
    result.classList.remove('error');
    form.elements.email.focus();
  }
  async function status() {
    try {
      const data = await requestJson('/v1/status');
      if (typeof data.emailVerificationConfigured !== 'boolean' || !['android', 'windows'].every(key => typeof data.downloads?.[key]?.available === 'boolean')) throw new Error('Estado indisponível.');
      service = data;
      if (availability) availability.textContent = ['android', 'windows'].map(key => (key === 'android' ? 'Android' : 'Windows') + ': ' + (data.downloads[key].available ? 'instalador publicado · confirme o e-mail para baixar' : 'a aguardar publicação do instalador')).join(' · ');
      if (communityAvailability) {
        communityAvailability.dataset.state = data.emailVerificationConfigured ? 'configured' : 'unavailable';
        communityAvailability.textContent = data.emailVerificationConfigured ? 'Confirmação gratuita por e-mail disponível. O código tem seis dígitos, expira em 10 minutos e só pode ser usado uma vez.'
          : 'A confirmação por e-mail está temporariamente indisponível. Nenhum serviço pago será ativado automaticamente.';
      }
      if (owner && typeof data.owner === 'string' && data.owner.trim() && typeof data.privacyEmail === 'string' && data.privacyEmail.trim()) owner.textContent = data.owner + ' · Privacidade: ' + data.privacyEmail;
    } catch {
      if (availability) availability.textContent = 'Não foi possível consultar os instaladores. Tente novamente mais tarde.';
      if (communityAvailability) { communityAvailability.dataset.state = 'unavailable'; communityAvailability.textContent = 'Não foi possível consultar a confirmação por e-mail e o ZapChat. Tente novamente mais tarde.'; }
    }
  }
  if (form && result && button && fieldsPanel && downloadLink && panel && codeInput && verifyButton && resendButton && correctButton) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending) { await verify(); return; }
      const fields = new FormData(form), email = String(fields.get('email') || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        result.classList.add('error'); result.setAttribute('role', 'alert'); result.textContent = 'Informe um endereço de e-mail válido.'; form.elements.email.focus(); return;
      }
      button.disabled = true;
      const flow = begin(email, String(fields.get('platform')));
      panel.removeAttribute('data-state');
      try {
        const data = await post('/v1/email/registrations', {callsign: String(fields.get('callsign') || '').trim().toUpperCase(), dmrId: fields.get('dmrId'), email, platform: flow.platform, noticeAccepted: fields.get('noticeAccepted') === 'on', requestVerification: true});
        if (flow !== pending) return;
        if (typeof data.registrationId !== 'string' || !data.registrationId || data.verificationRequired !== true) throw new Error('O servidor não disponibilizou a confirmação do cadastro. O download permanece bloqueado.');
        flow.registrationId = data.registrationId;
        applyChallenge(data.challenge, flow);
      } catch (error) {
        if (flow === pending) report(error.message || 'Não foi possível iniciar a confirmação. Corrija o e-mail ou tente novamente mais tarde.', true);
      } finally { busy(false, flow); }
    });
    verifyButton.addEventListener('click', () => void verify());
    resendButton.addEventListener('click', () => void resend());
    correctButton.addEventListener('click', correct);
    codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); codeInput.setCustomValidity(''); });
    codeInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void verify(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(pollTimer); else if (pending && ['reverse', 'bridge'].includes(pending.mode)) schedulePoll(pending, 0); });
    setInterval(refreshControls, 1000);
    button.disabled = false;
  }
  void status();
})();
