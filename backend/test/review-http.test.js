'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {createReviewServer}=require('../review/server'),{createUser}=require('../review/auth');
const {DomainService}=require('../service'),{MemoryRepository}=require('../repository/memory');
const {seed}=require('../review/seed');
let server,base,service;const password='Synthetic-test-password-only';
before(async()=>{service=new DomainService(new MemoryRepository());await seed(service);const users=await Promise.all(['ADMIN','MANAGER','LEAD','STAFF'].map(role=>createUser(role.toLowerCase(),role,password)));server=createReviewServer({service,users});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
async function request(path,{auth,body,headers={}}={}){const r=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(role){const r=await request('login',{body:{username:role.toLowerCase(),password}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);const auth={cookie:r.headers.get('set-cookie').split(';')[0]};const me=await request('me',{auth});auth.csrf=me.body.csrf;return auth;}

test('review HTTP: login required, bad password rejected, principal cannot be supplied by request',async()=>{
  assert.equal((await request('catalog')).status,401);assert.equal((await request('login',{body:{username:'admin',password:'wrong'}})).status,401);
  assert.equal((await request('login',{body:{username:'staff',password,role:'ADMIN'}})).status,400);
  const auth=await login('STAFF');assert.equal((await request('me',{auth,headers:{'X-Role':'ADMIN'}})).body.role,'STAFF');
  assert.equal((await request('domain/command',{auth,body:{command:'createIngredient',input:{name:'Forbidden',provenance:{kind:'manual'}},actor:{role:'ADMIN'}}})).status,400);
});

test('review HTTP: origin and CSRF protection reject unauthorized browser writes',async()=>{
  const auth=await login('ADMIN');
  assert.equal((await request('inventory/command',{auth,body:{command:'createLocation',input:{name:'CSRF'}},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await request('inventory/command',{auth,body:{command:'createLocation',input:{name:'CSRF'}},headers:{'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await request('login',{body:{username:'admin',password},headers:{Origin:'https://evil.example'}})).status,403);
});

for(const role of ['STAFF','LEAD'])test(`review HTTP: ${role} catalog and inventory omit protected cost data; sensitive routes deny access`,async()=>{
  const auth=await login(role),c=await request('catalog',{auth});assert.equal(c.status,200);
  const inspect=x=>{if(!x||typeof x!=='object')return;for(const [key,v]of Object.entries(x)){assert.ok(!['internalCost','provenance','purchaseOptions','supplierId','purchaseOptionId','knownSubtotal','materialSubtotal','laborSubtotal'].includes(key),key);inspect(v);}};inspect(c.body);assert.ok(c.body.menuItems.some(m=>m.sellingPrice?.amount==='16'));
  for(const route of ['internal','history','audit?id=invalid','cost?id=invalid&quantity=1&unit=each','domain-history?collection=prices&id=invalid'])assert.equal((await request(route,{auth})).status,403,route);
  for(const command of ['createLocation','correctCount','configureItem'])assert.equal((await request('inventory/command',{auth,body:{command,input:{}}})).status,403);
});

test('review HTTP: full Staff count -> submit -> Manager correction -> history and overall workflow',async()=>{
  const staff=await login('STAFF'),manager=await login('MANAGER');const location=(await request('locations',{auth:staff})).body.find(l=>l.name==='Demo Bar');
  const items=(await request('sheet?id='+location.id,{auth:staff})).body.items;
  const session=(await request('inventory/command',{auth:staff,body:{command:'startCount',input:{locationId:location.id,observedAt:new Date(Date.now()-1000).toISOString()}}})).body;
  const observation=(await request('inventory/command',{auth:staff,body:{command:'enterCount',input:{sessionId:session.id,ingredientId:items[0].ingredientId,quantity:'22',unit:items[0].countUnit,expectedRevisionId:null}}})).body;
  assert.equal((await request('inventory/command',{auth:staff,body:{command:'submitCount',input:{sessionId:session.id,expectedVersion:1,expectedObservationIds:[observation.id]}}})).status,200);
  const original=(await request('session?id='+session.id,{auth:staff})).body;assert.equal(original.status,'submitted');assert.equal(original.revisions,undefined);assert.equal(original.missingIngredientIds.length,2);
  const corrected=await request('inventory/command',{auth:manager,body:{command:'correctCount',input:{observationId:observation.id,expectedRevisionId:observation.id,quantity:'2.2',reason:'Synthetic decimal correction'}}});assert.equal(corrected.status,200);
  const sheet=(await request('session?id='+session.id,{auth:manager})).body;assert.equal(sheet.revisions[0].quantity,'22');assert.equal(sheet.observations[0].quantity,'2.2');
  const overall=(await request('overall?id='+items[0].ingredientId,{auth:staff})).body;assert.equal(overall.overallQuantity,'20.200000000000');assert.equal(overall.mixedObservationTimes,true);
  const conflict=await request('inventory/command',{auth:manager,body:{command:'correctCount',input:{observationId:observation.id,expectedRevisionId:observation.id,quantity:'2',reason:'Stale'}}});assert.equal(conflict.status,409);
});

test('review HTTP: one employee cannot edit or retrieve another employee draft',async()=>{
  const staff=await login('STAFF'),lead=await login('LEAD');const l=(await request('locations',{auth:staff})).body[0],item=(await request('sheet?id='+l.id,{auth:staff})).body.items[0];
  const s=(await request('inventory/command',{auth:staff,body:{command:'startCount',input:{locationId:l.id,observedAt:new Date(Date.now()-1000).toISOString()}}})).body;
  assert.equal((await request('session?id='+s.id,{auth:lead})).status,403);assert.equal((await request('inventory/command',{auth:lead,body:{command:'enterCount',input:{sessionId:s.id,ingredientId:item.ingredientId,quantity:'1',unit:item.countUnit,expectedRevisionId:null}}})).status,403);
});

test('review HTTP: Manager sees costs but cannot set Admin labor rates; Admin can',async()=>{
  const manager=await login('MANAGER'),admin=await login('ADMIN');const internal=await request('internal',{auth:manager});assert.equal(internal.status,200);assert.ok(internal.body.prices.length);
  const body={command:'setLaborRate',input:{department:'BOH',amount:'20',currency:'USD',provenance:{kind:'manual'}}};assert.equal((await request('domain/command',{auth:manager,body})).status,403);assert.equal((await request('domain/command',{auth:admin,body})).status,200);
});

test('review HTTP: validation errors never return stacks, SQL or rejected sensitive input',async()=>{
  const auth=await login('ADMIN');const r=await request('domain/command',{auth,body:{command:'addPrice',input:{purchaseOptionId:'bad',amount:'secret-invalid-value',currency:'USD',provenance:{kind:'manual'}}}});assert.equal(r.status,400);assert.ok(!JSON.stringify(r.body).includes('secret-invalid-value'));assert.equal(r.body.stack,undefined);
});

test('review HTTP: private runtime credentials and arbitrary files are never served',async()=>{
  const auth=await login('ADMIN');for(const p of ['/../.runtime/access.json','/.runtime/access.json','/runtime.js','/server.js']){const r=await fetch(base+p,{headers:{Cookie:auth.cookie}});const text=await r.text();assert.notEqual(r.status,200);assert.ok(!text.includes(password));}
});

test('review HTTP: logout revokes session and foreign Host headers are rejected',async()=>{
  const auth=await login('STAFF');assert.equal((await request('logout',{auth,body:{}})).status,200);assert.equal((await request('catalog',{auth})).status,401);
  const status=await new Promise((resolve,reject)=>{const r=require('node:http').get(base+'/api/catalog',{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);});r.on('error',reject);});
  assert.equal(status,403);
});

test('review HTTP: database exceptions with codes are sanitized before serialization',async()=>{
  const auth=await login('ADMIN'),original=service.cost;
  try{service.cost=async()=>{throw Object.assign(new Error('SQL sensitive purchase amount 987.654321'),{code:'23505'});};const r=await request('cost?id=anything',{auth});assert.equal(r.status,400);assert.equal(r.body.code,'invalid_request');assert.ok(!JSON.stringify(r.body).includes('987.654321'));assert.ok(!JSON.stringify(r.body).includes('SQL'));}finally{service.cost=original;}
});

test('review HTTP: item form saves associated records; new detail endpoint enforces roles',async()=>{
 const admin=await login('ADMIN');const payload={kind:'purchase',name:'HTTP item',description:'Synthetic',category:'Test',active:true,purchase:{label:'Case',contentQuantity:'175',contentUnit:'each',amount:'42',currency:'USD',supplierId:null}};
 const saved=await request('item/save',{auth:admin,body:payload});assert.equal(saved.status,200);const management=await request('management',{auth:admin});assert.equal(management.status,200);assert.ok(management.body.items.some(i=>i.id===saved.body.id&&i.cost));
 const result=await request('item?id='+saved.body.id,{auth:admin});assert.equal(result.body.cost.completeCost,'42.000000000000');assert.equal(result.body.packages[0].ingredientId,saved.body.id);
 for(const role of ['STAFF','LEAD']){const auth=await login(role),detail=await request('item?id='+saved.body.id,{auth});assert.equal(detail.status,200);const tableView=await request('management',{auth});assert.equal(tableView.status,200);assert.ok(tableView.body.items.every(i=>!Object.hasOwn(i,'cost')&&!Object.hasOwn(i,'purchase')));assert.ok(tableView.body.recipes.every(r=>!Object.hasOwn(r,'cost')));for(const key of ['cost','packages','basis','labor'])assert.equal(detail.body[key],undefined);assert.equal((await request('item/save',{auth,body:payload})).status,403);}
 const forged=await request('item/save',{auth:admin,body:{...payload,actor:{role:'ADMIN'}}});assert.equal(forged.status,400);
});
