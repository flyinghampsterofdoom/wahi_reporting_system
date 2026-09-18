'use strict';
const {randomUUID}=require('node:crypto');
const {z}=require('zod');
const {Exact:E}=require('./domain/exact');
const {unit,resolveConversion}=require('./domain/measurements');
const {timestamp,latest}=require('./domain/history');
const {costIngredient,assertAcyclic}=require('./domain/costing');
const {authorize,can,ingredientView,recipeView,costView}=require('./auth');

const id=z.string().uuid();
const text=z.string().trim().min(1).max(500);
const decimal=z.string().max(100).refine(v=>{try{return E.of(v).nonnegative();}catch{return false;}},'Expected nonnegative decimal string');
const positive=decimal.refine(v=>E.of(v).positive(),'Expected positive decimal string');
const measure=z.string().refine(v=>{try{unit(v);return true;}catch{return false;}},'Unknown or ambiguous unit');
const currency=z.string().regex(/^[A-Z]{3}$/);
const optionalQty=positive.nullable().default(null), optionalUnit=measure.nullable().default(null);
const provenance=z.object({kind:z.enum(['manual','website','purchase_order','invoice','vendor_quote','manual_verification','historical_workbook','other']),reference:z.string().max(2000).optional()}).strict();
const common={effectiveAt:z.string().nullable().optional(),provenance,note:z.string().max(4000).optional(),supersedesId:id.optional(),active:z.boolean().default(true)};
const record={provenance,note:z.string().max(4000).optional()};
const schemas={
  createRecipeCategory:z.object({...record,name:text,sortOrder:z.number().int().default(0),active:z.boolean().default(true)}).strict(),
  updateRecipeCategory:z.object({...record,categoryId:id,name:text,sortOrder:z.number().int(),active:z.boolean()}).strict(),
  setRecipeCategory:z.object({...common,recipeId:id,categoryId:id.nullable()}).strict(),
  setArchived:z.object({...record,collection:z.enum(['ingredients','suppliers','purchaseOptions','recipes','menuItems']),entityId:id,archived:z.boolean()}).strict(),
  createIngredient:z.object({...record,name:text,description:z.string().max(4000).default(''),category:z.string().max(100).default(''),tags:z.array(text).max(50).default([])}).strict(),
  updateIngredient:z.object({...record,ingredientId:id,name:text,description:z.string().max(4000).default(''),category:z.string().max(100).default(''),tags:z.array(text).max(50).default([]),active:z.boolean()}).strict(),
  createSupplier:z.object({...record,name:text,contact:z.string().max(2000).default('')}).strict(),
  createPurchaseOption:z.object({...record,ingredientId:id,supplierId:id.nullable().default(null),sku:z.string().max(200).default(''),label:text,contentQuantity:positive,contentUnit:measure}).strict(),
  createRecipe:z.object({...record,name:text,outputIngredientId:id}).strict(),
  createMenuItem:z.object({...record,name:text,active:z.boolean().default(true)}).strict(),
  updateMenuItem:z.object({...record,menuItemId:id,name:text,active:z.boolean()}).strict(),
  selectBasis:z.object({...common,ingredientId:id,kind:z.enum(['purchase','source','recipe','labor_only']),purchaseOptionId:id.nullable().default(null),recipeId:id.nullable().default(null)}).strict(),
  setYield:z.object({...common,ingredientId:id,sourceIngredientId:id,sourceQuantity:optionalQty,sourceUnit:optionalUnit,outputQuantity:optionalQty,outputUnit:optionalUnit}).strict(),
  addMeasurement:z.object({...common,ingredientId:id,measurementKey:id.optional(),fromQuantity:positive,fromUnit:measure,toQuantity:positive,toUnit:measure}).strict(),
  reviseRecipe:z.object({...common,recipeId:id,outputQuantity:optionalQty,outputUnit:optionalUnit,
    lines:z.array(z.object({ingredientId:id,quantity:decimal.nullable().default(null),unit:optionalUnit}).strict()).max(1000),
    steps:z.array(z.string().min(1).max(10000)).max(1000).default([])}).strict(),
  addPrice:z.object({...common,purchaseOptionId:id,amount:decimal,currency}).strict(),
  setLabor:z.object({...common,ingredientId:id,componentKey:id.optional(),kind:z.enum(['fixed','time']),outputQuantity:optionalQty,outputUnit:optionalUnit,
    amount:decimal.nullable().default(null),currency:currency.nullable().default(null),minutes:decimal.nullable().default(null),department:z.enum(['FOH','BOH']).nullable().default(null)}).strict(),
  setLaborRate:z.object({...common,department:z.enum(['FOH','BOH']),amount:decimal,currency}).strict(),
  setSellingPrice:z.object({...common,menuItemId:id,amount:decimal,currency}).strict(),
  setMenuMapping:z.object({...common,menuItemId:id,recipeId:id,quantity:positive,unit:measure}).strict()
};
const targets={setRecipeCategory:['recipeCategoryAssignments','recipeId'],selectBasis:['bases','ingredientId'],setYield:['yields','ingredientId'],addMeasurement:['measurements','measurementKey'],reviseRecipe:['recipeRevisions','recipeId'],addPrice:['prices','purchaseOptionId'],setLabor:['labor','componentKey'],setLaborRate:['laborRates','department'],setSellingPrice:['sellingPrices','menuItemId'],setMenuMapping:['menuMappings','menuItemId']};
const costWrites=new Set(['createPurchaseOption','selectBasis','setYield','addMeasurement','reviseRecipe','addPrice','setLabor']);
class DomainService {
  constructor(repository,{clock=()=>new Date().toISOString()}={}) {this.repository=repository;this.clock=clock;this.inventory=new (require('./inventory/service').InventoryService)(repository,{clock});}
  async execute(actor,command,input) {
    authorize(actor,command==='setLaborRate'?'labor_rates.manage':costWrites.has(command)?'internal_cost.write':'domain.write');
    if(!schemas[command])throw new Error('Unknown command');
    const data=schemas[command].parse(input),now=timestamp(this.clock()),changeId=randomUUID();
    if(Object.hasOwn(data,'effectiveAt')) {
      if(data.effectiveAt===null)authorize(actor,'history.backdate');
      else { data.effectiveAt=timestamp(data.effectiveAt);if(data.effectiveAt<now)authorize(actor,'history.backdate'); }
    }
    return this.repository.transaction(async state=>{
      const must=(collection,key,allowArchived=false)=>{const r=state[collection].find(r=>r.id===key);if(!r)throw new Error('Missing '+collection+' reference: '+key);if(!allowArchived&&r.active===false)throw new Error('Archived '+collection+' reference: '+key);return r;};
      function audit(collection,previous,next,effectiveAt=null) {
        state.audit.push({id:randomUUID(),actorId:actor.id,entityType:collection,entityId:next.id,action:previous?'revise':'create',previous:previous||null,next:structuredClone(next),recordedAt:now,effectiveAt,provenance:data.provenance,note:data.note||null,changeId});
      }
      function identity(collection,fields) {
        const next={id:randomUUID(),...fields,createdAt:now,updatedAt:now};state[collection].push(next);audit(collection,null,next);return next;
      }
      function revision(collection,key,fields,metadata=data) {
        const effectiveAt=metadata.effectiveAt===undefined?now:metadata.effectiveAt;
        const existing=state[collection].filter(r=>r[key]===fields[key]);
        let previous=effectiveAt===null?null:latest(existing,effectiveAt);
        if(metadata.supersedesId) {
          const old=existing.find(r=>r.id===metadata.supersedesId);
          if(!old || old.effectiveAt!==effectiveAt || state[collection].some(r=>r.supersedesId===old.id)) throw new Error('Correction must supersede an unsuperseded record in the same scope and effective time');
          previous=old;
        } else if(effectiveAt!==null && existing.some(r=>r.effectiveAt===effectiveAt)) throw new Error('Effective-time collision requires explicit supersedesId');
        const next={id:randomUUID(),...fields,effectiveAt,recordedAt:now,actorId:actor.id,provenance:metadata.provenance,note:metadata.note||null,supersedesId:metadata.supersedesId||null,active:metadata.active!==false};
        state[collection].push(next);audit(collection,previous,next,effectiveAt);return next;
      }
      function selectAutomatically(ingredientId,kind,recipeId=null) {
        const at=data.effectiveAt===undefined?now:data.effectiveAt;
        const current=at===null?null:latest(state.bases.filter(r=>r.ingredientId===ingredientId),at);
        if(current?.kind===kind && (kind!=='recipe'||current.recipeId===recipeId))return;
        revision('bases','ingredientId',{ingredientId,kind,purchaseOptionId:null,recipeId},{...data,supersedesId:undefined});
      }
      let result;
      if(command==='createRecipeCategory')result=identity('recipeCategories',{name:data.name,sortOrder:data.sortOrder,active:data.active});
      else if(command==='updateRecipeCategory') {
        const collection='recipeCategories',key=data.categoryId;
        const old=must(collection,key,true),previous=structuredClone(old);
        Object.assign(old,{name:data.name,active:data.active,updatedAt:now,sortOrder:data.sortOrder});audit(collection,previous,old);result=old;
      } else if(command==='setArchived') {
        const old=must(data.collection,data.entityId,true),previous=structuredClone(old);
        Object.assign(old,{active:!data.archived,updatedAt:now});audit(data.collection,previous,old);result=old;
      } else if(command==='createIngredient') result=identity('ingredients',{name:data.name,description:data.description,category:data.category,tags:data.tags,active:true});
      else if(command==='updateIngredient') {
        const old=must('ingredients',data.ingredientId,true),previous=structuredClone(old);
        Object.assign(old,{name:data.name,description:data.description,category:data.category,tags:data.tags,active:data.active,updatedAt:now});audit('ingredients',previous,old);result=old;
      } else if(command==='createSupplier')result=identity('suppliers',{name:data.name,contact:data.contact,active:true});
      else if(command==='createPurchaseOption') {
        must('ingredients',data.ingredientId);if(data.supplierId)must('suppliers',data.supplierId);
        result=identity('purchaseOptions',{ingredientId:data.ingredientId,supplierId:data.supplierId,sku:data.sku,label:data.label,contentQuantity:data.contentQuantity,contentUnit:data.contentUnit,active:true});
      } else if(command==='createRecipe') {
        must('ingredients',data.outputIngredientId);
        if(state.recipes.some(r=>r.outputIngredientId===data.outputIngredientId))throw new Error('Output ingredient already has a recipe');
        result=identity('recipes',{name:data.name,outputIngredientId:data.outputIngredientId,active:true});
      } else if(command==='createMenuItem')result=identity('menuItems',{name:data.name,active:data.active});
      else if(command==='updateMenuItem') {
        const old=must('menuItems',data.menuItemId,true),previous=structuredClone(old);
        Object.assign(old,{name:data.name,active:data.active,updatedAt:now});audit('menuItems',previous,old);result=old;
      }
      else {
        const [collection,key]=targets[command];
        const fields={...data};for(const k of Object.keys(common))delete fields[k];
        if(fields.ingredientId)must('ingredients',fields.ingredientId);
        if(fields.menuItemId)must('menuItems',fields.menuItemId);
        if(command==='setRecipeCategory'){must('recipes',data.recipeId);if(data.categoryId)must('recipeCategories',data.categoryId);}
        if(command==='selectBasis') {
          if(data.kind==='purchase') {if(must('purchaseOptions',data.purchaseOptionId).ingredientId!==data.ingredientId)throw new Error('Purchase option belongs to another ingredient');}
          else if(data.purchaseOptionId)throw new Error('Unexpected purchase option');
          if(data.kind==='recipe') {if(must('recipes',data.recipeId).outputIngredientId!==data.ingredientId)throw new Error('Recipe output mismatch');}
          else if(data.recipeId)throw new Error('Unexpected recipe');
        }
        if(command==='setYield')must('ingredients',data.sourceIngredientId);
        if(command==='addPrice')must('purchaseOptions',data.purchaseOptionId);
        if(command==='addMeasurement') {
          fields.measurementKey=data.measurementKey||randomUUID();
          if(state.measurements.some(m=>m.measurementKey===fields.measurementKey&&m.ingredientId!==data.ingredientId))throw new Error('Measurement identity belongs to another ingredient');
          for(const [op,other] of [[data.fromUnit,data.toUnit],[data.toUnit,data.fromUnit]]) {
            if(op==='dash_fluid'&&unit(other).node!=='volume'||op==='dash_mass'&&unit(other).node!=='mass')throw new Error('Define each dash against its explicit physical family first');
          }
        }
        if(command==='setLabor') {
          fields.componentKey=data.componentKey||randomUUID();
          if(state.labor.some(l=>l.componentKey===fields.componentKey&&l.ingredientId!==data.ingredientId))throw new Error('Labor identity belongs to another ingredient');
          if(data.kind==='fixed'&&(data.minutes!==null||data.department!==null))throw new Error('Fixed labor does not imply time or department');
          if(data.kind==='time'&&(data.amount!==null||data.currency!==null))throw new Error('Time labor gets its price from the department rate');
          if(data.kind==='fixed'&&data.amount!==null&&data.currency===null)throw new Error('Fixed amount requires currency');
        }
        if(command==='reviseRecipe') {
          must('recipes',data.recipeId);data.lines.forEach(l=>must('ingredients',l.ingredientId));
          fields.lines=data.lines.map(l=>({id:randomUUID(),...l}));fields.steps=data.steps.map((instruction,position)=>({id:randomUUID(),position,instruction}));
        }
        if(command==='setMenuMapping')must('recipes',data.recipeId);
        result=revision(collection,key,fields);
        if(command==='setYield'&&data.active!==false)selectAutomatically(data.ingredientId,'source');
        if(command==='reviseRecipe'&&data.active!==false)selectAutomatically(must('recipes',data.recipeId).outputIngredientId,'recipe',data.recipeId);
      }
      assertAcyclic(state);
      return {id:result.id,changeId,...(result.measurementKey?{measurementKey:result.measurementKey}:{}),...(result.componentKey?{componentKey:result.componentKey}:{})};
    });
  }
  context(input={}) {return {at:timestamp(input.at||this.clock()),knownAt:timestamp(input.knownAt||this.clock()),currency:currency.parse(input.currency||'USD')};}
  async ingredient(actor,ingredientId) {authorize(actor);const s=await this.repository.read();const i=s.ingredients.find(i=>i.id===ingredientId);return i?ingredientView(i):null;}
  async recipe(actor,recipeId,input={}) {authorize(actor);const s=await this.repository.read(),c=this.context(input),r=s.recipes.find(r=>r.id===recipeId);return r?recipeView(r,latest(s.recipeRevisions.filter(v=>v.recipeId===r.id),c.at,c.knownAt)):null;}
  async convert(actor,input) {
    authorize(actor);
    let context;
    try {context=this.context(input);}catch(error){return {status:'invalid_request',message:error.message};}
    const c=resolveConversion(await this.repository.read(),{...input,...context});
    return {...c,...(c.status==='resolved'?{amount:c.amount.decimal()}: {})};
  }
  async cost(actor,input) {authorize(actor,'internal_cost.read');decimal.parse(input.quantity);measure.parse(input.unit);id.parse(input.ingredientId);return costView(costIngredient(await this.repository.read(),{...input,...this.context(input)}));}
  async history(actor,collection,subjectId) {
    authorize(actor,'internal_cost.read');
    if(!Object.values(targets).some(([c])=>c===collection))throw new Error('Unknown history collection');
    const key=Object.values(targets).find(([c])=>c===collection)[1];return (await this.repository.read())[collection].filter(r=>r[key]===subjectId);
  }
  async audit(actor,entityId) {authorize(actor,'internal_cost.read');return (await this.repository.read()).audit.filter(e=>e.entityId===entityId);}
  async menu(actor,menuItemId,input={}) {
    authorize(actor);const s=await this.repository.read(),c=this.context(input),m=s.menuItems.find(r=>r.id===menuItemId);if(!m)return null;
    const price=latest(s.sellingPrices.filter(r=>r.menuItemId===m.id),c.at,c.knownAt),mapping=latest(s.menuMappings.filter(r=>r.menuItemId===m.id),c.at,c.knownAt);
    const output={id:m.id,name:m.name,active:m.active,sellingPrice:price?{amount:price.amount,currency:price.currency}:null,
      recipe:mapping?{recipeId:mapping.recipeId,quantity:mapping.quantity,unit:mapping.unit}:null};
    if(can(actor,'internal_cost.read')&&mapping) {
      const r=s.recipes.find(r=>r.id===mapping.recipeId);
      output.internalCost=costView(costIngredient(s,{...c,ingredientId:r.outputIngredientId,quantity:mapping.quantity,unit:mapping.unit}));
    }
    return output;
  }
}
module.exports={DomainService,schemas};
