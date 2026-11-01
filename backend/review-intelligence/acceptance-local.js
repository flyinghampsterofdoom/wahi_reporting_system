'use strict';
// Private, persistent synthetic acceptance runtime. Google network access is impossible.
const fs=require('node:fs/promises'),path=require('node:path');
const {openPersistent,privateFile}=require('./persistent'),{ProviderHTTP}=require('./http'),{adapterFor,fixtureReviews}=require('./fixtures'),{MockOpenAIProvider}=require('./provider'),{DomainService}=require('../service'),{PostgresRepository}=require('../repository/postgres'),{NamedSessionStore}=require('../accounts/service'),{createReviewServer}=require('../review/server');
const defaultRoot='/tmp/wahi-review-finalize';
async function start({root=defaultRoot,port=4320,listen=true}={}){
 const http=new ProviderHTTP({allowNetwork:true,scope:'openai-only',timeoutMs:120000}),context=await openPersistent({root,port,pgPort:55465,listen:false,http});
 const {reviews,pool,accounts}=context;reviews.providers.connectionOnly=false;reviews.providers.syntheticOpenAI=true;
 const users=JSON.parse(await privateFile(path.join(root,'users.json'))),actor={id:users.find(u=>u.role==='ADMIN').id,role:'ADMIN'};
 const location=(await pool.query('SELECT * FROM wahi_v2.review_locations WHERE id=$1',[reviews.locationId])).rows[0];if(!location.synthetic)throw Error('Synthetic-only acceptance boundary violated');
 let rows=fixtureReviews(location.resource,70);const rowsFile=path.join(root,'fixture-reviews.json');try{rows=JSON.parse(await privateFile(rowsFile));}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(rowsFile,JSON.stringify(rows),{mode:0o600});}
 const adapter=adapterFor(rows);
 if(!(await pool.query('SELECT 1 FROM wahi_v2.review_records WHERE location_id=$1 LIMIT 1',[reviews.locationId])).rowCount){await reviews.configureRetention(actor,{expectedVersion:(await reviews.policy()).version,rawDays:30,derivedDays:30,aggregateSurvival:false,purgeMissing:true,reason:'Owner-authorized synthetic workflow acceptance'});await reviews.ingest(actor,await reviews.startScan(actor,adapter),adapter);await reviews.classify(actor,new MockOpenAIProvider());await reviews.publish(actor);}
 const server=createReviewServer({service:new DomainService(new PostgresRepository(pool)),users,accounts,sessionStore:new NamedSessionStore(pool),reviews,reviewHTTP:http,reviewAdminHTTP:http,runtime:{hosted:false,environment:'local-review',syntheticOpenAI:true}});
 let worker;if(listen){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});if(process.env.WAHI_REVIEW_ACCEPTANCE_WORKER!=='false')worker=require('./worker').startReviewWorker(reviews,{http,adapter,allowSync:true,allowAnalysis:true});}
 return {...context,server,reviews,http,actor,adapter,async close({stopDatabase=listen}={}){await worker?.stop();if(listen){server.closeAllConnections();await new Promise(r=>server.close(r));}await context.close({stopDatabase});},url:'http://127.0.0.1:'+port};
}
if(require.main===module)start().then(context=>{console.log('Persistent synthetic review acceptance: '+context.url);console.log('Local sign-in instructions: '+path.join(defaultRoot,'ACCESS.md'));console.log('OpenAI requests are enabled for owner-configured synthetic acceptance only. Google network and production are disabled.');let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await context.close();process.exit(0);});}).catch(()=>{console.error('Private synthetic acceptance startup failed. No credentials are logged.');process.exitCode=1;});
module.exports={start,defaultRoot};
