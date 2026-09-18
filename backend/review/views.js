'use strict';
const {authorize,can,recipeView}=require('../auth');
const {latest}=require('../domain/history');
const {management}=require('./management');
const {itemRecord}=require('./items');
const {DomainService}=require('../service');
const {enableResolutionCache}=require('../domain/resolution-context');
function compactCost(c){return c?{status:c.status,completeCost:c.completeCost,currency:c.currency,currencyDisplay:{completeCost:c.currencyDisplay.completeCost}}:null;}
async function current(service,options={}){const at=service.clock();const state=service.repository.readCurrent?await service.repository.readCurrent({at,...options}):enableResolutionCache(await service.repository.read());return {state,at,service:new DomainService({read:async()=>state},{clock:()=>at})};}
async function view(service,actor,kind,id){
 authorize(actor);
 const {state:s,at,service:scoped}=await current(service,kind==='item'?{itemId:id}:kind==='recipe'?{recipeId:id}:kind==='overview'||kind==='recipes'?{recipesOnly:true}:{});
 if(kind==='item'){
  const i=await itemRecord(scoped,actor,id);
  i.references=s.ingredients.map(x=>({id:x.id,name:x.name,active:x.active}));
  i.menuItems=s.menuItems.map(m=>scoped.menuFromState(actor,s,m.id,{at,knownAt:at}));
  if(i.packages)i.packages=i.packages.filter(p=>p.active||p.id===i.basis?.purchaseOptionId);
  return i;
 }
 const m=await management(scoped,actor,{includeItems:kind==='items',includeMenuCosts:kind==='recipe',recipeId:kind==='recipe'?id:null});
 if(kind==='overview')return {...(s.operationalSummary||{items:s.ingredients.length,recipes:s.recipes.length,inventoryConfigured:s.inventoryItems.length,locations:s.inventoryLocations.filter(l=>l.active).length}),...(can(actor,'inventory.history')?{recentCounts:s.operationalSummary?.recentCounts||s.countSessions.filter(c=>c.status==='submitted').sort((a,b)=>b.observedAt.localeCompare(a.observedAt)).slice(0,5).map(c=>({id:c.id,observedAt:c.observedAt,locationName:c.snapshot.location.name}))}:{recentCounts:undefined}),...(can(actor,'internal_cost.read')?{unresolvedRecipeCosts:m.recipes.filter(r=>!r.cost||r.cost.completeCost===null).length}:{})};
 if(kind==='recipe'){const r=m.recipes.find(r=>r.id===id);if(!r)throw Object.assign(new Error('Recipe missing'),{code:'not_found'});return {recipe:r,categories:m.categories,references:s.ingredients.map(x=>({id:x.id,name:x.name,active:x.active}))};}
 if(kind==='recipes')return {categories:m.categories,recipes:m.recipes.map(r=>({id:r.id,name:r.name,outputIngredientId:r.outputIngredientId,active:r.active,category:r.category,revision:r.revision?{outputQuantity:r.revision.outputQuantity,outputUnit:r.revision.outputUnit}:null,menus:r.menus.map(({id,name,active,sellingPrice})=>({id,name,active,sellingPrice})),...(r.cost?{cost:compactCost(r.cost)}:{})}))};
 return {categories:[],items:m.items.filter(i=>!i.finished).map(({description,tags,createdAt,updatedAt,...i})=>({...i,...(i.cost?{cost:compactCost(i.cost)}:{})}))};
}
async function references(service,actor,{inventoryOnly=false}={}){
 authorize(actor);const p=service.repository.pool;
 if(p){const r=await p.query(`SELECT jsonb_build_object(
 'ingredients',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active)),'[]') FROM wahi_v2.ingredients WHERE NOT $2::boolean OR id IN (SELECT ingredient_id FROM wahi_v2.inventory_items)),
 'recipes',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'outputIngredientId',output_ingredient_id)),'[]') FROM wahi_v2.recipes WHERE NOT $2::boolean),
 'menuItems',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM wahi_v2.menu_items WHERE NOT $2::boolean),
 'inventoryItems',(SELECT COALESCE(jsonb_agg(jsonb_build_object('ingredientId',ingredient_id,'baseUnit',base_unit)),'[]') FROM wahi_v2.inventory_items),
 'assignments',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'ingredientId',ingredient_id,'locationId',location_id,'countUnit',count_unit,'active',active,'sortOrder',sort_order,'version',version)),'[]') FROM wahi_v2.inventory_assignments),
 'locations',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'area',area,'description',description,'sortOrder',sort_order,'active',active,'version',version)),'[]') FROM wahi_v2.inventory_locations),
 'drafts',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'locationName',snapshot->'location'->>'name','observedAt',observed_at)),'[]') FROM wahi_v2.count_sessions WHERE actor_id=$1 AND status='draft'),
 'suppliers',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active)),'[]') FROM wahi_v2.suppliers WHERE NOT $2::boolean)) AS data`,[actor.id,inventoryOnly]);const d=r.rows[0].data;if(!can(actor,'internal_cost.read'))delete d.suppliers;if(!can(actor,'inventory.configure'))delete d.assignments;return d;}
 const s=await service.repository.read();return {ingredients:s.ingredients.map(({id,name,active})=>({id,name,active})),recipes:s.recipes.map(({id,name,outputIngredientId})=>({id,name,outputIngredientId})),menuItems:s.menuItems.map(({id,name})=>({id,name})),inventoryItems:s.inventoryItems,locations:s.inventoryLocations,drafts:s.countSessions.filter(c=>c.actorId===actor.id&&c.status==='draft').map(c=>({id:c.id,locationName:c.snapshot.location.name,observedAt:c.observedAt})),...(can(actor,'inventory.configure')?{assignments:s.inventoryAssignments}:{}),...(can(actor,'internal_cost.read')?{suppliers:s.suppliers.map(({id,name,active})=>({id,name,active}))}:{})};
}
async function itemHistory(service,actor,id){authorize(actor,'internal_cost.read');const s=await service.repository.read(),options=s.purchaseOptions.filter(p=>p.ingredientId===id),recipe=s.recipes.find(r=>r.outputIngredientId===id);return {facts:[...s.bases,...s.yields,...s.measurements,...s.labor].filter(x=>x.ingredientId===id).concat(s.prices.filter(x=>options.some(p=>p.id===x.purchaseOptionId)),s.recipeRevisions.filter(x=>x.recipeId===recipe?.id)),evidence:s.importRecords.filter(r=>r.entityIds.includes(id)).map(({sheet,sourceRow,issues,sourceValues})=>({sheet,sourceRow,issues,sourceValues})),packages:options};}
module.exports={view,references,itemHistory,current};
