(() => {
  const form = document.querySelector('#downloadForm');
  const result = document.querySelector('#downloadResult');
  const button = form?.querySelector('button[type=submit]');
  const downloadLink = document.querySelector('#downloadLink');
  const availability = document.querySelector('#downloadAvailability');
  const communityAvailability = document.querySelector('#communityAvailability');
  const owner = document.querySelector('#siteOwner');

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      let response;
      try {
        response = await fetch(path, { ...options, signal: controller.signal });
      } catch {
        throw new Error('Não foi possível comunicar com o servidor. Verifique a ligação e tente novamente.');
      }
      let data;
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        try { data = await response.json(); } catch { /* Use the same readable error for malformed JSON and proxy pages. */ }
      }
      if (!response.ok) {
        const fallback = response.status === 429
          ? 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'
          : 'O serviço está temporariamente indisponível. Tente novamente mais tarde.';
        throw new Error(typeof data?.message === 'string' && data.message.length <= 300 ? data.message : fallback);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('O servidor não respondeu como esperado. Tente novamente mais tarde.');
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function status() {
    try {
      const data = await requestJson('/v1/status');
      if (typeof data.verificationConfigured !== 'boolean' ||
          !['android', 'windows'].every(key => typeof data.downloads?.[key]?.available === 'boolean')) {
        throw new Error('O estado dos serviços não está disponível.');
      }
      if (availability) {
        availability.textContent = ['android', 'windows'].map(key =>
          `${key === 'android' ? 'Android' : 'Windows'}: ${data.downloads[key].available
            ? 'instalador disponível' : 'a aguardar publicação do instalador'}`).join(' · ');
      }
      if (communityAvailability) {
        communityAvailability.dataset.state = data.verificationConfigured ? 'configured' : 'unavailable';
        communityAvailability.textContent = data.verificationConfigured
          ? 'Confirmação por código configurada. Confirme o seu número no app para aceder ao diretório e ao ZapChat.'
          : 'Confirmação de número indisponível. Novos cadastros ainda não podem entrar no diretório nem iniciar o ZapChat. Os instaladores publicados continuam disponíveis.';
      }
      if (owner && typeof data.owner === 'string' && data.owner.trim() &&
          typeof data.privacyEmail === 'string' && data.privacyEmail.trim()) {
        owner.textContent = `${data.owner} · Privacidade: ${data.privacyEmail}`;
      }
    } catch {
      if (availability) availability.textContent = 'Não foi possível consultar os instaladores. Tente novamente mais tarde.';
      if (communityAvailability) {
        communityAvailability.dataset.state = 'unavailable';
        communityAvailability.textContent = 'Não foi possível consultar a confirmação de número e o ZapChat. Tente novamente mais tarde.';
      }
    }
  }

  if (form && result && button && downloadLink) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      button.disabled = true;
      form.setAttribute('aria-busy', 'true');
      result.classList.remove('error');
      result.setAttribute('role', 'status');
      result.textContent = 'A registar o cadastro…';
      downloadLink.hidden = true;
      downloadLink.removeAttribute('href');
      try {
        const fields = new FormData(form);
        const number = String(fields.get('whatsapp') || '').replace(/[\s().-]/g, '');
        if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new Error('Informe o WhatsApp com +DDI, DDD e número.');
        const data = await requestJson('/v1/registrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callsign: String(fields.get('callsign') || '').trim().toUpperCase(),
            dmrId: fields.get('dmrId'),
            whatsapp: number,
            platform: fields.get('platform'),
            noticeAccepted: fields.get('noticeAccepted') === 'on',
            sharePhone: fields.get('sharePhone') === 'on'
          })
        });
        if (typeof data.registrationId !== 'string' || typeof data.downloadAvailable !== 'boolean') {
          throw new Error('Não foi possível confirmar o cadastro. Tente novamente mais tarde.');
        }
        result.textContent = (typeof data.message === 'string' ? data.message : 'Cadastro recebido.') +
          ' O número ainda não está verificado e não foi publicado no diretório.';
        if (data.downloadAvailable && typeof data.downloadUrl === 'string') {
          const url = new URL(data.downloadUrl, location.origin);
          if (url.origin !== location.origin || !url.pathname.startsWith('/download/')) {
            throw new Error('O instalador não está disponível neste endereço. Tente novamente mais tarde.');
          }
          downloadLink.href = url.href;
          downloadLink.hidden = false;
          downloadLink.textContent = 'Baixar ' + (fields.get('platform') === 'windows' ? 'Windows (.exe)' : 'Android (.apk)');
          downloadLink.click();
        }
      } catch (error) {
        result.classList.add('error');
        result.setAttribute('role', 'alert');
        result.textContent = error instanceof Error ? error.message : 'O cadastro não foi concluído. Tente novamente.';
      } finally {
        button.disabled = false;
        form.removeAttribute('aria-busy');
      }
    });
    button.disabled = false;
  }
  void status();
})();
