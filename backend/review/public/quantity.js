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
 // Recipe-only presentation; never write display values back to a saved document.
 // Reviewed lexemes: owner-provided examples and preserved workbook residue observed
 // during the October 16 investigation. This is not a general rounding/epsilon rule.
 const recipeArtifacts=Object.freeze({
  '0.5000000000000001':'0.5','1.5000000000000002':'1.5',
  '0.012500000000000001':'0.0125','0.13400000000000001':'0.134',
  '0.018749999999999999':'0.01875','0.0062500000000000003':'0.00625'
 });
 function service(value){
  const result=(text,valid=true,requiresReview=false)=>({text,valid,requiresReview});
  if(value===null||value===undefined||value==='')return result('Review quantity',false);
  const raw=String(value).trim();let decimal=raw;
  const glyphs={'¼':[1,4],'½':[1,2],'¾':[3,4],'⅓':[1,3],'⅔':[2,3],'⅛':[1,8],'⅜':[3,8],'⅝':[5,8],'⅞':[7,8]};
  const g=/^(\d*)\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/.exec(raw),f=/^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(raw);
  if(g||f){const whole=BigInt((g?g[1]:f[1])||'0'),numerator=BigInt(g?glyphs[g[2]][0]:f[2]),denominator=BigInt(g?glyphs[g[2]][1]:f[3]);
   if(!denominator)return result('Review quantity',false);
   let q=whole+numerator/denominator,remainder=numerator%denominator,tail='';
   while(remainder&&tail.length<24){remainder*=10n;tail+=(remainder/denominator).toString();remainder%=denominator;}
   if(remainder)return result('Review quantity',true,true);
   decimal=q.toString()+(tail?'.'+tail:'');
  }
  const m=/^(\d{1,12})(?:\.(\d{1,24}))?$/.exec(decimal);
  if(!m)return result('Review quantity',false);
  const whole=BigInt(m[1]),tail=(m[2]||'').replace(/0+$/,'');
  const canonical=whole.toString()+(tail?'.'+tail:'');
  if(Object.hasOwn(recipeArtifacts,canonical))return result(recipeArtifacts[canonical]);
  // Unrecognized residue-like measurements are NOT rounded. A genuinely tiny
  // nonzero quantity remains exact rather than being mistaken for zero residue.
  const residue=/(?:0{8,}[1-9]\d{0,2}|9{8,}\d{0,3})$/.exec(tail);
  if(residue&&(whole>0n||/[1-9]/.test(tail.slice(0,residue.index))||residue[0][0]==='9'))return result('Review quantity',true,true);
  return result(canonical);
 }
 const api={format,service};if(typeof module!=='undefined')module.exports=api;else root.WahiQuantity=api;
})(typeof window==='undefined'?{}:window);
