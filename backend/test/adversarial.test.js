'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture,admin,manager,lead,staff,early,provenance}=require('./helpers');
const {Exact:E}=require('../domain/exact');
const {schemas,DomainService}=require('../service');
const {timestamp,latest}=require('../domain/history');
const {resolveConversion}=require('../domain/measurements');
const {costIngredient}=require('../domain/costing');
const eq=(a,b)=>assert.ok(E.of(a).eq(b),`${a} != ${b}`);
const boundary='2026-09-01T00:00:00.000Z';
const instants=['2026-08-31T23:59:59.999Z',boundary,'2026-09-01T00:00:00.001Z'];

for(const [label,qty,unit,price] of [['750mL','750','mL','18'],['1L','1','L','18'],['1.75L','1.75','L','18'],['6 × 750mL','4500','mL','108']])test(`rum package ${label}: exact 1.5 US fluid ounce serving`,async()=>{
  const f=fixture(),a=await f.bought(label,price,qty,unit);
  const expected=E.of('1.5').mul('29.5735295625').div(E.of(qty).mul(unit==='L'?'1000':'1')).mul(price).decimal();
  assert.equal((await f.cost(a.id,'1.5','fl_oz_us')).completeCost,expected);
});

test('pound/cup bridge, tablespoon/cup/gram/pound traversal and inverse use exact ratios',async()=>{
  const f=fixture(),a=await f.bought('Density','5','1','lb');
  assert.equal((await f.cost(a.id,'1','cup_us')).completeCost,null);
  await f.run('addMeasurement',{ingredientId:a.id,fromQuantity:'1',fromUnit:'cup_us',toQuantity:'200',toUnit:'g'});
  for(const [quantity,fromUnit,toUnit,expected] of [['1','tbsp_us','g','12.5'],['200','g','cup_us','1'],['1','lb','cup_us','2.26796185'],['2.26796185','cup_us','lb','1']]) {
    const v=await f.service.convert(staff,{ingredientId:a.id,quantity,fromUnit,toUnit});eq(v.amount,expected);
  }
  const c=resolveConversion(await f.repository.read(),{ingredientId:a.id,quantity:'1',fromUnit:'tbsp_us',toUnit:'lb',at:'2027-01-01T00:00:00.000Z'});
  assert.ok(c.amount.eq(E.of('12.5').div('453.59237')));
});

test('direct dash-family alias and indirect operational alias are rejected',async()=>{
  const f=fixture(),id=await f.ingredient('Dash');
  for(const [fromUnit,toUnit]of [['dash_fluid','dash_mass'],['dash_mass','dash_fluid'],['dash_fluid','each'],['dash_mass','drop']])await assert.rejects(f.run('addMeasurement',{ingredientId:id,fromQuantity:'1',fromUnit,toQuantity:'1',toUnit}),/physical family/);
  await f.run('addMeasurement',{ingredientId:id,fromQuantity:'1',fromUnit:'dash_fluid',toQuantity:'0.02',toUnit:'fl_oz_us'});
  await f.run('addMeasurement',{ingredientId:id,fromQuantity:'1',fromUnit:'dash_mass',toQuantity:'0.1',toUnit:'g'});
  assert.equal((await f.service.convert(staff,{ingredientId:id,quantity:'1',fromUnit:'dash_fluid',toUnit:'dash_mass'})).status,'unresolved_missing_measurement');
});

test('0.00113636 fl oz drops are independent ingredient observations, never a default',async()=>{
  const f=fixture(),ids=await Promise.all(['Bitters A','Bitters B','Unknown'].map(f.ingredient));
  for(const ingredientId of ids.slice(0,2))await f.run('addMeasurement',{ingredientId,fromQuantity:'1',fromUnit:'drop',toQuantity:'0.00113636',toUnit:'fl_oz_us'});
  for(const ingredientId of ids.slice(0,2))eq((await f.service.convert(staff,{ingredientId,quantity:'10',fromUnit:'drop',toUnit:'fl_oz_us'})).amount,'0.0113636');
  assert.equal((await f.service.convert(staff,{ingredientId:ids[2],quantity:'1',fromUnit:'drop',toUnit:'fl_oz_us'})).status,'unresolved_missing_measurement');
  assert.equal(new Set((await f.repository.read()).measurements.map(m=>m.measurementKey)).size,2);
});

