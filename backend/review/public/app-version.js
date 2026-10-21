'use strict';
(function(root){
 // A data refresh cannot replace JavaScript already executing in an open tab.
 function monitor({version,request,mayReload,reload,notice,clearNotice=()=>{}}){
  let pending=null,stopped=false;
  async function check(){
   if(stopped)return;if(pending)return pending;
   pending=(async()=>{try{const response=await request();if(!response.ok)return;const next=await response.json();if(!/^[a-f0-9]{64}$/.test(next.version))return;if(next.version===version){clearNotice();return;}
    if(mayReload(next.version)){stopped=true;reload(next.version);}else notice();
   }catch{/* Offline clients retain their existing authenticated offline copy. */}finally{pending=null;}})();return pending;
  }
  return {check,stop(){stopped=true;}};
 }
 function start(){
  const version=document.querySelector('meta[name="wahi-app-version"]')?.content;if(!version)return;
  const reloadKey='wahi-app-version-reload';try{if(sessionStorage.getItem(reloadKey)===version)sessionStorage.removeItem(reloadKey);}catch{}
  const dirty=()=>typeof builderState!=='undefined'&&!!builderState?.dirty;
  const mayReload=next=>{if(location.hash.split('?')[0]!=='#recipe-book'||typeof recipeBookState==='undefined'||!recipeBookState?.active||dirty())return false;try{return sessionStorage.getItem(reloadKey)!==next;}catch{return false;}};
  const notice=()=>{let box=document.getElementById('app-update-notice');if(!box){box=document.createElement('aside');box.id='app-update-notice';box.className='app-update-notice';box.setAttribute('role','status');const text=document.createElement('span'),button=document.createElement('button');button.type='button';button.textContent='Reload updated application';button.onclick=()=>{if(!dirty())location.reload();};box.append(text,button);document.body.append(box);}box.querySelector('span').textContent=dirty()?'An application update is ready. Save your draft before reloading.':'An application update is ready.';box.querySelector('button').disabled=dirty();};
  const current=monitor({version,request:()=>fetch('/app-version',{cache:'no-store'}),mayReload,reload:next=>{try{sessionStorage.setItem(reloadKey,next);location.reload();}catch{notice();}},notice,clearNotice:()=>document.getElementById('app-update-notice')?.remove()});
  const check=()=>{if(navigator.onLine&&document.visibilityState!=='hidden')current.check();};
  document.addEventListener('visibilitychange',check);window.addEventListener('focus',check);window.addEventListener('online',check);window.addEventListener('hashchange',check);
  document.addEventListener('click',e=>{if(e.target.closest?.('#recipe-refresh'))check();});
  root.WahiAppVersion.current=current;setInterval(check,30000);check();return current;
 }
 const api={monitor,start};if(typeof module!=='undefined')module.exports=api;else{root.WahiAppVersion=api;window.addEventListener('DOMContentLoaded',start,{once:true});}
})(typeof window==='undefined'?{}:window);
