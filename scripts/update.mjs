// Denná aktualizácia: stiahne nové exporty CRZ, zlúči ich so stavom, geokóduje
// a vygeneruje statické JSON súbory pre mapu do DATA_DIR/api.
//
//   node scripts/update.mjs
// Premenné prostredia:
//   DATA_DIR      priečinok s dátami (vetva "data"), predvolene ./data
//   WINDOW_DAYS   koľko dní dozadu držať detail zmlúv (Free verzia), predvolene 365
//   PLACE_CAP     max. zmlúv na jedno miesto a rolu v detailnom súbore, predvolene 1500
//   MAX_DAYS      max. počet dní stiahnutých v jednom behu, predvolene 400
//   FIXTURE       lokálny XML súbor namiesto sťahovania (test)
//   GEONAMES_FILE lokálny SK.txt namiesto sťahovania (test)
//   HISTORY_FROM  (platená verzia s D1) dátum, od ktorého sa po častiach dosťahuje celá história
//   HISTORY_DAYS  koľko starších dní dosťahovať v jednom behu, predvolene 100

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { unzip } from './zip.mjs';
import { parseExport, amount, isActive, counted, excludeReason, isSuspicious, isAmendment, MAX_AMOUNT } from './parse.mjs';
import { loadGeoNames, makeGeocoder, norm } from './geo.mjs';
import { anonymize, publisherSet, isPublic } from './parties.mjs';

const DATA = path.resolve(process.env.DATA_DIR || 'data');
const WINDOW = +(process.env.WINDOW_DAYS || 365);
const CAP = +(process.env.PLACE_CAP || 1500);
const MAX_DAYS = +(process.env.MAX_DAYS || 400);
const UA = 'vydavky-statu (open-data mapa CRZ; github.com/jandokan/vydavky-statu)';
const STATE = path.join(DATA, 'state');
const API = path.join(DATA, 'api');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return day(d); };
const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); };

async function get(url, tries = 2) {
  for (let i = 1; i <= tries; i++) {
    let status = 0;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      status = r.status;
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries) throw new Error(`${url}: ${e.message}`);
      // 403/429 = dočasný blok CRZ proti robotom → čakáme dlhšie
      const wait = status === 403 || status === 429 ? 60000 : 5000 * i;
      console.log(`  ${e.message}, čakám ${wait / 1000} s…`);
      await sleep(wait);
    }
  }
}

