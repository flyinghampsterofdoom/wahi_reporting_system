'use strict';
const {latest}=require('./history');
const BIG_8=Object.freeze(['Milk','Eggs','Fish','Shellfish','Tree Nuts','Peanuts','Wheat','Soy']);
function unique(values){const found=new Set(values);return BIG_8.filter(value=>found.has(value));}
// Resolve from the current graph on every snapshot; inherited tags are never
// copied into stored ingredient metadata or recipe history.
function resolver(state,{at,knownAt=at}={}){
 const items=new Map(state.ingredients.map(i=>[i.id,i]));
 const recipes=new Map(state.recipes.map(r=>[r.outputIngredientId,r]));
 const current=rows=>latest(rows,at,knownAt),cache=new Map();
 const by=(rows,key)=>{const index=new Map();for(const row of rows){if(!index.has(row[key]))index.set(row[key],[]);index.get(row[key]).push(row);}return index;};
 const revisions=by(state.recipeRevisions,'recipeId'),bases=by(state.bases,'ingredientId'),yields=by(state.yields,'ingredientId');
 function ingredient(id,ancestors=new Set()){
  if(cache.has(id))return [...cache.get(id)];
  if(ancestors.has(id))return [];
  const item=items.get(id);if(!item)return [];
  const path=new Set(ancestors);path.add(id);const found=[...(item.allergens||[])];
  const recipe=recipes.get(id),revision=recipe&&current(revisions.get(recipe.id)||[]);
  for(const line of revision?.lines||[])found.push(...ingredient(line.ingredientId,path));
  const basis=current(bases.get(id)||[]);
  if(basis?.kind==='source'){
   const source=current(yields.get(id)||[]);
   if(source)found.push(...ingredient(source.sourceIngredientId,path));
  }
  const result=unique(found);cache.set(id,result);return [...result];
 }
 function recipe(recipeId){const r=state.recipes.find(r=>r.id===recipeId);return r?ingredient(r.outputIngredientId):[];}
 function document(doc){const found=[];const visit=nodes=>{for(const n of nodes||[]){for(const i of n.ingredients||[])if(i.ingredientId)found.push(...ingredient(i.ingredientId));visit(n.children);}};visit(doc.components);return unique(found);}
 return {ingredient,recipe,document};
}
module.exports={BIG_8,unique,resolver};
