'use strict';
(function(root){
 function safe(value){
  if(typeof value!=='string'||value.length>250||/[\\\s]/.test(value))return null;
  if(value.startsWith('/#'))value=value.slice(1);
  if(['#home','#time','#time/mapping','#time/settings','#admin/reports','#reporting','#reporting/cogs','#reporting/mapping'].includes(value))return value;
  if(value.startsWith('#reporting/')){const [path,query]=value.split('?');if(!['#reporting/cogs','#reporting/mapping'].includes(path))return null;const p=new URLSearchParams(query);if([...p.keys()].some((k,i,a)=>!['item','start','end'].includes(k)||a.indexOf(k)!==i))return null;if(p.has('item')&&(path!=='#reporting/mapping'||!/^(?:selection:)?[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(p.get('item'))))return null;if(p.has('start')||p.has('end')){const a=p.get('start'),b=p.get('end');if(!a||!b||a>b||[a,b].some(s=>!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s))return null;}return value;}
  if(value.includes('%'))return null;
  const m=value.match(/^#time\?period=(this|last|custom)(?:&start=(\d{4}-\d{2}-\d{2})&end=(\d{4}-\d{2}-\d{2}))?$/);
  if(!m)return null;if(m[1]!=='custom')return m[2]?null:value;
  if(!m[2]||m[2]>m[3]||[m[2],m[3]].some(s=>!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s))return null;
  return value;
 }
 function selection(hash){const valid=safe(hash);return valid?.startsWith('#time?')?Object.fromEntries(new URLSearchParams(valid.split('?')[1])):{period:'this'};}
 const model={safe,selection};if(typeof module!=='undefined')module.exports=model;else root.WahiLinks=model;
})(typeof window==='undefined'?{}:window);
