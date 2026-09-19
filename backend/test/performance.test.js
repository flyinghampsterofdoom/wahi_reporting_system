'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,admin,staff,lead}=require('./helpers');
const {costIngredient}=require('../domain/costing');
const {resolveConversion}=require('../domain/measurements');
const {enableResolutionCache,context}=require('../domain/resolution-context');
const {view,itemHistory}=require('../review/views');

test('request-scoped memoization preserves exact recursive results, references, quantities and dates',async()=>{
 const f=fixture(),a=await f.bought('Memo ingredient','0.573846153846153846','1','fl_oz_us');
 await f.run('addMeasurement',{ingredientId:a.id,fromQuantity:'1',fromUnit:'drop',toQuantity:'0.00113636',toUnit:'fl_oz_us'});
 const r=await f.recipe('Memo nested',[{ingredientId:a.id,quantity:'5',unit:'drop'},{ingredientId:a.id,quantity:'5',unit:'drop'}]);
 const s=await f.repository.read(),memo=enableResolutionCache(structuredClone(s)),at='2027-01-01T00:00:00.000Z';
 for(const quantity of ['1','2','0.0001','1']){const req={ingredientId:r.output,quantity,unit:'each',at,knownAt:at};assert.deepEqual(costIngredient(memo,req),costIngredient(s,req));}
 assert.ok(context(memo).stats.costHits>0);
 for(const quantity of ['1','2','5','-1','bad']){const req={ingredientId:a.id,quantity,fromUnit:'drop',toUnit:'fl_oz_us',at,knownAt:at};assert.deepEqual(resolveConversion(memo,req),resolveConversion(s,req));}
 assert.ok(context(memo).stats.conversionHits>0);assert.deepEqual(costIngredient(memo,{ingredientId:r.output,quantity:'1',unit:'each',at:'2020-01-01T00:00:00.000Z',knownAt:at}),costIngredient(s,{ingredientId:r.output,quantity:'1',unit:'each',at:'2020-01-01T00:00:00.000Z',knownAt:at}));
});

test('memoization never reuses unresolved caller-specific blocker paths',async()=>{
 const f=fixture(),missing=await f.ingredient('Unresolved memo source'),r=await f.recipe('Unresolved memo root',[{ingredientId:missing,quantity:'1',unit:'each'},{ingredientId:missing,quantity:'1',unit:'each'}]);const s=await f.repository.read(),m=enableResolutionCache(structuredClone(s)),at='2027-01-01T00:00:00.000Z';
 for(const id of [missing,r.output,missing,r.output]){const req={ingredientId:id,quantity:'1',unit:'each',at,knownAt:at};assert.deepEqual(costIngredient(m,req),costIngredient(s,req));}
});

test('compact DTOs omit formulas/history/evidence and preserve Staff/Lead cost restrictions',async()=>{
 const f=fixture(),a=await f.bought('Compact'),r=await f.recipe('Compact recipe',[{ingredientId:a.id,quantity:'1',unit:'each'}]);
 await f.run('updateIngredient',{ingredientId:a.id,name:'Compact',description:'Searchable detail',category:'',tags:[],active:true});
 const items=await view(f.service,admin,'items'),recipes=await view(f.service,admin,'recipes');assert.equal(require('../review/public/table-model').select(items.items,{query:'Searchable detail'}).length,1);assert.ok(items.items.find(i=>i.id===a.id).cost);assert.equal(recipes.recipes.find(x=>x.id===r.id).revision.lines,undefined);assert.ok(items.items.every(i=>!('audit' in i)&&!('importRecords' in i)&&!('measurements' in i)&&!('references' in i.cost)));
 for(const actor of [staff,lead]){const items=await view(f.service,actor,'items'),recipes=await view(f.service,actor,'recipes'),item=await view(f.service,actor,'item',a.id),recipe=await view(f.service,actor,'recipe',r.id);assert.ok(items.items.every(i=>!i.cost&&!i.purchase&&!i.vendors));assert.ok(recipes.recipes.every(i=>!i.cost));assert.equal(item.packages,undefined);assert.equal(recipe.recipe.cost,undefined);await assert.rejects(itemHistory(f.service,actor,a.id),e=>e.code==='forbidden');}
});

test('real Wahi compact current costs match authoritative calculations for every imported item/recipe',async()=>{
 const source=require('./fixtures/wahi-source.json'),{build}=require('../import/importer'),{MemoryRepository}=require('../repository/memory'),{DomainService}=require('../service'),{management}=require('../review/management');
 const at='2026-09-18T00:00:00.000Z',{state}=await build(source,{activationAt:at}),svc=new DomainService(new MemoryRepository(state),{clock:()=>at}),full=await management(svc,admin);
 for(const kind of ['items','recipes']){const rows=(await view(svc,admin,kind))[kind];for(const r of rows)assert.equal(r.cost?.completeCost,full[kind].find(x=>x.id===r.id).cost?.completeCost);}
});
