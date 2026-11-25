// Geokódovanie adries zo CRZ podľa PSČ a názvu obce (GeoNames SK, CC BY 4.0).
// Poradie: presné PSČ (+ názov obce v adrese) → názov obce v adrese → prvé 3 číslice PSČ.

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-');

export function loadGeoNames(txt) {
  const places = [];
  for (const line of txt.split('\n')) {
    const c = line.split('\t');
    if (c.length < 11 || c[0] !== 'SK') continue;
    const psc = c[1].replace(/\D/g, '');
    const lat = +c[9], lon = +c[10];
    if (psc.length !== 5 || !lat || !lon) continue;
    places.push({ psc, name: c[2], kraj: c[3], okres: (c[5] || '').replace(/^Okres\s+/, ''), lat, lon, n: norm(c[2]) });
  }
  // Viac PSČ tej istej obce spojíme do jedného miesta: GeoNames pomenúva PSČ podľa pošty
  // („Bratislava 1“, „Bratislava 15“…) a dáva im rovnaké súradnice, takže by na mape vzniklo
  // desiatky prekrývajúcich sa „miest“. Kľúč = názov bez čísla pošty + okres, poloha = priemer.
  const groups = new Map();
  for (const p of places) {
    p.name = p.name.replace(/\s+\d+$/, '').trim();
    // Bratislava a Košice: pomenujeme podľa okresu (Bratislava I–V, Košice I–IV)
    if (p.okres && p.okres !== p.name && /^(Bratislava|Košice) [IV]+$/.test(p.okres) && p.okres.startsWith(p.name)) p.name = p.okres;
    p.n = norm(p.name);
    p.key = `${slug(p.name)}--${slug(p.okres) || 'x'}`;
    (groups.get(p.key) || groups.set(p.key, []).get(p.key)).push(p);
  }
  for (const g of groups.values()) {
    const lat = g.reduce((a, p) => a + p.lat, 0) / g.length, lon = g.reduce((a, p) => a + p.lon, 0) / g.length;
    for (const p of g) { p.lat = Math.round(lat * 1e4) / 1e4; p.lon = Math.round(lon * 1e4) / 1e4; }
  }
  // rovnaký názov na (takmer) rovnakom mieste, len s inak zapísaným okresom → jedno miesto
  const seen = new Map();
  for (const p of places) {
    const k = `${p.n}|${Math.round(p.lat * 50)}|${Math.round(p.lon * 50)}`; // ~2 km mriežka
    const first = seen.get(k);
    if (!first) seen.set(k, p);
    else if (first.key !== p.key) { p.key = first.key; p.lat = first.lat; p.lon = first.lon; p.okres = first.okres || p.okres; p.kraj = first.kraj || p.kraj; }
  }
  const byPsc = new Map(), byPrefix = new Map(), byName = new Map();
  for (const p of places) {
    (byPsc.get(p.psc) || byPsc.set(p.psc, []).get(p.psc)).push(p);
    const pre = p.psc.slice(0, 3);
    (byPrefix.get(pre) || byPrefix.set(pre, []).get(pre)).push(p);
    if (!byName.has(p.n)) byName.set(p.n, p);
  }
  // názvy zoradené od najdlhšieho, aby "Spišská Nová Ves" vyhralo nad "Ves"
  const names = [...byName.keys()].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  return { places, byPsc, byPrefix, byName, names };
}

export function findPsc(addr) {
  const all = [...String(addr || '').matchAll(/(?<!\d)([089]\d{2})\s?(\d{2})(?!\d)/g)];
  return all.length ? all[all.length - 1][1] + all[all.length - 1][2] : null;
}

function nameIn(addrN, list) {
  const padded = ` ${addrN} `;
  let best = null;
  for (const p of list) if (padded.includes(` ${p.n} `) && (!best || p.n.length > best.n.length)) best = p;
  return best;
}

export function makeGeocoder(geo) {
  const cache = new Map();
  return function geocode(addr) {
    if (!addr) return null;
    if (cache.has(addr)) return cache.get(addr);
    const a = norm(addr);
    const psc = findPsc(addr);
    let hit = null, how = null;
    if (psc && geo.byPsc.has(psc)) {
      const list = geo.byPsc.get(psc);
      hit = nameIn(a, list) || list[0]; how = 'psc';
    }
    if (!hit) {
      const padded = ` ${a} `;
      for (const n of geo.names) if (padded.includes(` ${n} `)) { hit = geo.byName.get(n); how = 'obec'; break; }
    }
    if (!hit && psc && geo.byPrefix.has(psc.slice(0, 3))) {
      const list = geo.byPrefix.get(psc.slice(0, 3));
      hit = nameIn(a, list) || list[0]; how = 'psc3';
    }
    const res = hit ? { key: hit.key, how } : null;
    cache.set(addr, res);
    return res;
  };
}
