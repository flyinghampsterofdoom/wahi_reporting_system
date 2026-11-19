"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const swap=require('../review/ingredient-swap'),{fixture,admin,manager,lead,staff,early}=require('./helpers');
const {latest}=require('../domain/history'),{activeMeasurements}=require('../domain/measurements');
const replacement=()=>({name:'Synthetic replacement',allergens:['Milk'],purchase:{amount:'9',contentQuantity:'18',contentUnit:'fl_oz_us'},measurementMode:'inherit',measurements:[]});
function request(context,values={}){return {originalId:context.original.id,expectedState:context.expectedState,replacement:replacement(),recipes:context.recipes.map(r=>({recipeId:r.recipeId,expectedRevisionId:r.expectedRevisionId,selected:r.selected,lines:r.lines.map(({lineId,quantity})=>({lineId,quantity}))})),...values};}
async function menu(f,name,recipeId,amount,quantity='1',unit='each'){
 const id=(await f.run('createMenuItem',{name})).id;
 await f.run('setSellingPrice',{menuItemId:id,amount,currency:'USD',effectiveAt:early});
 await f.run('setMenuMapping',{menuItemId:id,recipeId,quantity,unit,effectiveAt:early});return id;
}
async function setup(){
 const f=fixture(),original=await f.bought('Synthetic original','12','12','fl_oz_us'),extra=await f.bought('Synthetic unchanged garnish','1','1','each');
 const a=await f.recipe('Synthetic first recipe',[{ingredientId:original.id,quantity:'1.5',unit:'fl_oz_us',notes:'First original line'},{ingredientId:original.id,quantity:'0.5',unit:'fl_oz_us',notes:'Second original line'},{ingredientId:extra.id,quantity:'2',unit:'each',notes:'Keep this garnish'}],'2','each');
 const b=await f.recipe('Synthetic second recipe',[{ingredientId:original.id,quantity:'3',unit:'fl_oz_us'}]);
 await menu(f,'Synthetic first menu serving',a.id,'10');await menu(f,'Synthetic second menu serving',b.id,'6');
 return {...f,original,extra,a,b,context:await swap.context(f.service,admin,{originalId:original.id})};
}
const row=(input,recipe)=>input.recipes.find(r=>r.recipeId===recipe.id),comparison=(result,recipe)=>result.comparisons.find(r=>r.recipeId===recipe.id);
const now='2026-12-01T00:00:00.000Z';
test('ingredient swap: context selects every direct recipe and preview preserves all production state',async()=>{
 const f=await setup(),before=await f.repository.read(),input=request(f.context);assert.equal(f.context.recipes.length,2);assert.ok(f.context.recipes.every(r=>r.selected));assert.equal(row(input,f.a).lines.length,2);
 row(input,f.a).lines[0].quantity='2.5';const untouched=structuredClone(input),result=await swap.preview(f.service,manager,input),a=comparison(result,f.a);
 assert.deepEqual(await f.repository.read(),before);assert.deepEqual(input,untouched);
 assert.equal(a.current.recipeCost,'4.000000000000');assert.equal(a.hypothetical.recipeCost,'3.500000000000');
 assert.deepEqual(a.current.menus.map(m=>[m.recipeCost,m.sellingPrice,m.foodCostPercent,m.grossMarginPercent]),[['2.000000000000','10','20.0000','80.0000']]);
 assert.deepEqual(a.hypothetical.menus.map(m=>[m.recipeCost,m.sellingPrice,m.foodCostPercent,m.grossMarginPercent]),[['1.750000000000','10','17.5000','82.5000']]);
});
test('ingredient swap: exclusions stay visible and retain independently adjusted hypothetical quantities',async()=>{
 const f=await setup(),input=request(f.context);row(input,f.b).selected=false;row(input,f.b).lines[0].quantity='1';
 const before=await f.repository.read(),first=await swap.preview(f.service,admin,input);assert.equal(comparison(first,f.b).selected,false);assert.equal(comparison(first,f.b).current.recipeCost,'3.000000000000');assert.equal(comparison(first,f.b).hypothetical.recipeCost,'0.500000000000');
 assert.equal(comparison(first,f.b).hypothetical.menus[0].foodCostPercent,'8.3333');input.replacement.purchase.amount='18';const changed=await swap.preview(f.service,admin,input);assert.equal(comparison(changed,f.b).hypothetical.recipeCost,'1.000000000000');
 row(input,f.b).selected=true;assert.equal(comparison(await swap.preview(f.service,admin,input),f.b).hypothetical.recipeCost,'1.000000000000');assert.equal(row(input,f.b).lines[0].quantity,'1');assert.deepEqual(await f.repository.read(),before);
});
test('ingredient swap: confirmed selected apply appends revisions, preserves excluded recipes and historical evidence',async()=>{
 const f=await setup(),input=request(f.context);row(input,f.b).selected=false;row(input,f.b).lines[0].quantity='99';row(input,f.a).lines[0].quantity='2.5';
 const before=await f.repository.read(),result=await swap.apply(f.service,manager,{...input,confirmed:true}),after=await f.repository.read();assert.deepEqual(result.updatedRecipes.map(r=>r.recipeId),[f.a.id]);
 assert.deepEqual(after.recipeRevisions.filter(r=>r.recipeId===f.b.id),before.recipeRevisions.filter(r=>r.recipeId===f.b.id));for(const revision of before.recipeRevisions)assert.deepEqual(after.recipeRevisions.find(r=>r.id===revision.id),revision);
 const next=latest(after.recipeRevisions.filter(r=>r.recipeId===f.a.id),now,now),old=before.recipeRevisions.find(r=>r.id===f.a.revision);assert.equal(next.lines[0].ingredientId,result.replacementId);assert.equal(next.lines[1].ingredientId,result.replacementId);assert.deepEqual(next.lines.map(l=>[l.quantity,l.unit,l.notes]),[['2.5','fl_oz_us','First original line'],['0.5','fl_oz_us','Second original line'],['2','each','Keep this garnish']]);
 assert.equal(next.lines[2].ingredientId,f.extra.id);assert.equal(next.outputQuantity,old.outputQuantity);assert.equal(next.outputUnit,old.outputUnit);assert.deepEqual(next.steps.map(s=>s.instruction),old.steps.map(s=>s.instruction));
 assert.deepEqual(after.ingredients.find(i=>i.id===result.replacementId).allergens,['Milk']);assert.deepEqual(after.prices.filter(p=>p.purchaseOptionId===f.original.option),before.prices.filter(p=>p.purchaseOptionId===f.original.option));assert.ok(after.audit.length>before.audit.length);
 assert.equal((await f.cost(f.a.output,'2','each',{at:'2026-09-01T00:00:00.000Z'})).completeCost,'4.000000000000');assert.equal((await f.cost(f.a.output,'2','each')).completeCost,'3.500000000000');
});
test('ingredient swap: inherit and new measurements use exact existing conversion resolution',async()=>{
 const f=fixture(),original=await f.bought('Synthetic measured original','12','12','fl_oz_us');await f.run('addMeasurement',{ingredientId:original.id,fromQuantity:'1',fromUnit:'g',toQuantity:'2',toUnit:'fl_oz_us',effectiveAt:early});const recipe=await f.recipe('Synthetic measured recipe',[{ingredientId:original.id,quantity:'2',unit:'g'}]);const context=await swap.context(f.service,admin,{originalId:original.id}),input=request(context),before=await f.repository.read();
 assert.equal(comparison(await swap.preview(f.service,admin,input),recipe).hypothetical.recipeCost,'2.000000000000');input.replacement.measurementMode='new';input.replacement.measurements=[{fromQuantity:'1',fromUnit:'g',toQuantity:'3',toUnit:'fl_oz_us'}];assert.equal(comparison(await swap.preview(f.service,admin,input),recipe).hypothetical.recipeCost,'3.000000000000');
 input.replacement.measurements=[];const missing=comparison(await swap.preview(f.service,admin,input),recipe).hypothetical;assert.equal(missing.recipeCost,null);assert.ok(missing.blockers.includes('unresolved_missing_measurement'));assert.deepEqual(await f.repository.read(),before);
});
test('ingredient swap: existing replacement measurements are revised without deleting their history',async()=>{
 const f=fixture(),original=await f.bought('Synthetic original density','12','12','fl_oz_us'),existing=await f.bought('Synthetic existing replacement','24','12','fl_oz_us');
 for(const [ingredientId,toQuantity]of [[original.id,'2'],[existing.id,'7']])await f.run('addMeasurement',{ingredientId,fromQuantity:'1',fromUnit:'g',toQuantity,toUnit:'fl_oz_us',effectiveAt:early});const recipe=await f.recipe('Synthetic density recipe',[{ingredientId:original.id,quantity:'2',unit:'g'}]);
 const context=await swap.context(f.service,admin,{originalId:original.id,replacementId:existing.id});assert.equal(context.replacement.name,'Synthetic existing replacement');const input=request(context);delete input.replacement.name;input.replacement.ingredientId=existing.id;const before=await f.repository.read(),result=await swap.apply(f.service,admin,{...input,confirmed:true}),after=await f.repository.read();assert.equal(result.replacementId,existing.id);
 const active=activeMeasurements(after,existing.id,now,now);assert.equal(active.length,1);assert.equal(active[0].toQuantity,'2');for(const measurement of before.measurements)assert.deepEqual(after.measurements.find(m=>m.id===measurement.id),measurement);assert.equal((await f.cost(recipe.output)).completeCost,'2.000000000000');
});
test('ingredient swap: unresolved selling prices and zero price percentages stay unavailable',async()=>{
 const f=await setup(),unpriced=(await f.run('createMenuItem',{name:'Synthetic missing selling price'})).id;await f.run('setMenuMapping',{menuItemId:unpriced,recipeId:f.a.id,quantity:'1',unit:'each',effectiveAt:early});await menu(f,'Synthetic zero selling price',f.a.id,'0');
 const context=await swap.context(f.service,admin,{originalId:f.original.id}),input=request(context);input.replacement.purchase.amount='0';const a=comparison(await swap.preview(f.service,admin,input),f.a);assert.equal(a.hypothetical.recipeCost,'2.000000000000');
 for(const m of a.hypothetical.menus.filter(m=>m.sellingPrice===null||m.sellingPrice==='0')){assert.equal(m.foodCostPercent,null);assert.equal(m.grossMarginPercent,null);}assert.equal(a.hypothetical.menus.find(m=>m.sellingPrice==='10').foodCostPercent,'10.0000');
});
test('ingredient swap: later recipe failure rolls back replacement creation, measurements, prices, earlier revisions and audit',async()=>{
 const f=await setup(),archived=await f.bought('Synthetic legacy archived component');await f.run('reviseRecipe',{recipeId:f.b.id,outputQuantity:'1',outputUnit:'each',lines:[{ingredientId:f.original.id,quantity:'3',unit:'fl_oz_us'},{ingredientId:archived.id,quantity:'1',unit:'each'}],steps:['Retain this historical preparation']});await f.run('setArchived',{collection:'ingredients',entityId:archived.id,archived:true});const context=await swap.context(f.service,admin,{originalId:f.original.id}),input=request(context),before=await f.repository.read();await assert.rejects(swap.apply(f.service,admin,{...input,confirmed:true}),/Archived ingredients reference/);assert.deepEqual(await f.repository.read(),before);
});
test('ingredient swap: stale state, stale revisions and omitted recipes reject without mutations',async()=>{
 const f=await setup(),input=request(f.context),before=await f.repository.read(),badRevision=structuredClone(input);badRevision.recipes[0].expectedRevisionId=randomUUID();await assert.rejects(swap.preview(f.service,admin,badRevision),{code:'swap_stale'});assert.deepEqual(await f.repository.read(),before);
 const omitted=structuredClone(input);omitted.recipes.pop();await assert.rejects(swap.apply(f.service,admin,{...omitted,confirmed:true}),{code:'swap_stale'});assert.deepEqual(await f.repository.read(),before);
 await f.run('addPrice',{purchaseOptionId:f.original.option,amount:'13',currency:'USD'});const changed=await f.repository.read();await assert.rejects(swap.apply(f.service,admin,{...input,confirmed:true}),{code:'swap_stale'});assert.deepEqual(await f.repository.read(),changed);
});
test('ingredient swap: concurrent confirmed applies have one winner and no partial duplicate replacement',async()=>{
 const f=await setup(),input=request(f.context);row(input,f.b).selected=false;const before=await f.repository.read(),results=await Promise.allSettled([swap.apply(f.service,admin,{...input,confirmed:true}),swap.apply(f.service,manager,{...input,confirmed:true})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'swap_stale');const after=await f.repository.read();assert.equal(after.ingredients.length,before.ingredients.length+1);assert.equal(after.recipeRevisions.length,before.recipeRevisions.length+1);
});
test('ingredient swap: role, confirmation, selection and ingredient identity checks fail before commit',async()=>{
 const f=await setup(),input=request(f.context),before=await f.repository.read();for(const actor of [staff,lead]){await assert.rejects(swap.context(f.service,actor,{originalId:f.original.id}),{code:'forbidden'});await assert.rejects(swap.preview(f.service,actor,input),{code:'forbidden'});await assert.rejects(swap.apply(f.service,actor,{...input,confirmed:true}),{code:'forbidden'});}
 await assert.rejects(swap.apply(f.service,admin,input),{code:'swap_confirmation_required'});const none=structuredClone(input);none.recipes.forEach(r=>r.selected=false);await assert.rejects(swap.apply(f.service,admin,{...none,confirmed:true}),{code:'invalid_request'});
 const same=structuredClone(input);delete same.replacement.name;same.replacement.ingredientId=f.original.id;await assert.rejects(swap.preview(f.service,admin,same),{code:'invalid_request'});assert.deepEqual(await f.repository.read(),before);
});
test('ingredient swap: existing replacement use elsewhere is disclosed before confirmation',async()=>{
 const f=await setup(),existing=await f.bought('Synthetic reused replacement','6','6','fl_oz_us'),unrelated=await f.recipe('Synthetic existing replacement recipe',[{ingredientId:existing.id,quantity:'1',unit:'fl_oz_us'}]);const context=await swap.context(f.service,admin,{originalId:f.original.id}),input=request(context);delete input.replacement.name;input.replacement.ingredientId=existing.id;
 const before=await f.repository.read(),result=await swap.preview(f.service,admin,input);assert.deepEqual(result.otherReplacementRecipes,[{id:unrelated.id,name:'Synthetic existing replacement recipe'}]);assert.deepEqual(await f.repository.read(),before);
});

test('ingredient swap: replacement calculations retain existing recipe labor allocations',async()=>{
 const f=await setup();await f.run('setLabor',{ingredientId:f.a.output,kind:'fixed',outputQuantity:'2',outputUnit:'each',amount:'2',currency:'USD',effectiveAt:early});const context=await swap.context(f.service,admin,{originalId:f.original.id}),input=request(context),before=await f.repository.read(),a=comparison(await swap.preview(f.service,admin,input),f.a);assert.equal(a.current.recipeCost,'6.000000000000');assert.equal(a.hypothetical.recipeCost,'5.000000000000');assert.equal(a.hypothetical.menus[0].recipeCost,'2.500000000000');assert.equal(a.hypothetical.menus[0].foodCostPercent,'25.0000');assert.equal(a.hypothetical.menus[0].grossMarginPercent,'75.0000');assert.deepEqual(await f.repository.read(),before);
});

test('ingredient swap: choosing a selected recipe output rejects circular substitution before commit',async()=>{
 const f=await setup(),input=request(f.context);delete input.replacement.name;input.replacement.ingredientId=f.b.output;const before=await f.repository.read();await assert.rejects(swap.preview(f.service,admin,input),{code:'cycle'});await assert.rejects(swap.apply(f.service,admin,{...input,confirmed:true}),{code:'cycle'});assert.deepEqual(await f.repository.read(),before);
});
for(const kind of ['price','measurement'])test(`ingredient swap: a scheduled ${kind} activation invalidates comparison without a stored-state change`,async()=>{
 const f=await setup();let at='2026-09-20T00:00:00.000Z';f.service.clock=()=>at;const effectiveAt='2026-10-01T00:00:00.000Z';
 if(kind==='price')await f.run('addPrice',{purchaseOptionId:f.original.option,amount:'13',currency:'USD',effectiveAt});
 else{const measurement=await f.run('addMeasurement',{ingredientId:f.original.id,fromQuantity:'1',fromUnit:'g',toQuantity:'2',toUnit:'fl_oz_us',effectiveAt:early});await f.run('addMeasurement',{ingredientId:f.original.id,measurementKey:measurement.measurementKey,fromQuantity:'1',fromUnit:'g',toQuantity:'3',toUnit:'fl_oz_us',effectiveAt});}
 const context=await swap.context(f.service,admin,{originalId:f.original.id}),input=request(context),before=await f.repository.read();await swap.preview(f.service,admin,input);assert.deepEqual(await f.repository.read(),before);at='2026-10-01T00:00:00.001Z';
 assert.notEqual((await swap.context(f.service,admin,{originalId:f.original.id})).expectedState,context.expectedState);await assert.rejects(swap.preview(f.service,admin,input),{code:'swap_stale'});await assert.rejects(swap.apply(f.service,admin,{...input,confirmed:true}),{code:'swap_stale'});assert.deepEqual(await f.repository.read(),before);
});
test('ingredient swap: replacement-cost disclosure includes nested and source-yield recipe users',async()=>{
 const f=await setup(),existing=await f.bought('Synthetic shared replacement','6','6','fl_oz_us');const direct=await f.recipe('Synthetic direct replacement user',[{ingredientId:existing.id,quantity:'1',unit:'fl_oz_us'}]),yielded=await f.derived('Synthetic source-yield replacement',existing.id,'2','fl_oz_us','4','g'),sourceRecipe=await f.recipe('Synthetic source-yield recipe user',[{ingredientId:yielded,quantity:'2',unit:'g'}]),nested=await f.recipe('Synthetic nested replacement user',[{ingredientId:direct.output,quantity:'1',unit:'each'},{ingredientId:sourceRecipe.output,quantity:'1',unit:'each'}]);const context=await swap.context(f.service,admin,{originalId:f.original.id}),input=request(context);delete input.replacement.name;input.replacement.ingredientId=existing.id;const before=await f.repository.read(),result=await swap.preview(f.service,admin,input);assert.deepEqual(result.otherReplacementRecipes.map(r=>r.id).sort(),[direct.id,sourceRecipe.id,nested.id].sort());assert.equal(new Set(result.otherReplacementRecipes.map(r=>r.id)).size,3);assert.deepEqual(await f.repository.read(),before);
});
