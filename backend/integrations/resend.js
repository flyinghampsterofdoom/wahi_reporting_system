'use strict';
const crypto=require('node:crypto'),{z}=require('zod'),{authorize}=require('../auth');
const {seal,unseal,keyBytes}=require('./toast');
const {template}=require('../email/templates'),{allow}=require('../email/rate-limit');
const fail=code=>Object.assign(new Error(code),{code});
const address=z.string().max(254).regex(/^[^\r\n<>]+$/).trim().email().transform(s=>s.toLowerCase());
const configSchema=z.object({enabled:z.boolean(),senderName:z.string().trim().min(1).max(100).regex(/^[^\r\n<>"\\]+$/),senderEmail:address}).strict();
const inputSchema=z.object({expectedVersion:z.number().int().nonnegative(),config:configSchema,apiKey:z.string().regex(/^re_[A-Za-z0-9_-]{10,200}$/).optional()}).strict();
class ResendEmail {
 constructor(pool,{environment,key,fetch:transport=globalThis.fetch}){if(!['local-review','staging','production'].includes(environment))throw fail('invalid_integration_environment');this.pool=pool;this.environment=environment;this.key=key?keyBytes(key):null;this.fetch=transport;}
 context(){return 'wahi:resend:'+this.environment+':v1';}
 async read(actor){authorize(actor,'integrations.manage');const row=(await this.pool.query("SELECT config,version,updated_at,sealed_secret IS NOT NULL AS secret_configured FROM wahi_v2.integration_settings WHERE environment=$1 AND name='resend'",[this.environment])).rows[0];const deliveries=(await this.pool.query("SELECT id,user_id,purpose,recipient,requested_at,completed_at,CASE WHEN state='requested' AND requested_at<CURRENT_TIMESTAMP-interval '2 minutes' THEN 'unknown' ELSE state END AS state,provider_message_id,failure_reason FROM wahi_v2.email_deliveries ORDER BY requested_at DESC LIMIT 30")).rows;return {environment:this.environment,version:row?.version||0,config:row?.config||null,secretConfigured:!!row?.secret_configured,keyAvailable:!!this.key,status:row?.config.enabled&&row?.secret_configured?'Configured':'Not configured',deliveries};}
 async save(actor,input){authorize(actor,'integrations.manage');let d;try{d=inputSchema.parse(input);}catch{throw fail('invalid_email_configuration');}if(!this.key)throw fail('integration_key_unavailable');const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(781902642)');const old=(await c.query("SELECT * FROM wahi_v2.integration_settings WHERE environment=$1 AND name='resend' FOR UPDATE",[this.environment])).rows[0];if((old?.version||0)!==d.expectedVersion)throw fail('revision_conflict');const secret=d.apiKey?seal(d.apiKey,this.key,this.context()):old?.sealed_secret;if(d.config.enabled&&!secret)throw fail('integration_secret_required');await c.query("INSERT INTO wahi_v2.integration_settings(environment,name,config,sealed_secret,version,updated_at) VALUES($1,'resend',$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT(environment,name) DO UPDATE SET config=EXCLUDED.config,sealed_secret=EXCLUDED.sealed_secret,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at",[this.environment,d.config,secret||null,d.expectedVersion+1]);await c.query("INSERT INTO wahi_v2.integration_audit(id,environment,name,actor_id,event,details,recorded_at) VALUES($1,$2,'resend',$3,'configuration_updated',$4,CURRENT_TIMESTAMP)",[crypto.randomUUID(),this.environment,actor.id,{config:d.config,secretChanged:!!d.apiKey}]);await c.query('COMMIT');return {saved:true};}catch(e){await c.query('ROLLBACK');if(['revision_conflict','integration_secret_required'].includes(e.code))throw e;throw fail('integration_save_failed');}finally{c.release();}}
 async record(c,{userId=null,purpose,to}){const id=crypto.randomUUID();await c.query('INSERT INTO wahi_v2.email_deliveries(id,user_id,purpose,recipient) VALUES($1,$2,$3,$4)',[id,userId,purpose,address.parse(to)]);return id;}
 async managementSender(){
  const row=(await this.pool.query("SELECT config,version,sealed_secret IS NOT NULL AS secret FROM wahi_v2.integration_settings WHERE environment=$1 AND name='resend'",[this.environment])).rows[0];
  if(!row?.config.enabled||!row.secret||!this.key)throw fail('not_configured');
  const config=configSchema.parse(row.config);return {from:`${config.senderName} <${config.senderEmail}>`,version:row.version};
 }
 // Shared provider transport. Management callers freeze from/to/content before
 // the first attempt; account messages keep their existing metadata-only ledger.
 async deliverMessage({idempotencyKey,to,message,from,integrationVersion}){
  let state='failed',reason='not_configured',providerId=null,retryable=true;
  try{
   const row=(await this.pool.query("SELECT config,sealed_secret,version FROM wahi_v2.integration_settings WHERE environment=$1 AND name='resend'",[this.environment])).rows[0];
   if(!row?.config.enabled||!row.sealed_secret||!this.key)throw fail('not_configured');
   if(integrationVersion!==undefined&&integrationVersion!==row.version){reason='integration_changed';retryable=false;throw fail(reason);}
   const config=configSchema.parse(row.config),key=unseal(row.sealed_secret,this.key,this.context());reason='delivery_uncertain';
   const response=await this.fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from:from||`${config.senderName} <${config.senderEmail}>`,to:[address.parse(to)],subject:message.subject,html:message.html,text:message.text})});
   if(!response.ok){reason='provider_rejected';retryable=response.status===429||response.status>=500||response.status===409;throw fail(reason);}
   const data=await response.json();if(!z.string().uuid().safeParse(data.id).success)throw fail('delivery_uncertain');providerId=data.id;state='accepted';reason=null;retryable=false;
  }catch{if(reason==='delivery_uncertain')state='unknown';}
  return {state,reason,providerId,retryable};
 }
 async sendTransactionalEmail({deliveryId,to,purpose,origin,token,username}){
  const result=await this.deliverMessage({idempotencyKey:deliveryId,to,message:template(purpose,{origin,token,username})});
  await this.pool.query('UPDATE wahi_v2.email_deliveries SET state=$2,failure_reason=$3,provider_message_id=$4,completed_at=CURRENT_TIMESTAMP WHERE id=$1',[deliveryId,result.state,result.reason,result.providerId]);return {state:result.state,deliveryId};
 }
 async test(actor,input){authorize(actor,'integrations.manage');const d=z.object({to:address}).strict().parse(input);if(!await allow(this.pool,'test:'+actor.id,3,60))throw fail('email_throttled');const deliveryId=await this.record(this.pool,{purpose:'test',to:d.to});return this.sendTransactionalEmail({deliveryId,purpose:'test',to:d.to});}
}
module.exports={ResendEmail,address,configSchema};
