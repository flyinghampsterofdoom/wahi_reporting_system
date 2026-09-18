/* Shared pure table selection, used by the browser and regression tests. */
(function(root){
 function select(rows,{query='',state='active',type='',category='',vendor='',sort='name',direction='asc',includeFinished=false}={}){
  const text=query.toLocaleLowerCase(),filtered=rows.filter(r=>(includeFinished||!r.finished)&&(state==='all'||r.active===(state==='active'))&&(!type||r.itemKind===type)&&(!vendor||(vendor==='__none'?!(r.vendors||[]).length:(r.vendors||[]).some(v=>v.id===vendor)))&&(!category||(category==='__none'?!(typeof r.category==='object'?r.category?.id:r.category):(typeof r.category==='object'?r.category?.id:r.category)===category))&&(r.name+' '+(r.vendors||[]).map(v=>v.name).join(' ')+' '+(r.description||'')+' '+(typeof r.category==='object'?r.category?.name||'':r.category||'')).toLocaleLowerCase().includes(text));
  const value=r=>sort==='vendor'?(r.vendors||[]).map(v=>v.name).sort().join('; '):sort==='category'?(typeof r.category==='object'?r.category?.name||'':r.category||''):sort==='type'?r.itemKind||'':sort==='status'?(r.active?'Active':'Inactive'):r.name;
  return filtered.slice().sort((a,b)=>(direction==='desc'?-1:1)*(value(a).localeCompare(value(b),undefined,{numeric:true,sensitivity:'base'})||a.name.localeCompare(b.name)));
 }
 function vendorOptions(rows){const vendors=[...new Map(rows.flatMap(r=>(r.vendors||[]).map(v=>[v.id,v]))).values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));return vendors.map(v=>[v.id,v.name+(vendors.some(other=>other.id!==v.id&&other.name.toLocaleLowerCase()===v.name.toLocaleLowerCase())?' · source '+v.id.slice(0,8):'')]);}
 const model={select,vendorOptions};if(typeof module!=='undefined')module.exports=model;else root.WahiTable=model;
})(typeof window==='undefined'?globalThis:window);
