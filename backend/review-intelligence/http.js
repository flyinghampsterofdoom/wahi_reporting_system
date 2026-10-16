'use strict';
const {fail}=require('./google');
const allowedHosts=new Set(['oauth2.googleapis.com','mybusiness.googleapis.com','mybusinessaccountmanagement.googleapis.com','mybusinessbusinessinformation.googleapis.com','api.openai.com']);
class ProviderHTTP {
 constructor({mode='live',allowNetwork=false,fetchImpl,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),random=Math.random,timeoutMs=15000,scope='all'}={}){
  if(!['live','mock-http'].includes(mode)||mode==='mock-http'&&!fetchImpl)throw fail('review_invalid_transport');
  Object.assign(this,{mode,allowNetwork,fetchImpl:fetchImpl||globalThis.fetch,clock,sleep,random,timeoutMs,scope});
 }
 authorized(){if(this.mode==='live'&&!this.allowNetwork)throw fail('review_network_disabled');}
 async request(url,options={}, {maxAttempts=3,guard=async()=>{}}={}){
  this.authorized();const target=new URL(url);if(target.protocol!=='https:'||target.username||target.password||target.port||!allowedHosts.has(target.hostname))throw fail('review_provider_url_denied');
  if(this.scope==='google-connection'&&!((target.hostname==='oauth2.googleapis.com'&&target.pathname==='/token'&&options.method==='POST')||(target.hostname==='mybusinessaccountmanagement.googleapis.com'&&target.pathname==='/v1/accounts'&&(!options.method||options.method==='GET'))||(target.hostname==='mybusinessbusinessinformation.googleapis.com'&&/^\/v1\/accounts\/[a-zA-Z0-9_-]+\/locations$/.test(target.pathname)&&(!options.method||options.method==='GET'))))throw fail('review_content_processing_disabled');
  for(let attempt=0;attempt<maxAttempts;attempt++){
   await guard();let response;
   try{response=await this.fetchImpl(target.toString(),{...options,redirect:'error',signal:AbortSignal.timeout(this.timeoutMs)});}catch{throw fail(options.method==='POST'&&target.hostname==='api.openai.com'?'review_dispatch_uncertain':'review_provider_transport');}
   if([429,500,502,503,504].includes(response.status)&&attempt+1<maxAttempts){
    const value=response.headers.get('retry-after');const delay=value?(/^\d+(\.\d+)?$/.test(value)?Number(value)*1000:Date.parse(value)-this.clock()):250*2**attempt*(0.5+this.random());
    if(!Number.isFinite(delay)||delay>30000)throw Object.assign(fail('review_provider_rate_limited'),{retryAfterMs:Number.isFinite(delay)?Math.max(0,delay):60000});
    await response.body?.cancel();await this.sleep(Math.max(0,delay));continue;
   }
   let text;try{if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000){await reader.cancel();throw new Error();}chunks.push(Buffer.from(value));}text=Buffer.concat(chunks).toString('utf8');}else{text=await response.text();if(Buffer.byteLength(text)>2000000)throw new Error();}}catch{throw fail('review_provider_invalid_response');}
   let body;try{body=text?JSON.parse(text):{};if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();}catch{throw fail('review_provider_invalid_response');}
   const retryHeader=response.headers.get('retry-after'),retryDelay=retryHeader?(/^\d+(\.\d+)?$/.test(retryHeader)?Number(retryHeader)*1000:Date.parse(retryHeader)-this.clock()):0;return {retryAfterMs:Number.isFinite(retryDelay)&&retryDelay>=0&&retryDelay<8640000000000000-this.clock()?retryDelay:60000,status:response.status,body,requestId:(response.headers.get('x-request-id')||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,200),retryAfter:response.headers.get('retry-after')};
  }
  throw fail('review_provider_attempts_exhausted');
 }
}
module.exports={ProviderHTTP};