test('one pineapple to 4.84 cups chopped costs a 3 fl oz portion without allocation',async()=>{
  const f=fixture(),a=await f.bought('Pineapple','3'),b=await f.derived('Chopped',a.id,'1','each','4.84','cup_us');
  assert.equal((await f.cost(b,'3','fl_oz_us')).completeCost,E.of('3').mul('3').div('38.72').decimal());
});

test('Ginger weight purchase propagates unresolved through source, recipe and menu until its own bridge exists',async()=>{
  const f=fixture(),g=await f.bought('Ginger, Fresh','5','1','lb'),derived=await f.derived('Ginger juice',g.id,'1','cup_us','8','fl_oz_us');
  const r=await f.recipe('Ginger drink',[{ingredientId:derived,quantity:'2',unit:'fl_oz_us'}]);
  const menu=(await f.run('createMenuItem',{name:'Ginger drink'})).id;
  await f.run('setMenuMapping',{menuItemId:menu,recipeId:r.id,quantity:'1',unit:'each'});
  const before=await f.service.menu(admin,menu);assert.equal(before.internalCost.completeCost,null);assert.equal(before.internalCost.blockers[0].ingredientId,g.id);
  await f.run('addMeasurement',{ingredientId:g.id,fromQuantity:'1',fromUnit:'cup_us',toQuantity:'200',toUnit:'g'});
  assert.equal((await f.service.menu(admin,menu)).internalCost.status,'resolved');
  assert.equal((await f.repository.read()).yields[0].sourceIngredientId,g.id);
});

test('explicit Water zero survives recipe, history and audit; missing price remains distinct',async()=>{
  const f=fixture(),w=await f.bought('Water','0','1','mL'),u=await f.ingredient('Unpriced');
  const option=(await f.run('createPurchaseOption',{ingredientId:u,label:'Package',contentQuantity:'1',contentUnit:'each'})).id;
  await f.run('selectBasis',{ingredientId:u,kind:'purchase',purchaseOptionId:option});
  assert.equal((await f.cost(u)).blockers[0].reason,'missing_price');
  const r=await f.recipe('Explicit water',[{ingredientId:w.id,quantity:'500',unit:'mL'}]);eq((await f.cost(r.output)).completeCost,'0');
  const [p]=await f.service.history(admin,'prices',w.option);assert.equal(p.amount,'0');assert.equal((await f.service.audit(admin,p.id))[0].next.amount,'0');
});

test('all three independent blockers and known subtotal propagate through three nested recipes',async()=>{
  const f=fixture(),priced=await f.bought('Known','2'),density=await f.bought('Missing density','3','1','lb'),missing=await f.ingredient('Missing price');
  const option=(await f.run('createPurchaseOption',{ingredientId:missing,label:'One',contentQuantity:'1',contentUnit:'each'})).id;
  await f.run('selectBasis',{ingredientId:missing,kind:'purchase',purchaseOptionId:option});
  const yieldId=await f.ingredient('Missing yield');await f.run('setYield',{ingredientId:yieldId,sourceIngredientId:priced.id});
  let r=await f.recipe('A',[{ingredientId:priced.id,quantity:'1',unit:'each'},{ingredientId:missing,quantity:'1',unit:'each'},{ingredientId:density.id,quantity:'1',unit:'cup_us'},{ingredientId:yieldId,quantity:'1',unit:'each'}]);
  for(const name of ['B','C'])r=await f.recipe(name,[{ingredientId:r.output,quantity:'2',unit:'each'}]);
  const c=await f.cost(r.output);eq(c.knownSubtotal,'8');assert.equal(c.completeCost,null);
  assert.deepEqual(c.blockers.map(b=>b.reason).sort(),['missing_price','missing_yield','unresolved_missing_measurement']);
  assert.ok(c.blockers.every(b=>b.path.length===4&&b.linePath.length===3));
});

