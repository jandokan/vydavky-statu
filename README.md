# Výdavky štátu – mapa zmlúv z CRZ

Interaktívna mapa zmlúv z [Centrálneho registra zmlúv](https://www.crz.gov.sk/): kto platí, kto dostáva, koľko a kde.
Dáta sa každú noc automaticky sťahujú z oficiálneho denného exportu CRZ.

**Živá verzia:** https://vydavky-statu.janko-koterba.workers.dev

## Ako to funguje (Free verzia, 0 €)

```
crz.gov.sk/export/RRRR-MM-DD.zip  (každú noc ~02:00, CC BY 4.0)
        │
        ▼  GitHub Actions, každý deň 04:30  (.github/workflows/update.yml)
scripts/update.mjs  → stiahne nové dni, rozparsuje XML, geokóduje podľa PSČ (GeoNames),
        │              vygeneruje JSON súbory
        ▼  force-push
vetva "data"  (api/*.json + state/)
        │
        ▼  wrangler deploy (v tom istom workflow)
Cloudflare: statické súbory (public/ + api/) – zadarmo, bez limitu požiadaviek
            + Worker (worker/index.js) len pre /api/search, /api/zmluva/*, /api/plan
```

- **Zmena vzhľadu/funkcií mapy** = úprava `public/index.html` a push do `main` → workflow „Nasadenie na Cloudflare“ ju nasadí s aktuálnymi dátami (cca 1 minúta).
- **Ručné spustenie** sťahovania: GitHub → Actions → „Denná aktualizácia CRZ“ → Run workflow.
- **Záloha:** kým nie je nastavený secret `CLOUDFLARE_API_TOKEN`, Worker číta stránku aj dáta priamo z GitHubu (limit 100 000 požiadaviek denne).

### Jednorazové nastavenie nasadenia
1. Cloudflare → My Profile → API Tokens → Create Token → šablóna **Edit Cloudflare Workers** → pridať riadok *Account · D1 · Edit* → účet *Janko.koterba* → Create.
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret: `CLOUDFLARE_API_TOKEN` = token.
3. Actions → „Nasadenie na Cloudflare“ → Run workflow.

### Limity Free verzie
| Čo | Limit | Prečo |
|---|---|---|
| Detail zmlúv | posledných 60 dní (`WINDOW_DAYS`) | statické súbory v Gite musia byť malé |
| Zmlúv na jedno miesto | 1 500 najväčších (`PLACE_CAP`) | veľkosť súboru pre mobil |
| Denné súčty (graf) | rastú natrvalo | ukladajú sa v `state/daily.json` |
| Vyhľadávanie | len medzi najväčšími subjektmi v okne | bez databázy |
| Návštevnosť | bez limitu | statické súbory sú na Cloudflare zadarmo a neobmedzené |
| Počet súborov | 20 000 (Free), 100 000 (Paid) | teraz cca 3 500 |

## Dáta

Každá zmluva obsahuje všetky polia z exportu CRZ: číslo, obe zmluvné strany (názov, IČO, sídlo), predmet, popisy, poznámky,
dátumy (podpis, účinnosť, platnosť, zverejnenie, zmena), sumu zmluvy aj sumu s dodatkami, stav, typ, druh, spôsob zverejnenia,
rezort, referenciu, odkaz na verejné obstarávanie, potvrdenie a všetky prílohy (odkaz na PDF v CRZ).

Polia exportu (`zmluvy/zmluva/...`): `nazov, ID, zs1, zs2, predmet, datum_ucinnost, datum_platnost_do, suma_zmluva, suma_spolu, id,
poznamka, rezort, datum_zverejnene, ico, stav, potv_ziadost, potv_datum, zdroj, text_ucinnost, sidlo, ico1, sidlo1, potvrdenie, typ,
datum, popis, druh, ref, internapozn, popis_predmetu, poznamka_zmena, uvo, crzid, changelog, chan, prilohy/priloha/{ID, nazov,
dokument, velkost, dokument1, velkost1, chan}`. Strana 1 (`zs1`) má `ico1`/`sidlo1`, strana 2 (`zs2`) má `ico`/`sidlo`.

Stav: 1 rozpracovaná, 2 zverejnená, 3 doplnená, 4 zrušená, 5 stiahnutá. Zrušené a stiahnuté sa do súm nerátajú.

**Pozor pri interpretácii:** suma je zmluvná cena, nie vyplatené peniaze. Miesto = sídlo strany, nie miesto plnenia.

## Prechod na platenú verziu (Workers Paid, 5 $/mes.) – keď budeš chcieť

Kód je pripravený, stačí zapnúť:

1. Cloudflare → Workers & Pages → **Plans** → Workers Paid.
2. Vytvor D1 databázu `vydavky-statu` (dashboard → D1 → Create) a spusti v jej konzole obsah `upgrade/schema.sql`.
3. (Väzba `DB` sa nastaví cez `wrangler.jsonc`, krok 4.) Worker tým sám zapne `/api/search` a `/api/zmluva/:id`.
4. V `wrangler.jsonc` odkomentuj `d1_databases` a doplň ID databázy (inak by ďalšie nasadenie väzbu DB zmazalo).
5. GitHub repo → Settings → Secrets and variables → Actions → Variables:
   `D1_DATABASE` = `vydavky-statu`, `HISTORY_FROM` = `2011-01-01`, voliteľne `WINDOW_DAYS` = `180`
   (token `CLOUDFLARE_API_TOKEN` už máš z nastavenia nasadenia, s oprávnením D1 Edit)
6. Hotovo. Každý beh potom importuje zmeny do D1 a po 100 dňoch dosťahuje celú históriu od 2011 (približne 60 behov, dá sa spúšťať aj ručne).

D1 na platenej verzii unesie 10 GB, čo stačí na celú históriu CRZ (cca 6 miliónov zmlúv).
Aj na Free verzii sa dá D1 vyskúšať (500 MB, cca 1 rok zmlúv), kroky 2–5 sú rovnaké.

## Lokálny test

```bash
DATA_DIR=/tmp/td FIXTURE=test/fixture.xml GEONAMES_FILE=test/SK.txt node scripts/update.mjs
```

## Licencie

Kód: MIT. Dáta: Centrálny register zmlúv, Úrad vlády SR – CC BY 4.0. PSČ a súradnice: GeoNames – CC BY 4.0.
Mapa: © OpenFreeMap, © prispievatelia OpenStreetMap.
