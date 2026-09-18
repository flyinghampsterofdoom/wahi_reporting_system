/* Shared pure table selection, used by the browser and regression tests. */
(function(root){
 function select(rows,{query='',state='active',type='',category='',sort='name',direction='asc',includeFinished=false}={}){
  const text=query.toLocaleLowerCase(),filtered=rows.filter(r=>(includeFinished||!r.finished)&&(state==='all'||r.active===(state==='active'))&&(!type||r.itemKind===type)&&(!category||(category==='__none'?!(typeof r.category==='object'?r.category?.id:r.category):(typeof r.category==='object'?r.category?.id:r.category)===category))&&(r.name+' '+(r.description||'')+' '+(typeof r.category==='object'?r.category?.name||'':r.category||'')).toLocaleLowerCase().includes(text));
  const value=r=>sort==='category'?(typeof r.category==='object'?r.category?.name||'':r.category||''):sort==='type'?r.itemKind||'':sort==='status'?(r.active?'Active':'Inactive'):r.name;
  return filtered.slice().sort((a,b)=>(direction==='desc'?-1:1)*(value(a).localeCompare(value(b),undefined,{numeric:true,sensitivity:'base'})||a.name.localeCompare(b.name)));
 }
 const model={select};if(typeof module!=='undefined')module.exports=model;else root.WahiTable=model;
})(typeof window==='undefined'?globalThis:window);
