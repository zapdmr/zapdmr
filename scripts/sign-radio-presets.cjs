// Local signing key stays under work/ as DPAPI CurrentUser, never in distributable sources.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),keyPath=path.join(root,'work/radio-preset-key.dpapi');
function protect(input,reverse=false){const code=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${reverse?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;const r=spawnSync('powershell.exe',['-NoProfile','-Command',code],{input:input.toString('base64'),encoding:'utf8'});if(r.status!==0)throw Error('Não foi possível acessar a chave protegida.');return Buffer.from(r.stdout.trim(),'base64');}
let key;
if(fs.existsSync(keyPath))key=crypto.createPrivateKey({key:protect(fs.readFileSync(keyPath),true),format:'der',type:'pkcs8'});
else{key=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey;fs.writeFileSync(keyPath,protect(key.export({format:'der',type:'pkcs8'})));}
const publicKey=crypto.createPublicKey(key).export({format:'der',type:'spki'}).toString('base64');
const input=process.argv[2];if(!input)throw Error('Informe o JSON de parâmetros públicos a assinar.');
const catalog=JSON.parse(fs.readFileSync(input,'utf8')),payload=Buffer.from(JSON.stringify(catalog)),signature=crypto.sign('sha256',payload,{key,dsaEncoding:'ieee-p1363'}).toString('base64');
const envelope={keyId:'radio-presets-2026',payload:payload.toString('base64'),signature};
fs.mkdirSync(path.join(root,'site/public/config'),{recursive:true});
fs.writeFileSync(path.join(root,'site/public/config/radio-profiles.json'),JSON.stringify(envelope,null,2)+'\n');
fs.writeFileSync(path.join(root,'web/radio-presets.js'),'/* Public signed defaults. Shared XLX access key is public and operator-authorized. */\nwindow.ZapDMRRadioPresets='+JSON.stringify({publicKey,bundled:envelope})+';\n');
console.log('Catálogo público assinado. Chave privada protegida pelo Windows.');