test('nested fixed 25/180, 18-minute derived labor and own recipe labor are counted exactly once',async()=>{
  const f=fixture(),a=await f.bought('Material','2');
  await f.run('setLabor',{ingredientId:a.id,kind:'fixed',amount:'25',currency:'USD',outputQuantity:'180',outputUnit:'each'});
  const b=await f.derived('Prepared',a.id,'2','each','1','each');
  await f.run('setLaborRate',{department:'BOH',amount:'20',currency:'USD',effectiveAt:early});
  await f.run('setLabor',{ingredientId:b,kind:'time',minutes:'18',department:'BOH',outputQuantity:'1',outputUnit:'each'});
  const r=await f.recipe('Final',[{ingredientId:b,quantity:'3',unit:'each'}]);
  await f.run('setLabor',{ingredientId:r.output,kind:'fixed',amount:'1',currency:'USD',outputQuantity:'1',outputUnit:'each'});
  const c=await f.cost(r.output);eq(c.materialSubtotal,'12');assert.equal(c.laborSubtotal,E.of('25').div('180').mul('6').add('19').decimal());
  assert.equal(c.completeCost,E.of('25').div('180').mul('6').add('31').decimal());
});

// Exercise inclusive boundaries and genuine gaps through public domain services.
for(const kind of ['price','yield','measurement','recipe','laborRate','sellingPrice'])test(`${kind}: before/at/after boundary and no backward extrapolation`,async()=>{
  const f=fixture(),a=await f.bought('Boundary','2'),menu=(await f.run('createMenuItem',{name:'Boundary menu'})).id;
  let evaluate,oldExpected,newExpected;
  if(kind==='price') {await f.run('addPrice',{purchaseOptionId:a.option,amount:'3',currency:'USD',effectiveAt:boundary});evaluate=at=>f.cost(a.id,'1','each',{at});oldExpected='2';newExpected='3';}
  if(kind==='yield') {const b=await f.derived('Boundary yield',a.id,'1','each','2','each');await f.run('setYield',{ingredientId:b,sourceIngredientId:a.id,sourceQuantity:'1',sourceUnit:'each',outputQuantity:'4',outputUnit:'each',effectiveAt:boundary});evaluate=at=>f.cost(b,'1','each',{at});oldExpected='1';newExpected='0.5';}
  if(kind==='measurement') {const m=await f.run('addMeasurement',{ingredientId:a.id,fromQuantity:'1',fromUnit:'each',toQuantity:'100',toUnit:'g',effectiveAt:early});await f.run('addMeasurement',{ingredientId:a.id,measurementKey:m.measurementKey,fromQuantity:'1',fromUnit:'each',toQuantity:'200',toUnit:'g',effectiveAt:boundary});evaluate=at=>f.cost(a.id,'100','g',{at});oldExpected='2';newExpected='1';}
  if(kind==='recipe') {const r=await f.recipe('Boundary recipe',[{ingredientId:a.id,quantity:'1',unit:'each'}]);await f.run('reviseRecipe',{recipeId:r.id,lines:[{ingredientId:a.id,quantity:'2',unit:'each'}],outputQuantity:'1',outputUnit:'each',effectiveAt:boundary});evaluate=at=>f.cost(r.output,'1','each',{at});oldExpected='2';newExpected='4';}
  if(kind==='laborRate') {await f.run('setLabor',{ingredientId:a.id,kind:'time',minutes:'18',department:'BOH',outputQuantity:'1',outputUnit:'each',effectiveAt:early});await f.run('setLaborRate',{department:'BOH',amount:'20',currency:'USD',effectiveAt:early});await f.run('setLaborRate',{department:'BOH',amount:'23',currency:'USD',effectiveAt:boundary});evaluate=at=>f.cost(a.id,'1','each',{at});oldExpected='8';newExpected='8.9';}
  if(kind==='sellingPrice') {await f.run('setSellingPrice',{menuItemId:menu,amount:'10',currency:'USD',effectiveAt:early});await f.run('setSellingPrice',{menuItemId:menu,amount:'12',currency:'USD',effectiveAt:boundary});evaluate=async at=>({completeCost:(await f.service.menu(staff,menu,{at})).sellingPrice?.amount??null});oldExpected='10';newExpected='12';}
  for(const [index,at]of instants.entries())eq((await evaluate(at)).completeCost,index===0?oldExpected:newExpected);
  assert.equal((await evaluate('2026-07-31T23:59:59.999Z')).completeCost,null);
  // Verify the individual timeline gap too: the parent basis can otherwise mask it.
  const s=await f.repository.read(),collection={price:'prices',yield:'yields',measurement:'measurements',recipe:'recipeRevisions',laborRate:'laborRates',sellingPrice:'sellingPrices'}[kind];
  assert.equal(latest(s[collection],'2026-07-31T23:59:59.999Z'),null);
});

