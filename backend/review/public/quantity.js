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
 const api={format};if(typeof module!=='undefined')module.exports=api;else root.WahiQuantity=api;
})(typeof window==='undefined'?{}:window);
