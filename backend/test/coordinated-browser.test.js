"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {start,document:serviceDocument}=require('../recipe-book/test-support/fixture'),{PostgresRepository}=require('../repository/postgres'),{fixture}=require('./helpers');
const browserModule=path.join(process.env.WAHI_BROWSER_MODULE_ROOT||'/Users/justinrawlinson/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright');
const {chromium}=require(browserModule);
const categories=[['on_menu','Cocktails'],['shareables','Shareables'],['mocktails','Mocktails'],['the_dive','The Dive'],['specials','Specials'],['old_specials','Old Specials']];
const password='Recipe-fixture-password-only';

test('coordinated backend UI: builder, menu categories, allergens and responsive sidebar', {timeout:180000}, async t=>{
 let f,browser;const errors=[],dialogs=[],blocked=[];
 try{
  try{await fs.access(chromium.executablePath());}catch{throw new Error('Playwright-managed Chromium is missing. Install matching binaries with playwright install chromium inside the authorized bounded development session.');}
  f=await start({empty:true});const repo=new PostgresRepository(f.pool),domain=fixture(repo),original=await domain.bought('Synthetic original cream','2','10','fl_oz_us'),replacement=await domain.bought('Synthetic replacement cream','1','10','fl_oz_us'),alternate=await domain.bought('Synthetic alternate cream','3','10','fl_oz_us');
  await domain.run('updateIngredient',{ingredientId:original.id,name:'Synthetic original cream',active:true,allergens:['Milk','Soy']});
  const recipe=await domain.recipe('Synthetic coordinated cocktail',[{ingredientId:original.id,quantity:'2',unit:'fl_oz_us'}]),otherRecipe=await domain.recipe('Synthetic excluded cocktail',[{ingredientId:original.id,quantity:'1',unit:'fl_oz_us'}]);
  for(const [r,amount]of [[recipe,'10'],[otherRecipe,'12']]){const menu=await domain.run('createMenuItem',{name:r===recipe?'Synthetic menu drink':'Synthetic excluded menu drink'});await domain.run('setMenuMapping',{menuItemId:menu.id,recipeId:r.id,quantity:'1',unit:'each'});await domain.run('setSellingPrice',{menuItemId:menu.id,amount,currency:'USD'});}
  const publications=[];
  for(const [menuStatus,label]of [...categories,['off_menu','Legacy']]){const doc=serviceDocument('Synthetic category '+label);doc.components=doc.components.slice(0,4);Object.assign(doc.components[0].ingredients[0],{ingredientId:original.id,name:'Synthetic original cream',quantity:'2',unit:'oz'});const entry=await f.book.create(f.admin,{document:doc,menuStatus});const published=await f.book.publish(f.admin,{id:entry.id,expectedVersion:entry.version,confirmed:true});publications.push({...published,label});}
  const preservedPublications=(await f.pool.query('SELECT id,document FROM wahi_v2.recipe_book_versions ORDER BY id')).rows;
  browser=await chromium.launch({headless:true,timeout:15000,args:['--single-process','--in-process-gpu','--disable-gpu']});const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>{const host=new URL(route.request().url()).hostname;if(host==='127.0.0.1')return route.continue();blocked.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());return d.accept();});
  await page.goto(f.origin+'/#recipe-builder');await page.locator('[name=username]').fill('fixture.owner');await page.locator('[name=password]').fill(password);await page.locator('#login-form button').click();await page.locator('#builder-canvas>.builder-card').first().waitFor();

  assert.deepEqual(await page.locator('#builder-canvas>.builder-card').evaluateAll(ns=>ns.map(n=>n.dataset.componentType)),['ingredients','preparation','garnish','glassware']);
  const ingredients=page.locator('#builder-canvas>.builder-card[data-component-type=ingredients]');
  assert.equal(await ingredients.locator('[data-do=add-instruction]').count(),0);assert.equal(await ingredients.locator('.builder-card-actions>[data-do=add-ingredient]').count(),1);
  assert.equal(await ingredients.locator('.builder-block-options').evaluate(n=>n.open),false);await ingredients.locator('.builder-card-actions>[data-do=add-ingredient]').click();
  const row=ingredients.locator('.builder-ingredient');assert.equal(await row.count(),1);assert.equal(await row.locator('[data-field=quantity]').inputValue(),'');assert.equal(await row.locator('[data-field=unit]').inputValue(),'oz');assert.equal(await row.locator('[data-field=name]').inputValue(),'');
  await page.locator('#builder-title').fill('Synthetic blank draft');await page.locator('#builder-save').click();await page.waitForFunction(()=>document.querySelector('#builder-save-state')?.textContent.startsWith('Draft saved'));
  const blankId=await page.evaluate(()=>builderState.id),blank=await f.book.draft(f.admin,blankId);assert.equal(blank.document.components[0].ingredients[0].quantity,null);assert.equal(blank.document.components[0].ingredients[0].name,'');
  await page.locator('#builder-publish').click();await page.waitForFunction(()=>document.querySelector('#builder-save-state')?.textContent.includes('enter an ingredient name'));
  assert.equal((await f.book.history(f.admin,blankId)).versions.length,0);
  await row.locator('[data-field=name]').fill('Synthetic original cream');await row.locator('[data-field=quantity]').fill('1');assert.equal(await row.locator('[data-field=name]').getAttribute('list'),'builder-ingredients');
  await page.locator('#builder-save').click();await page.waitForFunction(()=>document.querySelector('#builder-save-state')?.textContent.startsWith('Draft saved'));assert.equal((await f.book.draft(f.admin,blankId)).document.components[0].ingredients[0].ingredientId,original.id);assert.equal(await page.evaluate(()=>builderState.doc.components[0].ingredients[0].ingredientId),original.id);assert.equal(await page.locator('#builder-allergens .recipe-allergen').count(),2);
  await row.locator('[data-field=name]').fill('Synthetic custom freeform ingredient');assert.equal(await page.evaluate(()=>builderState.doc.components[0].ingredients[0].ingredientId),null);await page.locator('#builder-save').click();await page.waitForFunction(()=>document.querySelector('#builder-save-state')?.textContent.startsWith('Draft saved'));assert.equal(await page.locator('#builder-allergens .recipe-allergen').count(),0);
  await page.locator('#builder-new').click();await page.waitForFunction(()=>builderState.id===null);const priorDialogs=dialogs.length;
  await page.locator('#builder-source-search').fill('Synthetic coordinated cocktail');await page.getByRole('option',{name:'Synthetic coordinated cocktail',exact:true}).click();
  await page.waitForFunction(id=>builderState.doc.components[0]?.sourceRecipeId===id,recipe.id);
  assert.deepEqual(await page.locator('#builder-canvas>.builder-card').evaluateAll(ns=>ns.map(n=>n.dataset.componentType)),['recipe','preparation','garnish','glassware']);assert.equal(dialogs.length,priorDialogs);
  await page.locator('#builder-save').click();await page.waitForFunction(()=>document.querySelector('#builder-save-state')?.textContent.startsWith('Draft saved'));assert.equal(await page.locator('#builder-allergens .recipe-allergen').count(),2);
  t.diagnostic('Builder: four defaults; direct Ingredients controls; blank/oz row; incomplete draft persisted; publication rejected; import preserves defaults and saved allergen tags.');

  await page.goto(f.origin+'/#recipe-book');await page.locator('#recipe-filter').waitFor();await page.waitForFunction(()=>recipeBookState?.rows.length===7&&recipeBookState.cached===false&&!recipeBookState.refreshing&&!recipeBookState.offline);
  assert.deepEqual(await page.locator('#recipe-filter option').evaluateAll(ns=>ns.map(n=>[n.value,n.textContent])),[['all','All'],...categories]);
  for(const [value,label]of categories){await page.locator('#recipe-filter').selectOption(value);assert.equal(await page.locator('#recipe-list button').count(),1);assert.ok((await page.locator('#recipe-list button').innerText()).includes('Synthetic category '+label));assert.equal(await page.locator('#recipe-detail .recipe-allergen').filter({hasText:'Milk'}).count(),1);}
  await page.locator('#recipe-filter').selectOption('all');assert.equal(await page.locator('#recipe-list button').count(),7);assert.ok((await page.locator('#recipe-list').innerText()).includes('Synthetic category Legacy'));
  t.diagnostic('Recipe Book: exact category order; every category filters correctly; legacy records remain in All; inherited allergens render once.');

  await page.goto(f.origin+'/#catalog/'+original.id);await page.locator('#edit-item').click();const choices=page.locator('#item-form input[name=allergen]');await choices.first().waitFor({state:'visible'});assert.equal(await choices.count(),8);
  for(const checkbox of await choices.all())if(await checkbox.isChecked())await checkbox.uncheck();await page.locator('#item-form input[name=allergen][value=Eggs]').check();await page.locator('#item-form button[type=submit]').click();await page.locator('#item-form').waitFor({state:'detached'});
  await page.goto(f.origin+'/#recipes/'+recipe.id);await page.getByRole('heading',{name:'Synthetic coordinated cocktail',exact:true}).waitFor();assert.deepEqual(await page.locator('#main>.allergen-tags .allergen-tag').allTextContents(),['Eggs']);
  await page.goto(f.origin+'/#recipe-book');await page.locator('#recipe-filter').waitFor();await page.waitForFunction(()=>recipeBookState?.rows.length===7&&recipeBookState.cached===false&&!recipeBookState.refreshing&&!recipeBookState.offline);await page.locator('#recipe-filter').selectOption('on_menu');assert.deepEqual(await page.locator('#recipe-detail .recipe-allergen').allTextContents(),['Eggs']);
  assert.deepEqual((await f.pool.query('SELECT id,document FROM wahi_v2.recipe_book_versions ORDER BY id')).rows,preservedPublications);
  t.diagnostic('Allergens: all Big 8 options; editing an ingredient updates costing recipe and published service item without rewriting publications.');


  await page.goto(f.origin+'/#ingredient-swap');await page.locator('[name=swap-original]').selectOption(original.id);await page.locator('[name=swap-replacement]').selectOption(replacement.id);
  const compared=()=>page.waitForFunction(()=>document.querySelector('#swap-status')?.textContent.startsWith('Comparison updated'));
  await compared();
  // Hold an already calculated old preview while the next selection is loading.
  const previewMatch=url=>url.pathname==='/api/ingredient-swap/preview',loadMatch=url=>url.pathname==='/api/ingredient-swap'&&url.searchParams.get('replacementId')===alternate.id;
  let heldPreview,heldResponse,heldLoad,seenPreview=false,previewReady,loadReady;
  const previewCaptured=new Promise(resolve=>previewReady=resolve),loadCaptured=new Promise(resolve=>loadReady=resolve);
  await page.route(previewMatch,async route=>{if(seenPreview)return route.continue();seenPreview=true;heldResponse=await route.fetch();heldPreview=route;previewReady();});
  await page.route(loadMatch,route=>{heldLoad=route;loadReady();});
  await page.locator('[name=swap-cost]').fill('3');await previewCaptured;await page.locator('[name=swap-replacement]').selectOption(alternate.id);await loadCaptured;
  assert.equal(await page.locator('#swap-apply').isDisabled(),true);await page.locator('[name=swap-cost]').fill('4');
  await assert.rejects(page.waitForRequest(request=>new URL(request.url()).pathname==='/api/ingredient-swap/preview',{timeout:350}),{name:'TimeoutError'});
  const oldResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/ingredient-swap/preview');await heldPreview.fulfill({response:heldResponse});await (await oldResponse).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>ingredientSwapState.loading),true);assert.equal(await page.locator('#swap-apply').isDisabled(),true);assert.equal(await page.evaluate(()=>ingredientSwapState.preview),null);
  await heldLoad.continue();await compared();assert.equal(await page.evaluate(()=>ingredientSwapState.context.replacement.id),alternate.id);
  await page.unroute(previewMatch);await page.unroute(loadMatch);await page.locator('[name=swap-replacement]').selectOption(replacement.id);await compared();
  t.diagnostic('Ingredient Swap race: delayed old preview cannot re-enable Apply or overwrite a loading replacement; edits during loading cannot submit old-context previews.');
  const beforeSwap=await repo.read(),first=page.locator(`[data-swap-recipe="${recipe.id}"]`),excluded=page.locator(`[data-swap-recipe="${otherRecipe.id}"]`);
  assert.equal(await page.locator('#swap-recipes input[type=checkbox]:checked').count(),2);
  const hypotheticalCost=()=>first.locator('[data-swap-metrics] tr').filter({hasText:'Recipe cost'}).first().locator('td').last();
  assert.equal(await hypotheticalCost().innerText(),'$0.20');await first.locator('[data-line]').fill('3');await compared();assert.equal(await hypotheticalCost().innerText(),'$0.30');
  await excluded.locator('[data-line]').fill('4');await compared();await excluded.locator('input[type=checkbox]').uncheck();await compared();assert.equal(await excluded.isVisible(),true);assert.equal(await excluded.locator('[data-line]').inputValue(),'4');
  await excluded.locator('input[type=checkbox]').check();await compared();assert.equal(await excluded.locator('[data-line]').inputValue(),'4');
  await page.locator('#swap-none').click();await compared();assert.equal(await page.locator('#swap-recipes input[type=checkbox]:checked').count(),0);await page.locator('#swap-all').click();await compared();assert.equal(await page.locator('#swap-recipes input[type=checkbox]:checked').count(),2);assert.equal(await first.locator('[data-line]').inputValue(),'3');
  await page.locator('[name=swap-cost]').fill('2');await compared();assert.equal(await hypotheticalCost().innerText(),'$0.60');await page.locator('[name=swap-size]').fill('20');await compared();assert.equal(await hypotheticalCost().innerText(),'$0.30');
  await page.locator('[name=swap-mode][value=new]').check();await compared();await page.locator('[name=swap-mode][value=inherit]').check();await compared();
  await excluded.locator('input[type=checkbox]').uncheck();await compared();assert.deepEqual(await repo.read(),beforeSwap);
  await page.locator('#swap-apply').click();await page.locator('#swap-confirm').waitFor({state:'visible'});assert.deepEqual(await repo.read(),beforeSwap);
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/ingredient-swap/apply')&&r.request().method()==='POST');await page.locator('#swap-commit').click();assert.equal((await responsePromise).status(),200);await page.locator('#swap-confirm').waitFor({state:'hidden'});
  const afterSwap=await repo.read(),latest=require('../domain/history').latest,now=new Date().toISOString(),updated=latest(afterSwap.recipeRevisions.filter(v=>v.recipeId===recipe.id),now,now),untouched=latest(afterSwap.recipeRevisions.filter(v=>v.recipeId===otherRecipe.id),now,now);
  assert.equal(updated.lines[0].ingredientId,replacement.id);assert.equal(updated.lines[0].quantity,'3');assert.equal(untouched.id,otherRecipe.revision);assert.equal(untouched.lines[0].ingredientId,original.id);assert.equal(untouched.lines[0].quantity,'1');
  for(const revision of beforeSwap.recipeRevisions)assert.deepEqual(afterSwap.recipeRevisions.find(v=>v.id===revision.id),revision);assert.deepEqual(afterSwap.sellingPrices,beforeSwap.sellingPrices);
  t.diagnostic('Ingredient Swap: live exact costs; package and quantity changes; measurement modes; deselect/reselect and select-all preserve adjustments; previews and confirmation do not mutate; confirmed apply revises only the selected recipe and retains history/prices.');

  await page.goto(f.origin+'/#home');await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();assert.equal(await page.locator('#area-nav').count(),0);
  const primary=page.locator('#nav [data-area-toggle="inventory-area"]');if(await primary.getAttribute('aria-expanded')==='true')await primary.click();assert.equal(await primary.getAttribute('aria-expanded'),'false');await primary.click();assert.equal(await primary.getAttribute('aria-expanded'),'true');assert.ok(page.url().endsWith('#home'));
  assert.deepEqual((await page.locator('#submenu-inventory-area a').allTextContents()).slice(0,7),['Overview','Items','Recipes','Inventory','Count Inventory','Count History','Locations']);
  const evidence=await fs.mkdtemp(path.join(os.tmpdir(),'screens-'));
  for(const [name,width,height]of [['desktop',1440,1000],['tablet',768,1024],['mobile',390,844]]){
   await page.setViewportSize({width,height});await page.goto(f.origin+'/#home');await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();if(width<=900){await page.locator('#nav-toggle').click();await page.waitForFunction(()=>document.querySelector('#workspace').classList.contains('drawer-open'));}if(await primary.getAttribute('aria-expanded')!=='true')await primary.click();
   await page.locator('#submenu-inventory-area a[href="#catalog"]').click();await page.getByRole('heading',{name:'Items',exact:true}).waitFor();
   assert.equal(await primary.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#submenu-inventory-area a[href="#catalog"]').getAttribute('aria-current'),'page');
   if(width<=900){await page.locator('#nav-toggle').click();assert.equal(await page.locator('.content-shell').evaluate(n=>n.inert),true);assert.equal(await page.locator('#nav').evaluate(n=>n.inert),false);await page.screenshot({path:path.join(evidence,name+'-sidebar.png')});await page.keyboard.press('Escape');assert.equal(await page.locator('.content-shell').evaluate(n=>n.inert),false);assert.equal(await page.locator('#nav').evaluate(n=>n.inert),true);}else await page.screenshot({path:path.join(evidence,name+'-sidebar.png')});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Body overflow at '+width);
  }
  t.diagnostic('Sidebar: primary expands in place; indented preserved routes; parent/child highlight; no horizontal submenu; desktop/tablet/mobile drawer and Escape work. Screenshots: '+evidence);
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await context.close();
 }finally{if(browser)await browser.close();if(f)await f.close();}
});
