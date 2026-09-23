'use strict';
// Presentation only. The authenticated principal and capabilities are never changed.
let operationalPreview=null,wasteCatalog=null;
const bohView=()=>me?.role==='BOH'||(me?.role==='ADMIN'&&operationalPreview==='BOH');
function renderOperationalControl(){
 let control=$('operational-view');if(!control){control=document.createElement('button');control.id='operational-view';control.className='secondary';document.querySelector('header').append(control);}
 control.hidden=me?.role!=='ADMIN';control.textContent=bohView()?'Exit BOH View':'BOH View';
 control.onclick=()=>{operationalPreview=bohView()?null:'BOH';location.hash=operationalPreview?'waste':'admin';route();};
 document.querySelector('header').classList.toggle('operational-header',bohView());
 document.querySelector('#account a')?.toggleAttribute('hidden',bohView());
 document.querySelector('.brand span').textContent=bohView()?'BOH':me?.hosted?'Management':'Owner review';
}
const wasteUnit=u=>u==='batch'?'batch':u.startsWith('op:')?u.slice(3).replaceAll('_',' '):unitLabel(u);
async function wastePage(){
 wasteCatalog=await api('waste/catalog');wasteLanding();
}
function wasteLanding(){
 $('main').innerHTML=`<section class="waste-entry"><h1>LOG WASTE</h1><div class="waste-common">${wasteCatalog.common.map(i=>`<button data-waste-item="${esc(i.id)}">${esc(i.name)}</button>`).join('')}</div><button id="waste-find" class="secondary waste-wide">FIND SOMETHING ELSE</button>${!wasteCatalog.items.length?'<p>No active items are available. Ask a manager to add an item.</p>':''}${!bohView()&&can('waste.history')?'<p><a href="#waste/history">Waste history</a></p>':''}</section>`;
 bindWasteItems();$('waste-find').onclick=wasteSearch;
}
function bindWasteItems(){document.querySelectorAll('[data-waste-item]').forEach(b=>b.onclick=()=>wasteEntry(wasteCatalog.items.find(i=>i.id===b.dataset.wasteItem)));}
function wasteSearch(){
 $('main').innerHTML='<section class="waste-entry"><button id="waste-back" class="secondary">Back</button><h1>Find an item</h1><label>Search<input id="waste-search" type="search" autocomplete="off" placeholder="Item or prepared recipe"></label><div id="waste-results" class="waste-results"></div></section>';
 $('waste-back').onclick=wasteLanding;
 const results=()=>{const words=$('waste-search').value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),items=wasteCatalog.items.filter(i=>words.every(w=>i.search.includes(w))).slice(0,60);$('waste-results').innerHTML=items.map(i=>`<button class="secondary" data-waste-item="${esc(i.id)}">${esc(i.name)}</button>`).join('')||'<p>No matching items.</p>';bindWasteItems();};$('waste-search').oninput=results;results();$('waste-search').focus();
}
function wasteEntry(item){
 let busy=false,requestId=crypto.randomUUID(),pending=null,reason='';
 $('main').innerHTML=`<section class="waste-entry"><div class="waste-entry-heading"><button id="waste-back" class="secondary">Back</button><h1>${esc(item.name)}</h1></div><form id="waste-form"><div class="waste-quantity"><button type="button" id="waste-minus" class="secondary" aria-label="Decrease quantity">−</button><label class="waste-quantity-label">Quantity<input id="waste-quantity" name="quantity" type="number" inputmode="decimal" min="0.000000001" step="any" value="1" required></label><button type="button" id="waste-plus" class="secondary" aria-label="Increase quantity">+</button></div><label>Unit<select id="waste-unit" name="unit">${item.units.map(u=>`<option value="${esc(u)}">${esc(wasteUnit(u))}</option>`).join('')}</select></label><fieldset><legend>Why?</legend><div class="waste-reasons">${wasteCatalog.reasons.map(r=>`<button type="button" class="secondary" data-waste-reason="${esc(r)}" aria-pressed="false">${esc(r)}</button>`).join('')}</div></fieldset><label id="waste-note-label" hidden>Note (optional)<input name="note" maxlength="300"></label><p id="waste-error" role="alert"></p><button type="submit" id="waste-submit" class="waste-wide" disabled>LOG WASTE</button></form></section>`;
 $('waste-back').onclick=()=>{if(!busy)wasteLanding();};
 for(const [id,delta]of [['waste-minus',-1],['waste-plus',1]])$(id).onclick=()=>{$('waste-quantity').value=Math.max(0,Math.round((Number($('waste-quantity').value)+delta)*1e9)/1e9);};
 document.querySelectorAll('[data-waste-reason]').forEach(b=>b.onclick=()=>{reason=b.dataset.wasteReason;document.querySelectorAll('[data-waste-reason]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('waste-note-label').hidden=reason!=='Other';$('waste-submit').disabled=false;});
 $('waste-form').onsubmit=async e=>{e.preventDefault();if(busy||!reason)return;const data=new FormData(e.target),draft={ingredientId:item.id,quantity:data.get('quantity'),unit:data.get('unit'),reason,note:reason==='Other'?data.get('note'):''};
  // An uncertain response retries the exact payload and durable key. Editing
  // after an error is disabled until that submission has been resolved.
  pending=pending||{requestId,...draft};busy=true;for(const el of e.target.elements)el.disabled=true;$('waste-back').disabled=true;
  try{const saved=await api('waste/events',pending);wasteLanding();notify(`${saved.name} — ${fmt(saved.quantity)} ${wasteUnit(saved.unit)} logged`);}
  catch(err){if(!$('waste-error'))return;if(err.status>=400&&err.status<500){pending=null;requestId=crypto.randomUUID();for(const el of e.target.elements)el.disabled=false;$('waste-back').disabled=false;}$('waste-error').textContent=err.message+' Tap Log Waste to retry.';$('waste-submit').disabled=false;}
  finally{busy=false;}
 };
}
async function wasteHistory(query={}){
 const d=await api('waste/history?'+new URLSearchParams(query));
 $('main').innerHTML=`<h1>Waste history</h1><p>${link('waste','Log waste')}</p><form id="waste-filter" class="admin-form">${field('Search item or note','q',query.q||'','search',false)}${field('From','from',query.from||'','date',false)}${field('Through','to',query.to||'','date',false)}${select('Reason','reason',[['','All reasons'],...['Overproduction','Spoiled','Dropped / Spilled','Quality','Prep Error','Other'].map(r=>[r,r])],query.reason||'')}${select('Item type','kind',[['','All items'],['ingredient','Ingredient / purchased item'],['recipe','Prepared recipe']],query.kind||'')}<button type="submit">Search</button></form><p>${d.total} events</p>${compactTable(['When','Item','Quantity','Reason','Note','Estimated cost'],d.events.map(e=>`<tr><td>${esc(date(e.recordedAt))}</td><td>${esc(e.name)}</td><td>${esc(fmt(e.quantity))} ${esc(wasteUnit(e.unit))}</td><td>${esc(e.reason)}</td><td>${esc(e.note)}</td><td>${e.cost.amount===null?'Unresolved':esc(fmt(e.cost.amount)+' '+e.cost.currency)}</td></tr>`))}<div class="row"><button id="waste-prev" ${d.offset===0?'disabled':''}>Previous</button><button id="waste-next" ${d.offset+100>=d.total?'disabled':''}>Next</button></div>`;
 form('waste-filter',async values=>wasteHistory(Object.fromEntries(Object.entries(values).filter(([,v])=>v))));$('waste-prev').onclick=()=>wasteHistory({...query,offset:Math.max(0,d.offset-100)});$('waste-next').onclick=()=>wasteHistory({...query,offset:d.offset+100});
}
