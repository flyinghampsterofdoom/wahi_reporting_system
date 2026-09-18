'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {Pool}=require('pg');
const {migrate,checkSchema}=require('../migrate');
const {PostgresRepository,localPool}=require('../repository/postgres');
const {fixture,admin,staff,early}=require('./helpers');
let directory,pool,started=false;
const bin=process.env.WAHI_TEST_PG_BIN||'/opt/homebrew/opt/postgresql@16/bin';
before(async()=>{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'wahi-phase1-'));
  const data=path.join(directory,'data');
  execFileSync(path.join(bin,'initdb'),['-D',data,'--auth=trust','--username=wahi_test','--no-locale','-E','UTF8'],{stdio:'pipe'});
  // Private Unix socket and no TCP listener: never touches an existing server.
  execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(directory,'postgres.log'),'-o',`-F -k ${directory} -h '' -p 55439`,'-w','start'],{stdio:'pipe'});started=true;
  pool=new Pool({host:directory,port:55439,user:'wahi_test',database:'postgres',max:5});
});
after(async()=>{
  if(pool)await pool.end();
  if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',path.join(directory,'data'),'-m','immediate','-w','stop'],{stdio:'pipe'});
  if(directory)await fs.rm(directory,{recursive:true,force:true});
});

test('PostgreSQL migration is explicit, transactional, idempotent and isolated',async()=>{
  await pool.query('CREATE TABLE public.legacy_sentinel (value TEXT); INSERT INTO public.legacy_sentinel VALUES (\'untouched\')');
  await assert.rejects(checkSchema(pool));
  assert.deepEqual(await migrate(pool),['001_domain.sql','002_validation_guards.sql','003_inventory_foundation.sql','004_recipe_categories.sql','005_import_evidence.sql','006_integrations.sql','007_hosted_sessions.sql']);assert.deepEqual(await migrate(pool),[]);await checkSchema(pool);
  assert.equal((await pool.query('SELECT value FROM public.legacy_sentinel')).rows[0].value,'untouched');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM wahi_v2.ingredients')).rows[0].n,0);
  const migrations=(await pool.query('SELECT * FROM wahi_v2.schema_migrations')).rows;
  await checkSchema(pool);assert.deepEqual((await pool.query('SELECT * FROM wahi_v2.schema_migrations')).rows,migrations);
});

test('PostgreSQL stores exact prices, recipe lines/steps, partial costs and transactional audit',async()=>{
  const f=fixture(new PostgresRepository(pool)),a=await f.bought('PG Pineapple','3'),dash=await f.ingredient('PG Dash');
  await f.run('setYield',{ingredientId:dash,sourceIngredientId:a.id});
  const r=await f.recipe('PG Cocktail',[{ingredientId:a.id,quantity:'1',unit:'each'},{ingredientId:dash,quantity:'1',unit:'each'}]);
  let c=await f.cost(r.output);assert.equal(c.completeCost,null);assert.equal(c.knownSubtotal,'3.000000000000');
  const reopened=fixture(new PostgresRepository(pool));
  const view=await reopened.service.recipe(staff,r.id,{knownAt:'2027-01-01T00:00:00Z'});assert.equal(view.revision.lines.length,2);assert.equal(view.revision.steps.length,1);
  await f.run('setYield',{ingredientId:dash,sourceIngredientId:a.id,sourceQuantity:'1',sourceUnit:'each',outputQuantity:'12',outputUnit:'each'});
  assert.equal((await f.cost(r.output)).completeCost,'3.250000000000');
  await f.run('addPrice',{purchaseOptionId:a.option,amount:'3.123456789123456789',currency:'USD'});
  const saved=(await pool.query('SELECT amount::text FROM wahi_v2.prices WHERE purchase_option_id=$1 ORDER BY recorded_at DESC',[a.option])).rows[0];assert.equal(saved.amount,'3.123456789123456789');
  const audit=(await pool.query("SELECT * FROM wahi_v2.audit WHERE entity_type='prices' ORDER BY recorded_at DESC LIMIT 1")).rows[0];assert.equal(audit.next.amount,saved.amount);assert.equal(audit.previous.amount,'3');
});

test('PostgreSQL rolls back domain changes if audit insertion fails',async()=>{
  const f=fixture(new PostgresRepository(pool)),a=await f.bought('Rollback item');
  await pool.query("CREATE FUNCTION wahi_v2.test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END; $$; CREATE TRIGGER test_reject_audit BEFORE INSERT ON wahi_v2.audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.test_reject_audit()");
  const prior=await f.repository.read();
  try {await assert.rejects(f.run('addPrice',{purchaseOptionId:a.option,amount:'9',currency:'USD'}),/test audit failure/);}
  finally {await pool.query('DROP TRIGGER test_reject_audit ON wahi_v2.audit; DROP FUNCTION wahi_v2.test_reject_audit()');}
  assert.deepEqual(await f.repository.read(),prior);
});

test('PostgreSQL serializes independent writers to prevent mixed dependency cycles',async()=>{
  const f=fixture(new PostgresRepository(pool)),g=fixture(new PostgresRepository(pool));
  const a=await f.ingredient('Concurrent A'),b=await f.ingredient('Concurrent B');
  const results=await Promise.allSettled([f.run('setYield',{ingredientId:a,sourceIngredientId:b}),g.run('setYield',{ingredientId:b,sourceIngredientId:a})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='cycle').length,1);
});

