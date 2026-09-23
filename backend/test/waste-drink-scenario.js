'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {WasteService}=require('../waste/service');
const {admin,manager}=require('./helpers');
const input=id=>({requestId:randomUUID(),ingredientId:id,quantity:'1',unit:'each',reason:'Other'});
// Runs unchanged against memory and PostgreSQL, including a previously cached week.
async function scenario(f){
 const purchased=await f.bought('Ordinary output'),prepared=await f.recipe('No beverage keyword',[]),allowed=await f.bought('Drink cocktail lemonade — name is irrelevant');
 const drink=await f.run('createRecipeCategory',{name:'Drink'}),food=await f.run('createRecipeCategory',{name:'Food'});
 let now='2026-09-20T12:00:00.000Z';const w=new WasteService(f.repository,{clock:()=>now,context:{locationId:randomUUID()}}),boh={id:randomUUID(),role:'BOH'};
 const prior=[];for(let n=0;n<6;n++)prior.push(await w.log(boh,input(prepared.output)));
 prior.push(await w.log(boh,input(purchased.id)));
 now='2026-09-23T12:00:00.000Z';assert.equal((await w.catalog(boh)).common[0].id,prepared.output);
 await f.run('updateIngredient',{ingredientId:purchased.id,name:'Ordinary output',category:'Drink',active:true});
 await f.run('setRecipeCategory',{recipeId:prepared.id,categoryId:drink.id,effectiveAt:'2026-09-22T00:00:00.000Z'});
 // Future recategorization cannot prematurely allow entry; archived categories retain assignments.
 await f.run('setRecipeCategory',{recipeId:prepared.id,categoryId:food.id,effectiveAt:'2026-10-05T00:00:00.000Z'});
 await f.run('updateRecipeCategory',{categoryId:drink.id,name:'Drink',sortOrder:0,active:false});
 const before=await f.repository.read();
 for(const actor of [boh,admin,manager]){
  const c=await w.catalog(actor);for(const id of [purchased.id,prepared.output]){assert.ok(!c.items.some(i=>i.id===id));assert.ok(!c.common.some(i=>i.id===id));await assert.rejects(w.log(actor,input(id)),{code:'boh_category_excluded'});}
  assert.ok(c.items.some(i=>i.id===allowed.id));
 }
 await assert.rejects(w.log(admin,{...input(prepared.output)}),{code:'boh_category_excluded'});
 const after=await f.repository.read();assert.deepEqual(after.wasteEvents,before.wasteEvents);assert.deepEqual(after.ingredients,before.ingredients);assert.deepEqual(after.recipes,before.recipes);
 await w.log(boh,input(allowed.id));await w.log(admin,{...input(allowed.id)});
 for(const actor of [admin,manager])for(const id of [prepared.output,purchased.id]){
  assert.equal((await w.history(actor,{ingredientId:id})).total,id===prepared.output?6:1);
 }
 // Next week uses historical frequency too, but Drink remains excluded.
 now='2026-09-28T12:00:00.000Z';const c=await w.catalog(boh);for(const id of [purchased.id,prepared.output])assert.ok(!c.common.some(i=>i.id===id));
 now='2026-10-05T12:00:00.000Z';assert.ok((await w.catalog(boh)).items.some(i=>i.id===prepared.output));
 await w.log(boh,input(prepared.output));
 return {purchased,prepared,allowed};
}
module.exports={scenario,input};
