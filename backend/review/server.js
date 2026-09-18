'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {z}=require('zod');
const {CAPABILITIES,authorize,can,ingredientView,recipeView}=require('../auth');
const {latest}=require('../domain/history');
const {verify}=require('./auth');
function error(code,message){return Object.assign(new Error(message),{code});}
async function body(req){let s='';for await(const c of req){s+=c;if(Buffer.byteLength(s)>128000)throw error('invalid_request','Request too large');}try{return JSON.parse(s);}catch{throw error('invalid_request','Invalid JSON');}}
function potentialHealth(req,runtime){return runtime.hosted&&req.method==='GET'&&req.url==='/healthz';}
function createReviewServer({service,users,integrations,runtime={hosted:false,environment:'local-review'},sessionStore}){
  const sessions=new Map(),attempts=new Map();
  const assetNames=['app.js','style.css','management-ui.js','table-model.js','currency.js','shell-model.js','shell.js'];
  const assets=Promise.all(assetNames.map(async name=>{const content=await fs.readFile(path.join(__dirname,'public',name));return {name,content,url:'/'+name.replace(/(\.[^.]+)$/,'.'+crypto.createHash('sha256').update(content).digest('hex').slice(0,16)+'$1')};}));
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
        if(p==='/'){res.setHeader('Content-Type','text/html');let content=await fs.readFile(path.join(__dirname,'public','index.html'),'utf8');if(runtime.hosted){content=content.replace('Wahi — Owner Review','Wahi').replace(/<div class="review-banner">.*?<\/div>/,'<div class="review-banner" hidden></div>').replace('<span>Owner review</span>','<span>Management</span>').replace('Try the current workflows.','Log in to Wahi.').replace('Use your local review credentials. Production logins are separate.','Use your Wahi account.');for(const a of entries)content=content.replaceAll('/'+a.name,a.url);}return res.end(content);}
      }
      if(p==='/api/login'&&req.method==='POST'){
        const data=z.object({username:z.string().max(100),password:z.string().min(1).max(200)}).strict().parse(await body(req));
        const key=req.socket.remoteAddress,now=Date.now();let rate=attempts.get(key);
        if(!rate||rate.until<now){rate={n:0,until:now+60000};attempts.set(key,rate);}
        if(sessionStore?!await sessionStore.allowLogin(tokenHash('login:'+(users.some(u=>u.username===data.username)?data.username:'unknown'))):++rate.n>20){send(429,{error:'Too many login attempts. Try again in a minute.'});return;}
        const user=users.find(x=>x.username===data.username);
        if(!await verify(user,data.password)){send(401,{error:'Invalid username or password'});return;}
        for(const [key,value]of sessions)if(value.expires<now)sessions.delete(key);
        const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
        const value={user,csrf,expires:now+8*60*60*1000};if(sessionStore)await sessionStore.set(tokenHash(token),value);else sessions.set(tokenHash(token),value);
        res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${cookieFlags}`);send(200,{ok:true});return;
      }
      const cookie=String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.split('=')[1];
      const session=cookie?(sessionStore?await sessionStore.get(tokenHash(cookie)):sessions.get(tokenHash(cookie))):null;
      if(sessionStore&&session)session.user=users.find(u=>u.id===session.userId);
      if(!session?.user||session.expires<Date.now())throw error('unauthenticated','Please log in');
      const actor={id:session.user.id,role:session.user.role};
      if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)throw error('forbidden','Refresh your session before saving');
      if(p==='/api/me'&&req.method==='GET'){send(200,{id:actor.id,username:session.user.username,role:actor.role,capabilities:CAPABILITIES[actor.role],csrf:session.csrf,environment:runtime.environment,hosted:runtime.hosted,demo:service.repository.hasImportedData?!await service.repository.hasImportedData():!(await service.repository.read()).importRecords.length});return;}
      if(p==='/api/logout'&&req.method==='POST'){if(sessionStore)await sessionStore.delete(tokenHash(cookie));else sessions.delete(tokenHash(cookie));res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cookieFlags}`);send(200,{ok:true});return;}
      if(p==='/api/catalog'&&req.method==='GET'){
        authorize(actor);const s=await service.repository.read(),now=new Date().toISOString();
        send(200,{ingredients:s.ingredients.map(i=>({...ingredientView(i),itemKind:(()=>{const b=latest(s.bases.filter(b=>b.ingredientId===i.id),now,now);return b?.kind==='source'?'Source-yield Item':b?.kind==='labor_only'?'Labor Item':b?.kind==='recipe'||s.recipes.some(r=>r.outputIngredientId===i.id)?'Prepared Item':'Purchased Item';})()})),recipes:s.recipes.map(r=>recipeView(r,latest(s.recipeRevisions.filter(v=>v.recipeId===r.id),now,now))),menuItems:s.menuItems.map(m=>service.menuFromState(actor,s,m.id,{at:now,knownAt:now})),inventoryItems:s.inventoryItems.map(i=>({ingredientId:i.ingredientId,baseUnit:i.baseUnit})),drafts:s.countSessions.filter(c=>c.actorId===actor.id&&c.status==='draft').map(c=>({id:c.id,locationName:c.snapshot.location.name,observedAt:c.observedAt})),...(can(actor,'inventory.configure')?{assignments:s.inventoryAssignments.map(a=>({id:a.id,ingredientId:a.ingredientId,locationId:a.locationId,countUnit:a.countUnit,sortOrder:a.sortOrder,active:a.active,version:a.version}))}:{})});return;
      }
      if(p.startsWith('/api/admin')){
        authorize(actor,'administration.access');
        if(p==='/api/admin'&&req.method==='GET'){send(200,{environment:runtime.environment,deployment:runtime.hosted?'Hosted Wahi':'Local owner review',capabilities:['Integrations','System Settings'],operationalSync:false});return;}
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
      const status=e.code==='unauthenticated'?401:e.code==='forbidden'?403:e.code==='not_found'?404:e.code==='revision_conflict'?409:e.name==='ZodError'||['invalid_request','inactive_reference','missing_inventory_unit','not_on_sheet','invalid_state','invalid_observation_time','immutable_observation','invalid_command','cycle'].includes(e.code)?400:400;
      // Never send SQL messages, stacks, rejected payload values, or internal objects.
      const messages={invalid_integration_configuration:'Check the Toast host, client ID, restaurant GUID and environment. No changes were saved.',integration_key_unavailable:'Secure integration storage is unavailable. Restore the server encryption key before saving.',integration_secret_required:'Configure a client secret before enabling Toast.',integration_save_failed:'Integration settings could not be saved. Existing settings were retained.',package_contents_required:'Could not save purchasing information. Supply known package contents before recording a price; existing package contents cannot be cleared.',effective_time_collision:'A fact already exists at that exact effective time. Choose a later effective time or use an explicit history correction.',unauthenticated:'Please log in',forbidden:'You do not have access to this action',revision_conflict:'This record changed. Reload it before saving.',cycle:'This change creates a circular ingredient dependency.',not_found:'Record not found',inactive_reference:'An archived record cannot be selected here.',missing_inventory_unit:'Configure the inventory base unit first.',not_on_sheet:'This item is not on the saved count sheet.',invalid_state:'This action is not available for the current count status.',invalid_observation_time:'Check the physical observation date and time.',immutable_observation:'A quantity correction must retain the original unit and time.',invalid_command:'Unknown action',invalid_request:'Check the request fields.'};
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
  const {openReview}=require('./runtime');const {service,pool,users,integrations}=await openReview();
  const server=createReviewServer({service,users,integrations});server.listen(4317,'127.0.0.1',()=>console.log('Wahi owner review: http://127.0.0.1:4317 (isolated local review)'));
  const shutdown=()=>server.close(()=>pool.end().then(()=>process.exit(0)));process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
})().catch(e=>{console.error('Review startup failed:',e.message);process.exitCode=1;});}
