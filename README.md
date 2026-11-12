# Akıllı Ev v2 — Aksongur Ev Paneli

Evin akıllı ev kontrol paneli. Önce web'den test, sonra iOS/Android uygulamaları.

- **Kontrol:** Üç katın (Kat 1, Kat 2, Kat 3) 3B modeli; ışıklar, LED şeritler, sensörler, perdeler, Imou kameralar (dokununca sağ üstte canlı görüntü, çift tıkla tam ekran) ve Cosa termostat kartı.
- **Ayarlar:** Seçili katın planında aksesuar ekleme ve yerleştirme, senaryolar, bağlantı alanları.

Sürüm: 2.1
- **Cihazlar:** SONOFF iHost (Zigbee) ve Meross; termostat Homebridge üzerinden; Imou kameralar tekne paneliyle ortak köprüden (`kamera-koprusu/`, Cloudflare Worker `imou-kamera`) HLS olarak canlı gelir; kamera listesi Imou hesabından otomatik alınır. Kurulum: `kamera-koprusu/README.md`.

## Dosyalar

| Dosya | Açıklama |
|---|---|
| `index.html` | Panelin tamamı (tek dosya, Three.js CDN'den yüklenir) |
| `kamera-koprusu/worker.js` | Imou kamera köprüsü (Cloudflare Worker) |
| `data/aksesuarlar.json` | Mevcut aksesuarların yedeği (oda, tür, plan koordinatları) |

## Durum

- Panel şu an claude.ai artifact'i olarak çalışıyor; kayıtlar orada tutuluyor.
- Sıradaki adım: iHost üzerinde Docker paketi olarak çalışacak köprü servisi (iHost Open API + Meross) ve kayıtların SD karta taşınması.
- Hava durumu (Open-Meteo, Pendik) panel ev ağında çalışınca kendi kodundan gelecek.
