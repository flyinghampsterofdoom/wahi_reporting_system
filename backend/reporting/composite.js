'use strict';
const {Exact:E}=require('../domain/exact'),{pack,unpack,empty,addFact}=require('./cost');
const hints=require('./composite-hints.json');
const key=path=>JSON.stringify(path);
// Ancestors include option identity as well as group identity; leaf is a group.
function groups(modifiers,path=[],out=new Map()){
 for(const m of modifiers||[]){if(m.voided)continue;const p=[...path,m.groupId||'unidentified'];const k=key(p);if(!out.has(k))out.set(k,{path:p,options:[]});out.get(k).options.push(m);groups(m.modifiers,[...path,(m.groupId||'unidentified')+'/'+(m.itemId||'unidentified')],out);}return out;
}
function inspect(f,definition){
 const binding=definition.parents.find(p=>p.itemId===f.itemId),expected=E.of(f.quantity).mul(definition.expectedPieces),found=binding?groups(f.modifiers).get(key(binding.groupPath)):null,amounts=new Map();
 for(const m of found?.options||[]){const id=m.itemId||'unidentified';amounts.set(id,(amounts.get(id)||E.of('0')).add(m.quantity));}
 const pieces=[...amounts.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([optionId,quantity])=>{const alias=binding?.options.find(o=>o.optionId===optionId),component=definition.components.find(c=>c.key===alias?.componentKey);return {optionId,quantity,component};});
 const accounted=pieces.reduce((s,p)=>s.add(p.quantity),E.of('0')),issues=[];
 if(!found)issues.push({reason:'composite_group_missing'});
 if(!accounted.eq(expected))issues.push({reason:'composite_quantity_mismatch',expected:expected.decimal(20),accounted:accounted.decimal(20)});
 for(const p of pieces)if(!p.component)issues.push({reason:'composite_option_unmapped',optionId:p.optionId});
 const canonical=JSON.stringify([binding?.groupPath||[],pieces.map(p=>[p.optionId,pack(p.quantity)])]);return {pieces,expected,accounted,issues,canonical};
}
async function evaluator(c,definition,now,stats,resolvers=new Map()){
 const {readCostState}=require('./cost-state'),{costResolver}=require('./cost');const recipes=new Map();
 for(const component of definition.components){if(!resolvers.has(component.recipeId)){const r=(await c.query('SELECT output_ingredient_id FROM wahi_v2.recipes WHERE id=$1',[component.recipeId])).rows[0];resolvers.set(component.recipeId,r?costResolver(await readCostState(c,r.output_ingredient_id),{recipeId:component.recipeId,outputIngredientId:r.output_ingredient_id,mode:'execution'},now,stats):null);}recipes.set(component.key,resolvers.get(component.recipeId));}
 return {dependencies:[...new Set([...recipes.values()].flatMap(r=>r?.dependencies||[]))],validUntil:[...recipes.values()].map(r=>r?.validUntil).filter(Boolean).sort()[0]||null,run(f){
 const x=inspect(f,definition),parts=x.pieces.map(p=>{const component=p.component,executions=component?p.quantity.div(component.piecesPerExecution):null,r=component?recipes.get(component.key):null,evidence=r?r.at(f.saleAt):{level:'unresolved',cost:E.of('0'),references:[],blockers:[{reason:'missing_recipe_mapping'}]};return {optionId:p.optionId,pieces:pack(p.quantity),componentKey:component?.key||null,name:component?.name||'Unknown choice',recipeId:component?.recipeId||null,piecesPerExecution:component?.piecesPerExecution||null,executions:executions?pack(executions):null,evidence:component?{...evidence,cost:pack(evidence.cost)}:null,total:pack(executions?executions.mul(evidence.cost):E.of('0'))};});
 const levels=parts.map(p=>p.evidence?.level||'unresolved'),level=x.issues.length||levels.includes('unresolved')?'unresolved':levels.includes('alternate')?'alternate':levels.includes('current')?'current':'historical';
 const total=x.issues.length?E.of('0'):parts.reduce((n,p)=>n.add(unpack(p.total)),E.of('0'));
 return {evidence:{level,cost:total.div(f.quantity),references:[...new Set(parts.flatMap(p=>p.evidence?.references||[]))],blockers:[...x.issues,...parts.flatMap(p=>(p.evidence?.blockers||[]).map(b=>({...b,recipeId:b.recipeId||p.recipeId}))) ]},composition:{selectionId:f.id,saleAt:f.saleAt,parentId:f.itemId,parentQuantity:pack(E.of(f.quantity)),netSales:f.netSales,canonical:x.canonical,expected:pack(x.expected),accounted:pack(x.accounted),mappingComplete:!x.issues.length,issues:x.issues,level,total:pack(total),parts}};
 }};
}
function aggregate(facts,runner){const out=empty();out.compositions=[];out.mappingUnresolved=E.of('0');for(const f of facts){const {evidence,composition}=runner.run(f);addFact(out,f,evidence);out.compositions.push(composition);if(!composition.mappingComplete){out.mappingUnresolved=out.mappingUnresolved.add(f.quantity);if(f.netSales!==null)out.mappingUnresolvedSales=out.mappingUnresolvedSales.add(f.netSales);}}return out;}
function describe(compositions=[]){const components=new Map();let expected=E.of('0'),accounted=E.of('0'),completeParents=E.of('0');for(const x of compositions){expected=expected.add(unpack(x.expected));accounted=accounted.add(unpack(x.accounted));if(x.mappingComplete)completeParents=completeParents.add(unpack(x.parentQuantity));for(const p of x.parts){const k=p.componentKey||p.optionId;if(!components.has(k))components.set(k,{name:p.name,recipeId:p.recipeId,pieces:E.of('0'),executions:E.of('0')});const r=components.get(k);r.pieces=r.pieces.add(unpack(p.pieces));if(p.executions)r.executions=r.executions.add(unpack(p.executions));}}
 return {expectedPieces:expected.decimal(20),accountedPieces:accounted.decimal(20),reconciled:compositions.every(x=>x.mappingComplete),completeParents:completeParents.decimal(20),components:[...components.values()].map(c=>({...c,pieces:c.pieces.decimal(20),executions:c.executions.decimal(2),exactExecutions:pack(c.executions)})),unresolved:compositions.filter(x=>!x.mappingComplete||x.level==='unresolved'),selections:compositions.length};}
module.exports={groups,inspect,evaluator,aggregate,describe,hints,key};
