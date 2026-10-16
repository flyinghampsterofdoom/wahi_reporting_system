'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),{Pool}=require('pg');
const {migrationFiles,migrate,checkSchema}=require('../migrate');
const {LaborService}=require('../labor/service');

// Production 94098f45 has 001–020 and 022. Rehearse against that schema, not
// a freshly migrated RC schema with its new columns subsequently removed.
test('Labor Pace release: production graph upgrades with 023 and additive Recipe Book tables without account deletion or invented allotments',async()=>{
 const bin=process.env.WAHI_TEST_PG_BIN||'/opt/homebrew/opt/postgresql@16/bin';
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wahi-pace-release-'));
 let pool,started=false;
 try{
  execFileSync(path.join(bin,'initdb'),['-D',path.join(directory,'data'),'--auth=trust','--username=wahi_test','--no-locale','-E','UTF8'],{stdio:'pipe'});
  execFileSync(path.join(bin,'pg_ctl'),['-D',path.join(directory,'data'),'-l',path.join(directory,'pg.log'),'-o',`-F -k ${directory} -h '' -p 55448`,'-w','start'],{stdio:'pipe'});started=true;
  pool=new Pool({host:directory,port:55448,user:'wahi_test',database:'postgres',max:2});
  const files=await migrationFiles(),baseline=files.filter(f=>f.name.slice(0,3)<'023');
  assert.deepEqual(baseline.map(f=>f.name.slice(0,3)),[...Array.from({length:20},(_,i)=>String(i+1).padStart(3,'0')),'022']);
  await pool.query('BEGIN');
  await pool.query('CREATE SCHEMA wahi_v2');
  await pool.query('CREATE TABLE wahi_v2.schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for(const f of baseline){await pool.query(f.sql);await pool.query('INSERT INTO wahi_v2.schema_migrations(name,checksum) VALUES($1,$2)',[f.name,f.checksum]);}
  await pool.query('COMMIT');
  const now=Date.parse('2026-09-15T11:00:00Z'),admin={id:'synthetic-rc-admin',role:'ADMIN'},id=crypto.randomUUID();
  await pool.query("UPDATE wahi_v2.labor_settings SET timezone='America/Los_Angeles',closeout_hour=4");
  await pool.query("INSERT INTO wahi_v2.labor_standing_targets(id,effective_week,foh,boh,actor_id,recorded_at) VALUES($1,'2026-09-13',80,140,$2,$3)",[id,admin.id,new Date(now)]);
  await pool.query("INSERT INTO wahi_v2.labor_sync_days(business_date,synced_at) SELECT d,$1 FROM generate_series('2026-09-13'::date,'2026-09-15'::date,interval '1 day') d",[new Date(now)]);
  const targets=(await pool.query('SELECT * FROM wahi_v2.labor_standing_targets')).rows,ledger=(await pool.query('SELECT * FROM wahi_v2.schema_migrations ORDER BY name')).rows;
  await assert.rejects(checkSchema(pool),/Pending, unknown, or changed migrations/);
  assert.deepEqual(await migrate(pool),['023_labor_daily_allotments.sql','028_review_intelligence.sql','029_review_providers.sql','030_review_google_connection.sql','031_recipe_book_foundation.sql','032_recipe_builder.sql']);
  await checkSchema(pool);assert.deepEqual(await migrate(pool),[]);
  assert.deepEqual((await pool.query("SELECT * FROM wahi_v2.schema_migrations WHERE name NOT IN ('023_labor_daily_allotments.sql','028_review_intelligence.sql','029_review_providers.sql','030_review_google_connection.sql','031_recipe_book_foundation.sql','032_recipe_builder.sql') ORDER BY name")).rows,ledger);
  const rows=(await pool.query('SELECT * FROM wahi_v2.labor_standing_targets')).rows;
  assert.deepEqual(rows.map(({foh_daily,boh_daily,...rest})=>{assert.equal(foh_daily,null);assert.equal(boh_daily,null);return rest;}),targets);
  assert.equal((await pool.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='wahi_v2' AND table_name='users' AND column_name='deleted_at'")).rows[0].n,0);
  let service=new LaborService(pool,{}, {clock:()=>now}),view=await service.overview(admin);
  assert.equal(view.metrics.foh.display.target,'80.0');assert.equal(view.metrics.boh.display.target,'140.0');
  for(const area of ['foh','boh','overall'])assert.equal(view.metrics[area].pace.display.percentage,null);
  const daily={foh_daily:['10','10','12','12','12','12','12'],boh_daily:['20','20','20','20','20','20','20']};
  await service.configure(admin,'target',{...daily,expectedId:id});
  service=new LaborService(pool,{}, {clock:()=>now});view=await service.overview(admin);
  assert.equal(view.metrics.foh.pace.display.allotted,'32.0');assert.equal(view.metrics.boh.pace.display.allotted,'60.0');assert.equal(view.metrics.overall.pace.display.allotted,'92.0');
  assert.deepEqual((await service.policy(admin)).currentTarget.foh_daily,daily.foh_daily);
 }finally{
  await pool?.end();
  if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',path.join(directory,'data'),'-m','immediate','-w','stop'],{stdio:'pipe'});
  await fs.rm(directory,{recursive:true,force:true});
 }
});
