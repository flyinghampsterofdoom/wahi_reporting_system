'use strict';
const {z}=require('zod'),{service:displayQuantity}=require('../review/public/quantity');
const id=z.string().uuid(),text=z.string().trim().min(1).max(500),note=z.string().max(10000);
const quantity=z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,24})?$/);
const serviceQuantity=z.string().trim().min(1).max(80).refine(v=>!/[\x00-\x1f\x7f]/.test(v)&&(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,24})?$/.test(v)||/[\p{L}¼½¾⅓⅔⅛⅜⅝⅞]/u.test(v)||/^\d+\/\d+$/.test(v)));
const sourceMeasurement=z.object({recipeId:id,revisionId:id,lineId:id,quantity:quantity.nullable(),unit:z.string().max(80).nullable()}).strict();
const ingredient=z.object({id,ingredientId:id.nullable(),name:text,quantity:serviceQuantity.nullable(),unit:z.string().trim().min(1).max(80).nullable(),sourceMeasurement:sourceMeasurement.optional(),notes:note.default('')}).strict();
const instruction=z.object({id,text:note.trim().min(1)}).strict();
const component=z.lazy(()=>z.object({id,type:z.enum(['recipe','ingredients','preparation','garnish','glassware','notes']),visibleTitle:text,
 sourceRecipeId:id.nullable().default(null),sourceRevisionId:id.nullable().default(null),collapsed:z.boolean().default(false),outputQuantity:quantity.nullable().default(null),outputUnit:z.string().trim().min(1).max(80).nullable().default(null),
 ingredients:z.array(ingredient).max(200).default([]),instructions:z.array(instruction).max(200).default([]),children:z.array(component).max(100).default([])
}).strict());
const schema=z.object({schemaVersion:z.literal(1),title:text,photoId:id.nullable().default(null),components:z.array(component).max(100)}).strict();
const fail=(message='Check the recipe structure, nesting and unique row identifiers.')=>{throw Object.assign(new Error(message),{code:'invalid_request',recipeMessage:message});};
function document(input,{publish=false}={}){
 // Bound depth and total work before recursive schema parsing (also detects object cycles).
 let count=0,items=0;const seen=new Set(),identities=new Set();
 function shape(nodes,depth){if(depth>8||!Array.isArray(nodes)||nodes.length>100)fail();for(const c of nodes){if(!c||typeof c!=='object'||seen.has(c)||++count>200)fail();seen.add(c);items+=(Array.isArray(c.ingredients)?c.ingredients.length:0)+(Array.isArray(c.instructions)?c.instructions.length:0);if(items>1000)fail();if(c.children!==undefined)shape(c.children,depth+1);}}
 shape(input?.components,1);let d;try{d=schema.parse(input);}catch(e){if(e.name==='ZodError'){const path=e.issues[0]?.path||[],field=path.at(-1),labels={title:'recipe name',name:'ingredient name',quantity:'quantity',unit:'unit',visibleTitle:'component name',text:'instruction text',id:'row identifier',sourceRecipeId:'source recipe reference',sourceRevisionId:'source revision reference',outputQuantity:'yield quantity',outputUnit:'yield unit'};let node=input,context=[];for(const part of path.slice(0,-1)){node=node?.[part];if(typeof part==='number'&&node&&typeof node==='object'){const name=node.name||node.visibleTitle;if(typeof name==='string')context.push(name);}}e.recipeMessage=(context.length?context.join(' → ')+': ':'')+'Check the '+(labels[field]||'recipe field')+'. '+(['quantity','outputQuantity'].includes(field)?'Use a decimal quantity such as 0.5.':'Supply a valid value.');}throw e;}let ingredients=0;
 function visit(nodes,ancestors=[]){for(const c of nodes){if(c.sourceRecipeId&&ancestors.includes(c.sourceRecipeId))fail(c.visibleTitle+': this nested recipe refers back to an ancestor recipe.');for(const row of [c,...c.ingredients,...c.instructions]){if(identities.has(row.id))fail(c.visibleTitle+': two component or ingredient rows share an identifier. Reinsert the duplicated row.');identities.add(row.id);}if(!!c.sourceRecipeId!==!!c.sourceRevisionId||c.sourceRecipeId&&c.type!=='recipe')fail(c.visibleTitle+': the source recipe and revision references must remain paired on a recipe component.');
 for(const i of c.ingredients){ingredients++;if(publish){const label=c.visibleTitle+' → '+i.name;if(i.quantity===null)fail(label+': enter a quantity.');if(!displayQuantity(i.quantity).valid)fail(label+': enter a decimal quantity (for example, 0.5).');if(i.unit===null)fail(label+': enter a unit.');}}
 visit(c.children,c.sourceRecipeId?[...ancestors,c.sourceRecipeId]:ancestors);}}
 visit(d.components);if(publish&&!ingredients)fail('Add at least one ingredient with a quantity and unit before publishing.');return d;
}
const command=z.object({id,expectedVersion:z.number().int().positive()}).strict();
const offline=Object.freeze({schemaVersion:1,maxRetentionMs:12*60*60*1000,publishedOnly:true,approvedPhotosOnly:true,clearOnLogout:true,clearOnAccountSwitch:true});
function offlineLease({accountId,environment,authorizationGeneration,sessionExpiresAt,now=Date.now()}){
 if(!accountId||!environment||!authorizationGeneration||!Number.isFinite(sessionExpiresAt)||sessionExpiresAt<=now)fail();
 return {...offline,scope:JSON.stringify([environment,accountId,authorizationGeneration]),refreshedAt:new Date(now).toISOString(),expiresAt:new Date(Math.min(now+offline.maxRetentionMs,sessionExpiresAt)).toISOString()};
}
module.exports={document,documentSchema:schema,command,offline,offlineLease,id};
