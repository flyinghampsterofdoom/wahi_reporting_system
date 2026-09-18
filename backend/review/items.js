'use strict';
// Review-layer composition only: every write still passes through the domain service.
const {z}=require('zod');
const {DomainService,schemas}=require('../service');
const {MemoryRepository}=require('../repository/memory');
const {authorize,can,ingredientView,recipeView,costView}=require('../auth');
const {latest,grouped}=require('../domain/history');
const {costIngredient}=require('../domain/costing');
const inputSchema=z.object({id:z.string().uuid().optional(),kind:z.enum(['purchase','recipe']),recipeCategoryId:z.string().uuid().nullable().optional(),name:z.string(),description:z.string(),category:z.string(),active:z.boolean(),effectiveAt:z.string().optional(),measurement:z.object({fromQuantity:z.string(),fromUnit:z.string(),toQuantity:z.string(),toUnit:z.string(),measurementKey:z.string().uuid().optional()}).strict().optional(),labor:z.object({kind:z.enum(['fixed','time']),amount:z.string().nullable(),minutes:z.string().nullable(),department:z.enum(['FOH','BOH']).nullable(),outputQuantity:z.string().nullable(),outputUnit:z.string(),componentKey:z.string().uuid().optional()}).strict().optional(),purchase:z.object({label:z.string(),contentQuantity:z.string(),contentUnit:z.string(),amount:z.string(),currency:z.string(),supplierId:z.string().uuid().nullable()}).strict().optional(),recipe:z.object({outputQuantity:z.string().nullable(),outputUnit:z.string(),lines:z.array(z.object({ingredientId:z.string().uuid(),quantity:z.string().nullable(),unit:z.string(),notes:z.string().optional()}).strict()),steps:z.array(z.string())}).strict().optional()}).strict();
async function saveItem(service,actor,input){
 authorize(actor,'internal_cost.write');const d=inputSchema.parse(input);
 return service.repository.transaction(async state=>{
  const repo=new MemoryRepository(state),s=new DomainService(repo,{clock:service.clock});
  const common={provenance:{kind:'manual',reference:'Wahi item editor'}};
  const run=(c,v)=>s.execute(actor,c,{...common,...v});
  const old=d.id?state.ingredients.find(i=>i.id===d.id):null;if(d.id&&!old)throw new Error('Item missing');
  const id=d.id||(await run('createIngredient',{name:d.name,description:d.description,category:d.category})).id;
  // Temporarily restore inside this transaction to allow edits to inactive identities.
  if(old&&!old.active)await run('setArchived',{collection:'ingredients',entityId:id,archived:false});
  const timing=d.effectiveAt?{effectiveAt:d.effectiveAt}:{};
  if(d.kind==='purchase'&&d.purchase){
   const p=d.purchase,now=d.effectiveAt||s.clock(),basis=latest(state.bases.filter(b=>b.ingredientId===id),now);
   let option=state.purchaseOptions.find(o=>o.id===basis?.purchaseOptionId);
   if(p.contentQuantity){
    if(!option||['label','contentQuantity','contentUnit','supplierId'].some(k=>option[k]!==p[k])){
     const created=await run('createPurchaseOption',{ingredientId:id,label:p.label,contentQuantity:p.contentQuantity,contentUnit:p.contentUnit,supplierId:p.supplierId});option={id:created.id};
     await run('selectBasis',{ingredientId:id,kind:'purchase',purchaseOptionId:option.id,...timing});
    }
    const price=latest(state.prices.filter(r=>r.purchaseOptionId===option.id),now);
    if(p.amount!==''&&(!price||price.amount!==p.amount||price.currency!==p.currency))await run('addPrice',{purchaseOptionId:option.id,amount:p.amount,currency:p.currency,...timing});
   }else if(option)throw Object.assign(new Error('Existing package contents cannot be erased'),{code:'package_contents_required'});
   else if(p.amount!=='')throw Object.assign(new Error('Package contents required before recording a price'),{code:'package_contents_required'});
  }
  if(d.kind!=='recipe'&&d.recipeCategoryId!==undefined)throw new Error('Recipe category requires a recipe');
  if(d.kind==='recipe'){
   if(!d.recipe)throw new Error('Recipe required');
   let recipe=state.recipes.find(r=>r.outputIngredientId===id);
   if(!recipe)recipe=await run('createRecipe',{name:d.name,outputIngredientId:id});
   const prev=latest(state.recipeRevisions.filter(r=>r.recipeId===recipe.id),d.effectiveAt||s.clock());
   const plain=prev?{outputQuantity:prev.outputQuantity,outputUnit:prev.outputUnit,lines:prev.lines.map(({ingredientId,quantity,unit,notes})=>({ingredientId,quantity,unit,...(notes?{notes}:{})})),steps:prev.steps.map(x=>x.instruction)}:null;
   if(JSON.stringify(plain)!==JSON.stringify(d.recipe))await run('reviseRecipe',{recipeId:recipe.id,...d.recipe,...timing});
   if(d.recipeCategoryId!==undefined)await run('setRecipeCategory',{recipeId:recipe.id,categoryId:d.recipeCategoryId,...timing});
  }
  if(d.measurement)await run('addMeasurement',{ingredientId:id,...d.measurement,...timing});
  if(d.labor)await run('setLabor',{ingredientId:id,...d.labor,currency:d.labor.kind==='fixed'&&d.labor.amount!==null?'USD':null,...timing});
  await run('updateIngredient',{ingredientId:id,name:d.name,description:d.description,category:d.category,tags:old?.tags||[],active:d.active});
  Object.assign(state,await repo.read());return {id};
 });
}
async function itemRecord(service,actor,id){
 authorize(actor);const s=await service.repository.read(),i=s.ingredients.find(x=>x.id===id);if(!i)throw Object.assign(new Error('Missing item'),{code:'not_found'});
 const now=service.clock(),current=(rows)=>latest(rows,now,now),basis=current(s.bases.filter(x=>x.ingredientId===id)),r=s.recipes.find(r=>r.outputIngredientId===id),revision=r?current(s.recipeRevisions.filter(v=>v.recipeId===r.id)):null;
 const item={...ingredientView(i),kind:basis?.kind==='recipe'?'Prepared Item':basis?.kind==='source'?'Source-yield Item':basis?.kind==='labor_only'?'Labor Item':r?'Prepared Item':'Purchased Item',recipe:r?recipeView(r,revision):null,inventory:s.inventoryItems.find(x=>x.ingredientId===id)?{baseUnit:s.inventoryItems.find(x=>x.ingredientId===id).baseUnit}:null,locations:s.inventoryAssignments.filter(a=>a.ingredientId===id).map(a=>({id:a.id,locationId:a.locationId,name:s.inventoryLocations.find(l=>l.id===a.locationId)?.name,countUnit:a.countUnit,active:a.active,sortOrder:a.sortOrder,version:a.version}))};
 if(can(actor,'internal_cost.read')){
  const packages=s.purchaseOptions.filter(p=>p.ingredientId===id).map(p=>({...p,vendor:require('./vendors').supplier(s,p.supplierId),price:current(s.prices.filter(v=>v.purchaseOptionId===p.id))}));
  const selected=packages.find(p=>p.id===basis?.purchaseOptionId),yieldFact=current(s.yields.filter(x=>x.ingredientId===id));
  Object.assign(item,{unitInfo:require('./units').itemUnits(s,id,now),importIssues:s.importRecords.filter(r=>r.entityIds.includes(id)).flatMap(r=>r.issues.map(x=>({reason:x.reason,concept:x.concept,sheet:r.sheet,row:r.sourceRow}))),sourceLocations:s.importRecords.filter(r=>r.entityIds.includes(id)&&r.sheet==='Ingredients').map(r=>r.sourceValues.values.Location).filter(Boolean),basis,packages,measurements:grouped(s.measurements.filter(x=>x.ingredientId===id),'measurementKey',now,now),yield:yieldFact,labor:grouped(s.labor.filter(x=>x.ingredientId===id),'componentKey',now,now)});
  const quantity=basis?.kind==='recipe'?revision?.outputQuantity:selected?.contentQuantity||yieldFact?.outputQuantity||item.labor[0]?.outputQuantity||null,unit=basis?.kind==='recipe'?revision?.outputUnit:selected?.contentUnit||yieldFact?.outputUnit||item.labor[0]?.outputUnit||item.inventory?.baseUnit||null;
  const cost=(quantity,unit)=>costView(costIngredient(s,{ingredientId:id,quantity,unit,at:now,knownAt:now,currency:'USD'}));
  item.cost=cost(quantity||'1',unit||'each');item.costQuantity=quantity;item.costUnit=unit;item.commonCosts=['fl_oz_us','oz_wt','each'].filter(u=>u!==unit).map(u=>({unit:u,result:cost('1',u)})).filter(x=>x.result.completeCost!==null);
 }
 return item;
}
module.exports={saveItem,itemRecord};
