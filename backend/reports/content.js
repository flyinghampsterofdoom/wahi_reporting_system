'use strict';
const {format}=require('../review/public/leadership-summary');
const {canonicalOrigin}=require('../email/templates');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sections={labor:async({labor,actor,report,now})=>{
 const projection=await labor.overview(actor,{period:report.id==='daily'?'this':'last'});
 return {id:'labor',projection,text:format(projection,new Date(now).toISOString()),route:projection.start?'#time?period=custom&start='+projection.start+'&end='+projection.end:'#time'};
}};
async function content({labor,actor,report,now,origin,manual=false}){
 const rendered=await Promise.all(report.sections.map(id=>sections[id]({labor,actor,report,now})));
 const laborSection=rendered.find(s=>s.id==='labor'),link=canonicalOrigin(origin)+'/'+laborSection.route;
 const title=(report.id==='daily'?'Daily':'Weekly')+' Management Summary',range=laborSection.projection.start?`${laborSection.projection.start} – ${laborSection.projection.end}`:'Period unavailable';
 const subject=`${manual?'[Manual] ':''}Wahi Hana — ${title} — ${range}`,summary=rendered.map(s=>s.text).join('\n\n');
 return {subject,text:subject+'\n\nOpen Time Management in Wahi: '+link+'\n\n'+summary,html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#182c29;line-height:1.6;max-width:680px;margin:auto;padding:24px"><h1>${escape(title)}</h1>${manual?'<p>Manual send</p>':''}<p>Wahi is your authoritative source for management details.</p><p><a href="${escape(link)}" style="display:inline-block;background:#18483f;color:white;padding:12px 20px;border-radius:6px">Open Time Management in Wahi</a></p><h2>Leadership Summary</h2><pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escape(summary)}</pre><p>Sign in with your Wahi account. Your normal access permissions apply.</p></body></html>`,summary,link,sections:rendered};
}
module.exports={content,sections};