test('BOH rate retroactive effective September 12 keeps both clocks and prior rate',async()=>{
  const f=fixture(),a=await f.bought('Labor base','0');
  await f.run('setLabor',{ingredientId:a.id,kind:'time',minutes:'18',department:'BOH',outputQuantity:'1',outputUnit:'each',effectiveAt:early});
  await f.run('setLaborRate',{department:'BOH',amount:'20',currency:'USD',effectiveAt:early});
  await f.run('setLaborRate',{department:'BOH',amount:'23',currency:'USD',effectiveAt:boundary});
  const prior=(await f.repository.read()).laborRates.at(-1).recordedAt;
  await f.run('setLaborRate',{department:'BOH',amount:'25',currency:'USD',effectiveAt:'2026-09-12T00:00:00Z'});
  eq((await f.cost(a.id,'1','each',{at:'2026-09-12T00:00:00Z',knownAt:prior})).completeCost,'6.9');
  eq((await f.cost(a.id,'1','each',{at:'2026-09-12T00:00:00Z'})).completeCost,'7.5');
  const h=await f.service.history(admin,'laborRates','BOH');assert.equal(h.length,3);assert.match(h[2].recordedAt,/^2026-09-18/);
});

test('price entered September 20 effective September 10 preserves original September 1 price and audit',async()=>{
  const f=fixture(),a=await f.bought('Retroactive','2');
  const service=new DomainService(f.repository,{clock:()=> '2026-09-20T00:00:00.000Z'});
  const c=await service.execute(admin,'addPrice',{purchaseOptionId:a.option,amount:'2.50',currency:'USD',effectiveAt:'2026-09-10T00:00:00Z',provenance});
  for(const [at,expected]of [['2026-09-09T23:59:59.999Z','2'],['2026-09-10T00:00:00Z','2.5']])eq((await service.cost(admin,{ingredientId:a.id,quantity:'1',unit:'each',at})).completeCost,expected);
  eq((await service.cost(admin,{ingredientId:a.id,quantity:'1',unit:'each',at:'2026-09-15T00:00:00Z',knownAt:'2026-09-19T00:00:00Z'})).completeCost,'2');
  const [audit]=await service.audit(admin,c.id);assert.equal(audit.previous.amount,'2');assert.equal(audit.next.amount,'2.50');assert.equal(audit.recordedAt,'2026-09-20T00:00:00.000Z');
});

test('200 versus 240g conflicts; exactly equivalent paths agree, even with trailing decimal precision',async()=>{
  for(const [second,expected]of [['200.000000000000','resolved'],['240','conflicting_measurement'],['200.000000000001','conflicting_measurement']]) {
    const f=fixture(),id=await f.ingredient('Density conflict');
    await f.run('addMeasurement',{ingredientId:id,fromQuantity:'1',fromUnit:'cup_us',toQuantity:'200',toUnit:'g'});
    await f.run('addMeasurement',{ingredientId:id,fromQuantity:'16',fromUnit:'tbsp_us',toQuantity:second,toUnit:'g'});
    assert.equal((await f.service.convert(staff,{ingredientId:id,quantity:'1',fromUnit:'cup_us',toUnit:'g'})).status,expected);
  }
});

test('deep repeating fractions, fractional quantities, tiny and large amounts retain exact internal precision',async()=>{
  const f=fixture(),a=await f.bought('Fraction','25','180','each');
  let out=a.id;
  for(let n=0;n<6;n++)out=(await f.recipe('Nested '+n,[{ingredientId:out,quantity:'0.1',unit:'each'}],'3','each')).output;
  const internal=costIngredient(await f.repository.read(),{ingredientId:out,quantity:'1',unit:'each',at:'2027-01-01T00:00:00.000Z'});
  let expected=E.of('25').div('180');for(let n=0;n<6;n++)expected=expected.div('30');assert.ok(internal.completeCost.eq(expected));
  for(const amount of ['0.000000000000000001','999999999999999999999999999999.999999']) {
    const b=await f.bought('Magnitude',amount),c=costIngredient(await f.repository.read(),{ingredientId:b.id,quantity:'1',unit:'each',at:'2027-01-01T00:00:00.000Z'});assert.ok(c.completeCost.eq(amount));
  }
});

