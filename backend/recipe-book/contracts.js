'use strict';
const {z}=require('zod');
const id=z.string().uuid(),text=z.string().trim().min(1).max(500),note=z.string().max(10000);
const quantity=z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,24})?$/);
const ingredient=z.object({id,ingredientId:id.nullable(),name:text,quantity:quantity.nullable(),unit:z.string().trim().min(1).max(80).nullable(),notes:note.default('')}).strict();
const instruction=z.object({id,text:note.trim().min(1)}).strict();
const component=z.lazy(()=>z.object({id,type:z.enum(['recipe','ingredients','preparation','garnish','glassware','notes']),visibleTitle:text,
 sourceRecipeId:id.nullable().default(null),sourceRevisionId:id.nullable().default(null),collapsed:z.boolean().default(false),outputQuantity:quantity.nullable().default(null),outputUnit:z.string().trim().min(1).max(80).nullable().default(null),
 ingredients:z.array(ingredient).max(200).default([]),instructions:z.array(instruction).max(200).default([]),children:z.array(component).max(100).default([])
}).strict());
const schema=z.object({schemaVersion:z.literal(1),title:text,photoId:id.nullable().default(null),components:z.array(component).max(100)}).strict();
const fail=()=>{throw Object.assign(new Error('Invalid service recipe'),{code:'invalid_request'});};
function document(input,{publish=false}={}){
 // Bound depth and total work before recursive schema parsing (also detects object cycles).
 let count=0,items=0;const seen=new Set(),identities=new Set();
 function shape(nodes,depth){if(depth>8||!Array.isArray(nodes)||nodes.length>100)fail();for(const c of nodes){if(!c||typeof c!=='object'||seen.has(c)||++count>200)fail();seen.add(c);items+=(Array.isArray(c.ingredients)?c.ingredients.length:0)+(Array.isArray(c.instructions)?c.instructions.length:0);if(items>1000)fail();if(c.children!==undefined)shape(c.children,depth+1);}}
 shape(input?.components,1);const d=schema.parse(input);let ingredients=0,preparation=0,garnish=0,glassware=0;
 function visit(nodes,ancestors=[]){for(const c of nodes){if(c.sourceRecipeId&&ancestors.includes(c.sourceRecipeId))fail();for(const row of [c,...c.ingredients,...c.instructions]){if(identities.has(row.id))fail();identities.add(row.id);}if(!!c.sourceRecipeId!==!!c.sourceRevisionId||c.sourceRecipeId&&c.type!=='recipe')fail();
 for(const i of c.ingredients){ingredients++;if(publish&&(i.quantity===null||i.unit===null))fail();}
 if(c.type==='garnish')garnish+=c.instructions.length;if(c.type==='preparation')preparation+=c.instructions.length;if(c.type==='glassware')glassware+=c.instructions.length;visit(c.children,c.sourceRecipeId?[...ancestors,c.sourceRecipeId]:ancestors);}}
 visit(d.components);if(publish&&(!ingredients||!preparation||!garnish||!glassware))fail();return d;
}
const command=z.object({id,expectedVersion:z.number().int().positive()}).strict();
const offline=Object.freeze({schemaVersion:1,maxRetentionMs:12*60*60*1000,publishedOnly:true,approvedPhotosOnly:true,clearOnLogout:true,clearOnAccountSwitch:true});
function offlineLease({accountId,environment,authorizationGeneration,sessionExpiresAt,now=Date.now()}){
 if(!accountId||!environment||!authorizationGeneration||!Number.isFinite(sessionExpiresAt)||sessionExpiresAt<=now)fail();
 return {...offline,scope:JSON.stringify([environment,accountId,authorizationGeneration]),refreshedAt:new Date(now).toISOString(),expiresAt:new Date(Math.min(now+offline.maxRetentionMs,sessionExpiresAt)).toISOString()};
}
module.exports={document,documentSchema:schema,command,offline,offlineLease,id};
