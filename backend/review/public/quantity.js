'use strict';
(function(root){
 // Presentation only. Keep source decimals, accounting and CSV values exact.
 // Snap only residue within 10^-12 of a NONZERO integer; never erase tiny sales.
 function format(value){
  if(value===null||value===undefined)return '—';
  const s=String(value),m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(s);if(!m)return s;
  const fraction=m[3]||'',scale=10n**BigInt(fraction.length),whole=BigInt(m[2]),part=BigInt(fraction||'0');
  let integer=null;
  if(whole>0n&&part*1000000000000n<=scale)integer=whole;
  else if(part>0n&&(scale-part)*1000000000000n<=scale)integer=whole+1n;
  if(integer!==null)return (m[1]&&integer?'-':'')+integer.toString();
  const tail=fraction.replace(/0+$/,'');return (m[1]&&(whole||part)?'-':'')+whole.toString()+(tail?'.'+tail:'');
 }
 // Recipe display is separate from accounting formatting. Never write these values back.
 function service(value){
  if(value===null||value===undefined||value==='')return {text:'Review quantity',valid:false,approximate:false};
  const raw=String(value).trim();let decimal=raw,approximate=false;
  const glyphs={'¼':[1,4],'½':[1,2],'¾':[3,4],'⅓':[1,3],'⅔':[2,3],'⅛':[1,8],'⅜':[3,8],'⅝':[5,8],'⅞':[7,8]};
  const g=/^(\d*)\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/.exec(raw),f=/^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(raw);
  if(g||f){const whole=BigInt((g?g[1]:f[1])||'0'),numerator=BigInt(g?glyphs[g[2]][0]:f[2]),denominator=BigInt(g?glyphs[g[2]][1]:f[3]);
   if(!denominator)return {text:'Review quantity',valid:false,approximate:false};
   let n=whole*denominator+numerator,q=n/denominator,remainder=n%denominator,tail='';
   while(remainder&&tail.length<24){remainder*=10n;tail+=(remainder/denominator).toString();remainder%=denominator;}
   approximate=!!remainder;if(approximate)tail=tail.slice(0,12);if(n>0n&&q===0n&&!/[1-9]/.test(tail))return {text:'Review quantity',valid:false,approximate:false};decimal=q.toString()+(tail?'.'+tail:'');
  }
  const m=/^(\d{1,12})(?:\.(\d{1,24}))?$/.exec(decimal);
  if(!m)return {text:'Review quantity',valid:false,approximate:false};
  let whole=BigInt(m[1]),tail=(m[2]||'').replace(/0+$/,'');
  // A long zero/nine tail is ambiguous, not permission to change saved instructions.
  // Show an explicitly marked approximation and keep the exact value in diagnostics.
  const residue=/(?:0{8,}[1-9]\d{0,2}|9{8,}\d{0,3})$/.exec(tail);
  if(residue){const keep=tail.slice(0,residue.index),scale=10n**BigInt(keep.length);let n=whole*scale+BigInt(keep||'0');if(residue[0][0]==='9')n++;
   if(n){const digits=n.toString().padStart(keep.length+1,'0');whole=n/scale;tail=keep.length?digits.slice(-keep.length).replace(/0+$/,''):'';approximate=true;}}
  return {text:whole.toString()+(tail?'.'+tail:''),valid:true,approximate};
 }
 const api={format,service};if(typeof module!=='undefined')module.exports=api;else root.WahiQuantity=api;
})(typeof window==='undefined'?{}:window);
