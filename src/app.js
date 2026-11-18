// Vanadium app
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const store = {
  get(k, d) { try { const v = localStorage.getItem('st_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('st_' + k, JSON.stringify(v)); } catch (e) { } }
};
const ORD = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const slug = s => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const uniq = a => [...new Set(a.filter(x => x !== null && x !== undefined && x !== ''))];

const BUILTIN = [
  { id: 'monsters', file: 'data/monsters.json', title: 'Draw Steel: Monsters', kind: 'bestiary' }
];
const KIND = { core: 'Core rules', bestiary: 'Bestiary', adventure: 'Adventure', supplement: 'Supplement', book: 'Book' };

let D;                    // heroes data
let PACKS = [];           // [{id,title,kind,chapters,monsters,abilities,builtin}]
const PK = {};            // id -> pack
let MONS = [];            // all monsters (global ids)
const MON = {};           // gid -> monster
const PAB = {};           // packId:localId -> ability
let AB = {}, TYPES, BYID, CHAP, PAGE, condNames;
let isMob = false;

// ---------- data loading ----------
const DATA_V = '__DATAV__';
async function readBody(r, onProg) {
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !onProg) return new Uint8Array(await r.arrayBuffer());
  const rd = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProg(got, total); }
  const out = new Uint8Array(got); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; } return out;
}
async function bytesToJSON(u8) {
  if (u8[0] === 0x48 && u8[1] === 0x34 && u8[2] === 0x73 && u8[3] === 0x49) { const bin = atob(new TextDecoder().decode(u8).trim()); u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); }
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(u8));
}
async function getJSON(u, onProg) {
  let cache = null;
  try { cache = await caches.open('steeltools-' + DATA_V); const hit = await cache.match(u); if (hit) return await bytesToJSON(new Uint8Array(await hit.arrayBuffer())); } catch (e) { cache = null; }
  let u8 = null, data;
  if (typeof DecompressionStream !== 'undefined') {
    try { const r = await fetch(u.replace(/\.json$/, '.gz.txt') + '?v=' + DATA_V); if (r.ok) { u8 = await readBody(r, onProg); data = await bytesToJSON(u8); } } catch (e) { u8 = null; }
  }
  if (data === undefined) { const r = await fetch(u + '?v=' + DATA_V); if (!r.ok) throw new Error(u + ' ' + r.status); u8 = await readBody(r, onProg); data = await bytesToJSON(u8); }
  if (cache) { try { await cache.put(u, new Response(u8)); caches.keys().then(ks => ks.filter(k => k.startsWith('steeltools-') && k !== 'steeltools-' + DATA_V).forEach(k => caches.delete(k))); } catch (e) {} }
  return data;
}
const IDB = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => { try { const q = indexedDB.open('steeltools', 1); q.onupgradeneeded = () => q.result.createObjectStore('packs', { keyPath: 'id' }); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); } catch (e) { rej(e); } });
    return this.db;
  },
  async all() { try { const db = await this.open(); return await new Promise((res, rej) => { const t = db.transaction('packs').objectStore('packs').getAll(); t.onsuccess = () => res(t.result || []); t.onerror = () => rej(t.error); }); } catch (e) { return []; } },
  async put(p) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('packs', 'readwrite'); t.objectStore('packs').put(p); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async del(id) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('packs', 'readwrite'); t.objectStore('packs').delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
};
const memPacks = []; // fallback when IndexedDB is unavailable

function addPack(p) {
  if (PK[p.id]) removePack(p.id);
  PACKS.push(p); PK[p.id] = p;
  p.monMap = {};
  for (const m of p.monsters || []) {
    let gid = m.id; if (MON[gid]) gid = m.id + '-' + p.id; if (MON[gid]) gid = gid + '-' + Math.random().toString(36).slice(2, 6);
    m.gid = gid; m.pack = p.id; MON[gid] = m; MONS.push(m); p.monMap[m.id] = gid;
  }
  for (const a of p.abilities || []) { PAB[p.id + ':' + a.id] = a; a.pack = p.id; }
  // dastards: monsters in a 'Dastards' part, with lore from "<b>Name:</b> …" bullets
  const dch = (p.chapters || []).filter(c => /dastard/i.test(c.part || '') || /^dastards?$/i.test(c.title));
  for (const c of dch) {
    const lore = {}; let cur = null;
    for (const b of c.blocks) {
      if (b.t === 'h') { cur = null; continue; }
      const mm = b.t === 'li' && (b.html || '').match(/^\s*<b>([^<]{1,60}?):?\s*<\/b>\s*:?\s*(.*)$/s);
      if (mm) { cur = mm[1].replace(/:\s*$/, '').trim().toLowerCase(); lore[cur] = mm[2]; continue; }
      if (cur && b.t === 'p') lore[cur] += ' ' + b.html; else cur = null;
    }
    const norm = x => x.toLowerCase().replace(/[“”"]/g, '').replace(/[’']/g, '’').trim();
    const L = {}; for (const k in lore) L[norm(k)] = lore[k];
    for (const m of p.monsters || []) if (m.ch === c.id) { m.dastard = c.title; const l = L[norm(m.name)]; if (l) m.lore = l; }
  }
}
function removePack(id) {
  const p = PK[id]; if (!p) return;
  PACKS = PACKS.filter(x => x.id !== id); delete PK[id];
  MONS = MONS.filter(m => m.pack !== id);
  for (const k of Object.keys(MON)) if (MON[k].pack === id) delete MON[k];
  for (const k of Object.keys(PAB)) if (k.startsWith(id + ':')) delete PAB[k];
}

// ---- update check: site/version.json changes whenever a new build lands (update.php or
// serve.py swaps the files in, or a host redeploys). Checked at most every 5 minutes across
// all tabs; update.php also has its own 5-minute cooldown shared by every visitor.
const UPD_COOLDOWN = 5 * 60 * 1000;
let bootBuild = null, updSeen = null;
async function fetchBuild() {
  try { const r = await fetch('version.json', { cache: 'no-store' }); return r.ok ? ((await r.json()).build || null) : null; } catch (e) { return null; }
}
async function checkForUpdate() {
  if (!bootBuild || document.hidden || Date.now() - store.get('updchk', 0) < UPD_COOLDOWN) return;
  store.set('updchk', Date.now());
  await callUpdater();
  const b = await fetchBuild();
  if (b && b !== bootBuild && b !== updSeen) showUpdateBar(b);
}
// On a PHP host update.php pulls a new build from GitHub (5-min cooldown shared by all visitors).
// Elsewhere (static host, serve.py) it 404s or isn't JSON, and this returns null.
async function callUpdater() {
  try { const r = await fetch('update.php', { cache: 'no-store' }); if (!r.ok) return null; const j = await r.json(); return j && j.status ? j : null; } catch (e) { return null; }
}
let updRunning = false;
async function manualUpdate() {  // Utilities → Check for updates
  if (updRunning) { toast('Already checking for updates…'); return; }
  updRunning = true; toast('Checking for updates…', 300000);  // stays up until the result replaces it
  const say = h => toast(h, 6000);
  try {
    store.set('updchk', Date.now());
    const r = await callUpdater();
    const b = await fetchBuild();
    const newer = b && bootBuild && b !== bootBuild;
    if (newer) showUpdateBar(b);
    if (r && r.status === 'error') say('Update failed: ' + esc(r.error || 'unknown error'));
    else if (r && r.status === 'busy') say('An update is already running on the server. Try again in a minute.');
    else if (newer) say('A new version was installed. Reload to use it.');
    else if (r && r.status === 'cooldown') { const s = r.retry_in || 0; say(`Already checked in the last 5 minutes. Next check possible in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.`); }
    else if (r) say('Vanadium is up to date.');
    else say(b ? 'No new version found. (This server doesn’t run update.php.)' : 'Updates are not available on this server.');
  } finally { updRunning = false; }
}
function showUpdateBar(b) { updSeen = b; vShowBar('updbar', 'A new version of Vanadium is available.'); }
// a top bar with a Reload button (new version, or changes synced from another device)
function vShowBar(id, msg) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div'); el.id = id; el.className = 'vbar'; el.setAttribute('role', 'status');
    el.innerHTML = '<span></span><button class="upd-go">Reload</button><button class="upd-x" aria-label="Dismiss">×</button>';
    document.body.appendChild(el);
    el.querySelector('.upd-go').onclick = () => location.reload();
    el.querySelector('.upd-x').onclick = () => { el.hidden = true; };
  }
  el.querySelector('span').textContent = msg; el.hidden = false;
}
window.vShowBar = vShowBar;
async function initUpdateCheck() {
  bootBuild = await fetchBuild();  // the build this page was loaded from
  if (!bootBuild) return;          // no version.json (old build or file://): nothing to compare
  checkForUpdate();                        // first visit after a while triggers the server check
  setInterval(checkForUpdate, 60 * 1000);  // cheap tick; the cooldown decides when to fetch
  document.addEventListener('visibilitychange', checkForUpdate);
}

async function boot() {
  applyTheme(store.get('theme2', 'light'));
  setupMobile();
  try { D = await getJSON('data/heroes.json', (g, t) => { $('#loadmsg').textContent = `Loading the rules… ${(g / 1048576).toFixed(1)}${t ? ' / ' + (t / 1048576).toFixed(1) : ''} MB`; }); }
  catch (e) { $('#loadmsg').textContent = 'Could not load the rules data (' + e.message + ').'; return; }
  initHeroes();
  const heroesPack = { id: 'heroes', title: 'Draw Steel: Heroes', kind: 'core', builtin: true, chapters: D.book, monsters: [], abilities: [], heroes: true };
  addPack(heroesPack);
  buildMenu(); updatePins(); route();
  $('#loading').style.display = 'none';
  initUpdateCheck();
  // packs in the background
  const loads = BUILTIN.map(b => getJSON(b.file).then(p => { p.builtin = true; p.title = b.title; p.kind = b.kind; p.id = b.id; addPack(p); }).catch(e => console.warn('pack', b.id, e)));
  const user = IDB.all().then(list => list.forEach(p => { p.builtin = false; addPack(p); }));
  await Promise.all([...loads, user]);
  buildIndex(); buildMenu();
  const h = location.hash.slice(1);
  if (/^(monsters|book|library|import|pinned|negotiation|montage|encounter|session)/.test(h) || !h) route();
  // sync (sync.js): books arriving from / removed on other devices
  const onBooks = /^(library|book|monsters|sync)/;
  if (window.VSync) VSync.appReady({
    added(p) { p.builtin = false; addPack(p); buildIndex(); buildMenu(); toast('Synced “' + esc(p.title) + '” from another device'); if (onBooks.test(location.hash.slice(1))) route(); },
    removed(id) { if (!PK[id]) return; removePack(id); buildIndex(); buildMenu(); if (onBooks.test(location.hash.slice(1))) route(); }
  });
}

function initHeroes() {
  AB = {}; D.abilities.forEach(a => AB[a.id] = a);
  TYPES = {
    abilities: { label: 'Abilities', one: 'Ability' }, classes: { label: 'Classes', one: 'Class' }, ancestries: { label: 'Ancestries', one: 'Ancestry' },
    cultures: { label: 'Culture Aspects', one: 'Culture Aspect' }, careers: { label: 'Careers', one: 'Career' }, kits: { label: 'Kits', one: 'Kit' },
    perks: { label: 'Perks', one: 'Perk' }, complications: { label: 'Complications', one: 'Complication' }, conditions: { label: 'Conditions', one: 'Condition' },
    skills: { label: 'Skills', one: 'Skill' }, treasures: { label: 'Treasures', one: 'Treasure' }, titles: { label: 'Titles', one: 'Title' },
    gods: { label: 'Gods & Saints', one: 'Deity' }, glossary: { label: 'Glossary', one: 'Term' }, monsters: { label: 'Monsters', one: 'Monster' }
  };
  BYID = {}; Object.keys(TYPES).forEach(t => { BYID[t] = {}; (D[t] || []).forEach(e => BYID[t][e.id] = e); });
  BYID.monsters = MON;
  CHAP = {}; D.book.forEach(c => CHAP[c.id] = c);
  PAGE = {};
  D.book.forEach(c => c.blocks.forEach((b, i) => { if (b.pg && !PAGE[b.pg]) PAGE[b.pg] = { ch: c.id, i }; }));
  condNames = D.conditions.map(c => c.name.toLowerCase());
}
const itemsOf = t => t === 'monsters' ? MONS : (D[t] || []);

// ---------- routing ----------
function go(h) { if (location.hash.slice(1) === h) route(); else location.hash = h; }
window.addEventListener('hashchange', route);

