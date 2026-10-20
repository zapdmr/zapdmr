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
  const maskedPhone = number => number.slice(0, Math.min(3, number.length - 4)) + ' ••• ••• ' + number.slice(-4);

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
    timerText.textContent = pending.complete ? 'Número confirmado nesta sessão.'
      : pending.registrationId && pending.mode !== 'unavailable'
        ? (expires ? 'Código válido por ' + Math.floor(expires / 60) + ':' + String(expires % 60).padStart(2, '0') + '.' : 'Código expirado. Solicite outro ou corrija o número.') : '';
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
  function begin(number, platform) {
    clearTimeout(pollTimer);
    sessionToken = '';
    pending = {number, platform, registrationId: '', mode: 'unavailable', challengeToken: '', displayCode: '', retryAt: Date.now() + 60000, expiresAt: 0, busy: true, complete: false};
    fieldsPanel.hidden = true;
    panel.hidden = false;
    document.querySelector('#verificationPhone').textContent = maskedPhone(number);
    codeInput.value = '';
    codeInput.readOnly = false;
    codeInput.setCustomValidity('');
    whatsappLink.hidden = true;
    whatsappLink.removeAttribute('href');
    developmentNotice.hidden = true;
    hideDownload();
    result.textContent = '';
    document.querySelector('#verificationHeading').textContent = 'Confirme o seu WhatsApp';
    report('A preparar a confirmação do seu WhatsApp…');
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
    if (!challenge || !['direct', 'bridge', 'reverse', 'development', 'unavailable'].includes(challenge.mode)) throw new Error('O servidor não disponibilizou uma confirmação válida. Pode reenviar ou corrigir o número.');
    if (challenge.mode === 'development' && !(localHost && service?.developmentMode === true)) throw new Error('A confirmação de desenvolvimento não está permitida neste endereço.');
    flow.mode = challenge.mode;
    flow.challengeToken = typeof challenge.challengeToken === 'string' ? challenge.challengeToken : '';
    flow.displayCode = ['reverse', 'development'].includes(flow.mode) && /^\d{6}$/.test(challenge.displayCode || '') ? challenge.displayCode : '';
    flow.expiresAt = Date.now() + seconds(challenge.expiresInSeconds, 600) * 1000;
    flow.retryAt = Date.now() + Math.max(fromPoll ? 0 : 60, seconds(challenge.retryAfterSeconds, 60, 3600)) * 1000;
    codeInput.value = flow.mode === 'reverse' ? flow.displayCode : '';
    codeInput.readOnly = flow.mode === 'reverse';
    codeInput.setCustomValidity('');
    const link = flow.mode === 'bridge' ? null : whatsappUrl(challenge.whatsappUrl);
    whatsappLink.hidden = !link;
    if (link) whatsappLink.href = link; else whatsappLink.removeAttribute('href');
    whatsappLink.textContent = flow.mode === 'reverse' ? 'Confirmar no WhatsApp ↗' : 'Receber código no WhatsApp ↗';
    developmentNotice.hidden = flow.mode !== 'development';
    developmentNotice.textContent = flow.mode === 'development' ? 'Desenvolvimento local: código ' + (flow.displayCode || 'não informado') + '. Não há envio real de WhatsApp neste modo.' : '';
    const fallback = flow.mode === 'unavailable' ? 'A confirmação está indisponível. O cadastro foi preservado; tente reenviar mais tarde ou corrija o número.'
      : flow.mode === 'reverse' ? 'Abra o WhatsApp e envie a mensagem preparada pelo servidor. A confirmação só acontece quando o serviço recebe a mensagem do seu número.'
        : flow.mode === 'bridge' && challenge.queued ? 'O envio do código está na fila do WhatsApp. Aguarde a mensagem no seu número e digite os seis dígitos recebidos.'
        : challenge.sent ? 'Código enviado. Digite os seis dígitos recebidos no seu WhatsApp.'
          : 'Não foi possível entregar o código. O cadastro foi preservado; aguarde para reenviar ou corrija o número.';
    const message = typeof challenge.message === 'string' && challenge.message.length <= 500 ? challenge.message : fallback;
    report(message + (flow.mode === 'unavailable' ? ' O responsável pelo ZapDMR precisa habilitar o serviço de confirmação do WhatsApp. O download permanece bloqueado.' : ''), flow.mode === 'unavailable' || (flow.mode === 'direct' && !challenge.sent));
    refreshControls();
    if (['reverse', 'bridge'].includes(flow.mode)) {
      if (!flow.challengeToken || (flow.mode === 'reverse' && !flow.displayCode)) {
        flow.mode = 'unavailable';
        whatsappLink.hidden = true;
        report('A confirmação pelo WhatsApp veio incompleta. O cadastro foi preservado; tente reenviar mais tarde.', true);
      } else schedulePoll(flow);
    }
    if (flow.mode !== 'reverse' && flow.mode !== 'unavailable') codeInput.focus();
  }
  async function completeVerification(flow, code) {
    if (flow !== pending || flow.complete) return;
    busy(true, flow);
    try {
      const data = await post('/v1/auth/verify', {registrationId: flow.registrationId, code, ...(flow.challengeToken ? {challengeToken: flow.challengeToken} : {})});
      if (flow !== pending) return;
      if (data.user?.verified !== true || data.user?.whatsapp_verified !== true || typeof data.token !== 'string' || !data.token) throw new Error('O servidor não confirmou o seu número. O download permanece bloqueado.');
      sessionToken = data.token;
      flow.complete = true;
      flow.challengeToken = '';
      flow.displayCode = '';
      codeInput.value = '';
      developmentNotice.hidden = true;
      whatsappLink.hidden = true;
      whatsappLink.removeAttribute('href');
      clearTimeout(pollTimer);
      panel.dataset.state = 'confirmed';
      document.querySelector('#verificationHeading').textContent = 'WhatsApp confirmado';
      report('WhatsApp confirmado. No aplicativo, use a confirmação da comunidade para entrar no diretório e no ZapChat.');
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
      } else result.textContent = 'WhatsApp confirmado. O instalador desta plataforma ainda aguarda publicação.';
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
    if (flow.mode === 'reverse') { await checkReverse(flow, true); return; }
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
    try { applyChallenge(await post('/v1/auth/request-code', {registrationId: flow.registrationId}), flow); }
    catch (error) {
      if (flow === pending) {
        flow.retryAt = Date.now() + Math.max(60, seconds(error.retryAfterSeconds, 60, 3600)) * 1000;
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
    form.elements.whatsapp.focus();
  }
  async function status() {
    try {
      const data = await requestJson('/v1/status');
      if (typeof data.verificationConfigured !== 'boolean' || !['android', 'windows'].every(key => typeof data.downloads?.[key]?.available === 'boolean')) throw new Error('Estado indisponível.');
      service = data;
      if (availability) availability.textContent = ['android', 'windows'].map(key => (key === 'android' ? 'Android' : 'Windows') + ': ' + (data.downloads[key].available ? 'instalador publicado · confirme o WhatsApp para baixar' : 'a aguardar publicação do instalador')).join(' · ');
      if (communityAvailability) {
        const development = localHost && data.developmentMode === true, reverse = data.verificationMode === 'reverse';
        communityAvailability.dataset.state = data.verificationConfigured || development ? 'configured' : 'unavailable';
        communityAvailability.textContent = development ? 'Modo de desenvolvimento local: códigos de teste visíveis, sem entrega real. Este modo não deve ser usado no site público.'
          : data.verificationConfigured ? (reverse ? 'Confirmação pelo WhatsApp: envie a mensagem preparada a partir do seu número e aguarde a confirmação do serviço.' : 'Confirmação por código configurada. Confirme o WhatsApp para baixar; no app, entre na comunidade para usar o diretório e o ZapChat.')
            : 'A confirmação de WhatsApp está indisponível. O cadastro pode ser guardado, mas novos downloads pelo portal, diretório e ZapChat aguardam a confirmação do número.';
      }
      if (owner && typeof data.owner === 'string' && data.owner.trim() && typeof data.privacyEmail === 'string' && data.privacyEmail.trim()) owner.textContent = data.owner + ' · Privacidade: ' + data.privacyEmail;
    } catch {
      if (availability) availability.textContent = 'Não foi possível consultar os instaladores. Tente novamente mais tarde.';
      if (communityAvailability) { communityAvailability.dataset.state = 'unavailable'; communityAvailability.textContent = 'Não foi possível consultar a confirmação de WhatsApp e o ZapChat. Tente novamente mais tarde.'; }
    }
  }
  if (form && result && button && fieldsPanel && downloadLink && panel && codeInput && verifyButton && resendButton && correctButton) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending) { await verify(); return; }
      const fields = new FormData(form), number = String(fields.get('whatsapp') || '').replace(/[\s().-]/g, '');
      if (!/^\+[1-9]\d{7,14}$/.test(number)) {
        result.classList.add('error'); result.setAttribute('role', 'alert'); result.textContent = 'Informe o WhatsApp com +DDI, DDD e número.'; form.elements.whatsapp.focus(); return;
      }
      button.disabled = true;
      const flow = begin(number, String(fields.get('platform')));
      panel.removeAttribute('data-state');
      try {
        const data = await post('/v1/registrations', {callsign: String(fields.get('callsign') || '').trim().toUpperCase(), dmrId: fields.get('dmrId'), whatsapp: number, platform: flow.platform, noticeAccepted: fields.get('noticeAccepted') === 'on', sharePhone: fields.get('sharePhone') === 'on', requestVerification: true});
        if (flow !== pending) return;
        if (typeof data.registrationId !== 'string' || !data.registrationId || data.verificationRequired !== true) throw new Error('O servidor não disponibilizou a confirmação do cadastro. O download permanece bloqueado.');
        flow.registrationId = data.registrationId;
        applyChallenge(data.challenge, flow);
      } catch (error) {
        if (flow === pending) report(error.message || 'Não foi possível iniciar a confirmação. Corrija o número ou tente novamente mais tarde.', true);
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