for(const value of ['-1','NaN','Infinity','-Infinity','1e3','1,000',' 1','1.2.3',1])test(`reject invalid numeric input ${JSON.stringify(value)} atomically`,async()=>{
  const f=fixture(),a=await f.bought('Invalid'),prior=await f.repository.read();
  await assert.rejects(f.run('addPrice',{purchaseOptionId:a.option,amount:value,currency:'USD'}));
  for(const command of ['setYield','addMeasurement','createPurchaseOption']) {
    const data=command==='setYield'?{ingredientId:a.id,sourceIngredientId:await f.ingredient('Source '+command),outputQuantity:value}:command==='addMeasurement'?{ingredientId:a.id,fromQuantity:value,fromUnit:'g',toQuantity:'1',toUnit:'mL'}:{ingredientId:a.id,label:'Invalid',contentQuantity:value,contentUnit:'g'};
    await assert.rejects(f.run(command,data));
  }
  assert.deepEqual((await f.repository.read()).prices,prior.prices);
});

test('zero denominators and invalid calendar/submillisecond dates are rejected',async()=>{
  const f=fixture(),a=await f.bought('Zero'),b=await f.ingredient('Derived');
  for(const command of ['setYield','addMeasurement','createPurchaseOption']) {
    const data=command==='setYield'?{ingredientId:b,sourceIngredientId:a.id,outputQuantity:'0'}:command==='addMeasurement'?{ingredientId:a.id,fromQuantity:'0',fromUnit:'g',toQuantity:'1',toUnit:'mL'}:{ingredientId:a.id,label:'Zero',contentQuantity:'0',contentUnit:'g'};await assert.rejects(f.run(command,data));
  }
  for(const date of ['2026-02-30T00:00:00Z','2026-09-01T24:00:00Z','2026-09-01T00:00:00.0001Z'])assert.throws(()=>timestamp(date));
  assert.equal(timestamp('2026-09-01T02:00:00+02:00'),boundary);
});

test('recipe revisions, lines, steps and returned operational views cannot mutate history',async()=>{
  const f=fixture(),a=await f.bought('Immutable'),r=await f.recipe('Immutable recipe',[{ingredientId:a.id,quantity:'1',unit:'each'}]);
  const old=structuredClone((await f.repository.read()).recipeRevisions[0]);
  const view=await f.service.recipe(staff,r.id);view.revision.lines[0].quantity='999';
  await f.run('reviseRecipe',{recipeId:r.id,lines:[{ingredientId:a.id,quantity:'2',unit:'each'}],outputQuantity:'2',outputUnit:'each',steps:['New instruction']});
  assert.deepEqual((await f.repository.read()).recipeRevisions[0],old);
});

test('archive every identity preserves old costs and prevents new selection',async()=>{
  const f=fixture(),supplier=(await f.run('createSupplier',{name:'Supplier'})).id,a=await f.ingredient('Archive ingredient');
  const option=(await f.run('createPurchaseOption',{ingredientId:a,supplierId:supplier,label:'Archive option',contentQuantity:'1',contentUnit:'each'})).id;
  await f.run('selectBasis',{ingredientId:a,kind:'purchase',purchaseOptionId:option,effectiveAt:early});await f.run('addPrice',{purchaseOptionId:option,amount:'2',currency:'USD',effectiveAt:early});
  const r=await f.recipe('Archive recipe',[{ingredientId:a,quantity:'1',unit:'each'}]),menu=(await f.run('createMenuItem',{name:'Archive menu'})).id;
  await f.run('setMenuMapping',{menuItemId:menu,recipeId:r.id,quantity:'1',unit:'each',effectiveAt:early});
  for(const [collection,entityId]of [['suppliers',supplier],['purchaseOptions',option],['recipes',r.id],['ingredients',a],['menuItems',menu]])await f.run('setArchived',{collection,entityId,archived:true});
  eq((await f.cost(r.output,'1','each',{at:early})).completeCost,'2');eq((await f.service.menu(admin,menu,{at:early})).internalCost.completeCost,'2');
  await assert.rejects(f.recipe('New',[{ingredientId:a,quantity:'1',unit:'each'}]),/Archived/);
  const fresh=await f.ingredient('Fresh');
  await assert.rejects(f.run('createPurchaseOption',{ingredientId:fresh,supplierId:supplier,label:'New',contentQuantity:'1',contentUnit:'each'}),/Archived/);
  await assert.rejects(f.run('selectBasis',{ingredientId:fresh,kind:'purchase',purchaseOptionId:option}),/Archived/);
  const newMenu=(await f.run('createMenuItem',{name:'New menu'})).id;
  await assert.rejects(f.run('setMenuMapping',{menuItemId:newMenu,recipeId:r.id,quantity:'1',unit:'each'}),/Archived/);
  assert.ok((await f.repository.read()).audit.filter(a=>a.action==='revise').length>=5);
});

