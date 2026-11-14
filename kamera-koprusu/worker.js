// Imou kamera köprüsü — Tekne paneli ve Akıllı ev paneli
// Gizliler: IMOU_APPID, IMOU_SECRET. Erişim Aksi hesap belirteciyle (Authorization: Bearer) ve kameranın alan iznine göre verilir.
const KAYNAKLAR = ['https://taylanaksongur.github.io', 'https://aksi.systems']; // izinli sayfa kaynakları
const HOST = 'https://openapi-fk.easy4ip.com/openapi/';
// alan: kameranın bağlı olduğu alan (ev | tekne). Hesap servisindeki KAMERA_ALAN ile aynı tutulmalı.
const KAMERALAR = {
  on: { dev: '9C0483FPAZF65E9', name: 'Ön kamera', alan: 'tekne' },
  arka: { dev: '9E095B7PAZF85AE', name: 'Arka kamera', alan: 'tekne' },
  yemek: { dev: 'D9B38BDPSFBED9B', name: 'Yemek', alan: 'ev' },
  oturma: { dev: 'D9B38BDPSF69332', name: 'Oturma odası', alan: 'ev' },
  bahce: { dev: 'D9B38BDPSF912E0', name: 'Bahçe', alan: 'ev' },
  cocuk: { dev: 'D9B38BDPSF0FBD9', name: 'Çocuk', alan: 'ev' },
};
let TOK = null, TOKEXP = 0;
const LIVE = new Map(); // dev -> {data, exp}

async function md5(s) { const b = await crypto.subtle.digest('MD5', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function call(env, method, params) {
  const time = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID().replace(/-/g, '');
  const sign = await md5(`time:${time},nonce:${nonce},appSecret:${env.IMOU_SECRET}`);
  const r = await fetch(HOST + method, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: { ver: '1.0', appId: env.IMOU_APPID, sign, time, nonce }, params, id: nonce }) });
  const j = await r.json(); return j.result || {};
}
async function token(env) {
  if (TOK && Date.now() < TOKEXP) return TOK;
  const r = await call(env, 'accessToken', {});
  if (r.code !== '0') throw new Error('Imou oturum: ' + r.msg);
  TOK = r.data.accessToken; TOKEXP = Date.now() + Math.min(r.data.expireTime - 600, 86400) * 1000; return TOK;
}
async function live(env, dev) {
  const c = LIVE.get(dev); if (c && Date.now() < c.exp) return c.data;
  const t = await token(env);
  let r = await call(env, 'getLiveStreamInfo', { token: t, deviceId: dev, channelId: '0' });
  if (r.code !== '0') r = await call(env, 'bindDeviceLive', { token: t, deviceId: dev, channelId: '0', streamId: 1 });
  if (r.code !== '0') throw new Error(r.msg || 'Canlı yayın alınamadı');
  const pick = id => (r.data.streams.find(s => s.streamId === id && s.hls.startsWith('https')) || {}).hls || '';
  const data = { hd: pick(0), sd: pick(1) };
  LIVE.set(dev, { data, exp: Date.now() + 30 * 60000 }); return data;
}
async function status(env, devs) {
  const t = await token(env);
  const r = await call(env, 'listDeviceDetailsByPage', { token: t, page: 1, pageSize: 50 });
  const m = {}; (r.data?.deviceList || []).forEach(d => m[d.deviceId] = (d.channelList?.[0]?.channelStatus || d.deviceStatus) === 'online');
  return m;
}
/* Aksi hesabı: her kamera yalnızca kendi alanı için izni olana açılır (ev -> ev kameraları, tekne -> tekne kameraları).
   Oturum yanıtı 60 sn önbelleklenir: alan izni değişikliği en geç 1 dk içinde geçerli olur. */
const OTURUM = new Map(), OTURUM_MS = 60e3;
async function groupForAksi(env, auth) {
  if (!auth || !auth.startsWith('Bearer ') || !env.HESAP) return { durum: 401 };
  const c = OTURUM.get(auth);
  let k = c && c.son > Date.now() ? c.k : null;
  if (!k) {
    OTURUM.delete(auth);
    let r;
    try { r = await env.HESAP.fetch(new Request('https://aksi-hesap/ben', { headers: { Authorization: auth } })); }
    catch { return { durum: 503 }; }
    if (r.status === 401) return { durum: 401 };
    if (!r.ok) return { durum: 503 };
    try { k = (await r.json()).kullanici; } catch { return { durum: 503 }; }
    if (!k) return { durum: 401 };
    OTURUM.set(auth, { k, son: Date.now() + OTURUM_MS });
    if (OTURUM.size > 100) OTURUM.delete(OTURUM.keys().next().value);
  }
  const al = k.rol === 'yonetici' ? ['ev', 'tekne'] : (k.alanlar || []);
  const g = Object.fromEntries(Object.entries(KAMERALAR).filter(([, c]) => al.includes(c.alan)));
  return Object.keys(g).length ? { g } : { durum: 403 };
}

export default {
  async fetch(req, env) {
    const orj = req.headers.get('Origin');
    const cors = { 'Access-Control-Allow-Origin': KAYNAKLAR.includes(orj) ? orj : KAYNAKLAR[0], 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const u = new URL(req.url), out = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });
    const o = await groupForAksi(env, req.headers.get('Authorization'));   // eski X-Key şifreleri emekli
    if (!o.g) return out({ error: o.durum === 401 ? 'Aksi girişi gerekli' : o.durum === 403 ? 'Kamera alanına erişimin yok' : 'Hesap servisine ulaşılamadı' }, o.durum);
    const g = o.g;
    try {
      if (u.pathname === '/cams') {
        const st = await status(env);
        return out({ cams: Object.entries(g).map(([id, c]) => ({ id, name: c.name, online: !!st[c.dev] })) });
      }
      if (u.pathname === '/live') {
        const c = g[u.searchParams.get('cam')]; if (!c) return out({ error: 'Kamera yok' }, 404);
        return out(await live(env, c.dev));
      }
      return out({ error: 'Bilinmeyen istek' }, 404);
    } catch (e) { return out({ error: String(e.message || e) }, 502); }
  }
};
