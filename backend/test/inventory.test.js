'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inventoryFixture:fixture}=require('./inventory-helpers');
const {admin,manager,staff,lead,early}=require('./helpers');
const {Exact:E}=require('../domain/exact');
const {schemas}=require('../inventory/service');
const isConflict=e=>e.code==='revision_conflict';

test('inventory: configurable locations share FOH/BOH architecture and stable ordering',async()=>{
  const f=fixture(),back=await f.location('Back Closet',20),bar=await f.location('Bar',10);
  await f.invRun('updateLocation',{locationId:bar,expectedVersion:1,name:'Bar',area:'FOH',active:true,sortOrder:10});
  const list=await f.inventory.locations(staff);assert.deepEqual(list.map(l=>l.id),[bar,back]);assert.equal(list[0].area,'FOH');
  const updated=(await f.repository.read()).inventoryLocations[1];assert.equal(updated.version,2);assert.equal((await f.service.audit(admin,bar)).length,2);
  await assert.rejects(f.invRun('updateLocation',{locationId:bar,expectedVersion:1,name:'Old',active:true}),isConflict);
});

test('inventory: one universal item has multiple ordered location assignments without duplication',async()=>{
  const f=fixture(),a=await f.location('Walk-In'),b=await f.location('Freezer'),chicken=await f.item('Chicken','g'),limes=await f.item('Limes');
  await f.assign(chicken,a,'lb',20);await f.assign(chicken,b,'lb',1);await f.assign(limes,a,'each',10);
  assert.deepEqual((await f.inventory.countSheet(staff,a)).items.map(i=>i.ingredientId),[limes,chicken]);
  assert.equal((await f.inventory.countSheet(lead,b)).items[0].ingredientId,chicken);
  assert.equal((await f.repository.read()).ingredients.length,2);
  await assert.rejects(f.assign(chicken,a,'lb'),isConflict);
  await assert.rejects(f.invRun('configureItem',{ingredientId:chicken,baseUnit:'lb'}),isConflict);
});

for(const actor of [staff,lead])test(`inventory: ${actor.role} can independently count and submit arbitrary-day decimal observations`,async()=>{
  const f=fixture(),location=await f.location('Bar'),item=await f.item('Bacardi','op:bottle');await f.assign(item,location,'op:bottle');
  const {sessionId}=await f.count(location,item,'3.4','op:bottle',actor,'2026-09-15T14:03:00Z');
  const s=await f.inventory.session(actor,sessionId);assert.equal(s.status,'submitted');assert.equal(s.actorId,actor.id);assert.equal(s.observations[0].quantity,'3.4');assert.equal(s.observations[0].observedAt,'2026-09-15T14:03:00.000Z');assert.ok(s.submittedAt.startsWith('2026-09-18'));
  await assert.rejects(f.enter(sessionId,item,'4','op:bottle',actor,s.observations[0].id),e=>e.code==='invalid_state');
  await assert.rejects(f.submit(sessionId,actor),e=>e.code==='invalid_state');
});

test('inventory: draft ownership, revision IDs and submission entry set prevent lost updates',async()=>{
  const f=fixture(),location=await f.location('Dry'),item=await f.item('Napkins');await f.assign(item,location);
  const s=await f.start(location),first=await f.enter(s,item,'14');
  await assert.rejects(f.enter(s,item,'99','each',lead,first),e=>e.code==='forbidden');
  await assert.rejects(f.submit(s,manager),e=>e.code==='forbidden');
  const second=await f.enter(s,item,'15','each',staff,first);
  await assert.rejects(f.enter(s,item,'16','each',staff,first),isConflict);
  await assert.rejects(f.invRun('submitCount',{sessionId:s,expectedVersion:1,expectedObservationIds:[first]},staff),isConflict);
  await f.submit(s);assert.equal((await f.inventory.session(manager,s)).revisions.length,2);
  assert.equal((await f.inventory.session(staff,s)).observations[0].id,second);
});

test('inventory: drafts do not enter totals; partial sheets retain omissions rather than inventing zero',async()=>{
  const f=fixture(),location=await f.location('Dry'),a=await f.item('A'),b=await f.item('B');await f.assign(a,location);await f.assign(b,location);
  const s=await f.start(location);await f.enter(s,a,'0');assert.equal((await f.inventory.overall(staff,a)).overallQuantity,null);
  await f.submit(s);const sheet=await f.inventory.session(staff,s);assert.deepEqual(sheet.missingIngredientIds,[b]);
  assert.equal((await f.inventory.overall(staff,a)).overallQuantity,'0.000000000000');assert.equal((await f.inventory.overall(staff,b)).overallQuantity,null);
  assert.equal((await f.inventory.overall(staff,b)).breakdown[0].status,'missing_observation');
});