// ---------- icons ----------
const ICON = {
  dist: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 12h18M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4"/></svg>',
  tgt: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  die: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 2 21 7v10l-9 5-9-5V7z"/></svg>',
  melee: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></svg>',
  ranged: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 20 20 4M14 4h6v6M4 14v6h6"/></svg>',
  area: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
  trig: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  trait: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z"/></svg>',
  vil: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C7 2 4 5.5 4 10c0 3 1.5 5 3 6v3h2v-2h2v2h2v-2h2v2h2v-3c1.5-1 3-3 3-6 0-4.5-3-8-8-8zm-3 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m15 18-6-6 6-6"/></svg>'
};

// ---------- ability rendering ----------
function renderAbility(a, opts = {}) {
  if (!a) return '';
  if (a.pack && !a.group) return renderPackAbility(a, opts);
  const pinned = isPinned('abilities', a.id);
  const costTxt = a.cost ? esc(a.cost) : (a.kind === 'Signature' ? 'Signature' : '');
  let h = `<div class="ab" data-ab="${a.id}"><div class="ab-h"><div class="ab-n"><a data-go="abilities--${a.id}">${esc(a.name)}</a></div>`;
  if (costTxt) h += `<span class="ab-c ${!a.cost ? 'sig' : ''}">${costTxt}</span>`;
  h += `<button class="ab-pin ${pinned ? 'on' : ''}" data-pin="abilities--${a.id}" title="Pin">★</button></div><div class="ab-b">`;
  if (a.flavor) h += `<div class="ab-fl">${a.flavor}</div>`;
  h += `<div class="ab-kw"><span>${esc(a.keywords.join(', ') || '—')}</span><span class="act">${esc(a.action)}</span></div>`;
  if (a.distance || a.target) h += `<div class="ab-dt"><span>${ICON.dist}${a.distance}</span><span>${ICON.tgt}${a.target}</span></div>`;
  h += rowsHtml(a.rows, a.id, a.name);
  h += `</div>`;
  if (!opts.nosrc) h += `<div class="ab-src"><span>${esc(a.group === 'Class' ? a.source + (a.sub ? ' · ' + a.sub : '') + (a.level ? ' · ' + ORD(a.level) + ' level' : '') : (a.group ? a.group + ': ' : '') + a.source)}</span><a data-page="${a.src.pg}">p. ${esc(a.src.pg)}</a></div>`;
  return h + `</div>`;
}
function rowsHtml(rows, key, label) {
  let h = '';
  for (const r of rows || []) {
    if (r.k === 'roll') h += `<div class="ab-roll">${esc(strip(r.html))}: <button class="rollbtn" data-roll="${esc(strip(r.html))}" data-ab="${esc(key)}" data-lab="${esc(label)}">${ICON.die} Roll</button></div>`;
    else if (r.k === 'tier') h += `<div class="tier n${r.n}"><span class="tb">${['', '≤11', '12–16', '17+'][r.n]}</span><span>${r.html}</span></div>`;
    else h += `<div class="ab-f">${r.html}</div>`;
  }
  return h;
}
function abKind(a) {
  const kw = (a.keywords || []).join(' ');
  if (/villain/i.test(a.action + ' ' + a.cost)) return 'vil';
  if (a.trait && !a.action) return 'trait';
  if (/trigger/i.test(a.action)) return 'trig';
  if (/Area/.test(kw)) return 'area';
  if (/Ranged/.test(kw) && !/Melee/.test(kw)) return 'ranged';
  if (/Melee/.test(kw)) return 'melee';
  return a.action ? 'melee' : 'trait';
}
function monAbility(a, key) {
  const k = abKind(a);
  const costCls = /malice/i.test(a.cost) ? 'mal' : /villain/i.test(a.cost) ? 'vil' : '';
  const rows = (a.rows || []).filter(r => r.k !== 'roll');
  let h = `<div class="ma" data-ab="${esc(key)}"><div class="ma-h"><span class="ma-i ${k}">${ICON[k] || ICON.melee}</span><span class="ma-n">${esc(a.name)}</span>`;
  if (a.roll) h += `<span class="ma-roll">${esc(a.roll)}</span><button class="rollbtn" data-roll="${esc(a.roll)}" data-ab="${esc(key)}" data-lab="${esc(a.name)}">${ICON.die} Roll</button>`;
  if (a.cost) h += `<span class="ma-c ${costCls}">${esc(a.cost)}</span>`;
  h += `</div>`;
  if (a.keywords.length || a.action) h += `<div class="ma-kw"><span>${esc(a.keywords.join(', ') || '—')}</span><span class="act">${esc(a.action)}</span></div>`;
  if (a.distance || a.target) h += `<div class="ma-dt"><span>${ICON.dist}${a.distance}</span><span>${ICON.tgt}${a.target}</span></div>`;
  h += `<div class="ma-b">${rowsHtml(rows, key, a.name)}</div></div>`;
  return h;
}
function renderPackAbility(a, opts = {}) {
  const key = a.pack + ':' + a.id;
  return `<div class="mon" style="max-width:640px"><div class="mon-items" style="padding-top:2px">${monAbility(a, key).replace('class="ma"', 'class="ma" style="border-top:0"')}</div>${opts.nosrc ? '' : `<div class="mon-src"><span>${esc(a.source || '')}</span><a data-gobook="${esc(a.pack)}--${esc(a.ch || '')}">${esc(PK[a.pack]?.title || '')} · p. ${esc(a.pg)}</a></div>`}</div>`;
}
function renderMonster(m, opts = {}) {
  if (!m) return '';
  const st = m.stats || {};
  const order = ['Size', 'Speed', 'Stamina', 'Stability', 'Free Strike'];
  const keys = uniq([...order.filter(k => k in st), ...Object.keys(st)]);
  const pinned = isPinned('monsters', m.gid);
  const art = !opts.nosrc && m.img != null ? PK[m.pack]?.images?.[m.img] : null;
  let h = `${art ? `<figure class="mon-art"><img src="${esc(art)}" alt="" data-zoom="1"></figure>` : ''}<div class="mon" data-mon="${m.gid}"><div class="mon-h"><div><div class="mon-n"><a data-go="monsters--${m.gid}">${esc(m.name)}</a></div><div class="mon-k">${esc((m.keywords || []).join(', ') || '—')}</div></div>
    <div class="mon-r"><div>${m.dastard ? '<span class="dastb" title="Dastard: a named villain you can drop into a combat">Dastard</span> ' : ''}Level ${m.level} ${esc(m.role)}</div>${m.ev ? `<span class="ev">EV ${esc(m.ev)}</span>` : ''} <button class="ab-pin ${pinned ? 'on' : ''}" data-pin="monsters--${m.gid}" title="Pin">★</button></div></div>`;
  if (keys.length) h += `<div class="mon-stats" style="grid-template-columns:repeat(${keys.length},1fr)">${keys.map(k => `<div><b>${esc(st[k] || '—')}</b><span>${esc(k)}</span></div>`).join('')}</div>`;
  const def = [];
  if (m.immunity) def.push(`<span><b>Immunity:</b> ${esc(m.immunity)}</span>`);
  if (m.weakness) def.push(`<span><b>Weakness:</b> ${esc(m.weakness)}</span>`);
  if (m.movement) def.push(`<span><b>Movement:</b> ${esc(m.movement)}</span>`);
  for (const x of m.extra || []) def.push(`<span><b>${esc(x.k)}:</b> ${esc(x.v)}</span>`);
  if (def.length) h += `<div class="mon-def">${def.join('')}</div>`;
  const ch = m.chars || {};
  if (Object.keys(ch).length) h += `<div class="mon-chars">${['Might', 'Agility', 'Reason', 'Intuition', 'Presence'].map(c => `<div><b>${esc(ch[c] ?? '—')}</b>${c}</div>`).join('')}</div>`;
  if (m.desc) h += `<div class="mon-desc">${m.desc}</div>`;
  if (m.lore) h += `<div class="mon-lore"><b>${esc(m.dastard || 'Dastard')} dastard.</b> ${m.lore}</div>`;
  h += `<div class="mon-items">${(m.items || []).map((a, i) => monAbility(a, m.gid + ':' + i)).join('')}</div>`;
  if (!opts.nosrc) h += `<div class="mon-src"><span>${esc(m.group || '')}</span><a data-gobook="${esc(m.pack)}--${esc(m.ch || '')}">${esc(PK[m.pack]?.title || '')} · p. ${esc(m.pg)}</a></div>`;
  return h + `</div>`;
}

