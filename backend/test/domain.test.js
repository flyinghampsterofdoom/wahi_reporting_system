'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,admin,manager,lead,staff,early}=require('./helpers');
const {Exact:E}=require('../domain/exact');
const {costIngredient}=require('../domain/costing');
const {CAPABILITIES,authorize}=require('../auth');
const {randomUUID}=require('node:crypto');
const eq=(actual,expected)=>assert.ok(E.of(actual).eq(E.of(expected)),`${actual} != ${expected}`);

test('exact decimal arithmetic avoids binary floating point and rounds only at output',()=>{
  assert.ok(E.of('0.1').add('0.2').eq('0.3'));
  assert.ok(E.of('1').div('3').mul('3').eq('1'));
  assert.equal(E.of('-1.005').decimal(2),'-1.01');
  assert.throws(()=>E.of(0.1));assert.throws(()=>E.of('NaN'));assert.throws(()=>E.of('1').div('0'));
});

test('all required standard conversions, including inverse paths and unambiguous ounces',async()=>{
  const f=fixture(),id=await f.ingredient('Measure');
  for(const [fromUnit,toUnit,quantity,expected] of [['lb','oz_wt','1','16'],['oz_wt','g','1','28.349523125'],['g','kg','1000','1'],['gallon_us','fl_oz_us','1','128'],['cup_us','mL','1','236.5882365'],['L','pint_us','0.473176473','1'],['quart_us','tbsp_us','1','64'],['tbsp_us','tsp_us','1','3'],['each','each','3','3']]) {
    const r=await f.service.convert(staff,{ingredientId:id,quantity,fromUnit,toUnit});assert.equal(r.status,'resolved');eq(r.amount,expected);
  }
  assert.equal((await f.service.convert(admin,{ingredientId:id,quantity:'1',fromUnit:'oz',toUnit:'g'})).status,'invalid_request');
});

test('ingredient-specific density resolves both directions across mass and volume',async()=>{
  const f=fixture(),id=await f.ingredient('Coconut Cream');
  await f.run('addMeasurement',{ingredientId:id,fromQuantity:'8',fromUnit:'fl_oz_us',toQuantity:'9.4',toUnit:'oz_wt'});
  for(const [fromUnit,toUnit,quantity,expected] of [['fl_oz_us','g','8','266.485517375'],['g','fl_oz_us','266.485517375','8'],['cup_us','lb','1','0.5875'],['lb','cup_us','0.5875','1'],['mL','oz_wt','236.5882365','9.4'],['oz_wt','mL','9.4','236.5882365']]) {
    const r=await f.service.convert(admin,{ingredientId:id,quantity,fromUnit,toUnit});eq(r.amount,expected);
  }
});

test('fluid and mass dashes, drops and custom servings never leak across ingredients',async()=>{
  const f=fixture(),a=await f.ingredient('Bitters'),b=await f.ingredient('Other bitters'),c=await f.ingredient('Nutmeg');
  await f.run('addMeasurement',{ingredientId:a,fromQuantity:'1',fromUnit:'dash_fluid',toQuantity:'0.00625',toUnit:'fl_oz_us'});
  await f.run('addMeasurement',{ingredientId:c,fromQuantity:'1',fromUnit:'dash_mass',toQuantity:'0.134',toUnit:'g'});
  for(const [id,fromUnit,toUnit,expected]of [[a,'dash_fluid','fl_oz_us','0.0125'],[c,'dash_mass','g','0.268']])eq((await f.service.convert(admin,{ingredientId:id,quantity:'2',fromUnit,toUnit})).amount,expected);
  for(const fromUnit of ['dash_fluid','dash_mass','drop','pump','op:ladle'])assert.equal((await f.service.convert(admin,{ingredientId:b,quantity:'1',fromUnit,toUnit:'mL'})).status,'unresolved_missing_measurement');
  await assert.rejects(f.run('addMeasurement',{ingredientId:c,fromQuantity:'1',fromUnit:'dash_mass',toQuantity:'1',toUnit:'mL'}));
});