test('inventory: overall 3.4 + 6 + 12 is exact and preserves differently aged locations',async()=>{
  const f=fixture(),item=await f.item('Bacardi','op:bottle');
  for(const [name,quantity,date]of [['Bar','3.4','2026-09-15T14:00:00Z'],['Back Closet','6','2026-09-14T12:00:00Z'],['Liquor Cage','12','2026-09-11T09:00:00Z']]){
    const l=await f.location(name);await f.assign(item,l,'op:bottle');await f.count(l,item,quantity,'op:bottle',staff,date);
  }
  const result=await f.inventory.overall(lead,item,{at:'2026-09-18T12:00:00Z'});
  assert.equal(result.overallQuantity,'21.400000000000');assert.deepEqual(result.exactOverallQuantity,{numerator:'107',denominator:'5'});assert.equal(result.mixedObservationTimes,true);assert.equal(result.simultaneous,false);assert.equal(result.oldestObservedAt,'2026-09-11T09:00:00.000Z');assert.ok(result.breakdown.every(b=>b.ageMilliseconds>0));
  assert.equal((await f.repository.read()).inventoryObservations.length,3);
  assert.ok(!Object.keys(schemas).some(k=>/overall|position|transfer/i.test(k)));
});

test('inventory: exact standard conversions and explicitly configured bottle conversion',async()=>{
  const f=fixture(),l=await f.location('Storage'),chicken=await f.item('Chicken','g'),rum=await f.item('Rum','mL');await f.assign(chicken,l,'lb');await f.assign(rum,l,'op:bottle');
  await f.run('addMeasurement',{ingredientId:rum,fromQuantity:'1',fromUnit:'op:bottle',toQuantity:'750',toUnit:'mL',effectiveAt:early});
  const s=await f.start(l);await f.enter(s,chicken,'8.25','lb');await f.enter(s,rum,'3.4','op:bottle');await f.submit(s);
  assert.equal((await f.inventory.overall(staff,chicken)).overallQuantity,E.of('8.25').mul('453.59237').decimal());
  assert.equal((await f.inventory.overall(staff,rum)).overallQuantity,'2550.000000000000');
});

test('inventory: unresolved conversions are preserved, propagate null total and never borrow another item measurement',async()=>{
  const f=fixture(),l=await f.location('Storage'),a=await f.item('Unknown container','mL'),b=await f.item('Known container','mL');await f.assign(a,l,'op:container');
  await f.run('addMeasurement',{ingredientId:b,fromQuantity:'1',fromUnit:'op:container',toQuantity:'1000',toUnit:'mL',effectiveAt:early});
  const {sessionId}=await f.count(l,a,'1.75','op:container');let result=await f.inventory.overall(staff,a);
  assert.equal(result.overallQuantity,null);assert.equal(result.breakdown[0].status,'unresolved_conversion');assert.equal(result.breakdown[0].observation.conversion.blocker.reason,'unresolved_missing_measurement');
  await f.run('addMeasurement',{ingredientId:a,fromQuantity:'1',fromUnit:'op:container',toQuantity:'1000',toUnit:'mL',effectiveAt:early});
  assert.equal((await f.inventory.session(staff,sessionId)).observations[0].baseQuantity,null);
});

test('inventory: later conversion changes and corrections never reinterpret a submitted observation',async()=>{
  const f=fixture(),l=await f.location('Bar'),item=await f.item('Spirit','mL');await f.assign(item,l,'op:bottle');
  const m=await f.run('addMeasurement',{ingredientId:item,fromQuantity:'1',fromUnit:'op:bottle',toQuantity:'750',toUnit:'mL',effectiveAt:early});
  const {sessionId,observationId}=await f.count(l,item,'22','op:bottle',staff,'2026-09-01T00:00:00Z');
  const old=(await f.inventory.session(manager,sessionId)).observations[0];
  await f.run('addMeasurement',{ingredientId:item,measurementKey:m.measurementKey,fromQuantity:'1',fromUnit:'op:bottle',toQuantity:'1000',toUnit:'mL',effectiveAt:early,supersedesId:m.id});
  await f.invRun('correctCount',{observationId,expectedRevisionId:observationId,quantity:'2.2',reason:'Decimal entry error'},manager);
  const current=await f.inventory.session(manager,sessionId);assert.equal(current.observations[0].baseQuantity,'1650.000000000000');assert.deepEqual(current.observations[0].conversion,old.conversion);assert.equal(current.revisions.length,2);assert.equal(current.revisions[0].quantity,'22');assert.equal(current.observations[0].actorId,manager.id);
});

