'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {z}=require('zod');
const {CAPABILITIES,authorize,can,ingredientView,recipeView}=require('../auth');
const {latest}=require('../domain/history');
const {verify}=require('./auth');
function error(code,message){return Object.assign(new Error(message),{code});}
async function body(req){let s='';for await(const c of req){s+=c;if(Buffer.byteLength(s)>128000)throw error('invalid_request','Request too large');}try{return JSON.parse(s);}catch{throw error('invalid_request','Invalid JSON');}}
function potentialHealth(req,runtime){return runtime.hosted&&req.method==='GET'&&req.url==='/healthz';}
function createReviewServer({service,users,integrations,runtime={hosted:false,environment:'local-review'},sessionStore,accounts,labor,email,accountEmail,reports,cogs}){
  const waste=new (require('../waste/service').WasteService)(service.repository,{context:runtime});
  const sessions=new Map(),attempts=new Map();
  const assetNames=['app.js','style.css','management-ui.js','table-model.js','currency.js','quantity.js','shell-model.js','shell.js','users-ui.js','labor-ui.js','email-ui.js','leadership-summary.js','deep-links.js','reports-ui.js','cogs-ui.js','cogs-model.js','mapping-ui.js','composite-ui.js','variant-ui.js','waste-ui.js'];
  const assets=Promise.all(assetNames.map(async name=>{const content=await fs.readFile(path.join(__dirname,'public',name));return {name,content,url:'/'+name.replace(/(\.[^.]+)$/,'.'+crypto.createHash('sha256').update(content).digest('hex').slice(0,16)+'$1')};}));
  const mappingUiVersion=assets.then(entries=>crypto.createHash('sha256').update(entries.filter(a=>['mapping-ui.js','composite-ui.js','variant-ui.js','cogs-ui.js','quantity.js','app.js'].includes(a.name)).map(a=>a.url).join('|')).digest('hex').slice(0,16));
  const tokenHash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const server=http.createServer(async(req,res)=>{
    const origin=runtime.hosted?runtime.origin:'http://127.0.0.1:'+server.address().port;
    const expectedHost=new URL(origin).host,cookieName=runtime.hosted?'__Host-wahi_session':'wahi_review_session',cookieFlags=runtime.hosted?'; Secure':'';
    const started=performance.now();
    const send=(status,data)=>{res.setHeader('Server-Timing','app;dur='+(performance.now()-started).toFixed(2));res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(!runtime.hosted)res.setHeader('X-Wahi-Review','local-review');else res.setHeader('Strict-Transport-Security','max-age=31536000');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
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
        if(p==='/'){res.setHeader('Content-Type','text/html');let content=await fs.readFile(path.join(__dirname,'public','index.html'),'utf8');content=content.replace('</head>',`<meta name="wahi-mapping-ui" content="${await mappingUiVersion}"></head>`);if(runtime.hosted){content=content.replace('Wahi — Owner Review','Wahi').replace(/<div class="review-banner">.*?<\/div>/,'<div class="review-banner" hidden></div>').replace('<span>Owner review</span>','<span>Management</span>').replace('Try the current workflows.','Log in to Wahi.').replace('Use your local review credentials. Production logins are separate.','Use your Wahi account.');for(const a of entries)content=content.replaceAll('/'+a.name,a.url);}return res.end(content);}
      }
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
      if(p==='/api/me'&&req.method==='GET'){send(200,{id:actor.id,username:session.user.username,role:actor.role,capabilities:CAPABILITIES[actor.role],csrf:session.csrf,environment:runtime.environment,hosted:runtime.hosted,demo:service.repository.hasImportedData?!await service.repository.hasImportedData():!(await service.repository.read()).importRecords.length});return;}
      if(p==='/api/account/security'&&req.method==='GET'){if(!accountEmail)throw error('not_found');send(200,await accountEmail.me(actor));return;}
      if(p==='/api/account/resend-verification'&&req.method==='POST'){if(!accountEmail)throw error('not_found');send(200,await accountEmail.send(actor,'verification',await body(req),true));return;}
      if(p==='/api/account/change-password'&&req.method==='POST'){if(!accountEmail)throw error('not_found');send(200,await accountEmail.changePassword(actor,await body(req)));return;}
      if(p==='/api/logout'&&req.method==='POST'){if(sessionStore)await sessionStore.delete(tokenHash(cookie));else sessions.delete(tokenHash(cookie));res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cookieFlags}`);send(200,{ok:true});return;}
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
      const status=e.code==='unauthenticated'?401:e.code==='forbidden'?403:e.code==='not_found'?404:['revision_conflict','mapping_client_outdated'].includes(e.code)?409:e.name==='ZodError'||['invalid_request','inactive_reference','missing_inventory_unit','not_on_sheet','invalid_state','invalid_observation_time','immutable_observation','invalid_command','cycle'].includes(e.code)?400:400;
      // Never send SQL messages, stacks, rejected payload values, or internal objects.
      const messages={boh_category_excluded:'Drink-category items are not available for BOH waste entry.',variant_group_invalid:'Choose a Recipe-defining group observed for each parent.',variant_option_invalid:'Choose valid observed options and Recipe choices.',variant_duplicate_choice:'Each parent and option binding must occur only once.',composite_group_invalid:'Choose one Recipe-defining group observed for each selected Toast parent. V1 supports one group per parent.',composite_option_invalid:'Each configured Toast option must belong to the selected group and reference a defined Recipe choice.',composite_duplicate_choice:'Each Toast parent, choice, and option binding must occur only once in this definition.',mapping_client_outdated:"This mapping page is from an older Wahi release. Reload this page before saving. Quantity and unit inputs are no longer used; no mapping was saved.",ineligible_mapping_target:"Choose an active Recipe in an enabled Mapping Settings category. Existing mappings are retained.",mapping_confirmation_required:"Confirm this policy change; it will update historical True COGS interpretation.",report_busy:"Reporting is processing another request. Try again shortly.",sales_sync_failed:"Toast sales synchronization failed. Existing facts were retained.",sales_page_limit:"This day exceeds the bounded synchronization limit; contact Admin.",sales_payload_unsupported:"Toast returned unsupported sales data. No partial day was committed.",sales_future_date:"Choose completed or current business dates.",cogs_reconciliation_failed:"Report knowledge needs rebuilding before export.",invalid_email_configuration:"Check the sender name, email address and API key format.",email_throttled:"Please wait before sending again. Limit: one per minute and five per hour.",invalid_email_token:"This link is invalid or has expired. Request a new link.",invalid_current_password:"The current password could not be confirmed.",invalid_recipe_target:"This item is no longer eligible for contextual recipe creation. Open its current configuration.",invalid_labor_range:"Choose a valid period with a start date on or before its end date.",invalid_week_start:"Choose a valid first day that matches the configured week start.",labor_sync_required:"Refresh Toast data first to establish the restaurant timezone.",labor_target_conflict:"Existing target weeks conflict with that week-rule change.",invalid_labor_date:"Choose a valid calendar date.",account_conflict:'That username or email is already assigned. No changes were saved.',invalid_setup:'This code cannot be used, or the password does not meet the 12–128 character requirement. Ask an Admin for a current code.',last_admin:'Keep at least one active Admin with an established password.',self_access_change:'You cannot disable or reduce access for your own account.',invalid_integration_configuration:'Check the Toast host, client ID, restaurant GUID and environment. No changes were saved.',integration_key_unavailable:'Secure integration storage is unavailable. Restore the server encryption key before saving.',integration_secret_required:'Configure a secret before enabling this integration.',integration_save_failed:'Integration settings could not be saved. Existing settings were retained.',package_contents_required:'Could not save purchasing information. Supply known package contents before recording a price; existing package contents cannot be cleared.',effective_time_collision:'A fact already exists at that exact effective time. Choose a later effective time or use an explicit history correction.',unauthenticated:'Please log in',forbidden:'You do not have access to this action',revision_conflict:'This record changed. Reload it before saving.',cycle:'This change creates a circular ingredient dependency.',not_found:'Record not found',inactive_reference:'An archived record cannot be selected here.',missing_inventory_unit:'Configure the inventory base unit first.',not_on_sheet:'This item is not on the saved count sheet.',invalid_state:'This action is not available for the current count status.',invalid_observation_time:'Check the physical observation date and time.',immutable_observation:'A quantity correction must retain the original unit and time.',invalid_command:'Unknown action',invalid_request:'Check the request fields.'};
      const publicCode=Object.hasOwn(messages,e.code)?e.code:'invalid_request';
      const measurementError=e.name==='ZodError'&&e.issues?.some(i=>i.path.some(p=>['measurement','fromQuantity','toQuantity','fromUnit','toUnit'].includes(p)));
      const safe=measurementError?'Could not save measurement. Supply both positive decimal quantities and valid units (for example, 1 and 0.00113636); enter units in the unit selectors.':e.name==='ZodError'?'Check the required fields, quantities, units and dates.':messages[e.code]??'Could not save. Check references and effective dates; existing facts may require an explicit correction.';
      send(status,{error:safe,code:publicCode});
    }
  });
  return server;
}
module.exports={createReviewServer};
if(require.main===module){(async()=>{
  const {openReview}=require('./runtime');const {service,pool,users,integrations,accounts,sessionStore,labor,email,accountEmail}=await openReview();
  const server=createReviewServer({service,users,integrations,accounts,sessionStore,labor,email,accountEmail});server.listen(4317,'127.0.0.1',()=>console.log('Wahi owner review: http://127.0.0.1:4317 (isolated local review)'));
  const shutdown=()=>server.close(()=>pool.end().then(()=>process.exit(0)));process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
})().catch(e=>{console.error('Review startup failed:',e.message);process.exitCode=1;});}
