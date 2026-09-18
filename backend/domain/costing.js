'use strict';
const { Exact: E } = require('./exact');
const { latest, grouped } = require('./history');
const { resolveConversion } = require('./measurements');

function costIngredient(state, request) {
  const { at, knownAt, currency = 'USD' } = request;
  const select = rows => latest(rows,at,knownAt);
  const zero = () => ({material:E.of('0'),labor:E.of('0'),blockers:[],references:[],resolvedComponents:0,totalComponents:0});
  function block(result,reason,path,details={}) { result.blockers.push({reason,ingredientId:path.at(-1),path:[...path],...details}); }
  function merge(target,child,factor=E.of('1')) {
    target.material=target.material.add(child.material.mul(factor)); target.labor=target.labor.add(child.labor.mul(factor));
    target.blockers.push(...child.blockers); target.references.push(...child.references);
  }
  function conversion(id,q,from,to,path,result) {
    const c=resolveConversion(state,{ingredientId:id,quantity:q,fromUnit:from,toUnit:to,at,knownAt});
    if(c.status!=='resolved') { block(result,c.status,path,{conversion:c}); return null; }
    result.references.push(...c.measurementIds); return c.amount;
  }
  function walk(id,qty,requestedUnit,path=[]) {
    const result=zero();
    if(path.includes(id)) { block(result,'cycle',[...path,id],{cyclePath:[...path.slice(path.indexOf(id)),id]}); return result; }
    path=[...path,id];
    if (!state.ingredients.some(i=>i.id===id)) { block(result,'missing_ingredient',path);return result; }
    const basis=select(state.bases.filter(r=>r.ingredientId===id));
    if(!basis) {block(result,'missing_cost_basis',path);return result;}
    result.references.push(basis.id);
    if(basis.kind==='purchase') {
      result.totalComponents++;
      const option=state.purchaseOptions.find(o=>o.id===basis.purchaseOptionId);
      const price=option && select(state.prices.filter(p=>p.purchaseOptionId===option.id));
      if(!option) block(result,'missing_purchase_option',path);
      else {
        result.references.push(option.id);
        if(!price) block(result,'missing_price',path,{purchaseOptionId:option.id});
        else {
          result.references.push(price.id);
          if(price.currency!==currency) block(result,'currency_mismatch',path,{expected:currency,actual:price.currency});
        }
        const converted=conversion(id,qty,requestedUnit,option.contentUnit,path,result);
        if(converted!==null && price && price.currency===currency) { result.material=converted.div(E.of(option.contentQuantity)).mul(E.of(price.amount));result.resolvedComponents++; }
      }
    } else if(basis.kind==='source') {
      result.totalComponents++;
      const y=select(state.yields.filter(r=>r.ingredientId===id));
      if(!y || !y.sourceQuantity || !y.sourceUnit || !y.outputQuantity || !y.outputUnit) block(result,'missing_yield',path,{sourceIngredientId:y?.sourceIngredientId||null});
      else {
        result.references.push(y.id);
        const out=conversion(id,qty,requestedUnit,y.outputUnit,path,result);
        if(out!==null) {
          const child=walk(y.sourceIngredientId,y.sourceQuantity,y.sourceUnit,path);
          merge(result,child,out.div(E.of(y.outputQuantity)));
          if(!child.blockers.length) result.resolvedComponents++;
        }
      }
    } else if(basis.kind==='recipe') {
      const recipe=state.recipes.find(r=>r.id===basis.recipeId && r.outputIngredientId===id);
      const revision=recipe && select(state.recipeRevisions.filter(r=>r.recipeId===recipe.id));
      if(!revision) block(result,'missing_recipe_revision',path,{recipeId:basis.recipeId});
      else {
        result.references.push(revision.id); result.totalComponents+=revision.lines.length;
        if(!revision.outputQuantity || !revision.outputUnit) block(result,'missing_yield',path,{recipeId:recipe.id});
        else if(!revision.lines.length) block(result,'missing_recipe_inputs',path,{recipeId:recipe.id});
        else {
          const out=conversion(id,qty,requestedUnit,revision.outputUnit,path,result);
          if(out!==null) {
            const factor=out.div(E.of(revision.outputQuantity));
            for(const line of revision.lines) {
              if(line.quantity===null || !line.unit) {block(result,'missing_recipe_quantity',path,{lineId:line.id});continue;}
              const child=walk(line.ingredientId,line.quantity,line.unit,path);
              child.blockers=child.blockers.map(b=>({...b,linePath:[line.id,...(b.linePath||[])]}));
              merge(result,child,factor); if(!child.blockers.length) result.resolvedComponents++;
            }
          }
        }
      }
    } else if(basis.kind!=='labor_only') block(result,'invalid_cost_basis',path);

    const labor=grouped(state.labor.filter(r=>r.ingredientId===id),'componentKey',at,knownAt);
    if(basis.kind==='labor_only'&&!labor.length) block(result,'missing_labor',path);
    for(const component of labor) {
      result.totalComponents++;result.references.push(component.id);
      if(!component.outputQuantity || !component.outputUnit) {block(result,'incomplete_labor',path,{laborId:component.id});continue;}
      const out=conversion(id,qty,requestedUnit,component.outputUnit,path,result);if(out===null)continue;
      let amount;
      if(component.kind==='fixed') {
        if(component.amount===null) {block(result,'incomplete_labor',path,{laborId:component.id});continue;}
        if(component.currency!==currency) {block(result,'currency_mismatch',path,{laborId:component.id});continue;}
        amount=E.of(component.amount);
      } else {
        if(component.minutes===null || !component.department) {block(result,'incomplete_labor',path,{laborId:component.id});continue;}
        const rate=select(state.laborRates.filter(r=>r.department===component.department));
        if(!rate) {block(result,'missing_labor_rate',path,{department:component.department});continue;}
        result.references.push(rate.id);
        if(rate.currency!==currency) {block(result,'currency_mismatch',path,{laborId:component.id});continue;}
        amount=E.of(component.minutes).div(E.of('60')).mul(E.of(rate.amount));
      }
      result.labor=result.labor.add(amount.mul(out).div(E.of(component.outputQuantity)));result.resolvedComponents++;
    }
    return result;
  }
  const result=walk(request.ingredientId,request.quantity,request.unit);
  const subtotal=result.material.add(result.labor);
  return {status:result.blockers.length?'unresolved':'resolved',completeCost:result.blockers.length?null:subtotal,
    knownSubtotal:subtotal,materialSubtotal:result.material,laborSubtotal:result.labor,
    resolvedComponents:result.resolvedComponents,totalComponents:result.totalComponents,
    blockers:result.blockers,references:[...new Set(result.references)],at,knownAt,currency};
}

