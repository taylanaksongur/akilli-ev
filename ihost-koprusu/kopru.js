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
/* Hesap servisine kayıt anahtarı: ilk açılışta üretilir, /data'da saklanır. İlk kayıt anahtarı servise bağlar;
   /data kaybolursa yönetici Aksi'den köprü kaydını sıfırlar (DELETE /kopru/ihost). */
let ANAHTAR = process.env.KOPRU_ANAHTAR || '';
if (!ANAHTAR) {
  try { ANAHTAR = fs.readFileSync('/data/kopru-anahtar', 'utf8').trim(); } catch { }
  if (!ANAHTAR) {
    ANAHTAR = require('crypto').randomBytes(24).toString('hex');
    try { fs.mkdirSync('/data', { recursive: true }); fs.writeFileSync('/data/kopru-anahtar', ANAHTAR); } catch { }
  }
}
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

// ---- Meross: bulut hesabıyla bir kez giriş (anahtar + cihaz listesi), sonra ev ağında yerel HTTP ile kontrol.
// Şifre saklanmaz; /data/meross.json yalnızca anahtar, belirteç ve cihazları tutar.
const md5 = s => require('crypto').createHash('md5').update(s).digest('hex');
const MEROSS_DOSYA = '/data/meross.json';
let MR = { key: '', token: '', domain: '', cihazlar: [] };
try { MR = Object.assign(MR, JSON.parse(fs.readFileSync(MEROSS_DOSYA, 'utf8'))); } catch { }
const mrKaydet = () => { try { fs.mkdirSync('/data', { recursive: true }); fs.writeFileSync(MEROSS_DOSYA, JSON.stringify(MR)); } catch { } };
const MR_GIZLI = '23x17ahWarFH6w29';
const rastgele = n => require('crypto').randomBytes(n).toString('hex').slice(0, n).toUpperCase();

