'use strict';
// Opt-in, request-owned immutable snapshots only. Never attach to mutable write
// state; a new request always obtains new facts, including effective boundaries.
const contexts=new WeakMap();
function enableResolutionCache(state){contexts.set(state,{indexes:new Map(),facts:new Map(),conversions:new Map(),costs:new Map(),stats:{costHits:0,conversionHits:0,factHits:0}});return state;}
function context(state){return contexts.get(state);}
function rows(state,name,field,value){const c=context(state);if(!c)return state[name].filter(r=>r[field]===value);const key=name+':'+field;if(!c.indexes.has(key)){const m=new Map();for(const r of state[name]){if(!m.has(r[field]))m.set(r[field],[]);m.get(r[field]).push(r);}c.indexes.set(key,m);}return c.indexes.get(key).get(value)||[];}
function select(state,records,at,knownAt){const c=context(state);if(!c)return require('./history').latest(records,at,knownAt);let m=c.facts.get(records);if(!m){m=new Map();c.facts.set(records,m);}const key=at+'|'+knownAt;if(m.has(key)){c.stats.factHits++;return m.get(key);}const result=require('./history').latest(records,at,knownAt);m.set(key,result);return result;}
module.exports={enableResolutionCache,context,rows,select};
