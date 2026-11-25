// Rozpoznanie zmluvných strán: fyzická osoba (anonymizujeme) a verejná inštitúcia.
import { norm } from './geo.mjs';

// hranica slova, ktorá chápe diakritiku (\b v JS berie „č“, „ť“… ako nepísmená)
const B = '(?:(?<![\\p{L}\\d])(?=[\\p{L}\\d])|(?<=[\\p{L}\\d])(?![\\p{L}\\d]))';
const uni = (re) => new RegExp(re.source.replaceAll('\\b', B), re.flags.includes('u') ? re.flags : re.flags + 'u');

// znaky organizácie v názve (právna forma alebo typ inštitúcie)
const ORG = new RegExp([
  's\\.? ?r\\.? ?o', 'a\\.? ?s\\b', 'spol\\b', 'spoločnos', 'v\\.? ?o\\.? ?s', 'k\\.? ?s\\b', 's\\.? ?p\\b', 'š\\.? ?p\\b', 'o\\.? ?z\\b', 'n\\.? ?o\\b', 'z\\.? ?p\\.? ?o',
  'družstvo', 'podnik', 'firma', 'holding', 'group', 'invest', 'servis', 'service', 'trade', 'consult', 'tech', 'system', 'media', 'energ',
  'obec', 'mesto', 'mestsk', 'mestská časť', 'kraj', 'župa', 'samospráv', 'vúc', 'úrad', 'ministerstv', 'štátn', 'národn', 'slovensk', 'republik', 'vlád', 'parlament',
  'agentúr', 'fond', 'nadáci', 'nadačn', 'združeni', 'zväz', 'spolok', 'klub', 'jednot', 'únia', 'asociáci', 'komor', 'rada\\b', 'výbor', 'sekcia', 'zbor', 'cirk', 'farnos', 'biskup', 'reholn', 'kongregáci', 'diecéz', 'evanjel', 'katolíck', 'reformovan',
  'škol', 'gymnázi', 'akadémi', 'univerzit', 'fakult', 'inštitút', 'ústav', 'centrum', 'stredisk', 'knižnic', 'múze', 'galéri', 'divadl', 'kino', 'osvet', 'kultúr', 'športov', 'telový', 'internát', 'jasle', 'domov', 'zariadeni', 'nemocnic', 'poliklinik', 'ambulanci', 'lekáreň', 'hospic', 'kúpele', 'sanatóri',
  'polícia', 'hasič', 'armád', 'vojensk', 'súd\\b', 'súdy', 'prokuratúr', 'väzn', 'ozbrojen', 'správa', 'služby', 'technické', 'vodárensk', 'teplárensk', 'lesy', 'železnic', 'doprav', 'pošta', 'banka', 'poisťovň', 'sporiteľ',
  'ltd', 'limited', 'llc', 'inc\\b', 'corp', 'company', 'gmbh', '\\bag\\b', 's\\.a\\.', 'b\\.v\\.', 'n\\.v\\.', 'kft', 'zrt', 'sp\\. ?z', 's\\.r\\.l', 'spa\\b', 'sas\\b', 'sarl', 'plc', 'oy\\b', '\\bab\\b',
  'soza', 'lita\b', 'oza\b', 'foundation', 'university', 'institute', 'commission', 'office', 'agency', 'bank', 'union', 'european', 'europe', 'ministry', 'council', 'association',
].join('|').replaceAll('\\b', B), 'iu');
// zástupné texty namiesto mena
const PLACEHOLDER = uni(/^\s*(neuveden|podľa prílohy|neznám|viď|vid\b|nájomc|odberateľ|študent|žiadateľ|príjemc|kupujúc|predávajúc|fyzick[áé] osob|osoba\b|občan|x+\s*$|-+\s*$|\.+\s*$)/i);
// verejné inštitúcie podľa názvu
const PUBLIC = uni(/(?<!\p{L})(obec|mesto|mestsk[áa] časť|samosprávny kraj|vyšší územný|ministerstv|úrad\b|úrad |štátn|národn[áýé]|slovensk[áa] republik|univerzit|vysok[áa] škola|základn[áa] škola|materská škola|stredn[áa] .{0,20}škola|gymnázium|spojen[áa] škola|nemocnica|polícia|policajn|hasičsk|vojensk|ozbrojen|súd\b|prokuratúr|ústav na výkon|správa ciest|správa katastra|regionálna správa|železnice slovenskej|národná diaľničná|vodohospodárska výstavba|slovenský vodohospodársky|lesy slovenskej|sociálna poisťovňa|všeobecná zdravotná|slovenská televízia|rozhlas a televízia|knižnica|múzeum|galéria|divadlo|osvetové stredisko|centrum sociálnych|zariadenie pre seniorov|domov sociálnych|centrum voľného času|okresn[ýé] úrad|krajsk[ýé]|environmentáln[yý] fond|fond na podporu|zväz miest|združenie obcí|matica slovensk|príspevková organizácia|rozpočtová organizácia|mestsk[éý] (služby|podnik)|služby mesta|technické služby|správa mestsk|správa majetku mesta|výskumný ústav|kartografický ústav|ústav\b|mestská časť|mestskej časti)/iu);
// obchodná právna forma v názve → podľa názvu verejnou nie je (len ak sama zverejňuje zmluvy)
const COMMERCIAL = uni(/(s\.? ?r\.? ?o|\ba\.? ?s\b|spol\b|\bk\.? ?s\b|v\.? ?o\.? ?s|ltd|limited|gmbh|\bag\b|inc\b|kft|zrt|sp\. ?z)/i);

