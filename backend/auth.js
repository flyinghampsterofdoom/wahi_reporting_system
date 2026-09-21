'use strict';
const inventoryManagement=['inventory.configure','inventory.count','inventory.history','inventory.correct'];
const CAPABILITIES = Object.freeze({
  ADMIN:['reporting.read','reporting.refresh','reporting.configure','labor.read','labor.refresh','labor.configure','administration.access','integrations.manage',...inventoryManagement,'internal_cost.read','internal_cost.write','users.manage','domain.write','history.backdate','labor_rates.manage'],
  MANAGER:['reporting.read','reporting.refresh','labor.read','labor.refresh',...inventoryManagement,'internal_cost.read','internal_cost.write','domain.write','history.backdate'], LEAD:['inventory.count'], STAFF:['inventory.count']
});
function authorize(actor,capability) {
  if(!actor || typeof actor.id!=='string' || !actor.id.trim() || !Object.hasOwn(CAPABILITIES,actor.role)) {const e=new Error('Authenticated principal required');e.code='unauthenticated';throw e;}
  if(capability&&!CAPABILITIES[actor.role].includes(capability)) {const e=new Error('Insufficient permissions');e.code='forbidden';throw e;}
}
function can(actor,capability) {authorize(actor);return CAPABILITIES[actor.role].includes(capability);}
// Allowlist projections intentionally never spread a stored domain record.
function ingredientView(i) {return {id:i.id,name:i.name,description:i.description,category:i.category,tags:[...i.tags],active:i.active,createdAt:i.createdAt,updatedAt:i.updatedAt};}
function recipeView(r,revision) {return {id:r.id,name:r.name,outputIngredientId:r.outputIngredientId,
  revision:revision?{id:revision.id,outputQuantity:revision.outputQuantity,outputUnit:revision.outputUnit,
    lines:revision.lines.map(l=>({id:l.id,ingredientId:l.ingredientId,quantity:l.quantity,unit:l.unit,...(l.notes?{notes:l.notes}:{})})),steps:revision.steps.map(s=>({id:s.id,position:s.position,instruction:s.instruction}))}:null};}
function costView(result) {return {...result,currencyDisplay:Object.fromEntries(['completeCost','knownSubtotal','materialSubtotal','laborSubtotal'].map(k=>[k,result[k]?.decimal(2)??null])),completeCost:result.completeCost?.decimal()??null,knownSubtotal:result.knownSubtotal.decimal(),materialSubtotal:result.materialSubtotal.decimal(),laborSubtotal:result.laborSubtotal.decimal()};}
module.exports={CAPABILITIES,authorize,can,ingredientView,recipeView,costView};
