'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {createReviewServer}=require('../review/server'),{createUser}=require('../review/auth');
const {DomainService}=require('../service'),{MemoryRepository}=require('../repository/memory');
const {seed}=require('../review/seed');
let server,base,service;const password='Synthetic-test-password-only';
before(async()=>{service=new DomainService(new MemoryRepository());await seed(service);const users=await Promise.all(['ADMIN','MANAGER','LEAD','STAFF'].map(role=>createUser(role.toLowerCase(),role,password)));server=createReviewServer({service,users});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
async function request(path,{auth,body,headers={}}={}){const r=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json(),headers:r.headers};}
async function login(role){const r=await request('login',{body:{username:role.toLowerCase(),password}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);const auth={cookie:r.headers.get('set-cookie').split(';')[0]};const me=await request('me',{auth});auth.csrf=me.body.csrf;return auth;}

test('review HTTP: direct Admin URLs reject every non-admin capability set',async()=>{for(const role of ['MANAGER','STAFF','LEAD']){const auth=await login(role);for(const path of ['admin','admin/integrations/toast'])assert.equal((await request(path,{auth})).status,403);assert.equal((await request('admin/integrations/toast',{auth,body:{clientSecret:'synthetic-only'}})).status,403);}});
test('review HTTP: Admin shell metadata and inventory metrics are truthful and capability filtered',async()=>{const admin=await login('ADMIN');assert.equal((await request('admin',{auth:admin})).body.environment,'local-review');const summary=await request('area/inventory',{auth:admin});assert.equal(summary.status,200);assert.equal(typeof summary.body.unresolvedRecipeCosts,'number');const staff=await login('STAFF');const safe=await request('area/inventory',{auth:staff});assert.equal(safe.body.unresolvedRecipeCosts,undefined);assert.equal(safe.body.recentCounts,undefined);});
