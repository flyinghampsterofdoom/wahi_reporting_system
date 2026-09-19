'use strict';
const crypto=require('node:crypto');
const fingerprint=user=>crypto.createHash('sha256').update(JSON.stringify([user.salt,user.hash])).digest('hex');
const denied=()=>Object.assign(new Error('Authenticate again'),{code:'unauthenticated'});
class SessionStore {
 constructor(pool,users){this.pool=pool;this.credentials=new Map(users.map(u=>[u.id,fingerprint(u)]));}
 // Configuration becomes active only when credential changes, revocation and
 // audit commit together. Existing processes cannot mint sessions with old hashes.
 async activate(){
  const c=await this.pool.connect();
  try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(781902643)');
   const previous=(await c.query('SELECT user_id,fingerprint,generation FROM wahi_v2.auth_credentials ORDER BY user_id FOR UPDATE')).rows;
   for(const [userId,hash]of this.credentials){
    const old=previous.find(r=>r.user_id===userId);if(old?.fingerprint===hash)continue;
    const generation=crypto.randomUUID();
    if(!old){
     await c.query('INSERT INTO wahi_v2.auth_credentials(user_id,fingerprint,generation) VALUES($1,$2,$3)',[userId,hash,generation]);
     // One-time adoption of pre-fix sessions; unchanged accounts stay signed in.
     await c.query('UPDATE wahi_v2.web_sessions SET credential_generation=$2 WHERE user_id=$1 AND credential_generation IS NULL',[userId,generation]);
    }else{
     await c.query('UPDATE wahi_v2.auth_credentials SET fingerprint=$2,generation=$3 WHERE user_id=$1',[userId,hash,generation]);
     const removed=await c.query('DELETE FROM wahi_v2.web_sessions WHERE user_id=$1',[userId]);
     await c.query("INSERT INTO wahi_v2.auth_security_events(id,user_id,event,mechanism,revoked_sessions) VALUES($1,$2,'password_changed','configuration_activation',$3)",[crypto.randomUUID(),userId,removed.rowCount]);
    }
   }
   for(const old of previous)if(!this.credentials.has(old.user_id)){
    const removed=await c.query('DELETE FROM wahi_v2.web_sessions WHERE user_id=$1',[old.user_id]);
    await c.query('DELETE FROM wahi_v2.auth_credentials WHERE user_id=$1',[old.user_id]);
    await c.query("INSERT INTO wahi_v2.auth_security_events(id,user_id,event,mechanism,revoked_sessions) VALUES($1,$2,'account_removed','configuration_activation',$3)",[crypto.randomUUID(),old.user_id,removed.rowCount]);
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async get(hash){
  const r=(await this.pool.query(`SELECT s.user_id,s.csrf,s.expires_at,c.fingerprint FROM wahi_v2.web_sessions s
   JOIN wahi_v2.auth_credentials c ON c.user_id=s.user_id AND c.generation=s.credential_generation
   WHERE s.token_hash=$1 AND s.expires_at>CURRENT_TIMESTAMP`,[hash])).rows[0];
  return r&&this.credentials.get(r.user_id)===r.fingerprint?{userId:r.user_id,csrf:r.csrf,expires:new Date(r.expires_at).getTime()}:null;
 }
 async set(hash,session){
  const c=await this.pool.connect();
  try{
   await c.query('BEGIN');
   const current=(await c.query('SELECT fingerprint,generation FROM wahi_v2.auth_credentials WHERE user_id=$1 FOR SHARE',[session.user.id])).rows[0];
   if(!current||current.fingerprint!==this.credentials.get(session.user.id))throw denied();
   await c.query('DELETE FROM wahi_v2.web_sessions WHERE expires_at<CURRENT_TIMESTAMP');
   await c.query('INSERT INTO wahi_v2.web_sessions(token_hash,user_id,csrf,expires_at,credential_generation) VALUES($1,$2,$3,$4,$5)',[hash,session.user.id,session.csrf,new Date(session.expires),current.generation]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async delete(hash){await this.pool.query('DELETE FROM wahi_v2.web_sessions WHERE token_hash=$1',[hash]);}
 async allowLogin(key){const r=(await this.pool.query(`INSERT INTO wahi_v2.login_limits(key,attempts,expires_at) VALUES($1,1,CURRENT_TIMESTAMP+interval '1 minute') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN wahi_v2.login_limits.expires_at<CURRENT_TIMESTAMP THEN 1 ELSE wahi_v2.login_limits.attempts+1 END, expires_at=CASE WHEN wahi_v2.login_limits.expires_at<CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP+interval '1 minute' ELSE wahi_v2.login_limits.expires_at END RETURNING attempts`,[key])).rows[0];return r.attempts<=20;}
}
module.exports={SessionStore};
