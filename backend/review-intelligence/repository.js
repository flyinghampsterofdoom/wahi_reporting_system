'use strict';
const {fail}=require('./google');
class ReviewRepository {
 constructor(pool,{environment,hostedVerified=false}={}){
  // Never consume WAHI_DATABASE_URL or credentials. This phase is Unix-socket local only.
  if(!hostedVerified&&(environment!=='local-review'||!pool?.options?.host?.startsWith('/')||pool.options.connectionString))throw fail('review_local_only');
  this.pool=pool;
 }
 static hosted(pool,config){let db,origin;try{db=new URL(config.connectionString);origin=new URL(config.origin);}catch{throw fail('review_hosted_target_denied');}if(config.environment!=='production'||origin.protocol!=='https:'||origin.origin!=='https://wahi-reporting-system.onrender.com'||!['postgres:','postgresql:'].includes(db.protocol)||decodeURIComponent(db.pathname.slice(1))!=='wahi_reporting_db'||!['dpg-d6qot2fkijhs73ba5itg-a','dpg-d6qot2fkijhs73ba5itg-a.oregon-postgres.render.com'].includes(db.hostname)||pool?.options?.connectionString!==config.connectionString)throw fail('review_hosted_target_denied');return new ReviewRepository(pool,{environment:config.environment,hostedVerified:true});}
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(781902650)');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async locked(key,fn){const c=await this.pool.connect();let locked=false;try{locked=(await c.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',['review:'+key])).rows[0].locked;if(!locked)throw fail('review_worker_busy');return await fn();}finally{if(locked)await c.query('SELECT pg_advisory_unlock(hashtext($1))',['review:'+key]);c.release();}}
}
module.exports={ReviewRepository};
