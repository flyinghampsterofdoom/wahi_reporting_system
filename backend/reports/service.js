'use strict';
const crypto=require('node:crypto'),{z}=require('zod'),{authorize,CAPABILITIES}=require('../auth');
const {due,local}=require('./schedule'),{content}=require('./content');
const fail=code=>Object.assign(new Error(code),{code});
const idSchema=z.enum(['daily','weekly']);
const configuration=z.object({id:idSchema,expectedVersion:z.number().int().nonnegative(),enabled:z.boolean(),sendTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),weekday:z.number().int().min(0).max(6).nullable(),timezone:z.string().max(100).refine(s=>{try{local(Date.now(),s);return true;}catch{return false;}}),recipients:z.array(z.string().min(1).max(100)).max(100),sections:z.array(z.literal('labor')).length(1)}).strict().refine(d=>!d.enabled||(d.sendTime&&(d.id==='daily'||d.weekday!==null)&&d.recipients.length>0));
function eligibility(u){return !u||u.status!=='active'?'disabled':!u.email?'missing_email':!u.email_verified_at?'unverified_email':!CAPABILITIES[u.role]?.includes('labor.read')?'no_labor_access':null;}
class ManagementReports{
 constructor(pool,labor,email,origin,{clock=()=>Date.now(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){Object.assign(this,{pool,labor,email,origin,clock,pause});this.running=null;this.stopping=false;}
 async locked(fn,wait=true){const c=await this.pool.connect();let locked=false;try{locked=(await c.query('SELECT pg_try_advisory_lock(781902646) AS locked')).rows[0].locked;if(!locked){if(wait)throw fail('revision_conflict');return {busy:true};}return await fn(c);}finally{if(locked)await c.query('SELECT pg_advisory_unlock(781902646)');c.release();}}
 async admin(actor,c=this.pool){authorize(actor,'administration.access');const u=(await c.query('SELECT role,status FROM wahi_v2.users WHERE id=$1',[actor.id])).rows[0];if(u?.role!=='ADMIN'||u.status!=='active')throw fail('forbidden');}
 async audit(c,actor,id,event,details){await c.query('INSERT INTO wahi_v2.management_report_audit(id,report_id,actor_id,event,details) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),id,actor.id,event,details]);}
 async definitions(c=this.pool){return (await c.query(`SELECT r.*,COALESCE((SELECT jsonb_agg(user_id ORDER BY user_id) FROM wahi_v2.management_report_recipients WHERE report_id=r.id),'[]') AS recipients FROM wahi_v2.management_reports r ORDER BY id`)).rows;}
 async read(actor){await this.admin(actor);const [reports,users,history,audit]=await Promise.all([this.definitions(),this.pool.query('SELECT id,display_name AS name,email,email_verified_at,status,role FROM wahi_v2.users ORDER BY display_name'),this.pool.query(`SELECT o.id AS occurrence_id,o.report_id,o.occurrence_key,o.kind,o.scheduled_at,o.state AS generation_state,o.failure_reason AS generation_failure,d.user_id,d.recipient,d.state,d.attempts,d.accepted_at,d.provider_message_id,d.failure_reason FROM wahi_v2.management_occurrences o LEFT JOIN wahi_v2.management_deliveries d ON d.occurrence_id=o.id ORDER BY o.created_at DESC,d.user_id LIMIT 100`),this.pool.query('SELECT actor_id,report_id,event,recorded_at,details FROM wahi_v2.management_report_audit ORDER BY recorded_at DESC LIMIT 30')]);return {reports,users:users.rows.map(u=>({id:u.id,name:u.name,email:u.email,eligible:!eligibility(u),reason:eligibility(u)})),history:history.rows,audit:audit.rows};}
 async save(actor,input){const d=configuration.parse(input);if(new Set(d.recipients).size!==d.recipients.length)throw fail('invalid_request');return this.locked(async c=>{await c.query('BEGIN');try{await this.admin(actor,c);const old=(await c.query('SELECT * FROM wahi_v2.management_reports WHERE id=$1 FOR UPDATE',[d.id])).rows[0];if(old.version!==d.expectedVersion)throw fail('revision_conflict');const users=(await c.query('SELECT id FROM wahi_v2.users WHERE id=ANY($1::text[])',[d.recipients])).rows;if(users.length!==d.recipients.length)throw fail('invalid_request');await c.query('UPDATE wahi_v2.management_reports SET enabled=$2,send_time=$3,weekday=$4,timezone=$5,sections=$6,version=version+1,updated_at=$7 WHERE id=$1',[d.id,d.enabled,d.sendTime,d.weekday,d.timezone,JSON.stringify(d.sections),new Date(this.clock())]);await c.query('DELETE FROM wahi_v2.management_report_recipients WHERE report_id=$1',[d.id]);for(const user of d.recipients)await c.query('INSERT INTO wahi_v2.management_report_recipients VALUES($1,$2)',[d.id,user]);await this.audit(c,actor,d.id,'configuration_changed',{previous:{enabled:old.enabled,sendTime:old.send_time,weekday:old.weekday,timezone:old.timezone,sections:old.sections},configuration:d});await c.query('COMMIT');return {saved:true};}catch(e){await c.query('ROLLBACK');throw e;}});}
 async preview(actor,id){await this.admin(actor);idSchema.parse(id);const report=(await this.definitions()).find(r=>r.id===id);return content({labor:this.labor,actor,report,now:this.clock(),origin:this.origin});}
 async enqueue(c,report,key,at,actor=null){
  const inserted=(await c.query(`INSERT INTO wahi_v2.management_occurrences(id,report_id,occurrence_key,kind,scheduled_at,actor_id,config,next_attempt_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT(report_id,occurrence_key) DO NOTHING RETURNING id`,[crypto.randomUUID(),report.id,key,actor?'manual':'scheduled',new Date(at),actor?.id||null,report,new Date(this.clock())])).rows[0];
  if(inserted){for(const user of report.recipients)await c.query('INSERT INTO wahi_v2.management_deliveries(id,occurrence_id,user_id,next_attempt_at) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),inserted.id,user,new Date(this.clock())]);if(actor)await this.audit(c,actor,report.id,'manual_send_initiated',{occurrenceId:inserted.id,requestId:key});}
  return inserted?.id||(await c.query('SELECT id FROM wahi_v2.management_occurrences WHERE report_id=$1 AND occurrence_key=$2',[report.id,key])).rows[0].id;
 }
 async sendNow(actor,input){const d=z.object({id:idSchema,requestId:z.string().uuid()}).strict().parse(input);const result=await this.locked(async c=>{await c.query('BEGIN');try{await this.admin(actor,c);const report=(await this.definitions(c)).find(r=>r.id===d.id);if(!report.recipients.length)throw fail('invalid_request');const id=await this.enqueue(c,report,'manual:'+d.requestId,this.clock(),actor);await c.query('COMMIT');return {queued:true,occurrenceId:id};}catch(e){await c.query('ROLLBACK');throw e;}});this.kick();return result;}
 async generate(c,o){
  const now=this.clock();if(now-new Date(o.created_at)>23*3600000||o.attempts>=4){await c.query("UPDATE wahi_v2.management_occurrences SET state='failed',failure_reason='generation_expired' WHERE id=$1",[o.id]);return;}
  // Persist attempts before any fallible work; crashes count against the bound.
  await c.query("UPDATE wahi_v2.management_occurrences SET attempts=attempts+1,next_attempt_at=$2 WHERE id=$1",[o.id,new Date(now+[60000,300000,900000,900000][o.attempts])]);
  try{
   const payload=await content({labor:this.labor,actor:{id:'management-report-runner',role:'ADMIN'},report:o.config,now,origin:this.origin,manual:o.kind==='manual'});const sender=await this.email.managementSender();payload.from=sender.from;payload.integrationVersion=sender.version;
   await c.query("UPDATE wahi_v2.management_occurrences SET state='ready',payload=$2,failure_reason=NULL WHERE id=$1 AND payload IS NULL",[o.id,payload]);
  }catch{await c.query("UPDATE wahi_v2.management_occurrences SET failure_reason='generation_unavailable',state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END WHERE id=$1",[o.id]);}
 }
 async deliver(c,d){
  const now=this.clock(),age=d.first_attempt_at?now-new Date(d.first_attempt_at):0;
  if(age>=23*3600000||now-new Date(d.created_at)>=23*3600000||d.attempts>=4){await c.query("UPDATE wahi_v2.management_deliveries SET state=CASE WHEN first_attempt_at IS NULL THEN 'failed' ELSE 'unknown' END,failure_reason='retry_window_expired' WHERE id=$1",[d.id]);return;}
  // Durable attempt and stable provider key precede network I/O. On a crash,
  // another runner retries the frozen bytes with the same key, within 23 hours.
  await c.query('UPDATE wahi_v2.management_deliveries SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,$2),next_attempt_at=$3 WHERE id=$1',[d.id,new Date(now),new Date(now+[60000,300000,900000,900000][d.attempts])]);
  await c.query('BEGIN');try{
   const user=(await c.query('SELECT * FROM wahi_v2.users WHERE id=$1 FOR SHARE',[d.user_id])).rows[0];
   const report=(await c.query('SELECT * FROM wahi_v2.management_reports WHERE id=$1',[d.report_id])).rows[0];
   const configured=(await c.query('SELECT 1 FROM wahi_v2.management_report_recipients WHERE report_id=$1 AND user_id=$2',[d.report_id,d.user_id])).rowCount;
   const reason=eligibility(user)||(!configured?'recipient_removed':null)||(d.kind==='scheduled'&&!report.enabled?'report_disabled':null)||(d.recipient&&d.recipient!==user.email?'email_changed':null);
   if(reason){await c.query("UPDATE wahi_v2.management_deliveries SET state='skipped',failure_reason=$2 WHERE id=$1",[d.id,reason]);await c.query('COMMIT');return;}
   // Pin the address durably before provider I/O, while holding the user's
   // shared row lock so account disable/email changes cannot race this send.
   await this.pool.query('UPDATE wahi_v2.management_deliveries SET recipient=COALESCE(recipient,$2) WHERE id=$1',[d.id,user.email]);
   const result=await this.email.deliverMessage({idempotencyKey:'management/'+d.id,to:d.recipient||user.email,from:d.payload.from,message:d.payload,integrationVersion:d.payload.integrationVersion});
   const retry=result.state!=='accepted'&&result.retryable&&d.attempts+1<4;
   await c.query('UPDATE wahi_v2.management_deliveries SET state=$2,failure_reason=$3,provider_message_id=$4,accepted_at=$5 WHERE id=$1',[d.id,retry?'pending':result.state,result.reason,result.providerId,result.state==='accepted'?new Date(this.clock()):null]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}
 }
 async tick(){return this.locked(async c=>{
  const now=this.clock();for(const report of await this.definitions(c))for(const occurrence of due(report,now)){
   await c.query('BEGIN');try{await this.enqueue(c,report,occurrence.key,occurrence.at);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}
  }
  const pending=(await c.query("SELECT * FROM wahi_v2.management_occurrences WHERE state='pending' AND next_attempt_at<=$1 ORDER BY created_at LIMIT 10",[new Date(this.clock())])).rows;
  for(const o of pending){if(this.stopping)break;await this.generate(c,o);}
  await c.query("UPDATE wahi_v2.management_deliveries d SET state='failed',failure_reason='generation_failed' FROM wahi_v2.management_occurrences o WHERE d.occurrence_id=o.id AND d.state='pending' AND o.state='failed'");
  const deliveries=(await c.query("SELECT d.*,o.payload,o.report_id,o.kind,o.created_at FROM wahi_v2.management_deliveries d JOIN wahi_v2.management_occurrences o ON o.id=d.occurrence_id WHERE d.state='pending' AND o.state='ready' AND d.next_attempt_at<=$1 ORDER BY d.next_attempt_at LIMIT 20",[new Date(this.clock())])).rows;
  for(const d of deliveries){if(this.stopping)break;await this.deliver(c,d);await this.pause(600);}
  return {checked:true};
 },false);}
 kick(){if(!this.running&&!this.stopping){this.running=this.tick().catch(()=>console.error('Management scheduler check failed; durable work will retry.')).finally(()=>{this.running=null;});}return this.running;}
 start(){this.kick();this.timer=setInterval(()=>this.kick(),60000);this.timer.unref();}
 async stop(){this.stopping=true;clearInterval(this.timer);await this.running;}
}
module.exports={ManagementReports,eligibility,configuration};
