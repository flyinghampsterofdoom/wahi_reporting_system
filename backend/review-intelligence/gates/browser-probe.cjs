'use strict';
// Read-only bounded gate probe. No database, credentials, provider or scheduler imports.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const url='https://www.google.com/maps/place/Wahi+Hana+Tiki+Bar/@45.6354206,-122.6711344,17z/data=!4m8!3m7!1s0x5495a9de2ef66d63:0xff741845c7c81fff!8m2!3d45.6354206!4d-122.6711344!9m1!1b1!16s%2Fg%2F11t6pynp81';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
async function sample(browser,label){
 const context=await browser.newContext({locale:'en-US',viewport:{width:1100,height:900}});
 const started=Date.now();
 try{
  const page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByRole('main',{name:'Wahi Hana Tiki Bar',exact:true}).waitFor({state:'visible',timeout:30000});
  const body=await page.locator('body').innerText();
  if(/unusual traffic|not a robot|captcha|access denied/i.test(body)||/\/sorry\//.test(page.url()))throw new Error('gate_access_restriction');
  if(!body.includes('Wahi Hana'))throw new Error('gate_listing_not_verified');
  const tab=page.getByRole('tab',{name:'Reviews for Wahi Hana Tiki Bar',exact:true});
  await tab.waitFor({state:'visible',timeout:20000}).catch(()=>{});
  if(!await tab.count()){
   const error=new Error('gate_review_panel_unavailable_signed_out');
   error.evidence={title:await page.title(),tabs:await page.getByRole('tab').allTextContents(),sortControls:await page.getByRole('button',{name:'Sort reviews',exact:true}).count(),signInLinks:await page.getByRole('link',{name:'Sign in',exact:true}).count()};
   throw error;
  }
  await tab.click();
  await page.getByRole('button',{name:'Sort reviews',exact:true}).click();
  await page.getByRole('menuitemradio',{name:'Newest',exact:true}).click();
  await page.getByText('The reviews are now sorted from newest to oldest.',{exact:true}).waitFor({state:'attached'});
  const cards=page.locator('div.jftiEf[data-review-id]');await cards.first().waitFor();
  const rows=[];let expanded=0;
  for(let i=0;i<3;i++){
   const card=cards.nth(i);await card.waitFor();
   const more=card.getByRole('button',{name:'See more',exact:true});
   if(await more.count()){await more.click();expanded++;}
   const row=await card.evaluate(el=>({id:el.getAttribute('data-review-id'),rating:el.querySelector('[role="img"][aria-label*="star"]')?.getAttribute('aria-label'),comment:el.querySelector('span.wiI7pd')?.textContent||'',dateLabels:Array.from(el.querySelectorAll('span')).map(s=>s.textContent.trim()).filter(s=>/^(Edited )?(\d+ (day|week|month|year)s? ago|a (day|week|month|year) ago|yesterday)$/i.test(s))}));
   if(!row.id||!/^([1-5]) stars?$/.test(row.rating||''))throw new Error('gate_required_fields_missing');
   rows.push({id:row.id,rating:row.rating,textHash:digest(row.comment),textLength:row.comment.length,dateLabels:row.dateLabels});
  }
  if(new Set(rows.map(x=>x.id)).size!==3)throw new Error('gate_duplicate_ids');
  return {label,elapsedMs:Date.now()-started,expanded,rows,headless:true,freshContext:true,signedIn:false};
 }finally{await context.close();}
}
async function main(browserType){
 const chromium=browserType||require(process.env.WAHI_GATE_PLAYWRIGHT||'playwright').chromium;
 const results=[],started=Date.now();let browser;
 const timeout=setTimeout(()=>{if(browser)browser.close().catch(()=>{});},180000);timeout.unref();
 try{
  browser=await chromium.launch({headless:true});
  results.push(await sample(browser,'fresh-context-1'));
  results.push(await sample(browser,'fresh-context-2'));
  await browser.close();browser=null;
  browser=await chromium.launch({headless:true});
  results.push(await sample(browser,'browser-restart'));
  const first=results[0].rows;
  const consistent=results.every(r=>r.rows.every((row,i)=>row.id===first[i].id&&row.textHash===first[i].textHash&&row.rating===first[i].rating));
  if(!consistent)throw new Error('gate_identity_or_top_window_changed');
  return {status:'passed',elapsedMs:Date.now()-started,platform:process.platform,arch:process.arch,node:process.versions.node,results};
 }catch(e){return {status:'failed',code:e.message,evidence:e.evidence,elapsedMs:Date.now()-started,platform:process.platform,arch:process.arch,results};}
 finally{clearTimeout(timeout);if(browser)await browser.close();}
}
module.exports={main,sample};
if(require.main===module)main().then(result=>{const output=process.env.WAHI_GATE_OUTPUT;if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});}console.log(JSON.stringify({status:result.status,code:result.code,evidence:result.evidence,platform:result.platform,elapsedMs:result.elapsedMs,sessions:result.results.length}));if(result.status!=='passed')process.exitCode=1;});
