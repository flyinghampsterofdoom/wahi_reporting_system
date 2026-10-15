'use strict';
(function(root){
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const units={fl_oz_us:'oz',oz_wt:'oz by weight',cup_us:'cups',tbsp_us:'tablespoons',tsp_us:'teaspoons'};
 const unit=v=>units[v]||v;
 const headings={ingredients:'INGREDIENTS',preparation:'PREPARATION',garnish:'GARNISH',glassware:'GLASSWARE',notes:'SERVICE NOTES'};
 function component(c){const content=(c.type==='recipe'&&c.outputQuantity!==null&&c.outputQuantity!==undefined?`<section><h3>YIELD</h3><p class="recipe-subordinate"><strong>${escape(c.outputQuantity)} ${escape(unit(c.outputUnit))}</strong></p></section>`:'')+(c.ingredients.length?`<section><h3>${escape(c.type==='ingredients'?(c.visibleTitle||'INGREDIENTS'):'INGREDIENTS')}</h3>${c.ingredients.map(i=>`<p class="recipe-subordinate"><strong>${escape(i.quantity??'Review quantity')} ${escape(unit(i.unit??(i.quantity&&/[\p{L}]/u.test(i.quantity)?'':'Review unit')))}</strong> ${escape(i.name)}${i.notes?' · '+escape(i.notes):''}</p>`).join('')}</section>`:'')+c.instructions.map(i=>`<p class="recipe-subordinate">${escape(i.text)}</p>`).join('')+c.children.map(component).join('');
  if(c.type==='recipe')return `<details class="recipe-component"${c.collapsed?'':' open'}><summary><strong>${escape(c.visibleTitle)}</strong></summary>${content}</details>`;
  // Ingredient cards render their standard heading once.
  return `<section class="recipe-component">${c.type==='ingredients'&&c.ingredients.length?'':`<h3>${escape(c.visibleTitle||headings[c.type])}</h3>`}${content}</section>`;
 }
 function render(d){return `<article class="service-recipe"><h2>${escape(d.title)}</h2>${d.components.map(component).join('')}</article>`;}
 const api={render};if(typeof module!=='undefined')module.exports=api;else root.WahiRecipeRenderer=api;
})(typeof window==='undefined'?{}:window);
