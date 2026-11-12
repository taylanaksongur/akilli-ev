# iHost köprüsü

Ev panelinin (HTTPS) evdeki iHost'u yönetmesi için iHost'ta çalışan küçük servis. Cloudflare tüneli bunu güvenli bir adrese açar; her istek Aksi hesabıyla denetlenir.

```
Panel (iPhone/iPad) ──HTTPS──▶ Cloudflare tüneli ──▶ köprü (iHost Docker) ──▶ CUBE Open API
```

## Kurulum

### 1. Cloudflare tüneli
Cloudflare panel → **Zero Trust → Networks → Tunnels → Create tunnel** (Cloudflared) → ad: `aksi-ihost`.
- Çıkan **token**'ı kopyala (kimseyle paylaşma, depoya yazma).
- **Public hostname:** ör. `ihost.<alan-adın>` → Service: `HTTP` → `<iHost-IP>:8787`.
  Alan adın yoksa tünel yerine geçici olarak Quick Tunnel kullanılabilir (adres her açılışta değişir).

### 2. iHost'ta Docker (tek konteyner)
eWeLink CUBE arayüzü (`http://ihost.local`) → **Docker** → yeni konteyner:

- **Ad:** `aksi-kopru`
- **İmaj:** `arm32v7/node:20-alpine` (iHost 32-bit ARM; Docker → Image → Download)
- **Ağ:** `host`
- **Ortam:** `CUBE_ADRES=http://<iHost-IP>` (alan adı ve token'lı tünel varsa ayrıca `TUNEL_TOKEN=<token>`)
- **Birim:** `/data`
- **Komut:**
  ```
  sh -c "wget -qO /b.sh https://raw.githubusercontent.com/taylanaksongur/akilli-ev/main/ihost-koprusu/baslat.sh && sh /b.sh"
  ```
- **Yeniden başlatma:** her zaman

Konteyner köprüyü ve Cloudflare tünelini birlikte başlatır (iHost 32-bit ARM olduğu için resmi `cloudflared` imajı çalışmaz; doğru sürüm otomatik indirilir). `TUNEL_TOKEN` yoksa hızlı tünel açılır: adres kayıtlarda `https://….trycloudflare.com` olarak görünür, iHost yeniden başlayınca değişir.

### 3. Eşleştirme (bir kez)
1. Ev paneli → Ayarlar → **SONOFF iHost bağlantısı** → köprü adresini yaz (`https://ihost.<alan-adın>`).
2. iHost'un üstündeki düğmeye bas, 5 dakika içinde panelde **Eşleştir**'e dokun.
3. **Bağlantıyı dene** → cihaz listesi gelir. Aksesuar düzenlerken listeden cihaz seçilir.

## Uçlar
| Yöntem | Yol | |
|---|---|---|
| GET | `/saglik` | açık mı, eşleşti mi |
| POST | `/eslestir` | yalnız yönetici; CUBE belirteci alır |
| GET | `/cihazlar` | `{cihazlar:[{id, ad, tur, cevrimici, acik, parlaklik, dimmer}]}` |
| POST | `/cihaz/<id>` | `{acik, parlaklik}` |

Aile üyesinin `ev` yetkisi yoksa köprü 403 döner.
