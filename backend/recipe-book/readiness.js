'use strict';
const {latest}=require('../domain/history');
// Deliberately SELECT-only: importing candidates into drafts is a separate action.
async function inventory(pool,{at=new Date().toISOString()}={}){
 const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL statement_timeout='30s'");
 const recipes=(await c.query('SELECT id,name,active FROM wahi_v2.recipes ORDER BY lower(name),id')).rows;
 const revisions=(await c.query('SELECT * FROM wahi_v2.recipe_revisions')).rows.map(v=>({...v,effectiveAt:v.effective_at?.toISOString()??null,recordedAt:v.recorded_at.toISOString(),supersedesId:v.supersedes_id}));
 const lines=(await c.query('SELECT l.*,i.name FROM wahi_v2.recipe_lines l JOIN wahi_v2.ingredients i ON i.id=l.ingredient_id ORDER BY l.position')).rows;
 const steps=(await c.query('SELECT * FROM wahi_v2.recipe_steps ORDER BY position')).rows;
 const candidates=recipes.map(r=>{const v=latest(revisions.filter(v=>v.recipe_id===r.id),at,at),ingredients=lines.filter(l=>l.recipe_revision_id===v?.id).map(l=>({sourceLineId:l.id,ingredientId:l.ingredient_id,name:l.name,quantity:l.quantity,unit:l.unit,position:l.position,notes:l.notes})),preparation=steps.filter(s=>s.recipe_revision_id===v?.id).map(s=>s.instruction);const missing=[];if(!v)missing.push('current revision');if(!ingredients.length)missing.push('ingredients');if(ingredients.some(i=>i.quantity===null||!i.unit))missing.push('ingredient quantities/units');const serviceAuthoringRequired=[...(preparation.length?[]:['preparation']),'garnish','glassware','menu classification','reference photograph (optional for publication)'];return {...r,sourceRecipeId:r.id,sourceRevisionId:v?.id??null,ingredients,preparation,photographs:[],missing,serviceAuthoringRequired};});
 const groups=new Map();for(const r of candidates){const k=r.name.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();groups.set(k,[...(groups.get(k)||[]),r.id]);}const duplicates=[...groups.entries()].filter(([,ids])=>ids.length>1).map(([normalizedTitle,sourceRecipeIds])=>({normalizedTitle,sourceRecipeIds}));
 await c.query('COMMIT');return {at,scope:'Existing domain recipes; no recipe photograph fields exist in approved baseline',candidates,duplicates,summary:{recipes:candidates.length,withPreparation:candidates.filter(r=>r.preparation.length).length,withMissingQuantities:candidates.filter(r=>r.ingredients.some(i=>i.quantity===null||!i.unit)).length,withoutCurrentRevision:candidates.filter(r=>!r.sourceRevisionId).length,duplicateGroups:duplicates.length}};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
module.exports={inventory};
