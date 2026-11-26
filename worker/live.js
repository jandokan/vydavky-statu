// Počítadlo návštevnosti pre Mapu verejných zmlúv.
// Beží LEN na adrese /live (run_worker_first) – všetky ostatné súbory stránky sa doručujú
// ako statické súbory zadarmo a nespotrebúvajú denný limit účtu.
//
// Ochrana denného limitu 100 000 spustení (zdieľa ho celý účet, aj iné aplikácie):
//  - prehliadač sa ozve raz pri otvorení stránky a potom len každé 2 minúty, kým je karta viditeľná,
//  - pri vyššej záťaži server predĺži interval a nad hranicou opakované ozývanie úplne vypne.
//
// Súkromie: neukladáme IP adresy ani cookies. Prehliadač posiela náhodné ID karty
// (sessionStorage, zanikne zatvorením karty). IP adresa sa drží len krátko v pamäti
// ako hash, aby sa jedna adresa nedala započítať stokrát za hodinu.

const ACTIVE_MS = 3.5 * 60 * 1000;   // „práve tu“ = ozval sa za posledných 3,5 min
const HOUR = 3600 * 1000;
const SOFT = 20000;                   // nad touto dennou záťažou predĺžiť interval
const HARD = 40000;                   // nad touto vypnúť opakované ozývanie
const MAX_NEW_PER_IP_HOUR = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/live') return env.ASSETS.fetch(request);
    const id = env.COUNTER.idFromName('main');
    const ip = request.headers.get('cf-connecting-ip') || '';
    const res = await env.COUNTER.get(id).fetch('https://counter/live' + url.search, { headers: { 'x-ip': await hash(ip) } });
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  },
};

async function hash(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mvz:' + s));
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Counter {
  constructor(state) {
    this.state = state;
    this.sessions = new Map(); // id karty -> čas posledného ozvania (len v pamäti)
    this.ips = new Map();      // hash IP -> { n, t } (len v pamäti)
    this.data = null;          // { hours: { [hodina]: počet }, day, req }
    this.dirty = false;
  }

  async load() {
    if (!this.data) this.data = (await this.state.storage.get('data')) || { hours: {}, day: '', req: 0, since: new Date().toISOString().slice(0, 10) };
  }

  async fetch(request) {
    await this.load();
    const u = new URL(request.url);
    const now = Date.now();
    const d = this.data;

    const day = new Date(now).toISOString().slice(0, 10);
    if (d.day !== day) { d.day = day; d.req = 0; }
    d.req++;

    const sid = (u.searchParams.get('s') || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
    if (sid) this.sessions.set(sid, now);
    for (const [k, t] of this.sessions) if (now - t > ACTIVE_MS) this.sessions.delete(k);

    if (u.searchParams.get('n') === '1') {
      const ip = request.headers.get('x-ip') || '';
      let r = this.ips.get(ip);
      if (!r || now - r.t > HOUR) r = { n: 0, t: now };
      r.n++;
      this.ips.set(ip, r);
      if (r.n <= MAX_NEW_PER_IP_HOUR) {
        const h = Math.floor(now / HOUR);
        d.hours[h] = (d.hours[h] || 0) + 1;
      }
      if (this.ips.size > 5000) for (const [k, v] of this.ips) if (now - v.t > HOUR) this.ips.delete(k);
    }
    this.dirty = true;
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(now + 60 * 1000);

    const hNow = Math.floor(now / HOUR);
    let dayN = 0, monthN = 0;
    for (const [k, v] of Object.entries(d.hours)) {
      const age = hNow - Number(k);
      if (age < 24) dayN += v;
      if (age < 24 * 30) monthN += v;
      else delete d.hours[k];
    }

    const every = d.req > HARD ? 0 : d.req > SOFT ? 600 : 120;
    return Response.json({ now: Math.max(this.sessions.size, sid ? 1 : 0), day: dayN, month: monthN, since: d.since, every });
  }

  async alarm() {
    if (this.dirty && this.data) {
      this.dirty = false;
      await this.state.storage.put('data', this.data);
    }
  }
}
