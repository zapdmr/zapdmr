import assert from 'node:assert/strict';
import {handleApi} from '../../site/cloudflare/api.mjs';
import {fixture} from './chat-fixture.mjs';

const f = await fixture();
const admin = Buffer.from(`admin:${f.env.ADMIN_PASSWORD}`).toString('base64');
const request = async (authorization, value) => {
  const response = await handleApi(new Request('https://www.zapdmr.com.br/admin/email-recovery', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...(authorization ? {Authorization: `Basic ${authorization}`} : {})},
    body: JSON.stringify(value)
  }), f.env);
  return {status: response.status, ...await response.json()};
};

try {
  const accountId = f.users.TEST1A;
  const before = f.sqlite.prepare('SELECT phone_cipher,phone_hash,share_phone,verification_method,whatsapp_verified FROM users WHERE id=?').get(accountId);
  const payload = {callsign: 'test1a', dmrId: '1000000', email: 'OWNER@example.com', confirmIdentity: 'TEST1A:1000000', reason: 'Titular confirmado pelo administrador durante atendimento.'};

  const unauthenticated = await request(null, payload);
  assert.equal(unauthenticated.status, 401);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM email_recovery_audit').get().n, 0);

  const wrongIdentity = await request(admin, {...payload, dmrId: '1000001', confirmIdentity: 'TEST1A:1000001'});
  assert.equal(wrongIdentity.status, 404);

  const recovered = await request(admin, payload);
  assert.equal(recovered.status, 200, JSON.stringify(recovered));
  assert.equal(recovered.user.callsign, 'TEST1A');
  assert.equal(recovered.user.emailVerified, true);
  const after = f.sqlite.prepare('SELECT phone_cipher,phone_hash,share_phone,verification_method,whatsapp_verified,email_verified,email_hash FROM users WHERE id=?').get(accountId);
  assert.deepEqual({...after, email_verified: undefined, email_hash: undefined}, {...before, email_verified: undefined, email_hash: undefined});
  assert.equal(after.email_verified, 1);
  assert.match(after.email_hash, /^[a-f\d]{64}$/);
  const audit = f.sqlite.prepare('SELECT user_id,action,email_hash,reason FROM email_recovery_audit WHERE id=?').get(recovered.auditId);
  assert.equal(audit.user_id, accountId);
  assert.equal(audit.action, 'admin_bind_verified');
  assert.equal(audit.email_hash, after.email_hash);
  assert.equal(audit.reason, payload.reason);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM users WHERE callsign='TEST1A'").get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(accountId).n, 1);

  const conflicting = await request(admin, {...payload, callsign: 'TEST1B', dmrId: '1000001', confirmIdentity: 'TEST1B:1000001'});
  assert.equal(conflicting.status, 409);
  assert.equal(f.sqlite.prepare('SELECT email_verified FROM users WHERE id=?').get(f.users.TEST1B).email_verified, 0);

  console.log('PASS: administrative email recovery is authenticated, identity-bound, audited, idempotent for the owner, preserves sessions and rejects cross-account email reuse.');
} finally {
  f.sqlite.close();
}
