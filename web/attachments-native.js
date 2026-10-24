(() => {
  window.ZapDMRAttachments={async save({blob,name,mime}){
    if(!blob||blob.size>15728640)throw new Error('O limite é de 15 MB por arquivo.');
    const cap=window.Capacitor,isAndroid=cap?.getPlatform?.()==='android';
    if(isAndroid||window.ZapDMRDesktop?.saveAttachment){
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Não foi possível preparar o arquivo.'));reader.readAsDataURL(blob);});
      return isAndroid?(cap.Plugins?.ZapAttachments??cap.registerPlugin('ZapAttachments')).save({base64,name,mime}):window.ZapDMRDesktop.saveAttachment({base64,name,mime});
    }
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return {saved:true};
  }};
})();
