'use strict';
(function(root){
 const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 // Inputs are decimal strings, at most 30 characters. Fixed integer units keep
 // weekly totals exact, including fractions smaller than display precision.
 const scale=30,unit=10n**30n;
 function units(value){if(typeof value!=='string'||value.length>30||!/^\d+(\.\d+)?$/.test(value))throw Error('Invalid hours');const [whole,fraction='']=value.split('.');const n=BigInt(whole)*unit+BigInt(fraction.padEnd(scale,'0'));if(n>100000n*unit)throw Error('Invalid hours');return n;}
 function decimal(n){const sign=n<0n?'-':'';if(n<0n)n=-n;const s=n.toString().padStart(scale+1,'0');return sign+s.slice(0,-scale)+(s.slice(-scale).replace(/0+$/,'')?'.'+s.slice(-scale).replace(/0+$/,''):'');}
 function validate(daily){
  if(!Array.isArray(daily)||daily.length!==7||Array.from(daily).some(x=>x===null||x===undefined||x===''))return {valid:false,status:'missing',total:null};
  try{const total=daily.reduce((sum,x)=>sum+units(x),0n);return {valid:true,status:'valid',total:decimal(total)};}catch{return {valid:false,status:'invalid',total:null};}
 }
 const api={days,validate};if(typeof module!=='undefined')module.exports=api;else root.WahiLaborAllotments=api;
})(typeof window==='undefined'?{}:window);