test('count bridge resolves each to grams and back; multi-bridge paths reach volume',async()=>{
  const f=fixture(),id=await f.ingredient('Lime, Whole');
  await f.run('addMeasurement',{ingredientId:id,fromQuantity:'1',fromUnit:'each',toQuantity:'3.1',toUnit:'oz_wt'});
  eq((await f.service.convert(admin,{ingredientId:id,quantity:'1',fromUnit:'each',toUnit:'g'})).amount,'87.8835216875');
  eq((await f.service.convert(admin,{ingredientId:id,quantity:'87.8835216875',fromUnit:'g',toUnit:'each'})).amount,'1');
  await f.run('addMeasurement',{ingredientId:id,fromQuantity:'87.8835216875',fromUnit:'g',toQuantity:'80',toUnit:'mL'});
  eq((await f.service.convert(admin,{ingredientId:id,quantity:'2',fromUnit:'each',toUnit:'mL'})).amount,'160');
});

test('conflicting paths are reported with measurement evidence, even on standard-family requests',async()=>{
  const f=fixture(),id=await f.ingredient('Conflict');
  for(const toQuantity of ['10','20'])await f.run('addMeasurement',{ingredientId:id,fromQuantity:'1',fromUnit:'each',toQuantity,toUnit:'g'});
  const r=await f.service.convert(admin,{ingredientId:id,quantity:'1',fromUnit:'each',toUnit:'g'});
  assert.equal(r.status,'conflicting_measurement');assert.equal(r.measurementIds.length,2);
  await assert.rejects(f.run('addMeasurement',{ingredientId:id,fromQuantity:'0',fromUnit:'each',toQuantity:'1',toUnit:'g'}));
});

test('pineapple $3 / 12 spears costs $0.25; independent yields have no allocation',async()=>{
  const f=fixture(),a=await f.bought('Pineapple');const b=await f.derived('Spears',a.id),c=await f.derived('Flesh',a.id,'1','each','12','oz_wt');
  const result=await f.cost(b);eq(result.completeCost,'0.25');eq(result.laborSubtotal,'0');
  eq((await f.cost(c,'28.349523125','g')).completeCost,'0.25');
});

test('missing yield saves and propagates; seven resolved lines preserve subtotal and counts',async()=>{
  const f=fixture(),a=await f.bought('Pineapple'),dash=await f.ingredient('Pineapple, Dash');
  await f.run('setYield',{ingredientId:dash,sourceIngredientId:a.id});
  const p=await f.bought('Priced','0.55'),extra=await f.bought('Other','0.57');
  const lines=[...Array.from({length:6},()=>({ingredientId:p.id,quantity:'1',unit:'each'})),{ingredientId:extra.id,quantity:'1',unit:'each'},{ingredientId:dash,quantity:'1',unit:'each'}];
  const cocktail=await f.recipe('Cocktail',lines),r=await f.cost(cocktail.output);
  assert.equal(r.status,'unresolved');assert.equal(r.completeCost,null);eq(r.knownSubtotal,'3.87');assert.equal(r.resolvedComponents,7);assert.equal(r.totalComponents,8);
  assert.equal(r.blockers[0].reason,'missing_yield');assert.deepEqual(r.blockers[0].path,[cocktail.output,dash]);
  const nested=await f.recipe('Nested',[{ingredientId:cocktail.output,quantity:'2',unit:'each'}]);
  const n=await f.cost(nested.output);assert.equal(n.completeCost,null);eq(n.knownSubtotal,'7.74');
  await f.run('setYield',{ingredientId:dash,sourceIngredientId:a.id,sourceQuantity:'1',sourceUnit:'each',outputQuantity:'30',outputUnit:'each'});
  eq((await f.cost(nested.output)).completeCost,'7.94');
});

test('missing physical bridge does not prevent source or recipe save and later resolves automatically',async()=>{
  const f=fixture(),b=await f.bought('Ginger, Fresh','10','100','mL');
  const c=await f.derived('Derived',b.id,'100','g','10','each');
  const recipe=await f.recipe('Recipe',[{ingredientId:c,quantity:'1',unit:'each'}]);
  const r=await f.cost(recipe.output);assert.equal(r.completeCost,null);assert.equal(r.blockers[0].reason,'unresolved_missing_measurement');assert.equal(r.blockers[0].ingredientId,b.id);
  assert.deepEqual(r.blockers[0].conversion.requiredBridge,{from:'mass',to:'volume'});
  await f.run('addMeasurement',{ingredientId:b.id,fromQuantity:'100',fromUnit:'g',toQuantity:'100',toUnit:'mL'});
  eq((await f.cost(recipe.output)).completeCost,'1');
});

