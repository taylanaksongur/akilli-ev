# Imou kamera köprüsü (ev)

Panel, Imou kameralarını bu küçük Cloudflare Worker üzerinden görür. Imou anahtarları yalnızca burada durur; panel sadece kendi şifresini (`PANEL_KEY`) bilir.

| Adres | Ne verir |
|---|---|
| `GET /cams` | Imou hesabındaki kameralar: `{cams:[{key, name, model, online}]}` (`key` = `seriNo:kanal`) |
| `GET /live?cam=<key>` | Canlı yayın: `{sd, hd}` HLS adresleri |

Her istek `X-Key: <PANEL_KEY>` başlığı ister.

## Kurulum

1. **Imou anahtarları:** [open.imoulife.com](https://open.imoulife.com) adresine kameraların bağlı olduğu Imou Life hesabıyla gir. Konsolda bir uygulama oluştur (tekne köprüsü için oluşturduysan aynısı olur) ve **AppId** ile **AppSecret**'i al.
2. **Worker:** [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker** → adı `imou-ev` → **Deploy**. Sonra **Edit code**, içindekini sil, bu klasördeki `worker.js`'yi yapıştır, **Deploy**.
3. **Değişkenler:** Worker → **Settings** → **Variables and Secrets** → **Add**:
   - `IMOU_APP_ID` (Text): AppId
   - `IMOU_APP_SECRET` (Secret): AppSecret
   - `PANEL_KEY` (Secret): panelde kullanacağın şifre (kendin belirle)
   - `IMOU_BASE` (Text, isteğe bağlı): hesap Avrupa dışındaysa bölge adresi. Varsayılan `https://openapi-fk.easy4ip.com` (Orta Avrupa). Doğu Asya: `https://openapi-sg.easy4ip.com`, ABD batı: `https://openapi-or.easy4ip.com`.
4. **Panel:** Ayarlar → **Kameralar (Imou)** → Köprü adresi `https://imou-ev.aksongur.workers.dev`, Kamera şifresi = `PANEL_KEY` → **Kameraları kaydet**. Kameralar listede çıkar; her kamera aksesuarında **Kamera (Imou)** listesinden seç.

## Hata mesajları

- `unauthorized`: paneldeki şifre `PANEL_KEY` ile aynı değil.
- `Imou accessToken: ...`: AppId / AppSecret yanlış ya da bölge (`IMOU_BASE`) farklı.
- `LV1001`: yayın zaten açık; köprü bunu kendisi çözer.
