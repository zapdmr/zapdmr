const fs=require('fs'),assert=require('node:assert/strict'),asar=require('@electron/asar'),path=require('path');
const archive='out/ZapDMR-win32-x64/resources/app.asar',files=asar.listPackage(archive).map(p=>p.replaceAll('\\','/'));
for(const dir of ['web','dist'])for(const file of fs.readdirSync(dir,{recursive:true}).map(p=>path.join(dir,p)).filter(p=>fs.statSync(p).isFile()))assert(asar.extractFile(archive,file).equals(fs.readFileSync(file)),file+' differs in Windows package');
assert(!files.some(file=>/\.dpapi|\.keystore|\.jks|google-services\.json|\/\.env$|\/work\//.test(file)));
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,require('../../package.json').version);
assert(fs.readFileSync('out/ZapDMR-win32-x64/resources/ZapDMRAudio.exe').equals(fs.readFileSync('native/build/audio-sidecar-vs2022/bin/ZapDMRAudio.exe')));
const data=files.filter(name=>name.replaceAll('\\','/').startsWith('/data/'));assert(data.every(name=>name.endsWith('talkgroups-brasil.json')));
console.log('PASS: final Windows web/dist sources, package version, audio engine and no private configuration files.');
