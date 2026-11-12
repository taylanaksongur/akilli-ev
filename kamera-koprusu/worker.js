/*
 * Aksongur ev — Imou kamera köprüsü (Cloudflare Worker)
 *
 * Panel bu köprüye "X-Key" başlığıyla gelir; köprü Imou Open Platform'a kendi anahtarlarıyla bağlanır.
 *   GET /cams              → {cams:[{key,name,model,online}]}   hesaptaki kameralar (kanal başına bir kayıt)
 *   GET /live?cam=<key>    → {sd,hd}                             canlı HLS adresleri
 *
 * Cloudflare'de tanımlanacak değişkenler (Settings → Variables and Secrets):
 *   IMOU_APP_ID      Imou geliştirici konsolundaki AppId
 *   IMOU_APP_SECRET  Imou geliştirici konsolundaki AppSecret      (Secret olarak)
 *   PANEL_KEY        Panelde "Kamera şifresi" alanına yazılacak şifre (Secret olarak)
 *   IMOU_BASE        (isteğe bağlı) varsayılan Orta Avrupa: https://openapi-fk.easy4ip.com
 */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'X-Key', 'access-control-allow-methods': 'GET, OPTIONS' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/* ---- MD5 (Imou imzası için) ---- */
function md5(str) {
  const b = new TextEncoder().encode(str), n = ((b.length + 8) >>> 6) + 1, w = new Uint32Array(n * 16);
  for (let i = 0; i < b.length; i++) w[i >> 2] |= b[i] << ((i % 4) * 8);
  w[b.length >> 2] |= 0x80 << ((b.length % 4) * 8); w[n * 16 - 2] = b.length * 8;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21], K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let o = 0; o < w.length; o += 16) {
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const t = D; D = C; C = B;
      const x = (A + F + K[i] + w[o + g]) >>> 0, s = S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((x << s) | (x >>> (32 - s)))) >>> 0; A = t;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map(v => [0, 8, 16, 24].map(s => ((v >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

/* ---- Imou Open API ---- */
async function imou(env, method, params = {}) {
  const base = (env.IMOU_BASE || 'https://openapi-fk.easy4ip.com').replace(/\/+$/, '');
  const time = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID().replace(/-/g, '');
  const sign = md5(`time:${time},nonce:${nonce},appSecret:${env.IMOU_APP_SECRET}`);
  const body = { system: { ver: '1.0', appId: env.IMOU_APP_ID, sign, time, nonce }, id: crypto.randomUUID(), params };
  const r = await fetch(`${base}/openapi/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  const res = j && j.result;
  if (!res) throw Object.assign(new Error(`Imou yanıt vermedi (${method}, HTTP ${r.status})`), { code: 'HTTP' + r.status });
  if (String(res.code) !== '0') throw Object.assign(new Error(`Imou ${method}: ${res.msg || res.code}`), { code: String(res.code) });
  return res.data || {};
}
let TOKEN = null, TOKEN_EXP = 0;
async function token(env, fresh) {
  if (!fresh && TOKEN && Date.now() < TOKEN_EXP) return TOKEN;
  const d = await imou(env, 'accessToken');
  TOKEN = d.accessToken; TOKEN_EXP = Date.now() + Math.min((+d.expireTime || 3600) * 1000, 2 * 24 * 3600 * 1000) - 60000;
  return TOKEN;
}
async function call(env, method, params) {
  try { return await imou(env, method, { token: await token(env), ...params }); }
  catch (e) { if (/^TK/.test(e.code || '')) return imou(env, method, { token: await token(env, true), ...params }); throw e; }
}

/* hesaptaki cihazlar: önce ayrıntılı liste (ad, model, çevrimiçi), olmazsa temel liste */
async function cameras(env) {
  const out = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const d = await call(env, 'listDeviceDetailsByPage', { page, pageSize: 50, source: 'bindAndShare' });
      const list = d.deviceList || [];
      for (const dv of list) {
        const chans = dv.channelList || dv.channels || [{ channelId: '0', channelName: dv.deviceName }];
        for (const ch of chans) out.push({
          key: `${dv.deviceId}:${ch.channelId ?? 0}`,
          name: (chans.length > 1 ? ch.channelName : dv.deviceName) || ch.channelName || dv.deviceId,
          model: dv.deviceModel || dv.productId || '', online: String(ch.channelStatus ?? dv.deviceStatus ?? '').toLowerCase() === 'online'
        });
      }
      if (list.length < 50) break;
    }
    if (out.length) return out;
  } catch (e) { /* temel listeye düş */ }
  const d = await call(env, 'deviceBaseList', { bindId: -1, limit: 128, type: 'bindAndShare', needApInfo: false });
  for (const dv of d.deviceList || []) for (const ch of dv.channels || [{ channelId: '0' }])
    out.push({ key: `${dv.deviceId}:${ch.channelId ?? 0}`, name: ch.channelName || dv.deviceName || dv.deviceId, model: '', online: null });
  return out;
}

/* canlı yayın: HD = ana akış (0), SD = alt akış (1); yayın zaten varsa liveList'ten alınır */
async function live(env, key) {
  const [deviceId, channelId = '0'] = key.split(':');
  if (!deviceId) throw Object.assign(new Error('Kamera seçilmedi'), { http: 400 });
  const pick = streams => {
    const hd = streams.find(s => +s.streamId === 0), sd = streams.find(s => +s.streamId === 1);
    return { hd: (hd || sd || {}).hls || '', sd: (sd || hd || {}).hls || '' };
  };
  const streams = [];let exists = false;
  for (const streamId of [1, 0]) {
    try { const d = await call(env, 'bindDeviceLive', { deviceId, channelId: String(channelId), streamId }); streams.push(...(d.streams || [])); }
    catch (e) { if (e.code !== 'LV1001') throw e; exists = true; }
  }
  const has = id => streams.some(s => +s.streamId === id && s.hls);
  if (exists && !(has(0) && has(1))) {
    for (let from = 1; from <= 500; from += 100) {
      const d = await call(env, 'liveList', { queryRange: `${from}-${from + 99}` });
      const lv = (d.lives || []).filter(l => l.deviceId === deviceId && String(l.channelId) === String(channelId));
      if (lv.length) { streams.push(...lv.flatMap(l => l.streams || [])); break; }
      if ((d.lives || []).length < 100) break;
    }
  }
  const urls = pick(streams);
  if (!urls.sd && !urls.hd) throw Object.assign(new Error('Canlı yayın adresi alınamadı'), { http: 502 });
  /* Imou bazen http adres verir; https sayfada açılması için https'e çevir */
  for (const k of ['sd', 'hd']) if (urls[k]) urls[k] = urls[k].replace(/^http:\/\//i, 'https://');
  return urls;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (!env.PANEL_KEY || req.headers.get('X-Key') !== env.PANEL_KEY) return json({ error: 'unauthorized' }, 401);
    if (!env.IMOU_APP_ID || !env.IMOU_APP_SECRET) return json({ error: 'Köprüde IMOU_APP_ID / IMOU_APP_SECRET tanımlı değil' }, 500);
    try {
      if (url.pathname === '/cams') return json({ cams: await cameras(env) });
      if (url.pathname === '/live') return json(await live(env, url.searchParams.get('cam') || ''));
      return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: e.message, code: e.code || '' }, e.http || 502); }
  }
};
