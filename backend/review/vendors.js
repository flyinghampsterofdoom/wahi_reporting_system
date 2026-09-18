'use strict';
const {latest}=require('../domain/history');
function supplier(state,id){const s=state.suppliers.find(s=>s.id===id);return s?{id:s.id,name:s.name,active:s.active}:null;}
// Cost-basis selection does not retire other purchasable sources. Their existing
// active flag controls availability; future-only dated offers are not current.
function currentVendors(state,ingredientId,at,knownAt=at){
 const basis=latest(state.bases.filter(b=>b.ingredientId===ingredientId),at,knownAt),vendors=new Map();
 for(const p of state.purchaseOptions.filter(p=>p.ingredientId===ingredientId&&p.active&&p.createdAt<=at&&p.createdAt<=knownAt)){
  const prices=state.prices.filter(x=>x.purchaseOptionId===p.id),bases=state.bases.filter(x=>x.purchaseOptionId===p.id);
  const currentPrice=latest(prices,at,knownAt);
  if(!currentPrice&&basis?.purchaseOptionId!==p.id&&(prices.length||bases.length||p.hasPriceFacts||p.hasBasisFacts))continue;
  const v=supplier(state,p.supplierId);if(v?.active)vendors.set(v.id,v);
 }
 return [...vendors.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
module.exports={supplier,currentVendors};
