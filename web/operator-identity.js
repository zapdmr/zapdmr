(function(root){
 const clean=value=>typeof value==='string'?value.split(/[,;|]/).map(x=>x.trim()).filter(x=>x&&!/^(null|undefined|unknown|n\/a|não informad[ao]|—)$/i.test(x)).join(', '):'';
 const label=(id,record={})=>{const callsign=clean(record.callsign),name=clean(record.firstName||record.name);return callsign?[callsign,name].filter(Boolean).join(' · '):'DMR ID '+id;};
 const api={clean,label};if(typeof module==='object'&&module.exports)module.exports=api;else root.ZapDMROperatorIdentity=api;
})(typeof window==='object'?window:globalThis);