async function mrBulut(domain, yol, params, token) {
  const ts = Date.now(), nonce = rastgele(16), p = Buffer.from(JSON.stringify(params)).toString('base64');
  const govde = { params: p, sign: md5(MR_GIZLI + ts + nonce + p), timestamp: ts, nonce };
  const r = await fetch(domain + yol, { method: 'POST',
    headers: { 'Content-Type': 'application/json', AppVersion: '0.4.6.4', vender: 'meross', AppType: 'MerossIOT', AppLanguage: 'EN',
      Authorization: 'Basic ' + (token || '') }, body: JSON.stringify(govde) });
  return r.json();
}
async function mrGiris(eposta, sifre, mfa) {
  let domain = 'https://iotx-eu.meross.com';
  const veri = { email: eposta, password: md5(sifre), encryption: 1, accountCountryCode: '--', agree: 0,
    mobileInfo: { deviceModel: 'Aksi', mobileOsVersion: '1', mobileOs: 'Linux', uuid: rastgele(16), carrier: '' } };
  if (mfa) veri.mfaCode = String(mfa);
  for (let i = 0; i < 3; i++) {
    const j = await mrBulut(domain, '/v1/Auth/signIn', veri);
    if (j.apiStatus === 0 && j.data) return Object.assign(j.data, { domain: j.data.domain || domain });
    if (j.apiStatus === 1030 && j.data && j.data.domain) { domain = j.data.domain; continue; }   // başka bölge
    if (j.apiStatus === 1033) throw Object.assign(new Error('İki adımlı doğrulama kodu gerekli'), { durum: 428 });
    throw Object.assign(new Error('Meross girişi başarısız: ' + (j.info || j.apiStatus)), { durum: 401 });
  }
  throw Object.assign(new Error('Meross bölgesi bulunamadı'), { durum: 502 });
}
async function mrYerel(ip, uuid, yontem, ns, payload, ms = 1500) {
  const ts = Math.floor(Date.now() / 1000), mid = md5(rastgele(16) + ts);
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(`http://${ip}/config`, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ header: { from: `http://${ip}/config`, messageId: mid, method: yontem, namespace: ns, payloadVersion: 1,
        sign: md5(mid + MR.key + ts), timestamp: ts, triggerSrc: 'Aksi', uuid: uuid || '' }, payload: payload || {} }) });
    return await r.json();
  } finally { clearTimeout(t); }
}
/* Ev ağında Meross cihazlarını bul: iHost'un alt ağını tarar, uuid ile eşleştirir */
let mrTaraniyor = false, mrSonTarama = 0;
async function mrTara() {
  if (mrTaraniyor || !MR.key || !MR.cihazlar.length) return;
  mrTaraniyor = true; mrSonTarama = Date.now();
  try {
    const m = CUBE.match(/\/\/(\d+)\.(\d+)\.(\d+)\.\d+/);
    if (!m) return;
    /* Deco gibi ağlar /22 kullanır (ör. 192.168.68.0–192.168.71.255): bulunduğu 4'lü bloğun hepsi taranır */
    const b0 = +m[3] - (+m[3] % 4), ags = (process.env.MEROSS_AGLAR || '').split(',').filter(Boolean);
    if (!ags.length) for (let k = 0; k < 4; k++) ags.push(`${m[1]}.${m[2]}.${b0 + k}`);
    const ips = ags.flatMap(ag => Array.from({ length: 254 }, (_, i) => `${ag}.${i + 1}`));
    const bul = {}, yanit = [];
    for (let i = 0; i < ips.length; i += 24) await Promise.all(ips.slice(i, i + 24).map(async ip => {
      try { const j = await mrYerel(ip, '', 'GET', 'Appliance.System.All', {}, 2500);
        if (!j || !j.header) return;
        const u = j.payload && j.payload.all && j.payload.all.system && j.payload.all.system.hardware && j.payload.all.system.hardware.uuid;
        if (u) bul[u] = ip;
        yanit.push(ip + (u ? ' ' + u.slice(-6) : ' ' + j.header.method + ' ' + JSON.stringify(j.payload || {}).slice(0, 60)));
      } catch { }
    }));
    console.log('Meross yanıt veren adresler:', yanit.length ? yanit.join(' | ') : 'yok');
    MR.sonTarama = { zaman: Date.now(), aglar: ags, yanit };
    MR.cihazlar.forEach(c => { if (bul[c.uuid]) c.ip = bul[c.uuid]; });
    mrKaydet();
    console.log('Meross tarama:', Object.keys(bul).length, 'cihaz bulundu');
  } finally { mrTaraniyor = false; }
}
async function mrBaglan(b) {
  const g = await mrGiris(String(b.eposta || '').trim(), String(b.sifre || ''), b.kod);
  const j = await mrBulut(g.domain, '/v1/Device/devList', {}, g.token);
  if (j.apiStatus !== 0) throw Object.assign(new Error('Meross cihaz listesi alınamadı'), { durum: 502 });
  MR = { key: g.key, token: g.token, domain: g.domain, cihazlar: (j.data || []).map(d => ({
    uuid: d.uuid, ad: d.devName, tur: d.deviceType,
    kanallar: (d.channels || [{}]).map((k, i) => ({ no: i, ad: k.devName || '' })),
    ip: (MR.cihazlar.find(x => x.uuid === d.uuid) || {}).ip || '' })) };
  mrKaydet();
  mrTara();   // arka planda (1-2 dk)
  return { cihaz: MR.cihazlar.length, bulunan: MR.cihazlar.filter(c => c.ip).length, taraniyor: true };
}
/* Panel listesine Meross kanalları: id = meross:<uuid>:<kanal> */
async function mrListe() {
  if (!MR.key) return [];
  if (MR.cihazlar.some(c => !c.ip) && Date.now() - mrSonTarama > 10 * 60e3) mrTara();
  const out = [];
  await Promise.all(MR.cihazlar.map(async c => {
    let dur = null;
    if (c.ip) try {
      const j = await mrYerel(c.ip, c.uuid, 'GET', 'Appliance.System.All', {});
      const dg = j.payload && j.payload.all && j.payload.all.digest;
      dur = {}; ((dg && dg.togglex) || []).forEach(t => dur[t.channel] = t.onoff === 1);
      if (dg && dg.toggle && 'onoff' in dg.toggle) dur[0] = dg.toggle.onoff === 1;
    } catch { if (Date.now() - mrSonTarama > 10 * 60e3) mrTara(); }
    const coklu = c.kanallar.length > 1;
    (coklu ? c.kanallar.slice(1) : c.kanallar).forEach(k => out.push({
      id: `meross:${c.uuid}:${k.no}`, ad: coklu ? `${c.ad} · ${k.ad || k.no}` : c.ad, tur: 'switch', kaynak: 'Meross',
      cevrimici: !!dur, acik: dur ? !!dur[k.no] : null, parlaklik: null, dimmer: false }));
  }));
  return out;
}
async function mrKomut(id, acik) {
  const [, uuid, kanal] = id.split(':');
  const c = MR.cihazlar.find(x => x.uuid === uuid);
  if (!c) throw Object.assign(new Error('Meross cihazı bulunamadı'), { durum: 404 });
  if (!c.ip) { mrTara(); throw Object.assign(new Error('Meross cihazı ağda bulunamadı'), { durum: 503 }); }
  const j = await mrYerel(c.ip, c.uuid, 'SET', 'Appliance.Control.ToggleX', { togglex: { channel: +kanal || 0, onoff: acik ? 1 : 0 } });
  if (j && j.header && j.header.method === 'ERROR') {   // eski cihazlar: Toggle
    await mrYerel(c.ip, c.uuid, 'SET', 'Appliance.Control.Toggle', { toggle: { onoff: acik ? 1 : 0 } });
  }
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
    if (yol === '/meross/giris' && req.method === 'POST') {
      if (k.rol !== 'yonetici') return yanit(res, 403, { hata: 'Yalnız yönetici' });
      return yanit(res, 200, await mrBaglan(await govdeOku(req)));
    }
    if (yol === '/meross/tara' && req.method === 'POST') {
      if (k.rol !== 'yonetici') return yanit(res, 403, { hata: 'Yalnız yönetici' });
      mrTara(); return yanit(res, 200, { bulunan: MR.cihazlar.filter(c => c.ip).length, cihaz: MR.cihazlar.length, taraniyor: true });
    }
    if (yol === '/meross/durum' && req.method === 'GET') {
      return yanit(res, 200, { taraniyor: mrTaraniyor, son: MR.sonTarama || null,
        cihazlar: MR.cihazlar.map(c => ({ ad: c.ad, ip: c.ip || null })), surum: 3 });
    }
    if (yol === '/cihazlar' && req.method === 'GET') {
      const [ih, mr] = await Promise.all([
        cubeToken ? cube('GET', '/devices').then(d => (d.device_list || []).flatMap(sadele)) : Promise.resolve([]),
        mrListe().catch(() => [])]);
      return yanit(res, 200, { cihazlar: ih.concat(mr), meross: { bagli: !!MR.key, cihaz: MR.cihazlar.length } });
    }
    const m = yol.match(/^\/cihaz\/([^/]+)$/);
    if (m && req.method === 'POST') {
      const b = await govdeOku(req), state = {};
      const kimlik = decodeURIComponent(m[1]);
      if (kimlik.startsWith('meross:')) {
        if (typeof b.acik !== 'boolean') return yanit(res, 400, { hata: 'acik gerekli' });
        await mrKomut(kimlik, b.acik); return yanit(res, 200, { ok: true });
      }
      const [seri, kanal] = kimlik.split(':');
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
