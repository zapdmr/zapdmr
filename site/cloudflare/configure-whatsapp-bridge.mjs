// Provision only the private relay token. Existing database/encryption keys are untouched.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const configPath=path.resolve(here,'../../work/whatsapp-bridge/config.dpapi');
const expected={origin:'https://www.zapdmr.com.br',number:'+5543996741200'};
function invoke(executable,args,input,env=process.env){return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,env,stdio:['pipe','pipe','pipe']}),parts=[];
  child.stdout.on('data',part=>parts.push(part));child.stderr.on('data',()=>{});
  child.on('error',()=>reject(new Error('Não foi possível iniciar a configuração protegida.')));
  child.on('close',code=>code===0?resolve(Buffer.concat(parts)):reject(new Error('A configuração protegida não foi concluída. Nenhum segredo foi exibido.')));
  child.stdin.on('error',()=>{});child.stdin.end(input);
});}
async function dpapi(mode,input){
  const script=(await fs.readFile(path.resolve(here,'../whatsapp-bridge/dpapi.ps1'),'utf8')).replace(/^param\([^\r\n]*\)\r?\n/,'');
  const encoded=Buffer.from(`$Mode='${mode}'\n${script}`,'utf16le').toString('base64');
  const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  return invoke(ps,['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',encoded],input);
}
async function main(){
  if(process.platform!=='win32')throw new Error('Este provisionamento usa DPAPI CurrentUser no Windows.');
  let config,plain;
  try{const stored=await fs.readFile(configPath);plain=await dpapi('Unprotect',Buffer.from(stored.toString('base64')));config=JSON.parse(plain.toString('utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;config={version:1,...expected,token:crypto.randomBytes(48).toString('base64url')};
    const encrypted=await dpapi('Protect',Buffer.from(JSON.stringify(config),'utf8'));
    await fs.mkdir(path.dirname(configPath),{recursive:true});await fs.writeFile(configPath,Buffer.from(encrypted.toString('ascii'),'base64'),{flag:'wx',mode:0o600});encrypted.fill(0);
  }finally{plain?.fill(0);}
  if(config.version!==1||config.origin!==expected.origin||config.number!==expected.number||!/^[A-Za-z0-9_-]{64}$/.test(config.token||''))throw new Error('A configuração existente não corresponde ao WhatsApp autorizado.');
  const input=Buffer.from(JSON.stringify({WHATSAPP_WEBHOOK_TOKEN:config.token})+'\n');let output;
  try{output=await invoke(process.execPath,[path.join(here,'node_modules/wrangler/bin/wrangler.js'),'secret','bulk','--name','zapdmr-community'],input,{...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG:'error',WRANGLER_SEND_METRICS:'false',CI:'true'});}
  finally{input.fill(0);output?.fill(0);config.token='';}
  console.log('Token da ponte configurado no Worker e protegido com DPAPI CurrentUser.');
  console.log('Configuração local: '+configPath);
  console.log('WhatsApp autorizado: '+expected.number);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
