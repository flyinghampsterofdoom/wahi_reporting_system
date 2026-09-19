'use strict';
// A single SQL statement supplies a consistent current snapshot. Historical
// reconstruction and authoritative write transactions continue to use read().
const {definitions,snake}=require('./schema');
const {emptyState}=require('../domain/state');
const {enableResolutionCache}=require('../domain/resolution-context');
const streams={bases:'ingredient_id',yields:'ingredient_id',measurements:'measurement_key',recipeRevisions:'recipe_id',prices:'purchase_option_id',labor:'component_key',laborRates:'department',sellingPrices:'menu_item_id',menuMappings:'menu_item_id',recipeCategoryAssignments:'recipe_id'};
function currentCTE(name){const table=snake(name),key=streams[name];return `c_${table} AS MATERIALIZED (SELECT DISTINCT ON (r.${key}) r.* FROM wahi_v2.${table} r WHERE r.effective_at <= $1::timestamptz AND r.recorded_at <= $1::timestamptz AND NOT EXISTS (SELECT 1 FROM wahi_v2.${table} replacement WHERE replacement.supersedes_id=r.id AND replacement.effective_at <= $1::timestamptz AND replacement.recorded_at <= $1::timestamptz) ORDER BY r.${key},r.effective_at DESC,r.recorded_at DESC)`;}
function object(name,alias='r'){
 return `${name==='purchaseOptions'?'jsonb_build_object':'json_build_object'}(${Object.entries(definitions[name]).filter(([key])=>!['provenance','actorId','note'].includes(key)).flatMap(([key,type])=>{let v=`${alias}.${snake(key)}`;if(type.startsWith('NUMERIC'))v+='::text';return [`'${key}'`,v];}).join(',')})`;
}
const identityScope={ingredients:'r.id IN (SELECT id FROM scope)',recipes:'r.output_ingredient_id IN (SELECT id FROM scope)',purchaseOptions:'r.ingredient_id IN (SELECT id FROM scope)',suppliers:'r.id IN (SELECT supplier_id FROM wahi_v2.purchase_options WHERE ingredient_id IN (SELECT id FROM scope))',inventoryItems:'r.ingredient_id IN (SELECT id FROM scope)',inventoryAssignments:'r.ingredient_id IN (SELECT id FROM scope)',inventoryLocations:'($2::uuid IS NULL AND $3::uuid IS NULL) OR r.id IN (SELECT location_id FROM wahi_v2.inventory_assignments WHERE ingredient_id IN (SELECT id FROM scope))',recipeCategories:'TRUE',menuItems:'r.id IN (SELECT menu_item_id FROM c_menu_mappings WHERE recipe_id IN (SELECT id FROM wahi_v2.recipes WHERE output_ingredient_id IN (SELECT id FROM scope)))'};
function query(){
 const ctes=Object.keys(streams).map(currentCTE);
 ctes.push(`edges AS (SELECT rr.output_ingredient_id AS parent,l.ingredient_id AS child FROM wahi_v2.recipes rr JOIN c_recipe_revisions rev ON rev.recipe_id=rr.id AND rev.active JOIN wahi_v2.recipe_lines l ON l.recipe_revision_id=rev.id UNION SELECT b.ingredient_id,y.source_ingredient_id FROM c_bases b JOIN c_yields y ON y.ingredient_id=b.ingredient_id AND y.active WHERE b.active AND b.kind='source')`);
 ctes.push(`scope(id) AS (SELECT id FROM wahi_v2.ingredients WHERE ($2::uuid IS NULL AND $3::uuid IS NULL AND (NOT $4::boolean OR id IN (SELECT output_ingredient_id FROM wahi_v2.recipes))) OR id=$2::uuid OR id IN (SELECT output_ingredient_id FROM wahi_v2.recipes WHERE id=$3::uuid) UNION SELECT e.child FROM edges e JOIN scope s ON s.id=e.parent)`);
 ctes.push(`dependents(id) AS (SELECT $2::uuid WHERE $2::uuid IS NOT NULL UNION SELECT e.parent FROM edges e JOIN dependents d ON e.child=d.id)`);
 const arrays=[];
 for(const name of [...Object.keys(identityScope),...Object.keys(streams)]){
  const table=snake(name);let condition=identityScope[name];
  if(!condition){const key=streams[name];condition=key==='ingredient_id'||key==='measurement_key'||key==='component_key'?'r.ingredient_id IN (SELECT id FROM scope)':key==='recipe_id'?'r.recipe_id IN (SELECT id FROM wahi_v2.recipes WHERE output_ingredient_id IN (SELECT id FROM scope))':key==='purchase_option_id'?'r.purchase_option_id IN (SELECT id FROM wahi_v2.purchase_options WHERE ingredient_id IN (SELECT id FROM scope))':key==='menu_item_id'?'r.menu_item_id IN (SELECT menu_item_id FROM c_menu_mappings WHERE recipe_id IN (SELECT id FROM wahi_v2.recipes WHERE output_ingredient_id IN (SELECT id FROM scope)))':'TRUE';}
  let obj=object(name);
  if(name==='ingredients')obj=`(${obj})::jsonb || jsonb_build_object('hasBasisFacts',EXISTS(SELECT 1 FROM wahi_v2.bases b WHERE b.ingredient_id=r.id),'hasFutureBasisFacts',EXISTS(SELECT 1 FROM wahi_v2.bases b WHERE b.ingredient_id=r.id AND b.effective_at>$1::timestamptz))`;
  if(name==='purchaseOptions')obj+=` || jsonb_build_object('hasPriceFacts',EXISTS(SELECT 1 FROM wahi_v2.prices p WHERE p.purchase_option_id=r.id),'hasBasisFacts',EXISTS(SELECT 1 FROM wahi_v2.bases b WHERE b.purchase_option_id=r.id))`;
  arrays.push(`'${name}',COALESCE((SELECT json_agg(${obj}) FROM ${streams[name]?'c_'+table:'wahi_v2.'+table} r WHERE ${condition}),'[]'::json)`);
 }
 arrays.push(`'lines',COALESCE((SELECT json_agg(jsonb_build_object('id',l.id,'recipeRevisionId',l.recipe_revision_id,'ingredientId',l.ingredient_id,'quantity',l.quantity::text,'unit',l.unit,'notes',l.notes,'position',l.position) ORDER BY l.position) FROM wahi_v2.recipe_lines l JOIN c_recipe_revisions r ON r.id=l.recipe_revision_id JOIN wahi_v2.recipes rec ON rec.id=r.recipe_id WHERE rec.output_ingredient_id IN (SELECT id FROM scope)),'[]'::json)`);
 arrays.push(`'steps',COALESCE((SELECT json_agg(jsonb_build_object('id',l.id,'recipeRevisionId',l.recipe_revision_id,'position',l.position,'instruction',l.instruction) ORDER BY l.position) FROM wahi_v2.recipe_steps l JOIN c_recipe_revisions r ON r.id=l.recipe_revision_id JOIN wahi_v2.recipes rec ON rec.id=r.recipe_id WHERE rec.output_ingredient_id IN (SELECT id FROM scope)),'[]'::json)`);
 arrays.push(`'dependentRecipes',COALESCE((SELECT json_agg(jsonb_build_object('id',r.id,'name',r.name,'active',r.active)) FROM wahi_v2.recipes r WHERE r.output_ingredient_id IN (SELECT id FROM dependents WHERE id<>$2::uuid)),'[]'::json)`);
 arrays.push(`'operationalSummary',CASE WHEN $4::boolean THEN jsonb_build_object('items',(SELECT count(*) FROM wahi_v2.ingredients),'recipes',(SELECT count(*) FROM wahi_v2.recipes),'inventoryConfigured',(SELECT count(*) FROM wahi_v2.inventory_items),'locations',(SELECT count(*) FROM wahi_v2.inventory_locations WHERE active),'recentCounts',(SELECT COALESCE(json_agg(x),'[]') FROM (SELECT id,observed_at AS "observedAt",snapshot->'location'->>'name' AS "locationName" FROM wahi_v2.count_sessions WHERE status='submitted' ORDER BY observed_at DESC LIMIT 5) x)) ELSE NULL END`);
 return `WITH RECURSIVE ${ctes.join(',')} SELECT json_build_object(${arrays.join(',')}) AS state`;
}
const SQL=query();
async function readCurrent(pool,{at,itemId=null,recipeId=null,recipesOnly=false}={}){
 const raw=(await pool.query(SQL,[at,itemId,recipeId,recipesOnly])).rows[0].state;
 const s=Object.assign(emptyState(),raw);
 for(const [name,def] of Object.entries(definitions))for(const row of s[name]||[])for(const [key,type] of Object.entries(def))if(type.startsWith('TIMESTAMPTZ')&&row[key])row[key]=new Date(row[key]).toISOString();delete s.lines;delete s.steps;
 const by=(rows)=>{const m=new Map();for(const r of rows){if(!m.has(r.recipeRevisionId))m.set(r.recipeRevisionId,[]);m.get(r.recipeRevisionId).push(r);}return m;};
 const lines=by(raw.lines),steps=by(raw.steps);
 for(const r of s.recipeRevisions){r.lines=(lines.get(r.id)||[]).map(({recipeRevisionId,position,...l})=>l);r.steps=(steps.get(r.id)||[]).map(({recipeRevisionId,...l})=>l);}
 return enableResolutionCache(s);
}
module.exports={readCurrent,SQL};
