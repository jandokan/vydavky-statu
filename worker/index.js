// Cloudflare Worker "vydavky-statu".
// Free verzia: stránku (public/index.html z vetvy main) aj dáta (vetva data) číta
// z verejného GitHub repozitára a cachuje ich na okraji Cloudflare.
// Platená verzia: ak je pripojená D1 databáza (binding DB), zapnú sa aj
// /api/search a /api/zmluva/:id nad celou históriou (pozri upgrade/README.md).

const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...extra } });

async function fromGitHub(env, branch, file, type, ttl, v = '') {
  // ?v=… mení kľúč cache, takže po dennej aktualizácii sa načítajú nové súbory
  const url = `https://raw.githubusercontent.com/${env.GH_REPO}/${branch}/${file}${v ? '?v=' + encodeURIComponent(v) : ''}`;
  const r = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!r.ok) return new Response(r.status === 404 ? 'Nenájdené' : 'Chyba zdroja ' + r.status, { status: r.status === 404 ? 404 : 502 });
  return new Response(r.body, {
    headers: { 'content-type': type, 'cache-control': `public, max-age=${Math.min(ttl, 300)}`, 'access-control-allow-origin': '*' },
  });
}

async function d1Api(env, url) {
  const p = url.pathname;
  if (p === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 3) return json({ error: 'Zadaj aspoň 3 znaky' }, 400);
    const limit = Math.min(+url.searchParams.get('limit') || 50, 200);
    const like = `%${q}%`;
    const { results } = await env.DB.prepare(
      `SELECT * FROM zmluvy WHERE objednavatel LIKE ?1 OR dodavatel LIKE ?1 OR predmet LIKE ?1 OR cislo LIKE ?1
       OR objednavatel_ico = ?2 OR dodavatel_ico = ?2 ORDER BY zverejnene DESC LIMIT ?3`
    ).bind(like, q.replace(/\D/g, '').padStart(8, '0'), limit).all();
    return json({ q, results });
  }
  const m = p.match(/^\/api\/zmluva\/(\d+)$/);
  if (m) {
    const r = await env.DB.prepare('SELECT * FROM zmluvy WHERE id = ?').bind(+m[1]).first();
    return r ? json(r) : json({ error: 'Nenájdené' }, 404);
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/api/plan') return json({ plan: env.DB ? 'paid' : 'free', d1: !!env.DB });

    if (p === '/api/search' || p.startsWith('/api/zmluva/')) {
      if (!env.DB) return json({ error: 'Vyhľadávanie v celej histórii je dostupné až s D1 databázou (platená verzia).' }, 501);
      return (await d1Api(env, url)) || json({ error: 'Nenájdené' }, 404);
    }

    if (p.startsWith('/api/')) {
      const file = p.slice(1).replace(/\.\./g, '');
      // meta.json krátko, ostatné dlho – frontend pridáva ?v=<čas generovania>
      const ttl = file === 'api/meta.json' ? 120 : 86400;
      return fromGitHub(env, 'data', file, 'application/json; charset=utf-8', ttl, url.searchParams.get('v') || '');
    }

    if (p === '/' || p === '/index.html') return fromGitHub(env, 'main', 'public/index.html', 'text/html; charset=utf-8', 120);
    if (p === '/favicon.svg') return fromGitHub(env, 'main', 'public/favicon.svg', 'image/svg+xml', 86400);
    return new Response('Nenájdené', { status: 404 });
  },
};
