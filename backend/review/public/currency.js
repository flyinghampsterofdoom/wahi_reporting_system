'use strict';
(function(root){
 function decimal(value,places=2){
  if(value===null||value===undefined)return 'Unresolved';
  const m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));if(!m)return 'Invalid amount';
  const fraction=m[3]||'',factor=10n**BigInt(places);
  let n=BigInt(m[2])*factor+BigInt((fraction+'0'.repeat(places)).slice(0,places)||'0');
  if((fraction[places]||'0')>='5')n++;
  const digits=n.toString().padStart(places+1,'0');return (m[1]&&n?'-':'')+digits.slice(0,-places)+'.'+digits.slice(-places);
 }
 function rate(value){if(value===null||value===undefined)return 'Unresolved';const s=String(value);const frac=s.split('.')[1]||'';const first=frac.search(/[1-9]/);return decimal(value,Math.max(4,Math.min(12,first+3)));}
 const monetary=new Set(['amount','completeCost','knownSubtotal','materialSubtotal','laborSubtotal','internalCost','totalCost','unitCost','costVariance']);
 function history(value){if(Array.isArray(value))return value.map(history);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,monetary.has(k)&&typeof v==='string'&&(k!=='amount'||typeof value.currency==='string')?decimal(v):history(v)]));return value;}
 const api={decimal,rate,history,dollars:v=>'$'+decimal(v)};if(typeof module!=='undefined')module.exports=api;else root.WahiCurrency=api;
})(typeof window==='undefined'?{}:window);
