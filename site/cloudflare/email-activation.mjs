const TTL = 10 * 60 * 1000;
const RESEND_AFTER = 60 * 1000;

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('Informe um endereço de e-mail válido.'), {status: 400});
  }
  return email;
}

function maskedEmail(email) {
  const [local, domain] = email.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function emailHtml(callsign, code) {
  return `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#12261d"><h2>Confirmação ZapDMR</h2><p>Olá, <strong>${callsign}</strong>.</p><p>Seu código de confirmação é:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#00884a">${code}</p><p>O código expira em 10 minutos e só pode ser usado uma vez.</p><p>Se você não solicitou este código, ignore esta mensagem.</p></body></html>`;
}

async function sendCode(env, row, email, code, request, failure) {
  const apiKey = String(env.BREVO_API_KEY || '');
  const senderEmail = String(env.BREVO_SENDER_EMAIL || '');
  const senderName = String(env.BREVO_SENDER_NAME || 'ZapDMR Ativação').trim().slice(0, 70);
  if (!apiKey.startsWith('xkeysib-') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw failure(503, 'A ativação por e-mail ainda não foi configurada pelo responsável.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, {once: true});
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      redirect: 'manual',
      headers: {'Content-Type': 'application/json', Accept: 'application/json', 'api-key': apiKey},
      body: JSON.stringify({
        sender: {name: senderName, email: senderEmail},
        to: [{email}],
        subject: `ZapDMR — código de confirmação ${callsignLabel(row.callsign)}`,
        textContent: `ZapDMR — código de confirmação\n\nOlá, ${row.callsign}.\nSeu código é ${code}.\nEle expira em 10 minutos e só pode ser usado uma vez.`,
        htmlContent: emailHtml(row.callsign, code),
        headers: {'X-ZapDMR-Environment': String(env.EMAIL_ACTIVATION_ENV || 'experimental')},
        tags: ['zapdmr-activation']
      }),
      signal: controller.signal
    });
    if (response.ok) {
      await response.body?.cancel();
      return;
    }
    const retryAfter = Number(response.headers.get('Retry-After'));
    await response.body?.cancel();
    console.error(JSON.stringify({event: 'brevo_rejected', status: response.status}));
    if (response.status === 429) {
      throw failure(503, 'O limite gratuito diário de e-mails foi atingido. Tente novamente quando a cota for renovada.', {
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 3600
      });
    }
    throw failure(503, 'O serviço de e-mail não aceitou o envio. Tente novamente mais tarde.');
  } catch (error) {
    if (error?.status) throw error;
    console.error(JSON.stringify({event: 'brevo_exception', name: String(error?.name || ''), message: String(error?.message || '').slice(0, 300)}));
    throw failure(503, 'Não foi possível enviar o código por e-mail. Tente novamente mais tarde.');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}

function callsignLabel(value) {
  return String(value || '').replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function emailActivation(config, env, helpers) {
  const {failure, hash, sameHash, seal, randomToken, otpCode, rate, sessionService, publicUser, downloadToken} = helpers;
  const db = config.db;

  async function assertIdentity(row) {
    const [prior, conflictingIdentity, emailOwner] = await Promise.all([
      db.prepare('SELECT * FROM users WHERE callsign=? AND dmr_id=? LIMIT 1').bind(row.callsign, row.dmr_id).first(),
      db.prepare('SELECT id FROM users WHERE (callsign=? OR dmr_id=?) AND NOT (callsign=? AND dmr_id=?) LIMIT 1').bind(row.callsign, row.dmr_id, row.callsign, row.dmr_id).first(),
      db.prepare('SELECT id FROM users WHERE email_hash=? LIMIT 1').bind(row.email_hash).first()
    ]);
    if (conflictingIdentity || emailOwner && emailOwner.id !== prior?.id) {
      throw failure(409, 'Não foi possível verificar a titularidade. Solicite recuperação ao responsável.', {code: 'ACCOUNT_RECOVERY_REQUIRED'});
    }
    if (!prior) return null;
    const trustedEmail = prior.email_verified === 1 && prior.email_hash === row.email_hash;
    const trustedSession = Boolean(row.authorized_user_id && row.authorized_user_id === prior.id);
    if (!trustedEmail && !trustedSession) {
      const message = prior.email_verified === 1
        ? 'Sua conta já existe. Confirme usando o e-mail já vinculado. Se não tiver acesso, solicite recuperação ao responsável.'
        : 'Sua conta já existe, mas ainda não possui e-mail confirmado. Importe a ativação antiga neste aparelho e tente novamente. Se não tiver acesso, solicite recuperação ao responsável.';
      throw failure(409, message, {code: 'ACCOUNT_RECOVERY_REQUIRED'});
    }
    return prior;
  }

  async function issue(request, row) {
    await assertIdentity(row);
    const prior = await db.prepare('SELECT requested_at FROM email_codes WHERE registration_id=?').bind(row.id).first();
    const now = Date.now();
    if (prior && prior.requested_at + RESEND_AFTER > now) {
      throw failure(429, 'Aguarde para reenviar o código.', {retryAfterSeconds: Math.ceil((prior.requested_at + RESEND_AFTER - now) / 1000)});
    }
    await rate(config, request, 'otp-email', 1, RESEND_AFTER, row.email_hash);
    const code = otpCode();
    const codeHash = await hash(config, row.id + ':' + code);
    await db.prepare(`INSERT INTO email_codes(registration_id,hash,expires_at,attempts,requested_at) VALUES(?,?,?,0,?)
      ON CONFLICT(registration_id) DO UPDATE SET hash=excluded.hash,expires_at=excluded.expires_at,attempts=0,requested_at=excluded.requested_at`).bind(row.id, codeHash, now + TTL, now).run();
    try {
      const email = await helpers.unseal(config, row.email_cipher);
      await sendCode(env, row, email, code, request, failure);
      return {mode: 'email', sent: true, expiresInSeconds: TTL / 1000, retryAfterSeconds: RESEND_AFTER / 1000, destination: maskedEmail(email), message: 'Código enviado por e-mail. Verifique também a caixa de spam.'};
    } catch (error) {
      await db.prepare('DELETE FROM email_codes WHERE registration_id=? AND hash=?').bind(row.id, codeHash).run();
      throw error;
    }
  }

  async function register(request, raw, normalizeCallsign, normalizeRadioId, noticeVersion, authorizedUser = null) {
    if (raw.noticeAccepted !== true) throw failure(400, 'Leia e aceite a utilização dos dados para o cadastro.');
    const callsign = normalizeCallsign(raw.callsign);
    const dmrId = normalizeRadioId(raw.dmrId);
    const email = normalizeEmail(raw.email);
    const emailHash = await hash(config, 'email:' + email);
    const platform = raw.platform === 'windows' ? 'windows' : 'android';
    const registrationId = crypto.randomUUID();
    const [existing, conflictingIdentity, emailOwner] = await Promise.all([
      db.prepare('SELECT * FROM users WHERE callsign=? AND dmr_id=? LIMIT 1').bind(callsign, dmrId).first(),
      db.prepare('SELECT id FROM users WHERE (callsign=? OR dmr_id=?) AND NOT (callsign=? AND dmr_id=?) LIMIT 1').bind(callsign, dmrId, callsign, dmrId).first(),
      db.prepare('SELECT id FROM users WHERE email_hash=? LIMIT 1').bind(emailHash).first()
    ]);
    if (conflictingIdentity || emailOwner && emailOwner.id !== existing?.id || authorizedUser && authorizedUser.id !== existing?.id) {
      throw failure(409, 'Não foi possível verificar a titularidade. Solicite recuperação ao responsável.', {code: 'ACCOUNT_RECOVERY_REQUIRED'});
    }
    const trustedEmail = existing?.email_verified === 1 && existing.email_hash === emailHash;
    const trustedSession = Boolean(existing && authorizedUser?.id === existing.id);
    if (existing && !trustedEmail && !trustedSession) {
      const message = existing.email_verified === 1
        ? 'Sua conta já existe. Confirme usando o e-mail já vinculado. Se não tiver acesso, solicite recuperação ao responsável.'
        : 'Sua conta já existe, mas ainda não possui e-mail confirmado. Importe a ativação antiga neste aparelho e tente novamente. Se não tiver acesso, solicite recuperação ao responsável.';
      throw failure(409, message, {code: 'ACCOUNT_RECOVERY_REQUIRED'});
    }
    await db.prepare('INSERT INTO email_registrations(id,callsign,dmr_id,email_cipher,email_hash,authorized_user_id,platform,created_at,notice_version) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(registrationId, callsign, dmrId, await seal(config, email), emailHash, trustedSession ? existing.id : null, platform, Date.now(), noticeVersion).run();
    const row = await db.prepare('SELECT * FROM email_registrations WHERE id=?').bind(registrationId).first();
    let challenge;
    if (raw.requestVerification === true) challenge = await issue(request, row);
    return {registrationId, verified: false, verificationRequired: true, channel: 'email', ...(challenge ? {challenge} : {}), message: 'Cadastro recebido. Digite os seis dígitos enviados ao seu e-mail.'};
  }

  async function requestCode(request, raw) {
    const row = await db.prepare('SELECT * FROM email_registrations WHERE id=?').bind(String(raw.registrationId || '')).first();
    if (!row) throw failure(404, 'Faça primeiro o cadastro por e-mail.');
    return issue(request, row);
  }

  async function verify(raw) {
    const registrationId = String(raw.registrationId || '');
    const code = String(raw.code || '');
    if (!/^\d{6}$/.test(code)) throw failure(400, 'Digite os 6 dígitos recebidos.');
    const now = Date.now();
    const pending = await db.prepare('SELECT * FROM email_codes WHERE registration_id=? AND expires_at>? AND attempts<5').bind(registrationId, now).first();
    if (!pending) throw failure(401, 'Código expirado ou bloqueado. Solicite outro.');
    const attempts = await db.batch([
      db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE registration_id=? AND hash=? AND expires_at>? AND attempts<5 RETURNING *').bind(registrationId, pending.hash, now),
      db.prepare('SELECT * FROM email_registrations WHERE id=?').bind(registrationId)
    ]);
    const codeRow = attempts[0].results[0], row = attempts[1].results[0];
    if (!codeRow || !row || !await sameHash(config, row.id + ':' + code, codeRow.hash)) throw failure(401, 'Código incorreto.');
    const existing = await assertIdentity(row);
    const token = randomToken();
    const sessionHash = await hash(config, token);
    const id = existing?.id || crypto.randomUUID();
    const modern = raw.sessionProtocol === 2;
    const sessions = sessionService(config, {hash, seal, unseal: helpers.unseal, randomToken, failure});
    const device = modern ? await sessions.prepare(id, token) : null;
    const placeholderPhoneCipher = existing?.phone_cipher || await seal(config, '');
    const placeholderPhoneHash = existing?.phone_hash || await hash(config, 'email-account:' + row.email_hash);
    const accountStatement = existing
      ? db.prepare(`UPDATE users SET verified_at=?,verification_method='email',email_cipher=?,email_hash=?,email_verified=1
          WHERE id=? AND callsign=? AND dmr_id=? AND EXISTS(
            SELECT 1 FROM email_registrations r JOIN email_codes c ON c.registration_id=r.id
            WHERE r.id=? AND c.hash=? AND c.expires_at>? AND c.attempts<=5
              AND (r.authorized_user_id=users.id OR users.email_verified=1 AND users.email_hash=r.email_hash)) RETURNING *`)
          .bind(now, row.email_cipher, row.email_hash, existing.id, row.callsign, row.dmr_id, row.id, codeRow.hash, now)
      : db.prepare(`INSERT INTO users(id,callsign,dmr_id,phone_cipher,phone_hash,share_phone,created_at,verified_at,whatsapp_verified,verification_method,email_cipher,email_hash,email_verified)
          SELECT ?,r.callsign,r.dmr_id,?,?,0,?,?,1,'email',r.email_cipher,r.email_hash,1 FROM email_registrations r JOIN email_codes c ON c.registration_id=r.id
          WHERE r.id=? AND c.hash=? AND c.expires_at>? AND c.attempts<=5
          ON CONFLICT(callsign) DO UPDATE SET verified_at=excluded.verified_at,verification_method='email',email_cipher=excluded.email_cipher,email_hash=excluded.email_hash,email_verified=1
          WHERE users.dmr_id=excluded.dmr_id AND users.email_hash=excluded.email_hash RETURNING *`)
          .bind(id, placeholderPhoneCipher, placeholderPhoneHash, now, now, row.id, codeRow.hash, now);
    let result;
    try {
      result = await db.batch([
        accountStatement,
        db.prepare(`INSERT INTO sessions(hash,user_id,expires_at) SELECT ?,u.id,? FROM users u JOIN email_registrations r ON u.callsign=r.callsign AND u.dmr_id=r.dmr_id AND u.email_hash=r.email_hash
          JOIN email_codes c ON c.registration_id=r.id WHERE r.id=? AND c.hash=? AND c.expires_at>? AND c.attempts<=5`)
          .bind(sessionHash, modern ? device.value.accessExpiresAt : now + 30 * 86400000, row.id, codeRow.hash, now),
        db.prepare('UPDATE email_registrations SET verified_at=? WHERE id=? AND EXISTS(SELECT 1 FROM sessions WHERE hash=?)').bind(now, row.id, sessionHash),
        db.prepare('DELETE FROM email_codes WHERE registration_id=? AND hash=?').bind(row.id, codeRow.hash),
        ...(device ? sessions.issueStatements(device, sessionHash) : [])
      ]);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint')) throw failure(409, 'O perfil ou e-mail já está vinculado a outra conta.');
      throw error;
    }
    if (!result[0].results.length || !result[1].meta.changes) throw failure(401, 'O código já foi utilizado. Solicite outro.');
    const available = Boolean(config.downloads[row.platform]);
    return {token, ...(device ? device.value : {}), user: await publicUser(config, result[0].results[0], true), expiresInSeconds: modern ? 3600 : 30 * 86400, ...(!modern ? {expiresInDays: 30} : {}), downloadAvailable: available, downloadUrl: available ? '/download/' + await downloadToken(config, row.id, row.platform, 'email') : null};
  }

  return {register, requestCode, verify};
}
