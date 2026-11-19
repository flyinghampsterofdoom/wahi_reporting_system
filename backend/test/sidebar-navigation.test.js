'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const shell=require('../review/public/shell-model'),{CAPABILITIES}=require('../auth');
function browserShell({route='home',role='ADMIN',tablet=false,googleConnection=false,reviewIntelligence=false}={}){
 const node=()=>({innerHTML:'',hidden:false,inert:false,attributes:{},classList:{toggle(){}},setAttribute(name,value){this.attributes[name]=value;},focus(){this.focused=true;}});
 const nodes=Object.fromEntries(['workspace','nav','nav-toggle','drawer-scrim','account'].map(id=>[id,node()])),content=node(),buttons=new Map();
 const document={querySelectorAll(selector){if(selector!=='[data-area-toggle]')return [];buttons.clear();for(const [,id]of nodes.nav.innerHTML.matchAll(/data-area-toggle="([^"]+)"/g))buttons.set(id,{dataset:{areaToggle:id},focus(){this.focused=true;}});return [...buttons.values()];},querySelector(selector){if(selector==='.content-shell')return content;const id=selector.match(/^\[data-area-toggle="([^"]+)"\]$/)?.[1];return buttons.get(id)||null;}};
 const context=vm.createContext({WahiShell:shell,me:{id:'synthetic-user',capabilities:CAPABILITIES[role],googleConnection,reviewIntelligence},location:{hash:'#'+route},document,window:{addEventListener(){}},matchMedia:()=>({matches:tablet}),$:id=>{assert.ok(nodes[id],'Unexpected DOM access: '+id);return nodes[id];},esc:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),bohView:()=>false,renderOperationalControl(){},can:()=>false});
 vm.runInContext(fs.readFileSync(require.resolve('../review/public/shell.js'),'utf8'),context);
 const render=()=>vm.runInContext('renderShell()',context);render();
 return {nodes,content,buttons,context,render,html:()=>nodes.nav.innerHTML,navigate(path){context.location.hash='#'+path;render();},click(id){assert.ok(buttons.get(id)?.onclick);buttons.get(id).onclick();}};
}
test('sidebar renders nested sections, and a primary click expands without navigating',()=>{
 const ui=browserShell();assert.match(ui.html(),/<button[^>]*data-area-toggle="inventory-area"[^>]*aria-expanded="false"/);
 ui.click('inventory-area');assert.equal(ui.context.location.hash,'#home');assert.match(ui.html(),/<button[^>]*data-area-toggle="inventory-area"[^>]*aria-expanded="true"/);assert.match(ui.html(),/<div id="submenu-inventory-area"[^>]*class="area-submenu"[^>]*>.*href="#catalog"/);
 assert.ok(ui.buttons.get('inventory-area').focused);ui.navigate('catalog');assert.match(ui.html(),/href="#catalog" aria-current="page" class="selected"/);assert.match(ui.html(),/data-area-toggle="inventory-area"[^>]*aria-expanded="true"[^>]*class="area-link selected"/);
 assert.doesNotMatch(fs.readFileSync(require.resolve('../review/public/index.html'),'utf8'),/id="area-nav"/);
});
test('sidebar highlights only the most specific submenu on nested routes',()=>{
 for(const [route,path]of [['time/settings','time/settings'],['admin/integrations/resend','admin/integrations'],['reporting/cogs/details','reporting/cogs']]){
  const ui=browserShell({route});assert.equal((ui.html().match(/aria-current="page"/g)||[]).length,1);assert.ok(ui.html().includes('href="#'+path+'" aria-current="page"'));
 }
 const ui=browserShell({route:'admin/google',googleConnection:true});assert.ok(ui.html().includes('href="#admin/google" aria-current="page"'));const reviews=browserShell({route:'reporting/reviews',reviewIntelligence:true});assert.ok(reviews.html().includes('href="#reporting/reviews" aria-current="page"'));
});
test('route changes reopen their parent while explicit collapse survives a same-route render',()=>{
 let s=shell.followRoute({collapsed:false,drawer:false,expanded:[]},'catalog');assert.deepEqual(s.expanded,['inventory-area']);s=shell.toggleArea(s,'inventory-area');assert.deepEqual(shell.followRoute(s,'catalog').expanded,[]);s=shell.followRoute(s,'recipes/123');assert.deepEqual(s.expanded,['inventory-area']);s=shell.followRoute(s,'time/settings');assert.deepEqual(s.expanded,['inventory-area','time']);s=shell.followRoute(s,'time/mapping');assert.deepEqual(s.expanded,['inventory-area','time']);
});
test('sidebar preserves existing inventory order, routes and capability boundaries',()=>{
 const inventory=shell.areas(CAPABILITIES.ADMIN).find(a=>a.id==='inventory-area');assert.deepEqual(inventory.functions.map(f=>f[1]),['Overview','Items','Recipes','Inventory','Count Inventory','Count History','Locations','Ingredient Swap']);assert.equal(shell.areaFor('ingredient-swap').id,'inventory-area');
 for(const role of ['STAFF','LEAD','RECIPE_ONLY']){const ui=browserShell({role});assert.doesNotMatch(ui.html(),/href="#ingredient-swap"/);assert.doesNotMatch(ui.html(),/href="#catalog"/);assert.doesNotMatch(ui.html(),/href="#admin\/users"/);}
 for(const role of ['ADMIN','MANAGER'])assert.ok(browserShell({role}).html().includes('href="#ingredient-swap"'));
});
test('desktop rail expands a chosen section and tablet drawer retains modal navigation',()=>{
 const prior={collapsed:true,drawer:false,expanded:['inventory-area']};assert.deepEqual(shell.toggleArea(prior,'inventory-area'),{collapsed:false,drawer:false,expanded:['inventory-area']});assert.deepEqual(shell.toggleArea({...prior,drawer:true},'time',true),{collapsed:true,drawer:true,expanded:['inventory-area','time']});
 const ui=browserShell({tablet:true});assert.equal(ui.nodes.nav.inert,true);assert.equal(ui.content.inert,false);ui.nodes['nav-toggle'].onclick();assert.equal(ui.nodes.nav.inert,false);assert.equal(ui.content.inert,true);assert.equal(ui.nodes.account.inert,true);ui.click('inventory-area');assert.equal(ui.nodes.nav.inert,false);assert.match(ui.html(),/data-area-toggle="inventory-area"[^>]*aria-expanded="true"/);ui.nodes['drawer-scrim'].onclick();assert.equal(ui.nodes.nav.inert,true);assert.equal(ui.content.inert,false);assert.equal(ui.nodes['nav-toggle'].focused,true);
});
