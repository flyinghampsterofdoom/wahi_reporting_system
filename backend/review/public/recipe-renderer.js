'use strict';
(function(root){
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const units={fl_oz_us:'oz',oz_wt:'oz by weight',cup_us:'cups',tbsp_us:'tablespoons',tsp_us:'teaspoons'};
 const unit=v=>units[v]||v;
 const headings={ingredients:'INGREDIENTS',preparation:'PREPARATION',garnish:'GARNISH',glassware:'GLASSWARE',notes:'SERVICE NOTES'};
 const quantities=typeof module!=='undefined'?require('./quantity'):root.WahiQuantity;
 // Top-level recipe blocks contain the drink's own ingredients. Child recipe
 // blocks are copied ingredient formulas, retained in the document but not shown.
 function render(d){
  const sections={ingredients:[],preparation:[],garnish:[],glassware:[]};
  function section(kind,title,content){if(content)sections[kind].push(`<section class="recipe-component"><h3>${escape(title)}</h3>${content}</section>`);}
  function visit(c){
   const rows=(c.ingredients||[]).map(i=>{const q=quantities.service(i.quantity);return `<p class="recipe-subordinate"><strong>${escape(q.text)} ${escape(unit(i.unit||''))}</strong> ${escape(i.name)}</p>`;}).join('');
   section('ingredients',c.type==='ingredients'?(c.visibleTitle||headings.ingredients):headings.ingredients,rows);
   // Administrative note blocks are not bartender directions.
   if(c.type!=='notes'){
    const kind=['garnish','glassware'].includes(c.type)?c.type:'preparation';
    const instructions=(c.instructions||[]).map(r=>escape(r.text));
    const content=kind==='preparation'?(instructions.length?`<ol class="recipe-instructions">${instructions.map(text=>`<li>${text}</li>`).join('')}</ol>`:''):instructions.map(text=>`<p class="recipe-subordinate">${text}</p>`).join('');
    section(kind,['preparation','garnish','glassware'].includes(c.type)?(c.visibleTitle||headings[kind]):headings[kind],content);
   }
   for(const child of c.children||[])if(child.type!=='recipe')visit(child);
  }
  for(const c of d.components)visit(c);
  return `<article class="service-recipe"><h2>${escape(d.title)}</h2>${Object.values(sections).flat().join('')}</article>`;
 }
 const api={render,unit};if(typeof module!=='undefined')module.exports=api;else root.WahiRecipeRenderer=api;
})(typeof window==='undefined'?{}:window);
