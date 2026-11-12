/* Aksi iHost köprüsü. iHost'un Docker'ında (node:20-alpine) çalışır, eWeLink CUBE Open API'sine bağlanır.
   Cloudflare tüneli bu servisi HTTPS'e açar. Her istek Aksi hesap belirteciyle denetlenir (ev alanı yetkisi).
   Bağımlılık yok. Ortam değişkenleri:
     CUBE_ADRES  iHost adresi, ör. http://192.168.1.50   (zorunlu)
     PORT        varsayılan 8787
     HESAP       varsayılan https://aksi-hesap.aksongur.workers.dev
     KAYNAK      izinli sayfa kaynağı, varsayılan https://taylanaksongur.github.io
   CUBE belirteci /data/cube-token dosyasında durur (yönetici panelden "Eşleştir" ile alır). */
const http = require('http');
const fs = require('fs');

const CUBE = (process.env.CUBE_ADRES || '').replace(/\/+$/, '');
const PORT = +process.env.PORT || 8787;
const HESAP = process.env.HESAP || 'https://aksi-hesap.aksongur.workers.dev';
const KAYNAK = process.env.KAYNAK || 'https://taylanaksongur.github.io';
const TOKEN_DOSYA = '/data/cube-token';
const API = CUBE + '/open-api/v1/rest';
const ANAHTAR = process.env.KOPRU_ANAHTAR || '';   // hesap servisine kayıt anahtarı (en az 16 karakter)
const CF_LOG = '/tmp/cf.log';

let cubeToken = process.env.CUBE_TOKEN || '';
try { cubeToken = cubeToken || fs.readFileSync(TOKEN_DOSYA, 'utf8').trim(); } catch { }

// ---- Aksi oturum denetimi (5 dk önbellek)
const oturumlar = new Map();
async function kullanici(req) {
  const b = req.headers.authorization || '';
  if (!b.startsWith('Bearer ')) return null;
  const t = b.slice(7);
  const o = oturumlar.get(t);
  if (o && o.son > Date.now()) return o.k;
  const r = await fetch(HESAP + '/ben', { headers: { Authorization: b } });
  if (!r.ok) { oturumlar.delete(t); return null; }
  const { kullanici: k } = await r.json();
  oturumlar.set(t, { k, son: Date.now() + 5 * 60e3 });
  if (oturumlar.size > 200) oturumlar.delete(oturumlar.keys().next().value);
  return k;
}
const evYetkisi = k => k && (k.rol === 'yonetici' || (k.alanlar || []).includes('ev'));

