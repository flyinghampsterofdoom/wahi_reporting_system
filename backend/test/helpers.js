'use strict';
const {DomainService}=require('../service');
const {MemoryRepository}=require('../repository/memory');
const admin={id:'test-admin',role:'ADMIN'},manager={id:'test-manager',role:'MANAGER'},lead={id:'test-lead',role:'LEAD'},staff={id:'test-staff',role:'STAFF'};
const provenance={kind:'manual',reference:'Synthetic acceptance fixture; not workbook data'};
const early='2026-08-01T00:00:00.000Z';
function fixture(repository=new MemoryRepository()) {
  let tick=0;const clock=()=>new Date(Date.parse('2026-09-18T12:00:00Z')+tick++*1000).toISOString();
  const service=new DomainService(repository,{clock});
  const run=(command,data,actor=admin)=>service.execute(actor,command,{provenance,...data});
  const ingredient=async(name)=> (await run('createIngredient',{name})).id;
  const bought=async(name,amount='3',contentQuantity='1',contentUnit='each')=>{
    const ingredientId=await ingredient(name),option=(await run('createPurchaseOption',{ingredientId,label:'Test package',contentQuantity,contentUnit})).id;
    await run('selectBasis',{ingredientId,kind:'purchase',purchaseOptionId:option,effectiveAt:early});
    await run('addPrice',{purchaseOptionId:option,amount,currency:'USD',effectiveAt:early});
    return {id:ingredientId,option};
  };
  const derived=async(name,sourceIngredientId,sourceQuantity='1',sourceUnit='each',outputQuantity='12',outputUnit='each')=>{
    const id=await ingredient(name);await run('setYield',{ingredientId:id,sourceIngredientId,sourceQuantity,sourceUnit,outputQuantity,outputUnit,effectiveAt:early});return id;
  };
  const recipe=async(name,lines,outputQuantity='1',outputUnit='each')=>{
    const output=await ingredient(name),id=(await run('createRecipe',{name,outputIngredientId:output})).id;
    const revision=await run('reviseRecipe',{recipeId:id,lines,outputQuantity,outputUnit,steps:['Synthetic preparation instruction'],effectiveAt:early});
    return {id,output,revision:revision.id};
  };
  const cost=(ingredientId,quantity='1',unit='each',rest={})=>service.cost(admin,{ingredientId,quantity,unit,...rest});
  return {repository,service,run,ingredient,bought,derived,recipe,cost};
}
module.exports={fixture,admin,manager,lead,staff,provenance,early};
