'use strict';
(function(root){
 const MAX=43200000,DB='wahi-published-recipes-v1',SIGNED_OUT='wahi.recipe.signedOut',ACTIVE='wahi.recipe.account';let epoch=0,channel;
 const identity=u=>({id:u.id,username:u.username,role:u.role,capabilities:['recipes.view'],environment:u.environment,hosted:u.hosted,demo:u.demo,offline:true});
 // Server issuance and browser receipt use different clocks. Move bounds only earlier:
 // never extend the absolute expiry, remaining session lifetime, or twelve-hour cap.
 function receivedLease(lease,now=Date.now()){
  const refreshed=Date.parse(lease?.refreshedAt),expires=Date.parse(lease?.expiresAt);
  if(!Number.isFinite(now)||!Number.isFinite(refreshed)||!Number.isFinite(expires)||expires<=refreshed)throw Error('Invalid offline lease');
  return {...lease,refreshedAt:new Date(Math.min(refreshed,now)).toISOString(),expiresAt:new Date(Math.min(expires,now+expires-refreshed,now+MAX)).toISOString()};
 }
 function valid(r,now=Date.now()){return !!r&&r.lease&&r.user?.id&&r.lease.scope===r.scope&&Number.isFinite(Date.parse(r.lease.expiresAt))&&now>=Date.parse(r.lease.refreshedAt)&&now>=r.lastSeenAt&&now<Math.min(Date.parse(r.lease.expiresAt),Date.parse(r.lease.refreshedAt)+MAX);}
 function open(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>q.result.createObjectStore('records');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
 async function operation(mode,fn){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('records',mode),store=tx.objectStore('records');let result;fn(store,v=>{result=v;});tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
 async function raw(){return operation('readonly',(s,done)=>{const q=s.get('active');q.onsuccess=()=>done(q.result);});}
 async function clear({broadcast=true}={}){epoch++;await operation('readwrite',s=>s.clear());if(broadcast&&channel)channel.postMessage('clear');}
 async function load(user){const token=epoch,r=await raw();if(!r)return null;if(localStorage.getItem(SIGNED_OUT)||localStorage.getItem(ACTIVE)!==JSON.stringify([r.user.id,r.user.environment])||!valid(r)||user&&(r.user.id!==user.id||r.user.environment!==user.environment)){await clear({broadcast:false});return null;}
  r.lastSeenAt=Date.now();await operation('readwrite',s=>{if(token===epoch&&!localStorage.getItem(SIGNED_OUT))s.put(r,'active');});if(token!==epoch||localStorage.getItem(SIGNED_OUT))return null;return r;
 }
 async function save(user,lease,rows,images={},token=epoch){if(localStorage.getItem(SIGNED_OUT)||!lease||Date.now()>=Date.parse(lease.expiresAt))return false;
  const allowed=new Set(rows.filter(r=>r.photoAvailable!==false).map(r=>r.document.photoId).filter(Boolean));const filtered=Object.fromEntries(Object.entries(images).filter(([id,b])=>allowed.has(id)&&b instanceof Blob));
  const record={scope:lease.scope,lease,user:identity(user),rows,images:filtered,lastSeenAt:Date.now()};
  if(!valid(record)||token!==epoch)return false;return !!await operation('readwrite',(s,done)=>{if(token===epoch&&!localStorage.getItem(SIGNED_OUT)){const q=s.put(record,'active');q.onsuccess=()=>done(true);}});
 }
 async function observe(user){localStorage.setItem(ACTIVE,JSON.stringify([user.id,user.environment]));if(!user.capabilities.includes('recipes.view')){await clear();return;}const r=await raw();if(r&&(r.user.id!==user.id||r.user.environment!==user.environment))await clear();}
 async function login(){localStorage.setItem(SIGNED_OUT,'login');localStorage.removeItem(ACTIVE);await clear().catch(()=>{});}
 function pendingLogout(){return localStorage.getItem(SIGNED_OUT)==='1';}
 function failedLogin(){localStorage.setItem(SIGNED_OUT,'1');}
 function authenticated(){localStorage.removeItem(SIGNED_OUT);}
 async function logout(){localStorage.setItem(SIGNED_OUT,'1');localStorage.removeItem(ACTIVE);await clear().catch(()=>{});}
 function signedOut(){return !!localStorage.getItem(SIGNED_OUT);}
 async function restore(){if(signedOut())return null;const r=await load();return r?identity(r.user):null;}
 function invalidated(){root.dispatchEvent(new Event('recipe-cache-cleared'));}
 if(typeof window!=='undefined'&&'BroadcastChannel'in window){channel=new BroadcastChannel('wahi-recipe-session');channel.onmessage=()=>{epoch++;invalidated();};window.addEventListener('storage',e=>{if(e.key===SIGNED_OUT){epoch++;invalidated();}});}
 const api={stamp:()=>epoch,receivedLease,valid,identity,load,save,clear,observe,login,pendingLogout,failedLogin,authenticated,logout,signedOut,restore};if(typeof module!=='undefined')module.exports=api;else root.WahiRecipeOffline=api;
})(typeof window==='undefined'?{}:window);
