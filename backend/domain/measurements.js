'use strict';
const { Exact: E } = require('./exact');
const { grouped } = require('./history');
const resolution=require('./resolution-context');

const STANDARD = Object.freeze({
  g: ['mass','1'], kg: ['mass','1000'], oz_wt: ['mass','28.349523125'], lb: ['mass','453.59237'],
  mL: ['volume','1'], L: ['volume','1000'], fl_oz_us: ['volume','29.5735295625'],
  tsp_us: ['volume','4.92892159375'], tbsp_us: ['volume','14.78676478125'], cup_us: ['volume','236.5882365'],
  pint_us: ['volume','473.176473'], quart_us: ['volume','946.352946'], gallon_us: ['volume','3785.411784'],
  each: ['count','1']
});
const OPERATIONAL = Object.freeze(['dash_fluid','dash_mass','drop','pump','scoop','packet','piece','barspoon','splash']);
function unit(value) {
  if (STANDARD[value]) return { node: STANDARD[value][0], factor: E.of(STANDARD[value][1]) };
  if (OPERATIONAL.includes(value) || /^op:[a-z][a-z0-9_]{0,39}$/.test(value)) return { node: value, factor: E.of('1') };
  throw new Error('Unknown or ambiguous unit: ' + value);
}
function activeMeasurements(state, ingredientId, at, knownAt) {
  return grouped(resolution.rows(state,'measurements','ingredientId',ingredientId),'measurementKey',at,knownAt);
}
function resolveConversion(state, request) {
  const cache=resolution.context(state);
  if(!cache)return uncachedConversion(state,request);
  // Resolve a unit quantity once; scaling remains exact. Invalid quantities must
  // still be rejected before reusing any path. Cache status/provenance as well.
  try{const q=E.of(request.quantity);if(!q.nonnegative())throw new Error('Quantity must be nonnegative');
   const key=JSON.stringify([request.ingredientId,request.fromUnit,request.toUnit,request.at,request.knownAt]);
   let c=cache.conversions.get(key);if(!c){c=uncachedConversion(state,{...request,quantity:'1'});cache.conversions.set(key,c);}else cache.stats.conversionHits++;
   return c.status==='resolved'?{...c,amount:c.amount.mul(q),measurementIds:[...c.measurementIds]}:{...c};
  }catch(error){return {status:'invalid_request',message:error.message};}
}
function uncachedConversion(state, { ingredientId, quantity, fromUnit, toUnit, at, knownAt }) {
  try {
    const q = E.of(quantity), from = unit(fromUnit), to = unit(toUnit);
    if (!q.nonnegative()) throw new Error('Quantity must be nonnegative');
    if (!state.ingredients.some(i => i.id === ingredientId)) throw new Error('Ingredient does not exist');
    const graph = new Map();
    function edge(a,b,f,id) { if (!graph.has(a)) graph.set(a,[]); graph.get(a).push({to:b,f,id}); }
    for (const m of activeMeasurements(state,ingredientId,at,knownAt)) {
      const a = unit(m.fromUnit), b = unit(m.toUnit);
      const left = E.of(m.fromQuantity).mul(a.factor), right = E.of(m.toQuantity).mul(b.factor);
      if (!left.positive() || !right.positive()) throw new Error('Measurement quantities must be positive');
      edge(a.node,b.node,right.div(left),m.id); edge(b.node,a.node,left.div(right),m.id);
    }
    const factors = new Map([[from.node,E.of('1')]]), paths = new Map([[from.node,[]]]), todo=[from.node];
    while (todo.length) {
      const node=todo.shift();
      for (const e of graph.get(node)||[]) {
        const f=factors.get(node).mul(e.f);
        if (factors.has(e.to)) {
          // Observation ratios are exact inputs; disagreement is never averaged away.
          if (!f.eq(factors.get(e.to))) return {status:'conflicting_measurement',ingredientId,fromUnit,toUnit,measurementIds:[...new Set([...paths.get(node),e.id,...paths.get(e.to)])]};
        } else { factors.set(e.to,f); paths.set(e.to,[...paths.get(node),e.id]); todo.push(e.to); }
      }
    }
    if (!factors.has(to.node)) return {status:'unresolved_missing_measurement',ingredientId,fromUnit,toUnit,requiredBridge:{from:from.node,to:to.node}};
    const amount=q.mul(from.factor).mul(factors.get(to.node)).div(to.factor);
    return {status:'resolved',amount,measurementIds:paths.get(to.node)};
  } catch (error) { return {status:'invalid_request',message:error.message}; }
}
module.exports = { STANDARD, OPERATIONAL, unit, activeMeasurements, resolveConversion };
