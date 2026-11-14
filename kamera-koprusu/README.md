# Imou kamera köprüsü

Tekne paneli ve ev paneli aynı Cloudflare Worker'ı kullanır: `https://imou-kamera.aksongur.workers.dev`. Imou anahtarları yalnızca orada durur.

| Adres | Ne verir |
|---|---|
| `GET /cams` | Şifrenin açtığı kameralar: `{cams:[{id, name, online}]}` |
| `GET /live?cam=<id>` | Canlı yayın: `{hd, sd}` HLS adresleri |

Her istek `Authorization: Bearer <Aksi oturum belirteci>` ister; belirteç `HESAP` servis bağlantısıyla hesap servisinde doğrulanır (yanıt 60 sn önbellekte). Kamera, bağlı olduğu alanın (`alan: ev | tekne`) iznine göre açılır: ev izni ev kameralarını, tekne izni tekne kameralarını, yönetici hepsini görür. Oturum yok: 401, alan izni yok: 403, hesap servisi kapalı: 503. CORS yalnızca `https://taylanaksongur.github.io`.

Gizliler: `IMOU_APPID`, `IMOU_SECRET`. (Eski `BOAT_KEY` / `HOME_KEY` şifreleri artık kullanılmıyor.)

## Yeni kamera eklemek

`worker.js`'deki `KAMERALAR` listesine `ad: { dev: 'SERİ_NO', name: 'Görünen ad', alan: 'ev' }` satırı ekle (ve hesap servisindeki `KAMERA_ALAN`'a da aynı kamerayı yaz). GitHub'a gönderilince `.github/workflows/kamera-koprusu.yml` köprüyü Cloudflare'e yükler (depo ayarlarında `CLOUDFLARE_API_TOKEN` ve `CLOUDFLARE_ACCOUNT_ID` gizlileri gerekir). Cloudflare'deki gizliler korunur.