test('resolved zero water differs from unpriced ingredient and is never auto-added',async()=>{
  const f=fixture(),water=await f.bought('Water','0','1','mL'),unknown=await f.ingredient('Unknown');
  const r=await f.cost(water.id,'500','mL');assert.equal(r.status,'resolved');eq(r.completeCost,'0');
  const missing=await f.cost(unknown);assert.equal(missing.status,'unresolved');assert.equal(missing.completeCost,null);
  const sugar=await f.bought('Sugar','1','1','g'),syrup=await f.recipe('Syrup',[{ingredientId:sugar.id,quantity:'10',unit:'g'}],'100','mL');
  assert.equal((await f.service.recipe(staff,syrup.id)).revision.lines.length,1);
  eq((await f.cost(syrup.output,'10','mL')).completeCost,'1');
});

test('multiple purchasing options require explicit selection; package is not a global unit',async()=>{
  const f=fixture(),a=await f.bought('Pineapple','3');
  const o=(await f.run('createPurchaseOption',{ingredientId:a.id,label:'Case of 6',contentQuantity:'6',contentUnit:'each'})).id;
  await f.run('addPrice',{purchaseOptionId:o,amount:'12',currency:'USD'});
  eq((await f.cost(a.id)).completeCost,'3');
  await f.run('selectBasis',{ingredientId:a.id,kind:'purchase',purchaseOptionId:o});eq((await f.cost(a.id)).completeCost,'2');
  await assert.rejects(f.run('createPurchaseOption',{ingredientId:a.id,label:'Ambiguous case',contentQuantity:'1',contentUnit:'case'}));
});

test('multi-generation source/source/recipe traversal preserves exact arithmetic',async()=>{
  const f=fixture(),a=await f.bought('A','12'),b=await f.derived('B',a.id,'1','each','3','each'),c=await f.derived('C',b,'2','each','8','each');
  const d=await f.recipe('D',[{ingredientId:c,quantity:'5',unit:'each'}]);eq((await f.cost(d.output)).completeCost,'5');
});

test('fixed labor preserves legacy allocation with no inferred time or department',async()=>{
  const f=fixture(),id=await f.ingredient('Fronds');await f.run('selectBasis',{ingredientId:id,kind:'labor_only'});
  await f.run('setLabor',{ingredientId:id,kind:'fixed',amount:'25',currency:'USD',outputQuantity:'180',outputUnit:'each'});
  const r=await f.cost(id,'180');eq(r.completeCost,'25');eq(r.materialSubtotal,'0');eq(r.laborSubtotal,'25');
  const l=(await f.repository.read()).labor[0];assert.equal(l.department,null);assert.equal(l.minutes,null);
});

test('time labor uses dated department rates and nested material/labor remain separate',async()=>{
  const f=fixture(),a=await f.bought('Material','2'),b=await f.derived('Prepared',a.id,'1','each','1','each');
  await f.run('setLaborRate',{department:'BOH',amount:'20',currency:'USD',effectiveAt:early});
  await f.run('setLabor',{ingredientId:b,kind:'time',minutes:'18',department:'BOH',outputQuantity:'1',outputUnit:'each',effectiveAt:early});
  const c=await f.recipe('Final',[{ingredientId:b,quantity:'2',unit:'each'}]);
  const r=await f.cost(c.output);eq(r.materialSubtotal,'4');eq(r.laborSubtotal,'12');eq(r.completeCost,'16');
  await f.run('setLaborRate',{department:'BOH',amount:'30',currency:'USD',effectiveAt:'2026-09-01T00:00:00Z'});
  eq((await f.cost(c.output,'1','each',{at:'2026-08-20T00:00:00Z'})).laborSubtotal,'12');
  eq((await f.cost(c.output)).laborSubtotal,'18');
});

test('configured incomplete labor or missing department rate leaves complete cost null',async()=>{
  const f=fixture(),a=await f.bought('Prep','4');
  const l=await f.run('setLabor',{ingredientId:a.id,kind:'time',outputQuantity:'1',outputUnit:'each'});
  let r=await f.cost(a.id);assert.equal(r.completeCost,null);eq(r.knownSubtotal,'4');assert.equal(r.blockers[0].reason,'incomplete_labor');
  await f.run('setLabor',{ingredientId:a.id,componentKey:l.componentKey,kind:'time',minutes:'18',department:'FOH',outputQuantity:'1',outputUnit:'each'});
  r=await f.cost(a.id);assert.equal(r.blockers[0].reason,'missing_labor_rate');
  await f.run('setLaborRate',{department:'FOH',amount:'10',currency:'USD'});eq((await f.cost(a.id)).completeCost,'7');
});

