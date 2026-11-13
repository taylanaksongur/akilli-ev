#!/bin/sh
# iHost Docker'da tek konteyner: köprü + Cloudflare hızlı tüneli. İmaj: arm32v7/node:20-alpine
# Komut: sh -c "wget -qO /b.sh https://raw.githubusercontent.com/taylanaksongur/akilli-ev/main/ihost-koprusu/baslat.sh && sh /b.sh"
DEPO=https://raw.githubusercontent.com/taylanaksongur/akilli-ev/main/ihost-koprusu
case "$(uname -m)" in
  aarch64|arm64) MIM=arm64 ;;
  armv7*|armv6*|arm) MIM=arm ;;
  x86_64) MIM=amd64 ;;
  *) MIM=arm ;;
esac
echo "Mimari: $(uname -m) -> cloudflared-linux-$MIM"
wget -qO /k.js "$DEPO/kopru.js?t=$(date +%s)" || { echo "kopru.js indirilemedi"; exit 1; }
[ -x /cf ] || { wget -qO /cf "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$MIM" && chmod +x /cf; } || { echo "cloudflared indirilemedi"; exit 1; }

PORT=${PORT:-8787}
if [ -n "$TUNEL_TOKEN" ]; then
  /cf tunnel --no-autoupdate run --token "$TUNEL_TOKEN" &
else
  # Hızlı tünel: adres kayıtlarda "trycloudflare.com" satırında görünür
  /cf tunnel --no-autoupdate --url "http://localhost:$PORT" > /tmp/cf.log 2>&1 &
  ( sleep 15; grep -Eo "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/cf.log | tail -1 ) &
fi
# Meross bulut bağlantısı için mqtt paketi (bir kez, /data'ya)
mkdir -p /data && cd /data && { [ -d node_modules/mqtt ] || npm i --no-audit --no-fund --silent mqtt@5 >/dev/null 2>&1 || echo "mqtt kurulamadı"; }
# LG webOS TV kontrolü için lgtv2 (bir kez, /data'ya)
{ [ -d node_modules/lgtv2 ] || npm i --no-audit --no-fund --silent lgtv2 >/dev/null 2>&1 || echo "lgtv2 kurulamadı"; }
cd /
export NODE_PATH=/data/node_modules
exec node /k.js
