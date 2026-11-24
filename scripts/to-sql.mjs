// Prevedie zmeny z posledného behu (state/changes.ndjson.gz) na SQL pre D1.
//   node scripts/to-sql.mjs [DATA_DIR] [OUT_DIR]
// Výstup: OUT_DIR/part-0001.sql … (INSERT OR REPLACE, 4000 riadkov na súbor)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DATA = path.resolve(process.argv[2] || 'data');
const OUT = path.resolve(process.argv[3] || 'sql');
const COLS = ['id', 'cislo', 'objednavatel', 'objednavatel_ico', 'objednavatel_adresa', 'dodavatel', 'dodavatel_ico', 'dodavatel_adresa',
  'predmet', 'popis', 'popis_predmetu', 'poznamka', 'poznamka_zmena', 'interna_poznamka', 'text_ucinnost', 'datum_podpisu', 'datum_ucinnosti',
  'platnost_do', 'zverejnene', 'zmenene', 'suma', 'suma_spolu', 'stav', 'typ', 'druh', 'zdroj', 'rezort', 'interne_id', 'referencia',
  'obstaravanie', 'potvrdenie', 'potvrdenie_datum', 'zmeny', 'prilohy', 'miesto_o', 'miesto_d'];

const lit = (v) => v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/'/g, "''")}'`;
const src = path.join(DATA, 'state', 'changes.ndjson.gz');
if (!fs.existsSync(src)) { console.log('Žiadne zmeny'); process.exit(0); }
const lines = zlib.gunzipSync(fs.readFileSync(src)).toString('utf8').split('\n').filter(Boolean);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let part = 0;
for (let i = 0; i < lines.length; i += 4000) {
  const sql = lines.slice(i, i + 4000).map((l) => { const r = JSON.parse(l); return `INSERT OR REPLACE INTO zmluvy (${COLS.join(',')}) VALUES (${COLS.map((c) => lit(r[c])).join(',')});`; }).join('\n');
  fs.writeFileSync(path.join(OUT, `part-${String(++part).padStart(4, '0')}.sql`), sql);
}
console.log(`${lines.length} zmlúv → ${part} SQL súborov v ${OUT}`);
