'use strict';
// Only Reviews pages supply a holder. Never insert connection UI into the shell.
const reviewConnectionRequests=new WeakMap();
async function renderReviewConnectionNotice(holder,{user,readStatus,isActive=()=>true}){
 if(!holder)return;
 const request={};reviewConnectionRequests.set(holder,request);
 const current=()=>holder.isConnected&&document.getElementById(holder.id)===holder&&reviewConnectionRequests.get(holder)===request&&isActive(user);
 if(user?.role!=='ADMIN'||!user.googleConnection){holder.replaceChildren();holder.hidden=true;return;}
 try{
  const status=await readStatus();
  if(!current())return;
  holder.replaceChildren();holder.hidden=!status.notification;
  if(!status.notification)return;
  const warning=document.createElement('p');warning.className='warning';warning.setAttribute('role','alert');warning.append(document.createTextNode(status.notification+' '));
  const reconnect=document.createElement('a');reconnect.href='/#admin/google';reconnect.textContent='Open Google connection';warning.append(reconnect);holder.append(warning);
 }catch{ /* A failed status read does not change authorization or invent a disconnection. */ }
}
