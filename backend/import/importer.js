'use strict';
const crypto=require('node:crypto');
const {DomainService}=require('../service');
const {MemoryRepository}=require('../repository/memory');
const {Exact:E}=require('../domain/exact');
const {costIngredient}=require('../domain/costing');
const {costView}=require('../auth');
const units={oz:'fl_oz_us',cup:'cup_us',qt:'quart_us',gal:'gallon_us',tbsp:'tbsp_us',tsp:'tsp_us',g:'g',kg:'kg',lb:'lb',ea:'each',drop:'drop',splash:'splash'};
const actor={id:'wahi-workbook-import',role:'ADMIN'};
function key(s){return String(s??'').trim().toLowerCase();}
function decimal(s){
 if(typeof s!=='string'||!/^\+?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s))throw new Error('Missing or malformed nonnegative number');
 const [mant,exp='0']=s.replace(/^\+/,'').toLowerCase().split('e'),[a,b='']=mant.split('.');const e=Number(exp);if(!Number.isSafeInteger(e)||Math.abs(e)>50)throw new Error('Exponent out of range');
 const digits=a+b,point=a.length+e;let out=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
 out=out.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');E.of(out);return out;
}
// Owner-approved normalization of this observed Excel package-size artifact only.
function packageQuantity(s){return s==='33.799999999999997'?'33.8':decimal(s);}
function mappedUnit(s){const u=units[key(s)];if(!u)throw new Error('Unknown unit: '+s);return u;}
function parse(workbook){return workbook.sheets.flatMap(sheet=>{if(!sheet.rows.length)return [];const header=sheet.rows[0],headers=Object.fromEntries(Object.entries(header.cells).map(([a,c])=>[a.replace(/\d/g,''),c.value]));return sheet.rows.slice(sheet.name==='Read Me'?0:1).map(r=>({sheet:sheet.name,row:r.row,values:Object.fromEntries(Object.entries(r.cells).map(([a,c])=>[headers[a.replace(/\d/g,'')]||a,c.value])),cells:r.cells,classification:'TRANSFORMED',issues:[],entityIds:[]}));});}
function stableIds(state,hash){const map=new Map();let n=0;const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;function visit(v){if(typeof v==='string'&&uuid.test(v)){if(!map.has(v)){let h=crypto.createHash('sha256').update(hash+':'+n++).digest('hex').slice(0,32);map.set(v,h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20));}return map.get(v);}if(Array.isArray(v))return v.map(visit);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));return v;}return visit(state);}
async function build(workbook,{activationAt='2026-09-18T00:00:00.000Z',progress=()=>{}}={}){
 const repo=new MemoryRepository(),service=new DomainService(repo,{clock:()=>activationAt}),records=parse(workbook),bySheet=n=>records.filter(r=>r.sheet===n),ids=new Map(),definitions=new Map(),recipes=new Map(),suppliers=new Map(),categories=new Map(),locations=new Map();
 const issue=(r,reason,concept,owner=true,classification='SOURCE DATA ISSUE')=>{r.classification=classification;r.issues.push({reason,concept,ownerRequired:owner});};
 async function run(r,c,d){const result=await service.execute(actor,c,{...d,provenance:{kind:'historical_workbook',reference:workbook.file+'#'+r.sheet+'!row='+r.row},note:d.note??'Workbook snapshot adopted for initial local review at import activation; original business-effective date unknown.'});r.entityIds.push(result.id);return result.id;}
 async function attempt(r,fn){try{await fn();}catch(e){issue(r,e.message,'Import validation');}}
 for(const [sheet,col] of [['Ingredients','IngredientName'],['Yields','ProductName'],['Recipe Catalog','RecipeName']])for(const r of bySheet(sheet)){const name=r.values[col];if(!name){issue(r,'Missing record name','Identity');continue;}const k=key(name);if(!definitions.has(k))definitions.set(k,[]);definitions.get(k).push(r);}
 for(const [k,rows]of definitions){if(rows.length>1){rows.forEach(r=>issue(r,'Ambiguous normalized identity; no record selected','Identity'));continue;}const r=rows[0],name=r.values.IngredientName||r.values.ProductName||r.values.RecipeName;await attempt(r,async()=>{const tags=['source:workbook'];if(['Final','Drink'].includes(r.values.RecipeType))tags.push('recipe-output:finished');ids.set(k,await run(r,'createIngredient',{name,description:'',tags}));});}
 // Referenced names absent from all authoritative definitions remain explicit incomplete identities.
 const refs=[...bySheet('RecipeLines').map(r=>[r,r.values.IngredientName]),...bySheet('Densities').map(r=>[r,r.values.IngredientName]),...bySheet('Yields').map(r=>[r,r.values.SourceIngredient])];
 for(const [r,name]of refs){const k=key(name);if(!k)continue;if(!ids.has(k)&&!definitions.has(k)){ids.set(k,await run(r,'createIngredient',{name,description:'Source references this item but its purchasing/yield definition is incomplete.',tags:['source:incomplete']}));issue(r,'Referenced item has no purchasing/yield/recipe definition: '+name,'Item identity');}else if(definitions.get(k)?.length>1)issue(r,'Reference matches multiple source identities: '+name,'Item identity');}
 progress('Identities parsed');
 for(const r of bySheet('Ingredients'))await attempt(r,async()=>{const v=r.values,id=ids.get(key(v.IngredientName));if(!id)return;
  if(v.Vendor&&!suppliers.has(v.Vendor))suppliers.set(v.Vendor,await run(r,'createSupplier',{name:v.Vendor}));
  if(v.Location&&!locations.has(v.Location)){const result=await service.inventory.execute(actor,'createLocation',{name:v.Location,sortOrder:locations.size});locations.set(v.Location,result.id);r.entityIds.push(result.id);}
  if(v.Location)issue(r,'Storage location preserved; inventory count unit is not supplied. Configure before counting.','Inventory configuration');
  if(v.IngredientName==='Pineapple Fronds (Labor)'){await run(r,'selectBasis',{ingredientId:id,kind:'labor_only'});await run(r,'setLabor',{ingredientId:id,kind:'fixed',amount:decimal(v.BuyPrice),currency:'USD',outputQuantity:decimal(v.Size),outputUnit:mappedUnit(v.PurchaseUnit)});return;}
  if(v.Size===undefined||v.Size===null||v.Size===''){issue(r,'Missing package contents; source purchase price retained as evidence, no valid package/price asserted.','Purchasing');return;}
  const quantity=packageQuantity(v.Size);if(v.Size==='33.799999999999997')r.issues.push({reason:'Owner-approved package-size rounding: 33.799999999999997 → 33.8; raw source retained.',concept:'Deterministic quantity normalization',ownerRequired:false});if(!E.of(quantity).positive())throw new Error('Package contents must be positive');
  const option=await run(r,'createPurchaseOption',{ingredientId:id,supplierId:suppliers.get(v.Vendor)||null,sku:v.SKU||'',label:v.PurchaseName||(v.Size==='33.799999999999997'?quantity:v.Size)+' '+v.PurchaseUnit,contentQuantity:quantity,contentUnit:mappedUnit(v.PurchaseUnit)});
  await run(r,'selectBasis',{ingredientId:id,kind:'purchase',purchaseOptionId:option});
  if(v.BuyPrice===null||v.BuyPrice===undefined)issue(r,'Missing purchase price','Purchasing');else await run(r,'addPrice',{purchaseOptionId:option,amount:decimal(v.BuyPrice),currency:'USD'});
 });
 progress('Purchasing imported');
 for(const r of bySheet('Yields'))await attempt(r,async()=>{const v=r.values;await run(r,'setYield',{ingredientId:ids.get(key(v.ProductName)),sourceIngredientId:ids.get(key(v.SourceIngredient)),sourceQuantity:'1',sourceUnit:mappedUnit(v.PurchaseUnit),outputQuantity:v.YieldValue?decimal(v.YieldValue):null,outputUnit:mappedUnit(v.YieldUnit)});if(v.Notes&&/check/i.test(v.Notes))issue(r,'Source asks for verification: '+v.Notes,'Yield verification');});
 for(const r of bySheet('Densities'))await attempt(r,async()=>{await run(r,'addMeasurement',{ingredientId:ids.get(key(r.values.IngredientName)),fromQuantity:'1',fromUnit:'cup_us',toQuantity:decimal(r.values.GramsPerCup),toUnit:'g'});});
 // Explicit prior owner clarification: this is pineapple-derived, but its yield is unknown.
 const dash=bySheet('RecipeLines').find(r=>r.values.IngredientName==='Pineapple, Dash');if(dash&&ids.has(key('Pineapple')))await run(dash,'setYield',{ingredientId:ids.get(key('Pineapple, Dash')),sourceIngredientId:ids.get(key('Pineapple')),sourceQuantity:null,sourceUnit:null,outputQuantity:null,outputUnit:null});
 for(const r of bySheet('Recipe Catalog'))await attempt(r,async()=>{const v=r.values,id=ids.get(key(v.RecipeName));if(!id)return;const rid=await run(r,'createRecipe',{name:v.RecipeName,outputIngredientId:id});recipes.set(key(v.RecipeName),rid);if(v.RecipeType){if(!categories.has(v.RecipeType))categories.set(v.RecipeType,await run(r,'createRecipeCategory',{name:v.RecipeType,sortOrder:categories.size}));await run(r,'setRecipeCategory',{recipeId:rid,categoryId:categories.get(v.RecipeType)});}});
 const lineGroups=new Map();for(const r of bySheet('RecipeLines')){const k=key(r.values.RecipeName);if(!lineGroups.has(k))lineGroups.set(k,[]);lineGroups.get(k).push(r);}
 for(const r of bySheet('Recipe Catalog'))await attempt(r,async()=>{const v=r.values,rid=recipes.get(key(v.RecipeName));if(!rid)return;const sourceLines=lineGroups.get(key(v.RecipeName))||[],lines=[];
  for(const l of sourceLines){const x=l.values,id=ids.get(key(x.IngredientName));if(!id)throw new Error('Ambiguous or missing component: '+x.IngredientName);let quantity=null,unit=null;try{quantity=decimal(x.Qty);}catch{issue(l,'Missing/malformed recipe quantity preserved unresolved','Recipe quantity');}try{unit=mappedUnit(x.Unit);}catch{issue(l,'Unknown recipe unit preserved unresolved','Recipe unit');}lines.push({ingredientId:id,quantity,unit,notes:x.Notes||''});l.entityIds.push(id,rid);
   const original=(definitions.get(key(x.IngredientName))||[])[0];if(original){const name=original.values.IngredientName||original.values.ProductName||original.values.RecipeName;if(name!==x.IngredientName)l.issues.push({reason:'Workbook LOWER/TRIM exact lookup resolves case/whitespace variant to '+name,concept:'Deterministic identity transformation',ownerRequired:false});}
   
  }
  await run(r,'reviseRecipe',{recipeId:rid,outputQuantity:decimal(v.BatchYieldQty),outputUnit:mappedUnit(v.BatchYieldUnit),lines,steps:[]});
  if(v.LaborCost!==null&&v.LaborCost!==undefined&&v.LaborCost!=='')await run(r,'setLabor',{ingredientId:ids.get(key(v.RecipeName)),kind:'fixed',amount:decimal(v.LaborCost),currency:'USD',outputQuantity:decimal(v.BatchYieldQty),outputUnit:mappedUnit(v.BatchYieldUnit)});
 });
 // Owner-approved exact equivalence, stored as ordinary effective-dated item measurements.
 const dropItems=new Set();
 for(const r of bySheet('RecipeLines'))if(key(r.values.Unit)==='drop'){
  const ingredientId=ids.get(key(r.values.IngredientName));if(!ingredientId||dropItems.has(ingredientId))continue;
  await run(r,'addMeasurement',{ingredientId,fromQuantity:'1',fromUnit:'drop',toQuantity:'0.00113636',toUnit:'fl_oz_us',note:'Owner-approved drop correction: 1 drop = 0.00113636 US fl oz; adopted with this local workbook snapshot.'});dropItems.add(ingredientId);
 }
 progress('Recipes imported');
 for(const sheet of ['Drink Catalog','Food Catalog'])for(const r of bySheet(sheet))await attempt(r,async()=>{const v=r.values,mid=await run(r,'createMenuItem',{name:v.RecipeName}),definition=bySheet('Recipe Catalog').find(x=>key(x.values.RecipeName)===key(v.RecipeName)),rid=recipes.get(key(v.RecipeName));
  if(rid&&definition)await run(r,'setMenuMapping',{menuItemId:mid,recipeId:rid,quantity:decimal(definition.values.BatchYieldQty),unit:mappedUnit(definition.values.BatchYieldUnit)});else issue(r,'Menu recipe identity or yield unavailable','Menu mapping');
  if(v.ActualPrice!==null&&v.ActualPrice!==undefined)await run(r,'setSellingPrice',{menuItemId:mid,amount:decimal(v.ActualPrice),currency:'USD',effectiveAt:null,note:'Prior ActualPrice reference only; effective date unknown.'});
  if(v['Updated Pricing']!==null&&v['Updated Pricing']!==undefined)await run(r,'setSellingPrice',{menuItemId:mid,amount:decimal(v['Updated Pricing']),currency:'USD'});else issue(r,'Updated Pricing missing; prior ActualPrice retained undated, not silently selected as current.','Selling price');
 });
 // Read-only derived/reference rows remain source evidence, not duplicate operational facts.
 for(const r of records){if(!['Ingredients','Yields','Densities','Recipe Catalog','RecipeLines','Drink Catalog','Food Catalog'].includes(r.sheet)&&!r.issues.length)r.classification='CLEAN';}
 for(const r of bySheet('Conversions'))if(key(r.values.Unit)==='splash')issue(r,'Source defines a global operational-serving conversion. Ingredient-specific evidence is required before using it.','Measurement');
 for(const r of bySheet('Recipe Index'))if(r.values.LaborRate)issue(r,'Undepartmented labor rate retained as evidence; no FOH/BOH assignment inferred.','Labor rate');
 const state=await repo.read();
 const workbookModel=require('./reconcile').workbookCosts(records);
 // Surface unresolved cost blockers by item, retaining exact source locations in evidence.
 const reconciliation=[];for(const r of bySheet('Recipe Catalog')){const id=ids.get(key(r.values.RecipeName));if(!id)continue;let c;try{c=costIngredient(state,{ingredientId:id,quantity:decimal(r.values.BatchYieldQty),unit:mappedUnit(r.values.BatchYieldUnit),at:activationAt,knownAt:activationAt,currency:'USD'});}catch(e){issue(r,e.message,'Cost reconciliation');continue;}
  let classification='Unresolved discrepancy',delta=null;const source=r.values.BatchCost;
  if(c.completeCost===null){classification='Unresolved costing';issue(r,[...new Set(c.blockers.map(b=>b.reason+' ('+(state.ingredients.find(i=>i.id===b.ingredientId)?.name||b.ingredientId)+')'))].join('; '),'Costing');}
  else {try{delta=c.completeCost.sub(decimal(source));const model=workbookModel.get(key(r.values.RecipeName));const sourceError=model?model.total.sub(decimal(source)).abs():null;classification=delta.eq('0')?'Exact match':delta.abs().n*1000000000n<=delta.abs().d?'Rounding-only difference':sourceError&&sourceError.n*1000000000n<=sourceError.d&&c.completeCost.decimal(2)===E.of(decimal(source)).decimal(2)?'Explainable deterministic transformation':'Unresolved discrepancy';if(classification==='Unresolved discrepancy')issue(r,'Calculated batch cost differs from cached workbook by '+delta.decimal(),'Cost reconciliation');}catch{issue(r,'Missing/non-numeric cached batch cost','Cost reconciliation');}}
  reconciliation.push({recipe:r.values.RecipeName,row:r.row,source,independentWorkbookCost:workbookModel.get(key(r.values.RecipeName))?.total.decimal()??null,classification,delta:delta?.decimal()??null,...costView(c)});
 }
 for(const r of records){state.importRecords.push({id:crypto.randomUUID(),sourceFile:workbook.file,sourceHash:workbook.sha256,sheet:r.sheet,sourceRow:r.row,logicalType:r.sheet,sourceValues:{values:r.values,cells:r.cells},classification:r.classification,issues:r.issues,entityIds:r.entityIds,importedAt:activationAt});}
 const deterministic=stableIds({state,records,reconciliation},workbook.sha256);
 return {state:deterministic.state,records:deterministic.records,reconciliation:deterministic.reconciliation,activationAt,sourceHash:workbook.sha256,counts:{sourceRecords:records.length,clean:records.filter(r=>r.classification==='CLEAN').length,transformed:records.filter(r=>r.classification==='TRANSFORMED').length,sourceDataIssues:records.filter(r=>r.classification==='SOURCE DATA ISSUE').length,domainGaps:records.filter(r=>r.classification==='DOMAIN GAP').length,operationallyMapped:records.filter(r=>r.entityIds.length).length,evidencePreserved:records.length,ownerDecisionRecords:records.filter(r=>r.issues.some(x=>x.ownerRequired)).length,ingredients:state.ingredients.length,recipes:state.recipes.length,recipeLines:state.recipeRevisions.reduce((n,r)=>n+r.lines.length,0),purchaseOptions:state.purchaseOptions.length,prices:state.prices.length,yields:state.yields.length,measurements:state.measurements.length,menus:state.menuItems.length,locations:state.inventoryLocations.length}};
}
module.exports={build,parse,decimal,packageQuantity,mappedUnit,key,stableIds};
