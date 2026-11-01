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
 await assert.rejects(w.history(boh),{code:'forbidden'});assert.ok((await w.catalog(staff)).items.length);
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
test('waste: six rolling 90-day favorites update immediately and count events rather than quantities',async()=>{
 const f=fixture(),ids=[];for(const n of ['A','B','C','D','E','F','G'])ids.push(await f.ingredient(n));let now='2026-08-01T12:00:00.000Z';const w=new WasteService(f.repository,{clock:()=>now,context:{locationId:'kitchen-a'}});
 await w.log(boh,entry(ids[0],{quantity:'10000'}));now='2026-09-01T12:00:00.000Z';for(let i=0;i<3;i++)await w.log(boh,entry(ids[6]));assert.equal((await w.catalog(boh)).common.length,6);assert.equal((await w.catalog(boh)).common[0].id,ids[6]);
 for(let i=0;i<4;i++)await w.log(boh,entry(ids[5]));assert.equal((await w.catalog(boh)).common[0].id,ids[5]);now='2026-12-02T12:00:00.000Z';assert.ok((await w.catalog(boh)).common.every(i=>i.frequency===0));assert.equal((await f.repository.read()).wasteCommonSets.length,0);
});
test('waste: unresolved conversions and costs do not stop operational entry',async()=>{
 const f=fixture(),i=await f.bought('Ginger','2','1','g');await f.service.inventory.execute(admin,'configureItem',{ingredientId:i.id,baseUnit:'g'});await f.run('addMeasurement',{ingredientId:i.id,fromQuantity:'1',fromUnit:'op:scoop',toQuantity:'1',toUnit:'cup_us'});
 const w=new WasteService(f.repository);await w.log(boh,entry(i.id,{unit:'op:scoop'}));const e=(await f.repository.read()).wasteEvents[0];assert.equal(e.baseQuantity,null);assert.equal(e.snapshot.cost.amount,null);
});

test('waste: Drink category excludes both identities, cached/common frequency and Admin preview without hiding history',async()=>{await require('./waste-drink-scenario').scenario(fixture());});