// ---------- stav ----------
fs.mkdirSync(STATE, { recursive: true });
// zmluvy sú uložené po mesiacoch (state/records/RRRR-MM.ndjson.gz), aby žiadny súbor neprekročil limit GitHubu 100 MB
const REC_DIR = path.join(STATE, 'records');
const legacyRec = path.join(STATE, 'records.ndjson.gz');
const records = new Map();
const recFiles = [legacyRec, ...(fs.existsSync(REC_DIR) ? fs.readdirSync(REC_DIR).map((f) => path.join(REC_DIR, f)) : [])];
for (const f of recFiles) {
  if (!fs.existsSync(f) || !f.endsWith('.ndjson.gz')) continue;
  for (const line of zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n')) if (line) { const r = anonymize(JSON.parse(line)); records.set(r.id, r); }
}
// trvalé mesačné súhrny; pri zmene pravidiel výpočtu (CALC_VERSION) sa prepočítajú odznova
const CALC_VERSION = 4; // 3 = duplicity, 4 = súčty aj pre súkromný sektor, anonymizácia osôb
let monthly = readJson(path.join(STATE, 'monthly.json'), {});
if (monthly._v !== CALC_VERSION) { console.log('Nové pravidlá výpočtu → mesačné súhrny sa prepočítajú'); monthly = {}; }
delete monthly._v;
const state = readJson(path.join(STATE, 'state.json'), { days: {} });
const daily = readJson(path.join(STATE, 'daily.json'), {});
console.log(`Stav: ${records.size} zmlúv, ${Object.keys(state.days).length} spracovaných dní`);

// ---------- sťahovanie ----------
const today = day(new Date());
const yesterday = addDays(today, -1);
const windowStart = addDays(today, -WINDOW);
let newCount = 0;
const changed = new Map(); // všetko, čo prišlo v tomto behu (pre import do D1)

function merge(list) {
  for (let r of list) {
    r = anonymize(r); // mená a adresy fyzických osôb sa neukladajú nikde
    const old = records.get(r.id); if (!old || (r.zmenene || '') >= (old.zmenene || '')) records.set(r.id, r);
    const oc = changed.get(r.id); if (!oc || (r.zmenene || '') >= (oc.zmenene || '')) changed.set(r.id, r);
    newCount++;
  }
}

let blocked = false, failRow = 0; // 3 zlyhané dni po sebe = blok CRZ, zvyšok v ďalšom behu
async function fetchDay(d) {
  if (blocked) return undefined;
  let zip;
  try { zip = await get(`http://www.crz.gov.sk/export/${d}.zip`); failRow = 0; }
  catch (e) {
    console.log(`  ${d} preskočený: ${e.message}`);
    if (++failRow >= 3) { console.log('STOP: CRZ blokuje sťahovanie, zvyšok v ďalšom behu'); blocked = true; }
    return { failed: (state.days[d]?.failed || 0) + 1 };
  }
  if (!zip) { console.log(d, 'chýba'); await sleep(2500); return null; }
  let n = 0;
  for (const [name, buf] of Object.entries(unzip(zip))) if (name.endsWith('.xml')) { const list = parseExport(buf.toString('utf8')); merge(list); n += list.length; }
  console.log(d, n, 'zmien');
  await sleep(4000); // CRZ odporúča max. 1 požiadavku / 2 s, ideme pomalšie
  return { n, bytes: zip.length };
}

if (process.env.FIXTURE) {
  const list = parseExport(fs.readFileSync(process.env.FIXTURE, 'utf8'));
  merge(list);
  state.days['fixture'] = { n: list.length };
  console.log(`FIXTURE: ${list.length} zmlúv`);
} else {
  const todo = [];
  const retry = [];
  for (let d = windowStart; d <= yesterday; d = addDays(d, 1)) {
    const st = state.days[d];
    if (!st || (st.missing && d >= addDays(today, -7))) todo.push(d);
    else if (st.failed && st.failed < 6) retry.push(d); // dni, ktoré CRZ odmietol, skúšame znova až na konci
  }
  todo.push(...retry);
  if (todo.length > MAX_DAYS) todo.splice(0, todo.length - MAX_DAYS);
  console.log(`Na stiahnutie: ${todo.length} dní`);
  for (const d of todo) { const res = await fetchDay(d); if (res === undefined) break; state.days[d] = res || { missing: true }; }

  // celá história (len pre platenú verziu s D1 – staršie dni idú iba do databázy)
  if (process.env.HISTORY_FROM) {
    let d = state.historyNext || process.env.HISTORY_FROM, k = 0;
    const lim = +(process.env.HISTORY_DAYS || 100);
    while (!blocked && d < windowStart && k < lim) { if ((await fetchDay(d)) === undefined) break; d = addDays(d, 1); k++; }
    state.historyNext = d;
    console.log(`História: hotovo po ${d}${d >= windowStart ? ' (kompletná)' : ''}`);
  }
}

// ---------- okno: držíme zmluvy zverejnené za posledných WINDOW dní ----------
for (const [id, r] of records) if (!r.zverejnene || r.zverejnene.slice(0, 10) < windowStart) records.delete(id);
for (const d of Object.keys(state.days)) if (d !== 'fixture' && d < addDays(windowStart, -5)) delete state.days[d];

// ---------- geokódovanie ----------
const gtxt = process.env.GEONAMES_FILE
  ? fs.readFileSync(process.env.GEONAMES_FILE, 'utf8')
  : unzip(await get('https://download.geonames.org/export/zip/SK.zip'))['SK.txt'].toString('utf8');
const geo = loadGeoNames(gtxt);
const geocode = makeGeocoder(geo);
const placeByKey = new Map(geo.places.map((p) => [p.key, p]));
console.log(`GeoNames: ${geo.places.length} miest`);
for (const r of changed.values()) { r.miesto_o = geocode(r.objednavatel_adresa)?.key || null; r.miesto_d = geocode(r.dodavatel_adresa)?.key || null; }

// ---------- duplicity ----------
// Keď sú obe strany verejné inštitúcie, zmluvu zverejní každá zvlášť (často s prehodenými stranami).
// Rovnaké číslo zmluvy + rovnaká suma + rovnaké dve IČO = tá istá zmluva → rátame len prvú zverejnenú.
{
  const nc = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const groups = new Map();
  for (const r of records.values()) {
    delete r._dup;
    if (!isActive(r) || isSuspicious(r) || isAmendment(r)) continue;
    const a = Math.round(amount(r)), c = nc(r.cislo);
    if (!a || !c || !r.objednavatel_ico || !r.dodavatel_ico) continue;
    const k = `${c}|${a}|${[r.objednavatel_ico, r.dodavatel_ico].sort().join('-')}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  for (const g of groups.values()) if (g.length > 1) {
    g.sort((x, y) => (x.zverejnene || '').localeCompare(y.zverejnene || '') || x.id - y.id);
    for (const r of g.slice(1)) r._dup = true;
  }
}

// ---------- verejný vs. súkromný sektor ----------
// Zmluva „medzi verejnými inštitúciami“ = obe strany sú verejné (ministerstvo, obec, štátna firma, škola…).
// Filter „Len súkromný sektor“ takéto zmluvy vynechá.
const pubSet = publisherSet(records.values());
for (const r of records.values()) r.verejna = isPublic(r.objednavatel, r.objednavatel_ico, pubSet) && isPublic(r.dodavatel, r.dodavatel_ico, pubSet) ? 1 : 0;
const SFX = ['', '_p']; // '' = všetky zmluvy, '_p' = len so súkromným sektorom
const inV = (r, sfx) => sfx === '' || !r.verejna;
const isAnon = (name) => name === 'Fyzická osoba' || name === 'Neuvedené';

// ---------- výstupy ----------
fs.rmSync(API, { recursive: true, force: true });
fs.mkdirSync(path.join(API, 'p'), { recursive: true });

const FIELDS = ['id', 'cislo', 'objednavatel', 'objednavatel_ico', 'objednavatel_adresa', 'dodavatel', 'dodavatel_ico', 'dodavatel_adresa',
  'predmet', 'popis', 'popis_predmetu', 'poznamka', 'poznamka_zmena', 'interna_poznamka', 'text_ucinnost', 'datum_podpisu', 'datum_ucinnosti',
  'platnost_do', 'zverejnene', 'zmenene', 'suma', 'suma_spolu', 'stav', 'typ', 'druh', 'zdroj', 'rezort', 'interne_id', 'referencia',
  'obstaravanie', 'potvrdenie', 'potvrdenie_datum', 'zmeny', 'prilohy', 'miesto_o', 'miesto_d', 'nezapocitane', 'verejna'];
const row = (r) => FIELDS.map((f) => (f === 'prilohy' ? r.prilohy.map((p) => [p.nazov, p.subor, p.velkost]) : r[f] ?? null));

const d7 = addDays(today, -7), d30 = addDays(today, -30);
const periods = [['7', d7], ['30', d30], ['all', windowStart]];
const places = new Map();
const ents = new Map();
const okresy = new Map();
const geoStats = { psc: 0, obec: 0, psc3: 0, none: 0, empty: 0 };
const unmatched = new Map();

function agg(obj, role, r, a) {
  const z = r.zverejnene.slice(0, 10);
  for (const sfx of SFX) if (inV(r, sfx)) for (const [k, from] of periods) if (z >= from) {
    obj[`${role}${k}n${sfx}`] = (obj[`${role}${k}n${sfx}`] || 0) + 1;
    obj[`${role}${k}s${sfx}`] = (obj[`${role}${k}s${sfx}`] || 0) + a;
  }
}

for (const r of records.values()) {
  const a = counted(r);
  r.nezapocitane = excludeReason(r); // prečo sa nezapočítava (null = započítava sa)
  for (const role of ['o', 'd']) {
    const addr = role === 'o' ? r.objednavatel_adresa : r.dodavatel_adresa;
    const g = addr ? geocode(addr) : null;
    if (!addr) geoStats.empty++; else if (!g) { geoStats.none++; unmatched.set(addr, (unmatched.get(addr) || 0) + 1); } else geoStats[g.how]++;
    r['miesto_' + role] = g ? g.key : null;
    if (g) {
      let pl = places.get(g.key);
      if (!pl) places.set(g.key, (pl = { key: g.key, o: [], d: [] }));
      pl[role].push(r);
      agg(pl, role, r, a);
      const ok = placeByKey.get(g.key).okres;
      let o = okresy.get(ok); if (!o) okresy.set(ok, (o = { okres: ok, kraj: placeByKey.get(g.key).kraj }));
      agg(o, role, r, a);
    }
    const name = role === 'o' ? r.objednavatel : r.dodavatel;
    const ico = role === 'o' ? r.objednavatel_ico : r.dodavatel_ico;
    if (name && !isAnon(name)) { // fyzické osoby do rebríčkov nedávame
      const ek = role + ':' + (ico || norm(name));
      let e = ents.get(ek); if (!e) ents.set(ek, (e = { name, ico, role, place: g?.key || null, n: 0, s: 0, n_p: 0, s_p: 0 }));
      e.n++; e.s += a; if (!r.verejna) { e.n_p++; e.s_p += a; } if (!e.place && g) e.place = g.key;
    }
  }
}

const round = (x) => Math.round(x * 100) / 100;

// ---------- trvalé mesačné súhrny ----------
// Mesiac sa prepočítava, kým celý leží v okne; keď z okna začne vypadávať, zmrazí sa a ostane navždy.
{
  const fresh = {};
  for (const r of records.values()) {
    if (excludeReason(r)) continue;
    const m = r.zverejnene.slice(0, 7);
    if (monthly[m] && `${m}-01` < windowStart) continue; // zmrazený mesiac
    // p: miesto → [on, os, dn, ds, on_p, os_p, dn_p, ds_p]; e: subjekt → [meno, ičo, miesto, n, s, n_p, s_p]
    const M = fresh[m] || (fresh[m] = { p: {}, e: {}, n: 0, s: 0, n_p: 0, s_p: 0 });
    const a = counted(r), pv = !r.verejna; M.n++; M.s += a; if (pv) { M.n_p++; M.s_p += a; }
    for (const role of ['o', 'd']) {
      const key = r['miesto_' + role];
      if (key) { const x = M.p[key] || (M.p[key] = [0, 0, 0, 0, 0, 0, 0, 0]); const i = role === 'o' ? 0 : 2; x[i]++; x[i + 1] += a; if (pv) { x[i + 4]++; x[i + 5] += a; } }
      const name = role === 'o' ? r.objednavatel : r.dodavatel, ico = role === 'o' ? r.objednavatel_ico : r.dodavatel_ico;
      if (name && !isAnon(name)) { const ek = role + ':' + (ico || norm(name)); const e = M.e[ek] || (M.e[ek] = [name, ico, key || null, 0, 0, 0, 0]); e[3]++; e[4] += a; if (pv) { e[5]++; e[6] += a; } if (!e[2] && key) e[2] = key; }
    }
  }
  for (const [m, M] of Object.entries(fresh)) {
    for (const x of Object.values(M.p)) for (const i of [1, 3, 5, 7]) x[i] = round(x[i]);
    // na mesiac držíme 4000 najväčších subjektov z každej strany a varianty (súbor nesmie rásť donekonečna)
    const keep = {};
    for (const role of ['o', 'd']) for (const si of [4, 6]) Object.entries(M.e).filter(([k]) => k[0] === role).sort((a, b) => b[1][si] - a[1][si]).slice(0, 4000).forEach(([k, v]) => { keep[k] = v; });
    for (const v of Object.values(keep)) { v[4] = round(v[4]); v[6] = round(v[6]); }
    monthly[m] = { p: M.p, e: keep, n: M.n, s: round(M.s), n_p: M.n_p, s_p: round(M.s_p) };
  }
}
const ever = new Map(); // miesto → 8 čísel od začiatku
const everEnt = new Map();
for (const M of Object.values(monthly)) {
  for (const [k, x] of Object.entries(M.p)) { const t = ever.get(k) || [0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 8; i++) t[i] += x[i] || 0; ever.set(k, t); }
  for (const [k, e] of Object.entries(M.e)) { const t = everEnt.get(k) || [e[0], e[1], e[2], 0, 0, 0, 0]; for (let i = 3; i < 7; i++) t[i] += e[i] || 0; if (!t[2]) t[2] = e[2]; everEnt.set(k, t); }
}
const firstMonth = Object.keys(monthly).sort()[0] || null;

const PCOLS = ['key', 'name', 'okres', 'kraj', 'lat', 'lon'];
const MCOLS = []; for (const sfx of SFX) { for (const role of ['o', 'd']) for (const [k] of periods) MCOLS.push(`${role}${k}n${sfx}`, `${role}${k}s${sfx}`); MCOLS.push(`oevern${sfx}`, `oevers${sfx}`, `devern${sfx}`, `devers${sfx}`); }
for (const [k, t] of ever) {
  if (!placeByKey.has(k)) continue;
  let pl = places.get(k); if (!pl) places.set(k, (pl = { key: k, o: [], d: [], empty: true }));
  const names = ['oevern', 'oevers', 'devern', 'devers', 'oevern_p', 'oevers_p', 'devern_p', 'devers_p'];
  const g = placeByKey.get(k); let o = okresy.get(g.okres); if (!o) okresy.set(g.okres, (o = { okres: g.okres, kraj: g.kraj }));
  names.forEach((c, i) => { pl[c] = t[i]; o[c] = (o[c] || 0) + t[i]; });
}
const placeRows = [];
for (const pl of places.values()) {
  const g = placeByKey.get(pl.key);
  placeRows.push([pl.key, g.name, g.okres, g.kraj, g.lat, g.lon, ...MCOLS.map((c) => round(pl[c] || 0))]);
  const pick = (list) => list.sort((x, y) => amount(y) - amount(x)).slice(0, CAP).map(row);
  writeJson(path.join(API, 'p', pl.key + '.json'), {
    key: pl.key, name: g.name, okres: g.okres, kraj: g.kraj, lat: g.lat, lon: g.lon,
    oTotal: pl.o.length, dTotal: pl.d.length, cap: CAP, fields: FIELDS, o: pick(pl.o), d: pick(pl.d),
  });
}
writeJson(path.join(API, 'places.json'), { cols: [...PCOLS, ...MCOLS], rows: placeRows });
writeJson(path.join(API, 'okresy.json'), { cols: ['okres', 'kraj', ...MCOLS], rows: [...okresy.values()].map((o) => [o.okres, o.kraj, ...MCOLS.map((c) => round(o[c] || 0))]) });

const all = [...records.values()].filter((r) => !excludeReason(r)); // započítané zmluvy
const top = (from, sfx) => all.filter((r) => r.zverejnene.slice(0, 10) >= from && inV(r, sfx)).sort((a, b) => amount(b) - amount(a)).slice(0, 300).map(row);
const topOut = { fields: FIELDS }; for (const sfx of SFX) for (const [k, from] of periods) topOut[k + sfx] = top(from, sfx);
writeJson(path.join(API, 'top.json'), topOut);

// rebríčky: o, d = všetky zmluvy; op, dp = len so súkromným sektorom
const entList = [...ents.values()];
// v rebríčku súkromných dodávateľov nechávame len nie-verejné subjekty (pri prehodených stranách by sa tam inak objavili ministerstvá)
const privOk = (role, name, ico) => role !== 'd' || !isPublic(name, ico, pubSet);
const topEnt = (role, p) => entList.filter((e) => e.role === role && (p ? e.s_p > 0 && privOk(role, e.name, e.ico) : true)).sort((a, b) => (p ? b.s_p - a.s_p : b.s - a.s)).slice(0, p ? 8000 : 15000).map((e) => (p ? [e.name, e.ico, e.place, e.n_p, round(e.s_p)] : [e.name, e.ico, e.place, e.n, round(e.s)]));
writeJson(path.join(API, 'names.json'), { cols: ['name', 'ico', 'place', 'n', 's'], o: topEnt('o'), d: topEnt('d'), op: topEnt('o', 1), dp: topEnt('d', 1) });
const everList = [...everEnt.entries()];
const topEver = (role, p) => everList.filter(([k, e]) => k[0] === role && (p ? e[6] > 0 && privOk(role, e[0], e[1]) : true)).sort((a, b) => (p ? b[1][6] - a[1][6] : b[1][4] - a[1][4])).slice(0, p ? 8000 : 15000).map(([, e]) => (p ? [e[0], e[1], e[2], e[5], round(e[6])] : [e[0], e[1], e[2], e[3], round(e[4])]));
writeJson(path.join(API, 'names-ever.json'), { cols: ['name', 'ico', 'place', 'n', 's'], from: firstMonth, o: topEver('o'), d: topEver('d'), op: topEver('o', 1), dp: topEver('d', 1) });

// denné súčty: dni v okne prepočítame, staršie zostávajú v histórii natrvalo
for (const d of Object.keys(daily)) if (d >= windowStart) delete daily[d];
for (const r of all) { const z = r.zverejnene.slice(0, 10); const o = daily[z] || (daily[z] = { n: 0, s: 0, np: 0, sp: 0 }); o.n++; o.s = round(o.s + counted(r)); if (!r.verejna) { o.np = (o.np || 0) + 1; o.sp = round((o.sp || 0) + counted(r)); } }
// podozrivé sumy – zoznam na kontrolu (nezapočítavajú sa)
const susp = [...records.values()].filter((r) => isActive(r) && isSuspicious(r)).sort((a, b) => amount(b) - amount(a));
writeJson(path.join(API, 'suspicious.json'), { fields: FIELDS, limit: MAX_AMOUNT, rows: susp.slice(0, 200).map(row) });
let exAm = 0, exAmS = 0, exDup = 0, exDupS = 0;
for (const r of records.values()) { const w = excludeReason(r); if (w === 'dodatok') { exAm++; exAmS += amount(r); } else if (w === 'duplicita') { exDup++; exDupS += amount(r); } }
// celkové súčty všetkých započítaných zmlúv (bez ohľadu na to, či sa dajú umiestniť na mapu)
const totals = {};
for (const sfx of SFX) {
  for (const [k, from] of periods) { let n = 0, sm = 0; for (const r of all) if (r.zverejnene.slice(0, 10) >= from && inV(r, sfx)) { n++; sm += counted(r); } totals[k + sfx] = { n, s: round(sm) }; }
  let n = 0, sm = 0; for (const M of Object.values(monthly)) { n += sfx ? M.n_p || 0 : M.n; sm += sfx ? M.s_p || 0 : M.s; } totals['ever' + sfx] = { n, s: round(sm) };
}
const dataStart = Object.keys(daily).sort()[0] || windowStart;
writeJson(path.join(API, 'daily.json'), daily);

let pendingDays = 0;
for (let d = windowStart; d <= yesterday; d = addDays(d, 1)) if (!state.days[d] || state.days[d].failed) pendingDays++;
const failedDays = Object.keys(state.days).filter((d) => state.days[d].failed).sort();
const lastDay = Object.keys(state.days).filter((d) => state.days[d].n != null && d !== 'fixture').sort().pop() || null;
const meta = {
  generated: new Date().toISOString(), lastDay, windowDays: WINDOW, windowStart, placeCap: CAP,
  contracts: records.size, active: all.length, pendingDays, failedDays, totals, rules: { duplicates: exDup, duplicatesSum: round(exDupS), maxAmount: MAX_AMOUNT, suspicious: susp.length, suspiciousSum: round(susp.reduce((a, r) => a + amount(r), 0)), amendments: exAm, amendmentsSum: round(exAmS) }, places: places.size, changesThisRun: newCount, geocoding: geoStats,
  periods: { '7': d7, '30': d30, all: windowStart }, everFrom: dataStart, plan: 'free',
  sources: [
    { name: 'Centrálny register zmlúv, Úrad vlády SR', url: 'https://www.crz.gov.sk/', license: 'CC BY 4.0' },
    { name: 'GeoNames – PSČ Slovenska', url: 'https://www.geonames.org/', license: 'CC BY 4.0' },
  ],
};
writeJson(path.join(API, 'meta.json'), meta);

// ---------- uloženie stavu ----------
fs.rmSync(legacyRec, { force: true });
fs.rmSync(REC_DIR, { recursive: true, force: true }); fs.mkdirSync(REC_DIR, { recursive: true });
const byMonth = {};
for (const r of records.values()) (byMonth[r.zverejnene.slice(0, 7)] ||= []).push(JSON.stringify(r));
for (const [m, lines] of Object.entries(byMonth)) fs.writeFileSync(path.join(REC_DIR, m + '.ndjson.gz'), zlib.gzipSync(lines.join('\n')));
writeJson(path.join(STATE, 'monthly.json'), { ...monthly, _v: CALC_VERSION });
fs.rmSync(path.join(STATE, 'changes.ndjson.gz'), { force: true });
// zmeny pre import do D1 – len keď je zapnutá platená verzia (inak by pri dosťahovaní roka vznikol obrovský súbor)
if (process.env.WRITE_CHANGES) fs.writeFileSync(path.join(STATE, 'changes.ndjson.gz'), zlib.gzipSync([...changed.values()].map((r) => JSON.stringify(r)).join('\n')));
writeJson(path.join(STATE, 'state.json'), state);
writeJson(path.join(STATE, 'daily.json'), daily);
writeJson(path.join(STATE, 'unmatched.json'), [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 500));
console.log(JSON.stringify(meta, null, 1));
