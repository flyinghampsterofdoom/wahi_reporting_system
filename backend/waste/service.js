'use strict';
const {randomUUID}=require('node:crypto');
const {z}=require('zod');
const {authorize}=require('../auth');
const {Exact:E}=require('../domain/exact');
const {latest,timestamp}=require('../domain/history');
const {STANDARD,activeMeasurements,resolveConversion}=require('../domain/measurements');
const {costIngredient}=require('../domain/costing');
const REASONS=Object.freeze(['Overproduction','Spoiled','Dropped / Spilled','Quality','Prep Error','Other']);
const inputSchema=z.object({requestId:z.string().uuid(),ingredientId:z.string().uuid(),quantity:z.string().max(100).refine(q=>{try{return E.of(q).positive();}catch{return false;}}),unit:z.string().max(80),reason:z.enum(REASONS),note:z.string().trim().max(300).default('')}).strict();
const fail=code=>{throw Object.assign(new Error(code),{code});};
const rational=n=>({numerator:n.n.toString(),denominator:n.d.toString()});
const folded=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function weekStart(now){const d=new Date(now);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString();}
// Output ingredients remain the single identity; a recipe is additional provenance.
function entities(s,now){return s.ingredients.filter(i=>i.active).flatMap(i=>{
 const basis=latest(s.bases.filter(b=>b.ingredientId===i.id),now,now),recipe=s.recipes.find(r=>r.outputIngredientId===i.id);
 if(basis?.kind==='labor_only'||recipe?.active===false)return [];
 const revision=recipe&&latest(s.recipeRevisions.filter(r=>r.recipeId===recipe.id),now,now);
 const inv=s.inventoryItems.find(x=>x.ingredientId===i.id),purchase=s.purchaseOptions.filter(p=>p.ingredientId===i.id&&p.active).sort((a,b)=>Number(b.id===basis?.purchaseOptionId)-Number(a.id===basis?.purchaseOptionId)||a.id.localeCompare(b.id));
 const yieldRow=latest(s.yields.filter(y=>y.ingredientId===i.id),now,now);
 const available=new Set([...(revision?.outputQuantity&&revision.outputUnit?['batch',revision.outputUnit]:[]),...s.inventoryAssignments.filter(a=>a.ingredientId===i.id&&a.active).map(a=>a.countUnit),...(inv?[inv.baseUnit]:[]),...purchase.map(p=>p.contentUnit),...(yieldRow?.outputUnit?[yieldRow.outputUnit]:[])]);
 for(const m of activeMeasurements(s,i.id,now,now)){available.add(m.fromUnit);available.add(m.toUnit);}
 for(const u of [...available])if(STANDARD[u])for(const [other,[dimension]]of Object.entries(STANDARD))if(dimension===STANDARD[u][0])available.add(other);
 if(!available.size)available.add('each'); // A count of discarded items needs no inventory setup.
 return [{id:i.id,name:recipe?.name||i.name,kind:recipe?'recipe':'ingredient',recipeId:recipe?.id||null,units:[...available],search:folded([i.name,recipe?.name,i.description,...i.tags].filter(Boolean).join(' ')),baseUnit:inv?.baseUnit||revision?.outputUnit||purchase[0]?.contentUnit||yieldRow?.outputUnit||'each',revision}];
 });}