// ---- CUBE
async function cube(yontem, yol, govde) {
  if (!cubeToken) throw Object.assign(new Error('iHost eşleştirilmedi'), { durum: 409 });
  const r = await fetch(API + yol, {
    method: yontem,
    headers: { Authorization: 'Bearer ' + cubeToken, 'Content-Type': 'application/json' },
    body: govde ? JSON.stringify(govde) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (j.error === 401) throw Object.assign(new Error('iHost belirteci geçersiz, yeniden eşleştir'), { durum: 409 });
  if (!r.ok || j.error) throw Object.assign(new Error(j.message || 'iHost hatası ' + (j.error || r.status)), { durum: 502 });
  return j.data;
}
function sadele(c) {
  const s = c.state || {};
  const kanallar = s.toggle ? Object.keys(s.toggle).sort((a, b) => a - b) : [];
  const adlar = (c.tags && c.tags.toggle) || {};
  const ortak = {
    tur: c.display_category,
    cevrimici: c.online !== false,
    parlaklik: s.brightness ? s.brightness.brightness : null,
    dimmer: (c.capabilities || []).some(x => x.capability === 'brightness'),
  };
  const ad = c.name || (c.manufacturer + ' ' + c.model);
  if (kanallar.length > 1) return kanallar.map(k => Object.assign({}, ortak, {
    id: c.serial_number + ':' + k,
    ad: adlar[k] ? `${ad} · ${adlar[k]}` : `${ad} · ${k}`,
    acik: s.toggle[k].toggleState === 'on',
  }));
  return [Object.assign({}, ortak, {
    id: c.serial_number, ad,
    acik: s.power ? s.power.powerState === 'on' : kanallar.length ? s.toggle[kanallar[0]].toggleState === 'on' : null,
  })];
}

// ---- HTTP
function yanit(res, durum, veri) {
  res.writeHead(durum, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': KAYNAK,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
  });
  res.end(JSON.stringify(veri));
}
const govdeOku = req => new Promise((ok, red) => {
  let v = ''; req.on('data', p => { v += p; if (v.length > 1e4) req.destroy(); });
  req.on('end', () => { try { ok(v ? JSON.parse(v) : {}); } catch { red(Object.assign(new Error('Geçersiz istek'), { durum: 400 })); } });
});

http.createServer(async (req, res) => {
  const yol = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'OPTIONS') return yanit(res, 204, {});
    if (yol === '/saglik') return yanit(res, 200, { ok: true, eslesti: !!cubeToken });

    const k = await kullanici(req);
    if (!k) return yanit(res, 401, { hata: 'Oturum gerekli' });
    if (!evYetkisi(k)) return yanit(res, 403, { hata: 'Ev alanına erişimin yok' });

    if (yol === '/eslestir' && req.method === 'POST') {
      if (k.rol !== 'yonetici') return yanit(res, 403, { hata: 'Yalnız yönetici' });
      const r = await fetch(API + '/bridge/access_token');
      const j = await r.json().catch(() => ({}));
      if (j.error || !j.data || !j.data.token)
        return yanit(res, 409, { hata: 'iHost üstündeki düğmeye bas, sonra 5 dakika içinde tekrar dene' });
      cubeToken = j.data.token;
      try { fs.mkdirSync('/data', { recursive: true }); fs.writeFileSync(TOKEN_DOSYA, cubeToken); } catch { }
      return yanit(res, 200, { ok: true });
    }
    if (yol === '/cihazlar' && req.method === 'GET') {
      const d = await cube('GET', '/devices');
      return yanit(res, 200, { cihazlar: (d.device_list || []).flatMap(sadele) });
    }
    const m = yol.match(/^\/cihaz\/([^/]+)$/);
    if (m && req.method === 'POST') {
      const b = await govdeOku(req), state = {};
      const [seri, kanal] = decodeURIComponent(m[1]).split(':');
      if (typeof b.acik === 'boolean') {
        if (kanal) state.toggle = { [kanal]: { toggleState: b.acik ? 'on' : 'off' } };
        else state.power = { powerState: b.acik ? 'on' : 'off' };
      }
      if (Number.isFinite(b.parlaklik)) state.brightness = { brightness: Math.max(1, Math.min(100, Math.round(b.parlaklik))) };
      if (!Object.keys(state).length) return yanit(res, 400, { hata: 'acik ya da parlaklik gerekli' });
      await cube('PUT', '/devices/' + encodeURIComponent(seri), { state });
      return yanit(res, 200, { ok: true });
    }
    yanit(res, 404, { hata: 'Bulunamadı' });
  } catch (e) {
    yanit(res, e.durum || 500, { hata: e.message || 'Hata' });
  }
}).listen(PORT, () => console.log(`iHost köprüsü :${PORT}, CUBE ${CUBE || '(adres yok!)'}, eşleşme ${cubeToken ? 'var' : 'yok'}`));

// ---- Tünel adresini hesap servisine bildir (panel köprüye hesap servisi üzerinden ulaşır)
let sonAdres = '';
async function bildir() {
  if (!ANAHTAR) return;
  let log = '';
  try { log = fs.readFileSync(CF_LOG, 'utf8'); } catch { return; }
  const hepsi = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
  const adres = process.env.KOPRU_ADRES || (hepsi && hepsi[hepsi.length - 1]);
  if (!adres || adres === sonAdres) return;
  try {
    const r = await fetch(HESAP + '/kopru/kayit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ad: 'ihost', url: adres, anahtar: ANAHTAR }) });
    if (r.ok) { sonAdres = adres; console.log('Hesap servisine bildirildi:', adres); }
    else console.log('Bildirim reddedildi:', r.status, await r.text());
  } catch (e) { console.log('Bildirim gönderilemedi:', e.message); }
}
setInterval(bildir, 10000); setTimeout(bildir, 3000);
