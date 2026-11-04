const fs=require('node:fs'),assert=require('node:assert/strict'),asar=require('@electron/asar'),path=require('node:path');
const archive='out/ZapDMRHomePreview-win32-x64/resources/app.asar',files=asar.listPackage(archive).map(value=>value.replaceAll('\\','/'));
for(const dir of ['web','dist'])for(const file of fs.readdirSync(dir,{recursive:true}).map(value=>path.join(dir,value)).filter(value=>fs.statSync(value).isFile()))assert(asar.extractFile(archive,file).equals(fs.readFileSync(file)),file+' differs');
assert(!files.some(file=>file.includes('.dpapi')||file.includes('.keystore')||file.includes('.jks')||file.includes('google-services.json')||file.endsWith('/.env')||file.includes('/work/')));
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,'2.0.0');
assert(fs.readFileSync('out/ZapDMRHomePreview-win32-x64/resources/ZapDMRAudio.exe').equals(fs.readFileSync('native/build/audio-sidecar-vs2022/bin/ZapDMRAudio.exe')));
console.log('PASS Windows package: exact web/dist, version 2.0.0, audio helper and no private configuration.');
