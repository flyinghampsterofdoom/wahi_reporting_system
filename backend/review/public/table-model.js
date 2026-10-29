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

/* UI-only comparison: never feeds displayed/rounded values back into costing. */
(function(root){
 const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
 const missing=/^(?:|—|–|unknown|unresolved|incomplete|never(?: counted)?|not configured|not supplied|n\/a)$/i;
 function value(text,type='text'){
  text=String(text??'').trim();if(missing.test(text))return null;
  if(type==='date'){const n=Date.parse(text);return Number.isNaN(n)?null:n;}
  if(type==='number'){
   const match=text.replaceAll(',','').match(/^(?:[A-Z]{3}\s*|[$€£])?\s*([+-]?\d+(?:\.\d+)?)(?:\s*%|\s+[a-zA-Z].*)?$/);
   if(!match)return null;return match[1];
  }
  return text;
 }
 function decimalCompare(a,b){
  const parts=x=>{const [whole,fraction='']=x.split('.');return {whole,fraction};},x=parts(a),y=parts(b),scale=Math.max(x.fraction.length,y.fraction.length);
  const integer=p=>BigInt(p.whole+p.fraction.padEnd(scale,'0'));
  const left=integer(x),right=integer(y);return left<right?-1:left>right?1:0;
 }
 function compare(a,b,type='text',direction='asc'){
  a=value(a,type);b=value(b,type);if(a===null||b===null)return a===b?0:a===null?1:-1;
  return (direction==='desc'?-1:1)*(type==='number'?decimalCompare(a,b):type==='date'?Math.sign(a-b):collator.compare(a,b));
 }
 Object.assign(typeof module!=='undefined'?module.exports:root.WahiTable,{value,compare});
 if(typeof document==='undefined')return;
 const states=new Map(),initialized=new WeakSet(),pendingRows=new Map();let nextRows=0;
 root.WahiTable.deferRows=rows=>{const id=String(++nextRows);pendingRows.set(id,rows.slice(50).join(''));queueMicrotask(()=>{if(!document.querySelector('[data-table-rows="'+id+'"]'))pendingRows.delete(id);});return id;};
 // Links and whole-row navigation also work for rows first attached on later pages.
 document.addEventListener('click',event=>{const row=event.target.closest('[data-row-href]');if(row&&!event.target.closest('a,button,input,select,textarea'))location.hash=row.dataset.rowHref;});
 root.WahiTable.capture=hash=>[...states].filter(([key])=>key.startsWith(hash+'|')).map(([key,state])=>[key,{...state}]);
 root.WahiTable.restore=snapshot=>{for(const [key,state] of snapshot||[])states.set(key,{...state});};
 const numeric=/cost|cogs|price|sales|quantity|qty|hours|entries|units sold|order|inventory|yield|equivalent|percentage|%|pieces|executions/i;
 const dates=/^(when|requested|last login|last test|accepted at|observed|submitted|date)$/i;
 function enhance(table){
  if(initialized.has(table)||table.dataset.tableStatic!==undefined)return;
  const body=table.tBodies[0],headers=[...table.querySelectorAll('thead th')];
  if(!body||!headers.length)return;
  // Authored formulas and multi-row/group summaries retain their meaningful order.
  const empty=body.rows.length===1&&body.rows[0].cells.length===1&&body.rows[0].cells[0].colSpan===headers.length&&/^No\b/i.test(body.textContent.trim());
  if(!empty&&[...body.rows].some(r=>[...r.cells].some(c=>c.colSpan>1||c.rowSpan>1)))return;
  initialized.add(table);
  const deferred=[];if(table.dataset.tableRows){const template=document.createElement('template');template.innerHTML='<table><tbody>'+(pendingRows.get(table.dataset.tableRows)||'')+'</tbody></table>';pendingRows.delete(table.dataset.tableRows);deferred.push(...template.content.querySelectorAll('tr'));}
  const rows=[...(empty?[]:body.rows),...deferred],editable=!!table.querySelector('input,select,textarea'),paging=!editable&&rows.length>50;
  const identity=location.hash+'|'+(table.closest('[id]')?.id||'')+'|'+headers.map(h=>h.textContent).join('|');
  const state=states.get(identity)||{column:null,direction:'asc',page:0,query:''};states.set(identity,state);
  // Detaching nodes before the next paint bounds layout, while preserving all existing
  // listeners and row identity. Editable forms keep every field attached for submission.
  const cells=new Map(rows.map(r=>[r,[...r.cells].map(c=>c.dataset.sortValue??c.textContent.trim())]));
  const types=headers.map(h=>h.dataset.sortType||(dates.test(h.textContent.trim())?'date':numeric.test(h.textContent)?'number':'text'));
  const controls=document.createElement('div');controls.className='table-tools';
  const status=document.createElement('span');status.className='muted';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const externalScope=table.closest('#admin-results,#cogs-table,#mapping-table,#users-table')?.parentElement;
  const externalSearch=externalScope?.querySelector('input[type=search]');if(externalSearch)state.query='';
  let search,previous,next;
  if(!editable&&!externalSearch&&rows.length>10){const label=document.createElement('label');label.textContent='Search this table';search=document.createElement('input');search.type='search';search.value=state.query;label.append(search);controls.append(label);search.oninput=()=>{state.query=search.value;state.page=0;draw();};}
  if(paging){previous=document.createElement('button');previous.type='button';previous.className='secondary';previous.textContent='Previous';next=document.createElement('button');next.type='button';next.className='secondary';next.textContent='Next';previous.onclick=()=>{state.page--;draw();};next.onclick=()=>{state.page++;draw();};controls.append(previous,next);}
  controls.append(status);
  const container=table.closest('.table-scroll')||table;container.before(controls);
  headers.forEach((header,column)=>{
   const text=header.textContent.trim();if(!text||/^(action|actions|details)$/i.test(text))return;
   header.scope='col';const button=document.createElement('button');button.type='button';button.className='table-sort';button.textContent=text;button.setAttribute('aria-label','Sort by '+text);header.replaceChildren(button);
   button.onclick=()=>{state.direction=state.column===column&&state.direction==='asc'?'desc':'asc';state.column=column;state.page=0;
    const scope=externalScope;
    if(scope){const sort=scope.querySelector('select[name=sort],select[name$="-sort"],select[id$="-sort"]'),direction=scope.querySelector('select[name=direction],select[name$="-direction"],select[id$="-direction"]');if(direction)direction.value=state.direction;if(sort){const aliases={Item:'name',Recipe:'name',Vendor:'vendor',Category:'category',Type:'type',Status:'status'};const option=[...sort.options].find(o=>o.value===aliases[text]||o.textContent.toLowerCase()===text.toLowerCase());sort.selectedIndex=option?option.index:-1;}}
    draw();};
  });
  function draw(){
   let selected=rows.filter(r=>!state.query||r.textContent.toLocaleLowerCase().includes(state.query.trim().toLocaleLowerCase()));
   if(state.column!==null)selected.sort((a,b)=>compare(cells.get(a)[state.column],cells.get(b)[state.column],types[state.column],state.direction));
   const pages=Math.max(1,Math.ceil(selected.length/50));state.page=Math.max(0,Math.min(state.page,pages-1));
   const visible=paging?selected.slice(state.page*50,state.page*50+50):selected;
   body.replaceChildren(...visible);
   if(!selected.length){const row=body.insertRow(),cell=row.insertCell();cell.colSpan=headers.length;cell.textContent='No matching records';}
   headers.forEach((h,i)=>{if(h.querySelector('.table-sort')){h.setAttribute('aria-sort',i===state.column?(state.direction==='asc'?'ascending':'descending'):'none');h.querySelector('button').textContent=h.querySelector('button').getAttribute('aria-label').slice(8)+(i===state.column?(state.direction==='asc'?' ↑':' ↓'):' ↕');}});
   status.textContent=selected.length?(paging?`${state.page*50+1}–${Math.min(selected.length,(state.page+1)*50)} of ${selected.length} records`:`${selected.length} records`):'0 records';
   if(previous){previous.disabled=state.page===0;next.disabled=state.page===pages-1;}
  }
  draw();
 }
 let queued=false;
 // Existing search/filter renderers continue to own their data selection. A change
 // to their sort dropdown explicitly replaces a previous header sort.
 const resetExternal=event=>{if(root.WahiTable.restoring)return;const el=event.target;if(!el.closest('.admin-controls'))return;for(const [key,state] of states)if(key.startsWith(location.hash+'|')){state.page=0;if(el.matches('select')&&/sort|direction/.test(el.name||el.id))state.column=null;}};
 document.addEventListener('input',resetExternal,true);document.addEventListener('change',resetExternal,true);
 const observer=new MutationObserver(records=>{if(!records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches('table')||n.querySelector('table')))))return;if(queued)return;queued=true;queueMicrotask(()=>{queued=false;document.querySelectorAll('#main table').forEach(enhance);});});
 observer.observe(document,{childList:true,subtree:true});
})(typeof window==='undefined'?globalThis:window);