test('PostgreSQL prevents history mutation and foreign reference corruption',async()=>{
  await assert.rejects(pool.query("UPDATE wahi_v2.prices SET amount=0"),/append-only/);
  await assert.rejects(pool.query('DELETE FROM wahi_v2.audit'),/append-only/);
  await assert.rejects(pool.query("UPDATE wahi_v2.recipe_lines SET quantity=0"),/append-only/);
  const f=fixture(new PostgresRepository(pool)),i=await f.ingredient('Archived ingredient');
  await f.run('updateIngredient',{ingredientId:i,name:'Archived ingredient',active:false});assert.equal((await f.service.ingredient(admin,i)).active,false);
});

test('PostgreSQL persists historical measurements, labor, menu prices and operational projections',async()=>{
  const f=fixture(new PostgresRepository(pool)),a=await f.bought('Cream','4','100','mL');
  await f.run('addMeasurement',{ingredientId:a.id,fromQuantity:'100',fromUnit:'mL',toQuantity:'120',toUnit:'g',effectiveAt:early});
  const r=await f.recipe('Cream recipe',[{ingredientId:a.id,quantity:'60',unit:'g'}]);
  await f.run('setLaborRate',{department:'BOH',amount:'20',currency:'USD',effectiveAt:early});
  await f.run('setLabor',{ingredientId:r.output,kind:'time',minutes:'3',department:'BOH',outputQuantity:'1',outputUnit:'each',effectiveAt:early});
  const menu=(await f.run('createMenuItem',{name:'Cream menu'})).id;
  await f.run('setSellingPrice',{menuItemId:menu,amount:'12',currency:'USD',effectiveAt:early});
  await f.run('setMenuMapping',{menuItemId:menu,recipeId:r.id,quantity:'1',unit:'each',effectiveAt:early});
  const publicView=await f.service.menu(staff,menu);assert.equal(publicView.sellingPrice.amount,'12');assert.ok(!('internalCost'in publicView));
  const c=(await f.service.menu(admin,menu)).internalCost;assert.equal(c.materialSubtotal,'2.000000000000');assert.equal(c.laborSubtotal,'1.000000000000');
});

test('Phase 1 connection factory refuses remote database configuration and legacy fallback',()=>{
  const old=process.env.WAHI_DATABASE_URL;
  try {delete process.env.WAHI_DATABASE_URL;assert.throws(localPool,/WAHI_DATABASE_URL/);process.env.WAHI_DATABASE_URL='postgres://user@production.example/db';assert.throws(localPool,/local disposable/);}
  finally {if(old===undefined)delete process.env.WAHI_DATABASE_URL;else process.env.WAHI_DATABASE_URL=old;}
});

for(const kind of ['price','yield','recipe','basis'])test(`PostgreSQL concurrent ${kind} updates retain history and reject same-effective ambiguity`,async()=>{
  const f=fixture(new PostgresRepository(pool)),g=fixture(new PostgresRepository(pool)),a=await f.bought('Concurrent '+kind),b=await f.ingredient('Target '+kind);
  let command,inputs,collection,key,subject;
  const date='2026-09-10T00:00:00Z';
  if(kind==='price'){command='addPrice';collection='prices';key='purchaseOptionId';subject=a.option;inputs=['4','5'].map(amount=>({purchaseOptionId:a.option,amount,currency:'USD'}));}
  if(kind==='yield'){command='setYield';collection='yields';key='ingredientId';subject=b;inputs=['4','5'].map(outputQuantity=>({ingredientId:b,sourceIngredientId:a.id,sourceQuantity:'1',sourceUnit:'each',outputQuantity,outputUnit:'each'}));}
  if(kind==='recipe'){const r=await f.recipe('Concurrent recipe',[{ingredientId:a.id,quantity:'1',unit:'each'}]);command='reviseRecipe';collection='recipeRevisions';key='recipeId';subject=r.id;inputs=['4','5'].map(quantity=>({recipeId:r.id,outputQuantity:'1',outputUnit:'each',lines:[{ingredientId:a.id,quantity,unit:'each'}]}));}
  if(kind==='basis'){command='selectBasis';collection='bases';key='ingredientId';subject=a.id;inputs=[{ingredientId:a.id,kind:'purchase',purchaseOptionId:a.option},{ingredientId:a.id,kind:'labor_only'}];}
  const before=(await f.repository.read())[collection].filter(r=>r[key]===subject);
  const results=await Promise.allSettled([f.run(command,{...inputs[0],effectiveAt:date}),g.run(command,{...inputs[1],effectiveAt:date})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&/collision/.test(r.reason.message)).length,1);
  let s=await f.repository.read(),history=s[collection].filter(r=>r[key]===subject);assert.equal(history.length,before.length+1);
  for(const record of before)assert.deepEqual(history.find(r=>r.id===record.id),record);
  const winner=results.find(r=>r.status==='fulfilled').value,events=s.audit.filter(e=>e.changeId===winner.changeId);assert.ok(events.length>=1);assert.ok(events.every(e=>e.actorId===admin.id));
  // Different effective instants both survive serialized writers.
  await Promise.all([f.run(command,{...inputs[0],effectiveAt:'2026-09-11T00:00:00Z'}),g.run(command,{...inputs[1],effectiveAt:'2026-09-12T00:00:00Z'})]);
  s=await f.repository.read();history=s[collection].filter(r=>r[key]===subject);assert.equal(history.length,before.length+3);
  assert.equal(new Set(history.map(r=>r.effectiveAt)).size,history.length);
});