// ---------- block rendering ----------
function renderBlocks(blocks, opts = {}) {
  let out = '', list = null, aside = null;
  const pack = opts.pack;
  const minL = Math.min(6, ...blocks.filter(b => b.t === 'h' && b.lvl < 6).map(b => b.lvl));
  const closeList = () => { if (list !== null) { const l = list; list = null; emit('<ul>' + l + '</ul>'); } };
  const closeAside = () => { if (list !== null) { const l = list; list = null; aside += '<ul>' + l + '</ul>'; } if (aside !== null) { out += '<aside>' + aside + '</aside>'; aside = null; } };
  const emit = s => { if (aside !== null) aside += s; else out += s; };
  let lastPg = null;
  blocks.forEach((b, bi) => {
    const pm = (opts.book && b.pg && b.pg !== lastPg) ? (lastPg = b.pg, `<span class="pgmark" id="pg-${esc(b.pg)}">p. ${esc(b.pg)}</span>`) : '';
    const idx = opts.book ? ` data-bi="${bi}"` : '';
    if (b.t === 'li') { const ra = pack && /^(<[^>]+>)*\s*[“"]/.test(b.html); list = (list || '') + `<li${idx}${ra ? ' class="ra"' : ''}>${pm}${b.html}</li>`; return; }
    closeList();
    const smallish = b.t === 'p' && (b.style === 'small' || b.style === 'dark');
    if (aside !== null && !(smallish || b.t === 'table')) closeAside();
    if (b.t === 'h') {
      if (b.lvl === 0) return;
      if (!pack && b.lvl === 6 && (opts.book || opts.sidebars)) { closeAside(); aside = `<div class="ah">${esc(b.text)}</div>`; return; }
      if (opts.book && b.lvl === 1) { emit(`<h2 class="big" id="h-${b.id}"${idx}>${pm}${esc(b.text)}</h2>`); return; }
      const rel = opts.book ? (pack ? b.lvl - 2 : b.lvl - 2) : b.lvl - minL;
      const tag = 'h' + Math.min(6, Math.max(3, 3 + rel));
      emit(`<${tag} id="h-${b.id || ''}"${idx}>${pm}${esc(b.text)}</${tag}>`);
      const nid = opts.book && NEGBYHEAD[(opts.packId || 'heroes') + ':' + opts.ch + ':' + b.id]; if (nid) emit(`<a class="btn negrunbtn" href="#negotiation--${nid}">▶ Run this negotiation</a>`);
      const mid = opts.book && MTBYHEAD[(opts.packId || 'heroes') + ':' + opts.ch + ':' + b.id]; if (mid) emit(`<a class="btn negrunbtn" href="#montage--${mid}">▶ Run this montage test</a>`);
    } else if (b.t === 'p') {
      emit(`<p class="${b.style === 'body' ? '' : 'small'}"${idx}>${pm}${b.html}</p>`);
    } else if (b.t === 'quote') {
      emit(`<blockquote${idx}>${pm}${esc(b.text)}${b.attr ? `<cite>— ${esc(b.attr)}</cite>` : ''}</blockquote>`);
    } else if (b.t === 'tier') {
      emit(`<div class="tierp n${b.n}"${idx}>${pm}<span class="tb">${['', '≤11', '12–16', '17+'][b.n]}</span><span>${b.html}</span></div>`);
    } else if (b.t === 'table') {
      let t = `<div class="tblw"${idx}>${pm}<table class="dt"><thead><tr>${b.head.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>`;
      const n = Math.max(b.head.length, ...b.rows.map(r => r.length));
      for (const r of b.rows) t += '<tr>' + Array.from({ length: n }, (_, k) => `<td>${r[k] || ''}</td>`).join('') + '</tr>';
      emit(t + '</tbody></table></div>');
      if (opts.book && b.head.length >= 2 && /^Group/i.test(b.head[0]) && /Creature/i.test(b.head[1])) emit(`<button class="btn ghost sm loadencbtn" data-loadenc="${esc(opts.packId || 'heroes')}|${esc(opts.ch)}|${bi}">⚔ Load into Encounter Builder</button>`);
    } else if (b.t === 'ability') {
      const a = pack ? PAB[pack + ':' + b.ref] : AB[b.ref];
      emit(`<div${idx}>${pm}</div>` + (pack ? renderPackAbility(a, { nosrc: true }) : renderAbility(a)));
    } else if (b.t === 'img') {
      const src = (PK[opts.packId || pack] || {}).images?.[b.i];
      if (src) emit(`<figure class="bkimg ${b.w > 330 ? 'wide' : 'side'}" data-pg="${esc(b.pg || '')}"><img loading="lazy" src="${esc(src)}" alt="" data-zoom="1"></figure>`);
    } else if (b.t === 'monster') {
      const m = MON[PK[pack]?.monMap[b.ref]];
      emit(`<div${idx}>${pm}</div>` + renderMonster(m, { nosrc: true }));
    }
  });
  closeList(); closeAside();
  return out;
}

function enhance(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement; if (!p || p.closest('a,button,.lnk,.pref,th,h2,h3,h4,h5,h6,.ab-n,.ma-n,.mon-n,.pot,.chr,.pgmark,input,select')) return NodeFilter.FILTER_REJECT;
      return /p\.\s*\d|bleed|daz|fright|grab|prone|restrain|slow|taunt|weaken/i.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  const inHeroes = !root.closest || !root.closest('[data-pack]') || root.closest('[data-pack]').dataset.pack === 'heroes';
  const re = new RegExp('(\\bpp?\\.\\s*\\d+(?:[–-]\\d+)?)|\\b(' + condNames.join('|') + ')\\b', 'gi');
  for (const n of nodes) {
    const s = n.data; let m, last = 0, frag = null; re.lastIndex = 0;
    while ((m = re.exec(s))) {
      if (m[1] && !inHeroes) continue;
      frag = frag || document.createDocumentFragment();
      frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const el = document.createElement('span');
      if (m[1]) { el.className = 'pref'; el.dataset.page = (m[1].match(/\d+/) || [''])[0]; }
      else { el.className = 'lnk'; el.dataset.go = 'conditions--' + m[2].toLowerCase(); }
      el.textContent = m[0]; frag.appendChild(el); last = m.index + m[0].length;
    }
    if (frag) { frag.appendChild(document.createTextNode(s.slice(last))); n.replaceWith(frag); }
  }
}

// ---------- pins ----------
let pins = store.get('pins', []);
function isPinned(t, id) { return pins.includes(t + '--' + id); }
function togglePin(key) {
  pins = pins.includes(key) ? pins.filter(x => x !== key) : [...pins, key];
  store.set('pins', pins); updatePins();
  $$(`[data-pin="${CSS.escape(key)}"]`).forEach(b => b.classList.toggle('on', pins.includes(key)));
  toast(pins.includes(key) ? 'Pinned' : 'Unpinned');
}
function updatePins() { $('#pincount').textContent = pins.length; }

// ---------- nav ----------
function MENU() {
  return [
    ['Rules', [['library', 'Library'], ['book--heroes', 'Heroes Rulebook'], ['-'], ['conditions'], ['glossary'], ['skills']]],
    ['Heroes', [['classes'], ['ancestries'], ['cultures'], ['careers'], ['complications'], ['-'], ['kits'], ['perks'], ['abilities'], ['-'], ['respite', 'Respite & Downtime']]],
    ['Director', [['sessions', 'Sessions'], ['encounter', 'Encounter Builder'], ['negotiation', 'Negotiation Tracker'], ['montage', 'Montage Tests'], ['monsters'], ...PACKS.filter(p => p.kind === 'adventure').map(p => ['book--' + p.id, p.title]), ['book--monsters', 'Monsters Book'], ['book--encounters', 'Encounters Book'], ['-'], ['book--heroes--for-the-director', 'For the Director'], ['gods']]],
    ['Rewards', [['treasures'], ['cards', 'Cards: items, quests, followers'], ['titles']]],
    ['Utilities', [['import', 'Import a PDF'], ['roller', 'Power Roller'], ['pinned', 'Pinned Items'], ['-'], ['sync', 'Sync across devices'], ['!update', 'Check for updates']]]
  ];
}
function buildMenu() {
  $('#menu').innerHTML = MENU().map(([lab, items]) => `<div class="mi"><button>${lab}</button><div class="dd">${items.filter(([k]) => k === '-' || TYPES[k] || !k.startsWith('book--') || PK[k.split('--')[1]]).map(([k, l]) => k === '-' ? '<hr>' : `<a href="#${k}">${esc(l || TYPES[k].label)}${TYPES[k] ? `<span>${itemsOf(k).length}</span>` : ''}</a>`).join('')}</div></div>`).join('');
  $$('.mi>button').forEach(b => b.onclick = e => { e.stopPropagation(); const m = b.parentElement; const was = m.classList.contains('open'); $$('.mi').forEach(x => x.classList.remove('open')); if (!was) m.classList.add('open'); });
  $$('#menu a').forEach(a => a.addEventListener('click', () => { $$('.mi').forEach(x => x.classList.remove('open')); $('#menu').classList.remove('on'); }));
  const upd = $('#menu a[href="#!update"]'); if (upd) upd.addEventListener('click', e => { e.preventDefault(); manualUpdate(); });
}
document.addEventListener('click', e => { if (!e.target.closest('.mi')) $$('.mi').forEach(x => x.classList.remove('open')); });
$('#burger').onclick = () => $('#menu').classList.toggle('on');

// ---------- list pages ----------
const roleOf = m => (m.role || '').replace(/^(Minion|Horde|Platoon|Elite|Leader|Solo|Retainer)\s*/, '') || m.org;
const LIST = {
  abilities: {
    cols: [['Name', a => a.name, 'nm'], ['Source', a => a.group === 'Class' ? a.source : a.group + (a.source && a.group !== a.source ? ': ' + a.source : '')], ['Cost', a => a.cost || (a.kind || '—'), 'mu', a => a.costN ?? -1], ['Action', a => a.action, 'mu'], ['Distance', a => strip(a.distance), 'mu']],
    filters: [
      ['Group', a => a.group], ['Class', a => a.group === 'Class' ? a.source : null], ['Subclass', a => a.sub || null],
      ['Cost', a => a.costN != null ? a.costN + ' ' + (a.group === 'Class' ? 'Resource' : 'Heroic Resource') : (a.kind || 'No cost'), (x, y) => (parseInt(x) || 0) - (parseInt(y) || 0)],
      ['Resource', a => a.group === 'Class' ? a.resource : null],
      ['Level', a => a.level ? ORD(a.level) : null, (x, y) => parseInt(x) - parseInt(y)],
      ['Action', a => a.action], ['Keywords', a => a.keywords, null, true], ['Characteristic', a => a.chars, null, true]
    ],
    text: a => a.name + ' ' + a.keywords.join(' ') + ' ' + strip(a.flavor) + ' ' + a.rows.map(r => strip(r.html)).join(' '),
    view: a => `<div class="ent-h"><div style="flex:1"><h2>${esc(a.name)}</h2><div class="meta">${esc(a.group === 'Class' ? a.source + ' ability' : a.group + ' ability · ' + a.source)}</div></div>${tools('abilities', a)}</div>${renderAbility(a, {})}`
  },
  monsters: {
    idOf: m => m.gid,
    cols: [['Name', m => m.name, 'nm'], ['Level', m => 'Lv ' + m.level, 'mu', m => m.level], ['Role', m => m.role, 'mu'], ['EV', m => m.ev, 'mu', m => parseInt(m.ev) || 0], ['Group', m => m.group, 'mu']],
    filters: [
      ['Source', m => PK[m.pack]?.title], ['Level', m => 'Level ' + m.level, (x, y) => parseInt(x.slice(6)) - parseInt(y.slice(6))],
      ['Organization', m => m.org], ['Role', m => roleOf(m)], ['Keywords', m => m.keywords, null, true],
      ['Group', m => m.group], ['Dastard', m => m.dastard ? 'Dastards' : null], ['Has villain actions', m => (m.items || []).some(a => /villain/i.test(a.cost + a.action)) ? 'Yes' : 'No']
    ],
    text: m => m.name + ' ' + (m.keywords || []).join(' ') + ' ' + m.role + ' ' + (m.items || []).map(a => a.name + ' ' + a.rows.map(r => strip(r.html)).join(' ')).join(' '),
    view: m => `<div class="ent-h"><div style="flex:1"><h2>${esc(m.name)}</h2><div class="meta">Level ${m.level} ${esc(m.role)} · ${esc(m.group || '')}</div></div><div class="ent-tools"><button class="ibtn ${isPinned('monsters', m.gid) ? 'on' : ''}" data-pin="monsters--${m.gid}">★</button><button class="ibtn" data-addenc="${m.gid}" title="Add to encounter">+ Encounter</button><button class="ibtn" data-gobook="${esc(m.pack)}--${esc(m.ch || '')}">p. ${esc(m.pg)}</button></div></div>${renderMonster(m)}`
  },
  ancestries: { cols: [['Name', a => a.name, 'nm'], ['Signature Trait', a => a.signature || '', 'mu'], ['Points', a => a.points ?? '', 'mu']], filters: [['Trait cost', a => a.traits.map(t => t.cost + ' pt')]], text: a => a.name + ' ' + a.traits.map(t => t.name).join(' ') },
  cultures: { cols: [['Name', a => a.name, 'nm'], ['Aspect', a => a.aspect, 'mu'], ['Skills', a => a.skills, 'mu']], filters: [['Aspect', a => a.aspect]] },
  careers: { cols: [['Name', a => a.name, 'nm'], ['Skills', a => a.skills || '', 'mu'], ['Perk', a => a.perk || '', 'mu']], filters: [['Perk type', a => ((a.perk || '').match(/(crafting|exploration|interpersonal|intrigue|lore|supernatural)/i) || [])[1]?.replace(/^./, c => c.toUpperCase())]] },
  kits: { cols: [['Name', a => a.name, 'nm'], ['Type', a => a.kkind, 'mu'], ['Equipment', a => a.bonuses.Equipment || '', 'mu']], filters: [['Type', a => a.kkind], ['Bonuses', a => Object.keys(a.bonuses).filter(k => k !== 'Equipment'), null, true]] },
  perks: { cols: [['Name', a => a.name, 'nm'], ['Type', a => a.type, 'mu']], filters: [['Type', a => a.type]] },
  complications: { cols: [['Name', a => a.name, 'nm']], filters: [] },
  conditions: { cols: [['Name', a => a.name, 'nm']], filters: [] },
  skills: { cols: [['Name', a => a.name, 'nm'], ['Group', a => a.group, 'mu']], filters: [['Group', a => a.group]] },
  treasures: {
    cols: [['Name', a => a.name, 'nm'], ['Type', a => a.type + (a.sub ? ' (' + a.sub + ')' : ''), 'mu'], ['Echelon', a => a.echelon ? ORD(a.echelon) : '—', 'mu', a => a.echelon || 0], ['Keywords', a => a.keywords, 'mu']],
    filters: [['Type', a => a.type], ['Leveled kind', a => a.sub || null], ['Echelon', a => a.echelon ? ORD(a.echelon) : null], ['Keywords', a => (a.keywords || '').split(/,\s*/).filter(Boolean), null, true]]
  },
  titles: { cols: [['Name', a => a.name, 'nm'], ['Echelon', a => ORD(a.echelon), 'mu', a => a.echelon], ['Prerequisite', a => a.prereq, 'mu']], filters: [['Echelon', a => ORD(a.echelon)]] },
  gods: { cols: [['Name', a => a.name, 'nm'], ['Pantheon', a => a.pantheon, 'mu'], ['Domains', a => a.domains, 'mu']], filters: [['Pantheon', a => a.pantheon], ['Domain', a => (a.domains || '').split(/,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean), null, true]] },
  glossary: { cols: [['Term', a => a.name, 'nm'], ['Page', a => a.page || '', 'mu', a => +a.page || 0]], filters: [] }
};
function tools(type, e) {
  return `<div class="ent-tools"><button class="ibtn ${isPinned(type, e.id) ? 'on' : ''}" data-pin="${type}--${e.id}" title="Pin">★</button>${e.src && e.src.pg ? `<button class="ibtn" data-page="${e.src.pg}" title="Open in rulebook">p. ${esc(e.src.pg)}</button>` : ''}</div>`;
}
function entityView(type, e) {
  if (LIST[type].view) return LIST[type].view(e);
  let meta = TYPES[type].one;
  if (type === 'treasures') meta = [e.echelon ? ORD(e.echelon) + '-echelon' : '', e.type, e.sub].filter(Boolean).join(' ');
  if (type === 'titles') meta = ORD(e.echelon) + '-echelon title';
  if (type === 'perks') meta = e.type + ' perk';
  if (type === 'cultures') meta = e.aspect + ' culture aspect';
  if (type === 'skills') meta = e.group + ' skill';
  if (type === 'gods') meta = e.pantheon + (e.sub ? ' · ' + e.sub : '');
  if (type === 'kits') meta = e.kkind + ' kit';
  return `<div class="ent-h"><div style="flex:1"><h2>${esc(e.name)}</h2><div class="meta">${esc(meta)}</div></div>${tools(type, e)}</div><div class="rd">${renderBlocks(e.body)}</div>`;
}

const LSTATE = {};
let curList = null;
function listPage(type, sel) {
  const cfg = LIST[type], items = itemsOf(type), idOf = cfg.idOf || (e => e.id);
  const st = LSTATE[type] = LSTATE[type] || { q: '', f: {}, sort: null, dir: 1, open: false };
  const main = $('#main');
  main.innerHTML = `<div class="lp"><div class="lp-left"><div class="lp-head"><h1>${TYPES[type].label}<small id="lcount"></small></h1>
    <div class="frow"><input id="lq" type="search" placeholder="Filter ${TYPES[type].label.toLowerCase()}…" value="${esc(st.q)}">${cfg.filters.length ? `<button class="fbtn ${!isMob && st.open ? 'on' : ''}" id="lfb">Filters<span id="fcount"></span></button>` : ''}<button class="fbtn" id="lreset" title="Reset">Reset</button></div>
    <div class="chips" id="lchips"></div></div><div class="filters ${!isMob && st.open ? 'on' : ''}" id="lfilters"></div>
    <div class="ltable"><table class="list"><thead><tr>${cfg.cols.map((c, i) => `<th data-c="${i}">${c[0]}</th>`).join('')}</tr></thead><tbody id="lbody"></tbody></table></div></div>
    <div class="lp-right" id="lview"><div class="empty">Select an entry from the list.</div></div></div>`;
  const groups = cfg.filters.map(([name, fn, cmp]) => {
    const vals = uniq(items.flatMap(e => { const v = fn(e); return Array.isArray(v) ? v : [v]; }));
    vals.sort(cmp || ((a, b) => String(a).localeCompare(String(b))));
    return { name, fn, vals };
  });
  const fwrap = $('#lfilters');
  fwrap.innerHTML = `<div class="shead"><b>Filters</b><button class="btn" id="fdone">Show results</button></div>` + groups.map((g, gi) => `<div class="fg"><div class="fg-h">${esc(g.name)}<button data-all="${gi}">clear</button></div><div class="pills">${g.vals.map(v => {
    const s = (st.f[g.name] || {})[v]; return `<span class="pill ${s === 1 ? 'inc' : s === -1 ? 'exc' : ''}" data-g="${gi}" data-v="${esc(v)}">${esc(v)}</span>`;
  }).join('')}</div></div>`).join('');
  fwrap.onclick = e => {
    const p = e.target.closest('.pill');
    if (p) {
      const g = groups[p.dataset.g]; const m = st.f[g.name] = st.f[g.name] || {}; const v = p.dataset.v;
      m[v] = m[v] === 1 ? -1 : m[v] === -1 ? 0 : 1; if (!m[v]) delete m[v];
      p.className = 'pill ' + (m[v] === 1 ? 'inc' : m[v] === -1 ? 'exc' : ''); refresh(); return;
    }
    const c = e.target.closest('[data-all]'); if (c) { delete st.f[groups[c.dataset.all].name]; $$(`.pill[data-g="${c.dataset.all}"]`, fwrap).forEach(p => p.className = 'pill'); refresh(); }
    if (e.target.closest('#fdone')) closeFilters();
  };
  const openFilters = () => { fwrap.classList.add('on'); if (isMob) showScrim(closeFilters); };
  const closeFilters = () => { fwrap.classList.remove('on'); hideScrim(); };
  if ($('#lfb')) $('#lfb').onclick = () => {
    if (isMob) { fwrap.classList.contains('on') ? closeFilters() : openFilters(); return; }
    st.open = !st.open; fwrap.classList.toggle('on', st.open); $('#lfb').classList.toggle('on', st.open);
  };
  $('#lreset').onclick = () => { LSTATE[type] = null; listPage(type, curSel()); };
  const textOf = cfg.text ? (e => (e._t = e._t || cfg.text(e).toLowerCase())) : (e => (e._t = e._t || (e.name + ' ' + (e.body || []).map(b => strip(b.html || b.text || '')).join(' ')).toLowerCase()));
  const curSel = () => (location.hash.split('--')[1] || null);
  function refresh() {
    const toks = st.q.toLowerCase().split(/\s+/).filter(Boolean);
    let rows = items.filter(e => {
      for (const g of groups) {
        const m = st.f[g.name]; if (!m) continue;
        const v = g.fn(e); const arr = Array.isArray(v) ? v : [v];
        const inc = Object.keys(m).filter(k => m[k] === 1), exc = Object.keys(m).filter(k => m[k] === -1);
        if (inc.length && !arr.some(x => inc.includes(String(x)))) return false;
        if (exc.length && arr.some(x => exc.includes(String(x)))) return false;
      }
      if (toks.length) { const nm = e.name.toLowerCase(); if (!toks.every(t => nm.includes(t) || textOf(e).includes(t))) return false; }
      return true;
    });
    if (toks.length) { const t0 = toks.join(' '); rows.sort((a, b) => (b.name.toLowerCase().includes(t0)) - (a.name.toLowerCase().includes(t0))); }
    if (st.sort != null) {
      const c = cfg.cols[st.sort]; const k = c[3] || c[1];
      rows = rows.slice().sort((a, b) => { const x = k(a), y = k(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * st.dir; });
    }
    const s = curSel();
    const lim = rows.length > 700 ? 700 : rows.length;
    $('#lbody').innerHTML = rows.slice(0, lim).map(e => `<tr class="r ${idOf(e) === s ? 'sel' : ''}" data-id="${idOf(e)}">${cfg.cols.map(c => `<td class="${c[2] || ''}">${esc(c[1](e))}</td>`).join('')}</tr>`).join('') + (rows.length > lim ? `<tr><td colspan="9" class="empty">${rows.length - lim} more — refine your filter.</td></tr>` : '') || `<tr><td colspan="9" class="empty">No matches.</td></tr>`;
    if (!rows.length) $('#lbody').innerHTML = `<tr><td colspan="9" class="empty">No matches.</td></tr>`;
    $('#lcount').textContent = rows.length + ' / ' + items.length;
    $$('th', main).forEach(th => th.className = +th.dataset.c === st.sort ? (st.dir > 0 ? 's-asc' : 's-desc') : '');
    const chips = []; let nf = 0;
    for (const g of groups) { const m = st.f[g.name] || {}; for (const k in m) { nf++; chips.push(`<span class="chip ${m[k] > 0 ? 'inc' : 'exc'}" data-cg="${esc(g.name)}" data-cv="${esc(k)}">${esc(g.name)}: ${m[k] < 0 ? 'not ' : ''}${esc(k)} ×</span>`); } }
    $('#lchips').innerHTML = chips.join('');
    if ($('#fcount')) $('#fcount').textContent = nf ? ` (${nf})` : '';
    if ($('#fdone')) $('#fdone').textContent = `Show ${rows.length} result${rows.length === 1 ? '' : 's'}`;
  }
  $('#lchips').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; delete st.f[c.dataset.cg][c.dataset.cv]; listPage(type, curSel()); };
  $('#lq').oninput = e => { st.q = e.target.value; refresh(); };
  $$('th', main).forEach(th => th.onclick = () => { const c = +th.dataset.c; if (st.sort === c) st.dir *= -1; else { st.sort = c; st.dir = 1; } refresh(); });
  $('#lbody').onclick = e => { const tr = e.target.closest('tr.r'); if (tr) go(type + '--' + tr.dataset.id); };
  refresh();
  curList = type;
  showEntity(type, sel);
}
function showEntity(type, id) {
  const e = BYID[type][id], v = $('#lview'); if (!v) return;
  $$('#lbody tr.r').forEach(tr => tr.classList.toggle('sel', tr.dataset.id === id));
  $('.lp').classList.toggle('detail', !!e);
  if (!e) { v.innerHTML = '<div class="empty">Select an entry from the list.</div>'; document.title = TYPES[type].label + ' — Vanadium'; return; }
  v.innerHTML = `<div class="backbar"><button data-back="${type}">${ICON.back}${esc(TYPES[type].label)}</button><span class="sp"></span></div>` + entityView(type, e) +
    (type === 'monsters' ? '' : `<div class="src">${esc(TYPES[type].one)} · <i>Draw Steel: Heroes</i>${e.src && e.src.pg ? `, <a data-page="${e.src.pg}">page ${esc(e.src.pg)}</a>` : ''}</div>`);
  v.scrollTop = 0; enhance(v);
  const tr = $(`#lbody tr[data-id="${CSS.escape(id)}"]`);
  if (tr && !isMob) { const box = tr.closest('.ltable'); const r = tr.getBoundingClientRect(), b = box.getBoundingClientRect(); if (r.top < b.top + 28 || r.bottom > b.bottom) tr.scrollIntoView({ block: 'center' }); }
  document.title = e.name + ' — Vanadium';
}

// ---------- class pages ----------
let clsTab = 'features', clsSub = null;
function classPage(id) {
  const c = BYID.classes[id] || D.classes[0];
  const abs = D.abilities.filter(a => a.source === c.name && a.group === 'Class');
  const subs = uniq(abs.map(a => a.sub));
  const heads = c.body.filter(b => b.t === 'h' && b.lvl === 2);
  $('#main').innerHTML = `<div class="cls"><div class="mchips">${D.classes.map(x => `<a class="${x.id === c.id ? 'cur' : ''}" href="#classes--${x.id}">${esc(x.name)}</a>`).join('')}</div><div class="cls-nav">${D.classes.map(x => `<a class="cn ${x.id === c.id ? 'cur' : ''}" href="#classes--${x.id}">${esc(x.name)}</a>${x.id === c.id ? `<div class="sub">${heads.map(b => `<a data-jump="h-${b.id}">${esc(b.text)}</a>`).join('')}</div>` : ''}`).join('')}</div>
   <div class="cls-main" id="cmain"><div class="cls-head"><h1>${esc(c.name)}</h1><div class="stats">
     <div class="stat">Heroic Resource<b>${esc(c.resource || '—')}</b></div><div class="stat">Starting Stamina<b>${esc(c.stamina || '—')}</b></div><div class="stat">Abilities<b>${abs.length}</b></div></div>
     <div class="ent-tools"><button class="ibtn" data-page="${c.src.pg}">p. ${esc(c.src.pg)}</button></div></div>
     <div class="tabs"><button class="tab ${clsTab === 'features' ? 'on' : ''}" data-tab="features">Features</button><button class="tab ${clsTab === 'abilities' ? 'on' : ''}" data-tab="abilities">Abilities (${abs.length})</button></div>
     <div id="ctab"></div></div></div>`;
  const cur = $('.mchips a.cur'); if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
  const draw = () => {
    const box = $('#ctab');
    if (clsTab === 'features') box.innerHTML = `<div class="rd" style="max-width:900px">${renderBlocks(c.body, { sidebars: true })}</div>`;
    else {
      const list = abs.filter(a => !clsSub || a.sub === clsSub || !a.sub);
      const groups = {};
      list.forEach(a => { const k = a.cost ? a.costN + '-' + a.resource + ' abilities' : (a.kind === 'Signature' ? 'Signature abilities' : 'Feature abilities'); (groups[k] = groups[k] || []).push(a); });
      const keys = Object.keys(groups).sort((x, y) => (x.startsWith('Sig') ? -2 : x.startsWith('Fea') ? -1 : parseInt(x)) - (y.startsWith('Sig') ? -2 : y.startsWith('Fea') ? -1 : parseInt(y)));
      box.innerHTML = (subs.length ? `<div class="subsel"><b style="font-family:var(--cond);text-transform:uppercase">Subclass:</b><span class="pill ${!clsSub ? 'inc' : ''}" data-sub="">All</span>${subs.map(s => `<span class="pill ${clsSub === s ? 'inc' : ''}" data-sub="${esc(s)}">${esc(s)}</span>`).join('')}</div>` : '') +
        `<div class="abgrid">${keys.map(k => `<div class="abgh">${esc(k)}</div>` + groups[k].map(a => renderAbility(a)).join('')).join('')}</div>`;
      $$('[data-sub]', box).forEach(p => p.onclick = () => { clsSub = p.dataset.sub || null; draw(); });
    }
    enhance(box);
  };
  $$('.tab').forEach(t => t.onclick = () => { clsTab = t.dataset.tab; $$('.tab').forEach(x => x.classList.toggle('on', x === t)); draw(); });
  $$('[data-jump]').forEach(a => a.onclick = () => { if (clsTab !== 'features') { clsTab = 'features'; $$('.tab').forEach(x => x.classList.toggle('on', x.dataset.tab === 'features')); draw(); } const el = document.getElementById(a.dataset.jump); if (el) el.scrollIntoView({ behavior: 'smooth' }); });
  draw();
  document.title = c.name + ' — Vanadium';
}
function classIndex() {
  $('#main').innerHTML = `<div class="home"><div class="grid" style="padding-top:20px"><div class="gsec">Classes</div>${D.classes.map(c => `<a class="tile" href="#classes--${c.id}"><b>${esc(c.name)}</b><span>${esc(strip(c.body.find(b => b.t === 'p')?.html || '').slice(0, 150))}…</span><em>${esc(c.resource || '')} · ${c.abilityCount} abilities</em></a>`).join('')}</div></div>`;
}

// ---------- book reader (any pack) ----------
function bookPage(packId, ch, anchor) {
  let pack = PK[packId];
  if (!pack) { // legacy: #book--<heroes chapter>
    if (CHAP[packId]) { anchor = ch; ch = packId; pack = PK.heroes; }
    else if (!PACKS.length || BUILTIN.some(b => b.id === packId)) { $('#main').innerHTML = '<div class="empty">Loading…</div>'; return; }
    else pack = PK.heroes;
  }
  const chs = pack.chapters.filter(c => c.blocks.length || c === pack.chapters[0]);
  let c = chs.find(x => x.id === ch) || chs.find(x => x.id !== 'front' && x.blocks.length > 5) || chs[0];
  const ci = chs.indexOf(c);
  const pid = pack.heroes ? null : pack.id;
  const bookSel = `<div class="bk-books"><select id="booksel">${PACKS.map(p => `<option value="${p.id}" ${p.id === pack.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></div>`;
  const cap = t => t.replace(/^[a-z]/, x => x.toUpperCase());
  const parts = pack.chapters.filter(x => x.isPart);
  const curPart = c.isPart ? c.title : c.part;
  const nav = parts.length ? pack.chapters.map(x => {
    if (x.isPart) { const kids = chs.filter(k => k.part === x.title); const tgt = x.blocks.length ? x : kids[0]; if (!tgt) return ''; return `<a class="part ${curPart === x.title ? 'open' : ''}" href="#book--${pack.id}--${tgt.id}">${esc(x.title)}<span>${kids.length}</span></a>`; }
    if (!chs.includes(x) || (x.part && x.part !== curPart && parts.some(q => q.title === x.part))) return '';
    let s = `<a class="ch ${x.part ? 'sub' : ''} ${x.id === c.id ? 'cur' : ''}" href="#book--${pack.id}--${x.id}">${esc(cap(x.title))}</a>`;
    if (x.id === c.id) s += x.blocks.filter(b => b.t === 'h' && b.lvl >= 1 && b.lvl <= 3).map(b => `<a class="l${b.lvl} ${x.part ? 'sub' : ''}" data-jump="h-${b.id}">${esc(b.text)}</a>`).join('');
    return s;
  }).join('') : chs.map(x => {
    let s = `<a class="ch ${x.id === c.id ? 'cur' : ''}" href="#book--${pack.id}--${x.id}">${esc(x.title)}</a>`;
    if (x.id === c.id) s += x.blocks.filter(b => b.t === 'h' && b.lvl >= 1 && b.lvl <= 3).map(b => `<a class="l${b.lvl}" data-jump="h-${b.id}">${esc(b.text)}</a>`).join('');
    return s;
  }).join('');
  const prev = chs[ci - 1], next = chs[ci + 1];
  $('#main').innerHTML = `<div class="bk" data-pack="${pack.id}"><div class="bk-nav" id="bnav">${bookSel}${nav}</div><div class="bk-main" id="bmain">${c.part ? `<div class="chap-part">${esc(c.part)}</div>` : ''}<h1 class="chap-title">${esc(c.title.replace(/^[a-z]/, x => x.toUpperCase()))}</h1>${MTBYHEAD[pack.id + ':' + c.id + ':_'] ? `<a class="btn negrunbtn" href="#montage--${MTBYHEAD[pack.id + ':' + c.id + ':_']}">▶ Run this montage test</a>` : ''}<div class="rd">${renderBlocks(c.blocks, { book: true, pack: pid, ch: c.id, packId: pack.id })}</div>
    <div class="bk-pager">${prev ? `<a class="ibtn" href="#book--${pack.id}--${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="ibtn" href="#book--${pack.id}--${next.id}">${esc(next.title)} →</a>` : ''}</div></div>
    <button class="mtoc-btn" id="mtoc"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Contents</button></div>`;
  const bm = $('#bmain'); enhance(bm);
  $('#booksel').onchange = e => go('book--' + e.target.value);
  const nv = $('#bnav');
  $('#mtoc').onclick = () => { nv.classList.add('on'); showScrim(() => nv.classList.remove('on')); };
  $$('#bnav a').forEach(a => a.addEventListener('click', () => { if (isMob) { nv.classList.remove('on'); hideScrim(); } }));
  $$('#bnav [data-jump]').forEach(a => a.onclick = () => { const el = document.getElementById(a.dataset.jump); if (el) el.scrollIntoView({ behavior: isMob ? 'auto' : 'smooth' }); });
  const cn = $('#bnav .ch.cur'); if (cn && !isMob) cn.scrollIntoView({ block: 'start' });
  if (anchor) {
    let el = null;
    if (/^p\d/.test(anchor)) { const pg = anchor.slice(1); el = pack.heroes && PAGE[pg] ? bm.querySelector(`[data-bi="${PAGE[pg].i}"]`) : bm.querySelector(`#pg-${CSS.escape(pg)}`)?.parentElement; }
    else el = document.getElementById('h-' + anchor);
    if (el) { el.scrollIntoView(); el.style.transition = 'background 1.5s'; el.style.background = 'rgba(224,112,58,.25)'; setTimeout(() => el.style.background = '', 1600); }
  } else bm.scrollTop = 0;
  document.title = c.title + ' — ' + pack.title;
}
function gotoPage(pg) { const p = PAGE[pg]; if (p) go('book--heroes--' + p.ch + '--p' + pg); else toast('Page ' + pg + ' not found'); }

// ---------- library ----------
function libraryPage() {
  const card = p => {
    const nm = (p.monsters || []).length, nch = p.chapters.filter(c => c.blocks.length).length;
    return `<div class="bookc k-${p.kind}"><div class="kind">${esc(KIND[p.kind] || p.kind)}${p.builtin ? '' : ' · Imported'}</div><b>${esc(p.title)}</b>
      <div class="cnt">${nch} chapters${nm ? ' · ' + nm + ' monsters' : ''}${p.heroes ? ' · ' + D.abilities.length + ' abilities' : ''}</div>
      <div class="acts"><a class="btn" href="#book--${p.id}">Read</a>${nm ? `<a class="btn ghost" href="#monsters" data-srcfilter="${esc(p.title)}">Monsters</a>` : ''}${p.builtin ? '' : `<button class="btn danger" data-delpack="${p.id}">Remove</button>`}</div></div>`;
  };
  $('#main').innerHTML = `<div class="lib"><h1>Library</h1><p class="note">Every book in Vanadium. ${window.VSync && VSync.status().enabled ? 'Imported PDFs are synced to your other devices.' : 'Imported PDFs live only in this browser (<a href="#sync">sync them across devices</a>).'}</p>
    <div class="books">${PACKS.map(card).join('')}<a class="bookc" href="#import" style="text-decoration:none;color:var(--ink);border-style:dashed;align-items:flex-start;justify-content:center"><div class="kind">Add content</div><b>Import a PDF →</b><div class="cnt">Adventures, bestiaries, supplements</div></a></div></div>`;
  document.title = 'Library — Vanadium';
}

// ---------- importer ----------
let pdfjsLib = null;
async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('./lib/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', location.href).href;
  return pdfjsLib;
}
let pending = null;
function importPage() {
  const mine = PACKS.filter(p => !p.builtin);
  $('#main').innerHTML = `<div class="imp"><h1>Import a PDF</h1>
    <p class="note">Add an adventure, bestiary or supplement from a Draw Steel PDF. Vanadium reads the text layout and pulls out chapters, headings, tables, read-aloud text, monster stat blocks and abilities. <b>The file stays on this device</b>: it is processed in your browser and saved to this browser's storage.</p>
    <label class="drop" id="drop"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/></svg><b>Drop a PDF here or tap to choose</b><span>Works best with MCDM-format Draw Steel PDFs that contain selectable text</span><input type="file" id="pdffile" accept="application/pdf,.pdf"></label><label class="row-c" style="margin-top:10px"><input type="checkbox" id="imp-imgs" checked> Keep the pictures and maps (stored in this browser)</label>
    <div class="stage" id="stage"></div>
    <div class="mine"><h2>Your imports</h2>${mine.length ? mine.map(p => `<div class="it"><div class="t"><b>${esc(p.title)}</b><span>${esc(KIND[p.kind] || p.kind)} · ${p.chapters.length} chapters · ${(p.monsters || []).length} monsters · imported ${esc((p.importedAt || '').slice(0, 10))}</span></div><a class="btn ghost" href="#book--${p.id}">Read</a><button class="btn danger" data-delpack="${p.id}">Remove</button></div>`).join('') : '<div class="note">Nothing imported yet.</div>'}</div></div>`;
  const drop = $('#drop'), inp = $('#pdffile');
  inp.onchange = () => inp.files[0] && handleFile(inp.files[0]);
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  document.title = 'Import — Vanadium';
}
async function handleFile(file) {
  const stage = $('#stage');
  if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') { stage.innerHTML = `<div class="warn">That doesn't look like a PDF.</div>`; return; }
  stage.innerHTML = `<div class="progt" id="pt">Opening ${esc(file.name)}…</div><div class="prog"><div id="pb"></div></div>`;
  const setP = (t, f) => { const pt = $('#pt'), pb = $('#pb'); if (pt) pt.textContent = t; if (pb) pb.style.width = Math.round(f * 100) + '%'; };
  try {
    const lib = await loadPdfjs();
    const { extractPages, parsePack } = await import('./lib/dsparse.mjs');
    const buf = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data: buf, fontExtraProperties: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
    let title = file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\bv\d+(\.\d+)*\b/i, '').replace(/^\w{6,10}-/, '').trim();
    try { const md = await doc.getMetadata(); if (md?.info?.Title && md.info.Title.length > 3) title = md.info.Title; } catch (e) { }
    let nImg = 0;
    const encode = async obj => {
      try {
        const W = obj.width, H = obj.height; const sc = Math.min(1, 1300 / Math.max(W, H));
        const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(W * sc)); cv.height = Math.max(1, Math.round(H * sc));
        const cx = cv.getContext('2d');
        if (obj.bitmap) cx.drawImage(obj.bitmap, 0, 0, cv.width, cv.height);
        else if (obj.data) {
          const id = new ImageData(W, H), d = id.data, src = obj.data;
          if (obj.kind === 3) d.set(src.subarray(0, W * H * 4));
          else if (obj.kind === 2) for (let q = 0, o = 0; q < W * H; q++) { d[o++] = src[q * 3]; d[o++] = src[q * 3 + 1]; d[o++] = src[q * 3 + 2]; d[o++] = 255; }
          else { const rowB = Math.ceil(W / 8); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = (src[y * rowB + (x >> 3)] >> (7 - (x & 7)) & 1) ? 255 : 0; const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; } }
          const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tmp.getContext('2d').putImageData(id, 0, 0);
          cx.drawImage(tmp, 0, 0, cv.width, cv.height);
        } else return null;
        let url = cv.toDataURL('image/webp', 0.72);
        if (!/^data:image\/webp/.test(url)) url = cv.toDataURL('image/jpeg', 0.8);
        nImg++; return url;
      } catch (e) { console.warn('image', e); return null; }
    };
    const withImgs = $('#imp-imgs') ? $('#imp-imgs').checked : true;
    const pages = await extractPages(doc, (n, t) => setP(`Reading page ${n} of ${t}…${nImg ? ` (${nImg} images)` : ''}`, n / t * 0.92), withImgs ? { images: { OPS: lib.OPS, encode } } : {});
    const chars = pages.reduce((s, p) => s + p.items.reduce((a, i) => a + i.s.length, 0), 0);
    if (chars < 200) { stage.innerHTML = `<div class="warn">This PDF has almost no selectable text — it is probably scanned images. Vanadium can only import PDFs with real text.</div>`; return; }
    setP('Analysing layout…', 0.95);
    await new Promise(r => setTimeout(r, 30));
    const pack = parsePack(pages, { title, id: 'imp-' + slug(title).slice(0, 40) + '-' + Date.now().toString(36) });
    try { (doc.destroy || doc.cleanup || (() => {})).call(doc); } catch (e) { }
    const nm = pack.monsters.length;
    pack.kind = nm >= 40 ? 'bestiary' : (pack.chapters.some(c => /chapter|act|part/i.test(c.title)) && nm > 0) || /adventure/i.test(title) ? 'adventure' : 'supplement';
    pack.importedAt = new Date().toISOString(); pack.fileName = file.name;
    pending = pack;
    showPreview();
  } catch (e) {
    console.error(e);
    stage.innerHTML = `<div class="warn">Import failed: ${esc(e.message || e)}. If the PDF is password-protected or damaged, try another copy.</div>`;
  }
}
function showPreview() {
  const p = pending, stage = $('#stage');
  const nch = p.chapters.filter(c => c.blocks.length);
  const nh = p.chapters.reduce((s, c) => s + c.blocks.filter(b => b.t === 'h').length, 0);
  const nt = p.chapters.reduce((s, c) => s + c.blocks.filter(b => b.t === 'table').length, 0);
  stage.innerHTML = `<div class="pv"><div class="row"><label>Title<input id="pvtitle" value="${esc(p.title)}"></label><label style="max-width:220px">Type<select id="pvkind">${['adventure', 'bestiary', 'supplement', 'book'].map(k => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${KIND[k]}</option>`).join('')}</select></label></div>
    <div class="pvstats"><div class="stat">Pages<b>${p.stats.pages}</b></div><div class="stat">Chapters<b>${nch.length}</b></div><div class="stat">Headings<b>${nh}</b></div><div class="stat">Tables<b>${nt}</b></div><div class="stat">Monsters<b>${p.monsters.length}</b></div><div class="stat">Images<b>${(p.images || []).length}</b></div><div class="stat">Negotiations<b>${extractNegotiations(p).length}</b></div><div class="stat">Montages<b>${extractMontages(p).length}</b></div><div class="stat">Encounter tables<b>${p.chapters.reduce((s, c) => s + c.blocks.filter(b => b.t === 'table' && /^Group/i.test(b.head[0] || '') && /Creature/i.test(b.head[1] || '')).length, 0)}</b></div><div class="stat">Dastards<b>${(() => { const ids = new Set(p.chapters.filter(c => /dastard/i.test(c.part || '')).map(c => c.id)); return p.monsters.filter(m => ids.has(m.ch)).length; })()}</b></div><div class="stat">Abilities<b>${p.abilities.length + p.monsters.reduce((s, m) => s + m.items.length, 0)}</b></div></div>
    ${!nch.length || nh < 3 ? `<div class="warn">Very little structure was found. The text will still be readable, but headings may be missing.</div>` : `<div class="okb">Looks good. Review the chapters and monsters below, then add it to your library.</div>`}
    <div class="pvlist">${nch.map(c => `<div>${esc(c.title)}<span>${c.blocks.length} blocks</span></div>`).join('')}</div>
    ${p.monsters.length ? `<div class="pvlist">${p.monsters.slice(0, 200).map(m => `<div>${esc(m.name)}<span>Level ${m.level} ${esc(m.role)}${m.ev ? ' · EV ' + esc(m.ev) : ''}</span></div>`).join('')}</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pvsave">Add to library</button><button class="btn ghost" id="pvcancel">Discard</button></div></div>`;
  $('#pvcancel').onclick = () => { pending = null; stage.innerHTML = ''; };
  $('#pvsave').onclick = async () => {
    p.title = $('#pvtitle').value.trim() || p.title; p.kind = $('#pvkind').value;
    const btn = $('#pvsave'); btn.disabled = true; btn.textContent = 'Saving…';
    const clean = JSON.parse(JSON.stringify(p, (k, v) => (k === 'monMap' || k === 'gid' || k === 'pack' || k === '_t') ? undefined : v));
    let persisted = true;
    try { await IDB.put(clean); } catch (e) { persisted = false; memPacks.push(clean); }
    addPack(clean); buildIndex(); buildMenu(); pending = null;
    if (persisted && window.VSync) VSync.packsChanged();  // uploads it if sync is on
    toast(persisted ? 'Added to your library' : 'Added for this session (browser storage unavailable)');
    go('book--' + clean.id);
  };
}
async function deletePack(id) {
  const p = PK[id]; if (!p || p.builtin) return;
  const synced = window.VSync && VSync.status().enabled;
  const ok = await confirmSheet(synced ? `Remove “${p.title}” from all your synced devices? You can import it again later.` : `Remove “${p.title}” from this browser? You can import it again later.`, 'Remove');
  if (!ok) return;
  try { await IDB.del(id); } catch (e) { }
  if (window.VSync) VSync.packDeleted(id);
  removePack(id); buildIndex(); buildMenu();
  pins = pins.filter(k => !k.startsWith('monsters--') || MON[k.split('--')[1]]); store.set('pins', pins); updatePins();
  toast('Removed'); route();
}
function confirmSheet(msg, okLabel) {
  return new Promise(res => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    el.innerHTML = `<div style="background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:18px;max-width:420px;width:100%"><div style="margin-bottom:14px">${esc(msg)}</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" data-r="0">Cancel</button><button class="btn" data-r="1">${esc(okLabel)}</button></div></div>`;
    el.onclick = e => { const b = e.target.closest('[data-r]'); if (b || e.target === el) { el.remove(); res(b && b.dataset.r === '1'); } };
    document.body.appendChild(el);
  });
}

// ---------- respite (embedded tool) ----------
window.__stSave = (name, blob) => deliverFile(name, blob);
window.__stGotoPage = pg => gotoPage(String(pg));
function respitePage() {
  $('#main').innerHTML = `<div class="resp"><div class="resp-bar"><b>Respite &amp; Downtime</b><span class="sp"></span><span class="rlinks">Rules: <a href="#book--heroes--the-basics--respite">Respite</a> · <a href="#book--heroes--downtime-projects">Downtime projects</a> · <a href="#book--heroes--rewards--renown">Renown &amp; followers</a></span></div><iframe id="respframe" src="respite.html" title="Respite: a Draw Steel downtime companion"></iframe></div>`;
  document.title = 'Respite — Vanadium';
}

// ---------- home ----------
const ICO = {
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/>',
  timer: '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
  chat: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  tent: '<path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  cards: '<rect x="3" y="4" width="13" height="17" rx="2"/><path d="M8 4V3a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-1"/>',
  skull: '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="m12.5 17-.5-1-.5 1h1z"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/>'
};
const ico = (k, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICO[k] || ''}</svg>`;
function home() {
  const adv = PACKS.filter(p => p.kind === 'adventure');
  const feats = [['sessions', 'Sessions', 'Prep folders for your game night', 'folder', 'acc'], ['encounter', 'Encounter Builder', 'Pick monsters, see difficulty', 'swords', 'steel'], ['montage', 'Montage Tests', 'Run multi-skill challenges', 'timer', 'gold'], ['negotiation', 'Negotiation', 'Track arguments and patience', 'chat', 'moss'], ['respite', 'Respite & Downtime', 'Rest and roll downtime projects', 'tent', 'acc']];
  const tiles = [
    ['Rules', [['book--heroes', 'Heroes Rulebook', 'All chapters of the Heroes book, fully searchable'], ['conditions'], ['glossary'], ['skills']]],
    ['Build a hero', [['classes'], ['ancestries'], ['cultures'], ['careers'], ['kits'], ['perks'], ['complications'], ['abilities']]],
    ['Bestiary & adventures', [['monsters'], ...adv.map(p => ['book--' + p.id, p.title, 'Adventure' + (p.builtin ? '' : ' · imported')]), ['library', 'Library', 'All books, including your imports'], ['import', 'Import a PDF', 'Add adventures, bestiaries and supplements']]],
    ['Rewards & world', [['treasures'], ['cards', 'Cards', 'Print item, quest and follower cards'], ['titles'], ['gods'], ['pinned', 'Pinned items', 'Your starred abilities, monsters and rules']]]
  ];
  const blurb = { abilities: 'Every class, kit, ancestry and treasure ability with power-roll tiers', classes: 'Nine classes with features by level and full ability lists', ancestries: 'Traits, signature abilities and point buys', cultures: 'Environment, organization and upbringing aspects', careers: 'Skills, perks and inciting incidents', kits: 'Equipment, bonuses and signature abilities', perks: 'Crafting, exploration, interpersonal, intrigue, lore, supernatural', complications: 'Benefits and drawbacks for your backstory', conditions: 'Bleeding, dazed, grabbed, and the rest', glossary: 'Every game term defined at a glance', skills: 'Skill groups and how each skill is used', treasures: 'Consumables, trinkets, leveled treasures, artifacts', titles: 'Titles across all four echelons', gods: 'Deities and saints of Orden', monsters: 'Stat blocks with roll buttons, filters by level, role and keyword' };
  const ok = k => TYPES[k] || !k.startsWith('book--') || PK[k.split('--')[1]];
  $('#main').innerHTML = `<div class="home"><div class="hero"><h1>Draw Steel, at your fingertips</h1><p>A fast, searchable reference for rules, heroes, monsters and adventures.</p>
    <div class="hsearch">${ico('search', 20)}<input id="hq" placeholder="Search abilities, monsters, rules…" ${isMob ? 'readonly' : ''}><kbd>/</kbd></div>
    <div class="hchips">${[['abilities', 'Abilities'], ['monsters', 'Monsters'], ['book--heroes', 'Rules'], ['treasures', 'Treasures']].map(([k, l]) => `<a href="#${k}">${l}</a>`).join('')}</div></div>
    <div class="hwrap"><div class="gsec">Run the game</div><div class="feats">${feats.map(([k, l, d, ic, c]) => `<a class="feat" href="#${k}"><span class="fi fi-${c}">${ico(ic, 20)}</span><b>${l}</b><span>${d}</span></a>`).join('')}</div>
    ${tiles.map(([sec, ts]) => `<div class="gsec">${sec}</div><div class="grid">` + ts.filter(([k]) => ok(k)).map(([k, l, d]) => `<a class="tile" href="#${k}"><b>${esc(l || TYPES[k].label)}</b><span>${esc(d || blurb[k] || '')}</span>${TYPES[k] ? `<em>${itemsOf(k).length} entries</em>` : ''}</a>`).join('') + '</div>').join('')}</div></div>`;
  const hq = $('#hq');
  if (isMob) hq.onclick = openMSearch;
  else { hq.oninput = () => { $('#q').value = hq.value; doSearch(hq.value, hq); }; hq.onkeydown = e => searchKeys(e); hq.focus({ preventScroll: true }); }
  document.title = 'Vanadium — Draw Steel Reference';
}

// ---------- pinned ----------
// ---------- sync across devices (sync.js + sync.php) ----------
let syncShowKey = false, syncSub = null;
function syncPage() {
  document.title = 'Sync — Vanadium';
  const V = window.VSync, box = h => `<div class="lib syncp"><h1>Sync across devices</h1>${h}</div>`;
  if (!V) { $('#main').innerHTML = box('<p class="note">Sync isn’t available in this copy of Vanadium.</p>'); return; }
  if (!syncSub) syncSub = V.onChange(() => { if (/^#sync/.test(location.hash) && !document.activeElement.closest('.syncp input')) syncPage(); });
  const s = V.status(), link = location.hash.match(/^#sync--connect--([A-Za-z0-9_-]{43})$/);
  const ago = t => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
  const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  const what = '<p class="note">Keeps your sessions, encounters, montages, negotiations, cards, pins, characters, Respite heroes, settings and imported books the same on every device and browser you use. Your data is stored on this site’s server under a private sync key. Anyone with the key can see and change everything, so keep it to yourself.</p>';
  const err = s.error ? `<div class="warn">${esc(s.error)}${/Unknown sync key/.test(s.error) ? ' The key may have been replaced on another device. Turn sync off here and connect again with the new key.' : ''}</div>` : '';
  let h;
  if (!s.https) h = what + '<div class="warn">Sync needs a secure (https://) connection, so your key is never sent unencrypted. Open this site with https:// to use it.</div>';
  else if (link && !s.enabled) h = what + `<div class="synccard"><h2>Connect this device?</h2><p>This device will join the sync key from the link you opened. Where both this device and the synced copy have the same thing (for example your card list), the <b>synced copy wins</b>. Imported books from both are kept.</p>
      <div class="row"><button class="btn" id="sylink">Connect this device</button><a class="btn ghost" href="#sync">Cancel</a></div></div>`;
  else if (!s.enabled) h = what + err + `<div class="synccards"><div class="synccard"><h2>Start syncing</h2><p>Creates a new sync key and uploads everything from this device, including imported books. Do this on your main device.</p><button class="btn" id="sycreate">Turn on sync</button></div>
      <div class="synccard"><h2>Connect a device</h2><p>Already syncing somewhere else? Paste the key from Sync on that device, or open its setup link on this one. Where both have the same thing, the synced copy wins.</p><div class="row"><input id="sykey" placeholder="Sync key" autocomplete="off" spellcheck="false"><button class="btn" id="syconn">Connect</button></div></div></div>`;
  else {
    const st = s.status === 'syncing' ? 'Syncing…' : s.status === 'error' ? 'Sync problem' : 'Up to date';
    const p = s.progress, url = location.origin + location.pathname + '#sync--connect--' + s.key;
    h = `<div class="synccard"><h2><span class="sydot ${s.status}"></span>${st}</h2>${err}
        <p>Last synced ${ago(s.last)}${s.pending ? ` · ${s.pending} change${s.pending > 1 ? 's' : ''} waiting` : ''}${s.books != null ? ` · ${s.books} imported book${s.books === 1 ? '' : 's'} synced` : ''}${s.info ? ` · ${mb(s.info.usage)} of ${mb(s.info.quota)} used` : ''}</p>
        ${p ? `<div class="syprog"><div>${esc(p.label)} ${p.total > 1 ? `(${p.done}/${p.total} MB)` : ''}</div><progress max="${p.total}" value="${p.done}"></progress></div>` : ''}
        <div class="row"><button class="btn" id="synow" ${s.status === 'syncing' ? 'disabled' : ''}>Sync now</button></div></div>
      <div class="synccard"><h2>Your sync key</h2><p>Use it to connect your other devices. The setup link is easiest on a phone: send it to yourself and open it there. Don’t share either with your players.</p>
        <div class="row"><code class="sykey">${syncShowKey ? esc(s.key) : '•'.repeat(24)}</code><button class="btn ghost" id="syshow">${syncShowKey ? 'Hide' : 'Show'}</button></div>
        <div class="row"><button class="btn ghost" id="sycopy">Copy key</button><button class="btn ghost" id="sycopyl" data-url="${esc(url)}">Copy setup link</button></div></div>
      ${s.info && s.info.owner ? `<div class="synccard"><h2>Server owner</h2><p>Your key created the first sync space on this server, so you decide whether other people (your players, for example) may create their own sync keys. Their data would be separate from yours; they can never see your books or notes.</p>
        <label class="sychk"><input type="checkbox" id="syopen" ${s.info.open ? 'checked' : ''}> Let others create their own sync keys</label></div>` : ''}
      <div class="synccard"><h2>Key leaked or device lost?</h2><p><b>Replace key</b> gives your data a new key; the old one stops working everywhere, so reconnect your other devices with the new key. <b>Turn off on this device</b> stops syncing here and keeps the data on this device.</p>
        <div class="row"><button class="btn ghost" id="syrot">Replace key</button><button class="btn danger" id="syoff">Turn off on this device</button></div></div>`;
  }
  $('#main').innerHTML = box(h);
  const busy = (b, label) => { if (b) { b.disabled = true; b.textContent = label; } };
  const run = async (b, label, f) => { busy(b, label); try { await f(); } catch (e) { toast(esc(e.message), 6000); } syncPage(); };
  const copy = async (txt, what) => { try { await navigator.clipboard.writeText(txt); toast(what + ' copied'); } catch (e) { prompt('Copy this:', txt); } };
  const on = (id, f) => { const el = $('#' + id); if (el) el.onclick = () => f(el); };
  on('sycreate', b => run(b, 'Turning on…', async () => { await V.create(); toast('Sync is on'); }));
  on('syconn', b => run(b, 'Connecting…', async () => { await V.connect($('#sykey').value); toast('Connected. Reload to see the synced data.', 6000); }));
  on('sylink', b => run(b, 'Connecting…', async () => { await V.connect(link[1]); history.replaceState(null, '', '#sync'); toast('Connected. Reload to see the synced data.', 6000); }));
  on('synow', b => run(b, 'Syncing…', () => V.syncNow()));
  on('syshow', () => { syncShowKey = !syncShowKey; syncPage(); });
  on('sycopy', () => copy(s.key, 'Key'));
  on('sycopyl', b => copy(b.dataset.url, 'Setup link'));
  on('syrot', async b => { if (await confirmSheet('Replace your sync key? The old key stops working on all your other devices until you connect them with the new one.', 'Replace key')) run(b, 'Replacing…', async () => { await V.rotate(); syncShowKey = true; toast('New key created. Reconnect your other devices with it.', 6000); }); });
  on('syoff', async () => { if (await confirmSheet('Stop syncing on this device? Your data stays on this device and on the server.', 'Turn off')) { V.disconnect(); syncPage(); } });
  const op = $('#syopen'); if (op) op.onchange = () => run(null, '', () => V.setOpen(op.checked));
  if (link && s.enabled) history.replaceState(null, '', '#sync');  // already connected: don't keep the key in the address bar
}

function pinnedPage() {
  const valid = pins.map(k => { const [t, id] = k.split('--'); return [t, BYID[t] && BYID[t][id], k]; }).filter(x => x[1]);
  const abs = valid.filter(x => x[0] === 'abilities'), mons = valid.filter(x => x[0] === 'monsters'), rest = valid.filter(x => x[0] !== 'abilities' && x[0] !== 'monsters');
  $('#main').innerHTML = `<div class="pinpage"><h1>Pinned Items</h1><div class="note">Star (★) any ability, monster or entry to collect it here: a hero's ability sheet or tonight's encounter. Saved in this browser only. ${valid.length ? '<button class="ibtn" id="clrpins" style="display:inline-flex;margin-left:8px">Clear all</button>' : ''}</div>
   ${!valid.length ? '<div class="empty">Nothing pinned yet.</div>' : ''}
   ${mons.length ? `<h2 class="abgh" style="margin-bottom:8px">Monsters · ${mons.reduce((s, x) => s + (parseInt(x[1].ev) || 0), 0)} EV total</h2><div class="pincols">${mons.map(x => renderMonster(x[1])).join('')}</div>` : ''}
   ${abs.length ? `<h2 class="abgh" style="margin-bottom:8px">Abilities</h2><div class="pincols">${abs.map(x => renderAbility(x[1])).join('')}</div>` : ''}
   ${rest.map(([t, e]) => `<div class="pincard">${entityView(t, e)}</div>`).join('')}</div>`;
  if ($('#clrpins')) $('#clrpins').onclick = () => { pins = []; store.set('pins', pins); updatePins(); pinnedPage(); };
  enhance($('#main'));
  document.title = 'Pinned — Vanadium';
}

// ---------- search ----------
let SIDX = [];
const TPRI = { conditions: 0, classes: 0, chapter: 1, ancestries: 1, kits: 2, monsters: 2, abilities: 3, glossary: 3, rule: 6 };
function buildIndex() {
  SIDX = [];
  Object.keys(TYPES).forEach(t => itemsOf(t).forEach(e => SIDX.push({
    t, id: t === 'monsters' ? e.gid : e.id, n: e.name, l: e.name.toLowerCase(),
    ex: t === 'abilities' ? (e.group === 'Class' ? e.source : e.group) + (e.cost ? ' · ' + e.cost : '') : t === 'monsters' ? 'Lv ' + e.level + ' ' + e.role : t === 'treasures' ? e.type : t === 'perks' ? e.type : ''
  })));
  try { refreshNegotiations(); allNegs().forEach(n => SIDX.push({ t: 'negotiations', id: n.id, n: n.name, l: n.name.toLowerCase(), ex: 'Negotiation · ' + (n.user ? 'yours' : (PK[n.pack]?.title || '')) })); NEG_ARCH.forEach(a => SIDX.push({ t: 'negotiations', id: '', n: a.name + ' (negotiator archetype)', l: (a.name + ' negotiator').toLowerCase(), ex: 'Impression ' + a.impression })); } catch (e) { console.warn(e); }
  try { refreshMontages(); allMt().forEach(m => SIDX.push({ t: 'montages', id: m.id, n: m.name, l: (m.name + ' montage').toLowerCase(), ex: 'Montage test · ' + (m.user ? 'yours' : (PK[m.pack]?.title || '')) })); } catch (e) { console.warn(e); }
  for (const p of PACKS) {
    p.chapters.forEach(c => {
      SIDX.push({ t: 'chapter', id: p.id + '--' + c.id, n: c.title, l: c.title.toLowerCase(), ex: p.title });
      c.blocks.forEach(b => { if (b.t === 'h' && b.lvl <= 5 && b.lvl !== 0 && b.text.length < 80) SIDX.push({ t: 'rule', id: p.id + '--' + c.id + '--' + b.id, n: b.text, l: b.text.toLowerCase(), ex: (p.heroes ? '' : p.title + ' · ') + c.title }); });
    });
  }
}
let sresults = [], ssel = 0;
function runSearch(q) {
  const s = q.trim().toLowerCase(); if (!s) return [];
  const toks = s.split(/\s+/); const res = [];
  for (const it of SIDX) {
    if (!toks.every(t => it.l.includes(t))) continue;
    let sc = it.l === s ? 0 : it.l.startsWith(s) ? 10 : it.l.includes(s) ? 20 : 30;
    sc += (TPRI[it.t] ?? 4) + it.l.length / 100;
    res.push([sc, it]);
  }
  res.sort((a, b) => a[0] - b[0]);
  const seen = new Set(), out = [];
  for (const [, it] of res) { if (it.t === 'rule' && seen.has(it.l)) continue; seen.add(it.l); out.push(it); if (out.length >= 50) break; }
  return out;
}
const srHtml = (list) => list.map((it, i) => `<div class="sr ${i === 0 && !isMob ? 'sel' : ''}" data-i="${i}"><span class="ty">${esc(it.t === 'rule' ? 'Rule' : it.t === 'chapter' ? 'Chapter' : it.t === 'negotiations' ? 'Negotiation' : it.t === 'montages' ? 'Montage' : TYPES[it.t].one)}</span><span class="nm">${esc(it.n)}</span><span class="ex">${esc(it.ex)}</span></div>`).join('');
function doSearch(q, anchorEl) {
  const box = $('#sres');
  sresults = runSearch(q); ssel = 0;
  if (!q.trim()) { box.classList.remove('on'); return; }
  box.innerHTML = sresults.length ? srHtml(sresults) : `<div class="sr"><span class="nm">No results — try the <a href="#library">library</a></span></div>`;
  if (anchorEl && anchorEl.id === 'hq') { const r = anchorEl.getBoundingClientRect(); Object.assign(box.style, { position: 'fixed', top: (r.bottom + 4) + 'px', left: r.left + 'px', width: r.width + 'px', right: 'auto' }); }
  else Object.assign(box.style, { position: '', top: '', left: '', width: '', right: '' });
  box.classList.add('on');
}
function openResult(it) {
  if (!it) return;
  $('#sres').classList.remove('on'); $('#q').value = ''; $('#q').blur(); closeMSearch();
  if (it.t === 'montages') go('montage--' + it.id); else if (it.t === 'negotiations') go(it.id ? 'negotiation--' + it.id : 'negotiation'); else if (it.t === 'rule' || it.t === 'chapter') go('book--' + it.id); else go(it.t + '--' + it.id);
}
function searchKeys(e) {
  const box = $('#sres');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ssel = Math.max(0, Math.min(sresults.length - 1, ssel + (e.key === 'ArrowDown' ? 1 : -1))); $$('.sr', box).forEach((r, i) => r.classList.toggle('sel', i === ssel)); $$('.sr', box)[ssel]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') openResult(sresults[ssel]);
  else if (e.key === 'Escape') { box.classList.remove('on'); e.target.blur(); }
}
$('#q').addEventListener('input', e => doSearch(e.target.value));
$('#q').addEventListener('keydown', searchKeys);
$('#q').addEventListener('focus', e => { if (e.target.value) doSearch(e.target.value); });
$('#sres').addEventListener('mousedown', e => { const r = e.target.closest('.sr[data-i]'); if (r) { e.preventDefault(); openResult(sresults[+r.dataset.i]); } });
document.addEventListener('click', e => { if (!e.target.closest('#searchwrap,#sres,#hq')) $('#sres').classList.remove('on'); });
document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); isMob ? openMSearch() : $('#q').focus(); } });
// mobile search
let mres = [];
function openMSearch() { $('#msearch').classList.add('on'); const q = $('#mq'); q.value = ''; $('#mres').innerHTML = '<div class="hint">Type to search across every book, monster, ability and rule.</div>'; setTimeout(() => q.focus(), 30); }
function closeMSearch() { $('#msearch').classList.remove('on'); $('#mq').blur(); }
$('#msearchbtn').onclick = openMSearch;
$('#mqclose').onclick = closeMSearch;
$('#mq').addEventListener('input', e => { mres = runSearch(e.target.value); $('#mres').innerHTML = e.target.value.trim() ? (mres.length ? srHtml(mres) : '<div class="hint">No results.</div>') : '<div class="hint">Type to search across every book, monster, ability and rule.</div>'; });
$('#mq').addEventListener('keydown', e => { if (e.key === 'Enter' && mres[0]) openResult(mres[0]); });
$('#mres').addEventListener('click', e => { const r = e.target.closest('.sr[data-i]'); if (r) openResult(mres[+r.dataset.i]); });

// ---------- roller ----------
const CH = ['Might', 'Agility', 'Reason', 'Intuition', 'Presence'];
let chars = store.get('chars', { Might: 0, Agility: 0, Reason: 0, Intuition: 0, Presence: 0 });
$('#chars').innerHTML = CH.map(c => `<label>${c.slice(0, 3)}<input type="number" inputmode="numeric" data-ch="${c}" value="${chars[c] ?? 0}"></label>`).join('');
$$('#chars input').forEach(i => i.oninput = () => { chars[i.dataset.ch] = parseInt(i.value) || 0; store.set('chars', chars); });
const openRoller = () => { $('#roller').classList.add('on'); if (!isMob) $('#fab').style.display = 'none'; };
const closeRoller = () => { $('#roller').classList.remove('on'); $('#fab').style.display = ''; };
$('#fab').onclick = openRoller;
$('#rclose').onclick = closeRoller;
function powerRoll(label, charList, abKey, fixed) {
  const d1 = 1 + Math.floor(Math.random() * 10), d2 = 1 + Math.floor(Math.random() * 10);
  const nat = d1 + d2;
  const extra = parseInt($('#rbonus').value) || 0;
  let mod = extra, cname = '', cval = 0;
  if (fixed != null) { mod += fixed; }
  else if (charList && charList.length) { cname = charList.reduce((b, c) => (chars[c] ?? 0) > (chars[b] ?? 0) ? c : b, charList[0]); cval = chars[cname] ?? 0; mod += cval; }
  else if ($('#rchar').value) { cname = $('#rchar').value; cval = chars[cname] ?? 0; mod += cval; }
  const ed = parseInt($('#redge').value) || 0;
  const tot = nat + mod + (ed === 1 ? 2 : ed === -1 ? -2 : 0);
  let tier = tot <= 11 ? 1 : tot <= 16 ? 2 : 3;
  if (ed === 2) tier = Math.min(3, tier + 1); if (ed === -2) tier = Math.max(1, tier - 1);
  if (nat >= 19) tier = 3;
  const col = ['', 'var(--t1)', 'var(--t2)', 'var(--t3)'][tier];
  const parts = [`2d10 [${d1}, ${d2}]`]; if (fixed != null) parts.push('+ ' + fixed); if (cname) parts.push('+ ' + cname + ' ' + cval); if (extra) parts.push('+ ' + extra); if (ed) parts.push('· ' + $('#redge').selectedOptions[0].text);
  $('#rlog').insertAdjacentHTML('afterbegin', `<div class="rl"><div class="tot">${tot}</div><div><div class="lab">${esc(label || 'Power roll')}</div><div class="tt">${esc(parts.join(' '))}</div><span class="tl" style="background:${col}">Tier ${tier}${nat >= 19 ? ' · CRIT' : ''}</span></div></div>`);
  if (abKey) { $$(`[data-ab="${CSS.escape(abKey)}"] .tier`).forEach(t => t.classList.toggle('hit', t.classList.contains('n' + tier))); setTimeout(() => $$('.tier.hit').forEach(t => t.classList.remove('hit')), 6000); }
  toast(`${label ? esc(label) + ': ' : ''}<b>${tot}</b> → Tier ${tier}${nat >= 19 ? ' (natural ' + nat + '!)' : ''}`);
}
$('#rgo').onclick = () => powerRoll('', null, null);

// ---------- scrim / sheets / peek ----------
let scrimCb = null;
function showScrim(cb, light) { scrimCb = cb; $('#scrim').classList.add('on'); }
function hideScrim() { $('#scrim').classList.remove('on'); scrimCb = null; }
$('#scrim').onclick = () => { const cb = scrimCb; hideScrim(); $('#sheet').classList.remove('on'); $('#peek').classList.remove('on'); if (cb) cb(); };
function closeSheets() { $('#sheet').classList.remove('on'); $('#peek').classList.remove('on'); hideScrim(); }
function browseSheet() {
  const sec = (t, ks) => `<h3>${t}</h3><div class="sgrid">${ks.map(([k, l, d]) => `<a href="#${k}"><b>${esc(l || TYPES[k].label)}</b><span>${esc(d || (TYPES[k] ? itemsOf(k).length + ' entries' : ''))}</span></a>`).join('')}</div>`;
  $('#sheet').innerHTML = `<div class="grab"></div>` +
    sec('Heroes', [['classes'], ['ancestries'], ['cultures'], ['careers'], ['kits'], ['perks'], ['complications'], ['abilities'], ['respite', 'Respite', 'Downtime projects & followers']]) +
    sec('Director', [['sessions', 'Sessions', 'Prep & print a game night'], ['encounter', 'Encounter Builder', 'Difficulty & initiative PDF'], ['cards', 'Cards', 'Print item, quest & follower cards'], ['negotiation', 'Negotiation', 'Interest, patience & arguments'], ['montage', 'Montage Tests', 'Successes, failures & rounds'], ['monsters'], ...PACKS.filter(p => p.kind === 'adventure').map(p => ['book--' + p.id, p.title, 'Adventure']), ['import', 'Import a PDF', 'Add your own books']]) +
    sec('Rules & rewards', [['conditions'], ['glossary'], ['skills'], ['treasures'], ['titles'], ['gods']]) +
    `<p style="font-size:10.5px;color:var(--ink3);margin-top:16px">Vanadium is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC. DRAW STEEL © 2024 MCDM Productions, LLC.</p>`;
  $('#sheet').classList.add('on'); showScrim();
  $$('#sheet a').forEach(a => a.addEventListener('click', closeSheets));
}
function peek(t, id) {
  const ent = BYID[t] && BYID[t][id]; if (!ent) return go(t + '--' + id);
  const body = t === 'abilities' ? renderAbility(ent, { nosrc: true }) : t === 'monsters' ? renderMonster(ent, { nosrc: true }) : `<div class="rd">${renderBlocks(ent.body)}</div>`;
  $('#peek').innerHTML = `<div class="grab"></div><div class="pk-h"><b>${esc(ent.name)}</b><a class="btn ghost" href="#${t}--${id}">Open</a></div>${body}`;
  $('#peek').classList.add('on'); showScrim(); $('#peek').scrollTop = 0;
  $$('#peek a[href]').forEach(a => a.addEventListener('click', closeSheets));
}
$$('#tabbar button').forEach(b => b.onclick = () => {
  const t = b.dataset.tab; closeSheets(); if (t !== 'roll') closeRoller();
  if (t === 'home') go(''); else if (t === 'library') go('library'); else if (t === 'pinned') go('pinned');
  else if (t === 'browse') browseSheet(); else if (t === 'roll') { $('#roller').classList.contains('on') ? closeRoller() : openRoller(); }
});
function markTab() {
  const h = location.hash.slice(1); const a = h.split('--')[0];
  const t = !h ? 'home' : a === 'library' || a === 'book' || a === 'import' ? 'library' : a === 'pinned' ? 'pinned' : 'browse';
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
}

// ---------- global delegated clicks & hover ----------
document.addEventListener('click', e => {
  const pin = e.target.closest('[data-pin]'); if (pin) { e.preventDefault(); togglePin(pin.dataset.pin); return; }
  const rb = e.target.closest('[data-roll]');
  if (rb) {
    const txt = rb.dataset.roll; const fx = txt.match(/2d10\s*\+\s*(\d+)/);
    openRoller(); powerRoll(rb.dataset.lab || '', fx ? null : (txt.match(/Might|Agility|Reason|Intuition|Presence/g) || []), rb.dataset.ab, fx ? +fx[1] : (/^\s*(Power Roll\s*)?2d10\s*$/.test(txt) ? 0 : null)); return;
  }
  const zi = e.target.closest('img[data-zoom]'); if (zi) { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${zi.getAttribute('src')}" alt=""><button aria-label="Close">✕</button>`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); return; }
  const le = e.target.closest('[data-loadenc]'); if (le) { e.preventDefault(); const [p, c, i] = le.dataset.loadenc.split('|'); loadBookEncounter(p, c, +i); return; }
  const ae = e.target.closest('[data-addenc]'); if (ae) { e.preventDefault(); addToEncounter(ae.dataset.addenc); return; }
  const back = e.target.closest('[data-back]'); if (back) { go(back.dataset.back); return; }
  const del = e.target.closest('[data-delpack]'); if (del) { e.preventDefault(); deletePack(del.dataset.delpack); return; }
  const sf = e.target.closest('[data-srcfilter]'); if (sf) { LSTATE.monsters = { q: '', f: { Source: { [sf.dataset.srcfilter]: 1 } }, sort: null, dir: 1, open: false }; }
  const gb = e.target.closest('[data-gobook]'); if (gb) { e.preventDefault(); hideHov(); closeSheets(); go('book--' + gb.dataset.gobook); return; }
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); hideHov(); if (isMob && g.classList.contains('lnk')) { const [t, id] = g.dataset.go.split('--'); peek(t, id); return; } closeSheets(); go(g.dataset.go); return; }
  const p = e.target.closest('[data-page]'); if (p && p.dataset.page) { e.preventDefault(); hideHov(); closeSheets(); gotoPage(p.dataset.page); return; }
});
const hov = $('#hov'); let hovT = null;
function hideHov() { hov.style.display = 'none'; clearTimeout(hovT); }
document.addEventListener('mouseover', e => {
  if (isMob) return;
  const g = e.target.closest('.lnk[data-go]'); if (!g) return;
  clearTimeout(hovT);
  hovT = setTimeout(() => {
    const [t, id] = g.dataset.go.split('--'); const ent = BYID[t] && BYID[t][id]; if (!ent) return;
    hov.innerHTML = t === 'abilities' ? renderAbility(ent, { nosrc: true }) : t === 'monsters' ? renderMonster(ent, { nosrc: true }) : `<h2>${esc(ent.name)}</h2><div class="rd">${renderBlocks(ent.body)}</div>`;
    hov.style.display = 'block';
    const r = g.getBoundingClientRect(); const w = hov.offsetWidth, h = hov.offsetHeight;
    let x = Math.min(innerWidth - w - 10, r.left), y = r.bottom + 6; if (y + h > innerHeight - 10) y = Math.max(10, r.top - h - 6);
    hov.style.left = x + 'px'; hov.style.top = y + 'px';
  }, 250);
});
document.addEventListener('mouseout', e => { if (e.target.closest('.lnk[data-go]')) hideHov(); });
let toastT;
function toast(h, ms = 2200) { const t = $('#toast'); t.innerHTML = h; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => t.style.display = 'none', ms); }

