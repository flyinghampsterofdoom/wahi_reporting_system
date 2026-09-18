'use strict';
const {Pool}=require('pg');
const {CAPABILITIES}=require('../auth');
const {keyBytes,ToastSettings}=require('../integrations/toast');
const {checkSchema,migrate}=require('../migrate');
const {PostgresRepository}=require('../repository/postgres');
const {DomainService}=require('../service');
function configuration(env=process.env){
 const origin=new URL(env.WAHI_PUBLIC_ORIGIN||'');
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Invalid WAHI_PUBLIC_ORIGIN');
 if(!['production','staging'].includes(env.WAHI_ENVIRONMENT))throw new Error('Invalid WAHI_ENVIRONMENT');
 const database=new URL(env.WAHI_DATABASE_URL||'');
 if(!['postgres:','postgresql:'].includes(database.protocol)||decodeURIComponent(database.pathname.slice(1))!=='wahi_reporting_db'||!database.hostname.startsWith('dpg-d6qot2fkijhs73ba5itg-a'))throw new Error('Unexpected Wahi database target');
 if(!['dpg-d6qot2fkijhs73ba5itg-a','dpg-d6qot2fkijhs73ba5itg-a.oregon-postgres.render.com'].includes(database.hostname))throw new Error('Unexpected Wahi database host');
 keyBytes(env.WAHI_INTEGRATION_KEY_BASE64);
 let users;try{users=JSON.parse(env.WAHI_AUTH_USERS_JSON);}catch{throw new Error('Hosted authentication is not configured');}
 if(!Array.isArray(users)||!users.length||!users.some(u=>u.role==='ADMIN')||users.some(u=>!u.id||!u.username||!CAPABILITIES[u.role]||! /^[a-f0-9]{32}$/.test(u.salt)||! /^[a-f0-9]{128}$/.test(u.hash)||Object.hasOwn(u,'password'))||new Set(users.map(u=>u.username)).size!==users.length)throw new Error('Invalid hosted accounts');
 return {origin:origin.origin,environment:env.WAHI_ENVIRONMENT,connectionString:env.WAHI_DATABASE_URL,ssl:database.hostname.includes('.')?{rejectUnauthorized:true}:false,users,key:env.WAHI_INTEGRATION_KEY_BASE64};
}
class SessionStore {
 constructor(pool){this.pool=pool;}
 async get(hash){const r=(await this.pool.query('SELECT user_id,csrf,expires_at FROM wahi_v2.web_sessions WHERE token_hash=$1 AND expires_at>CURRENT_TIMESTAMP',[hash])).rows[0];return r?{userId:r.user_id,csrf:r.csrf,expires:new Date(r.expires_at).getTime()}:null;}
 async set(hash,session){await this.pool.query('DELETE FROM wahi_v2.web_sessions WHERE expires_at<CURRENT_TIMESTAMP');await this.pool.query('INSERT INTO wahi_v2.web_sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)',[hash,session.user.id,session.csrf,new Date(session.expires)]);}
 async delete(hash){await this.pool.query('DELETE FROM wahi_v2.web_sessions WHERE token_hash=$1',[hash]);}
 async allowLogin(key){const r=(await this.pool.query(`INSERT INTO wahi_v2.login_limits(key,attempts,expires_at) VALUES($1,1,CURRENT_TIMESTAMP+interval '1 minute') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN wahi_v2.login_limits.expires_at<CURRENT_TIMESTAMP THEN 1 ELSE wahi_v2.login_limits.attempts+1 END, expires_at=CASE WHEN wahi_v2.login_limits.expires_at<CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP+interval '1 minute' ELSE wahi_v2.login_limits.expires_at END RETURNING attempts`,[key])).rows[0];return r.attempts<=20;}
}
async function openHosted(env=process.env){const config=configuration(env),pool=new Pool({connectionString:config.connectionString,ssl:config.ssl,max:5,connectionTimeoutMillis:10000});try{await checkSchema(pool);return {pool,users:config.users,service:new DomainService(new PostgresRepository(pool)),integrations:new ToastSettings(pool,{environment:config.environment,key:config.key}),runtime:{hosted:true,origin:config.origin,environment:config.environment},sessionStore:new SessionStore(pool)};}catch{await pool.end();throw new Error('Hosted schema or connection check failed');}}
module.exports={configuration,SessionStore,openHosted};
if(require.main===module){(async()=>{
 if(process.argv.includes('--migrate')){const c=configuration(),p=new Pool({connectionString:c.connectionString,ssl:c.ssl,max:1});try{console.log({applied:await migrate(p)});await checkSchema(p);}finally{await p.end();}return;}
 const context=await openHosted(),server=require('../review/server').createReviewServer(context);
 server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('Wahi hosted server ready'));
 const shutdown=()=>server.close(()=>context.pool.end().then(()=>process.exit(0)));process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
})().catch(()=>{console.error('Wahi startup failed. Check runtime configuration and schema.');process.exitCode=1;});}
