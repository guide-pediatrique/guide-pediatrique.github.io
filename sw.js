/* Guide de Pédiatrie — cache pour un chargement rapide et l'accès hors ligne */
const V="gp-20261121083720";
const CORE=["./","index.html","a.js?v=20261121083720","data/croissance.json","manifest.json","icon-192.png","icon-512.png","apple-touch-icon.png","favicon-32.png","config.js","vendor/supabase.js","fonts/manrope-latin-wght-normal.woff2","fonts/fraunces-latin-opsz-normal.woff2"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:"reload"})))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);if(u.pathname.endsWith("version.json"))return;
 if(u.origin!==self.location.origin)return;
 if(u.searchParams.has("maj")||r.cache==="reload")return; // téléchargement explicite d'une mise à jour : toujours le réseau // serveurs de données, PubMed… : jamais mis en cache
 if(/^\/(auth|data|admin|health|avis|contenu|paquet)(\/|$)/.test(u.pathname)||u.pathname.includes("/paquet/"))return; // API du serveur local
 const isPage=r.mode==="navigate"||u.pathname.endsWith("index.html")||u.pathname.endsWith(".json")||u.pathname.endsWith("config.js");
 if(isPage){ // copie locale d'abord (ouverture instantanée), mise à jour en arrière-plan pour la prochaine ouverture
  const key=r.mode==="navigate"?"index.html":r;
  e.respondWith(caches.open(V).then(async c=>{const m=await c.match(key,{ignoreSearch:true})||(r.mode==="navigate"?await c.match("./"):null);
   const net=fetch(r.mode==="navigate"?new Request(r.url,{cache:"no-cache",credentials:"same-origin"}):r).then(res=>{if(res&&res.ok)c.put(key,res.clone());return res}).catch(()=>null);
   if(m){e.waitUntil(net);return m}const n=await net;return n||c.match("index.html")}));return}
 e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{if(res.ok||res.type==="opaque"){const cl=res.clone();caches.open(V).then(c=>c.put(r,cl))}return res})));
});
self.addEventListener("notificationclick",e=>{e.notification.close();const u=new URL((e.notification.data&&e.notification.data.url)||"#notes",self.registration.scope).href;
 e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{for(const c of cs){if("focus"in c){if(c.navigate)c.navigate(u).catch(()=>{});return c.focus()}}return self.clients.openWindow(u)}))});
