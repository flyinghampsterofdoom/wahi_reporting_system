'use strict';
// Owner-private local connection database. Never uses WAHI_DATABASE_URL or review/.runtime.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net'),{execFileSync}=require('node:child_process'),{Pool}=require('pg');
const {migrate,checkSchema}=require('../migrate'),{createUser}=require('../review/auth'),{UserAccounts,NamedSessionStore}=require('../accounts/service'),{DomainService}=require('../service'),{PostgresRepository}=require('../repository/postgres'),{ReviewRepository}=require('./repository'),{ReviewIntelligence}=require('./service'),{ReviewIntegrations}=require('./integrations'),{ProviderHTTP}=require('./http'),{createReviewServer}=require('../review/server');
const defaultRoot=path.join(__dirname,'../.google-local'),bin=process.env.WAHI_TEST_PG_BIN||'/opt/homebrew/opt/postgresql@16/bin',kind='wahi-local-google-connection-v1';
async function privateFile(filename){const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077)throw Error('Local connection file must be private: '+path.basename(filename));return fs.readFile(filename,'utf8');}
async function portAvailable(port){await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(Error('Local HTTP port is occupied; no process was replaced.')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});}
async function openPersistent({root=defaultRoot,port=4318,pgPort=55455,http,listen=true}={}){
 if(!path.isAbsolute(root)||root.length>85||!Number.isInteger(port)||port<1024||port>65535||!Number.isInteger(pgPort)||pgPort<1024||pgPort>65535)throw Error('Invalid private local runtime path or port');
 if(listen)await portAvailable(port);
 await fs.mkdir(root,{recursive:true,mode:0o700});const stat=await fs.lstat(root);if(stat.isSymbolicLink()||!stat.isDirectory()||stat.mode&0o077)throw Error('Local connection directory must be private');
 const pg=(command,args)=>execFileSync(path.join(bin,command),args,{stdio:'pipe'}),data=path.join(root,'postgres'),markerFile=path.join(root,'ready.json');let pool,server,started=false,marker;
 const running=()=>{try{pg('pg_ctl',['-D',data,'status']);return true;}catch{return false;}};
 async function close({stopDatabase=true}={}){if(server){server.closeAllConnections();await new Promise(r=>server.close(r));server=null;}await pool?.end();pool=null;if(stopDatabase&&running())pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
 try{
  try{marker=JSON.parse(await privateFile(markerFile));if(marker.kind!==kind||marker.pgPort!==pgPort)throw Error('Invalid local connection database marker');}catch(e){if(e.code!=='ENOENT')throw e;const entries=await fs.readdir(root);if(entries.length)throw Error('Unmarked connection directory is not empty; no existing files changed.');}
  if(!marker){pg('initdb',['-D',data,'--auth=trust','--username=wahi_google_connection','--no-locale','-E','UTF8']);}
  if(!running()){pg('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-k ${root} -h '' -p ${pgPort}`,'-w','start']);started=true;}
  pool=new Pool({host:root,port:pgPort,user:'wahi_google_connection',database:'postgres',max:8});await migrate(pool);await checkSchema(pool);
  const keyFile=path.join(root,'integration.key');let key;
  try{key=(await privateFile(keyFile)).trim();}catch(e){if(e.code!=='ENOENT')throw e;const count=(await pool.query('SELECT count(*)::int n FROM wahi_v2.review_provider_settings WHERE sealed_secret IS NOT NULL')).rows[0].n;if(count)throw Error('Restore the original connection encryption key; existing ciphertext was retained.');key=crypto.randomBytes(32).toString('base64');await fs.writeFile(keyFile,key,{mode:0o600,flag:'wx'});}
  let users;
  if(!marker){users=[];const access=[];for(const [username,role]of [['owner','ADMIN'],['manager','MANAGER'],['staff','STAFF']]){const password=crypto.randomBytes(24).toString('base64url');users.push(await createUser(username,role,password));access.push({username,role,password});}await fs.writeFile(path.join(root,'users.json'),JSON.stringify(users),{mode:0o600,flag:'wx'});await fs.writeFile(path.join(root,'ACCESS.md'),'# Private local connection access\n\nThese credentials access only the private local Google connection runtime. Never paste them into chat.\n\n'+access.map(a=>`${a.role}: username ${a.username}, password ${a.password}`).join('\n')+'\n',{mode:0o600,flag:'wx'});}
  else users=JSON.parse(await privateFile(path.join(root,'users.json')));
  const accounts=new UserAccounts(pool);await accounts.bootstrap(users);const actor={id:users.find(u=>u.role==='ADMIN').id,role:'ADMIN'},reviews=new ReviewIntelligence(new ReviewRepository(pool,{environment:'local-review'}),{locationId:marker?.locationId});if(!marker)await reviews.initialize(actor,{name:'Google connection — no location selected'});
  reviews.providers=new ReviewIntegrations(reviews,{key,callbackOrigin:'http://127.0.0.1:'+port,connectionOnly:true});
  // Real transport is restricted to OAuth and merchant metadata at the HTTP layer.
  const providerHTTP=http||new ProviderHTTP({allowNetwork:true,scope:'google-connection'});
  if(!marker){marker={kind,pgPort,locationId:reviews.locationId,createdAt:new Date().toISOString()};await fs.writeFile(markerFile,JSON.stringify(marker),{mode:0o600,flag:'wx'});}
  server=createReviewServer({service:new DomainService(new PostgresRepository(pool)),users,accounts,sessionStore:new NamedSessionStore(pool),reviews,reviewHTTP:providerHTTP,runtime:{hosted:false,environment:'local-review',connectionOnly:true}});
  if(listen)await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {root,port,pool,server,reviews,accounts,http:providerHTTP,close,url:'http://127.0.0.1:'+port+'/#admin/google'};
 }catch(e){await close({stopDatabase:started});throw e;}
}
if(require.main===module)openPersistent().then(context=>{console.log('Local Google connection administration: '+context.url);console.log('Private local sign-in instructions: '+path.join(context.root,'ACCESS.md'));console.log('OAuth and metadata only. Reviews, OpenAI and production are disabled.');let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await context.close();process.exit(0);});}).catch(()=>{console.error('Local connection runtime failed. Check private file permissions, database marker, encryption-key availability and port 4318. No credentials are logged.');process.exitCode=1;});
module.exports={openPersistent,defaultRoot,privateFile};
