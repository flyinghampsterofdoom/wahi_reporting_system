'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process'),crypto=require('node:crypto');
const {build}=require('./importer'),{migrationFiles}=require('../migrate'),{insert}=require('../repository/postgres'),{COLLECTIONS}=require('../domain/state');
const {Pool}=require('pg');
const root=path.resolve(__dirname,'../review/.runtime');
async function replaceSchema(c,state){try{
 await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(781902641)');await c.query('DROP SCHEMA IF EXISTS wahi_v2 CASCADE');await c.query('CREATE SCHEMA wahi_v2');await c.query('CREATE TABLE wahi_v2.schema_migrations (name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
 for(const f of await migrationFiles()){await c.query(f.sql);await c.query('INSERT INTO wahi_v2.schema_migrations(name,checksum) VALUES($1,$2)',[f.name,f.checksum]);}
 for(const name of COLLECTIONS)for(const row of state[name])await insert(c,name,row);
 await c.query('COMMIT');

}catch(e){await c.query('ROLLBACK');throw e;}}
async function applyLocal(state){
 const marker=JSON.parse(await fs.readFile(path.join(root,'ready.json'),'utf8'));if(marker.kind!=='wahi-isolated-owner-review')throw new Error('Not the isolated owner-review environment');
 const pool=new Pool({host:root,port:55441,user:'wahi_review',database:'postgres'}),c=await pool.connect();
 try{const identity=(await c.query("SELECT current_database() AS db,current_setting('data_directory') AS directory,inet_server_addr() AS address")).rows[0];if(identity.db!=='postgres'||identity.directory!==path.join(root,'postgres')||identity.address!==null)throw new Error('Refusing non-review database');
 await replaceSchema(c,state);return {database:'postgres',schema:'wahi_v2',hostClassification:'local private Unix socket'};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
}
async function main(){const args=process.argv.slice(2),arg=n=>args[args.indexOf(n)+1],source=arg('--source'),activationAt=arg('--activation-at');if(!args.includes('--source')||!args.includes('--activation-at'))throw new Error('Use --source <workbook> --activation-at <ISO timestamp> [--apply-local-review]');
 const python='/Users/justinrawlinson/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
 execFileSync(python,[path.join(__dirname,'extract.py'),source,path.join(root,'source.json')],{stdio:'pipe'});
 const workbook=JSON.parse(await fs.readFile(path.join(root,'source.json'),'utf8')),result=await build(workbook,{activationAt,progress:console.log});
 if(args.includes('--apply-local-review'))result.target=await applyLocal(result.state);
 await fs.writeFile(path.join(root,'import-result.json'),JSON.stringify(result));
 console.log(JSON.stringify({applied:!!result.target,counts:result.counts,reconciliation:result.reconciliation.reduce((a,r)=>(a[r.classification]=(a[r.classification]||0)+1,a),{})},null,2));
}
module.exports={applyLocal,replaceSchema};if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
