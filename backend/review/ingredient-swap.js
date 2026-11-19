"use strict";
const {z}=require('zod');
const {createHash}=require('node:crypto');
const {DomainService}=require('../service');
const {enableResolutionCache}=require('../domain/resolution-context');
const {MemoryRepository}=require('../repository/memory');
const {authorize}=require('../auth');
const {latest}=require('../domain/history');
const {activeMeasurements,unit}=require('../domain/measurements');
const {costIngredient}=require('../domain/costing');
const {Exact:E}=require('../domain/exact');
const id=z.string().uuid(),decimal=z.string().max(100).refine(v=>{try{return E.of(v).nonnegative();}catch{return false;}}),positive=decimal.refine(v=>E.of(v).positive());
const measure=z.string().refine(v=>{try{unit(v);return true;}catch{return false;}});
const measurement=z.object({fromQuantity:positive,fromUnit:measure,toQuantity:positive,toUnit:measure}).strict();
const request=z.object({originalId:id,expectedState:z.string().regex(/^[a-f0-9]{64}$/),replacement:z.object({ingredientId:id.optional(),name:z.string().trim().min(1).max(500).optional(),allergens:z.array(z.enum(['Milk','Eggs','Fish','Shellfish','Tree Nuts','Peanuts','Wheat','Soy'])).max(8).optional(),purchase:z.object({amount:decimal,contentQuantity:positive,contentUnit:measure}).strict(),measurementMode:z.enum(['inherit','new']),measurements:z.array(measurement).max(100).default([])}).strict(),recipes:z.array(z.object({recipeId:id,expectedRevisionId:id,selected:z.boolean(),lines:z.array(z.object({lineId:id,quantity:decimal.nullable()}).strict()).max(1000)}).strict()).max(1000),confirmed:z.literal(true).optional()}).strict();
function fail(code,message){throw Object.assign(new Error(message),{code});}
function canonical(value){if(Array.isArray(value))return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function token(state,at){const streams={bases:'ingredientId',yields:'ingredientId',measurements:'measurementKey',recipeRevisions:'recipeId',prices:'purchaseOptionId',labor:'componentKey',laborRates:'department',sellingPrices:'menuItemId',menuMappings:'menuItemId'};const effective=at?Object.fromEntries(Object.entries(streams).map(([name,key])=>[name,[...new Set(state[name].map(r=>r[key]))].map(value=>latest(state[name].filter(r=>r[key]===value),at,at)?.id||null)])):null;const fields=['ingredients','recipes','purchaseOptions','bases','yields','measurements','recipeRevisions','prices','labor','laborRates','menuItems','sellingPrices','menuMappings'];return createHash('sha256').update(JSON.stringify(canonical({state:Object.fromEntries(fields.map(k=>[k,state[k]])),effective}))).digest('hex');}
function affected(state,originalId,at){return state.recipes.filter(r=>r.active).map(recipe=>({recipe,revision:latest(state.recipeRevisions.filter(r=>r.recipeId===recipe.id),at,at)})).filter(r=>r.revision?.lines.some(l=>l.ingredientId===originalId));}
function configuration(state,ingredientId,at){const ingredient=state.ingredients.find(i=>i.id===ingredientId&&i.active);if(!ingredient)fail('not_found','Ingredient unavailable');const b=latest(state.bases.filter(b=>b.ingredientId===ingredientId),at,at),p=state.purchaseOptions.find(p=>p.id===b?.purchaseOptionId),price=p?latest(state.prices.filter(x=>x.purchaseOptionId===p.id),at,at):null;return {id:ingredient.id,name:ingredient.name,allergens:ingredient.allergens||[],purchase:p?{contentQuantity:p.contentQuantity,contentUnit:p.contentUnit,amount:price?.currency==='USD'?price.amount:null}:null,measurements:activeMeasurements(state,ingredientId,at,at).map(({fromQuantity,fromUnit,toQuantity,toUnit})=>({fromQuantity,fromUnit,toQuantity,toUnit}))};}
function metrics(state,recipe,revision,at){
 const cost=(quantity,unit)=>{const c=costIngredient(state,{ingredientId:recipe.outputIngredientId,quantity,unit,at,knownAt:at,currency:'USD'});return {cost:c.completeCost?.decimal()??null,blockers:[...new Set(c.blockers.map(b=>b.reason))]};};
 const batch=cost(revision.outputQuantity||'1',revision.outputUnit||'each');
 const menus=state.menuItems.filter(m=>m.active).flatMap(m=>{const map=latest(state.menuMappings.filter(x=>x.menuItemId===m.id),at,at);if(map?.recipeId!==recipe.id)return [];const price=latest(state.sellingPrices.filter(x=>x.menuItemId===m.id),at,at),c=cost(map.quantity,map.unit),selling=price?.currency==='USD'?price.amount:null,percent=selling!==null&&E.of(selling).positive()&&c.cost!==null?E.of(c.cost).div(selling).mul('100'):null;return [{menuId:m.id,name:m.name,recipeCost:c.cost,sellingPrice:selling,foodCostPercent:percent?.decimal(4)??null,grossMarginPercent:percent?E.of('100').sub(percent).decimal(4):null,blockers:c.blockers}];});
 return {recipeCost:batch.cost,blockers:batch.blockers,menus};
}
async function context(service,actor,{originalId,replacementId}={}){
 authorize(actor,'internal_cost.write');if(originalId)id.parse(originalId);if(replacementId)id.parse(replacementId);
 const state=await service.repository.read(),at=service.clock(),ingredients=state.ingredients.filter(i=>i.active).map(({id,name})=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name));
 if(!originalId)return {ingredients};
 return {ingredients,expectedState:token(state,at),original:configuration(state,originalId,at),replacement:replacementId?configuration(state,replacementId,at):null,recipes:affected(state,originalId,at).map(({recipe,revision})=>({recipeId:recipe.id,name:recipe.name,expectedRevisionId:revision.id,selected:true,lines:revision.lines.filter(l=>l.ingredientId===originalId).map(l=>({lineId:l.id,quantity:l.quantity,unit:l.unit})),current:metrics(state,recipe,revision,at)}))};
}
async function simulate(state,actor,data,at){
 if(token(state,at)!==data.expectedState)fail('swap_stale','Recipes, prices or measurements changed. Reload the comparison before applying.');
 const original=configuration(state,data.originalId,at),rows=affected(state,data.originalId,at),input=new Map(data.recipes.map(r=>[r.recipeId,r]));
 if(input.size!==data.recipes.length||input.size!==rows.length||rows.some(r=>!input.has(r.recipe.id)))fail('swap_stale','The affected recipe list changed. Reload the comparison.');
 for(const {recipe,revision} of rows){const r=input.get(recipe.id),lines=revision.lines.filter(l=>l.ingredientId===data.originalId);if(r.expectedRevisionId!==revision.id||r.lines.length!==lines.length||new Set(r.lines.map(l=>l.lineId)).size!==lines.length||r.lines.some(l=>!lines.some(x=>x.id===l.lineId)))fail('swap_stale','Recipe ingredients changed. Reload the comparison.');}
 const repo=new MemoryRepository(state),service=new DomainService(repo,{clock:()=>at}),provenance={kind:'manual',reference:'Confirmed Ingredient Swap'};
 const run=async(command,values)=>{const s=await repo.read();const streams={reviseRecipe:['recipeRevisions','recipeId'],selectBasis:['bases','ingredientId'],addMeasurement:['measurements','measurementKey']},scope=streams[command];if(scope){const same=s[scope[0]].find(x=>x[scope[1]]===values[scope[1]]&&x.effectiveAt===at&&!s[scope[0]].some(y=>y.supersedesId===x.id));if(same)values={...values,supersedesId:same.id};}return service.execute(actor,command,{provenance,...values,effectiveAt:at});};
 const d=data.replacement;
 if(Boolean(d.ingredientId)===Boolean(d.name))fail('invalid_request','Choose an existing replacement or name a new ingredient.');
 if(d.ingredientId===data.originalId)fail('invalid_request','Choose a different replacement ingredient.');
 let replacementId=d.ingredientId;
 if(replacementId)configuration(state,replacementId,at);
 else replacementId=(await service.execute(actor,'createIngredient',{provenance,name:d.name,allergens:d.allergens||[]})).id;
 const existingUsers=replacementId?[...require('./recipe-workflow').dependents(state,replacementId,at),...state.recipes.filter(r=>r.outputIngredientId===replacementId)].filter(r=>r.active&&!input.get(r.id)?.selected).map(r=>({id:r.id,name:r.name})):[];
 if(rows.some(({recipe})=>input.get(recipe.id).selected&&recipe.outputIngredientId===replacementId))fail('cycle','A recipe cannot replace an ingredient with its own output.');
 const packageResult=await service.execute(actor,'createPurchaseOption',{provenance,ingredientId:replacementId,label:'Ingredient Swap package',contentQuantity:d.purchase.contentQuantity,contentUnit:d.purchase.contentUnit});
 await run('addPrice',{purchaseOptionId:packageResult.id,amount:d.purchase.amount,currency:'USD'});
 await run('selectBasis',{ingredientId:replacementId,kind:'purchase',purchaseOptionId:packageResult.id});
 const desired=d.measurementMode==='inherit'?original.measurements:d.measurements;
 const existing=activeMeasurements(state,replacementId,at,at);
 for(const m of existing)await run('addMeasurement',{ingredientId:replacementId,measurementKey:m.measurementKey,fromQuantity:m.fromQuantity,fromUnit:m.fromUnit,toQuantity:m.toQuantity,toUnit:m.toUnit,active:false});
 for(const m of desired)await run('addMeasurement',{ingredientId:replacementId,...m});
 const changes=[];
 for(const {recipe,revision} of rows){const inputRow=input.get(recipe.id);if(!inputRow.selected)continue;const quantities=new Map(inputRow.lines.map(l=>[l.lineId,l.quantity]));const result=await run('reviseRecipe',{recipeId:recipe.id,outputQuantity:revision.outputQuantity,outputUnit:revision.outputUnit,lines:revision.lines.map(l=>({ingredientId:l.ingredientId===data.originalId?replacementId:l.ingredientId,quantity:l.ingredientId===data.originalId?quantities.get(l.id):l.quantity,unit:l.unit,...(l.notes?{notes:l.notes}:{})})),steps:revision.steps.map(s=>s.instruction)});changes.push({recipeId:recipe.id,revisionId:result.id});}
 const selectedState=await repo.read(),currentCostState=enableResolutionCache(structuredClone(state));
 enableResolutionCache(selectedState);
 // Every visible recipe keeps its own hypothetical, even when excluded. Its
 // hypothetical uses the selected swap graph but is never included in commit.
 const comparisons=[];
 for(const {recipe,revision} of rows){const r=input.get(recipe.id),hypothetical=r.selected?selectedState:structuredClone(selectedState);if(!r.selected){const current=latest(hypothetical.recipeRevisions.filter(v=>v.recipeId===recipe.id),at,at);current.lines=current.lines.map(l=>{const requested=r.lines.find(x=>x.lineId===l.id);return requested?{...l,ingredientId:replacementId,quantity:requested.quantity}:l;});}
 if(!r.selected)enableResolutionCache(hypothetical);
 const next=latest(hypothetical.recipeRevisions.filter(v=>v.recipeId===recipe.id),at,at);comparisons.push({recipeId:recipe.id,selected:r.selected,current:metrics(currentCostState,recipe,revision,at),hypothetical:metrics(hypothetical,recipe,next,at)});}
 return {state:selectedState,replacementId,changes,comparisons,otherReplacementRecipes:existingUsers};
}
async function preview(service,actor,input){authorize(actor,'internal_cost.write');const data=request.parse(input),state=await service.repository.read(),result=await simulate(state,actor,data,service.clock());return {comparisons:result.comparisons,otherReplacementRecipes:result.otherReplacementRecipes};}
async function apply(service,actor,input){authorize(actor,'internal_cost.write');const data=request.parse(input);if(!data.confirmed)fail('swap_confirmation_required','Confirm the ingredient swap before applying.');if(!data.recipes.some(r=>r.selected))fail('invalid_request','Select at least one recipe.');return service.repository.transaction(async state=>{const result=await simulate(state,actor,data,service.clock());Object.assign(state,result.state);return {replacementId:result.replacementId,updatedRecipes:result.changes};});}
module.exports={context,preview,apply,request,token};
