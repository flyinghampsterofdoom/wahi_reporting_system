'use strict';
const {Exact:E}=require('../domain/exact'),{costIngredient}=require('../domain/costing'),{latest}=require('../domain/history');
const pack=x=>({n:x.n.toString(),d:x.d.toString()}),unpack=x=>new E(BigInt(x.n),BigInt(x.d));
function costResolver(state,target,now,stats){
 const boundaries=[...new Set(Object.values(state).filter(Array.isArray).flatMap(rows=>rows.map(r=>r.effectiveAt).filter(t=>t&&t<=now)))].sort(),cache=new Map();
 const future=Object.values(state).filter(Array.isArray).flatMap(rows=>rows.map(r=>r.effectiveAt).filter(t=>t&&t>now)).sort()[0]||null;
 function resolve(at){
  const basis=latest(state.bases.filter(b=>b.ingredientId===target.outputIngredientId),at,now);
  let quantity=target.quantity,unit=target.unit;
  if(target.mode==='execution'){
   const revision=latest(state.recipeRevisions.filter(r=>r.recipeId===target.recipeId),at,now);
   if(!revision?.outputQuantity||!revision?.outputUnit)return {basis,result:{completeCost:null,references:[],blockers:[{reason:revision?'missing_yield':'missing_recipe_revision',ingredientId:target.outputIngredientId,recipeId:target.recipeId}]}};
   quantity=revision.outputQuantity;unit=revision.outputUnit;
  }
  return {basis,result:costIngredient(state,{ingredientId:target.outputIngredientId,quantity,unit,at,knownAt:now,currency:'USD'})};
 }
 let current;
 return {dependencies:state.ingredients.map(i=>i.id),validUntil:future,at(saleAt){const boundary=boundaries.filter(t=>t<=saleAt).at(-1)||'0001-01-01T00:00:00.000Z';if(cache.has(boundary))return cache.get(boundary);stats.historicalResolutions++;const historical=resolve(saleAt);let answer;
  const blocks=historical.result.blockers.map(b=>({reason:b.reason,ingredientId:b.ingredientId,recipeId:b.recipeId||null}));
  if(historical.basis?.kind==='recipe'&&historical.basis.recipeId===target.recipeId&&historical.result.completeCost!==null)answer={level:'historical',cost:historical.result.completeCost,references:historical.result.references,blockers:[]};
  else{if(!current){stats.currentResolutions++;current=resolve(now);}if(current.result.completeCost!==null){const recipe=current.basis?.kind==='recipe'&&current.basis.recipeId===target.recipeId;answer={level:recipe?'current':'alternate',cost:current.result.completeCost,references:current.result.references,basis:current.basis?.kind,blockers:blocks.length?blocks:[{reason:'historical_recipe_basis_unavailable',ingredientId:target.outputIngredientId}]};}else answer={level:'unresolved',cost:E.of('0'),references:[],blockers:current.result.blockers.map(b=>({reason:b.reason,ingredientId:b.ingredientId,recipeId:b.recipeId||null})),historicalBlockers:blocks};}
  cache.set(boundary,answer);return answer;
 }};
}
function empty(){return {quantity:E.of('0'),total:E.of('0'),netSales:E.of('0'),netSalesKnown:true,historical:E.of('0'),current:E.of('0'),alternate:E.of('0'),unresolved:E.of('0'),modifiers:0,buckets:[]};}
function addFact(out,f,evidence){const q=E.of(f.quantity);out.quantity=out.quantity.add(q);out.total=out.total.add(q.mul(evidence.cost));out[evidence.level]=out[evidence.level].add(q);if(f.netSales===null)out.netSalesKnown=false;else out.netSales=out.netSales.add(f.netSales);out.modifiers+=f.modifiers.length?1:0;const cost=pack(evidence.cost),key=JSON.stringify([evidence.level,cost,evidence.blockers,evidence.references]);let bucket=out.buckets.find(b=>b.key===key);if(!bucket){bucket={key,level:evidence.level,unitCost:cost,quantity:E.of('0'),blockers:evidence.blockers,historicalBlockers:evidence.historicalBlockers||[],basis:evidence.basis||null,references:evidence.references};out.buckets.push(bucket);}bucket.quantity=bucket.quantity.add(q);}
function encode(out){return {...out,...Object.fromEntries(['quantity','total','netSales','historical','current','alternate','unresolved'].map(k=>[k,pack(out[k])])),buckets:out.buckets.map(({key,...b})=>({...b,quantity:pack(b.quantity)}))};}
function decode(row){return {...row,...Object.fromEntries(['quantity','total','netSales','historical','current','alternate','unresolved'].map(k=>[k,unpack(row[k])]))};}
module.exports={pack,unpack,costResolver,empty,addFact,encode,decode};