test('historical prices and yields select independent effective revisions',async()=>{
  const f=fixture(),a=await f.bought('Pineapple','2'),b=await f.derived('Spears',a.id,'1','each','8','each');
  await f.run('addPrice',{purchaseOptionId:a.option,amount:'3',currency:'USD',effectiveAt:'2026-09-01T00:00:00Z'});
  await f.run('setYield',{ingredientId:b,sourceIngredientId:a.id,sourceQuantity:'1',sourceUnit:'each',outputQuantity:'12',outputUnit:'each',effectiveAt:'2026-09-10T00:00:00Z'});
  eq((await f.cost(b,'1','each',{at:'2026-08-31T23:59:59Z'})).completeCost,'0.25');
  eq((await f.cost(b,'1','each',{at:'2026-09-01T00:00:00Z'})).completeCost,'0.375');
  eq((await f.cost(b,'1','each',{at:'2026-09-10T00:00:00Z'})).completeCost,'0.25');
  assert.equal((await f.cost(a.id,'1','each',{at:'2026-07-01T00:00:00Z'})).completeCost,null);
});

test('retroactive recording preserves effective and recorded time and as-known history',async()=>{
  const f=fixture(),a=await f.bought('Pineapple','2');
  const before=(await f.repository.read()).prices[0].recordedAt;
  await f.run('addPrice',{purchaseOptionId:a.option,amount:'3',currency:'USD',effectiveAt:'2026-09-12T00:00:00Z',provenance:{kind:'invoice',reference:'INV-TEST'}});
  const h=await f.service.history(admin,'prices',a.option);assert.equal(h.length,2);assert.ok(h[1].recordedAt.startsWith('2026-09-18'));assert.equal(h[1].effectiveAt,'2026-09-12T00:00:00.000Z');
  eq((await f.cost(a.id,'1','each',{at:'2026-09-11T23:59:59Z'})).completeCost,'2');
  eq((await f.cost(a.id,'1','each',{at:'2026-09-12T00:00:00Z'})).completeCost,'3');
  eq((await f.cost(a.id,'1','each',{at:'2026-09-12T00:00:00Z',knownAt:before})).completeCost,'2');
});

test('same-effective corrections require supersession and preserve original record',async()=>{
  const f=fixture(),a=await f.bought('Corrected','2'),p=(await f.repository.read()).prices[0];
  await assert.rejects(f.run('addPrice',{purchaseOptionId:a.option,amount:'3',currency:'USD',effectiveAt:early}),/collision/);
  await f.run('addPrice',{purchaseOptionId:a.option,amount:'3',currency:'USD',effectiveAt:early,supersedesId:p.id});
  eq((await f.cost(a.id)).completeCost,'3');assert.equal((await f.repository.read()).prices[0].amount,'2');
  eq((await f.cost(a.id,'1','each',{knownAt:p.recordedAt})).completeCost,'2');
});

test('unknown effective facts remain evidence and never acquire a guessed date',async()=>{
  const f=fixture(),id=await f.ingredient('Unknown period'),o=(await f.run('createPurchaseOption',{ingredientId:id,label:'Each',contentQuantity:'1',contentUnit:'each'})).id;
  await f.run('selectBasis',{ingredientId:id,kind:'purchase',purchaseOptionId:o});
  await f.run('addPrice',{purchaseOptionId:o,amount:'8',currency:'USD',effectiveAt:null});
  assert.equal((await f.cost(id)).blockers[0].reason,'missing_price');assert.equal((await f.service.history(admin,'prices',o))[0].effectiveAt,null);
});

test('direct, indirect and mixed cycles rejected transactionally with complete path',async()=>{
  const f=fixture(),a=await f.ingredient('A'),b=await f.derived('B',a),r=await f.recipe('R',[{ingredientId:b,quantity:'1',unit:'each'}]);
  let before=(await f.repository.read()).audit.length;
  await assert.rejects(f.run('setYield',{ingredientId:a,sourceIngredientId:a}),e=>e.code==='cycle'&&e.cyclePath.join()===`${a},${a}`);
  assert.equal((await f.repository.read()).audit.length,before);
  await assert.rejects(f.run('setYield',{ingredientId:a,sourceIngredientId:b}),e=>e.code==='cycle'&&e.cyclePath.length===3);
  await assert.rejects(f.run('setYield',{ingredientId:a,sourceIngredientId:r.output}),e=>e.code==='cycle'&&e.cyclePath.length===4);
});

