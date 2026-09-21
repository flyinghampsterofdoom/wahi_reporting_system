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
 if(!Array.isArray(users)||!users.length||!users.some(u=>u.role==='ADMIN')||users.some(u=>!u.id||!u.username||!CAPABILITIES[u.role]||! /^[a-f0-9]{32}$/.test(u.salt)||! /^[a-f0-9]{128}$/.test(u.hash)||Object.hasOwn(u,'password'))||new Set(users.map(u=>u.username)).size!==users.length||new Set(users.map(u=>u.id)).size!==users.length)throw new Error('Invalid hosted accounts');
 return {origin:origin.origin,environment:env.WAHI_ENVIRONMENT,connectionString:env.WAHI_DATABASE_URL,ssl:database.hostname.includes('.')?{rejectUnauthorized:true}:false,users,key:env.WAHI_INTEGRATION_KEY_BASE64};
}
const {SessionStore}=require('./sessions');
async function openHosted(env=process.env){const config=configuration(env),pool=new Pool({connectionString:config.connectionString,ssl:config.ssl,max:5,connectionTimeoutMillis:10000});try{await checkSchema(pool);const {UserAccounts,NamedSessionStore}=require('../accounts/service');const accounts=new UserAccounts(pool);await accounts.bootstrap(config.users);const sessionStore=new NamedSessionStore(pool);const email=new (require('../integrations/resend').ResendEmail)(pool,{environment:config.environment,key:config.key});const accountEmail=new (require('../accounts/email').AccountEmail)(accounts,email,config.origin);const integrations=new ToastSettings(pool,{environment:config.environment,key:config.key});const labor=new (require('../labor/service').LaborService)(pool,new (require('../labor/toast-client').ToastLaborClient)(integrations));const reports=new (require('../reports/service').ManagementReports)(pool,labor,email,config.origin);const cogs=new (require('../reporting/service').TrueCogs)(pool,new (require('../labor/toast-client').ToastLaborClient)(integrations));return {pool,accounts,email,accountEmail,labor,reports,cogs,users:config.users,service:new DomainService(new PostgresRepository(pool)),integrations,runtime:{hosted:true,origin:config.origin,environment:config.environment},sessionStore};}catch{await pool.end();throw new Error('Hosted schema or connection check failed');}}
module.exports={configuration,SessionStore,openHosted};
if(require.main===module){(async()=>{
 if(process.argv.includes('--migrate')){const c=configuration(),p=new Pool({connectionString:c.connectionString,ssl:c.ssl,max:1});try{console.log({applied:await migrate(p)});await checkSchema(p);}finally{await p.end();}return;}
 const context=await openHosted(),server=require('../review/server').createReviewServer(context);
 server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>{console.log('Wahi hosted server ready');context.reports.start();});
 const shutdown=()=>{context.reports.stop().then(()=>server.close(()=>context.pool.end().then(()=>process.exit(0))));};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
})().catch(()=>{console.error('Wahi startup failed. Check runtime configuration and schema.');process.exitCode=1;});}