function itemView(i){return {id:i.id,name:i.name,kind:i.kind,units:i.units,search:i.search};}
function eventView(e){return {id:e.id,recordedAt:e.recordedAt,ingredientId:e.ingredientId,kind:e.kind,name:e.snapshot.name,quantity:e.quantity,unit:e.unit,reason:e.reason,note:e.note};}
class WasteService{
 constructor(repository,{clock=()=>new Date().toISOString(),context={}}={}){this.repository=repository;this.clock=clock;this.context={locationId:context.locationId||null,locationName:context.locationName||null,environment:context.environment||'local-review'};}
 scope(){return JSON.stringify([this.context.environment,this.context.locationId,'BOH']);}
 async catalog(actor){authorize(actor,'waste.log');const now=timestamp(this.clock()),week=weekStart(now),scope=this.scope();
  return this.repository.transaction(async s=>{
   const items=entities(s,now);let common=s.wasteCommonSets.find(c=>c.scope===scope&&c.week===week);
   if(!common){const start=new Date(Date.parse(week)-28*86400000).toISOString(),counts=new Map();for(const e of s.wasteEvents)if(e.scope===scope&&e.recordedAt>=start&&e.recordedAt<week)counts.set(e.ingredientId,(counts.get(e.ingredientId)||0)+1);
    const ranked=[...items].sort((a,b)=>(counts.get(b.id)||0)-(counts.get(a.id)||0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    common={id:randomUUID(),scope,week,snapshot:{ids:ranked.map(i=>i.id)},recordedAt:now};s.wasteCommonSets.push(common);
   }
   return {items:items.map(itemView),common:[...common.snapshot.ids.map(id=>items.find(i=>i.id===id)).filter(Boolean),...items.filter(i=>!common.snapshot.ids.includes(i.id)).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))].slice(0,4).map(itemView),reasons:REASONS};
  });
 }
 async log(actor,input,sessionContext={}){authorize(actor,'waste.log');const d=inputSchema.parse(input),scope=this.scope();return this.repository.transaction(async s=>{
  const previous=s.wasteEvents.find(e=>e.actorId===actor.id&&e.requestId===d.requestId);
  if(previous){if(previous.scope!==scope||['ingredientId','quantity','unit','reason','note'].some(k=>previous[k]!==d[k]))fail('revision_conflict');return eventView(previous);}
  const now=timestamp(this.clock()),item=entities(s,now).find(i=>i.id===d.ingredientId);if(!item)fail('inactive_reference');if(!item.units.includes(d.unit))fail('invalid_request');
  const q=d.unit==='batch'?E.of(d.quantity).mul(E.of(item.revision.outputQuantity)):E.of(d.quantity),fromUnit=d.unit==='batch'?item.revision.outputUnit:d.unit;
  const conversion=resolveConversion(s,{ingredientId:item.id,quantity:'1',fromUnit,toUnit:item.baseUnit,at:now,knownAt:now});
  const normalized=conversion.status==='resolved'?q.mul(conversion.amount):null;
  // Resolve one unit and scale exactly, including fractional recipe batches.
  const cost=costIngredient(s,{ingredientId:item.id,quantity:'1',unit:fromUnit,at:now,knownAt:now});
  const event={id:randomUUID(),requestId:d.requestId,actorId:actor.id,recordedAt:now,scope,locationId:this.context.locationId,department:'BOH',ingredientId:item.id,recipeId:item.recipeId,kind:item.kind,quantity:d.quantity,unit:d.unit,reason:d.reason,note:d.note,baseUnit:item.baseUnit,baseQuantity:normalized?.decimal()??null,snapshot:{name:item.name,locationName:this.context.locationName,environment:this.context.environment,entrySource:'boh-waste',sessionId:sessionContext.sessionId||null,actorRole:actor.role,recipeRevisionId:item.revision?.id||null,batchYield:d.unit==='batch'?{quantity:item.revision.outputQuantity,unit:fromUnit}:null,conversion:{status:conversion.status,measurementIds:conversion.measurementIds||[],exactQuantity:normalized?rational(normalized):null},cost:{status:cost.status,amount:cost.completeCost?.mul(q).decimal()??null,exactAmount:cost.completeCost?rational(cost.completeCost.mul(q)):null,currency:cost.currency,references:cost.references,at:now,knownAt:now}}};
  s.wasteEvents.push(event);s.audit.push({id:randomUUID(),actorId:actor.id,entityType:'wasteEvents',entityId:event.id,action:'create',previous:null,next:structuredClone(event),recordedAt:now,effectiveAt:now,provenance:{kind:'manual',reference:'BOH Waste Log'},note:d.note||null,changeId:randomUUID()});return eventView(event);
 });}
 async history(actor,query={}){authorize(actor,'waste.history');const d=z.object({q:z.string().max(200).default(''),from:z.string().date().optional(),to:z.string().date().optional(),reason:z.enum(REASONS).optional(),kind:z.enum(['recipe','ingredient']).optional(),department:z.enum(['BOH','FOH']).optional(),locationId:z.string().max(200).optional(),ingredientId:z.string().uuid().optional(),offset:z.coerce.number().int().min(0).default(0)}).strict().parse(query);if(d.from&&d.to&&d.from>d.to)fail('invalid_request');
 const s=await this.repository.read(),rows=s.wasteEvents.filter(e=>(!d.from||e.recordedAt>=d.from)&&(!d.to||e.recordedAt<new Date(Date.parse(d.to)+86400000).toISOString())&&(!d.q||folded(e.snapshot.name+' '+e.note).includes(folded(d.q)))&&['reason','kind','department','locationId','ingredientId'].every(k=>!d[k]||e[k]===d[k])).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)||b.id.localeCompare(a.id));
 return {total:rows.length,offset:d.offset,events:rows.slice(d.offset,d.offset+100).map(e=>({...eventView(e),recipeId:e.recipeId,actorId:e.actorId,department:e.department,locationId:e.locationId,locationName:e.snapshot.locationName,baseUnit:e.baseUnit,baseQuantity:e.baseQuantity,cost:e.snapshot.cost}))};
 }
}
module.exports={WasteService,REASONS,entities,weekStart};
