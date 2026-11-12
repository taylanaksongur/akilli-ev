# Imou kamera köprüsü

Tekne paneli ve ev paneli aynı Cloudflare Worker'ı kullanır: `https://imou-kamera.aksongur.workers.dev`. Imou anahtarları yalnızca orada durur.

| Adres | Ne verir |
|---|---|
| `GET /cams` | Şifrenin açtığı kameralar: `{cams:[{id, name, online}]}` |
| `GET /live?cam=<id>` | Canlı yayın: `{hd, sd}` HLS adresleri |

Her istek `X-Key: <şifre>` başlığı ister.

| Şifre (Cloudflare gizlisi) | Açtığı kameralar |
|---|---|
| `BOAT_KEY` | Tekne (`on`, `arka`) ve ev (`yemek`, `oturma`, `bahce`, `cocuk`) |
| `HOME_KEY` | Yalnızca ev kameraları |

Diğer gizliler: `IMOU_APPID`, `IMOU_SECRET`.

## Yeni kamera eklemek

`worker.js`'deki `GROUPS` listesine `ad: { dev: 'SERİ_NO', name: 'Görünen ad' }` satırı ekle. GitHub'a gönderilince `.github/workflows/kamera-koprusu.yml` köprüyü Cloudflare'e yükler (depo ayarlarında `CLOUDFLARE_API_TOKEN` ve `CLOUDFLARE_ACCOUNT_ID` gizlileri gerekir). Cloudflare'deki gizliler korunur.
