'use strict';
(function(root){
 const add=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
 function range(mode,today){const week=add(today,-new Date(today+'T12:00Z').getUTCDay()),month=today.slice(0,8)+'01';if(mode==='today')return {start:today,end:today};if(mode==='yesterday')return {start:add(today,-1),end:add(today,-1)};if(mode==='week')return {start:week,end:today};if(mode==='last-week')return {start:add(week,-7),end:add(week,-1)};if(mode==='last-month'){const end=add(month,-1);return {start:end.slice(0,8)+'01',end};}return {start:month,end:today};}
 const model={range};if(typeof module!=='undefined')module.exports=model;else root.WahiCogs=model;
})(typeof window==='undefined'?{}:window);
