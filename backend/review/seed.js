'use strict';
async function seed(service){
  if((await service.repository.read()).ingredients.length)throw new Error('Refusing to seed a nonempty review database');
  const actor={id:'review-seed',role:'ADMIN'},provenance={kind:'other',reference:'Synthetic owner-review fixture. Not migrated Wahi data.'};
  const early='2020-01-01T00:00:00.000Z';
  const run=(command,input)=>service.execute(actor,command,{provenance,...input});
  const inv=(command,input)=>service.inventory.execute(actor,command,input);
  const ingredient=async(name)=>(await run('createIngredient',{name:'Demo '+name,description:'Synthetic review data; not migrated from Wahi.'})).id;
  const bought=async(name,amount,contentQuantity,contentUnit)=>{const id=await ingredient(name),option=(await run('createPurchaseOption',{ingredientId:id,label:'Demo package',contentQuantity,contentUnit})).id;await run('selectBasis',{ingredientId:id,kind:'purchase',purchaseOptionId:option,effectiveAt:early});await run('addPrice',{purchaseOptionId:option,amount,currency:'USD',effectiveAt:early});return id;};
  const rum=await bought('White Rum','18','750','mL'),lime=await bought('Lime','1','1','each'),pineapple=await bought('Pineapple','3','1','each'),ginger=await bought('Ginger','5','1','lb'),water=await bought('Water','0','1','mL'),dash=await ingredient('Pineapple Garnish');
  await run('setYield',{ingredientId:dash,sourceIngredientId:pineapple,effectiveAt:early});
  await run('addMeasurement',{ingredientId:rum,fromQuantity:'1',fromUnit:'op:bottle',toQuantity:'750',toUnit:'mL',effectiveAt:early});
  const drink=await ingredient('Cocktail'),recipe=(await run('createRecipe',{name:'Demo Cocktail',outputIngredientId:drink})).id;
  await run('reviseRecipe',{recipeId:recipe,outputQuantity:'1',outputUnit:'each',lines:[{ingredientId:rum,quantity:'1.5',unit:'fl_oz_us'},{ingredientId:dash,quantity:'1',unit:'each'}],steps:['Synthetic preparation instruction for owner review.'],effectiveAt:early});
  const menu=(await run('createMenuItem',{name:'Demo Cocktail'})).id;await run('setSellingPrice',{menuItemId:menu,amount:'16',currency:'USD',effectiveAt:early});await run('setMenuMapping',{menuItemId:menu,recipeId:recipe,quantity:'1',unit:'each',effectiveAt:early});
  const fronds=await ingredient('Allocated Labor');await run('selectBasis',{ingredientId:fronds,kind:'labor_only',effectiveAt:early});await run('setLabor',{ingredientId:fronds,kind:'fixed',amount:'25',currency:'USD',outputQuantity:'180',outputUnit:'each',effectiveAt:early});
  for(const [ingredientId,baseUnit]of [[rum,'op:bottle'],[lime,'each'],[dash,'each'],[ginger,'g']])await inv('configureItem',{ingredientId,baseUnit});
  const locations=[];
  for(const [name,area]of [['Bar','FOH'],['Back Closet','FOH'],['Liquor Cage','FOH'],['Walk-In','BOH']])locations.push((await inv('createLocation',{name:'Demo '+name,area,sortOrder:locations.length})).id);
  for(const locationId of locations.slice(0,3))await inv('assignItem',{ingredientId:rum,locationId,countUnit:'op:bottle'});
  await inv('assignItem',{ingredientId:lime,locationId:locations[0],countUnit:'each',sortOrder:1});await inv('assignItem',{ingredientId:dash,locationId:locations[0],countUnit:'each',sortOrder:2});await inv('assignItem',{ingredientId:ginger,locationId:locations[3],countUnit:'cup_us'});
  for(const [index,quantity,days]of [[0,'3.4',1],[1,'6',3],[2,'12',7],[3,'1.75',2]]){
    const observedAt=new Date(Date.now()-days*86400000).toISOString();const session=(await inv('startCount',{locationId:locations[index],observedAt,notes:'Synthetic historical review count'})).id;
    const o=await inv('enterCount',{sessionId:session,ingredientId:index===3?ginger:rum,quantity,unit:index===3?'cup_us':'op:bottle',expectedRevisionId:null});
    await inv('submitCount',{sessionId:session,expectedVersion:1,expectedObservationIds:[o.id]});
  }
}
module.exports={seed};