test('future graph boundaries and concurrent reciprocal edits cannot create cycles',async()=>{
  const f=fixture(),a=await f.ingredient('A'),b=await f.ingredient('B');
  const results=await Promise.allSettled([f.run('setYield',{ingredientId:a,sourceIngredientId:b}),f.run('setYield',{ingredientId:b,sourceIngredientId:a})]);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const g=fixture(),x=await g.ingredient('X'),y=await g.ingredient('Y');
  await g.run('setYield',{ingredientId:x,sourceIngredientId:y,effectiveAt:'2027-01-01T00:00:00Z'});
  await assert.rejects(g.run('setYield',{ingredientId:y,sourceIngredientId:x,effectiveAt:'2026-10-01T00:00:00Z'}),e=>e.code==='cycle');
});

test('evaluator defensively reports cycle from corrupted legacy-shaped state',async()=>{
  const f=fixture(),a=await f.ingredient('A');await f.run('setYield',{ingredientId:a,sourceIngredientId:await f.ingredient('B'),sourceQuantity:'1',sourceUnit:'each',outputQuantity:'1',outputUnit:'each'});
  const s=await f.repository.read();s.yields[0].sourceIngredientId=a;
  const r=costIngredient(s,{ingredientId:a,quantity:'1',unit:'each',at:'2027-01-01T00:00:00.000Z'});
  assert.equal(r.completeCost,null);assert.deepEqual(r.blockers[0].cyclePath,[a,a]);
});

test('audit groups atomic changes, stores prior/new facts, actor and evidence',async()=>{
  const f=fixture(),a=await f.bought('Audit','2');
  const change=await f.run('addPrice',{purchaseOptionId:a.option,amount:'3',currency:'USD',note:'Invoice adjustment',provenance:{kind:'invoice',reference:'INV-12'}});
  const [event]=await f.service.audit(admin,change.id);assert.equal(event.previous.amount,'2');assert.equal(event.next.amount,'3');assert.equal(event.actorId,admin.id);assert.equal(event.changeId,change.changeId);assert.equal(event.provenance.kind,'invoice');
  const prior=await f.repository.read();await assert.rejects(f.run('setYield',{ingredientId:a.id,sourceIngredientId:randomUUID()}));assert.deepEqual(await f.repository.read(),prior);
});

test('permissions allow internal cost only to Admin/Manager while menu price remains operational',async()=>{
  const f=fixture(),a=await f.bought('Secret source','123.4567'),r=await f.recipe('Cocktail',[{ingredientId:a.id,quantity:'1',unit:'each'}]);
  const menu=(await f.run('createMenuItem',{name:'Cocktail'})).id;
  await f.run('setSellingPrice',{menuItemId:menu,amount:'16',currency:'USD'});
  await f.run('setMenuMapping',{menuItemId:menu,recipeId:r.id,quantity:'1',unit:'each'});
  for(const actor of [admin,manager])assert.equal((await f.service.menu(actor,menu)).internalCost.status,'resolved');
  for(const actor of [lead,staff]) {
    const view=await f.service.menu(actor,menu);assert.deepEqual(view.sellingPrice,{amount:'16',currency:'USD'});assert.ok(!('internalCost'in view));
    const serialized=JSON.stringify([view,await f.service.ingredient(actor,a.id),await f.service.recipe(actor,r.id)]);
    for(const forbidden of ['123.4567','purchasePrice','provenance','knownSubtotal','laborSubtotal','internalCost'])assert.ok(!serialized.includes(forbidden));
    await assert.rejects(f.service.cost(actor,{ingredientId:a.id,quantity:'1',unit:'each'}),e=>e.code==='forbidden');
    await assert.rejects(f.service.history(actor,'prices',a.option),e=>e.code==='forbidden');
    await assert.rejects(f.run('addPrice',{purchaseOptionId:a.option,amount:'1',currency:'USD'},actor),e=>e.code==='forbidden');
  }
  await assert.rejects(f.run('setLaborRate',{department:'BOH',amount:'20',currency:'USD'},manager),e=>e.code==='forbidden');
  authorize(admin,'users.manage');assert.throws(()=>authorize(manager,'users.manage'));assert.throws(()=>authorize(null));
  assert.deepEqual(Object.keys(CAPABILITIES),['ADMIN','MANAGER','LEAD','STAFF']);
});

