'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {z}=require('zod');
const {CAPABILITIES,authorize,can,ingredientView,recipeView}=require('../auth');
const {latest}=require('../domain/history');
const {verify}=require('./auth');
function error(code,message){return Object.assign(new Error(message),{code});}
async function body(req){let s='';for await(const c of req){s+=c;if(Buffer.byteLength(s)>128000)throw error('invalid_request','Request too large');}try{return JSON.parse(s);}catch{throw error('invalid_request','Invalid JSON');}}
function createReviewServer({service,users}){
  const sessions=new Map(),attempts=new Map();
  const tokenHash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const server=http.createServer(async(req,res)=>{
    const expectedHost='127.0.0.1:'+server.address().port;
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    res.setHeader('X-Wahi-Review','local-synthetic');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      if(req.headers.host!==expectedHost)throw error('forbidden','Use the local review URL');
      const u=new URL(req.url,'http://'+expectedHost),p=u.pathname;
      if(req.method==='POST'){
        if(req.headers.origin!=='http://'+expectedHost)throw error('forbidden','Same-origin request required');
        if(!String(req.headers['content-type']).startsWith('application/json'))throw error('invalid_request','JSON required');
      }
      if(req.method==='GET'&&['/','/app.js','/style.css','/management-ui.js','/table-model.js'].includes(p)){
        const filename=p==='/'?'index.html':p.slice(1);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');return res.end(await fs.readFile(path.join(__dirname,'public',filename)));
      }
      if(p==='/api/login'&&req.method==='POST'){
        const data=z.object({username:z.string().max(100),password:z.string().min(1).max(200)}).strict().parse(await body(req));
        const key=req.socket.remoteAddress,now=Date.now();let rate=attempts.get(key);
        if(!rate||rate.until<now){rate={n:0,until:now+60000};attempts.set(key,rate);}
        if(++rate.n>20){send(429,{error:'Too many login attempts. Try again in a minute.'});return;}
        const user=users.find(x=>x.username===data.username);
        if(!await verify(user,data.password)){send(401,{error:'Invalid username or password'});return;}
        for(const [key,value]of sessions)if(value.expires<now)sessions.delete(key);
        const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
        sessions.set(tokenHash(token),{user,csrf,expires:now+8*60*60*1000});
        res.setHeader('Set-Cookie',`wahi_review_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);send(200,{ok:true});return;
      }
      const cookie=String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('wahi_review_session='))?.split('=')[1];
      const session=cookie?sessions.get(tokenHash(cookie)):null;
      if(!session||session.expires<Date.now())throw error('unauthenticated','Please log in');
      const actor={id:session.user.id,role:session.user.role};
      if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)throw error('forbidden','Refresh your session before saving');
      if(p==='/api/me'&&req.method==='GET'){send(200,{id:actor.id,username:session.user.username,role:actor.role,capabilities:CAPABILITIES[actor.role],csrf:session.csrf,demo:true});return;}
      if(p==='/api/logout'&&req.method==='POST'){sessions.delete(tokenHash(cookie));res.setHeader('Set-Cookie','wahi_review_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');send(200,{ok:true});return;}
      if(p==='/api/catalog'&&req.method==='GET'){
        authorize(actor);const s=await service.repository.read(),now=new Date().toISOString();
        send(200,{ingredients:s.ingredients.map(i=>({...ingredientView(i),itemKind:(()=>{const b=latest(s.bases.filter(b=>b.ingredientId===i.id),now,now);return b?.kind==='source'?'Source-yield Item':b?.kind==='labor_only'?'Labor Item':b?.kind==='recipe'||s.recipes.some(r=>r.outputIngredientId===i.id)?'Prepared Item':'Purchased Item';})()})),recipes:s.recipes.map(r=>recipeView(r,latest(s.recipeRevisions.filter(v=>v.recipeId===r.id),now,now))),menuItems:await Promise.all(s.menuItems.map(m=>service.menu(actor,m.id))),inventoryItems:s.inventoryItems.map(i=>({ingredientId:i.ingredientId,baseUnit:i.baseUnit})),drafts:s.countSessions.filter(c=>c.actorId===actor.id&&c.status==='draft').map(c=>({id:c.id,locationName:c.snapshot.location.name,observedAt:c.observedAt})),...(can(actor,'inventory.configure')?{assignments:s.inventoryAssignments.map(a=>({id:a.id,ingredientId:a.ingredientId,locationId:a.locationId,countUnit:a.countUnit,sortOrder:a.sortOrder,active:a.active,version:a.version}))}:{})});return;
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
      const messages={unauthenticated:'Please log in',forbidden:'You do not have access to this action',revision_conflict:'This record changed. Reload it before saving.',cycle:'This change creates a circular ingredient dependency.',not_found:'Record not found',inactive_reference:'An archived record cannot be selected here.',missing_inventory_unit:'Configure the inventory base unit first.',not_on_sheet:'This item is not on the saved count sheet.',invalid_state:'This action is not available for the current count status.',invalid_observation_time:'Check the physical observation date and time.',immutable_observation:'A quantity correction must retain the original unit and time.',invalid_command:'Unknown action',invalid_request:'Check the request fields.'};
      const publicCode=Object.hasOwn(messages,e.code)?e.code:'invalid_request';
      const safe=e.name==='ZodError'?'Check the required fields, quantities, units and dates.':messages[e.code]??'Could not save. Check references and effective dates; existing facts may require an explicit correction.';
      send(status,{error:safe,code:publicCode});
    }
  });
  return server;
}
module.exports={createReviewServer};
if(require.main===module){(async()=>{
  const {openReview}=require('./runtime');const {service,pool,users}=await openReview();
  const server=createReviewServer({service,users});server.listen(4317,'127.0.0.1',()=>console.log('Wahi owner review: http://127.0.0.1:4317 (synthetic data only)'));
  const shutdown=()=>server.close(()=>pool.end().then(()=>process.exit(0)));process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
})().catch(e=>{console.error('Review startup failed:',e.message);process.exitCode=1;});}
