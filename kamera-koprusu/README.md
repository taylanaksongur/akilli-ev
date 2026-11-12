# Imou kamera köprüsü

Tekne paneli ve ev paneli aynı Cloudflare Worker'ı kullanır: `https://imou-kamera.aksongur.workers.dev`. Imou anahtarları yalnızca burada durur; paneller sadece köprü şifresini bilir.

| Adres | Ne verir |
|---|---|
| `GET /cams` | Imou hesabındaki kameralar: `{cams:[{key, name, model, online}]}` (`key` = `seriNo:kanal`) |
| `GET /live?cam=<key>` | Canlı yayın: `{sd, hd}` HLS adresleri. Tekne panelinin kısa adları da çalışır: `on` (tekne_ön), `arka` (tekne_arka) |

Her istek `X-Key: <şifre>` başlığı ister.

## Güncelleme (mevcut köprüye ev desteği)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → `imou-kamera` → **Edit code**.
2. Eski kodu sil, bu klasördeki `worker.js`'yi yapıştır, **Deploy**. Değişkenlere dokunma.
3. Değişken adları kodda esnek: köprüde zaten tanımlı olan AppId / AppSecret / şifre adları büyük ihtimalle tanınır (liste `worker.js`'nin başında). Güncellemeden sonra tekne panelinde kamera açılmıyorsa **Settings → Variables and Secrets**'taki adları kontrol et; gerekirse `IMOU_APP_ID`, `IMOU_APP_SECRET`, `PANEL_KEY` adlarıyla ekle.

## Hata mesajları

- `unauthorized`: paneldeki şifre köprüdeki şifreyle aynı değil.
- `Imou accessToken: ...`: AppId / AppSecret yanlış ya da bölge (`IMOU_BASE`) farklı.
- `“x” adında kamera bulunamadı`: istenen kısa ad hesapta yok.
