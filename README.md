# Akıllı Ev v2 — Aksongur Ev Paneli

Evin akıllı ev kontrol paneli. Önce web'den test, sonra iOS/Android uygulamaları.

- **Kontrol:** Giriş katının 3B modeli; ışıklar, LED şeritler, perdeler ve Cosa termostat kartı.
- **Ayarlar:** Aksesuar ekleme ve plan üzerinde yerleştirme, senaryolar, bağlantı alanları.
- **Cihazlar:** SONOFF iHost (Zigbee) ve Meross; termostat Homebridge üzerinden.

## Dosyalar

| Dosya | Açıklama |
|---|---|
| `index.html` | Panelin tamamı (tek dosya, Three.js CDN'den yüklenir) |
| `data/aksesuarlar.json` | Mevcut aksesuarların yedeği (oda, tür, plan koordinatları) |

## Durum

- Panel şu an claude.ai artifact'i olarak çalışıyor; kayıtlar orada tutuluyor.
- Sıradaki adım: iHost üzerinde Docker paketi olarak çalışacak köprü servisi (iHost Open API + Meross) ve kayıtların SD karta taşınması.
- Hava durumu (Open-Meteo, Pendik) panel ev ağında çalışınca kendi kodundan gelecek.
