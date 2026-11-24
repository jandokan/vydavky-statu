#!/usr/bin/env bash
# Poskladá priečinok site/ pre Cloudflare statické súbory: stránka (public/) + dáta (data/api).
set -euo pipefail
DATA_DIR="${DATA_DIR:-data}"
rm -rf site && mkdir -p site
cp -r public/. site/
if [ -d "$DATA_DIR/api" ]; then cp -r "$DATA_DIR/api" site/api; else echo "Upozornenie: $DATA_DIR/api neexistuje"; fi
echo "site/: $(find site -type f | wc -l) súborov, $(du -sh site | cut -f1)"
