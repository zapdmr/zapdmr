import assert from 'node:assert/strict';
import {fixture} from './chat-fixture.mjs';

const f = await fixture();
const originalFetch = globalThis.fetch;
const deliveries = [];
const request = async (call, path, value) => {
  const result = await f.request(call, path, value);
  return {status: result.response.status, ...await result.json()};
};
const emailProfile = {callsign: 'TEST1A', dmrId: '1000000', email: 'owner@example.com', platform: 'android', noticeAccepted: true, requestVerification: true};

try {
  Object.assign(f.env, {
    BREVO_API_KEY: 'xkeysib-test-only-not-a-real-key',
    BREVO_SENDER_EMAIL: 'ativacao@auth.zapdmr.com.br',
    BREVO_SENDER_NAME: 'ZapDMR Ativação'
  });
  globalThis.fetch = async (_url, options = {}) => {
    deliveries.push(JSON.parse(options.body));
    return new Response(JSON.stringify({messageId: '<test@brevo.invalid>'}), {status: 201});
  };

  // Rejected pre-recovery attempts still count against the anonymous IP bucket.
  for (let attempt = 1; attempt <= 10; attempt++) {
    const response = await request(null, '/v1/email/registrations', emailProfile);
    assert.equal(response.status, 409);
    assert.equal(response.code, 'ACCOUNT_RECOVERY_REQUIRED');
  }
  const limited = await request(null, '/v1/email/registrations', emailProfile);
  assert.equal(limited.status, 429);
  assert.ok(limited.retryAfterSeconds > 3500 && limited.retryAfterSeconds <= 3600);
  assert.equal(deliveries.length, 0, 'Brevo is not called before identity proof');

  // A valid account session gets an equally strict per-account bucket, isolated from a shared IP.
  const authorized = await request('TEST1A', '/v1/email/registrations', emailProfile);
  assert.equal(authorized.status, 201, JSON.stringify(authorized));
  assert.equal(deliveries.length, 1);
  const buckets = f.sqlite.prepare("SELECT bucket,n,identity FROM rate_limits WHERE bucket LIKE 'email-registration%' ORDER BY bucket").all();
  assert.equal(buckets.find(row => row.bucket === 'email-registration').n, 11);
  const accountBucket = buckets.find(row => row.bucket === 'email-registration-account');
  assert.equal(accountBucket.n, 1);
  assert.equal(accountBucket.identity, f.users.TEST1A);

  // WhatsApp activation uses an independent bucket and remains unaffected.
  const whatsapp = await request(null, '/v1/registrations', {callsign: 'NEW9W', dmrId: '1000097', whatsapp: '+15555550197', platform: 'android', noticeAccepted: true, sharePhone: false, requestVerification: false});
  assert.equal(whatsapp.status, 201, JSON.stringify(whatsapp));
  assert.equal(f.sqlite.prepare("SELECT n FROM rate_limits WHERE bucket='registration'").get().n, 1);

  console.log('PASS: anonymous email registration remains IP-limited, authenticated recovery uses a separate per-account limit, WhatsApp is isolated, and Brevo is not called before proof.');
} finally {
  globalThis.fetch = originalFetch;
  f.sqlite.close();
}
