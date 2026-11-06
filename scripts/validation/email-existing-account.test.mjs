import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fixture} from './chat-fixture.mjs';

const f = await fixture();
const originalFetch = globalThis.fetch;
const deliveries = [];

const profile = (callsign, dmrId, email, platform = 'android') => ({
  callsign, dmrId, email, platform, noticeAccepted: true, requestVerification: true
});
const ask = async (call, path, value) => {
  const request = await f.request(call, path, value);
  return {status: request.response.status, ...await request.json()};
};
const lastCode = () => /Seu código é (\d{6})\./.exec(deliveries.at(-1)?.textContent || '')?.[1];

try {
  Object.assign(f.env, {
    BREVO_API_KEY: 'xkeysib-test-only-not-a-real-key',
    BREVO_SENDER_EMAIL: 'ativacao@auth.zapdmr.com.br',
    BREVO_SENDER_NAME: 'ZapDMR Ativação',
    EMAIL_ACTIVATION_ENV: 'test'
  });
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    deliveries.push(JSON.parse(options.body));
    return new Response(JSON.stringify({messageId: '<test@brevo.invalid>'}), {status: 201});
  };

  const accountId = f.users.TEST1A;
  const initialUsers = f.sqlite.prepare('SELECT count(*) n FROM users').get().n;
  const preserved = f.sqlite.prepare('SELECT phone_cipher,phone_hash,share_phone,created_at FROM users WHERE id=?').get(accountId);

  // Existing account without a trusted email or presented session: never send to a newly supplied address.
  const blocked = await ask(null, '/v1/email/registrations', profile('TEST1A', '1000000', 'owner@example.com'));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.code, 'ACCOUNT_RECOVERY_REQUIRED');
  assert.match(blocked.message, /Importe a ativação antiga/);
  assert.equal(deliveries.length, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM email_registrations WHERE callsign='TEST1A'").get().n, 0);

  // A valid session for that same account authorizes enrollment of a new email, but the email OTP still proves control.
  const android = await ask('TEST1A', '/v1/email/registrations', profile('TEST1A', '1000000', 'owner@example.com'));
  assert.equal(android.status, 201, JSON.stringify(android));
  assert.equal(android.challenge.mode, 'email');
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to[0].email, 'owner@example.com');
  const androidRow = f.sqlite.prepare('SELECT platform,authorized_user_id FROM email_registrations WHERE id=?').get(android.registrationId);
  assert.equal(androidRow.platform, 'android');
  assert.equal(androidRow.authorized_user_id, accountId);

  const wrong = await ask(null, '/v1/email/verify', {registrationId: android.registrationId, code: '000000', sessionProtocol: 2});
  assert.equal(wrong.status, 401);
  const androidVerified = await ask(null, '/v1/email/verify', {registrationId: android.registrationId, code: lastCode(), sessionProtocol: 2});
  assert.equal(androidVerified.status, 200, JSON.stringify(androidVerified));
  assert.equal(androidVerified.user.id, accountId);
  assert.equal(androidVerified.user.email_verified, true);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM users').get().n, initialUsers, 'no duplicate account');

  // The now-verified email can authorize a separate Windows device without an existing session.
  f.sqlite.prepare("UPDATE rate_limits SET expires_at=? WHERE bucket='otp-email'").run(Date.now() - 1);
  const windows = await ask(null, '/v1/email/registrations', profile('TEST1A', '1000000', 'OWNER@example.com', 'windows'));
  assert.equal(windows.status, 201, JSON.stringify(windows));
  assert.equal(f.sqlite.prepare('SELECT platform,authorized_user_id FROM email_registrations WHERE id=?').get(windows.registrationId).platform, 'windows');
  const windowsVerified = await ask(null, '/v1/email/verify', {registrationId: windows.registrationId, code: lastCode(), sessionProtocol: 2});
  assert.equal(windowsVerified.status, 200, JSON.stringify(windowsVerified));
  assert.equal(windowsVerified.user.id, accountId);
  assert.notEqual(windowsVerified.deviceId, androidVerified.deviceId);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM auth_devices WHERE user_id=? AND revoked_at IS NULL').get(accountId).n, 2);

  // A different untrusted address cannot replace the verified address.
  const differentEmail = await ask(null, '/v1/email/registrations', profile('TEST1A', '1000000', 'attacker@example.com'));
  assert.equal(differentEmail.status, 409);
  assert.equal(differentEmail.code, 'ACCOUNT_RECOVERY_REQUIRED');
  assert.match(differentEmail.message, /e-mail já vinculado/);

  // Callsign/DMR mixing is rejected without disclosing which field belongs to another account.
  const takeover = await ask(null, '/v1/email/registrations', profile('TEST1A', '1000001', 'owner@example.com'));
  assert.equal(takeover.status, 409);
  assert.equal(takeover.code, 'ACCOUNT_RECOVERY_REQUIRED');
  assert.equal(takeover.message, 'Não foi possível verificar a titularidade. Solicite recuperação ao responsável.');

  // New account remains supported and creates one account only after the correct code.
  const newcomer = await ask(null, '/v1/email/registrations', profile('NEW9A', '1000099', 'new@example.com'));
  assert.equal(newcomer.status, 201, JSON.stringify(newcomer));
  const newcomerVerified = await ask(null, '/v1/email/verify', {registrationId: newcomer.registrationId, code: lastCode(), sessionProtocol: 2});
  assert.equal(newcomerVerified.status, 200, JSON.stringify(newcomerVerified));
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM users WHERE callsign='NEW9A' AND dmr_id='1000099'").get().n, 1);

  // Expired codes cannot activate an otherwise valid new registration.
  const expiring = await ask(null, '/v1/email/registrations', profile('EXP9A', '1000098', 'expired@example.com'));
  assert.equal(expiring.status, 201, JSON.stringify(expiring));
  const expiredCode = lastCode();
  f.sqlite.prepare('UPDATE email_codes SET expires_at=? WHERE registration_id=?').run(Date.now() - 1, expiring.registrationId);
  const expired = await ask(null, '/v1/email/verify', {registrationId: expiring.registrationId, code: expiredCode, sessionProtocol: 2});
  assert.equal(expired.status, 401);
  assert.match(expired.message, /expirado ou bloqueado/);

  // Existing account data and all unrelated accounts remain intact.
  const after = f.sqlite.prepare('SELECT phone_cipher,phone_hash,share_phone,created_at FROM users WHERE id=?').get(accountId);
  assert.deepEqual(after, preserved);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM users WHERE callsign IN ('TEST1B','TEST1C')").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM users WHERE callsign='TEST1A' AND dmr_id='1000000'").get().n, 1);

  // The additive migration preserves pre-existing registrations and leaves them untrusted by default.
  const migrationDb = new DatabaseSync(':memory:');
  migrationDb.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE email_registrations(id TEXT PRIMARY KEY,callsign TEXT NOT NULL,dmr_id TEXT NOT NULL,email_cipher TEXT NOT NULL,email_hash TEXT NOT NULL,platform TEXT NOT NULL,created_at INTEGER NOT NULL,verified_at INTEGER,notice_version TEXT NOT NULL);
    INSERT INTO users(id) VALUES('existing-user');
    INSERT INTO email_registrations VALUES('existing-registration','TEST9M','1000088','cipher','hash','android',1,NULL,'old');`);
  migrationDb.exec(readFileSync('site/cloudflare/migrations/0009_email_existing_accounts.sql', 'utf8'));
  const migrated = migrationDb.prepare("SELECT id,authorized_user_id FROM email_registrations WHERE id='existing-registration'").get();
  assert.equal(migrated.id, 'existing-registration');
  assert.equal(migrated.authorized_user_id, null);
  migrationDb.close();

  console.log('PASS: existing-account email recovery requires prior trust, preserves the account, authorizes Android/Windows separately, rejects takeover, and enforces OTP errors/expiry.');
} finally {
  globalThis.fetch = originalFetch;
  f.sqlite.close();
}
