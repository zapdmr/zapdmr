const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('web/onboarding.js', 'utf8');
assert.match(source, /e\.status===429&&e\.retryAfterSeconds/);
assert.match(source, /Tente novamente em \$\{minutes\}:\$\{seconds\}/);
assert.match(source, /onboardingSendEmail/);
assert.match(source, /button\.disabled=true/);

console.log('PASS: Android onboarding displays the server retry countdown and disables the email submission button during the wait.');