test('inventory: historical knowledge selects original observation before correction and hides unsubmitted counts',async()=>{
  const f=fixture(),l=await f.location('Cage'),item=await f.item('Bottle','op:bottle');await f.assign(item,l,'op:bottle');
  const s=await f.start(l),o=await f.enter(s,item,'22','op:bottle');const beforeSubmit=(await f.inventory.session(staff,s)).observations[0].recordedAt;
  await f.submit(s);const beforeCorrection=(await f.inventory.session(staff,s)).submittedAt;
  await f.invRun('correctCount',{observationId:o,expectedRevisionId:o,quantity:'2.2',reason:'Decimal error'},manager);
  assert.equal((await f.inventory.overall(staff,item,{knownAt:beforeSubmit})).overallQuantity,null);
  assert.equal((await f.inventory.overall(staff,item,{knownAt:beforeCorrection})).overallQuantity,'22.000000000000');
  assert.equal((await f.inventory.overall(staff,item)).overallQuantity,'2.200000000000');
  assert.equal((await f.inventory.session(manager,s,{knownAt:beforeCorrection})).revisions.length,1);
  assert.equal((await f.inventory.session(manager,s,{knownAt:beforeSubmit})).status,'draft');
});

test('inventory: partial later sheet retains older omitted item observation and its true age',async()=>{
  const f=fixture(),l=await f.location('Bar'),a=await f.item('A'),b=await f.item('B');await f.assign(a,l);await f.assign(b,l);
  const old=await f.start(l,staff,'2026-09-11T00:00:00Z');await f.enter(old,a,'1');await f.enter(old,b,'2');await f.submit(old);
  await f.count(l,a,'3','each',staff,'2026-09-15T00:00:00Z');
  const result=await f.inventory.locationObservations(staff,l);assert.equal(result.items.find(i=>i.ingredientId===b).observation.observedAt,'2026-09-11T00:00:00.000Z');assert.equal(result.items.find(i=>i.ingredientId===a).observation.quantity,'3');
});

test('inventory: equal-time independent observations are an explicit conflict, not last writer wins',async()=>{
  const f=fixture(),l=await f.location('Bar'),a=await f.item('A');await f.assign(a,l);
  await f.count(l,a,'2','each',staff);await f.count(l,a,'3','each',lead);
  const result=await f.inventory.overall(staff,a);assert.equal(result.overallQuantity,null);assert.equal(result.breakdown[0].status,'conflicting_observations');assert.equal(result.breakdown[0].candidates.length,2);
});

test('inventory: archive assignment, location and ingredient without losing snapshots, observations or corrections',async()=>{
  const f=fixture(),l=await f.location('Legacy store'),a=await f.item('Archived item'),assignment=await f.assign(a,l);
  const {sessionId,observationId}=await f.count(l,a,'14');
  await f.invRun('updateAssignment',{assignmentId:assignment,expectedVersion:1,countUnit:'each',active:false});assert.equal((await f.inventory.countSheet(staff,l)).items.length,0);
  await f.invRun('updateLocation',{locationId:l,expectedVersion:1,name:'Archived store',active:false});
  await f.run('setArchived',{collection:'ingredients',entityId:a,archived:true});
  assert.equal((await f.inventory.locations(staff)).length,0);await assert.rejects(f.start(l),e=>e.code==='inactive_reference');
  await f.invRun('correctCount',{observationId,expectedRevisionId:observationId,quantity:'12',reason:'Reviewed original sheet'},manager);
  const history=await f.inventory.session(manager,sessionId);assert.equal(history.snapshot.location.name,'Legacy store');assert.equal(history.snapshot.items[0].name,'Archived item');assert.equal(history.observations[0].quantity,'12');
  const all=await f.inventory.overall(staff,a);assert.equal(all.overallQuantity,'12.000000000000');assert.equal(all.active,false);assert.equal(all.breakdown[0].location.active,false);
  assert.equal((await f.inventory.sessions(manager,{locationId:l})).length,1);
});

test('inventory: an existing draft snapshot survives subsequent configuration and archival',async()=>{
  const f=fixture(),l=await f.location('Prep'),a=await f.item('A'),assignment=await f.assign(a,l);
  const s=await f.start(l);await f.invRun('updateAssignment',{assignmentId:assignment,expectedVersion:1,countUnit:'op:container',active:false});
  await f.invRun('updateLocation',{locationId:l,expectedVersion:1,name:'Prep closed',active:false});
  await f.enter(s,a,'14');await f.submit(s);assert.equal((await f.inventory.session(staff,s)).snapshot.items[0].countUnit,'each');
});

