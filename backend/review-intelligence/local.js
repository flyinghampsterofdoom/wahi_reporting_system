'use strict';
// A new private disposable database. Never touches review/.runtime or hosted configuration.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{Pool}=require('pg');
const {migrate}=require('../migrate'),{ReviewRepository}=require('./repository'),{ReviewIntelligence}=require('./service'),{adapterFor,fixtureReviews}=require('./fixtures'),{MockOpenAIProvider}=require('./provider'),{createUser}=require('../review/auth'),{DomainService}=require('../service'),{PostgresRepository}=require('../repository/postgres'),{createReviewServer}=require('../review/server');
const bin=process.env.WAHI_TEST_PG_BIN||'/opt/homebrew/opt/postgresql@16/bin';
async function start({port=4318}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wahi-review-intelligence-'));await fs.chmod(root,0o700);let pool,server,retentionTimer,retentionWork,started=false;
 const pg=(command,args)=>execFileSync(path.join(bin,command),args,{stdio:'pipe'});
 async function stop(){clearInterval(retentionTimer);await retentionWork;if(server){server.closeAllConnections();await new Promise(r=>server.close(r));server=null;}await pool?.end();if(started){pg('pg_ctl',['-D',root+'/data','-m','immediate','-w','stop']);started=false;}await fs.rm(root,{recursive:true,force:true});}
 try{
  pg('initdb',['-D',root+'/data','--auth=trust','--username=wahi_review_synthetic','--no-locale','-E','UTF8']);pg('pg_ctl',['-D',root+'/data','-l',root+'/postgres.log','-o',`-F -k ${root} -h '' -p 55452`,'-w','start']);started=true;
  pool=new Pool({host:root,port:55452,user:'wahi_review_synthetic',database:'postgres',max:5});await migrate(pool);
  const users=[];for(const role of ['ADMIN','MANAGER','STAFF'])users.push(await createUser(role.toLowerCase(),role,'Synthetic-Local-Review-Only-2026!'));
  const actor={id:users[0].id,role:'ADMIN'},reviews=new ReviewIntelligence(new ReviewRepository(pool,{environment:'local-review'}));await reviews.initialize(actor);await reviews.configureRetention(actor,{expectedVersion:1,rawDays:30,derivedDays:30,aggregateSurvival:false,purgeMissing:true,reason:'Authorized synthetic local engineering'});
  reviews.providers=new (require('./integrations').ReviewIntegrations)(reviews,{key:require('node:crypto').randomBytes(32).toString('base64'),callbackOrigin:'http://127.0.0.1:'+port});
  const resource=(await pool.query('SELECT resource FROM wahi_v2.review_locations WHERE id=$1',[reviews.locationId])).rows[0].resource,adapter=adapterFor(fixtureReviews(resource));await reviews.ingest(actor,await reviews.startScan(actor,adapter),adapter);await reviews.classify(actor,new MockOpenAIProvider());await reviews.publish(actor);await reviews.discover(actor);
  server=createReviewServer({service:new DomainService(new PostgresRepository(pool)),users,reviews,runtime:{hosted:false,environment:'local-review'}});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  retentionTimer=setInterval(()=>{if(!retentionWork)retentionWork=reviews.purge(actor).catch(()=>console.error('Synthetic retention reconciliation failed; read expiry remains enforced.')).finally(()=>{retentionWork=null;});},60000);retentionTimer.unref();
  await fs.writeFile(root+'/README.txt','Disposable synthetic Google review development database. No live integrations. Removed on normal shutdown.\n',{mode:0o600});
  return {root,url:'http://127.0.0.1:'+port,pool,reviews,server,stop};
 }catch(e){await stop();throw e;}
}
if(require.main===module)start().then(context=>{console.log(JSON.stringify({url:context.url,synthetic:true,users:['admin','manager','staff'],password:'Synthetic-Local-Review-Only-2026!',database:context.root}));let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await context.stop();process.exit(0);});}).catch(e=>{console.error('Synthetic local startup failed:',e.message);process.exitCode=1;});
module.exports={start};
