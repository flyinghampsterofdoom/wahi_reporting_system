'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,admin,manager,staff}=require('./helpers');
const {WasteService}=require('../waste/service');
const boh={id:'generic-boh',role:'BOH'};
const entry=(id,rest={})=>({requestId:randomUUID(),ingredientId:id,quantity:'2',unit:'each',reason:'Overproduction',...rest});
test('waste: purchased and prepared identities, batches, exact normalization, cost snapshots and audit',async()=>{
 const f=fixture(),rice=await f.bought('Rice','6','1000','g'),recipe=await f.recipe('Mac Salad',[{ingredientId:rice.id,quantity:'500',unit:'g'}],'1000','g');
 const w=new WasteService(f.repository,{clock:()=> '2026-09-23T12:00:00.000Z'});
 const catalog=await w.catalog(boh);assert.equal(catalog.items.length,2);assert.ok(catalog.items.find(i=>i.id===recipe.output).units.includes('batch'));assert.ok(!JSON.stringify(catalog).includes('cost'));
 const purchased=await w.log(boh,entry(rice.id,{quantity:'0.25',unit:'kg'}));assert.equal(purchased.quantity,'0.25');assert.equal(purchased.unit,'kg');assert.equal(purchased.reason,'Overproduction');assert.equal(purchased.note,'');assert.equal(purchased.cost,undefined);
 await w.log(boh,entry(recipe.output,{quantity:'0.5',unit:'batch',reason:'Other',note:'End of service'}));
 const s=await f.repository.read(),r=s.wasteEvents.find(e=>e.kind==='recipe');assert.equal(r.recipeId,recipe.id);assert.equal(r.snapshot.recipeRevisionId,recipe.revision);assert.equal(r.baseQuantity,'500.000000000000');assert.equal(r.snapshot.cost.amount,'1.500000000000');assert.equal(r.note,'End of service');assert.equal(s.audit.filter(a=>a.entityType==='wasteEvents').length,2);
 assert.equal(s.wasteEvents[0].baseQuantity,'250.000000000000');assert.equal((await w.history(manager,{kind:'recipe',reason:'Other'})).total,1);
 await assert.rejects(w.history(boh),{code:'forbidden'});await assert.rejects(w.catalog(staff),{code:'forbidden'});
});
test('waste: concurrent retries are durable and payload conflicts are rejected',async()=>{
 const f=fixture(),id=await f.ingredient('No inventory setup'),w=new WasteService(f.repository),data=entry(id);
 const results=await Promise.all(Array.from({length:12},()=>w.log(boh,data)));assert.equal(new Set(results.map(r=>r.id)).size,1);
 assert.equal((await new WasteService(f.repository).log(boh,data)).id,results[0].id);
 await assert.rejects(w.log(boh,{...data,quantity:'3'}),{code:'revision_conflict'});
 assert.equal((await f.repository.read()).wasteEvents.length,1);
 for(const quantity of ['0','-1','NaN','1e3'])await assert.rejects(w.log(boh,entry(id,{quantity})));
 await assert.rejects(w.log(boh,entry(id,{unit:'kg'})));await assert.rejects(w.log(boh,{...entry(id),department:'FOH'}));
});
test('waste: history survives rename, archive and price changes; optional notes and date filters',async()=>{
 const f=fixture(),i=await f.bought('Old name'),w=new WasteService(f.repository),data=entry(i.id,{reason:'Other'});const event=await w.log(boh,data);
 await f.run('updateIngredient',{ingredientId:i.id,name:'New name',active:false});await f.run('addPrice',{purchaseOptionId:i.option,amount:'100',currency:'USD'});
 assert.equal((await w.catalog(boh)).items.length,0);assert.equal((await w.log(boh,data)).id,event.id);
 await assert.rejects(w.log(boh,entry(i.id)),{code:'inactive_reference'});
 const history=await w.history(admin,{q:'Old name'});assert.equal(history.events[0].name,'Old name');assert.equal(history.events[0].note,'');assert.equal(history.events[0].cost.amount,'6.000000000000');
 assert.equal((await w.history(admin,{from:'2030-01-01'})).total,0);
});
test('waste: four frequency-driven items stable during a week, scoped by location',async()=>{
 const f=fixture(),ids=[];for(const n of ['A','B','C','D','E'])ids.push(await f.ingredient(n));
 let now='2026-09-20T12:00:00.000Z';const w=new WasteService(f.repository,{clock:()=>now,context:{locationId:'kitchen-a'}});
 for(let n=0;n<5;n++)await w.log(boh,entry(ids[4]));
 now='2026-09-23T12:00:00.000Z';const first=await w.catalog(boh);assert.equal(first.common.length,4);assert.equal(first.common[0].id,ids[4]);
 for(let n=0;n<10;n++)await w.log(boh,entry(ids[3]));assert.deepEqual((await w.catalog(boh)).common,first.common);
 const other=new WasteService(f.repository,{clock:()=>now,context:{locationId:'kitchen-b'}});assert.equal((await other.catalog(boh)).common[0].id,ids[0]);
 now='2026-09-28T12:00:00.000Z';assert.equal((await w.catalog(boh)).common[0].id,ids[3]);
});
test('waste: unresolved conversions and costs do not stop operational entry',async()=>{
 const f=fixture(),i=await f.bought('Ginger','2','1','g');await f.service.inventory.execute(admin,'configureItem',{ingredientId:i.id,baseUnit:'g'});await f.run('addMeasurement',{ingredientId:i.id,fromQuantity:'1',fromUnit:'op:scoop',toQuantity:'1',toUnit:'cup_us'});
 const w=new WasteService(f.repository);await w.log(boh,entry(i.id,{unit:'op:scoop'}));const e=(await f.repository.read()).wasteEvents[0];assert.equal(e.baseQuantity,null);assert.equal(e.snapshot.cost.amount,null);
});
