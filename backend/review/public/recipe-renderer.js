'use strict';
(function(root){
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const units={fl_oz_us:'oz',oz_wt:'oz by weight',cup_us:'cups',tbsp_us:'tablespoons',tsp_us:'teaspoons'};
 const unit=v=>units[v]||v;
 const headings={ingredients:'INGREDIENTS',preparation:'PREPARATION',garnish:'GARNISH',glassware:'GLASSWARE',notes:'SERVICE NOTES'};
 const quantities=typeof module!=='undefined'?require('./quantity'):root.WahiQuantity;
 function component(c){
  const children=(c.children||[]).map(component).join('');
  const rows=(c.ingredients||[]).map(i=>{const q=quantities.service(i.quantity);return `<p class="recipe-subordinate"><strong>${escape(q.text)} ${escape(unit(i.unit||''))}</strong> ${escape(i.name)}</p>`;}).join('');
  if(!rows&&!children)return '';
  const content=(rows?`<section><h3>${escape(c.type==='ingredients'?(c.visibleTitle||'INGREDIENTS'):'INGREDIENTS')}</h3>${rows}</section>`:'')+children;
  if(c.type==='recipe')return `<details class="recipe-component"${c.collapsed?'':' open'}><summary><strong>${escape(c.visibleTitle)}</strong></summary>${content}</details>`;
  return `<section class="recipe-component">${content}</section>`;
 }
 function render(d){return `<article class="service-recipe"><h2>${escape(d.title)}</h2>${d.components.map(component).join('')}</article>`;}
 const api={render,unit};if(typeof module!=='undefined')module.exports=api;else root.WahiRecipeRenderer=api;
})(typeof window==='undefined'?{}:window);
