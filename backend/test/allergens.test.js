'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,admin,staff,early}=require('./helpers');
const {BIG_8,resolver}=require('../domain/allergens');
const at='2026-12-01T00:00:00.000Z';
const set=async(f,id,allergens,rest={},actor=admin)=>f.run('updateIngredient',{ingredientId:id,name:'Allergen test ingredient',active:true,allergens,...rest},actor);

test('Big 8 declarations normalize duplicates, preserve generic tags and reject unknown allergens',async()=>{
 const f=fixture(),id=(await f.run('createIngredient',{name:'Declared ingredient',tags:['source:workbook'],allergens:['Soy','Milk','Soy']})).id;
 let item=await f.service.ingredient(staff,id);assert.deepEqual(item.allergens,['Milk','Soy']);assert.deepEqual(item.tags,['source:workbook']);
 await f.run('updateIngredient',{ingredientId:id,name:'Renamed ingredient',tags:['source:workbook'],active:true});
 item=await f.service.ingredient(staff,id);assert.deepEqual(item.allergens,['Milk','Soy']);
 for(const allergens of [['Sesame'],['milk'],[1],Array(9).fill('Milk')])await assert.rejects(set(f,id,allergens),e=>e.name==='ZodError');
 await assert.rejects(set(f,id,['Milk'],{},staff));
 await set(f,id,[]);assert.deepEqual((await f.service.ingredient(staff,id)).allergens,[]);
 assert.deepEqual(BIG_8,['Milk','Eggs','Fish','Shellfish','Tree Nuts','Peanuts','Wheat','Soy']);
});

test('Nested recipes and source yields inherit unique allergens and update on the next read without changing costs/history',async()=>{
 const f=fixture(),milk=await f.bought('Milk base','4'),eggs=await f.bought('Egg base','2');
 await set(f,milk.id,['Milk']);await set(f,eggs.id,['Eggs']);
 const source=await f.derived('Source milk',milk.id),nested=await f.recipe('Nested mix',[{ingredientId:source,quantity:'1',unit:'each'},{ingredientId:eggs.id,quantity:'1',unit:'each'}]),finished=await f.recipe('Finished dish',[{ingredientId:nested.output,quantity:'1',unit:'each'},{ingredientId:milk.id,quantity:'1',unit:'each'}]);
 const prior=await f.repository.read(),cost=(await f.cost(finished.output)).completeCost;
 assert.deepEqual((await f.service.recipe(staff,finished.id)).inheritedAllergens,['Milk','Eggs']);
 assert.deepEqual((await f.service.ingredient(staff,finished.output)).inheritedAllergens,['Milk','Eggs']);
 await set(f,milk.id,['Soy']);
 assert.deepEqual((await f.service.recipe(staff,finished.id)).inheritedAllergens,['Eggs','Soy']);
 assert.equal((await f.cost(finished.output)).completeCost,cost);
 const current=await f.repository.read();assert.deepEqual(current.recipeRevisions,prior.recipeRevisions);assert.deepEqual(current.prices,prior.prices);assert.deepEqual(current.yields,prior.yields);
 await set(f,milk.id,[]);await set(f,eggs.id,[]);assert.deepEqual(resolver(await f.repository.read(),{at}).recipe(finished.id),[]);
});

test('Item editor saves declarations with audit and exposes inherited tags through current views and menu items',async()=>{
 const f=fixture(),milk=await f.bought('Editor milk');
 const {saveItem,itemRecord}=require('../review/items');
 await saveItem(f.service,admin,{id:milk.id,kind:'purchase',name:'Editor milk',description:'',category:'',active:true,allergens:['Milk','Milk']});
 const r=await f.recipe('Editor finished',[{ingredientId:milk.id,quantity:'1',unit:'each'}]);
 assert.deepEqual((await itemRecord(f.service,staff,r.output)).inheritedAllergens,['Milk']);
 const view=await require('../review/views').view(f.service,staff,'recipes');assert.deepEqual(view.recipes.find(x=>x.id===r.id).inheritedAllergens,['Milk']);
 const menu=(await f.run('createMenuItem',{name:'Menu finished'})).id;
 await f.run('setMenuMapping',{menuItemId:menu,recipeId:r.id,quantity:'1',unit:'each',effectiveAt:early});
 const operational=await f.service.menu(staff,menu);assert.deepEqual(operational.inheritedAllergens,['Milk']);assert.ok(!('internalCost' in operational));
 const state=await f.repository.read();assert.ok(state.audit.some(e=>e.entityId===milk.id&&e.next.allergens?.includes('Milk')));
});

test('Published service documents resolve current ingredient allergens while retaining immutable saved documents and cost secrecy',async()=>{
 const {start,document}=require('../recipe-book/test-support/fixture'),{PostgresRepository}=require('../repository/postgres');
 const pg=await start({empty:true});
 try{
  const f=fixture(new PostgresRepository(pg.pool)),milk=await f.bought('PG allergen cream');await set(f,milk.id,['Milk','Soy']);
  const prepared=await f.recipe('PG allergen prepared',[{ingredientId:milk.id,quantity:'1',unit:'each'}]);
  const d=document('PG allergen service');d.components[0].ingredients[0].ingredientId=prepared.output;
  let e=await pg.book.create(pg.admin,{document:d,menuStatus:'on_menu'});e=await pg.book.publish(pg.admin,{id:e.id,expectedVersion:e.version,confirmed:true});
  const station={id:pg.users['well.one'].id,role:'RECIPE_ONLY'},saved=(await pg.book.history(pg.admin,e.id)).versions[0].document;
  let result=(await pg.book.published(station))[0];assert.deepEqual(result.document.allergens,['Milk','Soy']);assert.equal(result.document.components[0].ingredients[0].ingredientId,undefined);assert.ok(!JSON.stringify(result).includes('internalCost'));
  const scoped=await f.repository.readCurrent({at,itemId:prepared.output});assert.deepEqual(scoped.ingredients.find(i=>i.id===milk.id).allergens,['Milk','Soy']);
  await set(f,milk.id,['Eggs']);result=(await pg.book.published(station))[0];assert.deepEqual(result.document.allergens,['Eggs']);
  assert.deepEqual((await pg.book.draft(pg.admin,e.id)).allergens,['Eggs']);
  assert.deepEqual((await pg.book.history(pg.admin,e.id)).versions[0].document,saved);
  const options=await pg.book.ingredients(pg.admin,'PG allergen prepared');assert.deepEqual(options[0].inheritedAllergens,['Eggs']);
  for(const invalid of [['Sesame'],['Milk','Milk'],'Milk',null])await assert.rejects(pg.pool.query('UPDATE wahi_v2.ingredients SET allergens=$1::jsonb WHERE id=$2',[JSON.stringify(invalid),milk.id]),e=>e.code==='23514');
  const reopened=new PostgresRepository(pg.pool);assert.deepEqual((await reopened.read()).ingredients.find(i=>i.id===milk.id).allergens,['Eggs']);
 }finally{await pg.close();}
});
