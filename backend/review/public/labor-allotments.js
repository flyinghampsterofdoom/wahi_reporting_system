'use strict';
(function(root){
 const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 // Inputs are decimal strings, at most 30 characters. Fixed integer units keep
 // reconciliation exact, including fractions smaller than display precision.
 const scale=30,unit=10n**30n;
 function units(value){if(typeof value!=='string'||value.length>30||!/^\d+(\.\d+)?$/.test(value))throw Error('Invalid hours');const [whole,fraction='']=value.split('.');const n=BigInt(whole)*unit+BigInt(fraction.padEnd(scale,'0'));if(n>100000n*unit)throw Error('Invalid hours');return n;}
 function decimal(n){const sign=n<0n?'-':'';if(n<0n)n=-n;const s=n.toString().padStart(scale+1,'0');return sign+s.slice(0,-scale)+(s.slice(-scale).replace(/0+$/,'')?'.'+s.slice(-scale).replace(/0+$/,''):'');}
 function validate(weekly,daily){
  if(!Array.isArray(daily)||daily.length!==7||daily.some(x=>x===null||x===undefined||x===''))return {valid:false,status:'missing',total:null,difference:null};
  try{const total=daily.reduce((sum,x)=>sum+units(x),0n),difference=total-units(weekly);return {valid:difference===0n,status:difference===0n?'valid':'mismatch',total:decimal(total),difference:decimal(difference)};}catch{return {valid:false,status:'invalid',total:null,difference:null};}
 }
 const api={days,validate};if(typeof module!=='undefined')module.exports=api;else root.WahiLaborAllotments=api;
})(typeof window==='undefined'?{}:window);
