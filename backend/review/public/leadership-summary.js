'use strict';
(function(root){
 function format(d,generatedAt){
  const lines=['Wahi Hana Labor',d.start?`${d.start} – ${d.end}`:'Reporting period unavailable',`Generated: ${generatedAt}`,`Last Toast sync: ${d.lastSynced||'Unavailable'}`];
  if(d.sync?.error_code)lines.push('WARNING: Toast synchronization failed. Saved data only.');
  if(d.stale)lines.push('WARNING: Labor data may be stale.');
  if(d.missingDays)lines.push(`WARNING: ${d.missingDays} business dates are missing.`);
  if(!d.metrics)lines.push('Labor hours unavailable; this does not mean zero hours.');
  else{
   for(const [label,key] of [['FOH','foh'],['BOH','boh'],['Overall','overall']]){const m=d.metrics[key].display;
    if(d.paceActive){const p=d.metrics[key].pace;lines.push(`${label}: Labor Pace ${p.display.percentage===null?'unavailable':p.display.percentage+'%'} | ${m.used} / ${p.display.allotted??'Not configured'} hrs | ${p.display.variance===null?'Requires valid allotments for all seven days':p.display.variance+' hrs '+p.display.label}${p.status==='zero'?' (zero allotted hours; percentage undefined)':''} | Full weekly target: ${m.target??'Not configured'} hrs | ${m.balance??'Unavailable'} hrs ${m.label==='Over'?'over weekly target':'weekly remaining'}`);continue;}
    lines.push(!d.weekly?`${label}: ${m.used} hrs used`:`${label}: ${m.percentage===null?'Percentage unavailable':m.percentage+'% used'} | ${m.used} / ${m.target===null?'Not configured':m.target} hrs | ${m.balance===null?'Target unavailable':m.balance+' hrs '+(m.label==='Over'?'OVER':'remaining')}`);
   }
   if(d.metrics.unassignedJobs)lines.push(`WARNING: ${d.metrics.unclassified} labor hours are Unassigned and excluded from FOH, BOH and Overall.`);
   if(d.metrics.unresolvedEntries)lines.push(`WARNING: ${d.metrics.unresolvedEntries} entries could not be calculated. Totals are incomplete.`);
   lines.push(`Excluded labor: ${d.metrics.excluded} hrs`,`Provisional open-shift hours: ${d.metrics.provisional} hrs (as of synchronization)`);
  }
  return lines.join('\n');
 }
 if(typeof module!=='undefined')module.exports={format};else root.WahiLeadership={format};
})(typeof window==='undefined'?{}:window);
