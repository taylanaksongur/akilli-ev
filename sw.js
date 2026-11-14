/* Aksongur Ev Paneli servis çalışanı. Kapatmak için KAPALI=true yapın (eski önbellek silinir, istekler doğrudan ağa gider). */
const KAPALI=false;
const SURUM='v1',ONBELLEK='akilli-ev-'+SURUM;
const ZAMAN_ASIMI=3500;
const SWR=/^https:\/\/(cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{
  for(const k of await caches.keys())if(k.startsWith('akilli-ev-')&&(KAPALI||k!==ONBELLEK))await caches.delete(k);
  await self.clients.claim()})())});
const anahtar=u=>{const x=new URL(u);x.search='';x.hash='';return x.href};
async function agOnce(req,key){
  const c=await caches.open(ONBELLEK);
  const ag=new Promise((ok,hata)=>{const ac=new AbortController(),t=setTimeout(()=>{ac.abort();hata(new Error('zaman'))},ZAMAN_ASIMI);
    fetch(req.url,{cache:'no-cache',signal:ac.signal,credentials:'same-origin'}).then(r=>{clearTimeout(t);ok(r)},h=>{clearTimeout(t);hata(h)})});
  try{const r=await ag;if(r&&r.ok)c.put(key,r.clone());return r}
  catch(e){const o=await c.match(key);if(o)return o;return fetch(req)}}
async function eskiyiGoster(req){
  const c=await caches.open(ONBELLEK),o=await c.match(req);
  const yeni=fetch(req).then(r=>{if(r&&(r.ok||r.type==='opaque'))c.put(req,r.clone());return r}).catch(()=>null);
  return o||(await yeni)||Response.error()}
self.addEventListener('fetch',e=>{
  if(KAPALI)return;
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.origin===self.location.origin){
    if(r.mode==='navigate'||u.pathname.endsWith('/index.html')||u.pathname.endsWith('/akilli-ev/'))
      e.respondWith(agOnce(r,anahtar(r.url)));
    return}                                   /* /Aksi/hesap.js, esitle.js ve diğer her şey: dokunma */
  if(SWR.test(r.url))e.respondWith(eskiyiGoster(r))});
