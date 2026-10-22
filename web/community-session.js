/* One refresh flight per device. Network/OTP errors never erase a valid account. */
(() => {
  window.createCommunitySession=({getConfig,save,endpoint,onRevoked,fetcher=fetch})=>{
    let flight=null,revision=0;
    const fields=['token','refreshToken','deviceId','accessExpiresAt','refreshExpiresAt'];
    function assign(value){const c=getConfig();for(const key of fields)if(value[key]!==undefined)c[key]=value[key];if(value.user)c.account=value.user;}
    async function request(route,body,method,signal){
      const timeout=AbortSignal.timeout(15000),combined=signal?AbortSignal.any([signal,timeout]):timeout,c=getConfig();
      const response=await fetcher(endpoint()+route,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(window.ZapDMRUpdater?.headers?.()||{}),...(c.token?{Authorization:'Bearer '+c.token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:combined});
      let data;try{data=await response.json();}catch{throw new Error('Resposta inválida do servidor da comunidade.');}
      if(!response.ok){if(data.code==='APP_UPDATE_REQUIRED')window.dispatchEvent(new Event('zapdmr:update-required'));const error=new Error(data.message||'A comunidade não respondeu.');Object.assign(error,{status:response.status,code:data.code,retryAfterSeconds:Math.max(0,Number(data.retryAfterSeconds||response.headers.get('Retry-After'))||0)});throw error;}return data;
    }
    async function renew(){if(flight)return flight;const c=getConfig(),version=revision,identity=c.account?.id,credential=c.refreshToken||c.token;if(!credential)return;
      flight=(async()=>{try{const value=await request(c.refreshToken?'/v1/auth/refresh':'/v1/auth/session',c.refreshToken?{refreshToken:c.refreshToken}:{});if(version!==revision||identity!==getConfig().account?.id)return;assign(value);await save();}
        catch(error){if(version===revision&&error.status===401&&/^SESSION_(REVOKED|EXPIRED|INVALID)$/.test(error.code||'')){clear();await save();onRevoked?.();}throw error;}
      })().finally(()=>{flight=null;});return flight;
    }
    async function remote(route,body,method,signal){const auth=!route.startsWith('/v1/auth/')&&!route.startsWith('/v1/registrations');const c=getConfig();if(auth&&c.refreshToken&&Number(c.accessExpiresAt)<Date.now()+60000)await renew();
      try{return await request(route,body,method,signal);}catch(error){if(auth&&error.status===401&&getConfig().token){await renew();return request(route,body,method,signal);}throw error;}}
    function clear(){revision++;for(const key of fields)delete getConfig()[key];getConfig().account=null;}
    async function logout(){await request('/v1/auth/logout',{refreshToken:getConfig().refreshToken||''});clear();await save();}
    async function fetchPrivate(path,options={}){const c=getConfig();if(c.refreshToken&&Number(c.accessExpiresAt)<Date.now()+60000)await renew();const send=()=>fetcher(endpoint()+path,{...options,headers:{...options.headers,...(getConfig().token?{Authorization:'Bearer '+getConfig().token}:{})}});let response=await send();if(response.status===401&&getConfig().token){await renew();response=await send();}return response;}
    return{remote,renew,clear,assign,logout,fetchPrivate};
  };
})();
