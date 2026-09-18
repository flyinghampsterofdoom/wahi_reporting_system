'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {localPool}=require('./repository/postgres');
async function migrationFiles() {
  const dir=path.join(__dirname,'migrations');
  return Promise.all((await fs.readdir(dir)).filter(n=>/^\d{3}_.+\.sql$/.test(n)).sort().map(async name=>{const sql=await fs.readFile(path.join(dir,name),'utf8');return {name,sql,checksum:crypto.createHash('sha256').update(sql).digest('hex')};}));
}
async function migrate(pool) {
  const files=await migrationFiles(),c=await pool.connect();
  try {
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(781902641)');
    await c.query('CREATE SCHEMA IF NOT EXISTS wahi_v2');
    await c.query('CREATE TABLE IF NOT EXISTS wahi_v2.schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const applied=(await c.query('SELECT name,checksum FROM wahi_v2.schema_migrations')).rows;
    for(const r of applied)if(!files.some(f=>f.name===r.name&&f.checksum===r.checksum))throw new Error('Unknown or changed migration: '+r.name);
    const installed=[];
    for(const f of files)if(!applied.some(r=>r.name===f.name)) {await c.query(f.sql);await c.query('INSERT INTO wahi_v2.schema_migrations (name,checksum) VALUES ($1,$2)',[f.name,f.checksum]);installed.push(f.name);}
    await c.query('COMMIT');return installed;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function checkSchema(pool) {
  const files=await migrationFiles();
  const rows=(await pool.query('SELECT name,checksum FROM wahi_v2.schema_migrations')).rows;
  if(rows.length!==files.length||files.some(f=>!rows.some(r=>r.name===f.name&&r.checksum===f.checksum)))throw new Error('Pending, unknown, or changed migrations; run explicit migration command');
}
if(require.main===module) {
  if(!process.argv.includes('--apply')) {console.error('Explicit --apply is required. Uses WAHI_DATABASE_URL and wahi_v2 schema only.');process.exitCode=1;}
  else {const pool=localPool();migrate(pool).then(x=>console.log({applied:x})).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());}
}
module.exports={migrate,checkSchema,migrationFiles};
