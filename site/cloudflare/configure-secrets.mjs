// GPL-3.0-only. Windows operator helper; run manually after Wrangler login.
// Secrets travel only through process pipes, DPAPI ciphertext, and Wrangler's
// authenticated secret API. They are never printed or passed as CLI arguments.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const directory=path.dirname(fileURLToPath(import.meta.url));
const workerName='zapdmr-community';
const backupPath=path.resolve(directory,'../../work/zapdmr-cloudflare-secrets.dpapi');
const options=new Set(process.argv.slice(2));

function safeError(message){return new Error(message);}
function validSecrets(value){return value?.version===1&&value.workerName===workerName&&/^[a-f\d]{64}$/i.test(value.secrets?.DATA_ENCRYPTION_KEY||'')&&/^[a-f\d]{64}$/i.test(value.secrets?.DOWNLOAD_SECRET||'')&&value.secrets.DATA_ENCRYPTION_KEY.toLowerCase()!==value.secrets.DOWNLOAD_SECRET.toLowerCase()&&typeof value.secrets.ADMIN_PASSWORD==='string'&&value.secrets.ADMIN_PASSWORD.length>=24;}
function invoke(executable,args,input,environment=process.env){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd:directory,env:environment,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    const chunks=[];let length=0,failed=false;
    const fail=()=>{if(failed)return;failed=true;for(const chunk of chunks)chunk.fill(0);child.kill();reject(safeError('A operação protegida não foi concluída. Nenhum segredo será exibido.'));};
    child.on('error',fail);child.stdin.on('error',fail);
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>1048576)return fail();chunks.push(chunk);});
    // Deliberately drain diagnostics without persisting or forwarding them.
    child.stderr.on('data',()=>{});
    child.on('close',code=>{if(failed)return;if(code!==0)return fail();const result=Buffer.concat(chunks,length);for(const chunk of chunks)chunk.fill(0);resolve(result);});
    child.stdin.end(input);
  });
}
function dpapiScript(mode){
  const operation=mode==='protect'
    ? "$inputBytes=[System.Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); $outputBytes=[System.Security.Cryptography.ProtectedData]::Protect($inputBytes,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($outputBytes))"
    : "$inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $outputBytes=[System.Security.Cryptography.ProtectedData]::Unprotect($inputBytes,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($outputBytes))";
  return "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $inputBytes=$null; $outputBytes=$null; try { Add-Type -AssemblyName System.Security; $entropy=[System.Text.Encoding]::UTF8.GetBytes('ZapDMR.Cloudflare.Secrets.v1'); "+operation+" } catch { [Console]::Error.Write('DPAPI_OPERATION_FAILED'); exit 1 } finally { if($null -ne $inputBytes){[Array]::Clear($inputBytes,0,$inputBytes.Length)}; if($null -ne $outputBytes){[Array]::Clear($outputBytes,0,$outputBytes.Length)} }";
}
async function dpapi(mode,input){
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const encoded=Buffer.from(dpapiScript(mode),'utf16le').toString('base64');
  try{return await invoke(executable,['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',encoded],input);}
  finally{input.fill(0);}
}
async function loadBackup(){
  let protectedBytes;try{protectedBytes=await fs.readFile(backupPath);}catch(error){if(error.code==='ENOENT')return null;throw safeError('Não foi possível ler o backup cifrado. Verifique o acesso ao ficheiro.');}
  let plain;
  try{plain=await dpapi('unprotect',Buffer.from(protectedBytes.toString('base64'),'ascii'));const value=JSON.parse(plain.toString('utf8'));if(!validSecrets(value))throw new Error('Invalid backup');return value;}
  catch{throw safeError('O backup existente não pôde ser aberto por este utilizador Windows. Restaure o backup correto; as chaves não serão substituídas.');}
  finally{plain?.fill(0);protectedBytes.fill(0);}
}
async function prepareBackup(){
  const existing=await loadBackup();if(existing)return {value:existing,reused:true};
  const value={version:1,workerName,createdAt:new Date().toISOString(),secrets:{DATA_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),DOWNLOAD_SECRET:crypto.randomBytes(32).toString('hex'),ADMIN_PASSWORD:crypto.randomBytes(32).toString('base64url')}};
  // No network action is attempted until the encrypted backup has been saved.
  if(!validSecrets(value))throw safeError('Não foi possível preparar segredos válidos.');
  const encoded=await dpapi('protect',Buffer.from(JSON.stringify(value),'utf8'));
  const encrypted=Buffer.from(encoded.toString('ascii'),'base64');encoded.fill(0);
  if(!encrypted.length)throw safeError('O Windows não devolveu um backup cifrado válido.');
  await fs.mkdir(path.dirname(backupPath),{recursive:true});
  let handle;
  try{
    // Exclusive creation avoids silently replacing another operator's keys.
    handle=await fs.open(backupPath,'wx',0o600);await handle.writeFile(encrypted);await handle.sync();
  }catch(error){
    if(error.code==='EEXIST'){const winner=await loadBackup();if(winner)return {value:winner,reused:true};}
    throw safeError('Não foi possível guardar o backup cifrado. Nenhum segredo foi enviado; o backup existente não será substituído.');
  }finally{await handle?.close();encrypted.fill(0);}
  // Re-read and decrypt to verify the saved copy before allowing any upload.
  const saved=await loadBackup();if(!saved)throw safeError('O backup cifrado não pôde ser confirmado.');
  return {value:saved,reused:false};
}
async function main(){
  if(options.has('--help')){
    console.log('Uso: node configure-secrets.mjs [--backup-only]');
    console.log('Guarda ou reutiliza backup DPAPI do utilizador Windows; sem --backup-only envia as três chaves ao Worker zapdmr-community via Wrangler.');
    console.log('A senha administrativa nunca é impressa. /admin utiliza o nome admin; a recuperação da senha exige futura abertura protegida deste backup.');
    return;
  }
  if([...options].some(option=>option!=='--backup-only'))throw safeError('Opção desconhecida. Consulte --help.');
  if(process.platform!=='win32')throw safeError('Este helper exige Windows e DPAPI CurrentUser.');
  const {value,reused}=await prepareBackup();
  console.log(reused?'Backup DPAPI existente reutilizado; as chaves foram preservadas.':'Backup DPAPI criado e confirmado.');
  console.log('Backup cifrado: '+backupPath);
  console.log('Guarde uma cópia protegida e preserve o perfil Windows atual: DPAPI CurrentUser não é um backup portátil para outro utilizador ou computador.');
  if(options.has('--backup-only')){console.log('Preparação local concluída. Nenhum segredo foi enviado à Cloudflare.');return;}
  const wrangler=path.join(directory,'node_modules/wrangler/bin/wrangler.js');
  try{await fs.access(wrangler);}catch{throw safeError('Instale as dependências locais do projeto antes de enviar os segredos. O backup cifrado foi preservado.');}
  const input=Buffer.from(JSON.stringify(value.secrets)+'\n','utf8');let output;
  try{
    output=await invoke(process.execPath,[wrangler,'secret','bulk','--name',workerName],input,{...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG:'error',WRANGLER_SEND_METRICS:'false',CI:'true'});
  }catch{throw safeError('O Wrangler não confirmou o envio. Verifique a autenticação e o acesso ao Worker, e execute novamente este helper para reutilizar o mesmo backup. Nenhuma senha foi exibida.');}
  finally{input.fill(0);output?.fill(0);}
  console.log('Wrangler confirmou o envio das três chaves ao Worker '+workerName+'.');
  console.log('Administração: /admin, utilizador admin. A senha permanece apenas no backup DPAPI e no secret Cloudflare; não foi exibida.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
