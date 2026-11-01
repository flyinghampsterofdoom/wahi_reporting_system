'use strict';
const SHELL='wahi-recipe-shell-v1';
const asset=/^\/(?:app-version|table-model|currency|quantity|shell-model|deep-links|leadership-summary|reports-ui|cogs-model|cogs-ui|mapping-ui|composite-ui|variant-ui|waste-ui|recipe-renderer|recipe-offline|recipe-foundation|recipe-builder|app|management-ui|shell|users-ui|email-ui|labor-allotments|labor-ui|reviews-ui|review-explorer-ui|review-workflow-ui|openai-ui|google-ui)(?:\.[0-9a-f]{16})?\.js$|^\/(?:style|reviews)(?:\.[0-9a-f]{16})?\.css$/;
async function refreshShell(response){if(!response.ok)throw Error('Shell unavailable');const html=await response.clone().text(),urls=[...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>new URL(m[1],self.location.origin)).filter(u=>u.origin===self.location.origin&&asset.test(u.pathname));
 const cache=await caches.open(SHELL);await Promise.all(urls.map(async u=>{const r=await fetch(u.pathname,{cache:'force-cache'});if(!r.ok)throw Error('Shell asset unavailable');await cache.put(u.pathname,r);}));await cache.put('/',response);const keep=new Set(['/',...urls.map(u=>u.pathname)]);for(const r of await cache.keys())if(!keep.has(new URL(r.url).pathname))await cache.delete(r);
}
self.addEventListener('install',event=>event.waitUntil((async()=>{await refreshShell(await fetch('/',{cache:'no-store'}));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('wahi-recipe-shell-')&&k!==SHELL)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'&&u.pathname==='/'){const network=fetch(event.request);event.waitUntil(network.then(r=>r.ok?refreshShell(r.clone()):undefined).catch(()=>{}));event.respondWith(network.then(async r=>r.ok?r:await caches.match('/')||r).catch(()=>caches.match('/')));return;}
 if(asset.test(u.pathname))event.respondWith((async()=>{try{const r=await fetch(event.request);return r.ok?r:await caches.match(event.request)||r;}catch{return caches.match(event.request);}})());
 // APIs and images never enter the shared shell cache. Account-scoped IndexedDB owns service data.
});
