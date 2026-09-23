'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,admin}=require('./helpers'),{input}=require('./waste-drink-scenario');
const {WasteService}=require('../waste/service'),{createReviewServer}=require('../review/server'),{createUser}=require('../review/auth');
test('HTTP BOH Drink exclusion: catalog/search, direct IDs, Admin BOH View, and authorized history',async()=>{
 const f=fixture(),recipe=await f.recipe('Neutral recipe',[]),item=await f.bought('Neutral purchased item'),allowed=await f.bought('Drink in name only');
 const w=new WasteService(f.repository),history=[];for(const id of [recipe.output,item.id])history.push(await w.log(admin,input(id)));
 const category=await f.run('createRecipeCategory',{name:'Drink'});await f.run('setRecipeCategory',{recipeId:recipe.id,categoryId:category.id});await f.run('updateIngredient',{ingredientId:item.id,name:'Neutral purchased item',category:'Drink',active:true});
 const password='Drink-exclusion-test-only',users=await Promise.all(['ADMIN','MANAGER','BOH'].map(role=>createUser(role.toLowerCase(),role,password))),server=createReviewServer({service:f.service,users});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 async function request(path,auth,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),headers:r.headers};}
 try{for(const role of ['BOH','ADMIN','MANAGER']){
  const login=await request('login',null,{username:role.toLowerCase(),password});assert.equal(login.status,200);const auth={cookie:login.headers.get('set-cookie').split(';')[0]};auth.csrf=(await request('me',auth)).body.csrf;
  const catalog=await request('waste/catalog',auth);assert.equal(catalog.status,200);assert.ok(catalog.body.items.some(i=>i.id===allowed.id));
  // Execute the real UI search against the authenticated server catalog.
  if(role!=='MANAGER'){
   const vm=require('node:vm'),nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:'',focus(){}});return nodes.get(id);};
   const context=vm.createContext({$:node,esc:x=>String(x),document:{querySelectorAll:()=>[]},me:{role},can:()=>false});
   vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'../review/public/waste-ui.js'),'utf8'),context);
   vm.runInContext('wasteCatalog='+JSON.stringify(catalog.body)+";operationalPreview='BOH';wasteLanding();",context);
   assert.ok(!node('main').innerHTML.includes('Neutral'));vm.runInContext('wasteSearch()',context);
   node('waste-search').value='Neutral';node('waste-search').oninput();assert.match(node('waste-results').innerHTML,/No matching items/);
   node('waste-search').value='Drink';node('waste-search').oninput();assert.match(node('waste-results').innerHTML,/Drink in name only/);
  }
  for(const id of [recipe.output,item.id]){for(const list of ['items','common'])assert.ok(!catalog.body[list].some(i=>i.id===id));const rejected=await request('waste/events',auth,{...input(id)});assert.equal(rejected.status,400);assert.equal(rejected.body.code,'boh_category_excluded');assert.equal(rejected.body.error,'Drink-category items are not available for BOH waste entry.');}
  assert.equal((await request('waste/events',auth,input(allowed.id))).status,200);
  for(const e of history){const report=await request('waste/history?ingredientId='+e.ingredientId,auth);assert.equal(report.status,role==='BOH'?403:200);if(role!=='BOH'){assert.equal(report.body.total,1);}}
 }}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
