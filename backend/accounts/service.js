'use strict';
const crypto=require('node:crypto'),{z}=require('zod');
const {CAPABILITIES,authorize}=require('../auth'),{createUser}=require('../review/auth');
const {SessionStore}=require('../deploy/sessions');
const fail=code=>Object.assign(new Error(code),{code});
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const fingerprint=u=>digest(JSON.stringify([u.salt,u.hash]));
const normalizeUsername=s=>s.trim().toLowerCase();
const username=z.string().transform(normalizeUsername).pipe(z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/));
const email=z.union([z.string().trim().max(254).email().transform(s=>s.toLowerCase()),z.literal(''),z.null()]).transform(s=>s||null);
const profile={name:z.string().trim().min(1).max(160),username,email:email.default(null),role:z.enum(['STAFF','LEAD','MANAGER','ADMIN']),status:z.enum(['active','disabled'])};
const createSchema=z.object(profile).strict(),updateSchema=z.object({id:z.string().min(1),expectedVersion:z.number().int().positive(),...profile}).strict();
const actionSchema=z.object({id:z.string().min(1),expectedVersion:z.number().int().positive()}).strict();
const setupSchema=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),password:z.string().min(12).max(128)}).strict();
function userView(u){return {id:u.id,name:u.display_name,username:u.username,email:u.email,emailVerification:u.email?(u.email_verified_at?'verified':'unverified'):'not_provided',emailVerifiedAt:u.email_verified_at,role:u.role,capabilities:CAPABILITIES[u.role],status:u.status,createdAt:u.created_at,updatedAt:u.updated_at,createdBy:u.created_by,lastLoginAt:u.last_login_at,passwordEstablished:!!u.password_hash,passwordChangedAt:u.password_changed_at,version:u.version};}
class UserAccounts {
 constructor(pool){this.pool=pool;}
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(781902643)');const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');if(e.code==='23505')throw fail('account_conflict');throw e;}finally{c.release();}}
 async audit(c,actor,id,event,details={}){await c.query('INSERT INTO wahi_v2.user_security_audit(id,actor_id,user_id,event,details) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),actor,id,event,JSON.stringify(details)]);}
 async bootstrap(users){return this.transaction(async c=>{
  if((await c.query('SELECT singleton FROM wahi_v2.user_directory_state')).rowCount)return;
  for(const u of users){const name=username.parse(u.username);await c.query(`INSERT INTO wahi_v2.users(id,display_name,username,role,status,password_salt,password_hash,created_by) VALUES($1,$2,$3,$4,'active',$5,$6,'runtime-bootstrap')`,[u.id,u.username,name,u.role,u.salt,u.hash]);
   const existing=(await c.query('SELECT fingerprint,generation FROM wahi_v2.auth_credentials WHERE user_id=$1 FOR UPDATE',[u.id])).rows[0];
   if(existing&&existing.fingerprint!==fingerprint(u))throw fail('bootstrap_credentials_changed');
   if(!existing){const generation=crypto.randomUUID();await c.query('INSERT INTO wahi_v2.auth_credentials(user_id,fingerprint,generation) VALUES($1,$2,$3)',[u.id,fingerprint(u),generation]);await c.query('UPDATE wahi_v2.web_sessions SET credential_generation=$2 WHERE user_id=$1 AND credential_generation IS NULL',[u.id,generation]);}
   await this.audit(c,'runtime-bootstrap',u.id,'user_created',{source:'existing_account_migration'});
  }
  await c.query('INSERT INTO wahi_v2.user_directory_state(singleton) VALUES(TRUE)');
 });}
 async admin(c,actor){authorize(actor,'users.manage');const u=(await c.query('SELECT role,status FROM wahi_v2.users WHERE id=$1',[actor.id])).rows[0];if(!u||u.status!=='active'||!CAPABILITIES[u.role].includes('users.manage'))throw fail('forbidden');}
 async findLogin(value){const name=normalizeUsername(value);const r=(await this.pool.query(`SELECT u.*,c.generation FROM wahi_v2.users u JOIN wahi_v2.auth_credentials c ON c.user_id=u.id WHERE username=$1 AND status='active' AND password_hash IS NOT NULL`,[name])).rows[0];return r?{id:r.id,username:r.username,role:r.role,salt:r.password_salt,hash:r.password_hash,authGeneration:r.generation}:null;}
 async list(actor){await this.admin(this.pool,actor);return {users:(await this.pool.query('SELECT * FROM wahi_v2.users ORDER BY lower(display_name),username')).rows.map(userView),roles:Object.entries(CAPABILITIES).map(([role,capabilities])=>({role,capabilities}))};}
 async detail(actor,id){await this.admin(this.pool,actor);const u=(await this.pool.query('SELECT * FROM wahi_v2.users WHERE id=$1',[id])).rows[0];if(!u)throw fail('not_found');const token=(await this.pool.query("SELECT purpose,expires_at FROM wahi_v2.user_setup_tokens WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL AND expires_at>CURRENT_TIMESTAMP ORDER BY issued_at DESC LIMIT 1",[id])).rows[0];return {user:userView(u),pendingSetup:token?{purpose:token.purpose,expiresAt:token.expires_at}:null,audit:(await this.pool.query('SELECT actor_id,event,details,recorded_at FROM wahi_v2.user_security_audit WHERE user_id=$1 ORDER BY recorded_at DESC LIMIT 50',[id])).rows.map(r=>({actorId:r.actor_id,event:r.event,details:r.details,recordedAt:r.recorded_at}))};}
 async revoke(c,u,actor,event=true){const n=await c.query('DELETE FROM wahi_v2.web_sessions WHERE user_id=$1',[u.id]);await c.query('UPDATE wahi_v2.auth_credentials SET generation=$2 WHERE user_id=$1',[u.id,crypto.randomUUID()]);if(event)await this.audit(c,actor,u.id,'sessions_revoked',{count:n.rowCount});return n.rowCount;}
 async issue(c,u,actor){await c.query('UPDATE wahi_v2.user_setup_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',[u.id]);const token=crypto.randomBytes(32).toString('base64url'),purpose=u.password_hash?'reset':'setup';const r=(await c.query("INSERT INTO wahi_v2.user_setup_tokens(token_hash,user_id,purpose,expires_at,issued_by) VALUES($1,$2,$3,CURRENT_TIMESTAMP+interval '24 hours',$4) RETURNING expires_at",[digest(token),u.id,purpose,actor])).rows[0];await this.audit(c,actor,u.id,'setup_credential_issued',{purpose,expiresAt:r.expires_at});return {token,purpose,expiresAt:r.expires_at};}
 async create(actor,input){authorize(actor,'users.manage');const d=createSchema.parse(input);return this.transaction(async c=>{await this.admin(c,actor);const id=crypto.randomUUID();const u=(await c.query('INSERT INTO wahi_v2.users(id,display_name,username,email,role,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,d.name,d.username,d.email,d.role,d.status,actor.id])).rows[0];await c.query('INSERT INTO wahi_v2.auth_credentials(user_id,fingerprint,generation) VALUES($1,$2,$3)',[id,digest(crypto.randomBytes(32)),crypto.randomUUID()]);await this.audit(c,actor.id,id,'user_created',{name:d.name,username:d.username,email:d.email,role:d.role,status:d.status});return {user:userView(u),setup:u.status==='active'?await this.issue(c,u,actor.id):null};});}
 async lastAdmin(c,u,d){if(u.role==='ADMIN'&&u.status==='active'&&u.password_hash&&(d.role!=='ADMIN'||d.status!=='active')){const n=(await c.query("SELECT count(*)::int n FROM wahi_v2.users WHERE id<>$1 AND role='ADMIN' AND status='active' AND password_hash IS NOT NULL",[u.id])).rows[0].n;if(!n)throw fail('last_admin');}}
 async mutate(actor,action,input){authorize(actor,'users.manage');const d=(action==='update'?updateSchema:actionSchema).parse(input);return this.transaction(async c=>{await this.admin(c,actor);const u=(await c.query('SELECT * FROM wahi_v2.users WHERE id=$1 FOR UPDATE',[d.id])).rows[0];if(!u)throw fail('not_found');if(u.version!==d.expectedVersion)throw fail('revision_conflict');
  if(action==='update'){
   await this.lastAdmin(c,u,d);if(actor.id===u.id&&(d.status==='disabled'||d.role!=='ADMIN'))throw fail('self_access_change');
   const sensitive=u.role!==d.role||u.status!==d.status;const changes=[['display_name',d.name,'profile_changed'],['username',d.username,'username_changed'],['email',d.email,'email_changed'],['role',d.role,'access_changed'],['status',d.status,d.status==='active'?'account_enabled':'account_disabled']];
   for(const [key,value,event]of changes)if(u[key]!==value)await this.audit(c,actor.id,u.id,event,{before:u[key],after:value});
   await c.query('UPDATE wahi_v2.users SET display_name=$2,username=$3,email=$4,email_verified_at=CASE WHEN email IS DISTINCT FROM $4 THEN NULL ELSE email_verified_at END,role=$5,status=$6,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[u.id,d.name,d.username,d.email,d.role,d.status]);
   if(sensitive){await this.revoke(c,u,actor.id);await c.query('UPDATE wahi_v2.user_setup_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',[u.id]);}
  }else if(action==='revoke'){await this.revoke(c,u,actor.id);await c.query('UPDATE wahi_v2.users SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[u.id]);}
  else if(action==='issue-setup'){if(u.status!=='active')throw fail('invalid_state');await this.revoke(c,u,actor.id);const setup=await this.issue(c,u,actor.id);await c.query('UPDATE wahi_v2.users SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[u.id]);return {setup};}
  else throw fail('invalid_request');return {saved:true};
 });}
 async establish(input){let d;try{d=setupSchema.parse(input);}catch{throw fail('invalid_setup');}const credentials=await createUser('setup','STAFF',d.password);return this.transaction(async c=>{
  const row=(await c.query(`SELECT t.*,u.status,u.password_hash FROM wahi_v2.user_setup_tokens t JOIN wahi_v2.users u ON u.id=t.user_id WHERE token_hash=$1 AND used_at IS NULL AND invalidated_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE OF t,u`,[digest(d.token)])).rows[0];if(!row||row.status!=='active')throw fail('invalid_setup');
  await c.query('UPDATE wahi_v2.users SET password_salt=$2,password_hash=$3,password_changed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[row.user_id,credentials.salt,credentials.hash]);
  await this.revoke(c,{id:row.user_id},row.user_id);await c.query('UPDATE wahi_v2.auth_credentials SET fingerprint=$2 WHERE user_id=$1',[row.user_id,fingerprint(credentials)]);
  await c.query('UPDATE wahi_v2.user_setup_tokens SET used_at=CURRENT_TIMESTAMP WHERE token_hash=$1',[digest(d.token)]);await c.query('UPDATE wahi_v2.user_setup_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',[row.user_id]);
  await this.audit(c,row.user_id,row.user_id,row.password_hash?'password_reset':'password_established');return {established:true};
 });}
}
class NamedSessionStore extends SessionStore {
 constructor(pool){super(pool,[]);}
 async get(hash){const r=(await this.pool.query(`SELECT s.csrf,s.expires_at,u.id,u.username,u.role FROM wahi_v2.web_sessions s JOIN wahi_v2.auth_credentials c ON c.user_id=s.user_id AND c.generation=s.credential_generation JOIN wahi_v2.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>CURRENT_TIMESTAMP AND u.status='active' AND u.password_hash IS NOT NULL`,[hash])).rows[0];return r?{user:{id:r.id,username:r.username,role:r.role},userId:r.id,csrf:r.csrf,expires:new Date(r.expires_at).getTime()}:null;}
 async set(hash,session){const c=await this.pool.connect();try{await c.query('BEGIN');const u=(await c.query(`SELECT c.generation FROM wahi_v2.users u JOIN wahi_v2.auth_credentials c ON c.user_id=u.id WHERE u.id=$1 AND u.status='active' AND u.password_hash IS NOT NULL FOR UPDATE OF u,c`,[session.user.id])).rows[0];if(!u||u.generation!==session.user.authGeneration)throw fail('unauthenticated');await c.query('INSERT INTO wahi_v2.web_sessions(token_hash,user_id,csrf,expires_at,credential_generation) VALUES($1,$2,$3,$4,$5)',[hash,session.user.id,session.csrf,new Date(session.expires),u.generation]);await c.query('UPDATE wahi_v2.users SET last_login_at=CURRENT_TIMESTAMP WHERE id=$1',[session.user.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
}
module.exports={UserAccounts,NamedSessionStore,normalizeUsername,userView};
