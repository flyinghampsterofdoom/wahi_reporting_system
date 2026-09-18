'use strict';
const {latest}=require('../domain/history');
const {STANDARD,activeMeasurements,resolveConversion}=require('../domain/measurements');
// A costing reference unit comes from the selected effective-dated basis, not a
// new mutable ingredient field. Inventory's immutable aggregation unit is separate.
function baseUnit(state,id,at,knownAt=at){
 const current=rows=>latest(rows,at,knownAt),basis=current(state.bases.filter(x=>x.ingredientId===id));
 if(basis?.kind==='purchase')return {unit:state.purchaseOptions.find(x=>x.id===basis.purchaseOptionId)?.contentUnit||null,source:'Selected purchase contents'};
 if(basis?.kind==='recipe')return {unit:current(state.recipeRevisions.filter(x=>x.recipeId===basis.recipeId))?.outputUnit||null,source:'Selected recipe output'};
 if(basis?.kind==='source')return {unit:current(state.yields.filter(x=>x.ingredientId===id))?.outputUnit||null,source:'Source yield output'};
 if(basis?.kind==='labor_only'){const units=[...new Set(state.labor.filter(x=>x.ingredientId===id).map(x=>x.componentKey))].map(k=>current(state.labor.filter(x=>x.componentKey===k))?.outputUnit).filter(Boolean);return {unit:new Set(units).size===1?units[0]:null,source:'Labor output'};}
 return {unit:null,source:'No configured cost basis'};
}
function itemUnits(state,id,at,knownAt=at){
 const base=baseUnit(state,id,at,knownAt),direct=activeMeasurements(state,id,at,knownAt);
 const candidates=new Set([base.unit,...Object.keys(STANDARD),...direct.flatMap(m=>[m.fromUnit,m.toUnit])]);
 const conversions=[];if(base.unit)for(const fromUnit of candidates){if(!fromUnit)continue;const c=resolveConversion(state,{ingredientId:id,quantity:'1',fromUnit,toUnit:base.unit,at,knownAt});if(c.status==='resolved')conversions.push({unit:fromUnit,equivalent:c.amount.decimal(12),measurementIds:c.measurementIds});}
 return {...base,conversions,direct};
}
module.exports={baseUnit,itemUnits};