test('historical recipe, measurement and purchase selection revisions independently reproduce costs',async()=>{
  const f=fixture(),a=await f.bought('Measured','10','100','mL');
  const m=await f.run('addMeasurement',{ingredientId:a.id,fromQuantity:'100',fromUnit:'mL',toQuantity:'100',toUnit:'g',effectiveAt:early});
  const r=await f.recipe('Historical recipe',[{ingredientId:a.id,quantity:'10',unit:'g'}]);
  await f.run('addMeasurement',{ingredientId:a.id,measurementKey:m.measurementKey,fromQuantity:'100',fromUnit:'mL',toQuantity:'200',toUnit:'g',effectiveAt:'2026-09-01T00:00:00Z'});
  await f.run('reviseRecipe',{recipeId:r.id,outputQuantity:'1',outputUnit:'each',lines:[{ingredientId:a.id,quantity:'20',unit:'g'}],steps:[],effectiveAt:'2026-09-05T00:00:00Z'});
  const option=(await f.run('createPurchaseOption',{ingredientId:a.id,label:'Alternative',contentQuantity:'100',contentUnit:'mL'})).id;
  await f.run('addPrice',{purchaseOptionId:option,amount:'20',currency:'USD',effectiveAt:early});
  await f.run('selectBasis',{ingredientId:a.id,kind:'purchase',purchaseOptionId:option,effectiveAt:'2026-09-10T00:00:00Z'});
  for(const [at,expected] of [['2026-08-20T00:00:00Z','1'],['2026-09-02T00:00:00Z','0.5'],['2026-09-06T00:00:00Z','1'],['2026-09-11T00:00:00Z','2']])eq((await f.cost(r.output,'1','each',{at})).completeCost,expected);
});

test('measurement evidence is not inherited by a source-derived ingredient; keys cannot cross owners',async()=>{
  const f=fixture(),a=await f.bought('A','3','100','mL'),b=await f.derived('B',a.id,'100','mL','100','mL');
  const m=await f.run('addMeasurement',{ingredientId:a.id,fromQuantity:'100',fromUnit:'mL',toQuantity:'100',toUnit:'g'});
  assert.equal((await f.cost(b,'100','g')).completeCost,null);
  await assert.rejects(f.run('addMeasurement',{ingredientId:b,measurementKey:m.measurementKey,fromQuantity:'1',fromUnit:'mL',toQuantity:'1',toUnit:'g'}),/another ingredient/);
});

test('currency mismatches cannot be silently added and incomplete fixed labor is unresolved',async()=>{
  const f=fixture(),a=await f.bought('USD item');
  await f.run('addPrice',{purchaseOptionId:a.option,amount:'4',currency:'CAD'});
  const r=await f.cost(a.id);assert.equal(r.completeCost,null);assert.equal(r.blockers[0].reason,'currency_mismatch');
  const b=await f.ingredient('Fixed labor draft');await f.run('selectBasis',{ingredientId:b,kind:'labor_only'});
  await f.run('setLabor',{ingredientId:b,kind:'fixed',outputQuantity:'180',outputUnit:'each'});
  assert.equal((await f.cost(b)).blockers[0].reason,'incomplete_labor');
});

test('undated conceptual source relationships reject cycles before activation',async()=>{
  const f=fixture(),a=await f.ingredient('Undated A'),b=await f.ingredient('Undated B');
  await assert.rejects(f.run('setYield',{ingredientId:a,sourceIngredientId:a,effectiveAt:null}),e=>e.code==='cycle');
  await f.run('setYield',{ingredientId:a,sourceIngredientId:b,effectiveAt:null});
  await assert.rejects(f.run('setYield',{ingredientId:b,sourceIngredientId:a,effectiveAt:null}),e=>e.code==='cycle');
});

test('selling prices have independent history; archival does not manufacture menu lineage',async()=>{
  const f=fixture(),four=(await f.run('createMenuItem',{name:'Fish and Chips, Four',active:false})).id,two=(await f.run('createMenuItem',{name:'Fish and Chips, Two'})).id;
  await f.run('setSellingPrice',{menuItemId:two,amount:'18',currency:'USD',effectiveAt:'2026-09-01T00:00:00Z'});
  const old=await f.service.menu(staff,four);assert.equal(old.active,false);assert.equal(old.sellingPrice,null);assert.equal(old.recipe,null);
  assert.equal((await f.service.menu(lead,two,{at:'2026-08-20T00:00:00Z'})).sellingPrice,null);
  assert.equal((await f.service.menu(lead,two)).sellingPrice.amount,'18');
});
