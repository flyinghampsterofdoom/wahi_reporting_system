'use strict';
const crypto=require('node:crypto'),{z}=require('zod');
const {address}=require('../integrations/resend'),{allow}=require('../email/rate-limit'),{canonicalOrigin}=require('../email/templates');
const {createUser,verify}=require('../review/auth');
const fail=code=>Object.assign(new Error(code),{code}),digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const opaque=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const neutral={message:'If an eligible account exists for that email address, password-reset instructions have been sent.'};
class AccountEmail {
 constructor(accounts,email,origin){this.accounts=accounts;this.pool=accounts.pool;this.email=email;this.origin=canonicalOrigin(origin);this.pending=new Set();}
 async invalidate(c,id){await c.query('UPDATE wahi_v2.email_verification_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',[id]);await c.query('UPDATE wahi_v2.user_setup_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',[id]);}
 async issue(c,u,purpose,actor){
  if(u.status!=='active'||!u.email||(purpose==='setup'&&u.password_hash)||(purpose==='reset'&&(!u.password_hash||!u.email_verified_at))||(purpose==='verification'&&u.email_verified_at))throw fail('invalid_state');
  // Per-account throttles serialize with all other account mutations.
  if(!await allow(c,'email-cooldown:'+u.id+':'+purpose,1,60)||!await allow(c,'email-hour:'+u.id+':'+purpose,5,3600))throw fail('email_throttled');
  let token;
  if(purpose==='verification'){
   await c.query('UPDATE wahi_v2.email_verification_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',[u.id]);token=crypto.randomBytes(32).toString('base64url');await c.query("INSERT INTO wahi_v2.email_verification_tokens(token_hash,user_id,email_address,expires_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP+interval '24 hours')",[digest(token),u.id,u.email]);
  }else{const issued=await this.accounts.issue(c,u,actor);token=issued.token;await c.query("UPDATE wahi_v2.user_setup_tokens SET email_address=$2,expires_at=issued_at+($3*interval '1 hour') WHERE token_hash=$1",[digest(token),u.email,purpose==='reset'?1:24]);}
  const deliveryId=await this.email.record(c,{userId:u.id,purpose,to:u.email});await this.accounts.audit(c,actor,u.id,purpose+'_email_issued',{deliveryId});return {deliveryId,to:u.email,purpose,token,username:u.username,origin:this.origin};
 }
 async deliver(message){try{return await this.email.sendTransactionalEmail(message);}catch{return {state:'unknown',deliveryId:message.deliveryId};}}
 async send(actor,purpose,input,self=false){const d=(self?z.object({}).strict():z.object({id:z.string().min(1),expectedVersion:z.number().int().positive()}).strict()).parse(input);const message=await this.accounts.transaction(async c=>{if(!self)await this.accounts.admin(c,actor);const u=(await c.query('SELECT * FROM wahi_v2.users WHERE id=$1 FOR UPDATE',[self?actor.id:d.id])).rows[0];if(!u)throw fail('not_found');if(self&&purpose!=='verification')throw fail('forbidden');if(!self&&u.version!==d.expectedVersion)throw fail('revision_conflict');return this.issue(c,u,purpose,actor.id);});return this.deliver(message);}
 async create(actor,input){const d=z.object({sendSetupEmail:z.boolean().default(false)}).passthrough().parse(input);const {sendSetupEmail,...profile}=d;if(!sendSetupEmail)return this.accounts.create(actor,profile);
  // Create, issue, metadata and audit share the existing account transaction.
  return this.accounts.create(actor,profile,async(c,u)=>{if(!u.email||u.status!=='active')throw fail('invalid_state');return this.issue(c,u,'setup',actor.id);}).then(async result=>({user:result.user,delivery:await this.deliver(result.emailMessage)}));
 }
 async forgot(input,network){
  // Identical public result, even for malformed inputs, throttling, and delivery failures.
  const d=z.object({email:address}).strict().safeParse(input);
  if(!await allow(this.pool,'forgot-network:'+network,200,600)||!d.success)return neutral;
  if(!await allow(this.pool,'forgot-address:'+d.data.email,5,3600))return neutral;
  try{const message=await this.accounts.transaction(async c=>{const u=(await c.query("SELECT * FROM wahi_v2.users WHERE email=$1 AND status='active' AND email_verified_at IS NOT NULL AND password_hash IS NOT NULL FOR UPDATE",[d.data.email])).rows[0];if(!u)return null;return this.issue(c,u,'reset','public-recovery');});if(message){
   // Do not wait on external-provider latency in a public enumeration-sensitive response.
   const task=this.deliver(message).catch(()=>{});this.pending.add(task);task.finally(()=>this.pending.delete(task));
  }}catch{}return neutral;
 }
 async validate(input){let d;try{d=z.object({purpose:z.enum(['setup','reset','verification']),token:opaque}).strict().parse(input);}catch{throw fail('invalid_email_token');}
  const table=d.purpose==='verification'?'email_verification_tokens':'user_setup_tokens';const row=(await this.pool.query(`SELECT t.email_address,t.purpose FROM (SELECT *,${d.purpose==='verification'?"'verification'::text AS purpose":"'unused'::text AS unused"} FROM wahi_v2.${table}) t JOIN wahi_v2.users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.purpose=$2 AND t.used_at IS NULL AND t.invalidated_at IS NULL AND t.expires_at>CURRENT_TIMESTAMP AND u.status='active' AND t.email_address=u.email AND ($2<>'reset' OR u.email_verified_at IS NOT NULL)`,[digest(d.token),d.purpose])).rows[0];if(!row)throw fail('invalid_email_token');return {valid:true};
 }
 async verifyEmail(input){let d;try{d=z.object({token:opaque}).strict().parse(input);}catch{throw fail('invalid_email_token');}return this.accounts.transaction(async c=>{
  const row=(await c.query("SELECT t.* FROM wahi_v2.email_verification_tokens t JOIN wahi_v2.users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.invalidated_at IS NULL AND t.expires_at>CURRENT_TIMESTAMP AND u.status='active' AND u.email=t.email_address FOR UPDATE OF t,u",[digest(d.token)])).rows[0];if(!row)throw fail('invalid_email_token');await c.query('UPDATE wahi_v2.users SET email_verified_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[row.user_id]);await c.query('UPDATE wahi_v2.email_verification_tokens SET used_at=CURRENT_TIMESTAMP WHERE token_hash=$1',[digest(d.token)]);await this.accounts.audit(c,row.user_id,row.user_id,'email_verified');return {verified:true};
 });}
 async consume(purpose,input){if(!['setup','reset'].includes(purpose))throw fail('invalid_email_token');await this.validate({purpose,token:input?.token});try{return await this.accounts.establish(input,{purpose,emailOnly:true});}catch(e){if(e.code==='invalid_setup')throw fail('invalid_email_token');throw e;}}
 async me(actor){const u=(await this.pool.query("SELECT username,email,email_verified_at FROM wahi_v2.users WHERE id=$1 AND status='active'",[actor.id])).rows[0];if(!u)throw fail('unauthenticated');return {username:u.username,email:u.email,emailVerified:!!u.email_verified_at};}
 async changePassword(actor,input){const d=z.object({currentPassword:z.string().max(128),password:z.string().min(12).max(128)}).strict().parse(input);const credentials=await createUser('password','STAFF',d.password);return this.accounts.transaction(async c=>{const u=(await c.query("SELECT * FROM wahi_v2.users WHERE id=$1 AND status='active' FOR UPDATE",[actor.id])).rows[0];if(!u||!await verify({salt:u.password_salt,hash:u.password_hash},d.currentPassword))throw fail('invalid_current_password');await c.query('UPDATE wahi_v2.users SET password_salt=$2,password_hash=$3,password_changed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[u.id,credentials.salt,credentials.hash]);await this.accounts.revoke(c,u,actor.id);await c.query('UPDATE wahi_v2.auth_credentials SET fingerprint=$2 WHERE user_id=$1',[u.id,digest(JSON.stringify([credentials.salt,credentials.hash]))]);await c.query('UPDATE wahi_v2.user_setup_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',[u.id]);await this.accounts.audit(c,actor.id,u.id,'password_changed');return {changed:true};});}
}
module.exports={AccountEmail,neutral};