// theme & mobile
function applyTheme(th) { document.documentElement.dataset.theme = th; store.set('theme2', th); const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = th === 'dark' ? '#18191c' : '#ffffff'; try { document.querySelectorAll('iframe').forEach(f => f.contentWindow && f.contentWindow.__stTheme && f.contentWindow.__stTheme()); } catch (e) {} }
$('#themebtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#pinsbtn').onclick = () => go('pinned');
function setupMobile() {
  const mq = matchMedia('(max-width: 900px)');
  const apply = () => { const was = isMob; isMob = mq.matches; document.body.classList.toggle('mob', isMob); if (was !== isMob && D) route(); };
  mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
  apply();
}

// ---------- router ----------
let lastType = null;
function route() {
  if (!D) return;
  hideHov(); $('#sres').classList.remove('on'); closeSheets(); closeMSearch();
  if (isMob) closeRoller();
  markTab();
  const h = decodeURIComponent(location.hash.slice(1));
  const [a, b, c, d] = h.split('--');
  const done = () => { if (isMob) { const m = $('#main'); m.scrollTop = 0; } };
  if (!a) { lastType = null; home(); return done(); }
  if (a === 'book') { lastType = null; bookPage(b || 'heroes', c, d); return done(); }
  if (a === 'library') { lastType = null; libraryPage(); return done(); }
  if (a === 'import') { lastType = null; importPage(); return done(); }
  if (a === 'pinned') { lastType = null; pinnedPage(); return done(); }
  if (a === 'sync') { lastType = null; syncPage(); return done(); }
  if (a === 'encounter') { lastType = null; encounterPage(); return done(); }
  if (a === 'respite') { lastType = null; respitePage(); return done(); }
  if (a === 'negotiation') { lastType = null; b ? negotiationPage(b) : negotiationHub(); return done(); }
  if (a === 'sessions') { lastType = null; sessionsHub(); return done(); }
  if (a === 'session') { lastType = null; sessionPage(b, c); return done(); }
  if (a === 'cards') { lastType = null; cardsPage(); return done(); }
  if (a === 'montage') { lastType = null; b ? montagePage(b) : montageHub(); return done(); }
  if (a === 'roller') { openRoller(); history.replaceState(null, '', '#'); lastType = null; home(); return; }
  if (a === 'classes') { lastType = null; b ? classPage(b) : classIndex(); return done(); }
  if (LIST[a]) {
    if (lastType === a && $('#lview')) showEntity(a, b);
    else { listPage(a, b); lastType = a; }
    if (isMob && b) { const v = $('#lview'); if (v) v.scrollTop = 0; }
    return;
  }
  home();
}
boot();
