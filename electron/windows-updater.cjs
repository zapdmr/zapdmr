const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

const API = 'https://api.github.com/repos/zapdmr/zapdmr/releases?per_page=10';
const MAX_PACKAGE = 512 * 1024 * 1024;
function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}
function compareVersions(a, b) {
  const x=versionParts(a), y=versionParts(b);
  if(!x||!y)throw new Error('Versão de atualização inválida.');
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;
  return 0;
}
function assetInfo(asset, version, name) {
  const expected=`https://github.com/zapdmr/zapdmr/releases/download/v${version}/${name}`;
  if(!asset||asset.state!=='uploaded'||asset.name!==name||asset.browser_download_url!==expected||
    !Number.isSafeInteger(asset.size)||asset.size<1||asset.size>MAX_PACKAGE||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))
    throw new Error('Pacote oficial incompleto ou sem integridade SHA-256.');
  return {name,url:expected,bytes:asset.size,sha256:asset.digest.slice(7)};
}
function selectRelease(releases, current) {
  if(!Array.isArray(releases))throw new Error('Resposta inválida do servidor de atualizações.');
  // The official app is a beta. Explicit vX.Y.Z beta releases share this channel.
  const candidates=releases.filter(r=>!r.draft&&/^v\d+\.\d+\.\d+$/.test(r.tag_name)&&compareVersions(r.tag_name,current)>0)
    .sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
  for(const release of candidates){
    const version=release.tag_name.slice(1), assets=release.assets||[];
    const name=`zapdmr-${version}-full.nupkg`;
    if(!assets.some(a=>a.name===name)||!assets.some(a=>a.name==='RELEASES'))continue;
    return {version,notes:String(release.body||'').slice(0,5000),
      package:assetInfo(assets.find(a=>a.name===name),version,name),
      manifest:assetInfo(assets.find(a=>a.name==='RELEASES'),version,'RELEASES')};
  }
  return null;
}
async function officialFetch(url, options={}) {
  // Redirects remain restricted to GitHub's official release asset infrastructure.
  for(let n=0;n<6;n++){
    const u=new URL(url);
    if(u.protocol!=='https:'||u.username||u.password||u.port||
      !['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))
      throw new Error('Origem de atualização não autorizada.');
    const response=await fetch(u,{...options,redirect:'manual',headers:{'User-Agent':'ZapDMR-Windows-Updater','Accept':u.hostname==='api.github.com'?'application/vnd.github+json':'application/octet-stream'}});
    if([301,302,303,307,308].includes(response.status)){
      const next=response.headers.get('location');await response.body?.cancel();
      if(!next)throw new Error('Redirecionamento de atualização inválido.');url=new URL(next,u).href;continue;
    }
    if(!response.ok)throw new Error(response.status===403||response.status===429?'Limite temporário do GitHub. Tente novamente mais tarde.':'Não foi possível consultar a atualização ('+response.status+').');
    return response;
  }
  throw new Error('Redirecionamentos demais na atualização.');
}
async function smallDownload(asset) {
  if(asset.bytes>65536)throw new Error('Manifesto de atualização acima do limite.');
  const response=await officialFetch(asset.url,{signal:AbortSignal.timeout(30000)}),chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>asset.bytes)throw new Error('Manifesto inválido.');chunks.push(chunk);}
  const data=Buffer.concat(chunks);
  if(bytes!==asset.bytes||createHash('sha256').update(data).digest('hex')!==asset.sha256)throw new Error('Integridade do manifesto não confere.');
  return data;
}
function manifestEntry(data, release) {
  const lines=data.toString('utf8').trim().split(/\r?\n/);
  const entry=lines.map(line=>/^([a-f0-9]{40})\s+([a-zA-Z0-9._-]+)\s+(\d+)$/i.exec(line.trim()))
    .find(m=>m&&m[2]===release.package.name);
  if(!entry||Number(entry[3])!==release.package.bytes)throw new Error('Pacote ausente do manifesto Squirrel.');
  return {sha1:entry[1].toLowerCase(),line:`${entry[1]} ${entry[2]} ${entry[3]}\n`};
}
async function downloadPackage(asset, file, sha1, onProgress) {
  const temporary=file+'.part';await fsp.rm(temporary,{force:true});
  const sha256=createHash('sha256'),legacy=createHash('sha1');let bytes=0,lastPercent=-1;
  const response=await officialFetch(asset.url,{signal:AbortSignal.timeout(15*60*1000)});
  const handle=await fsp.open(temporary,'wx',0o600);
  try{
    for await(const chunk of response.body){
      bytes+=chunk.length;if(bytes>asset.bytes)throw new Error('O pacote excedeu o tamanho publicado.');
      sha256.update(chunk);legacy.update(chunk);await handle.writeFile(chunk);
      const percent=Math.floor(bytes/asset.bytes*100);if(percent!==lastPercent){lastPercent=percent;onProgress(percent);}
    }
    if(bytes!==asset.bytes||sha256.digest('hex')!==asset.sha256||legacy.digest('hex')!==sha1)
      throw new Error('Integridade do pacote não confere. O arquivo foi descartado.');
    await handle.close();await fsp.rename(temporary,file);
  }catch(error){await handle.close().catch(()=>{});await fsp.rm(temporary,{force:true});throw error;}
}

