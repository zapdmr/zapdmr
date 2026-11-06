const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('site/public/index.html', 'utf8');
const js = fs.readFileSync('site/public/site.js', 'utf8');

assert.match(html, /name="email" type="email" required/);
assert.match(html, /action="\/v1\/email\/registrations"/);
assert.match(html, /Confirme o seu e-mail/);
assert.doesNotMatch(html, /name="whatsapp"/);
assert.doesNotMatch(html, /sharePhone|updateNotifications/);
assert.match(js, /post\('\/v1\/email\/registrations'/);
assert.match(js, /post\('\/v1\/email\/request-code'/);
assert.match(js, /post\('\/v1\/email\/verify'/);
assert.match(js, /data\.user\?\.email_verified !== true/);
assert.match(js, /data\.emailVerificationConfigured/);
assert.doesNotMatch(js, /post\('\/v1\/registrations'/);
assert.doesNotMatch(js, /post\('\/v1\/auth\/verify'/);

console.log('PASS: public portal uses six-digit email confirmation only; WhatsApp fields are absent and no production request was sent.');