test('Fish Four, Three and Two remain independent menu identities without inferred lineage',async()=>{
  const f=fixture(),ids=[];
  for(const name of ['Four','Three','Two'])ids.push((await f.run('createMenuItem',{name:'Fish and Chips, '+name})).id);
  await f.run('setArchived',{collection:'menuItems',entityId:ids[0],archived:true});
  await f.run('setSellingPrice',{menuItemId:ids[1],amount:'24',currency:'USD'});
  const views=await Promise.all(ids.map(id=>f.service.menu(staff,id)));assert.equal(new Set(ids).size,3);assert.equal(views[0].active,false);assert.equal(views[0].sellingPrice,null);assert.equal(views[1].sellingPrice.amount,'24');assert.equal(views[2].sellingPrice,null);assert.ok(views.every(v=>!('predecessorId'in v)));
});

test('Lead/Staff deep response allowlists and every mutation deny internal data before input parsing',async()=>{
  const f=fixture(),a=await f.bought('Secret','987.654321'),r=await f.recipe('Secret recipe',[{ingredientId:a.id,quantity:'1',unit:'each'}]),menu=(await f.run('createMenuItem',{name:'Secret menu'})).id;
  await f.run('setMenuMapping',{menuItemId:menu,recipeId:r.id,quantity:'1',unit:'each'});await f.run('setSellingPrice',{menuItemId:menu,amount:'16',currency:'USD'});
  const forbidden=new Set(['internalCost','knownSubtotal','materialSubtotal','laborSubtotal','completeCost','provenance','actorId','supplierId','purchaseOptionId','references','blockers','audit','previous','next']);
  function inspect(x){if(!x||typeof x!=='object')return;for(const [k,v]of Object.entries(x)){assert.ok(!forbidden.has(k),k);inspect(v);}}
  for(const actor of [lead,staff]) {
    const views=[await f.service.ingredient(actor,a.id),await f.service.recipe(actor,r.id),await f.service.menu(actor,menu),await f.service.convert(actor,{ingredientId:a.id,quantity:'1',fromUnit:'each',toUnit:'g'})];views.forEach(inspect);assert.ok(!JSON.stringify(views).includes('987.654321'));
    for(const cmd of Object.keys(schemas))await assert.rejects(f.service.execute(actor,cmd,{amount:'SECRET',debug:true}),e=>e.code==='forbidden'&&!e.message.includes('SECRET'));
    await assert.rejects(f.service.audit(actor,randomUUID()),e=>e.code==='forbidden');
    for(const collection of ['prices','labor','laborRates','suppliers','purchaseOptions','audit','recipeRevisions','measurements'])await assert.rejects(f.service.history(actor,collection,a.id),e=>e.code==='forbidden');
    await assert.rejects(f.service.cost(actor,{debug:true}),e=>e.code==='forbidden');
  }
  for(const actor of [admin,manager])eq((await f.service.menu(actor,menu)).internalCost.completeCost,'987.654321');
});

test('undated evidence cannot mask a dated source cycle; rollback includes implicit basis and audits',async()=>{
  const f=fixture(),a=await f.ingredient('A'),b=await f.ingredient('B'),c=await f.ingredient('C');
  await f.run('setYield',{ingredientId:a,sourceIngredientId:c,effectiveAt:null});
  await f.run('setYield',{ingredientId:a,sourceIngredientId:b,effectiveAt:early});
  const prior=await f.repository.read();
  await assert.rejects(f.run('setYield',{ingredientId:b,sourceIngredientId:a,effectiveAt:early}),e=>e.code==='cycle');
  assert.deepEqual(await f.repository.read(),prior);
});

test('correction of inactive evidence audits actual superseded row, not a null prior value',async()=>{
  const f=fixture(),a=await f.bought('Inactive audit');
  const old=await f.run('addPrice',{purchaseOptionId:a.option,amount:'4',currency:'USD',active:false,effectiveAt:boundary});
  const correction=await f.run('addPrice',{purchaseOptionId:a.option,amount:'5',currency:'USD',effectiveAt:boundary,supersedesId:old.id});
  assert.equal((await f.service.audit(admin,correction.id))[0].previous.id,old.id);
});