for(const value of ['-1','NaN','Infinity','-Infinity','1e3','1,000','',1])test(`inventory: invalid count ${JSON.stringify(value)} cannot mutate observations or audit`,async()=>{
  const f=fixture(),l=await f.location('Storage'),a=await f.item('A');await f.assign(a,l);const s=await f.start(l),before=await f.repository.read();await assert.rejects(f.enter(s,a,value));assert.deepEqual(await f.repository.read(),before);
});

test('inventory: tiny, fractional and large authoritative quantities retain exact totals',async()=>{
  for(const quantity of ['0.000000000000000001','999999999999999999999999999999.123456789']){
    const f=fixture(),l=await f.location('Storage'),a=await f.item('A','g');await f.assign(a,l,'g');await f.count(l,a,quantity,'g');const result=await f.inventory.overall(staff,a);const exact=new E(BigInt(result.exactOverallQuantity.numerator),BigInt(result.exactOverallQuantity.denominator));assert.ok(exact.eq(quantity));
  }
});

test('inventory: capability authorization denies configuration, correction, other sheets and sensitive audits for Lead/Staff',async()=>{
  const f=fixture(),l=await f.location('Bar'),a=await f.item('Secret item'),buy=(await f.run('createPurchaseOption',{ingredientId:a,label:'Secret supplier package',contentQuantity:'1',contentUnit:'each'})).id;
  await f.run('addPrice',{purchaseOptionId:buy,amount:'987.654321',currency:'USD'});await f.assign(a,l);const {sessionId,observationId}=await f.count(l,a,'1');
  for(const actor of [staff,lead]){
    for(const command of ['createLocation','updateLocation','configureItem','assignItem','updateAssignment','correctCount'])await assert.rejects(f.invRun(command,{},actor),e=>e.code==='forbidden');
    await assert.rejects(f.inventory.sessions(actor),e=>e.code==='forbidden');await assert.rejects(f.service.audit(actor,observationId),e=>e.code==='forbidden');
    const responses=[await f.inventory.locations(actor),await f.inventory.countSheet(actor,l),await f.inventory.locationObservations(actor,l),await f.inventory.overall(actor,a)];
    if(actor===staff)responses.push(await f.inventory.session(actor,sessionId));else await assert.rejects(f.inventory.session(actor,sessionId),e=>e.code==='forbidden');
    function inspect(v){if(!v||typeof v!=='object')return;for(const [key,value]of Object.entries(v)){assert.ok(!['amount','currency','cost','internalCost','purchaseOptionId','supplierId','provenance','previous','next','revisions'].includes(key),key);inspect(value);}}responses.forEach(inspect);assert.ok(!JSON.stringify(responses).includes('987.654321'));
  }
});

test('inventory: correction requires reason and matching revision, and audit preserves actor and old/new quantity',async()=>{
  const f=fixture(),l=await f.location('Cage'),a=await f.item('A');await f.assign(a,l);const {observationId}=await f.count(l,a,'22');
  for(const reason of ['', '  '])await assert.rejects(f.invRun('correctCount',{observationId,expectedRevisionId:observationId,quantity:'2.2',reason},manager));
  const correction=await f.invRun('correctCount',{observationId,expectedRevisionId:observationId,quantity:'2.2',reason:'Decimal error'},manager);
  await assert.rejects(f.invRun('correctCount',{observationId,expectedRevisionId:observationId,quantity:'2',reason:'Stale edit'},admin),isConflict);
  const [audit]=await f.service.audit(admin,correction.id);assert.equal(audit.previous.quantity,'22');assert.equal(audit.next.quantity,'2.2');assert.equal(audit.actorId,manager.id);assert.equal(audit.note,'Decimal error');assert.equal(audit.changeId,correction.changeId);assert.notEqual(audit.effectiveAt,audit.recordedAt);
});

test('inventory: invalid future dates, ambiguous units and invented overall write commands reject',async()=>{
  const f=fixture(),l=await f.location('Storage'),a=await f.item('A');await f.assign(a,l);
  await assert.rejects(f.start(l,staff,'2099-01-01T00:00:00Z'),e=>e.code==='invalid_observation_time');
  await assert.rejects(f.start(l,staff,'2026-02-30T00:00:00Z'));
  const s=await f.start(l);await assert.rejects(f.enter(s,a,'1','bottle'));await assert.rejects(f.invRun('setOverall',{ingredientId:a,quantity:'22'},admin),e=>e.code==='invalid_command');
});