export function isPlaceholder(name) { return !name || PLACEHOLDER.test(name); }

// fyzická osoba = bez IČO a bez znakov organizácie v názve
export function isPerson(name, ico) {
  if (ico) return false;
  if (!name) return false;
  if (PLACEHOLDER.test(name)) return true;
  const n = String(name).trim();
  if (ORG.test(n) || /\d/.test(n)) return false;
  const words = n.replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 6;
}

// Anonymizácia záznamu (idempotentná): mená a adresy fyzických osôb, názvy príloh, interné poznámky.
export function anonymize(r) {
  if (r._anon === 2) return r;
  let person = false;
  for (const [n, i, a, f] of [['objednavatel', 'objednavatel_ico', 'objednavatel_adresa', 'osoba_o'], ['dodavatel', 'dodavatel_ico', 'dodavatel_adresa', 'osoba_d']]) {
    if (r[f] || isPerson(r[n], r[i])) { r[n] = PLACEHOLDER.test(r[n] || '') && !/fyzick/i.test(r[n]) ? 'Neuvedené' : 'Fyzická osoba'; r[a] = null; r[f] = true; person = true; }
  }
  if (person && r.prilohy) r.prilohy = r.prilohy.map((p, i) => ({ ...p, nazov: `Príloha č. ${i + 1}` }));
  r.interna_poznamka = null;
  r._anon = 2;
  return r;
}

// IČO, ktoré sami zverejňujú zmluvy = povinné osoby (verejný sektor).
// Pozor: obce niekedy zapíšu súkromnú firmu ako stranu 1, preto musí byť IČO stranou 1
// aspoň v `min` zmluvách a zároveň aspoň v polovici toľkých, koľkokrát je stranou 2.
export function publisherSet(records, min = 3) {
  const c1 = new Map(), c2 = new Map();
  for (const r of records) {
    if (r.objednavatel_ico) c1.set(r.objednavatel_ico, (c1.get(r.objednavatel_ico) || 0) + 1);
    if (r.dodavatel_ico) c2.set(r.dodavatel_ico, (c2.get(r.dodavatel_ico) || 0) + 1);
  }
  return new Set([...c1].filter(([k, v]) => v >= min && v >= 0.5 * (c2.get(k) || 0)).map(([k]) => k));
}
export function isPublic(name, ico, pubSet) {
  if (ico && pubSet.has(ico)) return true;
  if (!name) return false;
  // obchodná forma → verejná len ak ide o mestský/obecný podnik
  if (COMMERCIAL.test(name)) return /(mesta|mestsk|obce|obecn|kraja|samosprávn)/iu.test(name);
  return PUBLIC.test(name);
}
export { norm };