for(const kind of ['price','measurement','yield','recipe','laborRate'])test(`${kind}: real August 15 cost stays unresolved when required fact starts September 1`,async()=>{
  const f=fixture(),a=await f.bought('Gap base','2');let target=a.id,unit='each',expected;
  if(kind==='price') {
    const option=(await f.run('createPurchaseOption',{ingredientId:a.id,label:'Gap purchase',contentQuantity:'1',contentUnit:'each'})).id;
    await f.run('selectBasis',{ingredientId:a.id,kind:'purchase',purchaseOptionId:option,effectiveAt:'2026-08-02T00:00:00Z'});
    await f.run('addPrice',{purchaseOptionId:option,amount:'3',currency:'USD',effectiveAt:boundary});expected='missing_price';
  }
  if(kind==='measurement'){unit='g';await f.run('addMeasurement',{ingredientId:a.id,fromQuantity:'1',fromUnit:'each',toQuantity:'100',toUnit:'g',effectiveAt:boundary});expected='unresolved_missing_measurement';}
  if(kind==='yield'){target=await f.ingredient('Gap yield');await f.run('selectBasis',{ingredientId:target,kind:'source',effectiveAt:early});await f.run('setYield',{ingredientId:target,sourceIngredientId:a.id,sourceQuantity:'1',sourceUnit:'each',outputQuantity:'4',outputUnit:'each',effectiveAt:boundary});expected='missing_yield';}
  if(kind==='recipe'){target=await f.ingredient('Gap recipe');const r=(await f.run('createRecipe',{name:'Gap recipe',outputIngredientId:target})).id;await f.run('selectBasis',{ingredientId:target,kind:'recipe',recipeId:r,effectiveAt:early});await f.run('reviseRecipe',{recipeId:r,lines:[{ingredientId:a.id,quantity:'1',unit:'each'}],outputQuantity:'1',outputUnit:'each',effectiveAt:boundary});expected='missing_recipe_revision';}
  if(kind==='laborRate'){await f.run('setLabor',{ingredientId:a.id,kind:'time',minutes:'18',department:'BOH',outputQuantity:'1',outputUnit:'each',effectiveAt:early});await f.run('setLaborRate',{department:'BOH',amount:'20',currency:'USD',effectiveAt:boundary});expected='missing_labor_rate';}
  const before=await f.cost(target,'1',unit,{at:'2026-08-15T00:00:00Z'});assert.equal(before.completeCost,null);assert.ok(before.blockers.some(b=>b.reason===expected));assert.equal((await f.cost(target,'1',unit,{at:boundary})).status,'resolved');
});

test('withdrawing an unused yield or recipe revision cannot deactivate a selected purchase basis',async()=>{
  const f=fixture(),a=await f.bought('Withdrawal','2'),b=await f.bought('Source','1');
  await f.run('setYield',{ingredientId:a.id,sourceIngredientId:b.id,active:false,effectiveAt:boundary});
  eq((await f.cost(a.id)).completeCost,'2');
  const r=(await f.run('createRecipe',{name:'Unused recipe',outputIngredientId:a.id})).id;
  await f.run('reviseRecipe',{recipeId:r,lines:[{ingredientId:b.id,quantity:'1',unit:'each'}],active:false,effectiveAt:boundary});
  eq((await f.cost(a.id)).completeCost,'2');assert.equal((await f.repository.read()).bases.length,2);
});

test('one purchased line reports missing price AND missing physical bridge together',async()=>{
  const f=fixture(),id=await f.ingredient('Two blockers'),option=(await f.run('createPurchaseOption',{ingredientId:id,label:'Pound',contentQuantity:'1',contentUnit:'lb'})).id;
  await f.run('selectBasis',{ingredientId:id,kind:'purchase',purchaseOptionId:option});
  const r=await f.recipe('Two blocker recipe',[{ingredientId:id,quantity:'1',unit:'cup_us'}]),c=await f.cost(r.output);
  assert.deepEqual(c.blockers.map(b=>b.reason),['missing_price','unresolved_missing_measurement']);assert.equal(c.completeCost,null);eq(c.knownSubtotal,'0');
});