test('PostgreSQL archive lifecycle persists while immutable package and recipe facts remain protected',async()=>{
  const f=fixture(new PostgresRepository(pool)),supplier=(await f.run('createSupplier',{name:'Lifecycle supplier'})).id,a=await f.bought('Lifecycle item'),r=await f.recipe('Lifecycle recipe',[{ingredientId:a.id,quantity:'1',unit:'each'}]);
  for(const [collection,entityId]of [['suppliers',supplier],['purchaseOptions',a.option],['recipes',r.id]])await f.run('setArchived',{collection,entityId,archived:true});
  const s=await new PostgresRepository(pool).read();for(const [collection,entityId]of [['suppliers',supplier],['purchaseOptions',a.option],['recipes',r.id]])assert.equal(s[collection].find(r=>r.id===entityId).active,false);
  assert.equal((await f.cost(r.output)).completeCost,'3.000000000000');
  await assert.rejects(pool.query('UPDATE wahi_v2.purchase_options SET content_quantity=2 WHERE id=$1',[a.option]),/append-only/);
  await assert.rejects(pool.query("UPDATE wahi_v2.recipes SET name='changed' WHERE id=$1",[r.id]),/append-only/);
});

test('PostgreSQL rejects invalid physical NUMERIC values directly, including NaN and infinity',async()=>{
  const f=fixture(new PostgresRepository(pool)),a=await f.bought('Numeric constraint'),b=await f.derived('Numeric yield',a.id);
  await f.run('addMeasurement',{ingredientId:a.id,fromQuantity:'1',fromUnit:'each',toQuantity:'100',toUnit:'g'});
  const {randomUUID}=require('node:crypto');
  for(const [table,column]of [['purchase_options','content_quantity'],['yields','output_quantity'],['measurements','from_quantity']])for(const value of ['-1','0','NaN','Infinity','-Infinity']) {
    const patch={id:randomUUID(),[column]:value,effective_at:'2030-01-01T00:00:00Z',supersedes_id:null};
    await assert.rejects(pool.query(`INSERT INTO wahi_v2.${table} SELECT (jsonb_populate_record(NULL::wahi_v2.${table},to_jsonb(t)||$1::jsonb)).* FROM wahi_v2.${table} t LIMIT 1`,[JSON.stringify(patch)]),/check constraint/);
  }
  for(const value of ['-1','NaN','Infinity','-Infinity','malformed'])await assert.rejects(pool.query("INSERT INTO wahi_v2.prices SELECT (jsonb_populate_record(NULL::wahi_v2.prices,to_jsonb(t)||$1::jsonb)).* FROM wahi_v2.prices t LIMIT 1",[JSON.stringify({id:randomUUID(),amount:value,effective_at:'2030-01-01T00:00:00Z',supersedes_id:null})]),/check constraint|invalid input syntax/);
  assert.equal((await f.cost(b)).status,'resolved');
});

test('PostgreSQL directly enforces revision scope collisions and preserves explicit supersession',async()=>{
  const {randomUUID}=require('node:crypto'),f=fixture(new PostgresRepository(pool)),a=await f.bought('DB stream','2'),b=await f.bought('Other DB stream');
  const old=(await f.repository.read()).prices.find(p=>p.purchaseOptionId===a.option);
  const insert=patch=>pool.query('INSERT INTO wahi_v2.prices SELECT (jsonb_populate_record(NULL::wahi_v2.prices,to_jsonb(t)||$2::jsonb)).* FROM wahi_v2.prices t WHERE id=$1',[old.id,JSON.stringify({id:randomUUID(),...patch})]);
  await assert.rejects(insert({amount:'4'}),/collision/);
  await assert.rejects(insert({amount:'4',supersedes_id:old.id,purchase_option_id:b.option}),/same scope/);
  await insert({amount:'4',supersedes_id:old.id});assert.equal((await f.cost(a.id)).completeCost,'4.000000000000');
  await assert.rejects(insert({amount:'5',supersedes_id:old.id}),/unique constraint/);
});

test('PostgreSQL grouped source/basis/audit transaction rolls back completely on audit failure',async()=>{
  const f=fixture(new PostgresRepository(pool)),a=await f.ingredient('Group source'),b=await f.ingredient('Group derived');
  const before=await f.repository.read();
  await pool.query("CREATE FUNCTION wahi_v2.test_group_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='bases' THEN RAISE EXCEPTION 'group audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_group_audit BEFORE INSERT ON wahi_v2.audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.test_group_audit()");
  try{await assert.rejects(f.run('setYield',{ingredientId:b,sourceIngredientId:a}),/group audit failure/);}finally{await pool.query('DROP TRIGGER test_group_audit ON wahi_v2.audit; DROP FUNCTION wahi_v2.test_group_audit()');}
  assert.deepEqual(await f.repository.read(),before);
  const change=await f.run('setYield',{ingredientId:b,sourceIngredientId:a});
  const events=(await f.repository.read()).audit.filter(e=>e.changeId===change.changeId);assert.deepEqual(events.map(e=>e.entityType).sort(),['bases','yields']);assert.ok(events.every(e=>e.previous===null&&e.next&&e.actorId===admin.id&&e.provenance.reference));
});

const {inventoryFixture}=require('./inventory-helpers');
const {InventoryService}=require('../inventory/service');
const {manager,lead}=require('./helpers');

