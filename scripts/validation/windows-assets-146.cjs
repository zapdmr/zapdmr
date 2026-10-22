const fs=require('fs'),assert=require('node:assert/strict'),asar=require('@electron/asar'),path=require('path');
const archive='out/ZapDMR-win32-x64/resources/app.asar',files=asar.listPackage(archive);
for(const name of fs.readdirSync('web')){const file=path.join('web',name);if(fs.statSync(file).isFile())assert(asar.extractFile(archive,file.replaceAll('\\','/')).equals(fs.readFileSync(file)),file+' differs in Windows package');}
assert(!files.some(file=>/\.dpapi|\.keystore|\.jks|google-services\.json|\/\.env$|\/work\//.test(file)));
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,'1.4.6');
assert(fs.readFileSync('out/ZapDMR-win32-x64/resources/ZapDMRAudio.exe').equals(fs.readFileSync('native/build/audio-sidecar-vs2022/bin/ZapDMRAudio.exe')));
console.log('PASS: Windows package web assets, version 1.4.6, updated audio engine and no private configuration filenames.');
