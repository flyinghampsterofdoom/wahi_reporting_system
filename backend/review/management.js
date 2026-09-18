'use strict';
const {authorize,can,ingredientView,recipeView,costView}=require('../auth');
const {latest}=require('../domain/history');
const {costIngredient}=require('../domain/costing');
const {Exact}=require('../domain/exact');
async function management(service,actor,{includeItems=true,includeMenuCosts=true,recipeId=null}={}){
 authorize(actor);const s=await service.repository.read(),now=service.clock(),at=rows=>latest(rows,now,now),internal=can(actor,'internal_cost.read');
 const categories=s.recipeCategories.slice().sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name));
 const cost=(id,quantity,unit)=>costIngredient(s,{ingredientId:id,quantity:quantity||'1',unit:unit||'each',at:now,knownAt:now,currency:'USD'});
 const inputIds=new Set(s.recipes.flatMap(r=>at(s.recipeRevisions.filter(v=>v.recipeId===r.id))?.lines.map(l=>l.ingredientId)||[]));
 for(const id of new Set(s.yields.map(y=>y.ingredientId))){const y=at(s.yields.filter(x=>x.ingredientId===id));if(y)inputIds.add(y.sourceIngredientId);}
 const mappedMenus=new Map();for(const menu of s.menuItems){const mapping=at(s.menuMappings.filter(x=>x.menuItemId===menu.id));if(mapping){if(!mappedMenus.has(mapping.recipeId))mappedMenus.set(mapping.recipeId,[]);mappedMenus.get(mapping.recipeId).push({menu,mapping});}}
 const recipes=s.recipes.filter(r=>!recipeId||r.id===recipeId).map(r=>{
  const rev=at(s.recipeRevisions.filter(x=>x.recipeId===r.id)),assignment=at(s.recipeCategoryAssignments.filter(x=>x.recipeId===r.id)),category=categories.find(c=>c.id===assignment?.categoryId);
  const row={...recipeView(r,rev),active:r.active,category:category?{id:category.id,name:category.name,active:category.active,sortOrder:category.sortOrder}:null,outputName:s.ingredients.find(i=>i.id===r.outputIngredientId)?.name,menus:[]};
  for(const {menu:m,mapping} of mappedMenus.get(r.id)||[]){const price=at(s.sellingPrices.filter(x=>x.menuItemId===m.id)),menu={id:m.id,name:m.name,active:m.active,quantity:mapping.quantity,unit:mapping.unit,sellingPrice:price?{amount:price.amount,currency:price.currency}:null};
   if(internal&&includeMenuCosts){const c=cost(r.outputIngredientId,mapping.quantity,mapping.unit);menu.cost=costView(c);menu.costPercentage=price?.currency==='USD'&&Exact.of(price.amount).positive()&&c.completeCost!==null?c.completeCost.div(price.amount).mul('100').decimal(4):null;}row.menus.push(menu);
  }
  if(internal)row.cost=rev?costView(cost(r.outputIngredientId,rev.outputQuantity,rev.outputUnit)):null;return row;
 });
 const items=(includeItems?s.ingredients:[]).map(i=>{
  const recipe=recipes.find(r=>r.outputIngredientId===i.id),basis=at(s.bases.filter(x=>x.ingredientId===i.id)),countable=s.inventoryItems.some(x=>x.ingredientId===i.id),usedAsInput=inputIds.has(i.id);
  // Finished, menu-linked outputs stay in Recipes unless also inventoried/used as inputs.
  const finished=(!!recipe?.menus.some(m=>m.active)||i.tags.includes('recipe-output:finished'))&&!countable&&!usedAsInput;
  const row={...ingredientView(i),itemKind:recipe?'Prepared':basis?.kind==='source'?'Source yield':basis?.kind==='labor_only'?'Labor':'Purchased',recipeId:recipe?.id||null,finished,locationCount:s.inventoryAssignments.filter(a=>a.ingredientId===i.id&&a.active&&s.inventoryLocations.some(l=>l.id===a.locationId&&l.active)).length,countable};
  if(internal){row.vendors=require('./vendors').currentVendors(s,i.id,now);row.baseUnit=require('./units').baseUnit(s,i.id,now).unit;const p=s.purchaseOptions.find(p=>p.id===basis?.purchaseOptionId),price=p?at(s.prices.filter(x=>x.purchaseOptionId===p.id)):null;row.purchase=p?{label:p.label,quantity:p.contentQuantity,unit:p.contentUnit,price:price?{amount:price.amount,currency:price.currency}:null}:null;const output=basis?.kind==='source'?at(s.yields.filter(y=>y.ingredientId===i.id)):basis?.kind==='labor_only'?at(s.labor.filter(l=>l.ingredientId===i.id)):null;row.costQuantity=recipe?.revision?.outputQuantity||p?.contentQuantity||output?.outputQuantity||null;row.costUnit=recipe?.revision?.outputUnit||p?.contentUnit||output?.outputUnit||null;row.cost=recipe?.cost||costView(cost(i.id,row.costQuantity,row.costUnit));}return row;
 });
 return {items,recipes,categories};
}
module.exports={management};
