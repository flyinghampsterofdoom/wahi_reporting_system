'use strict';
const {randomUUID}=require('node:crypto');
const {z}=require('zod');
const {Exact:E}=require('../domain/exact');
const {timestamp}=require('../domain/history');
const {unit,resolveConversion}=require('../domain/measurements');
const {authorize,can}=require('../auth');
const id=z.string().uuid(),name=z.string().trim().min(1).max(500);
const quantity=z.string().max(100).refine(v=>{try{return E.of(v).nonnegative();}catch{return false;}},'Expected nonnegative exact decimal string');
const measure=z.string().refine(v=>{try{unit(v);return true;}catch{return false;}},'Unknown canonical unit');
const order=z.number().int().min(-2147483648).max(2147483647).default(0);
const version=z.number().int().positive();
const record={provenance:z.object({kind:z.literal('manual'),reference:z.string().max(2000).optional()}).strict().default({kind:'manual'})};
const schemas={
  createLocation:z.object({...record,name,description:z.string().max(4000).default(''),area:z.string().trim().min(1).max(100).nullable().default(null),sortOrder:order}).strict(),
  updateLocation:z.object({...record,locationId:id,expectedVersion:version,name,description:z.string().max(4000).default(''),area:z.string().trim().min(1).max(100).nullable().default(null),sortOrder:order,active:z.boolean()}).strict(),
  configureItem:z.object({...record,ingredientId:id,baseUnit:measure}).strict(),
  assignItem:z.object({...record,ingredientId:id,locationId:id,countUnit:measure,sortOrder:order}).strict(),
  updateAssignment:z.object({...record,assignmentId:id,expectedVersion:version,countUnit:measure,sortOrder:order,active:z.boolean()}).strict(),
  startCount:z.object({...record,locationId:id,observedAt:z.string(),notes:z.string().max(4000).default('')}).strict(),
  enterCount:z.object({...record,sessionId:id,ingredientId:id,quantity,unit:measure,observedAt:z.string().optional(),expectedRevisionId:id.nullable()}).strict(),
  submitCount:z.object({...record,sessionId:id,expectedVersion:version,expectedObservationIds:z.array(id).max(10000)}).strict(),
  correctCount:z.object({...record,observationId:id,expectedRevisionId:id,quantity,reason:z.string().trim().min(1).max(4000)}).strict()
};
const configuration=new Set(['createLocation','updateLocation','configureItem','assignItem','updateAssignment']);
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function get(s,collection,key){const r=s[collection].find(r=>r.id===key);if(!r)fail('not_found','Missing inventory reference');return r;}
function active(s,collection,key){const r=get(s,collection,key);if(r.active===false)fail('inactive_reference','Archived inventory reference');return r;}
function compareVersion(row,expected){if(row.version!==expected)fail('revision_conflict','Inventory version changed; reload before saving');}
function heads(rows,knownAt){const visible=rows.filter(r=>r.recordedAt<=knownAt),superseded=new Set(visible.map(r=>r.supersedesId));return visible.filter(r=>!superseded.has(r.id));}
function rational(e){return {numerator:e.n.toString(),denominator:e.d.toString()};}
function exact(r){return new E(BigInt(r.numerator),BigInt(r.denominator));}
function converted(row){return row.conversion.status==='resolved'?E.of(row.quantity).mul(exact(row.conversion.factor)):null;}
function locationView(r){return {id:r.id,name:r.name,description:r.description,area:r.area,sortOrder:r.sortOrder,active:r.active,version:r.version,createdAt:r.createdAt,updatedAt:r.updatedAt};}
function assignmentView(r){return {id:r.id,ingredientId:r.ingredientId,locationId:r.locationId,countUnit:r.countUnit,sortOrder:r.sortOrder,active:r.active,version:r.version};}
function observationView(r){const total=converted(r);return {id:r.id,sessionId:r.sessionId,ingredientId:r.ingredientId,quantity:r.quantity,unit:r.unit,observedAt:r.observedAt,recordedAt:r.recordedAt,actorId:r.actorId,supersedesId:r.supersedesId,reason:r.reason,conversion:structuredClone(r.conversion),baseQuantity:total?.decimal()??null,exactBaseQuantity:total?rational(total):null};}
function expectedItems(s,locationId){return s.inventoryAssignments.filter(a=>a.locationId===locationId&&a.active&&get(s,'ingredients',a.ingredientId).active).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)).map(a=>{
  const i=get(s,'ingredients',a.ingredientId),config=s.inventoryItems.find(c=>c.ingredientId===i.id);
  return {assignmentId:a.id,assignmentVersion:a.version,ingredientId:i.id,name:i.name,countUnit:a.countUnit,baseUnit:config.baseUnit,sortOrder:a.sortOrder};
});}
// Configuration has recorded-time audit history. Reconstruct it for as-known
// summaries so later archival cannot erase a previously missing location.
function configurationAt(s,collection,knownAt){
  return s[collection].filter(r=>r.createdAt<=knownAt).map(row=>{
    if(row.updatedAt<=knownAt)return row;
    const events=s.audit.filter(e=>e.entityType===collection&&e.entityId===row.id&&e.recordedAt<=knownAt)
      .sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)||(b.next.version??0)-(a.next.version??0));
    return events[0]?.next;
  }).filter(Boolean);
}
class InventoryService {
  constructor(repository,{clock=()=>new Date().toISOString()}={}){this.repository=repository;this.clock=clock;}
  context(input={}){const q=z.object({at:z.string().optional(),knownAt:z.string().optional()}).strict().parse(input);const now=timestamp(this.clock());return {at:timestamp(q.at??now),knownAt:timestamp(q.knownAt??now)};}
  async execute(actor,command,input){
    authorize(actor,configuration.has(command)?'inventory.configure':command==='correctCount'?'inventory.correct':'inventory.count');
    if(!Object.hasOwn(schemas,command))fail('invalid_command','Unknown inventory command');
    const data=schemas[command].parse(input),changeId=randomUUID();
    return this.repository.transaction(async s=>{
      const now=timestamp(this.clock());
      function audit(collection,previous,next){s.audit.push({id:randomUUID(),actorId:actor.id,entityType:collection,entityId:next.id,action:previous?'revise':'create',previous:previous?structuredClone(previous):null,next:structuredClone(next),recordedAt:now,effectiveAt:next.observedAt??null,provenance:data.provenance,note:data.reason??null,changeId});}
      function add(collection,fields,identity=true){const row={id:randomUUID(),...fields,...(identity?{createdAt:now,updatedAt:now}:{})};s[collection].push(row);audit(collection,null,row);return row;}
      function update(collection,row,fields){compareVersion(row,data.expectedVersion);const previous=structuredClone(row);Object.assign(row,fields,{version:row.version+1,updatedAt:now});audit(collection,previous,row);return row;}
      function ownDraft(session){if(session.actorId!==actor.id)fail('forbidden','Only the counting employee may edit or submit this draft');if(session.status!=='draft')fail('invalid_state','Submitted counts require an authorized correction');}
      let row;
      if(command==='createLocation')row=add('inventoryLocations',{name:data.name,description:data.description,area:data.area,sortOrder:data.sortOrder,active:true,version:1});
      if(command==='updateLocation')row=update('inventoryLocations',get(s,'inventoryLocations',data.locationId),{name:data.name,description:data.description,area:data.area,sortOrder:data.sortOrder,active:data.active});
      if(command==='configureItem'){
        active(s,'ingredients',data.ingredientId);
        if(s.inventoryItems.some(i=>i.ingredientId===data.ingredientId))fail('revision_conflict','Inventory base unit is already configured and is immutable');
        row=add('inventoryItems',{ingredientId:data.ingredientId,baseUnit:data.baseUnit});
      }
      if(command==='assignItem'){
        active(s,'ingredients',data.ingredientId);active(s,'inventoryLocations',data.locationId);
        if(!s.inventoryItems.some(i=>i.ingredientId===data.ingredientId))fail('missing_inventory_unit','Configure an explicit inventory base unit first');
        if(s.inventoryAssignments.some(a=>a.ingredientId===data.ingredientId&&a.locationId===data.locationId))fail('revision_conflict','Assignment exists; revise or restore it using its version');
        row=add('inventoryAssignments',{ingredientId:data.ingredientId,locationId:data.locationId,countUnit:data.countUnit,sortOrder:data.sortOrder,active:true,version:1});
      }
      if(command==='updateAssignment'){
        row=get(s,'inventoryAssignments',data.assignmentId);
        if(data.active){active(s,'ingredients',row.ingredientId);active(s,'inventoryLocations',row.locationId);}
        row=update('inventoryAssignments',row,{countUnit:data.countUnit,sortOrder:data.sortOrder,active:data.active});
      }
      if(command==='startCount'){
        const location=active(s,'inventoryLocations',data.locationId),observedAt=timestamp(data.observedAt);
        if(observedAt>now)fail('invalid_observation_time','A physical observation cannot be in the future');
        row=add('countSessions',{locationId:location.id,actorId:actor.id,observedAt,status:'draft',submittedAt:null,notes:data.notes,snapshot:{location:locationView(location),items:expectedItems(s,location.id)},version:1});
      }
      if(command==='enterCount'){
        const session=get(s,'countSessions',data.sessionId);ownDraft(session);
        const item=session.snapshot.items.find(i=>i.ingredientId===data.ingredientId);
        if(!item)fail('not_on_sheet','Item is not in this count sheet snapshot');
        const existing=heads(s.inventoryObservations.filter(o=>o.sessionId===session.id&&o.ingredientId===item.ingredientId),now)[0];
        if((existing?.id??null)!==data.expectedRevisionId)fail('revision_conflict','Observation changed; reload before saving');
        const observedAt=timestamp(data.observedAt??existing?.observedAt??session.observedAt);
        if(observedAt>now)fail('invalid_observation_time','A physical observation cannot be in the future');
        let conversion;
        if(existing){
          if(existing.unit!==data.unit||existing.observedAt!==observedAt)fail('immutable_observation','An observation revision retains its original unit and time');
          conversion=existing.conversion;
        }else{
          const result=resolveConversion(s,{ingredientId:item.ingredientId,quantity:'1',fromUnit:data.unit,toUnit:item.baseUnit,at:observedAt,knownAt:now});
          conversion={status:result.status,fromUnit:data.unit,baseUnit:item.baseUnit,at:observedAt,knownAt:now,...(result.status==='resolved'?{factor:rational(result.amount),measurementIds:result.measurementIds}:{blocker:{reason:result.status,...(result.requiredBridge?{requiredBridge:result.requiredBridge}:{}),...(result.measurementIds?{measurementIds:result.measurementIds}:{})}})};
        }
        row={id:randomUUID(),sessionId:session.id,ingredientId:item.ingredientId,quantity:data.quantity,unit:data.unit,observedAt,recordedAt:now,actorId:actor.id,supersedesId:existing?.id??null,reason:null,conversion:structuredClone(conversion)};
        s.inventoryObservations.push(row);audit('inventoryObservations',existing,row);
      }
      if(command==='submitCount'){
        const session=get(s,'countSessions',data.sessionId);ownDraft(session);
        const actual=heads(s.inventoryObservations.filter(o=>o.sessionId===session.id),now).map(o=>o.id).sort();
        const expected=[...data.expectedObservationIds].sort();
        if(JSON.stringify(actual)!==JSON.stringify(expected))fail('revision_conflict','Sheet entries changed; reload before submitting');
        row=update('countSessions',session,{status:'submitted',submittedAt:now});
      }
      if(command==='correctCount'){
        const original=get(s,'inventoryObservations',data.observationId),session=get(s,'countSessions',original.sessionId);
        if(session.status!=='submitted')fail('invalid_state','Only submitted observations can be corrected');
        const current=heads(s.inventoryObservations.filter(o=>o.sessionId===session.id&&o.ingredientId===original.ingredientId),now)[0];
        if(current?.id!==data.expectedRevisionId)fail('revision_conflict','Observation changed; reload before correcting');
        row={...structuredClone(current),id:randomUUID(),quantity:data.quantity,recordedAt:now,actorId:actor.id,supersedesId:current.id,reason:data.reason};
        s.inventoryObservations.push(row);audit('inventoryObservations',current,row);
      }
      return {id:row.id,changeId,...(row.version?{version:row.version}:{})};
    });
  }
  async locations(actor,{includeInactive=false}={}){authorize(actor,'inventory.count');return (await this.repository.read()).inventoryLocations.filter(l=>includeInactive||l.active).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)).map(locationView);}
  async countSheet(actor,locationId){authorize(actor,'inventory.count');const s=await this.repository.read(),location=active(s,'inventoryLocations',id.parse(locationId));return {location:locationView(location),items:expectedItems(s,location.id)};}
  async session(actor,sessionId,input={}){
    authorize(actor,'inventory.count');const s=await this.repository.read(),session=get(s,'countSessions',id.parse(sessionId)),{knownAt}=this.context(input);
    if(session.actorId!==actor.id&&!can(actor,'inventory.history'))fail('forbidden','Previous sheets require inventory history capability');
    if(session.createdAt>knownAt)fail('not_found','Count did not exist at requested knowledge time');
    const rows=s.inventoryObservations.filter(o=>o.sessionId===session.id&&o.recordedAt<=knownAt),current=heads(rows,knownAt),submitted=session.submittedAt!==null&&session.submittedAt<=knownAt;
    return {id:session.id,locationId:session.locationId,actorId:session.actorId,observedAt:session.observedAt,createdAt:session.createdAt,submittedAt:submitted?session.submittedAt:null,status:submitted?'submitted':'draft',version:submitted?session.version:1,notes:session.notes,snapshot:structuredClone(session.snapshot),observations:current.map(observationView),missingIngredientIds:session.snapshot.items.filter(i=>!current.some(o=>o.ingredientId===i.ingredientId)).map(i=>i.ingredientId),...(can(actor,'inventory.history')?{revisions:rows.map(observationView)}:{})};
  }
  async sessions(actor,input={}){
    authorize(actor,'inventory.history');const q=z.object({locationId:id.optional(),from:z.string().optional(),to:z.string().optional(),knownAt:z.string().optional()}).strict().parse(input),knownAt=timestamp(q.knownAt??this.clock()),from=q.from?timestamp(q.from):null,to=q.to?timestamp(q.to):null;
    if(from&&to&&from>to)fail('invalid_request','Invalid inventory date range');
    return (await this.repository.read()).countSessions.filter(s=>s.submittedAt&&s.submittedAt<=knownAt&&(!q.locationId||s.locationId===q.locationId)&&(!from||s.observedAt>=from)&&(!to||s.observedAt<=to)).sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||a.id.localeCompare(b.id)).map(s=>({id:s.id,locationId:s.locationId,actorId:s.actorId,observedAt:s.observedAt,submittedAt:s.submittedAt,locationName:s.snapshot.location.name}));
  }
  latestAt(s,ingredientId,locationId,context){
    const sessions=new Set(s.countSessions.filter(c=>c.locationId===locationId&&c.status==='submitted'&&c.submittedAt<=context.knownAt).map(c=>c.id));
    const rows=heads(s.inventoryObservations.filter(o=>o.ingredientId===ingredientId&&sessions.has(o.sessionId)&&o.observedAt<=context.at),context.knownAt);
    rows.sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||a.id.localeCompare(b.id));
    if(!rows.length)return {status:'missing_observation',observation:null,ageMilliseconds:null};
    const tied=rows.filter(r=>r.observedAt===rows[0].observedAt);
    if(tied.length>1)return {status:'conflicting_observations',observation:null,candidates:tied.map(observationView),ageMilliseconds:Date.parse(context.at)-Date.parse(rows[0].observedAt)};
    return {status:rows[0].conversion.status==='resolved'?'resolved':'unresolved_conversion',observation:observationView(rows[0]),ageMilliseconds:Date.parse(context.at)-Date.parse(rows[0].observedAt)};
  }
  overallFrom(s,ingredientId,context){
    const ingredient=configurationAt(s,'ingredients',context.knownAt).find(i=>i.id===ingredientId),config=s.inventoryItems.find(i=>i.ingredientId===ingredientId&&i.createdAt<=context.knownAt);
    if(!ingredient)fail('not_found','Ingredient did not exist at requested knowledge time');
    const assignments=configurationAt(s,'inventoryAssignments',context.knownAt),locationRecords=configurationAt(s,'inventoryLocations',context.knownAt);
    if(!config)fail('missing_inventory_unit','Inventory base unit is not configured');
    const sessionIds=new Set(s.inventoryObservations.filter(o=>o.ingredientId===ingredientId&&o.recordedAt<=context.knownAt&&o.observedAt<=context.at).map(o=>o.sessionId));
    const locations=new Set([...assignments.filter(a=>a.ingredientId===ingredientId&&a.active).map(a=>a.locationId),...s.countSessions.filter(c=>sessionIds.has(c.id)&&c.submittedAt&&c.submittedAt<=context.knownAt).map(c=>c.locationId)]);
    const breakdown=[...locations].map(locationId=>({location:locationView(locationRecords.find(l=>l.id===locationId)),...this.latestAt(s,ingredientId,locationId,context)})).sort((a,b)=>a.location.sortOrder-b.location.sortOrder||a.location.id.localeCompare(b.location.id));
    let total=E.of('0');for(const b of breakdown)if(b.status==='resolved')total=total.add(exact(b.observation.exactBaseQuantity));
    const complete=breakdown.length>0&&breakdown.every(b=>b.status==='resolved');
    const times=breakdown.flatMap(b=>b.observation?[b.observation.observedAt]:b.candidates?.map(c=>c.observedAt)??[]).sort();
    return {kind:'physical_observation_summary',ingredientId,name:ingredient.name,active:ingredient.active,baseUnit:config.baseUnit,...context,status:complete?'resolved':'unresolved',overallQuantity:complete?total.decimal():null,exactOverallQuantity:complete?rational(total):null,knownSubtotal:total.decimal(),exactKnownSubtotal:rational(total),breakdown,mixedObservationTimes:new Set(times).size>1,oldestObservedAt:times[0]??null,newestObservedAt:times.at(-1)??null,simultaneous:false,coverageBasis:'assignments_as_known_plus_recorded_locations'};
  }
  async overall(actor,ingredientId,input={}){authorize(actor,'inventory.count');return this.overallFrom(await this.repository.read(),id.parse(ingredientId),this.context(input));}
  async locationObservations(actor,locationId,input={}){
    authorize(actor,'inventory.count');const s=await this.repository.read(),context=this.context(input),location=configurationAt(s,'inventoryLocations',context.knownAt).find(l=>l.id===id.parse(locationId));
    if(!location)fail('not_found','Location did not exist at requested knowledge time');
    const sessionIds=new Set(s.countSessions.filter(c=>c.locationId===location.id&&c.submittedAt&&c.submittedAt<=context.knownAt).map(c=>c.id));
    const items=new Set([...configurationAt(s,'inventoryAssignments',context.knownAt).filter(a=>a.locationId===location.id&&a.active).map(a=>a.ingredientId),...s.inventoryObservations.filter(o=>sessionIds.has(o.sessionId)&&o.recordedAt<=context.knownAt).map(o=>o.ingredientId)]);
    return {location:locationView(location),...context,kind:'physical_observations',items:[...items].map(ingredientId=>({ingredientId,name:get(s,'ingredients',ingredientId).name,...this.latestAt(s,ingredientId,location.id,context)}))};
  }
}
module.exports={InventoryService,schemas};
