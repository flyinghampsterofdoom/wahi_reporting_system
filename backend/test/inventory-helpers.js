'use strict';
const {fixture,admin,staff}=require('./helpers');
function inventoryFixture(repository){
  const f=fixture(repository),inventory=f.service.inventory;
  const run=(command,input,actor=admin)=>inventory.execute(actor,command,input);
  const location=async(name,sortOrder=0)=> (await run('createLocation',{name,sortOrder})).id;
  const item=async(name,baseUnit='each')=>{const ingredientId=await f.ingredient(name);await run('configureItem',{ingredientId,baseUnit});return ingredientId;};
  const assign=async(ingredientId,locationId,countUnit='each',sortOrder=0)=>(await run('assignItem',{ingredientId,locationId,countUnit,sortOrder})).id;
  const start=async(locationId,actor=staff,observedAt='2026-09-15T14:00:00Z')=>(await run('startCount',{locationId,observedAt},actor)).id;
  const enter=async(sessionId,ingredientId,quantity,unit='each',actor=staff,expectedRevisionId=null)=>(await run('enterCount',{sessionId,ingredientId,quantity,unit,expectedRevisionId},actor)).id;
  const submit=async(sessionId,actor=staff)=>{const s=await inventory.session(actor,sessionId);return run('submitCount',{sessionId,expectedVersion:s.version,expectedObservationIds:s.observations.map(o=>o.id)},actor);};
  const count=async(locationId,ingredientId,quantity,unit='each',actor=staff,observedAt)=>{const sessionId=await start(locationId,actor,observedAt),observationId=await enter(sessionId,ingredientId,quantity,unit,actor);await submit(sessionId,actor);return {sessionId,observationId};};
  return {...f,inventory,invRun:run,location,item,assign,start,enter,submit,count};
}
module.exports={inventoryFixture};
