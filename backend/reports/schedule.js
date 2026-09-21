'use strict';
const {addDays}=require('../labor/model');
const formats=new Map(),cache=new Map();
function local(now,zone){
 if(!formats.has(zone))formats.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
 const p=Object.fromEntries(formats.get(zone).formatToParts(now).map(p=>[p.type,p.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
// First wall-clock match wins on fall-back; a nonexistent spring time moves to
// the first valid minute after the gap. No repeated local date occurrence.
function scheduledInstant(day,time,zone){
 const key=[day,time,zone].join('|');if(cache.has(key))return cache.get(key);
 const noon=Date.parse(day+'T12:00:00Z');let result=null;
 for(let t=noon-26*3600000;t<=noon+26*3600000;t+=60000){const p=local(t,zone);if(p.date===day&&p.time>=time){result=t;break;}}
 if(cache.size>1000)cache.clear();cache.set(key,result);return result;
}
function due(report,now){
 if(!report.enabled||!report.send_time)return [];
 const today=local(now,report.timezone).date;
 return [addDays(today,-1),today].flatMap(day=>{
  if(report.id==='weekly'&&new Date(day+'T12:00:00Z').getUTCDay()!==report.weekday)return [];
  const at=scheduledInstant(day,report.send_time,report.timezone);
  return at!==null&&at<=now&&at>now-86400000&&at>=new Date(report.updated_at).getTime()?[{key:'scheduled:'+day,at}]:[];
 });
}
module.exports={local,scheduledInstant,due};
