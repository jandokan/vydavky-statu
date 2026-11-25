// Parser denného XML exportu CRZ (crz.gov.sk/export/RRRR-MM-DD.zip).
// Štruktúra: <zmluvy><zmluva>…polia…<prilohy><priloha>…</priloha></prilohy></zmluva></zmluvy>

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s) {
  if (!s) return '';
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\r/g, '')
    .trim();
}

function fields(block) {
  const o = {};
  const re = /<([A-Za-z_][\w]*)>([\s\S]*?)<\/\1>|<([A-Za-z_][\w]*)\s*\/>/g;
  let m;
  while ((m = re.exec(block))) {
    if (m[3]) { o[m[3]] = ''; continue; }
    o[m[1]] = m[2];
  }
  return o;
}

const date = (v) => (!v || v.startsWith('0000') ? null : v.trim());
const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const ico = (v) => { const d = String(v || '').replace(/\D/g, ''); return d && +d > 0 ? d.padStart(8, '0') : null; };
const txt = (v) => { const t = decode(v); return t && t !== ',' ? t : null; };

export function parseExport(xml) {
  const out = [];
  const blocks = xml.match(/<zmluva>[\s\S]*?<\/zmluva>/g) || [];
  for (let blk of blocks) {
    blk = blk.slice(8, -9); // bez obalu <zmluva>…</zmluva>
    const priBlock = (blk.match(/<prilohy>([\s\S]*?)<\/prilohy>/) || [])[1] || '';
    const f = fields(blk.replace(/<prilohy>[\s\S]*?<\/prilohy>/, ''));
    const prilohy = (priBlock.match(/<priloha>[\s\S]*?<\/priloha>/g) || []).map((p) => {
      const a = fields(p.slice(9, -10));
      const file = decode(a.dokument1) || decode(a.dokument) || null;
      return { id: +a.ID || null, nazov: txt(a.nazov), subor: file, velkost: num(a.velkost1) || num(a.velkost) || 0, zmena: date(a.chan) };
    });
    const id = +f.ID;
    if (!id) continue;
    out.push({
      id,
      cislo: txt(f.nazov),             // číslo / označenie zmluvy
      objednavatel: txt(f.zs1),        // zmluvná strana 1
      objednavatel_ico: ico(f.ico1),
      objednavatel_adresa: txt(f.sidlo1),
      dodavatel: txt(f.zs2),           // zmluvná strana 2
      dodavatel_ico: ico(f.ico),
      dodavatel_adresa: txt(f.sidlo),
      predmet: txt(f.predmet),
      popis: txt(f.popis),
      popis_predmetu: txt(f.popis_predmetu),
      poznamka: txt(f.poznamka),
      poznamka_zmena: txt(f.poznamka_zmena),
      interna_poznamka: txt(f.internapozn),
      text_ucinnost: txt(f.text_ucinnost),
      datum_podpisu: date(f.datum),
      datum_ucinnosti: date(f.datum_ucinnost),
      platnost_do: date(f.datum_platnost_do),
      zverejnene: date(f.datum_zverejnene),
      zmenene: date(f.chan),
      suma: num(f.suma_zmluva),
      suma_spolu: num(f.suma_spolu),
      stav: +f.stav || null,
      typ: +f.typ || null,
      druh: +f.druh || null,
      zdroj: +f.zdroj || null,
      rezort: +f.rezort || null,
      interne_id: txt(f.id),
      referencia: txt(f.ref),
      obstaravanie: txt(f.uvo),
      potvrdenie: txt(f.potvrdenie),
      potvrdenie_datum: date(f.potv_datum),
      zmeny: txt(f.changelog),
      prilohy,
    });
  }
  return out;
}

export const STAV = { 1: 'rozpracovaná', 2: 'zverejnená', 3: 'doplnená', 4: 'zrušená', 5: 'stiahnutá' };
export const amount = (r) => (r.suma_spolu > 0 ? r.suma_spolu : r.suma) || 0;
export const isActive = (r) => r.stav !== 4 && r.stav !== 5;

// ---- Pravidlá pre súčty ----
// Jedna zmluva nad touto sumou je takmer isto chyba pri zadávaní (napr. 230 mld € dotácia obce)
// alebo nereálny strop rámcovej zmluvy. Celý štátny rozpočet SR 2026 má výdavky 33,5 mld €.
export const MAX_AMOUNT = +(process.env.MAX_AMOUNT || 5e9);
// Dodatok: CRZ ho často neoznačí (druh), poznať ho podľa názvu. Dodatky zvyčajne opakujú
// celú sumu pôvodnej zmluvy, preto by sa rovnaké peniaze rátali viackrát.
const AMEND = /^[\s"„'(\-–]*(dodatok|dodatku|dodatkom|dodatek|dod\.)/i;
export const isAmendment = (r) => r.druh === 2 || AMEND.test(r.predmet || '') || AMEND.test(r.cislo || '');
export const isSuspicious = (r) => amount(r) > MAX_AMOUNT;
// prečo sa zmluva nezapočítava do súčtov (null = započítava sa)
// r._dup nastavuje update.mjs: tá istá zmluva zverejnená aj druhou stranou
export const excludeReason = (r) => !isActive(r) ? 'zrušená' : isSuspicious(r) ? 'podozrivá suma' : isAmendment(r) ? 'dodatok' : r._dup ? 'duplicita' : null;
export const counted = (r) => (excludeReason(r) ? 0 : amount(r));