function createWindowsUpdater({app,autoUpdater,userDataDir,radio,onState}) {
  let state={state:'idle',currentVersion:app.getVersion(),message:'Verificação automática ao abrir o ZapDMR.'};
  let busy=false,release=null,feed=null,cacheDir=null,timer=null,disposed=false,stagingTimer=null;
  let installing=false;
  let lastCheckAt=0;
  const installed=()=>process.platform==='win32'&&app.isPackaged&&fs.existsSync(path.resolve(path.dirname(process.execPath),'..','Update.exe'));
  const publish=value=>{state={...state,...value};onState?.({...state});return {...state};};
  async function closeFeed(){if(stagingTimer)clearTimeout(stagingTimer);stagingTimer=null;if(feed){const old=feed;feed=null;old.closeAllConnections?.();await new Promise(r=>old.close(r));}}
  async function stage(entry,file){
    const token=randomBytes(24).toString('hex');
    feed=http.createServer((req,res)=>{
      const pathname=new URL(req.url,'http://127.0.0.1').pathname;
      if(!['GET','HEAD'].includes(req.method)||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||
         ![ `/${token}/RELEASES`, `/${token}/${release.package.name}`].includes(pathname)) {res.writeHead(404);return res.end();}
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/octet-stream');
      if(pathname.endsWith('/RELEASES')){res.setHeader('Content-Length',Buffer.byteLength(entry.line));return res.end(req.method==='HEAD'?undefined:entry.line);}
      res.setHeader('Content-Length',release.package.bytes);
      if(req.method==='HEAD')return res.end();
      const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
    });
    await new Promise((resolve,reject)=>{feed.once('error',reject);feed.listen(0,'127.0.0.1',resolve);});
    autoUpdater.setFeedURL({url:`http://127.0.0.1:${feed.address().port}/${token}`});
    publish({state:'staging',message:'Preparando a atualização verificada. Você pode continuar usando o rádio.'});
    stagingTimer=setTimeout(()=>onError(new Error('O instalador não respondeu. Verifique novamente mais tarde.')),5*60*1000);
    autoUpdater.checkForUpdates();
  }
  async function check(){
    if(disposed||busy||state.state==='ready'||installing)return {...state};
    if(Date.now()-lastCheckAt<60000)return {...state};
    if(!installed())return publish({state:'unsupported',message:'O atualizador funciona na versão instalada pelo instalador do Windows.'});
    busy=true;lastCheckAt=Date.now();publish({state:'checking',message:'Verificando atualizações…',progress:0});
    try{
      const response=await officialFetch(API,{signal:AbortSignal.timeout(20000)});
      // Bound the metadata independently of Content-Length.
      let text='',bytes=0;const decoder=new TextDecoder();for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw new Error('Resposta de atualização acima do limite.');text+=decoder.decode(chunk,{stream:true});}text+=decoder.decode();
      release=selectRelease(JSON.parse(text),app.getVersion());
      if(!release){busy=false;return publish({state:'current',message:'Você já está na versão mais recente disponível para atualização.'});}
      publish({state:'downloading',version:release.version,notes:release.notes,message:'Nova versão '+release.version+' disponível. Baixando em segundo plano…'});
      const entry=manifestEntry(await smallDownload(release.manifest),release);
      cacheDir=path.join(userDataDir,'updates',release.version);await fsp.mkdir(cacheDir,{recursive:true});
      const file=path.join(cacheDir,release.package.name);
      // Revalidate by downloading anew after an interrupted/failed preparation.
      await fsp.rm(file,{force:true});
      await downloadPackage(release.package,file,entry.sha1,progress=>publish({progress}));
      if(disposed)return {...state};
      await stage(entry,file);return {...state};
    }catch(error){onError(error);return {...state};}
  }
  function onError(error){if(disposed)return;busy=false;void closeFeed();publish({state:'error',message:error.message||'Não foi possível atualizar agora. O rádio continua disponível.'});}
  function onDownloaded(){if(disposed||!release)return;busy=false;void closeFeed();publish({state:'ready',version:release.version,progress:100,message:'Atualização pronta. Reinicie quando terminar sua operação de rádio.'});}
  function onNotAvailable(){if(disposed)return;busy=false;void closeFeed();publish({state:'current',message:'Você já está na versão mais recente.'});}
  autoUpdater.on('error',onError);autoUpdater.on('update-downloaded',onDownloaded);autoUpdater.on('update-not-available',onNotAvailable);
  async function install(){
    if(state.state!=='ready'||installing)throw new Error('A atualização ainda não está pronta.');
    if(radio()?.isTransmitting())throw new Error('Encerre a transmissão antes de reiniciar e atualizar.');
    installing=true;
    try{await radio()?.prepareForUpdate();await radio()?.close();await closeFeed();publish({state:'installing',message:'Reiniciando para concluir a atualização…'});autoUpdater.quitAndInstall();return {accepted:true};}
    catch(error){installing=false;publish({state:'ready',message:error.message});throw error;}
  }
  return {check,install,snapshot:()=>({...state}),isInstalling:()=>installing,
    start(){timer=setTimeout(()=>void check(),process.argv.includes('--squirrel-firstrun')?15000:6000);timer.unref?.();},
    async close(){disposed=true;clearTimeout(timer);await closeFeed();autoUpdater.removeListener('error',onError);autoUpdater.removeListener('update-downloaded',onDownloaded);autoUpdater.removeListener('update-not-available',onNotAvailable);}
  };
}
module.exports={createWindowsUpdater,compareVersions,selectRelease,manifestEntry};
