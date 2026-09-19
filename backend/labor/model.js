'use strict';
const {Exact}=require('../domain/exact');
const fail=code=>Object.assign(new Error(code),{code});
function date(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw fail('invalid_labor_date');return s;}
const addDays=(s,n)=>new Date(Date.parse(date(s))+n*86400000).toISOString().slice(0,10);
function businessDate(now,timezone,cutoff){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));const d=`${parts.year}-${parts.month}-${parts.day}`;return Number(parts.hour)<cutoff?addDays(d,-1):d;}
function weekFor(day){return addDays(date(day),-new Date(day+'T12:00:00Z').getUTCDay());}
function weekEnd(start){return addDays(start,6);}
function periodFor(today,selection={}){
 if(typeof selection==='string')selection={date:selection};
 if(selection===null)selection={};
 const allowed=['period','start','end','date'];if(Object.keys(selection).some(k=>!allowed.includes(k)))throw fail('invalid_labor_range');
 if(selection.date){if(selection.period||selection.start||selection.end)throw fail('invalid_labor_range');const start=weekFor(date(selection.date));return {start,end:weekEnd(start),period:'custom',weekly:true};}
 const mode=selection.period||'this';if(!['this','last','custom'].includes(mode))throw fail('invalid_labor_range');
 let start,end;if(mode==='custom'){start=date(selection.start);end=date(selection.end);if(end<start)throw fail('invalid_labor_range');}else{if(selection.start||selection.end)throw fail('invalid_labor_range');if(!today)return null;start=addDays(weekFor(today),mode==='last'?-7:0);end=weekEnd(start);}
 return {start,end,period:mode,weekly:weekFor(start)===start&&weekEnd(start)===end};
}
function amount(s){const x=Exact.of(s);if(!x.nonnegative())throw fail('invalid_labor_hours');return x;}
const instant=s=>{const n=Date.parse(s);if(!Number.isFinite(n))throw fail('invalid_labor_entry');return n;};
function worked(entry,now){if(entry.deleted)return {hours:Exact.of('0'),provisional:false};if(entry.out_date){if(instant(entry.out_date)<instant(entry.in_date))throw fail('invalid_labor_entry');return {hours:amount(entry.regular_hours).add(amount(entry.overtime_hours)),provisional:false};}
 const start=instant(entry.in_date),end=Math.min(now,instant(entry.synced_at));if(end<start||now-start>36*3600000)throw fail('open_shift_unresolved');if(!Array.isArray(entry.breaks))throw fail('open_shift_unresolved');let unpaid=0,last=start;
 const breaks=entry.breaks.filter(b=>!b.missed&&!b.waived).map(b=>{if(typeof b.paid!=='boolean'||!b.inDate)throw fail('open_shift_unresolved');return {...b,start:instant(b.inDate),end:b.outDate?instant(b.outDate):end};}).sort((a,b)=>a.start-b.start);
 for(const b of breaks){if(b.start<last||b.end<b.start||b.start<start||b.start>end||b.end>end)throw fail('open_shift_unresolved');last=b.end;if(!b.paid)unpaid+=b.end-b.start;}
 return {hours:new Exact(BigInt(end-start-unpaid),3600000n),provisional:true};
}
function metric(used,target){const t=target===null?null:amount(target),delta=t?used.sub(t):null;return {used:used.decimal(),target:t?.decimal()??null,percentage:t?.positive()?used.div(t).mul('100').decimal():null,remaining:delta?(!delta.positive()?delta.abs().decimal():null):null,over:delta?.positive()?delta.decimal():null,display:{used:used.decimal(1),target:t?.decimal(1)??null,percentage:t?.positive()?used.div(t).mul('100').decimal(1):null,balance:delta?.abs().decimal(1)??null,label:delta?.positive()?'Over':'Remaining'}};}
function aggregate(entries,jobs,mappings,target,now){const totals={FOH:Exact.of('0'),BOH:Exact.of('0'),Excluded:Exact.of('0'),Unassigned:Exact.of('0')},detail=new Map();const current=new Map(mappings.map(m=>[m.job_guid,m]));let total=Exact.of('0'),provisional=Exact.of('0'),unresolved=0;for(const e of entries){if(e.deleted)continue;const m=current.get(e.job_guid);const area=m?.area||'Unassigned',key=(e.job_guid||'unknown')+':'+area;let hours;try{hours=worked(e,now);}catch{unresolved++;continue;}total=total.add(hours.hours);totals[area]=totals[area].add(hours.hours);if(hours.provisional)provisional=provisional.add(hours.hours);const row=detail.get(key)||{jobGuid:e.job_guid,name:jobs.find(j=>j.guid===e.job_guid)?.name||'Unknown Toast job',area,hours:Exact.of('0'),entries:0};row.hours=row.hours.add(hours.hours);row.entries++;detail.set(key,row);}
 const overall=totals.FOH.add(totals.BOH),overallTarget=target?amount(target.foh).add(amount(target.boh)).decimal():null;
 return {reconciliation:{total:total.decimal(),buckets:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,v.decimal()])),balanced:totals.FOH.add(totals.BOH).add(totals.Excluded).add(totals.Unassigned).eq(total),unresolvedEntries:unresolved},foh:metric(totals.FOH,target?.foh??null),boh:metric(totals.BOH,target?.boh??null),overall:metric(overall,overallTarget),unclassified:totals.Unassigned.decimal(1),excluded:totals.Excluded.decimal(1),provisional:provisional.decimal(1),unresolvedEntries:unresolved,unassignedJobs:[...new Set([...detail.values()].filter(d=>d.area==='Unassigned').map(d=>d.jobGuid))].length,detail:[...detail.values()].map(r=>({...r,hours:r.hours.decimal(1)}))};}
module.exports={periodFor,date,addDays,businessDate,weekFor,weekEnd,amount,worked,metric,aggregate,fail};