test('PostgreSQL inventory: two employees count different locations simultaneously with exact derived total',async()=>{
  const f=inventoryFixture(new PostgresRepository(pool)),item=await f.item('PG Bacardi','op:bottle'),bar=await f.location('PG Bar'),cage=await f.location('PG Cage');
  await f.assign(item,bar,'op:bottle');await f.assign(item,cage,'op:bottle');
  const other=new InventoryService(new PostgresRepository(pool),{clock:f.service.clock});
  const sessions=await Promise.all([f.invRun('startCount',{locationId:bar,observedAt:'2026-09-15T14:00:00Z'},staff),other.execute(lead,'startCount',{locationId:cage,observedAt:'2026-09-11T09:00:00Z'})]);
  const observations=await Promise.all([f.invRun('enterCount',{sessionId:sessions[0].id,ingredientId:item,quantity:'3.4',unit:'op:bottle',expectedRevisionId:null},staff),other.execute(lead,'enterCount',{sessionId:sessions[1].id,ingredientId:item,quantity:'12',unit:'op:bottle',expectedRevisionId:null})]);
  await Promise.all([f.invRun('submitCount',{sessionId:sessions[0].id,expectedVersion:1,expectedObservationIds:[observations[0].id]},staff),other.execute(lead,'submitCount',{sessionId:sessions[1].id,expectedVersion:1,expectedObservationIds:[observations[1].id]})]);
  const result=await other.overall(lead,item);assert.equal(result.overallQuantity,'15.400000000000');assert.equal(result.mixedObservationTimes,true);assert.equal(result.breakdown.length,2);
});

