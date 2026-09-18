'use strict';
// Independent workbook formula model for reconciliation only. Never used by the app.
const {Exact:E}=require('../domain/exact');
const {decimal,key}=require('./importer');
function workbookCosts(records){
 const rows=n=>records.filter(r=>r.sheet===n).map(r=>r.values),index=(n,k)=>new Map(rows(n).map(r=>[key(r[k]),r]));
 const ingredients=index('Ingredients','IngredientName'),yields=index('Yields','ProductName'),recipes=index('Recipe Catalog','RecipeName'),densities=index('Densities','IngredientName'),units=index('Conversions','Unit'),groups=new Map(),memo=new Map();
 for(const l of rows('RecipeLines')){const k=key(l.RecipeName);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(l);}
 const number=x=>E.of(decimal(x));
 function line(name,q,u,path=[]){const k=key(name),v=ingredients.get(k),use=units.get(key(u));if(!use)return null;
  if(v&&v.Size&&v.BuyPrice!==undefined){const buy=units.get(key(v.PurchaseUnit));if(!buy)return null;const p=number(v.BuyPrice).div(number(v.Size));if(buy.Type===use.Type)return p.mul(q).mul(number(use.ToBase)).div(number(buy.ToBase));const d=densities.get(k);if(d){const gpc=number(d.GramsPerCup),cup=number(units.get('cup').ToBase);if(buy.Type==='weight'&&use.Type==='volume')return p.mul(q).mul(number(use.ToBase)).div(cup).mul(gpc).div(number(buy.ToBase));if(buy.Type==='volume'&&use.Type==='weight')return p.mul(q).mul(number(use.ToBase)).div(number(buy.ToBase).div(cup).mul(gpc));}}
  const y=yields.get(k);if(y){const source=line(y.SourceIngredient,E.of('1'),y.PurchaseUnit,path),yu=units.get(key(y.YieldUnit));if(!source||!y.YieldValue)return null;const p=source.div(number(y.YieldValue));return yu&&yu.Type===use.Type?p.mul(q).mul(number(use.ToBase)).div(number(yu.ToBase)):p.mul(q);}
  const r=recipes.get(k);if(r){if(path.includes(k))return null;const c=batch(k,[...path,k]),out=units.get(key(r.BatchYieldUnit));if(c&&out&&out.Type===use.Type)return c.total.div(number(r.BatchYieldQty)).mul(q).mul(number(use.ToBase)).div(number(out.ToBase));}return null;
 }
 function batch(k,path=[]){if(memo.has(k))return memo.get(k);let total=E.of('0'),missing=0;for(const l of groups.get(k)||[]){let amount=null;try{amount=line(l.IngredientName,number(l.Qty),l.Unit,path);}catch{}if(amount===null)missing++;else total=total.add(amount);}const r=recipes.get(k);if(r?.LaborCost)total=total.add(number(r.LaborCost));const result={total,missing};memo.set(k,result);return result;}
 return new Map([...recipes.keys()].map(k=>[k,batch(k,[k])]));
}
module.exports={workbookCosts};
