'use strict';
// Explicit one-time import; never called by the web server or deployment startup.
const fs=require('node:fs/promises');
const {build}=require('../import/importer');
const {COLLECTIONS}=require('../domain/state');
const {insert}=require('../repository/postgres');
const {checkSchema}=require('../migrate');
function validateCheckpoint(fresh,state){
 if(!state||COLLECTIONS.some(k=>!Array.isArray(state[k])))throw new Error('Invalid reviewed checkpoint');
 const a=fresh.state.importRecords,b=state.importRecords;
 if(a.length!==b.length||a.some(r=>!b.some(v=>v.id===r.id&&v.sourceHash===r.sourceHash)))throw new Error('Reviewed checkpoint source evidence mismatch');
 for(const k of ['ingredients','recipes','suppliers','recipeCategories','inventoryLocations'])if(fresh.state[k].some(r=>!state[k].some(v=>v.id===r.id)))throw new Error('Reviewed checkpoint missing imported identities');
 return state;
}
async function importEmpty(pool,state){await checkSchema(pool);const c=await pool.connect();try{
 await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(781902641)');
 const identity=(await c.query('SELECT current_database() AS db')).rows[0];if(identity.db!=='wahi_reporting_db')throw new Error('Unexpected import database');
 for(const name of COLLECTIONS){const table=require('../repository/schema').snake(name);if((await c.query(`SELECT EXISTS(SELECT 1 FROM wahi_v2.${table}) AS occupied`)).rows[0].occupied)throw new Error('Refusing duplicate import into populated v2 schema');}
 for(const name of COLLECTIONS)for(const row of state[name])await insert(c,name,row);
 await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function prepare(sourceFile,checkpointFile,activationAt){const workbook=JSON.parse(await fs.readFile(sourceFile,'utf8'));const fresh=await build(workbook,{activationAt});return checkpointFile?validateCheckpoint(fresh,JSON.parse(await fs.readFile(checkpointFile,'utf8'))):fresh.state;}
module.exports={validateCheckpoint,importEmpty,prepare};