// Validate every effective boundary, including scheduled future edits. Writes are
// serialized by the repository, preventing concurrent reciprocal dependencies.
function assertAcyclic(state) {
  const times=[...new Set(['9999-12-31T23:59:59.999Z',...state.bases,...state.yields,...state.recipeRevisions].map(r=>typeof r==='string'?r:r.effectiveAt).filter(Boolean))].sort();
  for(const at of times) for(const includeUndated of [false,true]) {
    // Undated evidence cannot be costed, but its conceptual links must also be
    // cycle-safe before a later migration policy gives it an effective date.
    const graphRevision=rows=>(includeUndated && rows.filter(r=>r.effectiveAt===null&&r.active!==false).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt))[0])||latest(rows,at);
    const edges=new Map();
    for(const i of state.ingredients) {
      const basis=graphRevision(state.bases.filter(r=>r.ingredientId===i.id));
      let refs=[];
      if(basis?.kind==='source') {const y=graphRevision(state.yields.filter(r=>r.ingredientId===i.id));if(y)refs=[y.sourceIngredientId];}
      if(basis?.kind==='recipe') {const r=graphRevision(state.recipeRevisions.filter(r=>r.recipeId===basis.recipeId));if(r)refs=r.lines.map(l=>l.ingredientId);}
      edges.set(i.id,refs);
    }
    const done=new Set(),stack=[];
    function visit(id) {
      if(stack.includes(id)) {const error=new Error('Circular ingredient dependency');error.code='cycle';error.cyclePath=[...stack.slice(stack.indexOf(id)),id];throw error;}
      if(done.has(id))return; stack.push(id);for(const ref of edges.get(id)||[])visit(ref);stack.pop();done.add(id);
    }
    for(const id of edges.keys())visit(id);
  }
}
module.exports={costIngredient,assertAcyclic};
