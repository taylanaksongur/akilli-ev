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

### 2. iHost'ta Docker
eWeLink CUBE arayüzü (`http://ihost.local`) → **Eklentiler / Docker** → aç. İki konteyner ekle:

**aksi-kopru**
- İmaj: `node:20-alpine`
- Ağ: `host`
- Ortam: `CUBE_ADRES=http://<iHost-IP>`
- Birim: `/data` (eşleşme belirteci burada kalır)
- Komut:
  ```
  sh -c "wget -qO /k.js https://raw.githubusercontent.com/taylanaksongur/akilli-ev/main/ihost-koprusu/kopru.js && node /k.js"
  ```
  (Her yeniden başlatmada köprünün son sürümünü alır.)
- Yeniden başlatma: her zaman

**aksi-tunel**
- İmaj: `cloudflare/cloudflared:latest`
- Ağ: `host`
- Komut: `tunnel --no-autoupdate run --token <TOKEN>`
- Yeniden başlatma: her zaman

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
