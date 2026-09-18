'use strict';
const {emptyState,COLLECTIONS}=require('../domain/state');
const {definitions,snake}=require('./schema');
const jsonFields=new Set(['tags','provenance','previous','next','snapshot','conversion','sourceValues','issues','entityIds']);
function localPool() {
  const connectionString=process.env.WAHI_DATABASE_URL;
  if(!connectionString)throw new Error('WAHI_DATABASE_URL is required; legacy DATABASE_URL is never used');
  const url=new URL(connectionString);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Phase 1 only permits a local disposable PostgreSQL database');
  return new (require('pg').Pool)({connectionString,max:5});
}
function decode(row,keys) {return Object.fromEntries(keys.map(k=>{const v=row[snake(k)];return [k,v instanceof Date?v.toISOString():v];}));}
async function readState(client) {
  const s=emptyState();
  for(const name of COLLECTIONS) {
    const {rows}=await client.query(`SELECT * FROM wahi_v2.${snake(name)}`);
    s[name]=rows.map(r=>decode(r,Object.keys(definitions[name])));
  }
  const lines=(await client.query('SELECT * FROM wahi_v2.recipe_lines ORDER BY position')).rows;
  const steps=(await client.query('SELECT * FROM wahi_v2.recipe_steps ORDER BY position')).rows;
  for(const r of s.recipeRevisions) {
    r.lines=lines.filter(l=>l.recipe_revision_id===r.id).map(l=>({id:l.id,ingredientId:l.ingredient_id,quantity:l.quantity,unit:l.unit,notes:l.notes}));
    r.steps=steps.filter(l=>l.recipe_revision_id===r.id).map(l=>({id:l.id,position:l.position,instruction:l.instruction}));
  }
  return s;
}
async function insert(client,name,row) {
  const keys=Object.keys(definitions[name]);
  const values=keys.map(k=>jsonFields.has(k)&&row[k]!==null?JSON.stringify(row[k]):row[k]);
  await client.query(`INSERT INTO wahi_v2.${snake(name)} (${keys.map(snake).join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values);
  if(name==='recipeRevisions') {
    for(const [position,l] of row.lines.entries())await client.query('INSERT INTO wahi_v2.recipe_lines (id,recipe_revision_id,position,ingredient_id,quantity,unit,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',[l.id,row.id,position,l.ingredientId,l.quantity,l.unit,l.notes||'']);
    for(const step of row.steps)await client.query('INSERT INTO wahi_v2.recipe_steps (id,recipe_revision_id,position,instruction) VALUES ($1,$2,$3,$4)',[step.id,row.id,step.position,step.instruction]);
  }
}
class PostgresRepository {
  constructor(pool) {this.pool=pool;}
  async read() {
    const c=await this.pool.connect();
    try {await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await readState(c);await c.query('COMMIT');return result;}
    catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async transaction(fn) {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      // All domain writes share this transaction lock BEFORE reading. Each
      // subsequent reader therefore sees the preceding committed graph.
      await c.query("SELECT pg_advisory_xact_lock(781902641)");
      const before=await readState(c),draft=structuredClone(before),result=await fn(draft);
      for(const name of COLLECTIONS) {
        const old=new Map(before[name].map(r=>[r.id,r]));
        for(const row of draft[name]) {
          if(!old.has(row.id))await insert(c,name,row);
          else if(JSON.stringify(old.get(row.id))!==JSON.stringify(row)) {
            if(!['ingredients','menuItems','suppliers','purchaseOptions','recipes','inventoryLocations','inventoryAssignments','countSessions','recipeCategories'].includes(name))throw new Error('Only ingredient/menu descriptive metadata may update in place');
            const keys=Object.keys(definitions[name]).filter(k=>k!=='id');
            await c.query(`UPDATE wahi_v2.${snake(name)} SET ${keys.map((k,i)=>snake(k)+'=$'+(i+1)).join(',')} WHERE id=$${keys.length+1}`,[...keys.map(k=>jsonFields.has(k)?JSON.stringify(row[k]):row[k]),row.id]);
          }
        }
        if(draft[name].length<before[name].length)throw new Error('Domain records cannot be deleted');
      }
      await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
}
module.exports={PostgresRepository,localPool,insert};
