const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'site/public/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'site/public/site.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'site/public/site.css'), 'utf8');
const qr = fs.readFileSync(path.join(root, 'site/public/pix-zapdmr-qrcode.png'));
const key = 'f91e394a-28b5-43ea-b561-24e0896e8871';

assert.match(html, /id="apoie"/);
assert.match(html, /APOIE O PROJETO ZAPDMR/);
assert.match(html, /Apoie o ZapDMR\./);
assert.match(html, /Contribuição totalmente voluntária/);
assert.match(html, /Não há cobrança automática, assinatura ou mensalidade/);
assert.match(html, /RIZANDRO CESAR DA SILVA/);
assert.match(html, /src="\/pix-zapdmr-qrcode\.png"/);
assert.equal((html.match(new RegExp(key, 'g')) || []).length, 1);
assert.match(js, new RegExp(`const PIX_KEY = '${key}'`));
assert.match(js, /navigator\.clipboard\?\.writeText\) await navigator\.clipboard\.writeText\(PIX_KEY\)/);
assert.doesNotMatch(js, /URLSearchParams[^;]*pix/i);
assert.match(css, /\.support-section\{/);
assert.match(css, /@media\(max-width:640px\)[^{]*\{\.support-section/);
assert.equal(crypto.createHash('sha256').update(qr).digest('hex'), '142f98bff1c172b3a052751c59fb31645015c6f9189ea2ab9b704de12cd57d60');

console.log('PASS: the local Pix section is voluntary, static, responsive, copy-enabled, and pinned to the validated QR asset.');
