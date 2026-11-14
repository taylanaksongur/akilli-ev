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

// ---- Aksi oturum denetimi: hesap servisinin /ben yanıtı 60 sn önbelleklenir (alan/rol değişikliği en geç 1 dk içinde
// geçerli olur); geçersiz belirteç 15 sn hatırlanır (hesap servisi boşuna yorulmasın). Hesap servisine ulaşılamazsa
// istek reddedilir (503), yetki varsayılmaz.
const oturumlar = new Map(), OTURUM_MS = 60e3, RED_MS = 15e3;
async function kullanici(req) {
  const b = req.headers.authorization || '';
  if (!/^Bearer [A-Za-z0-9_-]{20,100}$/.test(b)) return null;
  const t = b.slice(7);
  const o = oturumlar.get(t);
  if (o && o.son > Date.now()) return o.k;
  oturumlar.delete(t);
  let r;
  try { r = await fetch(HESAP + '/ben', { headers: { Authorization: b }, signal: AbortSignal.timeout(5000) }); }
  catch { throw Object.assign(new Error('Hesap servisine ulaşılamadı'), { durum: 503 }); }
  if (r.status === 401) { oturumlar.set(t, { k: null, son: Date.now() + RED_MS }); return null; }
  if (!r.ok) throw Object.assign(new Error('Hesap servisi yanıt vermedi'), { durum: 503 });
  const k = (await r.json().catch(() => ({}))).kullanici || null;
  oturumlar.set(t, { k, son: Date.now() + (k ? OTURUM_MS : RED_MS) });
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
    signal: AbortSignal.timeout(6000),
  }).catch(e => { throw Object.assign(new Error(e && e.name === 'TimeoutError' ? 'iHost yanıt vermedi' : 'iHost’a ulaşılamadı'), { durum: 504 }); });
  const j = await r.json().catch(() => ({}));
  if (j.error === 401) throw Object.assign(new Error('iHost belirteci geçersiz, yeniden eşleştir'), { durum: 409 });
  if (!r.ok || j.error) throw Object.assign(new Error(j.message || 'iHost hatası ' + (j.error || r.status)), { durum: 502 });
  return j.data;
}
function hareketOku(s) {
  const hv = s.motion ? s.motion.motion : s.detect ? s.detect.detected : s.presence ? (s.presence.presence !== undefined ? s.presence.presence : s.presence.detected) : undefined;
  return typeof hv === 'boolean' ? hv : typeof hv === 'string' ? /^(true|on|detected|occupied|presence)$/i.test(hv) : null;
}
function sadele(c) {
  const s = c.state || {};
  const kanallar = s.toggle ? Object.keys(s.toggle).sort((a, b) => a - b) : [];
  const adlar = (c.tags && c.tags.toggle) || {};
  /* Hareket/varlık sensörleri: iHost 2.x 'motion', eski sürümler 'detect', varlık sensörleri 'presence' bildirir */
  const hv = s.motion ? s.motion.motion : s.detect ? s.detect.detected : s.presence ? (s.presence.presence !== undefined ? s.presence.presence : s.presence.detected) : undefined;
  let hv2 = hv;
  if (hv2 === undefined) {   /* bilinen ad yoksa: güç/ışık dışındaki ilk mantıksal (açık/kapalı) durum */
    const atla = /^(power|toggle|brightness|color|temperature|humidity|battery|rssi|online|identify|startup|illumination|signal|firmware)/i;
    for (const k of Object.keys(s)) { if (atla.test(k) || !s[k] || typeof s[k] !== 'object') continue;
      const b = Object.values(s[k]).find(v => typeof v === 'boolean'); if (b !== undefined) { hv2 = b; break; } }
  }
  const sens = {
    hareket: typeof hv2 === 'boolean' ? hv2 : typeof hv2 === 'string' ? /^(true|on|detected|occupied|presence)$/i.test(hv2) : null,
    sicaklik: s.temperature && typeof s.temperature.temperature === 'number' ? s.temperature.temperature : null,
    nem: s.humidity && typeof s.humidity.humidity === 'number' ? s.humidity.humidity : null,
    yetenekler: Object.keys(s),
  };
  const ortak = Object.assign(sens, {
    tur: c.display_category,
    cevrimici: c.online !== false,
    parlaklik: s.brightness ? s.brightness.brightness : null,
    dimmer: (c.capabilities || []).some(x => x.capability === 'brightness'),
  });
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

/* Hareket sensörleri yalnız değişimde bildirir; "son hareket" zamanı için köprü cihaz listesini kendisi de izler */
const HAREKET_DOSYA = process.env.HAREKET_DOSYA || '/data/hareket.json';
let SON = {}, sonOnceki = {}, sonKaydetT = 0;
try { SON = JSON.parse(fs.readFileSync(HAREKET_DOSYA, 'utf8')); } catch { }
async function cubeListe() {
  const d = await cube('GET', '/devices');
  const l = (d.device_list || []).flatMap(sadele);
  let degisti = false;
  l.forEach(c => {
    const sn = c.id.split(':')[0];
    if (c.hareket === true && sonOnceki[sn] !== true) { SON[sn] = Date.now(); degisti = true; }
    if (c.hareket !== null && c.hareket !== undefined) sonOnceki[sn] = c.hareket;
    const an = ANLIK[sn];
    if (an) {   /* durumda hareket alanı yoksa anlık olaydan al; açık kalan 'hareket var' 3 dk sonra düşer */
      if ((c.hareket === null || c.hareket === undefined) && typeof an.v === 'boolean') c.hareket = an.v === true && Date.now() - an.vt < 180e3;
      c.yetenekler = Array.from(new Set((c.yetenekler || []).concat(an.k)));
    }
    if (SON[sn]) c.sonHareket = SON[sn];
  });
  if (degisti && Date.now() - sonKaydetT > 5000) { sonKaydetT = Date.now(); try { fs.mkdirSync('/data', { recursive: true }); fs.writeFileSync(HAREKET_DOSYA, JSON.stringify(SON)); } catch { } }
  return l;
}
/* iHost olay akışı (SSE): Zigbee hareket sensörleri durumu yalnız olay olarak bildirir */
const ANLIK = {}; const OLAYLAR = []; let sseTazeT = 0;
function olayIsle(ad, ham) {
  let d; try { d = JSON.parse(ham); } catch { return; }
  const sn = d && d.endpoint && d.endpoint.serial_number, pl = d && d.payload; if (!sn || !pl || typeof pl !== 'object') return;
  const anahtarlar = Object.keys(pl);
  OLAYLAR.push(`${new Date().toISOString().slice(11, 19)} ${ad} ${sn} [${anahtarlar.join(',')}]`); if (OLAYLAR.length > 30) OLAYLAR.shift();
  const h = hareketOku(pl);
  if (cubeToken && Date.now() - sseTazeT > 2000) { sseTazeT = Date.now(); setTimeout(() => onTazele('ih'), 300); }   /* durum olayı: listeyi hemen tazele */
  const an = ANLIK[sn] = Object.assign(ANLIK[sn] || { k: [] }, { t: Date.now() });
  an.k = Array.from(new Set(an.k.concat(anahtarlar)));
  if (h !== null) {
    an.v = h; an.vt = Date.now();
    if (h === true && sonOnceki[sn] !== true) { SON[sn] = Date.now(); try { fs.mkdirSync('/data', { recursive: true }); fs.writeFileSync(HAREKET_DOSYA, JSON.stringify(SON)); } catch { } }
    sonOnceki[sn] = h;
    console.log('Hareket olayı', sn, h);
  }
}
let sseCalisiyor = false;
async function sseBaslat() {
  if (sseCalisiyor || !cubeToken || !CUBE) return; sseCalisiyor = true;
  try {
    const r = await fetch(CUBE + '/open-api/v1/sse/bridge?access_token=' + encodeURIComponent(cubeToken), { headers: { Accept: 'text/event-stream' } });
    if (!r.ok || !r.body) throw new Error('SSE ' + r.status);
    console.log('iHost olay akışı açık');
    const dec = new TextDecoder(); let tampon = '', ad = '', veri = [];
    for await (const parca of r.body) {
      tampon += dec.decode(parca, { stream: true });
      let i; while ((i = tampon.indexOf('\n')) >= 0) {
        const sat = tampon.slice(0, i).replace(/\r$/, ''); tampon = tampon.slice(i + 1);
        if (sat === '') { if (veri.length) olayIsle(ad || 'mesaj', veri.join('\n')); ad = ''; veri = []; }
        else if (sat.startsWith('event:')) ad = sat.slice(6).trim();
        else if (sat.startsWith('data:')) veri.push(sat.slice(5).trim());
      }
    }
  } catch (e) { console.log('iHost olay akışı koptu:', e.message); }
  sseCalisiyor = false;
}
setInterval(sseBaslat, 10000); setTimeout(sseBaslat, 2000);

/* Cihaz listesi önbelleği: GET /cihazlar anında döner, kaynaklar (iHost, Meross, Cosa) arkada ayrı ayrı tazelenir.
   Böylece yavaş bir kaynak (kapalı Meross, bulut) tüm listeyi bekletmez. */
const ON = { ih: { l: [], t: 0, d: 0 }, mr: { l: [], t: 0, d: 0 }, cs: { l: [], t: 0, d: 0 } }, onIs = {};
function onTazele(a) {
  if (onIs[a]) return onIs[a];
  const f = a === 'ih' ? () => (cubeToken ? cubeListe() : Promise.resolve([])) : a === 'mr' ? () => mrListe() : () => csListe();
  return onIs[a] = f().then(l => { ON[a].l = l; ON[a].t = Date.now(); }).catch(() => { }).finally(() => { ON[a].d = 1; onIs[a] = null; });
}
/* Uyarlamalı yoklama: son KOPRU_AKTIF_MS içinde istek (GET /cihazlar, POST /cihaz) geldiyse hızlı, gelmediyse yavaş aralık.
   Cosa hiçbir zaman 20 sn'den sık yoklanmaz; cubeListe yavaş modda da 15 sn'de bir çalışır (sonHareket kaçmasın). */
const AKTIF_MS = +process.env.KOPRU_AKTIF_MS || 60e3, HIZLI_MS = +process.env.KOPRU_HIZLI_MS || 4000, YAVAS_MS = +process.env.KOPRU_YAVAS_MS || 15000;
const ARALIK = { hizli: { ih: HIZLI_MS, mr: HIZLI_MS * 2, cs: Math.max(HIZLI_MS * 5, process.env.KOPRU_HIZLI_MS ? 0 : 20000) }, yavas: { ih: YAVAS_MS, mr: YAVAS_MS * 2, cs: YAVAS_MS * 4 } };
let sonIstekT = 0; const MS = { son: null };
const hizliMi = () => Date.now() - sonIstekT < AKTIF_MS;
const aralik = a => ARALIK[hizliMi() ? 'hizli' : 'yavas'][a];
function istekGeldi() {   /* uyanış: eski önbelleği hemen arkada yenile */
  sonIstekT = Date.now();
  for (const a of ['ih', 'mr', 'cs']) if (ON[a].d && Date.now() - ON[a].t > ARALIK.hizli[a]) onTazele(a);
}
setInterval(() => { for (const a of ['ih', 'mr', 'cs']) if (Date.now() - ON[a].t >= aralik(a) - 250) onTazele(a); }, Math.max(100, Math.min(1000, HIZLI_MS / 2)));
setTimeout(() => { onTazele('ih'); onTazele('mr'); onTazele('cs'); }, 500);
/* Komut gittikten sonra önbelleği hemen güncelle (panel eski durumu görüp ışığı geri çevirmesin), sonra gerçeği oku */
function onYaz(kimlik, b) {
  for (const a of ['ih', 'mr', 'cs']) { const c = ON[a].l.find(x => x.id === kimlik); if (!c) continue;
    if (typeof b.acik === 'boolean') c.acik = b.acik; if (Number.isFinite(b.parlaklik)) c.parlaklik = b.parlaklik; if (Number.isFinite(b.hedef)) c.hedef = b.hedef;
    setTimeout(() => onTazele(a), 1500); return; }
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
/* Meross bulut (MQTT): yerelde bulunamayan cihazlar için. Giriş bilgisinden userid + key ile bağlanır. */
let mq = null, mqAppId = '', mqBekleyen = new Map();
function mqBaglan() {
  if (mq || !MR.userid || !MR.mqttDomain) return mq;
  let mqtt; try { mqtt = require('mqtt'); } catch { console.log('mqtt paketi yok'); return null; }
  mqAppId = md5('API' + rastgele(16));
  mq = mqtt.connect(process.env.MEROSS_MQTT_URL || `mqtts://${MR.mqttDomain}:443`, { clientId: 'app:' + mqAppId, username: String(MR.userid),
    password: md5(String(MR.userid) + MR.key), protocolVersion: 4, keepalive: 30, reconnectPeriod: 5000, rejectUnauthorized: true });
  const cevap = `/app/${MR.userid}-${mqAppId}/subscribe`;
  mq.on('connect', () => { mq.subscribe([`/app/${MR.userid}/subscribe`, cevap]); console.log('Meross bulut bağlandı'); });
  mq.on('error', e => console.log('Meross bulut hata:', e.message));
  mq.on('message', (t, m) => { try { const j = JSON.parse(m.toString()), b = mqBekleyen.get(j.header && j.header.messageId);
    if (b) { mqBekleyen.delete(j.header.messageId); b(j); } } catch { } });
  return mq;
}
function mrBulutIstek(uuid, yontem, ns, payload, ms = 6000) {
  const c = mqBaglan();
  if (!c) return Promise.reject(Object.assign(new Error('Meross bulut bağlantısı yok; Ayarlar’dan yeniden bağlan'), { durum: 503 }));
  const ts = Math.floor(Date.now() / 1000), mid = md5(rastgele(16) + ts);
  return new Promise((ok, red) => {
    const t = setTimeout(() => { mqBekleyen.delete(mid); red(Object.assign(new Error('Meross cihazı yanıt vermedi'), { durum: 504 })); }, ms);
    mqBekleyen.set(mid, j => { clearTimeout(t); ok(j); });
    c.publish(`/appliance/${uuid}/subscribe`, JSON.stringify({ header: { from: `/app/${MR.userid}-${mqAppId}/subscribe`, messageId: mid,
      method: yontem, namespace: ns, payloadVersion: 1, sign: md5(mid + MR.key + ts), timestamp: ts, triggerSrc: 'Android', uuid }, payload: payload || {} }));
  });
}
const mrIstek = (c, yontem, ns, payload) => c.ip ? mrYerel(c.ip, c.uuid, yontem, ns, payload) : mrBulutIstek(c.uuid, yontem, ns, payload);
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
  if (mq) { try { mq.end(true); } catch { } mq = null; }
  MR = { key: g.key, token: g.token, domain: g.domain, userid: g.userid, mqttDomain: g.mqttDomain, cihazlar: (j.data || []).map(d => ({
    uuid: d.uuid, ad: d.devName, tur: d.deviceType,
    kanallar: (d.channels || [{}]).map((k, i) => ({ no: i, ad: k.devName || '' })),
    ip: (MR.cihazlar.find(x => x.uuid === d.uuid) || {}).ip || '' })) };
  mrKaydet();
  mqBaglan();
  return { cihaz: MR.cihazlar.length, bulunan: MR.cihazlar.filter(c => c.ip).length, bulut: !!MR.mqttDomain };
}
/* Panel listesine Meross kanalları: id = meross:<uuid>:<kanal> */
async function mrListe() {
  if (!MR.key) return [];
  const out = [];
  await Promise.all(MR.cihazlar.map(async c => {
    let dur = null;
    try {
      const j = await mrIstek(c, 'GET', 'Appliance.System.All', {});
      const dg = j.payload && j.payload.all && j.payload.all.digest;
      dur = {}; ((dg && dg.togglex) || []).forEach(t => dur[t.channel] = t.onoff === 1);
      if (dg && dg.toggle && 'onoff' in dg.toggle) dur[0] = dg.toggle.onoff === 1;
    } catch { }
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
  const j = await mrIstek(c, 'SET', 'Appliance.Control.ToggleX', { togglex: { channel: +kanal || 0, onoff: acik ? 1 : 0 } });
  if (j && j.header && j.header.method === 'ERROR') {   // eski cihazlar: Toggle
    await mrIstek(c, 'SET', 'Appliance.Control.Toggle', { toggle: { onoff: acik ? 1 : 0 } });
  }
}

// ---- Cosa akıllı termostat: resmi arayüz yok; Cosa uygulamasının kullandığı bulut arayüzü (kiwi.cosa.com.tr).
// Giriş bilgisi yalnızca iHost'un /data/cosa.json dosyasında durur (belirteç süresi dolunca otomatik yeniden giriş).
const COSA = process.env.COSA_ADRES || 'https://kiwi.cosa.com.tr/api', COSA_DOSYA = process.env.COSA_DOSYA || '/data/cosa.json';
let CS = { eposta: '', sifre: '', token: '', cihazlar: [] };
try { CS = Object.assign(CS, JSON.parse(fs.readFileSync(COSA_DOSYA, 'utf8'))); } catch { }
const csKaydet = () => { try { fs.mkdirSync('/data', { recursive: true }); fs.writeFileSync(COSA_DOSYA, JSON.stringify(CS), { mode: 0o600 }); } catch { } };
async function csAl(yol, govde, token) {
  const r = await fetch(COSA + yol, { method: govde ? 'POST' : 'GET', signal: AbortSignal.timeout(8000),
    headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, token ? { authToken: token } : {}),
    body: govde ? JSON.stringify(govde) : undefined });
  const j = await r.json().catch(() => ({}));
  return { durum: r.status, j };
}
async function csGiris() {
  if (!CS.eposta || !CS.sifre) throw Object.assign(new Error('Cosa bağlı değil'), { durum: 409 });
  const { durum, j } = await csAl('/users/login', { email: CS.eposta, password: CS.sifre });
  if (!j.authToken) throw Object.assign(new Error('Cosa girişi başarısız' + (durum ? ' (' + durum + ')' : '')), { durum: 401 });
  CS.token = j.authToken; csKaydet(); return CS.token;
}
async function csIstek(yol, govde, tekrar = true) {
  if (!CS.token) await csGiris();
  const { durum, j } = await csAl(yol, govde, CS.token);
  if ((durum === 401 || durum === 403) && tekrar) { CS.token = ''; await csGiris(); return csIstek(yol, govde, false); }
  if (durum >= 400) throw Object.assign(new Error('Cosa hatası ' + durum), { durum: 502 });
  return j;
}
async function csBaglan(b) {
  CS = { eposta: String(b.eposta || '').trim(), sifre: String(b.sifre || ''), token: '', cihazlar: [] };
  await csGiris();
  const j = await csIstek('/endpoints/getEndpoints');
  CS.cihazlar = (j.endpoints || []).map(e => ({ id: e.id, ad: e.name }));
  csKaydet();
  return { cihaz: CS.cihazlar.length };
}
async function csListe() {
  if (!CS.eposta) return [];
  return Promise.all(CS.cihazlar.map(async c => {
    let e = null;
    try { e = (await csIstek('/endpoints/getEndpoint', { endpoint: c.id })).endpoint; } catch { }
    const mod = e && e.option != null ? e.option !== 'frozen' : null;
    return { id: 'cosa:' + c.id, ad: c.ad, tur: 'thermostat', kaynak: 'Cosa', cevrimici: !!e, acik: mod, parlaklik: null, dimmer: false,
      sicaklik: e && typeof e.temperature === 'number' ? e.temperature : null,
      hedef: e && typeof e.targetTemperature === 'number' ? e.targetTemperature : null,
      isitiyor: e ? e.combiState === 'on' : null, nem: e && typeof e.humidity === 'number' ? e.humidity : null };
  }));
}
const csSicak = e => ({ home: e.homeTemperature, away: e.awayTemperature, sleep: e.sleepTemperature, custom: e.customTemperature });
async function csKomut(id, b) {
  const uid = id.slice(5);
  const e = (await csIstek('/endpoints/getEndpoint', { endpoint: uid })).endpoint || {};
  if (Number.isFinite(b.hedef)) {
    /* Hedef, o an etkin olan ayarın (home/sleep/away/custom) sıcaklığı olarak yazılır; diğerleri aynen korunur */
    const t = Math.max(5, Math.min(30, Math.round(b.hedef * 2) / 2)), tum = csSicak(e);
    const anahtar = tum[e.option] !== undefined ? e.option : 'home';
    for (const k in tum) if (!Number.isFinite(tum[k])) tum[k] = 5;
    tum[anahtar] = t;
    await csIstek('/endpoints/setTargetTemperatures', { endpoint: uid, targetTemperatures: tum });
  }
  if (typeof b.acik === 'boolean') {
    if (!b.acik) await csIstek('/endpoints/setMode', { endpoint: uid, mode: 'manual', option: 'frozen' });
    else if (e.option === 'frozen') await csIstek('/endpoints/setMode', { endpoint: uid, mode: e.previousMode || 'schedule', option: e.previousOption || 'home' });
  }
}

// ---- LG webOS TV (lgtv2 paketi): ilk bağlanışta TV ekranında izin sorusu çıkar; anahtar /data/lg-key'de durur.
// Açmak için Wake-on-LAN (TV ayarında "Wi-Fi/LAN ile aç" açık olmalı); MAC TV'den otomatik öğrenilir.
const LG_DOSYA = process.env.LG_DOSYA || '/data/lg.json';
let LG = { ip: '', ad: 'LG TV' };
try { LG = Object.assign(LG, JSON.parse(fs.readFileSync(LG_DOSYA, 'utf8'))); } catch { }
let LGC = null, LGS = { guc: null, ses: null, sessiz: null, istem: false, hata: '' };
function lgBaslat() {
  if (!LG.ip || LGC) return;
  let LGTV; try { LGTV = require('lgtv2'); LGTV = LGTV.default || LGTV; } catch (e) { LGS.hata = 'lgtv2 paketi yüklenemedi (Node 20.19+ gerekir)'; console.log(LGS.hata, e.message); return; }
  try { console.log('lgtv2 sürümü', require('lgtv2/package.json').version); } catch { }
  LGC = new LGTV(Object.assign({ host: LG.ip, keyFile: process.env.LG_ANAHTAR || '/data/lg-key', reconnect: 5000 }, LG.mac ? { mac: LG.mac } : {}));
  LGC.on('prompt', () => { LGS.istem = true; });
  LGC.on('error', e => { LGS.hata = String(e && e.message || e).slice(0, 120); console.log('LG hata:', LGS.hata); });
  LGC.on('close', () => { LGS.guc = null; });
  LGC.on('connect', () => {
    LGS.istem = false; LGS.hata = '';
    try { LGC.subscribe('ssap://audio/getVolume', (e, r) => { if (!e && r) { if (typeof r.volume === 'number') LGS.ses = r.volume; if (typeof r.muted === 'boolean') LGS.sessiz = r.muted; } }); } catch { }
    try { LGC.subscribe('ssap://com.webos.service.tvpower/power/getPowerState', (e, r) => { if (!e && r && r.state) LGS.guc = r.state; }); } catch { }
  });
}
function lgBilgi() {
  const acik = !!(LGC && LGC.connected) && !/standby|suspend|off/i.test(LGS.guc || '');
  return { id: 'lg:tv', ad: LG.ad, tur: 'tv', kaynak: 'LG', cevrimici: true, acik, parlaklik: null, dimmer: false, ses: LGS.ses, sessiz: LGS.sessiz };
}
async function lgKomut(b) {
  if (!LG.ip) throw Object.assign(new Error('LG TV bağlı değil'), { durum: 409 });
  lgBaslat();
  if (b.acik === true && !(LGC && LGC.connected)) {
    if (!LGC) throw Object.assign(new Error(LGS.hata || 'LG bağlantısı kurulamadı'), { durum: 502 });
    try { await LGC.wake(); } catch (e) { throw Object.assign(new Error('TV açılamadı (MAC henüz öğrenilmedi ya da TV’de “Wi-Fi ile aç” kapalı)'), { durum: 502 }); }
    return;
  }
  if (!LGC || !LGC.connected) throw Object.assign(new Error('TV kapalı ya da ulaşılamıyor'), { durum: 503 });
  if (b.acik === false) await LGC.request('ssap://system/turnOff');
  if (Number.isFinite(b.ses)) await LGC.request('ssap://audio/setVolume', { volume: Math.max(0, Math.min(100, Math.round(b.ses))) });
  if (Number.isFinite(b.sesDelta)) await LGC.request(b.sesDelta > 0 ? 'ssap://audio/volumeUp' : 'ssap://audio/volumeDown');
  if (typeof b.sessiz === 'boolean') await LGC.request('ssap://audio/setMute', { mute: b.sessiz });
  if (typeof b.giris === 'string' && b.giris) await LGC.request('ssap://tv/switchInput', { inputId: b.giris });
  if (typeof b.uygulama === 'string' && b.uygulama) await LGC.request('ssap://system.launcher/launch', { id: b.uygulama });
}
setTimeout(lgBaslat, 3000);

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
    if (yol === '/cosa/giris' && req.method === 'POST') {
      if (k.rol !== 'yonetici') return yanit(res, 403, { hata: 'Yalnız yönetici' });
      return yanit(res, 200, await csBaglan(await govdeOku(req)));
    }
    if (yol === '/lg/giris' && req.method === 'POST') {
      if (k.rol !== 'yonetici') return yanit(res, 403, { hata: 'Yalnız yönetici' });
      const b = await govdeOku(req), ip = String(b.ip || '').trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return yanit(res, 400, { hata: 'Geçerli bir IP adresi yaz (ör. 192.168.68.50)' });
      if (LGC) { try { LGC.disconnect(); } catch { } LGC = null; }
      const mac = String(b.mac || '').trim();
      if (mac && !/^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i.test(mac)) return yanit(res, 400, { hata: 'MAC adresi 90:7A:BE:6F:71:C8 biçiminde olmalı' });
      LG = { ip, ad: String(b.ad || 'LG TV').slice(0, 40) }; if (mac) LG.mac = mac.replace(/[^0-9a-f]/gi, '').replace(/(..)(?=.)/g, '$1:'); LGS = { guc: null, ses: null, sessiz: null, istem: false, hata: '' };
      try { fs.mkdirSync('/data', { recursive: true }); fs.writeFileSync(LG_DOSYA, JSON.stringify(LG)); } catch { }
      // webOS 26: TV'nin IP Control menüsünde ürettiği eşleştirme kodu istemci anahtarı olarak denenir (deneysel).
      const kod = String(b.kod || '').trim();
      if (kod) { if (!/^[\w-]{4,64}$/.test(kod)) return yanit(res, 400, { hata: 'Kod harf/rakamdan oluşmalı' }); try { fs.mkdirSync('/data', { recursive: true }); fs.writeFileSync(process.env.LG_ANAHTAR || '/data/lg-key', kod); } catch { } }
      lgBaslat();
      return yanit(res, 200, { ok: true });
    }
    if (yol === '/lg/durum' && req.method === 'GET') {
      if (k.rol !== 'yonetici') return yanit(res, 403, { hata: 'Yalnız yönetici' });
      return yanit(res, 200, { ip: LG.ip || null, bagli: !!(LGC && LGC.connected), istem: LGS.istem, hata: LGS.hata, guc: LGS.guc, ses: LGS.ses, sessiz: LGS.sessiz });
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
      if (k.rol !== 'yonetici') return yanit(res, 403, { hata: 'Yalnız yönetici' });
      return yanit(res, 200, { taraniyor: mrTaraniyor, son: MR.sonTarama || null,
        cihazlar: MR.cihazlar.map(c => ({ ad: c.ad, ip: c.ip || null })), surum: 6, bulut: !!(mq && mq.connected), bulutBilgi: !!MR.mqttDomain });
    }
    if (yol === '/cihazlar' && req.method === 'GET') {
      const ilk = ['ih', 'mr', 'cs'].filter(a => !ON[a].d);
      if (ilk.length) await Promise.race([Promise.all(ilk.map(onTazele)), new Promise(r => setTimeout(r, 4000))]);
      istekGeldi(); const simdi = Date.now();
      const ih = ON.ih.l, mr = ON.mr.l, cs = ON.cs.l.slice();
      if (LG.ip) cs.push(lgBilgi());
      return yanit(res, 200, { ms: MS.son, mod: hizliMi() ? 'hizli' : 'yavas', yas: { ih: ON.ih.t ? simdi - ON.ih.t : null, mr: ON.mr.t ? simdi - ON.mr.t : null, cs: ON.cs.t ? simdi - ON.cs.t : null }, eski: !!(cubeToken && (!ON.ih.t || simdi - ON.ih.t > 20000)), cihazlar: ih.concat(mr, cs), meross: { bagli: !!MR.key, cihaz: MR.cihazlar.length }, cosa: { bagli: !!CS.eposta, cihaz: CS.cihazlar.length }, lg: { ip: LG.ip || null, bagli: !!(LGC && LGC.connected), istem: LGS.istem } });
    }
    const m = yol.match(/^\/cihaz\/([^/]+)$/);
    if (m && req.method === 'POST') {
      istekGeldi(); const b = await govdeOku(req), state = {}, t0 = Date.now();
      const kimlik = decodeURIComponent(m[1]);
      if (kimlik.startsWith('lg:')) { await lgKomut(b); return yanit(res, 200, { ok: true, ms: MS.son = Date.now() - t0 }); }
      if (kimlik.startsWith('cosa:')) {
        if (!Number.isFinite(b.hedef) && typeof b.acik !== 'boolean') return yanit(res, 400, { hata: 'hedef ya da acik gerekli' });
        await csKomut(kimlik, b); onYaz(kimlik, b); return yanit(res, 200, { ok: true, ms: MS.son = Date.now() - t0 });
      }
      if (kimlik.startsWith('meross:')) {
        if (typeof b.acik !== 'boolean') return yanit(res, 400, { hata: 'acik gerekli' });
        await mrKomut(kimlik, b.acik); onYaz(kimlik, b); return yanit(res, 200, { ok: true, ms: MS.son = Date.now() - t0 });
      }
      const [seri, kanal] = kimlik.split(':');
      if (typeof b.acik === 'boolean') {
        if (kanal) state.toggle = { [kanal]: { toggleState: b.acik ? 'on' : 'off' } };
        else state.power = { powerState: b.acik ? 'on' : 'off' };
      }
      if (Number.isFinite(b.parlaklik)) state.brightness = { brightness: Math.max(1, Math.min(100, Math.round(b.parlaklik))) };
      if (!Object.keys(state).length) return yanit(res, 400, { hata: 'acik ya da parlaklik gerekli' });
      await cube('PUT', '/devices/' + encodeURIComponent(seri), { state });
      onYaz(kimlik, b);
      return yanit(res, 200, { ok: true, ms: MS.son = Date.now() - t0 });
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
setTimeout(mqBaglan, 2000);
