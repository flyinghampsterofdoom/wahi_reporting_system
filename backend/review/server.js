'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {z}=require('zod');
const {CAPABILITIES,authorize,can,ingredientView,recipeView}=require('../auth');
const {latest}=require('../domain/history');
const {verify}=require('./auth');
function error(code,message){return Object.assign(new Error(message),{code});}
async function body(req,limit=128000){let s='';for await(const c of req){s+=c;if(Buffer.byteLength(s)>limit)throw error('invalid_request','Request too large');}try{return JSON.parse(s);}catch{throw error('invalid_request','Invalid JSON');}}
function potentialHealth(req,runtime){return runtime.hosted&&req.method==='GET'&&req.url==='/healthz';}
function createReviewServer({service,users,integrations,runtime={hosted:false,environment:'local-review'},sessionStore,accounts,labor,email,accountEmail,reports,cogs,recipeMedia,reviews,reviewHTTP,reviewAdminHTTP}){
  if(runtime.hosted&&recipeMedia?.fixtureOnly)throw new Error('Local recipe fixtures cannot serve hosted media');
  const providerHTTP=reviewHTTP||new (require('../review-intelligence/http').ProviderHTTP)();
  const waste=new (require('../waste/service').WasteService)(service.repository,{context:runtime});
  const recipes=service.repository.pool?new (require('../recipe-book/service').RecipeBook)(service.repository.pool):null;
  const sessions=new Map(),attempts=new Map();
  const assetNames=['app-version.js','app.js','style.css','management-ui.js','table-model.js','currency.js','quantity.js','shell-model.js','shell.js','users-ui.js','labor-ui.js','labor-allotments.js','email-ui.js','leadership-summary.js','deep-links.js','reports-ui.js','cogs-ui.js','cogs-model.js','mapping-ui.js','composite-ui.js','variant-ui.js','waste-ui.js','recipe-renderer.js','recipe-offline.js','recipe-foundation.js','recipe-builder.js','recipe-worker.js','reviews-ui.js','reviews.css','google-ui.js','openai-ui.js','review-explorer-ui.js','review-workflow-ui.js','review-oauth.js'];
  const assets=Promise.all(assetNames.map(async name=>{const content=await fs.readFile(path.join(__dirname,'public',name));return {name,content,url:'/'+name.replace(/(\.[^.]+)$/,'.'+crypto.createHash('sha256').update(content).digest('hex').slice(0,16)+'$1')};}));
  const applicationVersion=assets.then(entries=>crypto.createHash('sha256').update(entries.map(a=>a.url).join('|')+'|'+(runtime.releaseId||(runtime.hosted?process.env.RENDER_GIT_COMMIT:'')||'')).digest('hex'));
  const mappingUiVersion=assets.then(entries=>crypto.createHash('sha256').update(entries.filter(a=>['mapping-ui.js','composite-ui.js','variant-ui.js','cogs-ui.js','quantity.js','app.js'].includes(a.name)).map(a=>a.url).join('|')).digest('hex').slice(0,16));
  const tokenHash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const server=http.createServer(async(req,res)=>{
    const origin=runtime.hosted?runtime.origin:'http://127.0.0.1:'+server.address().port;
    const expectedHost=new URL(origin).host,cookieName=runtime.hosted?'__Host-wahi_session':runtime.syntheticOpenAI?'wahi_review_acceptance_'+server.address().port+'_session':runtime.connectionOnly?'wahi_google_local_'+server.address().port+'_session':'wahi_review_session',cookieFlags=runtime.hosted?'; Secure':'';
    const started=performance.now();
    const send=(status,data)=>{res.setHeader('Server-Timing','app;dur='+(performance.now()-started).toFixed(2));res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(!runtime.hosted)res.setHeader('X-Wahi-Review','local-review');else res.setHeader('Strict-Transport-Security','max-age=31536000');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      if(potentialHealth(req,runtime)){try{await service.repository.pool.query('SELECT 1');send(200,{status:'ok'});}catch{send(503,{status:'unavailable'});}return;}
      if(req.headers.host!==expectedHost)throw error('forbidden','Use the local review URL');
      const u=new URL(req.url,'http://'+expectedHost),p=u.pathname;
      if(req.method==='POST'){
        if(req.headers.origin!==origin)throw error('forbidden','Same-origin request required');
        if(!String(req.headers['content-type']).startsWith('application/json'))throw error('invalid_request','JSON required');
      }
      if(req.method==='GET'){
        const entries=await assets,asset=entries.find(a=>p===a.url||p==='/'+a.name);
        if(asset){res.setHeader('Content-Type',asset.name.endsWith('.js')?'text/javascript':'text/css');if(runtime.hosted&&p===asset.url)res.setHeader('Cache-Control','public, max-age=31536000, immutable');return res.end(asset.content);}
        if(p==='/app-version'){send(200,{version:await applicationVersion});return;}
        if(p==='/'){res.setHeader('Content-Type','text/html');let content=await fs.readFile(path.join(__dirname,'public','index.html'),'utf8');if(runtime.hosted||!['local-review','development','test','testing'].includes(runtime.environment))content=content.replace(/<div class="review-banner">.*?<\/div>/,'<div class="review-banner" hidden></div>');content=content.replace('</head>',`<meta name="wahi-mapping-ui" content="${await mappingUiVersion}"><meta name="wahi-app-version" content="${await applicationVersion}"></head>`);if(runtime.hosted){content=content.replace('Wahi — Owner Review','Wahi').replace(/<div class="review-banner">.*?<\/div>/,'<div class="review-banner" hidden></div>').replace('<span>Owner review</span>','<span>Management</span>').replace('Try the current workflows.','Log in to Wahi.').replace('Use your local review credentials. Production logins are separate.','Use your Wahi account.');for(const a of entries)content=content.replaceAll('/'+a.name,a.url);}return res.end(content);}
      }
      // Cross-site OAuth returns have no SameSite=Strict session cookie. The static
      // landing page posts the code from this origin with the existing CSRF token.
      if(req.method==='GET'&&p==='/api/reporting/reviews/oauth/callback'&&reviews?.providers){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Wahi Google authorization</title><p id="oauth-status">Validating authorization…</p><script src="/review-oauth.js" defer></script>');return;}
      if(p.startsWith('/api/account/')&&req.method==='POST'&&['forgot','validate-link','verify-email','email-setup','reset-password'].includes(p.slice('/api/account/'.length))){
        if(!accountEmail)throw error('not_found','Not available');
        const action=p.slice('/api/account/'.length),network=req.socket.remoteAddress;
        if(action==='forgot'){
          let data;try{data=await body(req);}catch{data={};}
          let result;try{result=await accountEmail.forgot(data,network);}catch{result=require('../accounts/email').neutral;}
          await new Promise(r=>setTimeout(r,Math.max(0,500-(performance.now()-started))));send(200,result);return;
        }
        if(!await require('../email/rate-limit').allow(accountEmail.pool,'email-token:'+network,100,60)){send(429,{error:'Try again later.'});return;}
        const data=await body(req);
        send(200,action==='validate-link'?await accountEmail.validate(data):action==='verify-email'?await accountEmail.verifyEmail(data):await accountEmail.consume(action==='email-setup'?'setup':'reset',data));return;
      }
      if(p==='/api/account/setup'&&req.method==='POST'){
        if(!accounts)throw error('not_found','Not available');
        if(!await sessionStore.allowLogin(tokenHash('setup:'+req.socket.remoteAddress))){send(429,{error:'Try again later.'});return;}
        send(200,await accounts.establish(await body(req)));return;
      }
      if(p==='/api/login'&&req.method==='POST'){
        const data=z.object({username:z.string().max(100),password:z.string().min(1).max(200)}).strict().parse(await body(req));
        const user=accounts?await accounts.findLogin(data.username):users.find(x=>x.username===data.username);
        const key=req.socket.remoteAddress,now=Date.now();let rate=attempts.get(key);
        if(!rate||rate.until<now){rate={n:0,until:now+60000};attempts.set(key,rate);}
        if(sessionStore?!await sessionStore.allowLogin(tokenHash('login:'+(user?user.username:'unknown'))):++rate.n>20){send(429,{error:'Too many login attempts. Try again in a minute.'});return;}
        if(!await verify(user,data.password)){send(401,{error:'Invalid username or password'});return;}
        for(const [key,value]of sessions)if(value.expires<now)sessions.delete(key);
        const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
        const value={user,csrf,expires:now+8*60*60*1000};if(sessionStore)await sessionStore.set(tokenHash(token),value);else sessions.set(tokenHash(token),value);
        res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${cookieFlags}`);send(200,{ok:true});return;
      }
      const cookie=String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.split('=')[1];
      const session=cookie?(sessionStore?await sessionStore.get(tokenHash(cookie)):sessions.get(tokenHash(cookie))):null;
      if(sessionStore&&session&&!session.user)session.user=users.find(u=>u.id===session.userId);
      if(!session?.user||session.expires<Date.now())throw error('unauthenticated','Please log in');
      const actor={id:session.user.id,role:session.user.role};
      if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)throw error('forbidden','Refresh your session before saving');
      if(actor.role==='RECIPE_ONLY'&&!((req.method==='GET'&&(['/api/me','/api/recipe-book/published','/api/recipe-book/contract'].includes(p)||/^\/api\/recipe-book\/media\/[0-9a-f-]{36}$/.test(p)))||(req.method==='POST'&&p==='/api/logout')))throw error('forbidden','Recipe-only account');
      if(p==='/api/me'&&req.method==='GET'){send(200,{id:actor.id,username:session.user.username,role:actor.role,capabilities:CAPABILITIES[actor.role].filter(c=>!runtime.recipeReadOnly||!['recipes.edit','recipes.publish','recipes.archive'].includes(c)),csrf:session.csrf,environment:runtime.environment,hosted:runtime.hosted,...(reviews?.providers&&actor.role==='ADMIN'?{googleConnection:true}:{}),...(runtime.connectionOnly?{connectionOnly:true}:{}),...(reviews&&['ADMIN','MANAGER'].includes(actor.role)?{reviewIntelligence:true}:{}),demo:service.repository.hasImportedData?!await service.repository.hasImportedData():!(await service.repository.read()).importRecords.length});return;}
      if(p==='/api/account/security'&&req.method==='GET'){if(!accountEmail)throw error('not_found');send(200,await accountEmail.me(actor));return;}
      if(p==='/api/account/resend-verification'&&req.method==='POST'){if(!accountEmail)throw error('not_found');send(200,await accountEmail.send(actor,'verification',await body(req),true));return;}
      if(p==='/api/account/change-password'&&req.method==='POST'){if(!accountEmail)throw error('not_found');send(200,await accountEmail.changePassword(actor,await body(req)));return;}
      if(p==='/api/logout'&&req.method==='POST'){if(sessionStore)await sessionStore.delete(tokenHash(cookie));else sessions.delete(tokenHash(cookie));res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cookieFlags}`);send(200,{ok:true});return;}
      if((p.startsWith('/api/recipe-book/media/')||p==='/api/recipe-book/draft-media')&&req.method==='GET'){
        authorize(actor,'recipes.view');if(!recipes)throw error('not_found');
        const meta=p.endsWith('/draft-media')?await recipes.draftMedia(actor,{id:u.searchParams.get('id'),entryId:u.searchParams.get('entryId')}):await recipes.media(actor,{id:p.slice('/api/recipe-book/media/'.length),versionId:u.searchParams.get('versionId')});
        if(!recipeMedia)throw error('not_found','Media storage unavailable');
        let media;try{media=await recipeMedia.display(meta);}catch{throw error('not_found','Media unavailable');}
        if(!['image/jpeg','image/png','image/webp'].includes(media.mimeType)||!Buffer.isBuffer(media.bytes)||media.bytes.length>8*1024*1024)throw error('not_found');
        res.writeHead(200,{'Content-Type':media.mimeType,'Content-Length':media.bytes.length,'Cache-Control':'no-store'});res.end(media.bytes);return;
      }
      if(p.startsWith('/api/recipe-book/')){
        const action=p.slice('/api/recipe-book/'.length);
        if(action==='contract'&&req.method==='GET'){
          authorize(actor,'recipes.view');const {offline,offlineLease}=require('../recipe-book/contracts');
          send(200,{schemaVersion:1,offline,lease:offlineLease({accountId:actor.id,environment:runtime.environment||'local-review',authorizationGeneration:tokenHash(session.authorizationGeneration||cookie),sessionExpiresAt:session.expires})});return;
        }
        authorize(actor,req.method==='GET'&&action==='published'?'recipes.view':'recipes.edit');
        if(runtime.recipeReadOnly&&req.method==='POST')throw error('recipe_read_only','Recipe management is temporarily read-only');
        if(!recipes)throw error('not_found','Recipe persistence unavailable');
        if(req.method==='GET'){
          const id=u.searchParams.get('id');
          if(action==='published')send(200,await recipes.published(actor,{id,menuStatus:u.searchParams.get('menuStatus')||'all'}));
          else if(action==='entries')send(200,await recipes.entries(actor,u.searchParams.get('q')||''));
          else if(action==='draft')send(200,await recipes.draft(actor,id));
          else if(action==='history')send(200,await recipes.history(actor,id));
          else if(action==='common')send(200,await recipes.common(actor,u.searchParams.get('q')||''));
          else if(action==='ingredients')send(200,await recipes.ingredients(actor,u.searchParams.get('q')||''));
          else if(action==='sources')send(200,await recipes.sources(actor,u.searchParams.get('q')||''));
          else if(action==='source')send(200,await recipes.source(actor,{recipeId:id,revisionId:u.searchParams.get('revisionId')}));
          else throw error('not_found','Unknown recipe operation');return;
        }
        if(req.method==='POST'&&action==='upload'){send(200,await recipes.upload(actor,await body(req,12*1024*1024),recipeMedia));return;}
        if(req.method==='POST'&&['addCommon','duplicate','create','save','publish','classify','archive','recover'].includes(action)){send(200,await recipes[action](actor,await body(req)));return;}
        throw error('not_found','Unknown recipe operation');
      }
      if(p==='/api/waste/catalog'&&req.method==='GET'){send(200,await waste.catalog(actor));return;}
      if(p==='/api/waste/events'&&req.method==='POST'){send(200,await waste.log(actor,await body(req),{sessionId:tokenHash('waste:'+cookie)}));return;}
      if(p==='/api/waste/history'&&req.method==='GET'){send(200,await waste.history(actor,Object.fromEntries(u.searchParams)));return;}
      // The generic operational account has an explicit server-side allowlist.
      // No preview flag or client-provided role is consulted for authorization.
      if(actor.role==='BOH')throw error('forbidden','Operational account only');
      if(p==='/api/catalog'&&req.method==='GET'){
        authorize(actor);const s=await service.repository.read(),now=new Date().toISOString();
        send(200,{ingredients:s.ingredients.map(i=>({...ingredientView(i),itemKind:(()=>{const b=latest(s.bases.filter(b=>b.ingredientId===i.id),now,now);return b?.kind==='source'?'Source-yield Item':b?.kind==='labor_only'?'Labor Item':b?.kind==='recipe'||s.recipes.some(r=>r.outputIngredientId===i.id)?'Prepared Item':'Purchased Item';})()})),recipes:s.recipes.map(r=>recipeView(r,latest(s.recipeRevisions.filter(v=>v.recipeId===r.id),now,now))),menuItems:s.menuItems.map(m=>service.menuFromState(actor,s,m.id,{at:now,knownAt:now})),inventoryItems:s.inventoryItems.map(i=>({ingredientId:i.ingredientId,baseUnit:i.baseUnit})),drafts:s.countSessions.filter(c=>c.actorId===actor.id&&c.status==='draft').map(c=>({id:c.id,locationName:c.snapshot.location.name,observedAt:c.observedAt})),...(can(actor,'inventory.configure')?{assignments:s.inventoryAssignments.map(a=>({id:a.id,ingredientId:a.ingredientId,locationId:a.locationId,countUnit:a.countUnit,sortOrder:a.sortOrder,active:a.active,version:a.version}))}:{})});return;
      }
      if(p.startsWith('/api/reporting/reviews')){
        authorize(actor);if(!['ADMIN','MANAGER'].includes(actor.role))throw error('forbidden');
        if(!reviews)throw error('not_found');
        if(req.method==='POST'&&actor.role!=='ADMIN')throw error('forbidden');
        if(p.startsWith('/api/reporting/reviews/connection')){if(actor.role!=='ADMIN')throw error('forbidden');if(!reviews.providers)throw error('not_found');const action=p.slice('/api/reporting/reviews/connection'.length);if(req.method==='GET'&&action===''){send(200,await reviews.providers.connectionStatus(actor));return;}if(req.method!=='POST')throw error('not_found');const input=await body(req);let result;if(action==='/configure'){if(!runtime.connectionOnly&&providerHTTP.mode!=='mock-http')throw error('review_persistent_runtime_required');result=await reviews.providers.configureConnection(actor,input);}else if(action==='/authorize')result=await reviews.providers.authorizeConnection(actor,input);else if(action==='/refresh')result=await reviews.providers.refreshConnection(actor,providerHTTP);else if(action==='/accounts')result=await reviews.providers.discover(actor,'accounts',input,providerHTTP);else if(action==='/locations')result=await reviews.providers.discover(actor,'locations',input,providerHTTP);else if(action==='/select-location')result=await reviews.providers.selectLocation(actor,input,providerHTTP);else if(action==='/disconnect')result=await reviews.providers.disconnect(actor,'google');else throw error('not_found');send(200,result);return;}
        if(p.startsWith('/api/reporting/reviews/openai-admin')){if(actor.role!=='ADMIN'||!reviews.providers)throw error('forbidden');const action=p.slice('/api/reporting/reviews/openai-admin'.length);if(req.method==='GET'&&action===''){send(200,await reviews.providers.openaiStatus(actor));return;}if(req.method!=='POST')throw error('not_found');const input=await body(req);let result;if(action==='/key')result=await reviews.providers.saveOpenaiKey(actor,input);else if(action==='/configure')result=await reviews.providers.configure(actor,'openai',input);else if(action==='/disconnect')result=await reviews.providers.disconnect(actor,'openai');else if(action==='/enable')result=await reviews.providers.enableOpenai(actor,input,reviewAdminHTTP||providerHTTP);else if(action==='/pause')result=await reviews.providers.pauseOpenai(actor,input);else if(action==='/verify-model')result=await reviews.providers.verifyOpenaiModel(actor,input,reviewAdminHTTP||new (require('../review-intelligence/http').ProviderHTTP)());else if(action==='/test')result=await reviews.providers.testOpenai(actor,input,reviewAdminHTTP||new (require('../review-intelligence/http').ProviderHTTP)());else throw error('not_found');send(200,result);return;}
        if(p==='/api/reporting/reviews/automation'){if(req.method==='GET')send(200,await reviews.automationStatus(actor));else if(req.method==='POST'){const input=await body(req);if(runtime.connectionOnly&&(input.syncEnabled||input.analysisEnabled))throw error('review_content_processing_disabled');send(200,await reviews.configureAutomation(actor,input));}else throw error('not_found');return;}
        if(runtime.connectionOnly&&req.method==='POST'&&!['/api/reporting/reviews/oauth/start','/api/reporting/reviews/oauth/callback'].includes(p))throw Object.assign(error('review_content_processing_disabled'),{});

        if(p==='/api/reporting/reviews/workflow'&&req.method==='GET'){send(200,await reviews.workflowStatus(actor));return;}
        if(p==='/api/reporting/reviews/historical-preview'&&req.method==='GET'){const config=await reviews.selectedAnalysisConfig(actor,providerHTTP);send(200,await reviews.reprocessPreview(actor,{configId:config.id,force:u.searchParams.get('force')||'false'}));return;}
        if(p==='/api/reporting/reviews/work-control'&&req.method==='POST'){send(200,await reviews.pauseWork(actor,await body(req),providerHTTP));return;}
        if(p==='/api/reporting/reviews/work'){if(req.method==='GET')send(200,await reviews.workHistory(actor));else if(req.method==='POST')send(202,await reviews.queueWork(actor,await body(req),providerHTTP));else throw error('not_found');return;}
        if(req.method==='GET'&&p==='/api/reporting/reviews/providers'){if(!reviews.providers)throw error('not_found');send(200,await reviews.providers.read(actor));return;}
        if(req.method==='GET'&&p==='/api/reporting/reviews/reprocess-preview'){send(200,await reviews.reprocessPreview(actor,Object.fromEntries(u.searchParams)));return;}
        if(req.method==='GET'&&p==='/api/reporting/reviews/overview'){send(200,await reviews.overview(actor,Object.fromEntries(u.searchParams)));return;}
        if(req.method==='GET'&&p==='/api/reporting/reviews/explorer'){send(200,await reviews.explore(actor,Object.fromEntries(u.searchParams)));return;}
        if(req.method==='GET'&&p==='/api/reporting/reviews/detail'){send(200,await reviews.reviewDetail(actor,u.searchParams.get('id')));return;}
        if(req.method==='GET'&&p==='/api/reporting/reviews/status'){send(200,await reviews.status(actor));return;}
        if(req.method==='GET'&&p==='/api/reporting/reviews/proposals'){send(200,await reviews.proposals(actor));return;}
        if(req.method==='GET'&&p==='/api/reporting/reviews'){send(200,await reviews.report(actor,Object.fromEntries(u.searchParams)));return;}
        if(req.method==='POST'){
          if(actor.role!=='ADMIN')throw error('forbidden');const input=await body(req);let result;
          const providerRoute=p.match(/^\/api\/reporting\/reviews\/providers\/(google|openai)\/(configure|rights|activate|disconnect)$/);
          if(providerRoute){if(!reviews.providers)throw error('not_found');const [,provider,action]=providerRoute;result=action==='configure'?await reviews.providers.configure(actor,provider,input):action==='rights'?await reviews.providers.approveRights(actor,provider,input):action==='activate'?await reviews.providers.activate(actor,provider,input,providerHTTP):await reviews.providers.disconnect(actor,provider);}
          else if(p==='/api/reporting/reviews/oauth/start'){if(!reviews.providers)throw error('not_found');result=await reviews.providers.beginOAuth(actor,tokenHash(cookie),providerHTTP);}
          else if(p==='/api/reporting/reviews/oauth/callback'){if(!reviews.providers)throw error('not_found');try{result=await reviews.providers.callback(actor,tokenHash(cookie),input,providerHTTP);}catch(e){await reviews.providers.connectionError(actor,e.code);throw e;}}
          else if(p==='/api/reporting/reviews/google/accounts'||p==='/api/reporting/reviews/google/locations'){const adapter=await require('../review-intelligence/google-provider').GoogleReviewsAdapter.forDiscovery(reviews.providers,providerHTTP);result=p.endsWith('/accounts')?await adapter.accounts(input.cursor):await adapter.locations(input.accountId,input.cursor);}
          else if(p==='/api/reporting/reviews/google/prepare')result=await reviews.prepareGoogleLocation(actor,input);
          else if(p==='/api/reporting/reviews/source-rights')result=await reviews.recordSourceRights(actor,input);
          else if(p==='/api/reporting/reviews/google/sync'){const adapter=await require('../review-intelligence/google-provider').GoogleReviewsAdapter.create(reviews.providers,providerHTTP);const run=input.runId||await reviews.startScan(actor,adapter);if(input.maxPages!==undefined&&(!Number.isInteger(input.maxPages)||input.maxPages<1||input.maxPages>1000))throw error('invalid_request');result=await reviews.ingest(actor,run,adapter,{maxPages:input.maxPages||1000});}
          else if(p==='/api/reporting/reviews/openai/select-config')result=await new (require('../review-intelligence/openai-provider').OpenAIResponsesProvider)(reviews.providers,providerHTTP).selectConfig(actor);
          else if(p==='/api/reporting/reviews/classify'){const config=await reviews.config();result=await reviews.classify(actor,config.configuration.provider==='openai'?new (require('../review-intelligence/openai-provider').OpenAIResponsesProvider)(reviews.providers,providerHTTP):new (require('../review-intelligence/provider').MockOpenAIProvider)(),{configId:config.id,limit:input.limit??(config.configuration.provider==='openai'?10:1000)});}
          else if(p==='/api/reporting/reviews/discover')result=await reviews.discover(actor);
          else if(p==='/api/reporting/reviews/decide')result=await reviews.decideProposal(actor,input);
          else if(p==='/api/reporting/reviews/retry')result=await reviews.retryClassification(actor,input);
          else if(p==='/api/reporting/reviews/reprocess')result=await reviews.authorizeReprocess(actor,input);
          else if(p==='/api/reporting/reviews/publish')result=await reviews.publish(actor,input);
          else if(p==='/api/reporting/reviews/retention')result=await reviews.configureRetention(actor,input);
          else if(p==='/api/reporting/reviews/purge')result=await reviews.purge(actor);
          else throw error('not_found');send(200,result);return;
        }
        throw error('not_found');
      }
      if(p.startsWith('/api/reporting/cogs')){
        authorize(actor,'reporting.read');if(!cogs)throw error('not_found');
        const query=Object.fromEntries(u.searchParams);
        res.setHeader('X-Wahi-Mapping-UI',await mappingUiVersion);
        if(req.method==='POST'&&['mapping','mapping-bulk','mapping-settings','composite','composite-preview','variant','variant-preview'].includes(p.split('/').at(-1))&&req.headers['x-wahi-mapping-ui']&&req.headers['x-wahi-mapping-ui']!==await mappingUiVersion)throw error('mapping_client_outdated');
        if(p==='/api/reporting/cogs'&&req.method==='GET'){send(200,await cogs.report(actor,query));return;}
        if(p==='/api/reporting/cogs/composite-catalog'&&req.method==='GET'){send(200,await cogs.composites.catalog(actor,query));return;}
        if(p==='/api/reporting/cogs/composite'&&req.method==='POST'){send(200,await cogs.composites.save(actor,await body(req)));return;}
        if(p==='/api/reporting/cogs/composite-preview'&&req.method==='POST'){send(200,await cogs.composites.preview(actor,await body(req)));return;}
        if(p==='/api/reporting/cogs/variant-catalog'&&req.method==='GET'){send(200,await cogs.variants.catalog(actor,query));return;}
        if(p==='/api/reporting/cogs/variant'&&req.method==='POST'){send(200,await cogs.variants.save(actor,await body(req)));return;}
        if(p==='/api/reporting/cogs/variant-preview'&&req.method==='POST'){send(200,await cogs.variants.preview(actor,await body(req)));return;}
        if(p==='/api/reporting/cogs/detail'&&req.method==='GET'){send(200,await cogs.detail(actor,query));return;}
        if(p==='/api/reporting/cogs/mapping-settings'&&req.method==='GET'){send(200,await cogs.review.settings(actor));return;}
        if(p==='/api/reporting/cogs/mapping-settings'&&req.method==='POST'){send(200,await cogs.review.saveSettings(actor,await body(req)));return;}
        if(p==='/api/reporting/cogs/mapping-badge'&&req.method==='GET'){send(200,await cogs.mappingBadge(actor));return;}
        if(p==='/api/reporting/cogs/mapping-history'&&req.method==='GET'){send(200,await cogs.mappingHistory(actor,query));return;}
        if(p==='/api/reporting/cogs/mapping-bulk'&&req.method==='POST'){send(200,await cogs.mappingBulk(actor,await body(req)));return;}
        if(p==='/api/reporting/cogs/mappings'&&req.method==='GET'){send(200,await cogs.mappings(actor,query));return;}
        if(p==='/api/reporting/cogs/csv'&&req.method==='GET'){const report=await cogs.report(actor,query);if(!report.reconciled)throw error('cogs_reconciliation_failed');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="wahi-true-cogs.csv"');res.end(require('../reporting/csv').csv(report));return;}
        if(req.method==='POST'&&['sync','rebuild','mapping'].includes(p.split('/').at(-1))){send(200,await cogs[p.split('/').at(-1)](actor,await body(req)));return;}
        throw error('not_found');
      }
      if(p.startsWith('/api/labor')){
        authorize(actor,'labor.read');if(!labor)throw error('not_found','Labor service unavailable');
        if(p==='/api/labor/overview'&&req.method==='GET'){send(200,await labor.overview(actor,Object.fromEntries(u.searchParams)));return;}
        if(p==='/api/labor/policy'&&req.method==='GET'){send(200,await labor.policy(actor));return;}
        if(p==='/api/labor/refresh'&&req.method==='POST'){const d=z.object({date:z.string().optional(),period:z.enum(['this','last','custom']).optional(),start:z.string().optional(),end:z.string().optional()}).strict().parse(await body(req));send(200,await labor.refresh(actor,d));return;}
        if(req.method==='POST'&&['week','mapping','target'].includes(p.slice('/api/labor/'.length))){send(200,await labor.configure(actor,p.slice('/api/labor/'.length),await body(req)));return;}
        throw error('not_found','Page not found');
      }
      if(p.startsWith('/api/admin')){
        authorize(actor,'administration.access');
        if(p==='/api/admin/reports'&&req.method==='GET'){if(!reports)throw error('not_found');send(200,await reports.read(actor));return;}
        if(p==='/api/admin/reports/preview'&&req.method==='GET'){if(!reports)throw error('not_found');send(200,await reports.preview(actor,u.searchParams.get('id')));return;}
        if(p==='/api/admin/reports/save'&&req.method==='POST'){if(!reports)throw error('not_found');send(200,await reports.save(actor,await body(req)));return;}
        if(p==='/api/admin/reports/send'&&req.method==='POST'){if(!reports)throw error('not_found');send(200,await reports.sendNow(actor,await body(req)));return;}
        if(p.startsWith('/api/admin/users')){
          authorize(actor,'users.manage');if(!accounts)throw error('not_found','Not available');
          if(p==='/api/admin/users'&&req.method==='GET'){send(200,await accounts.list(actor));return;}
          if(p==='/api/admin/users/detail'&&req.method==='GET'){send(200,await accounts.detail(actor,u.searchParams.get('id')));return;}
          if(req.method==='POST'&&['send-setup','send-verification','send-reset'].includes(p.slice('/api/admin/users/'.length))){if(!accountEmail)throw error('not_found');send(200,await accountEmail.send(actor,p.slice('/api/admin/users/send-'.length),await body(req)));return;}
          if(req.method==='POST'&&['create','update','revoke','issue-setup'].includes(p.slice('/api/admin/users/'.length))){const action=p.slice('/api/admin/users/'.length);send(200,action==='create'?(accountEmail?await accountEmail.create(actor,await body(req)):await accounts.create(actor,await body(req))):await accounts.mutate(actor,action,await body(req)));return;}
          throw error('not_found','Page not found');
        }
        if(p==='/api/admin'&&req.method==='GET'){send(200,{environment:runtime.environment,deployment:runtime.hosted?'Hosted Wahi':'Local owner review',capabilities:['Users & Access','Integrations','Scheduled Reports','System Settings'],operationalSync:false});return;}
        if(p==='/api/admin/integrations/resend'&&['GET','POST'].includes(req.method)){authorize(actor,'integrations.manage');if(!email)throw error('not_found');send(200,req.method==='GET'?await email.read(actor):await email.save(actor,await body(req)));return;}
        if(p==='/api/admin/integrations/resend/test'&&req.method==='POST'){authorize(actor,'integrations.manage');if(!email)throw error('not_found');send(200,await email.test(actor,await body(req)));return;}
        if(p==='/api/admin/integrations/toast'&&['GET','POST'].includes(req.method)){
          authorize(actor,'integrations.manage');if(!integrations)throw error('integration_key_unavailable','Integration service unavailable');
          send(200,req.method==='GET'?await integrations.read(actor):await integrations.save(actor,await body(req)));return;
        }
        throw error('not_found','Page not found');
      }
      if(p==='/api/area/inventory'&&req.method==='GET'){
        authorize(actor);const s=await service.repository.read();const data={items:s.ingredients.length,recipes:s.recipes.length,inventoryConfigured:s.inventoryItems.length,locations:s.inventoryLocations.filter(l=>l.active).length};
        if(can(actor,'internal_cost.read')){const m=await require('./management').management(service,actor);data.unresolvedRecipeCosts=m.recipes.filter(r=>!r.cost||r.cost.completeCost===null).length;}
        if(can(actor,'inventory.history'))data.recentCounts=s.countSessions.filter(c=>c.status==='submitted').sort((a,b)=>b.observedAt.localeCompare(a.observedAt)).slice(0,5).map(c=>({id:c.id,observedAt:c.observedAt,locationName:c.snapshot.location.name}));
        send(200,data);return;
      }
      if(p.startsWith('/api/views/')&&req.method==='GET'){
        const views=require('./views'),kind=p.slice('/api/views/'.length),id=u.searchParams.get('id');
        if(kind==='references'){send(200,await views.references(service,actor,{inventoryOnly:u.searchParams.get('mode')==='inventory'}));return;}
        if(kind==='item-history'){send(200,await views.itemHistory(service,actor,z.string().uuid().parse(id)));return;}
        if(['items','recipes','item','recipe','overview'].includes(kind)){if(['item','recipe'].includes(kind))z.string().uuid().parse(id);send(200,await views.view(service,actor,kind,id));return;}
        throw error('not_found','Page not found');
      }
      if(p==='/api/management'&&req.method==='GET'){send(200,await require('./management').management(service,actor));return;}
      if(p==='/api/item'&&req.method==='GET'){send(200,await require('./items').itemRecord(service,actor,u.searchParams.get('id')));return;}
      if(p==='/api/recipe/create'&&req.method==='POST'){send(200,await require('./recipe-workflow').createRecipe(service,actor,await body(req)));return;}
      if(p==='/api/item/save'&&req.method==='POST'){send(200,await require('./items').saveItem(service,actor,await body(req)));return;}
      if(p==='/api/internal'&&req.method==='GET'){
        authorize(actor,'internal_cost.read');const s=await service.repository.read();send(200,{suppliers:s.suppliers,purchaseOptions:s.purchaseOptions,prices:s.prices,bases:s.bases,yields:s.yields,measurements:s.measurements,labor:s.labor,laborRates:s.laborRates,sellingPrices:s.sellingPrices,menuMappings:s.menuMappings});return;
      }
      if(p==='/api/inventory/command'&&req.method==='POST'){const d=z.object({command:z.string(),input:z.record(z.string(),z.unknown())}).strict().parse(await body(req));send(200,await service.inventory.execute(actor,d.command,d.input));return;}
      if(p==='/api/domain/command'&&req.method==='POST'){const d=z.object({command:z.string(),input:z.record(z.string(),z.unknown())}).strict().parse(await body(req));send(200,await service.execute(actor,d.command,d.input));return;}
      const args=Object.fromEntries(u.searchParams);const id=args.id;delete args.id;
      if(req.method==='GET'){
        let result;
        if(p==='/api/locations')result=await service.inventory.locations(actor,{includeInactive:args.includeInactive==='true'});
        else if(p==='/api/sheet')result=await service.inventory.countSheet(actor,id);
        else if(p==='/api/session')result=await service.inventory.session(actor,id,args);
        else if(p==='/api/history')result=await service.inventory.sessions(actor,args);
        else if(p==='/api/overall')result=await service.inventory.overall(actor,id,args);
        else if(p==='/api/location-observations')result=await service.inventory.locationObservations(actor,id,args);
        else if(p==='/api/cost')result=await service.cost(actor,{...args,ingredientId:id});
        else if(p==='/api/ingredient')result=await service.ingredient(actor,id);
        else if(p==='/api/recipe')result=await service.recipe(actor,id,args);
        else if(p==='/api/audit')result=await service.audit(actor,id);
        else if(p==='/api/domain-history')result=await service.history(actor,args.collection,id);
        else throw error('not_found','Page not found');
        send(200,result);return;
      }
      throw error('not_found','Page not found');
    }catch(e){
      const status=e.code==='recipe_read_only'?503:e.code==='unauthenticated'?401:e.code==='forbidden'?403:e.code==='not_found'?404:['revision_conflict','mapping_client_outdated'].includes(e.code)?409:e.name==='ZodError'||['invalid_request','inactive_reference','missing_inventory_unit','not_on_sheet','invalid_state','invalid_observation_time','immutable_observation','invalid_command','cycle'].includes(e.code)?400:400;
      // Never send SQL messages, stacks, rejected payload values, or internal objects.
      const messages={recipe_read_only:'Recipe management is temporarily read-only. Published recipes remain available.',media_capacity:'Photograph storage is full. Existing recipes and photographs are preserved; contact Admin before uploading more.',boh_category_excluded:'Drink-category items are not available for BOH waste entry.',variant_group_invalid:'Choose a Recipe-defining group observed for each parent.',variant_option_invalid:'Choose valid observed options and Recipe choices.',variant_duplicate_choice:'Each parent and option binding must occur only once.',composite_group_invalid:'Choose one Recipe-defining group observed for each selected Toast parent. V1 supports one group per parent.',composite_option_invalid:'Each configured Toast option must belong to the selected group and reference a defined Recipe choice.',composite_duplicate_choice:'Each Toast parent, choice, and option binding must occur only once in this definition.',mapping_client_outdated:"This mapping page is from an older Wahi release. Reload this page before saving. Quantity and unit inputs are no longer used; no mapping was saved.",ineligible_mapping_target:"Choose an active Recipe in an enabled Mapping Settings category. Existing mappings are retained.",mapping_confirmation_required:"Confirm this policy change; it will update historical True COGS interpretation.",report_busy:"Reporting is processing another request. Try again shortly.",sales_sync_failed:"Toast sales synchronization failed. Existing facts were retained.",sales_page_limit:"This day exceeds the bounded synchronization limit; contact Admin.",sales_payload_unsupported:"Toast returned unsupported sales data. No partial day was committed.",sales_future_date:"Choose completed or current business dates.",cogs_reconciliation_failed:"Report knowledge needs rebuilding before export.",invalid_email_configuration:"Check the sender name, email address and API key format.",email_throttled:"Please wait before sending again. Limit: one per minute and five per hour.",invalid_email_token:"This link is invalid or has expired. Request a new link.",invalid_current_password:"The current password could not be confirmed.",invalid_recipe_target:"This item is no longer eligible for contextual recipe creation. Open its current configuration.",invalid_labor_range:"Choose a valid period with a start date on or before its end date.",invalid_week_start:"Choose a valid first day that matches the configured week start.",labor_sync_required:"Refresh Toast data first to establish the restaurant timezone.",labor_target_conflict:"Existing target weeks conflict with that week-rule change.",invalid_labor_date:"Choose a valid calendar date.",account_conflict:'That username or email is already assigned. No changes were saved.',invalid_setup:'This code cannot be used, or the password does not meet the 12–128 character requirement. Ask an Admin for a current code.',last_admin:'Keep at least one active Admin with an established password.',self_access_change:'You cannot disable or reduce access for your own account.',invalid_integration_configuration:'Check the Toast host, client ID, restaurant GUID and environment. No changes were saved.',integration_key_unavailable:'Secure integration storage is unavailable. Restore the server encryption key before saving.',integration_secret_required:'Configure a secret before enabling this integration.',integration_save_failed:'Integration settings could not be saved. Existing settings were retained.',package_contents_required:'Could not save purchasing information. Supply known package contents before recording a price; existing package contents cannot be cleared.',effective_time_collision:'A fact already exists at that exact effective time. Choose a later effective time or use an explicit history correction.',unauthenticated:'Please log in',forbidden:'You do not have access to this action',revision_conflict:'This record changed. Reload it before saving.',cycle:'This change creates a circular ingredient dependency.',not_found:'Record not found',inactive_reference:'An archived record cannot be selected here.',missing_inventory_unit:'Configure the inventory base unit first.',not_on_sheet:'This item is not on the saved count sheet.',invalid_state:'This action is not available for the current count status.',invalid_observation_time:'Check the physical observation date and time.',immutable_observation:'A quantity correction must retain the original unit and time.',invalid_command:'Unknown action',invalid_request:'Check the request fields.'};
      const connectionMessages={review_callback_registration_required:'Register the exact HTTPS callback in Google Cloud Console and confirm registration before connecting.',review_connection_not_authorized:'Authorize OAuth and business discovery with Connect Google. Review-content permission is separate.',review_provider_credentials_missing:'Enter the OAuth Client ID and Client Secret, then save configuration.',review_oauth_exchange_failed:'Google rejected the authorization code. Check the OAuth client and exact callback URI, then reconnect.',review_oauth_callback_rejected:'Google authorization was declined or incomplete. Start Connect Google again.',review_oauth_state_invalid:'The authorization expired, was already used, or belongs to another session. Start Connect Google again from this Admin session.',review_google_permission_denied:'Google denied Business Profile access. Check the selected Google identity, enabled APIs and project API access approval.',review_google_reconnect_required:'Google authorization is missing or revoked. Choose Reconnect and complete Google consent.',review_google_authentication_failed:'Google rejected authorization after refresh. Reconnect with the business owner account.',review_provider_rate_limited:'Google is limiting requests. Wait before retrying discovery.',review_provider_transient:'Google is temporarily unavailable. Retry discovery shortly.',review_provider_transport:'Google could not be reached. Check the connection and retry.',review_location_confirmation_invalid:'Refresh locations and explicitly confirm the exact business name and address.',review_account_not_discovered:'Refresh accessible accounts and explicitly select one before loading locations.',review_persistent_runtime_required:'Use the persistent Google connection runtime for real credentials. The synthetic runner is disposable.',review_content_processing_disabled:'This local runtime authorizes OAuth and business metadata only. Review ingestion and OpenAI processing are disabled.'};Object.assign(messages,connectionMessages);
      if(new URL(req.url,'http://localhost').pathname.includes('/openai'))Object.assign(messages,{review_provider_credentials_missing:'Save an OpenAI API key first.',review_provider_rate_limited:'OpenAI is limiting requests. Wait before retrying.',review_provider_transport:'OpenAI could not be reached. Check the connection and try again.',review_network_disabled:'This isolated preview blocks OpenAI network requests. No request was sent.',review_openai_authentication_failed:'OpenAI rejected the API key. Replace it and test again.',review_openai_permission_denied:'This API key does not have the required OpenAI permissions.',review_openai_model_incompatible:'The selected model did not complete the structured-output check. Choose a compatible Responses model or review its output token limit.',review_openai_configuration_incomplete:'Choose a model and configure prices and budgets before running the compatibility check.',review_invalid_provider_configuration:'Check the model ID, output limit, dated prices and positive processing budgets. No configuration was saved.',review_request_budget_exceeded:'The estimated request exceeds its configured limit. Review the selected model, token limit and budget.',review_monthly_budget_exceeded:'The monthly budget is exhausted or reserved. Review usage before increasing the budget.',review_dispatch_uncertain:'The request outcome is unknown. Its full cost reservation remains counted; review usage before retrying.'});
      if(/^review_[a-z_]+$/.test(e.code||'')&&!Object.hasOwn(messages,e.code))messages[e.code]='Review Intelligence: '+e.code.replace(/^review_/, '').replaceAll('_',' ')+'.';
      const publicCode=Object.hasOwn(messages,e.code)?e.code:'invalid_request';
      const measurementError=e.name==='ZodError'&&e.issues?.some(i=>i.path.some(p=>['measurement','fromQuantity','toQuantity','fromUnit','toUnit'].includes(p)));
      const recipeError=new URL(req.url,'http://localhost').pathname.startsWith('/api/recipe-book/');
      const recipeField=e.name==='ZodError'&&recipeError?e.issues?.[0]?.path:null;
      const recipeProblem=recipeField?('Check recipe field '+recipeField.map(x=>typeof x==='number'?x+1:x).join(' → ')+'. Supply a valid '+(recipeField.at(-1)==='quantity'?'quantity':recipeField.at(-1)==='unit'?'unit':'value')+'.'):null;
      const safe=recipeError&&e.recipeMessage?e.recipeMessage:recipeProblem|| (measurementError?'Could not save measurement. Supply both positive decimal quantities and valid units (for example, 1 and 0.00113636); enter units in the unit selectors.':e.name==='ZodError'?'Check the required fields, quantities, units and dates.':messages[e.code]??'Could not save. Check references and effective dates; existing facts may require an explicit correction.');
      send(status,{error:safe,code:publicCode});
    }
  });
  return server;
}
module.exports={createReviewServer};
if(require.main===module){(async()=>{
  const {openReview}=require('./runtime');const {service,pool,users,integrations,accounts,sessionStore,labor,email,accountEmail}=await openReview();
  const recipeMedia=process.env.WAHI_RECIPE_MEDIA_ROOT?new (require('../recipe-book/media').PrivateLocalRecipeMedia)(process.env.WAHI_RECIPE_MEDIA_ROOT):undefined;
  const server=createReviewServer({service,users,integrations,accounts,sessionStore,labor,email,accountEmail,recipeMedia});server.listen(4317,'127.0.0.1',()=>console.log('Wahi owner review: http://127.0.0.1:4317 (isolated local review)'));
  const shutdown=()=>server.close(()=>pool.end().then(()=>process.exit(0)));process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
})().catch(e=>{console.error('Review startup failed:',e.message);process.exitCode=1;});}