test('PostgreSQL inventory: concurrent distinct entries survive; competing edits of one entry conflict',async()=>{
  const f=inventoryFixture(new PostgresRepository(pool)),l=await f.location('PG simultaneous entry'),a=await f.item('PG A'),b=await f.item('PG B');await f.assign(a,l);await f.assign(b,l);
  const s=await f.start(l),other=new InventoryService(new PostgresRepository(pool),{clock:f.service.clock});
  const roots=await Promise.all([f.invRun('enterCount',{sessionId:s,ingredientId:a,quantity:'1',unit:'each',expectedRevisionId:null},staff),other.execute(staff,'enterCount',{sessionId:s,ingredientId:b,quantity:'2',unit:'each',expectedRevisionId:null})]);
  assert.equal((await f.inventory.session(staff,s)).observations.length,2);
  const outcomes=await Promise.allSettled([f.invRun('enterCount',{sessionId:s,ingredientId:a,quantity:'3',unit:'each',expectedRevisionId:roots[0].id},staff),other.execute(staff,'enterCount',{sessionId:s,ingredientId:a,quantity:'4',unit:'each',expectedRevisionId:roots[0].id})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected'&&r.reason.code==='revision_conflict').length,1);
  await f.submit(s);assert.equal((await f.inventory.session(manager,s)).revisions.length,3);
});

test('PostgreSQL inventory: concurrent manager corrections reject a stale version and retain both original and winner',async()=>{
  const f=inventoryFixture(new PostgresRepository(pool)),l=await f.location('PG correction'),a=await f.item('PG correction item');await f.assign(a,l);const {sessionId,observationId}=await f.count(l,a,'22');
  const other=new InventoryService(new PostgresRepository(pool),{clock:f.service.clock});
  const results=await Promise.allSettled([f.invRun('correctCount',{observationId,expectedRevisionId:observationId,quantity:'2.2',reason:'Decimal error'},manager),other.execute(admin,'correctCount',{observationId,expectedRevisionId:observationId,quantity:'2',reason:'Recheck'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='revision_conflict').length,1);
  const sheet=await f.inventory.session(manager,sessionId);assert.equal(sheet.revisions.length,2);assert.equal(sheet.revisions[0].quantity,'22');
  const winner=results.find(r=>r.status==='fulfilled').value;const [audit]=await f.service.audit(admin,winner.id);assert.equal(audit.previous.id,observationId);assert.equal(audit.next.id,sheet.observations[0].id);
  await assert.rejects(pool.query("UPDATE wahi_v2.inventory_observations SET quantity=0 WHERE id=$1",[observationId]),/append-only/);
});

test('PostgreSQL inventory: location archival racing correction keeps all historical observations',async()=>{
  const f=inventoryFixture(new PostgresRepository(pool)),l=await f.location('PG archival'),a=await f.item('PG archive item');await f.assign(a,l);const {sessionId,observationId}=await f.count(l,a,'14');
  await Promise.all([f.invRun('updateLocation',{locationId:l,expectedVersion:1,name:'PG archived',active:false}),f.invRun('correctCount',{observationId,expectedRevisionId:observationId,quantity:'12',reason:'Reviewed sheet'},manager)]);
  const sheet=await f.inventory.session(manager,sessionId);assert.equal(sheet.observations[0].quantity,'12');assert.equal(sheet.snapshot.location.name,'PG archival');
  const overall=await f.inventory.overall(staff,a);assert.equal(overall.overallQuantity,'12.000000000000');assert.equal(overall.breakdown[0].location.active,false);await assert.rejects(f.start(l),e=>e.code==='inactive_reference');
});

test('PostgreSQL inventory: audit insertion failure rolls back correction and preserves effective count',async()=>{
  const f=inventoryFixture(new PostgresRepository(pool)),l=await f.location('PG audit failure'),a=await f.item('PG audit item');await f.assign(a,l);const {observationId}=await f.count(l,a,'22');const before=await f.repository.read();
  await pool.query("CREATE FUNCTION wahi_v2.reject_inventory_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='inventoryObservations' THEN RAISE EXCEPTION 'inventory audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_inventory_audit BEFORE INSERT ON wahi_v2.audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_inventory_audit()");
  try{await assert.rejects(f.invRun('correctCount',{observationId,expectedRevisionId:observationId,quantity:'2.2',reason:'Decimal error'},manager),/inventory audit failure/);}finally{await pool.query('DROP TRIGGER reject_inventory_audit ON wahi_v2.audit; DROP FUNCTION wahi_v2.reject_inventory_audit()');}
  assert.deepEqual(await f.repository.read(),before);assert.equal((await f.inventory.overall(staff,a)).overallQuantity,'22.000000000000');
});

test('PostgreSQL inventory: fractional conversion evidence and history survive repository reopening and conversion changes',async()=>{
  const f=inventoryFixture(new PostgresRepository(pool)),l=await f.location('PG precision'),a=await f.item('PG prepared','each');await f.assign(a,l,'op:container');
  const measurement=await f.run('addMeasurement',{ingredientId:a,fromQuantity:'3',fromUnit:'op:container',toQuantity:'1',toUnit:'each',effectiveAt:early});
  const {sessionId}=await f.count(l,a,'0.1','op:container');const old=(await f.inventory.session(manager,sessionId)).observations[0];assert.deepEqual(old.exactBaseQuantity,{numerator:'1',denominator:'30'});
  await f.run('addMeasurement',{ingredientId:a,measurementKey:measurement.measurementKey,fromQuantity:'3',fromUnit:'op:container',toQuantity:'2',toUnit:'each',effectiveAt:early,supersedesId:measurement.id});
  const reopened=new InventoryService(new PostgresRepository(pool),{clock:f.service.clock});assert.deepEqual((await reopened.session(manager,sessionId)).observations[0],old);assert.deepEqual((await reopened.overall(staff,a)).exactOverallQuantity,{numerator:'1',denominator:'30'});
});

test('PostgreSQL inventory: constraints reject invalid numeric counts, destructive history and changed base units',async()=>{
  const {randomUUID}=require('node:crypto'),f=inventoryFixture(new PostgresRepository(pool)),l=await f.location('PG constraints'),a=await f.item('PG constrained');await f.assign(a,l);const {sessionId,observationId}=await f.count(l,a,'14');
  for(const quantity of ['-1','NaN','Infinity','-Infinity'])await assert.rejects(pool.query('INSERT INTO wahi_v2.inventory_observations SELECT (jsonb_populate_record(NULL::wahi_v2.inventory_observations,to_jsonb(t)||$2::jsonb)).* FROM wahi_v2.inventory_observations t WHERE id=$1',[observationId,JSON.stringify({id:randomUUID(),quantity,supersedes_id:observationId,reason:'constraint test'})]),/check constraint/);
  await assert.rejects(pool.query('DELETE FROM wahi_v2.count_sessions WHERE id=$1',[sessionId]),/cannot be deleted/);
  await assert.rejects(pool.query("UPDATE wahi_v2.inventory_items SET base_unit='g' WHERE ingredient_id=$1",[a]),/append-only/);
});

test('PostgreSQL inventory: submission audit failure leaves draft unsubmitted and excluded from overall',async()=>{
  const f=inventoryFixture(new PostgresRepository(pool)),l=await f.location('PG submission rollback'),a=await f.item('PG submission item');await f.assign(a,l);const s=await f.start(l);await f.enter(s,a,'3.4');
  await pool.query("CREATE FUNCTION wahi_v2.reject_submission_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='countSessions' AND NEW.action='revise' THEN RAISE EXCEPTION 'submission audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_submission_audit BEFORE INSERT ON wahi_v2.audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_submission_audit()");
  try{await assert.rejects(f.submit(s),/submission audit failure/);}finally{await pool.query('DROP TRIGGER reject_submission_audit ON wahi_v2.audit; DROP FUNCTION wahi_v2.reject_submission_audit()');}
  assert.equal((await f.inventory.session(staff,s)).status,'draft');assert.equal((await f.inventory.overall(staff,a)).overallQuantity,null);await f.submit(s);assert.equal((await f.inventory.overall(staff,a)).overallQuantity,'3.400000000000');
});

test('PostgreSQL recipe category lifecycle persists audit and immutable assignment history',async()=>{
 const f=fixture(new PostgresRepository(pool)),r=await f.recipe('Category test recipe',[]),cat=await f.run('createRecipeCategory',{name:'Test Prep',sortOrder:4});
 await f.run('setRecipeCategory',{recipeId:r.id,categoryId:cat.id});
 await f.run('updateRecipeCategory',{categoryId:cat.id,name:'Test renamed',sortOrder:2,active:false});
 const s=await f.service.repository.read();assert.equal(s.recipeCategories.find(c=>c.id===cat.id).active,false);assert.equal(s.recipeCategoryAssignments.filter(c=>c.recipeId===r.id).length,1);assert.equal(s.audit.filter(a=>a.entityId===cat.id).length,2);
 await assert.rejects(pool.query('DELETE FROM wahi_v2.recipe_categories WHERE id=$1',[cat.id]));
 await assert.rejects(pool.query('UPDATE wahi_v2.recipe_category_assignments SET category_id=NULL WHERE recipe_id=$1',[r.id]));
 await assert.rejects(f.run('setRecipeCategory',{recipeId:r.id,categoryId:cat.id}));
});

test('PostgreSQL migration replacement rolls back DDL and prior data when imported state fails validation',async()=>{
 const before=(await pool.query('SELECT count(*)::int AS n FROM wahi_v2.ingredients')).rows[0].n;
 const {replaceSchema}=require('../import/run'),s=require('../domain/state').emptyState();s.ingredients.push({id:'not-a-uuid',name:'invalid'});
 const c=await pool.connect();try{await assert.rejects(replaceSchema(c,s));}finally{c.release();}
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM wahi_v2.ingredients')).rows[0].n,before);await checkSchema(pool);
});

test('PostgreSQL imported real item supports normal edits and inventory configuration across repository reload',async()=>{
 const {build}=require('../import/importer'),{replaceSchema}=require('../import/run'),{DomainService}=require('../service'),{saveItem,itemRecord}=require('../review/items');
 const imported=await build(require('./fixtures/drop-source.json'),{activationAt:'2026-09-18T00:00:00.000Z'});const client=await pool.connect();try{await replaceSchema(client,imported.state);}finally{client.release();}
 const service=new DomainService(new PostgresRepository(pool),{clock:()=> '2026-09-19T00:00:00.000Z'}),actor={id:'validation',role:'ADMIN'},i=imported.state.ingredients.find(i=>i.name==='Pernod'),d=await itemRecord(service,actor,i.id),p=d.packages[0];
 await saveItem(service,actor,{id:i.id,kind:'purchase',name:i.name,description:'Persistence validation',category:'',active:true,purchase:{label:'Reviewed package',contentQuantity:p.contentQuantity,contentUnit:p.contentUnit,amount:p.price.amount,currency:'USD',supplierId:p.supplierId},measurement:{fromQuantity:'1',fromUnit:'fl_oz_us',toQuantity:'29.5735295625',toUnit:'mL'}});
 const location=await service.inventory.execute(actor,'createLocation',{name:'Validation location'});await service.inventory.execute(actor,'configureItem',{ingredientId:i.id,baseUnit:'fl_oz_us'});const a=await service.inventory.execute(actor,'assignItem',{ingredientId:i.id,locationId:location.id,countUnit:'fl_oz_us',sortOrder:0});await service.inventory.execute(actor,'updateAssignment',{assignmentId:a.id,expectedVersion:a.version,countUnit:'mL',sortOrder:1,active:true});
 const reload=new DomainService(new PostgresRepository(pool),{clock:service.clock}),after=await itemRecord(reload,actor,i.id);assert.equal(after.description,'Persistence validation');assert.equal(after.locations[0].countUnit,'mL');assert.ok(after.measurements.some(m=>m.toUnit==='mL'));assert.equal(after.packages.find(p=>p.id===after.basis.purchaseOptionId).label,'Reviewed package');assert.ok((await reload.repository.read()).audit.length>imported.state.audit.length);
});

const {ToastSettings,seal,unseal,keyBytes}=require('../integrations/toast'),crypto=require('node:crypto');
const adminIntegration={id:'integration-validation',role:'ADMIN'};
const integrationConfig={enabled:true,apiEnvironment:'sandbox',apiHost:'https://test.toasttab.com',clientId:'synthetic-client',restaurantGuid:''};
async function integrationFixture(){await pool.query('TRUNCATE wahi_v2.integration_settings,wahi_v2.integration_audit');const key=crypto.randomBytes(32).toString('base64');return {key,store:new ToastSettings(pool,{environment:'local-review',key}),secret:crypto.randomBytes(32).toString('base64')};}
test('integration: encrypted secret storage, safe metadata/audit and normal repository isolation',async()=>{const {store,secret}=await integrationFixture();await store.save(adminIntegration,{expectedVersion:0,config:integrationConfig,clientSecret:secret});const view=await store.read(adminIntegration);assert.equal(view.secretConfigured,true);assert.equal(view.status,'Configured');assert.equal(view.lastTest,null);assert.ok(!JSON.stringify(view).includes(secret));const row=(await pool.query('SELECT * FROM wahi_v2.integration_settings')).rows[0];assert.ok(!JSON.stringify(row).includes(secret));assert.equal(row.sealed_secret.version,1);assert.ok(!JSON.stringify((await pool.query('SELECT * FROM wahi_v2.integration_audit')).rows).includes(row.sealed_secret.ciphertext));assert.ok(!JSON.stringify(await new PostgresRepository(pool).read()).includes(secret));assert.equal((await store.credentialsForService()).clientSecret,secret);});
test('integration: replacement changes secret, omitted secret preserves it',async()=>{const {store,secret}=await integrationFixture();await store.save(adminIntegration,{expectedVersion:0,config:integrationConfig,clientSecret:secret});await store.save(adminIntegration,{expectedVersion:1,config:{...integrationConfig,clientId:'new-client'}});assert.equal((await store.credentialsForService()).clientSecret,secret);const replacement=crypto.randomBytes(24).toString('hex');await store.save(adminIntegration,{expectedVersion:2,config:integrationConfig,clientSecret:replacement});assert.equal((await store.credentialsForService()).clientSecret,replacement);assert.ok((await store.read(adminIntegration)).audit.some(a=>a.event==='secret_replaced'));});
test('integration: stale or invalid replacement preserves prior config and encrypted secret',async()=>{const {store,secret}=await integrationFixture();await store.save(adminIntegration,{expectedVersion:0,config:integrationConfig,clientSecret:secret});const before=(await pool.query('SELECT * FROM wahi_v2.integration_settings')).rows;await assert.rejects(store.save(adminIntegration,{expectedVersion:0,config:integrationConfig,clientSecret:'synthetic-replacement'}),{code:'revision_conflict'});await assert.rejects(store.save(adminIntegration,{expectedVersion:1,config:{...integrationConfig,apiHost:'https://evil.example'},clientSecret:secret}),{code:'invalid_integration_configuration'});assert.deepEqual((await pool.query('SELECT * FROM wahi_v2.integration_settings')).rows,before);});
test('integration: audit failure rolls back configuration and replacement atomically',async()=>{const {store,secret}=await integrationFixture();await store.save(adminIntegration,{expectedVersion:0,config:integrationConfig,clientSecret:secret});await pool.query("ALTER TABLE wahi_v2.integration_audit ADD CONSTRAINT validation_failure CHECK (event <> 'secret_replaced')");try{await assert.rejects(store.save(adminIntegration,{expectedVersion:1,config:integrationConfig,clientSecret:'synthetic-replacement'}),{code:'integration_save_failed'});assert.equal((await store.credentialsForService()).clientSecret,secret);assert.equal((await store.read(adminIntegration)).version,1);}finally{await pool.query('ALTER TABLE wahi_v2.integration_audit DROP CONSTRAINT validation_failure');}});
test('integration: Manager Staff Lead cannot read or save even when calling service directly',async()=>{const {store,secret}=await integrationFixture();for(const role of ['MANAGER','STAFF','LEAD']){const actor={id:'denied',role};await assert.rejects(store.read(actor),{code:'forbidden'});await assert.rejects(store.save(actor,{expectedVersion:0,config:integrationConfig,clientSecret:secret}),{code:'forbidden'});}});
test('integration: environment separation prevents cross-environment reads and writes',async()=>{const {store,key,secret}=await integrationFixture();await store.save(adminIntegration,{expectedVersion:0,config:integrationConfig,clientSecret:secret});const staging=new ToastSettings(pool,{environment:'staging',key});assert.equal((await staging.read(adminIntegration)).secretConfigured,false);await staging.save(adminIntegration,{expectedVersion:0,config:{...integrationConfig,enabled:false}});assert.equal((await store.credentialsForService()).clientSecret,secret);await assert.rejects(store.save(adminIntegration,{expectedVersion:1,config:integrationConfig,environment:'production'}),{code:'invalid_integration_configuration'});});
test('integration: invalid host, missing secret, unknown fields and malformed restaurant GUID fail safely',async()=>{const {store,secret}=await integrationFixture();for(const apiHost of ['http://test.toasttab.com','https://user:pass@test.toasttab.com','https://test.toasttab.com/path','https://test.toasttab.com.evil.example','https://test.toasttab.com?secret='+secret])await assert.rejects(store.save(adminIntegration,{expectedVersion:0,config:{...integrationConfig,apiHost}}),e=>e.code==='invalid_integration_configuration'&&!e.message.includes(secret));await assert.rejects(store.save(adminIntegration,{expectedVersion:0,config:integrationConfig}),{code:'integration_secret_required'});await assert.rejects(store.save(adminIntegration,{expectedVersion:0,config:{...integrationConfig,restaurantGuid:'invalid'}}),{code:'invalid_integration_configuration'});assert.equal((await store.read(adminIntegration)).version,0);});
test('integration: missing key refuses saves, authentication tag protects secret and context',async()=>{const {key,secret}=await integrationFixture(),store=new ToastSettings(pool,{environment:'local-review',key:null});await assert.rejects(store.save(adminIntegration,{expectedVersion:0,config:integrationConfig,clientSecret:secret}),{code:'integration_key_unavailable'});const bytes=keyBytes(key),sealed=seal(secret,bytes,'context');assert.throws(()=>unseal(sealed,bytes,'other'),{code:'integration_secret_unavailable'});assert.throws(()=>unseal(sealed,crypto.randomBytes(32),'context'),{code:'integration_secret_unavailable'});assert.notDeepEqual(seal(secret,bytes,'context'),sealed);});
test('integration: disable is audited and prevents future service credential consumption',async()=>{const {store,secret}=await integrationFixture();await store.save(adminIntegration,{expectedVersion:0,config:integrationConfig,clientSecret:secret});await store.save(adminIntegration,{expectedVersion:1,config:{...integrationConfig,enabled:false}});await assert.rejects(store.credentialsForService(),{code:'integration_not_configured'});const view=await store.read(adminIntegration);assert.equal(view.secretConfigured,true);assert.ok(view.audit.some(a=>a.event==='disabled'));await assert.rejects(pool.query('DELETE FROM wahi_v2.integration_audit'));});
test('integration HTTP: real PostgreSQL secret submission/read and failure responses never expose secret',async()=>{const {store,secret}=await integrationFixture(),{createReviewServer}=require('../review/server'),{createUser}=require('../review/auth'),{DomainService}=require('../service'),password=crypto.randomBytes(24).toString('hex'),user=await createUser('integration-admin','ADMIN',password);const server=createReviewServer({service:new DomainService(new PostgresRepository(pool)),users:[user],integrations:store});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;let cookie,csrf;const request=async(path,body)=>{const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {response,value:await response.json()};};try{const login=await request('login',{username:user.username,password});cookie=login.response.headers.get('set-cookie').split(';')[0];csrf=(await request('me')).value.csrf;const saved=await request('admin/integrations/toast',{expectedVersion:0,config:integrationConfig,clientSecret:secret});assert.equal(saved.response.status,200);assert.ok(!JSON.stringify(saved.value).includes(secret));const read=await request('admin/integrations/toast');assert.equal(read.value.secretConfigured,true);assert.ok(!JSON.stringify(read.value).includes(secret));store.save=async()=>{throw new Error('internal '+secret);};const error=await request('admin/integrations/toast',{expectedVersion:1,config:integrationConfig});assert.equal(error.response.status,400);assert.ok(!JSON.stringify(error.value).includes(secret));}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});

test('hosted PostgreSQL sessions survive store recreation and logout; login limits persist',async()=>{
 const {SessionStore}=require('../deploy/runtime'),crypto=require('node:crypto');const a=new SessionStore(pool),hash=crypto.randomBytes(32).toString('hex'),session={user:{id:'hosted-owner'},csrf:crypto.randomBytes(24).toString('hex'),expires:Date.now()+60000};await a.set(hash,session);const b=new SessionStore(pool);assert.equal((await b.get(hash)).userId,'hosted-owner');await b.delete(hash);assert.equal(await a.get(hash),null);const key=crypto.randomUUID();for(let i=0;i<20;i++)assert.equal(await a.allowLogin(key),true);assert.equal(await b.allowLogin(key),false);
});
test('hosted importer rejects wrong database before inserting into any schema',async()=>{const before=await new PostgresRepository(pool).read();await assert.rejects(require('../deploy/import').importEmpty(pool,before),/Unexpected import database/);assert.deepEqual(await new PostgresRepository(pool).read(),before);});
test('hosted batched importer uses canonical mappings, preserves exact facts and rolls back safely',async()=>{const {insertState}=require('../deploy/import'),{build}=require('../import/importer'),{replaceSchema}=require('../import/run');const state=(await build(require('./fixtures/drop-source.json'),{activationAt:'2026-09-18T00:00:00.000Z'})).state,c=await pool.connect();try{await replaceSchema(c,require('../domain/state').emptyState());await c.query('BEGIN');await insertState(c,state);await c.query('COMMIT');const stored=await new PostgresRepository(pool).read();for(const k of Object.keys(state))assert.deepEqual(stored[k].sort((a,b)=>a.id.localeCompare(b.id)),state[k].sort((a,b)=>a.id.localeCompare(b.id)));await c.query('BEGIN');await assert.rejects(insertState(c,state));await c.query('ROLLBACK');assert.equal((await new PostgresRepository(pool).read()).ingredients.length,state.ingredients.length);}finally{c.release();}});

test('current SQL snapshot is one bounded exact read, without audit/import/history reconstruction',async()=>{
 const f=fixture(new PostgresRepository(pool)),a=await f.bought('Current bounded decimal','3.123456789123456789'),other=await f.bought('Unrelated current item');
 const r=await f.recipe('Current bounded recipe',[{ingredientId:a.id,quantity:'2',unit:'each'}]);
 const at='2028-01-01T00:00:00.000Z',full=await f.repository.read();let calls=0;
 const repo=new PostgresRepository({query:async(...args)=>{calls++;return pool.query(...args);}});
 const s=await repo.readCurrent({at,recipeId:r.id});assert.equal(calls,1);assert.deepEqual(new Set(s.ingredients.map(i=>i.id)),new Set([a.id,r.output]));assert.ok(!s.ingredients.some(i=>i.id===other.id));assert.equal(s.audit.length,0);assert.equal(s.importRecords.length,0);
 const {costIngredient}=require('../domain/costing'),req={ingredientId:r.output,quantity:'1',unit:'each',at,knownAt:at};assert.deepEqual(costIngredient(s,req),costIngredient(full,req));assert.equal(s.prices.find(p=>p.purchaseOptionId===a.option).amount,'3.123456789123456789');
});

test('current SQL selects supersession and future boundaries identically to historical authority',async()=>{
 const f=fixture(new PostgresRepository(pool)),a=await f.bought('Current boundary','2');
 const first=(await f.repository.read()).prices.find(p=>p.purchaseOptionId===a.option);
 await f.run('addPrice',{purchaseOptionId:a.option,amount:'4',currency:'USD',effectiveAt:early,supersedesId:first.id});
 await f.run('addPrice',{purchaseOptionId:a.option,amount:'9',currency:'USD',effectiveAt:'2030-01-01T00:00:00.000Z'});
 const {costIngredient}=require('../domain/costing');
 for(const at of ['2026-09-18T12:00:03.000Z','2029-01-01T00:00:00.000Z','2031-01-01T00:00:00.000Z']){const full=await f.repository.read(),s=await f.repository.readCurrent({at,itemId:a.id}),req={ingredientId:a.id,quantity:'2',unit:'each',at,knownAt:at};assert.deepEqual(costIngredient(s,req),costIngredient(full,req));assert.ok(s.prices.length<=1);}
});

test('current projections use fresh SQL after price mutation and restoration; history remains exact',async()=>{
 const f=fixture(new PostgresRepository(pool)),a=await f.bought('Current mutation','2'),r=await f.recipe('Current downstream',[{ingredientId:a.id,quantity:'3',unit:'each'}]);const at='2027-01-01T00:00:00.000Z';
 const svc=new (require('../service').DomainService)(f.repository,{clock:()=>at}),{view}=require('../review/views');
 const cost=async()=>(await view(svc,admin,'recipe',r.id)).recipe.cost.completeCost;
 assert.equal(await cost(),'6.000000000000');
 const historicalAt='2026-09-18T11:59:59.000Z',historical=await f.cost(r.output,'1','each',{at:historicalAt,knownAt:at});
 await f.run('addPrice',{purchaseOptionId:a.option,amount:'5',currency:'USD'});assert.equal(await cost(),'15.000000000000');
 await f.run('addPrice',{purchaseOptionId:a.option,amount:'2',currency:'USD'});assert.equal(await cost(),'6.000000000000');
 assert.deepEqual(await f.cost(r.output,'1','each',{at:historicalAt,knownAt:at}),historical);
});

test('current SQL vendor eligibility retains future-only and historical source evidence without returning history',async()=>{
 const f=fixture(new PostgresRepository(pool)),a=await f.bought('Current vendor'),supplier=await f.run('createSupplier',{name:'Future current vendor',contact:''});
 const option=await f.run('createPurchaseOption',{ingredientId:a.id,supplierId:supplier.id,label:'Future source',contentQuantity:'1',contentUnit:'each'});
 await f.run('addPrice',{purchaseOptionId:option.id,amount:'9',currency:'USD',effectiveAt:'2030-01-01T00:00:00.000Z'});
 const {currentVendors}=require('../review/vendors');for(const at of ['2027-01-01T00:00:00.000Z','2031-01-01T00:00:00.000Z']){const s=await f.repository.readCurrent({at,itemId:a.id}),full=await f.repository.read();assert.deepEqual(currentVendors(s,a.id,at),currentVendors(full,a.id,at));}
});
