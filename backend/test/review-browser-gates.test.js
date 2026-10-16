'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {main}=require('../review-intelligence/gates/browser-probe.cjs');
test('gate: unavailable review panel fails visibly and closes fresh context/browser without login or retries',async()=>{
 let closedContexts=0,closedBrowsers=0,launches=0;
 const page={setDefaultTimeout(){},async goto(){},url:()=> 'https://www.google.com/maps/place/Wahi',async title(){return 'Wahi Hana Tiki Bar - Google Maps';},locator:()=>({async innerText(){return 'Wahi Hana';}}),getByRole(role,options){
  if(role==='main')return {async waitFor(){}};
  if(role==='tab'&&options)return {async waitFor(){throw new Error('timeout');},async count(){return 0;}};
  if(role==='tab')return {async allTextContents(){return ['Overview','About'];}};
  if(role==='button')return {async count(){return 0;}};
  if(role==='link')return {async count(){return 1;}};
  throw new Error('Unexpected action');
 }};
 const browser={async newContext(options){assert.equal(options.locale,'en-US');return {async newPage(){return page;},async close(){closedContexts++;}};},async close(){closedBrowsers++;}};
 const result=await main({async launch(options){launches++;assert.equal(options.headless,true);return browser;}});
 assert.equal(result.status,'failed');assert.equal(result.code,'gate_review_panel_unavailable_signed_out');assert.equal(result.results.length,0);assert.deepEqual(result.evidence.tabs,['Overview','About']);assert.equal(launches,1);assert.equal(closedContexts,1);assert.equal(closedBrowsers,1);
});
test('gate: a browser launch failure returns a failed result, never a false stability pass',async()=>{
 const result=await main({async launch(){throw new Error('missing_runtime_dependency');}});
 assert.equal(result.status,'failed');assert.equal(result.code,'missing_runtime_dependency');assert.equal(result.results.length,0);
});
