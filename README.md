# Vetva `data` (generuje sa automaticky)

Túto vetvu každú noc prepisuje GitHub Actions workflow „Denná aktualizácia CRZ“. Nič tu ručne neupravuj.

- `api/` – statické JSON súbory, ktoré číta mapa (cez Cloudflare Worker)
- `state/` – uložený stav medzi behmi (zmluvy v okne, denné súčty, zmeny z posledného behu)

Zdroj: Centrálny register zmlúv, Úrad vlády SR (CC BY 4.0); PSČ: GeoNames (CC BY 4.0).
