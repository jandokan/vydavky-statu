#!/usr/bin/env bash
# Poskladá priečinok site/ pre Cloudflare statické súbory: stránka (public/) + dáta (data/api)
# + knižnica mapy a písmo hostované u nás (návštevníci tak neposielajú IP adresu na unpkg ani Google).
# Kontaktný e-mail sa doplní z premennej prostredia CONTACT_EMAIL (GitHub → Settings → Variables).
set -euo pipefail
DATA_DIR="${DATA_DIR:-data}"
MAPLIBRE="4.7.1"
rm -rf site && mkdir -p site/vendor/fonts
cp -r public/. site/
if [ -d "$DATA_DIR/api" ]; then cp -r "$DATA_DIR/api" site/api; else echo "Upozornenie: $DATA_DIR/api neexistuje"; fi

# kontaktný e-mail (ak nie je nastavený, stránka kontakt skryje)
for f in site/*.html; do sed -i "s#__CONTACT_EMAIL__#${CONTACT_EMAIL:-}#g" "$f"; done
[ -n "${CONTACT_EMAIL:-}" ] || echo "::warning::Nie je nastavená premenná CONTACT_EMAIL – kontakt na stránke bude skrytý."

# knižnica mapy (MapLibre GL, BSD licencia)
curl -fsSL "https://unpkg.com/maplibre-gl@${MAPLIBRE}/dist/maplibre-gl.js" -o site/vendor/maplibre-gl.js
curl -fsSL "https://unpkg.com/maplibre-gl@${MAPLIBRE}/dist/maplibre-gl.css" -o site/vendor/maplibre-gl.css
curl -fsSL "https://unpkg.com/maplibre-gl@${MAPLIBRE}/LICENSE.txt" -o site/vendor/maplibre-LICENSE.txt || true

# písmo Bricolage Grotesque (SIL Open Font License) – stiahneme woff2 a prepíšeme odkazy na lokálne
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
curl -fsSL -A "$UA" "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&display=swap" -o /tmp/fonts.css
cp /tmp/fonts.css site/vendor/fonts.css
i=0
for url in $(grep -o 'https://fonts.gstatic.com/[^)]*' /tmp/fonts.css | sort -u); do
  i=$((i+1)); f="bricolage-$i.woff2"
  curl -fsSL "$url" -o "site/vendor/fonts/$f"
  sed -i "s#${url}#/vendor/fonts/${f}#g" site/vendor/fonts.css
done
[ "$i" -gt 0 ] || { echo "Písmo sa nepodarilo stiahnuť"; exit 1; }
if grep -q 'fonts.gstatic.com' site/vendor/fonts.css; then echo "V fonts.css ostali externé odkazy"; exit 1; fi

echo "site/: $(find site -type f | wc -l) súborov, $(du -sh site | cut -f1); písmo: $i súborov"