test('inventory: observations use the conversion effective at counting time, not entry time',async()=>{
  const f=fixture(),l=await f.location('Temporal store'),a=await f.item('Temporal bottle','mL');await f.assign(a,l,'op:bottle');
  await f.run('addMeasurement',{ingredientId:a,fromQuantity:'1',fromUnit:'op:bottle',toQuantity:'750',toUnit:'mL',effectiveAt:'2026-09-01T00:00:00Z'});
  const old=await f.count(l,a,'2','op:bottle',staff,'2026-08-15T00:00:00Z');assert.equal((await f.inventory.session(manager,old.sessionId)).observations[0].baseQuantity,null);
  const newer=await f.count(l,a,'2','op:bottle',staff,'2026-09-01T00:00:00Z');assert.equal((await f.inventory.session(manager,newer.sessionId)).observations[0].baseQuantity,'1500.000000000000');
});

test('inventory: correcting an older sheet never promotes its timestamp above a newer observation',async()=>{
  const f=fixture(),l=await f.location('History store'),a=await f.item('History item');await f.assign(a,l);
  const old=await f.count(l,a,'22','each',staff,'2026-09-01T00:00:00Z');await f.count(l,a,'3','each',lead,'2026-09-15T00:00:00Z');
  await f.invRun('correctCount',{observationId:old.observationId,expectedRevisionId:old.observationId,quantity:'2.2',reason:'Old decimal error'},manager);
  assert.equal((await f.inventory.overall(staff,a)).overallQuantity,'3.000000000000');assert.equal((await f.inventory.overall(staff,a,{at:'2026-09-10T00:00:00Z'})).overallQuantity,'2.200000000000');
});

test('inventory: mixed resolved and unresolved locations preserve exact known subtotal with null overall',async()=>{
  const f=fixture(),a=await f.item('Mixed unit item','g'),one=await f.location('One'),two=await f.location('Two'),three=await f.location('Uncounted');
  for(const l of [one,two,three])await f.assign(a,l,'g');
  await f.count(one,a,'8.25','g');await f.count(two,a,'1','cup_us');
  const c=await f.inventory.overall(staff,a);assert.equal(c.overallQuantity,null);assert.equal(c.knownSubtotal,'8.250000000000');assert.deepEqual(c.breakdown.map(b=>b.status).sort(),['missing_observation','resolved','unresolved_conversion']);
});

test('inventory: archived employee identity is retained as observation text without a live-user dependency',async()=>{
  const f=fixture(),l=await f.location('User retention'),a=await f.item('User retention item'),employee={id:'former-employee',role:'STAFF'};await f.assign(a,l);
  const old=await f.count(l,a,'14','each',employee);
  // Account lifecycle belongs to the trusted adapter. No user lookup is needed to
  // render or correct a former employee's submitted observations.
  const sheet=await f.inventory.session(manager,old.sessionId);assert.equal(sheet.actorId,'former-employee');assert.equal(sheet.observations[0].actorId,'former-employee');
  await f.invRun('correctCount',{observationId:old.observationId,expectedRevisionId:old.observationId,quantity:'12',reason:'Reviewed retained count'},manager);
  assert.equal((await f.inventory.session(manager,old.sessionId)).revisions[0].actorId,'former-employee');
});

test('inventory: purchasing package size is not inferred into inventory measurements',async()=>{
  const f=fixture(),l=await f.location('Package isolation'),a=await f.item('Packaged item','mL');await f.assign(a,l,'op:bottle');
  await f.run('createPurchaseOption',{ingredientId:a,label:'750 mL bottle',contentQuantity:'750',contentUnit:'mL'});
  await f.count(l,a,'3.4','op:bottle');assert.equal((await f.inventory.overall(staff,a)).breakdown[0].status,'unresolved_conversion');
});

test('inventory: later assignment archival cannot rewrite historical as-known coverage',async()=>{
  const f=fixture(),a=await f.item('Historical coverage'),one=await f.location('Counted'),two=await f.location('Missing');await f.assign(a,one);const assignment=await f.assign(a,two);
  const {sessionId}=await f.count(one,a,'3');const knownAt=(await f.inventory.session(staff,sessionId)).submittedAt;
  await f.invRun('updateAssignment',{assignmentId:assignment,expectedVersion:1,countUnit:'each',active:false});
  assert.equal((await f.inventory.overall(staff,a)).overallQuantity,'3.000000000000');
  const historical=await f.inventory.overall(staff,a,{knownAt});assert.equal(historical.overallQuantity,null);assert.equal(historical.breakdown.length,2);assert.ok(historical.breakdown.some(b=>b.status==='missing_observation'));
  const future=await f.location('Configured later');await f.assign(a,future);assert.equal((await f.inventory.overall(staff,a,{knownAt})).breakdown.length,2);
});
