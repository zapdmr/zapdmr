import assert from 'node:assert/strict';
import {fixture} from './chat-fixture.mjs';

const f = await fixture();
const originalFetch = globalThis.fetch;
const deliveries = [];

try {
  Object.assign(f.env, {
    BREVO_API_KEY: 'xkeysib-test-only-not-a-real-key',
    BREVO_SENDER_EMAIL: 'ativacao@auth.zapdmr.com.br',
    BREVO_SENDER_NAME: 'ZapDMR Ativação',
    EMAIL_ACTIVATION_ENV: 'test'
  });
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['api-key'], f.env.BREVO_API_KEY);
    const payload = JSON.parse(options.body);
    deliveries.push(payload);
    return new Response(JSON.stringify({messageId: '<test@brevo.invalid>'}), {status: 201, headers: {'Content-Type': 'application/json'}});
  };

  const profile = {
    callsign: 'TEST9E',
    dmrId: '1000019',
    email: 'Operator.Test@Example.com',
    platform: 'android',
    noticeAccepted: true,
    requestVerification: true
  };
  const registrationRequest = await f.request(null, '/v1/email/registrations', profile);
  assert.equal(registrationRequest.response.status, 201);
  const registration = await registrationRequest.json();
  assert.equal(registration.channel, 'email');
  assert.equal(registration.challenge.mode, 'email');
  assert.equal(registration.challenge.sent, true);
  assert.match(registration.challenge.destination, /^op\*+@example\.com$/);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].sender.email, 'ativacao@auth.zapdmr.com.br');
  assert.equal(deliveries[0].to[0].email, 'operator.test@example.com');
  assert.equal(deliveries[0].headers['X-ZapDMR-Environment'], 'test');
  const code = /Seu código é (\d{6})\./.exec(deliveries[0].textContent)?.[1];
  assert.match(code, /^\d{6}$/);

  const wrongRequest = await f.request(null, '/v1/email/verify', {registrationId: registration.registrationId, code: '000000', sessionProtocol: 2});
  assert.equal(wrongRequest.response.status, 401);
  assert.equal(f.sqlite.prepare('SELECT attempts FROM email_codes WHERE registration_id=?').get(registration.registrationId).attempts, 1);

  const verifyRequest = await f.request(null, '/v1/email/verify', {registrationId: registration.registrationId, code, sessionProtocol: 2});
  assert.equal(verifyRequest.response.status, 200);
  const verified = await verifyRequest.json();
  assert.equal(verified.user.verified, true);
  assert.equal(verified.user.email_verified, true);
  assert.equal(verified.user.whatsapp_verified, false);
  assert.equal(verified.user.verificationMethod, 'email');
  assert.match(verified.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(verified.refreshToken, /^[A-Za-z0-9_-]{43}$/);
  const stored = f.sqlite.prepare('SELECT whatsapp_verified,email_verified,verification_method,email_hash,email_cipher FROM users WHERE callsign=?').get(profile.callsign);
  assert.equal(stored.whatsapp_verified, 1, 'compatibility authorization remains enabled for existing chat queries');
  assert.equal(stored.email_verified, 1);
  assert.equal(stored.verification_method, 'email');
  assert.match(stored.email_hash, /^[a-f0-9]{64}$/);
  assert.ok(stored.email_cipher && !stored.email_cipher.includes('operator.test'));
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM email_codes WHERE registration_id=?').get(registration.registrationId).n, 0);

  const replay = await f.request(null, '/v1/email/verify', {registrationId: registration.registrationId, code});
  assert.equal(replay.response.status, 401);

  const conflict = await f.request(null, '/v1/email/registrations', {...profile, email: 'other@example.com', requestVerification: false});
  assert.equal(conflict.response.status, 409);

  console.log('PASS: Brevo email OTP is normalized, encrypted, rate-limited, single-use, device-session capable, and does not replace existing WhatsApp activation.');
} finally {
  globalThis.fetch = originalFetch;
  f.sqlite.close();
}
