'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compare}=require('../review/public/table-model');
test('shared tables compare exact decimal strings, signed currency and percentages',()=>{
 assert.ok(compare('USD 9.25','USD 100.01','number')<0);
 assert.ok(compare('-12.5','-2.1','number')<0);
 assert.ok(compare('9007199254740993.01','9007199254740993.02','number')<0);
 assert.ok(compare('10.2%','2.9%','number','desc')<0);
 assert.ok(compare('1,200 locations','99 locations','number')>0);
});
test('missing numeric/date values remain last in either direction',()=>{
 for(const direction of ['asc','desc'])for(const missing of ['—','Unknown','Incomplete','Not configured','Unresolved'])assert.ok(compare(missing,'USD 0','number',direction)>0);
 assert.ok(compare('Never','10/29/2026, 1:00:00 PM','date','desc')>0);
 assert.ok(compare('10/28/2026','10/29/2026','date')<0);
});
test('natural text order and stable ties',()=>{
 assert.ok(compare('Item 2','Item 10')<0);assert.equal(compare('Name','name'),0);
});
const vm=require('node:vm'),fs=require('node:fs');
function transport(fetch){
 const source=fs.readFileSync(require.resolve('../review/public/app.js'),'utf8'),code=source.slice(source.indexOf('let navigationRevision='),source.indexOf('\nfunction showMappingReload'));
 const context=vm.createContext({AbortController,DOMException,Map,fetch,me:{csrf:'synthetic-csrf'},location:{hash:'#catalog'}});vm.runInContext(code,context);return context;
}
test('navigation discards late success and error responses, even when transport ignores abort',async()=>{
 for(const status of [200,500]){let finish;const context=transport(()=>new Promise(r=>finish=r)),request=vm.runInContext("api('views/items')",context);context.location.hash='#home';vm.runInContext('++navigationRevision;navigationController.abort();navigationController=new AbortController()',context);finish({ok:status===200,status,json:async()=>({error:'Delayed failure',items:[]}),headers:new Headers()});await assert.rejects(request,{name:'AbortError'});}
});
test('concurrent reads deduplicate only until settled; subsequent reads stay fresh',async()=>{
 let count=0,finish;const context=transport(()=>{count++;return new Promise(r=>finish=r);});const a=vm.runInContext("api('views/items')",context),b=vm.runInContext("api('views/items')",context);assert.equal(count,1);finish({ok:true,json:async()=>({version:1}),headers:new Headers()});assert.deepEqual(await a,await b);const c=vm.runInContext("api('views/items')",context);assert.equal(count,2);finish({ok:true,json:async()=>({version:2}),headers:new Headers()});assert.equal((await c).version,2);
});
test('mutations are neither deduplicated nor cancelled by navigation',async()=>{
 const calls=[],context=transport(async(url,options)=>{calls.push(options);return {ok:true,json:async()=>({saved:true}),headers:new Headers()};});await Promise.all([vm.runInContext("api('item/save',{id:'synthetic'})",context),vm.runInContext("api('item/save',{id:'synthetic'})",context)]);assert.equal(calls.length,2);for(const call of calls){assert.equal(call.method,'POST');assert.equal(call.signal,undefined);assert.equal(JSON.parse(call.body).id,'synthetic');}
});
