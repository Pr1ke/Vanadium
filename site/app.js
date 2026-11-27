// Vanadium app
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// ---- which game system is active (chosen per device; switching reloads the app) ----
// The build fills in the systems it contains and the "legacy" system: the one that owns data
// saved before multi-system support (unprefixed localStorage keys, imports without a system tag).
const SYSTEM_IDS = JSON.parse('["drawsteel", "srd5"]');
const LEGACY_SYSTEM = 'drawsteel';
const ACTIVE_SYSTEM = (() => { let s = null; try { s = localStorage.getItem('vanadium_system'); } catch (e) { } return SYSTEM_IDS.includes(s) ? s : LEGACY_SYSTEM; })();
// Each system's data has its own key prefix: st_<key> for the legacy system (unchanged, so nothing
// had to move), st_<system>_<key> for the others. gstore holds settings shared by all systems.
const STORE_PREFIX = ACTIVE_SYSTEM === LEGACY_SYSTEM ? 'st_' : 'st_' + ACTIVE_SYSTEM + '_';
const mkStore = prefix => ({
  get(k, d) { try { const v = localStorage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch (e) { } }
});
const store = mkStore(STORE_PREFIX);   // the active system's data
const gstore = mkStore('st_');         // shared: theme, update check
function switchSystem(id) {
  try { localStorage.setItem('vanadium_system', id); } catch (e) { }
  location.replace(location.pathname + location.search);   // routes are per system, so start at home
}
const ORD = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const slug = s => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const uniq = a => [...new Set(a.filter(x => x !== null && x !== undefined && x !== ''))];

const KIND = { core: 'Core rules', bestiary: 'Bestiary', adventure: 'Adventure', supplement: 'Supplement', book: 'Book' };

let D;                    // the game system's core rules data (SYS.data)
let PACKS = [];           // [{id,title,kind,chapters,monsters,abilities,builtin}]
const PK = {};            // id -> pack
let MONS = [];            // all monsters (global ids)
const MON = {};           // gid -> monster
const PAB = {};           // packId:localId -> ability
const PENT = {};          // type -> entries added by books (pack.entities), shown in the lists next to D[type]
let TYPES, BYID;          // entity types and id lookups, filled by SYS.init
let LIST = {};            // list-page config per type (SYS.lists)
let CHAP = {}, PAGE = {}; // core rulebook: chapter id -> chapter, page number -> {ch, i}
let isMob = false;

// ---------- game systems ----------
// The core knows nothing about a particular game. A system module (src/systems/<id>/) calls
// registerSystem({...}) with:
//   id, name, short               'drawsteel', 'Draw Steel', 'DS' (short: system switch on phones)
//   data: {file, loading}         core rules JSON → D; loading message
//   init()                        fill TYPES and BYID (and the system's own lookups) from D
//   corePack()                    the core rulebook as a pack (rendered by the book reader)
//   builtin: [{id,file,title,kind}]  further built-in books, loaded in the background
//   lists: {type: {cols, filters, text?, view?, idOf?}}  list pages (see listPage)
//   menu(), home(), browse()      top menu entries, home page, mobile "Browse" sheet
//   routes: {name: (b,c,d) => …}  pages of the system's own tools (#name--b--c--d)
//   packRoutes: [names]           routes to re-render once all books have loaded
//   renderMonster(m,o), renderAbility(a,o)  stat blocks and ability cards
//   renderBlock(b, ctx)           html for system block types in books (or undefined)
//   afterHeading(b, o), afterTable(b, bi, o), chapterExtras(pack, c)  extra buttons in books
//   onAddPack(p)                  enrich a book when it is added (e.g. Draw Steel dastards)
//   entityMeta(type, e), entitySource(type, e)  subtitle and source line of an entry
//   preview(type, e)              hover / peek html for an entry (or undefined)
//   pinGroups: [{type, title(list), render(e)}]  grouped sections on the Pinned page
//   linkTypes: [type]             entry names auto-linked in rules text (e.g. conditions)
//   searchExtra(type, e), searchIndex(push), searchPriority  search index details
//   packSummary(p)                extra text on a Library card
//   importer: {module, stats(p)}  PDF parser module and import-preview stats
//   onClick(e)                    delegated clicks for system buttons; true if handled
//   pdfNotice                     licence line on exported PDFs
//   notice                        licence notice in the page footer
//   roller: {title, html, mount}  dice roller panel (#roller) and its floating button's tooltip
//   session: {kinds, party, partyNote, partyLine(S), newParty(), planText, overviewExtra(S)}
//                                 what Sessions can hold besides pages (sess.js documents each kind)
//   cards: {tabs, kinds, icons, rewards, intro, questsFromChapter, questRewardsText, optionsHtml, wireOptions}
//                                 card kinds besides quest cards (cards.js), reward types, adventure quests
//   syncWhat                      what sync keeps in step, in words (Sync page)
// A system's registerSystem call runs at load time, so it goes in the system's last file.
const SYSTEMS = {};
let SYS = null;
function registerSystem(s) { SYSTEMS[s.id] = s; if (s.id === ACTIVE_SYSTEM) SYS = s; }
// imported books carry the system they were imported under; untagged ones predate that and are the legacy system's
const packBelongs = p => (p.system || LEGACY_SYSTEM) === SYS.id;

// ---------- data loading ----------
const DATA_V = 'b8e0291b8f';
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
  // books can add entries to the system's lists (e.g. imported 5e spells and classes): p.entities = {type: [entry]}
  for (const [t, list] of Object.entries(p.entities || {})) { delete PENT_MERGED[t]; for (const e of list) { e.pack = p.id; (PENT[t] = PENT[t] || []).push(e); if (BYID && BYID[t]) BYID[t][e.id] = e; } }
  if (SYS.onAddPack) SYS.onAddPack(p);
}
function removePack(id) {
  const p = PK[id]; if (!p) return;
  PACKS = PACKS.filter(x => x.id !== id); delete PK[id];
  MONS = MONS.filter(m => m.pack !== id);
  for (const k of Object.keys(MON)) if (MON[k].pack === id) delete MON[k];
  for (const k of Object.keys(PAB)) if (k.startsWith(id + ':')) delete PAB[k];
  for (const t of Object.keys(PENT)) { delete PENT_MERGED[t]; PENT[t] = PENT[t].filter(e => { if (e.pack !== id) return true; if (BYID && BYID[t] && BYID[t][e.id] === e) delete BYID[t][e.id]; return false; }); }
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
  if (!bootBuild || document.hidden || Date.now() - gstore.get('updchk', 0) < UPD_COOLDOWN) return;
  gstore.set('updchk', Date.now());
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
    gstore.set('updchk', Date.now());
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
  applyTheme(gstore.get('theme2', 'light'));
  setupMobile();
  mountSystemChrome();
  try { D = await getJSON(SYS.data.file, (g, t) => { $('#loadmsg').textContent = `${SYS.data.loading} ${(g / 1048576).toFixed(1)}${t ? ' / ' + (t / 1048576).toFixed(1) : ''} MB`; }); }
  catch (e) { $('#loadmsg').textContent = 'Could not load the rules data (' + e.message + ').'; return; }
  SYS.init(); LIST = SYS.lists;
  const core = SYS.corePack(); core.core = true;   // the core rulebook: page references (p. 12) point into it
  CHAP = {}; core.chapters.forEach(c => CHAP[c.id] = c);
  PAGE = {}; core.chapters.forEach(c => c.blocks.forEach((b, i) => { if (b.pg && !PAGE[b.pg]) PAGE[b.pg] = { ch: c.id, i }; }));
  addPack(core);
  buildMenu(); updatePins(); route();
  $('#loading').style.display = 'none';
  initUpdateCheck();
  // packs in the background
  const loads = (SYS.builtin || []).map(b => getJSON(b.file).then(p => { p.builtin = true; p.title = b.title; p.kind = b.kind; p.id = b.id; addPack(p); }).catch(e => console.warn('pack', b.id, e)));
  const user = IDB.all().then(list => list.filter(packBelongs).forEach(p => { p.builtin = false; addPack(p); }));
  await Promise.all([...loads, user]);
  buildIndex(); buildMenu();
  const h = location.hash.slice(1);
  if (new RegExp('^(' + ['book', 'library', 'import', 'pinned', 'session', ...(SYS.packRoutes || [])].join('|') + ')').test(h) || !h) route();
  // sync (sync.js): books arriving from / removed on other devices
  const onBooks = /^(library|book|monsters|sync)/;
  if (window.VSync) VSync.appReady({
    added(p) { if (!packBelongs(p)) return; p.builtin = false; addPack(p); buildIndex(); buildMenu(); toast('Synced “' + esc(p.title) + '” from another device'); if (onBooks.test(location.hash.slice(1))) route(); },
    removed(id) { if (!PK[id]) return; removePack(id); buildIndex(); buildMenu(); if (onBooks.test(location.hash.slice(1))) route(); }
  });
}

// with book entries, a type's list is the system's entries plus the books', sorted by name (cached until a book changes)
const PENT_MERGED = {};
const itemsOf = t => t === 'monsters' ? MONS : PENT[t] && PENT[t].length ? (PENT_MERGED[t] = PENT_MERGED[t] || (D[t] || []).concat(PENT[t]).sort((a, b) => a.name.localeCompare(b.name))) : (D[t] || []);

// ---------- routing ----------
function go(h) { if (location.hash.slice(1) === h) route(); else location.hash = h; }
window.addEventListener('hashchange', route);

// ---------- icons ----------
const ICON = {
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m15 18-6-6 6-6"/></svg>'
};

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
      if (opts.book && SYS.afterHeading) emit(SYS.afterHeading(b, opts) || '');
    } else if (b.t === 'p') {
      emit(`<p class="${b.style === 'body' ? '' : 'small'}"${idx}>${pm}${b.html}</p>`);
    } else if (b.t === 'quote') {
      emit(`<blockquote${idx}>${pm}${esc(b.text)}${b.attr ? `<cite>— ${esc(b.attr)}</cite>` : ''}</blockquote>`);
    } else if (b.t === 'table') {
      let t = `<div class="tblw"${idx}>${pm}<table class="dt"><thead><tr>${b.head.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>`;
      const n = Math.max(b.head.length, ...b.rows.map(r => r.length));
      for (const r of b.rows) t += '<tr>' + Array.from({ length: n }, (_, k) => `<td>${r[k] || ''}</td>`).join('') + '</tr>';
      emit(t + '</tbody></table></div>');
      if (opts.book && SYS.afterTable) emit(SYS.afterTable(b, bi, opts) || '');
    } else if (b.t === 'img') {
      const src = (PK[opts.packId || pack] || {}).images?.[b.i];
      if (src) emit(`<figure class="bkimg ${b.w > 330 ? 'wide' : 'side'}" data-pg="${esc(b.pg || '')}"><img loading="lazy" src="${esc(src)}" alt="" data-zoom="1"></figure>`);
    } else if (b.t === 'monster') {
      const m = MON[PK[pack]?.monMap[b.ref]];
      emit(`<div${idx}>${pm}</div>` + SYS.renderMonster(m, { nosrc: true }));
    } else if (SYS.renderBlock) {   // system block types (Draw Steel: power-roll tiers, abilities)
      const h = SYS.renderBlock(b, { pack, pm, idx }); if (h) emit(h);
    }
  });
  closeList(); closeAside();
  return out;
}

// Links page references ("p. 12", into the core rulebook) and the names of SYS.linkTypes entries
// (Draw Steel: conditions) inside rules text.
let LINKS = null;   // {names: lowercased names in data order, go: name -> 'type--id', esc: regex-safe names}
function linkTerms() {
  if (LINKS) return LINKS;
  LINKS = { names: [], go: {} };
  for (const t of SYS.linkTypes || []) for (const e of itemsOf(t)) { const n = e.name.toLowerCase(); if (!(n in LINKS.go)) { LINKS.names.push(n); LINKS.go[n] = t + '--' + e.id; } }
  LINKS.esc = LINKS.names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return LINKS;
}
function enhance(root) {
  const L = linkTerms();
  const pre = new RegExp('p\\.\\s*\\d' + L.esc.map(n => '|' + n).join(''), 'i');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement; if (!p || p.closest('a,button,.lnk,.pref,th,h2,h3,h4,h5,h6,.pgmark,input,select' + (SYS.noLink ? ',' + SYS.noLink : ''))) return NodeFilter.FILTER_REJECT;
      return pre.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  const inCore = !root.closest || !root.closest('[data-pack]') || PK[root.closest('[data-pack]').dataset.pack]?.core;
  const re = new RegExp('(\\bpp?\\.\\s*\\d+(?:[–-]\\d+)?)' + (L.esc.length ? '|\\b(' + L.esc.join('|') + ')\\b' : ''), 'gi');
  for (const n of nodes) {
    const s = n.data; let m, last = 0, frag = null; re.lastIndex = 0;
    while ((m = re.exec(s))) {
      if (m[1] && !inCore) continue;
      frag = frag || document.createDocumentFragment();
      frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const el = document.createElement('span');
      if (m[1]) { el.className = 'pref'; el.dataset.page = (m[1].match(/\d+/) || [''])[0]; }
      else { el.className = 'lnk'; el.dataset.go = L.go[m[2].toLowerCase()]; }
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
function buildMenu() {
  $('#menu').innerHTML = SYS.menu().map(([lab, items]) => `<div class="mi"><button>${lab}</button><div class="dd">${items.filter(([k]) => k === '-' || TYPES[k] || !k.startsWith('book--') || PK[k.split('--')[1]]).map(([k, l]) => k === '-' ? '<hr>' : `<a href="#${k}">${esc(l || TYPES[k].label)}${TYPES[k] ? `<span>${itemsOf(k).length}</span>` : ''}</a>`).join('')}</div></div>`).join('');
  $$('.mi>button').forEach(b => b.onclick = e => { e.stopPropagation(); const m = b.parentElement; const was = m.classList.contains('open'); $$('.mi').forEach(x => x.classList.remove('open')); if (!was) m.classList.add('open'); });
  $$('#menu a').forEach(a => a.addEventListener('click', () => { $$('.mi').forEach(x => x.classList.remove('open')); $('#menu').classList.remove('on'); }));
  const upd = $('#menu a[href="#!update"]'); if (upd) upd.addEventListener('click', e => { e.preventDefault(); manualUpdate(); });
}
document.addEventListener('click', e => { if (!e.target.closest('.mi')) $$('.mi').forEach(x => x.classList.remove('open')); });
$('#burger').onclick = () => $('#menu').classList.toggle('on');

// ---------- list pages ----------
function tools(type, e) {
  return `<div class="ent-tools"><button class="ibtn ${isPinned(type, e.id) ? 'on' : ''}" data-pin="${type}--${e.id}" title="Pin">★</button>${e.src && e.src.pg ? `<button class="ibtn" data-page="${e.src.pg}" title="Open in rulebook">p. ${esc(e.src.pg)}</button>` : ''}</div>`;
}
function entityView(type, e) {
  if (LIST[type].view) return LIST[type].view(e);
  const meta = (SYS.entityMeta && SYS.entityMeta(type, e)) ?? TYPES[type].one;
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
    (SYS.entitySource ? SYS.entitySource(type, e) : '');
  v.scrollTop = 0; enhance(v);
  const tr = $(`#lbody tr[data-id="${CSS.escape(id)}"]`);
  if (tr && !isMob) { const box = tr.closest('.ltable'); const r = tr.getBoundingClientRect(), b = box.getBoundingClientRect(); if (r.top < b.top + 28 || r.bottom > b.bottom) tr.scrollIntoView({ block: 'center' }); }
  document.title = e.name + ' — Vanadium';
}

// ---------- book reader (any pack) ----------
function bookPage(packId, ch, anchor) {
  let pack = PK[packId];
  if (!pack) { // legacy: #book--<heroes chapter>
    const corePk = PACKS.find(p => p.core);
    if (CHAP[packId]) { anchor = ch; ch = packId; pack = corePk; }
    else if (!PACKS.length || (SYS.builtin || []).some(b => b.id === packId)) { $('#main').innerHTML = '<div class="empty">Loading…</div>'; return; }
    else pack = corePk;
  }
  const chs = pack.chapters.filter(c => c.blocks.length || c === pack.chapters[0]);
  if (!chs.length) { $('#main').innerHTML = `<div class="lib"><h1>${esc(pack.title)}</h1><p class="note">This book has no chapters to read; its entries are in the lists${SYS.packSummary ? ` (${esc((SYS.packSummary(pack) || '').replace(/^ · /, ''))})` : ''}.</p></div>`; document.title = pack.title + ' — Vanadium'; return; }
  let c = chs.find(x => x.id === ch) || chs.find(x => x.id !== 'front' && x.blocks.length > 5) || chs[0];
  const ci = chs.indexOf(c);
  const pid = pack.core ? null : pack.id;
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
  $('#main').innerHTML = `<div class="bk" data-pack="${pack.id}"><div class="bk-nav" id="bnav">${bookSel}${nav}</div><div class="bk-main" id="bmain">${c.part ? `<div class="chap-part">${esc(c.part)}</div>` : ''}<h1 class="chap-title">${esc(c.title.replace(/^[a-z]/, x => x.toUpperCase()))}</h1>${SYS.chapterExtras ? SYS.chapterExtras(pack, c) || '' : ''}<div class="rd">${renderBlocks(c.blocks, { book: true, pack: pid, ch: c.id, packId: pack.id })}</div>
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
    if (/^p\d/.test(anchor)) { const pg = anchor.slice(1); el = pack.core && PAGE[pg] ? bm.querySelector(`[data-bi="${PAGE[pg].i}"]`) : bm.querySelector(`#pg-${CSS.escape(pg)}`)?.parentElement; }
    else el = document.getElementById('h-' + anchor);
    if (el) { el.scrollIntoView(); el.style.transition = 'background 1.5s'; el.style.background = 'rgba(224,112,58,.25)'; setTimeout(() => el.style.background = '', 1600); }
  } else bm.scrollTop = 0;
  document.title = c.title + ' — ' + pack.title;
}
function gotoPage(pg) { const p = PAGE[pg]; if (p) go('book--' + PACKS.find(x => x.core).id + '--' + p.ch + '--p' + pg); else toast('Page ' + pg + ' not found'); }

// ---------- library ----------
function libraryPage() {
  const card = p => {
    const nm = (p.monsters || []).length, nch = p.chapters.filter(c => c.blocks.length).length;
    return `<div class="bookc k-${p.kind}"><div class="kind">${esc(KIND[p.kind] || p.kind)}${p.builtin ? '' : ' · Imported'}</div><b>${esc(p.title)}</b>
      <div class="cnt">${nch} chapters${nm ? ' · ' + nm + ' monsters' : ''}${SYS.packSummary ? SYS.packSummary(p) || '' : ''}</div>
      <div class="acts">${nch ? `<a class="btn" href="#book--${p.id}">Read</a>` : ''}${nm ? `<a class="btn ghost" href="#monsters" data-srcfilter="${esc(p.title)}">Monsters</a>` : ''}${p.builtin ? '' : `<button class="btn danger" data-delpack="${p.id}">Remove</button>`}</div></div>`;
  };
  $('#main').innerHTML = `<div class="lib"><h1>Library</h1><p class="note">Every book in Vanadium. ${window.VSync && VSync.status().enabled ? `Imported ${esc(SYS.importer.noun || 'PDFs')} are synced to your other devices.` : `Imported ${esc(SYS.importer.noun || 'PDFs')} live only in this browser (<a href="#sync">sync them across devices</a>).`}</p>
    <div class="books">${PACKS.map(card).join('')}<a class="bookc" href="#import" style="text-decoration:none;color:var(--ink);border-style:dashed;align-items:flex-start;justify-content:center"><div class="kind">Add content</div><b>${esc(SYS.importer.label || 'Import a PDF')} →</b><div class="cnt">Adventures, bestiaries, supplements</div></a></div></div>`;
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
  if (SYS.importer.run) return importPageFiles();   // systems with their own file reader (5e: JSON); else the PDF importer below
  const mine = PACKS.filter(p => !p.builtin);
  $('#main').innerHTML = `<div class="imp"><h1>Import a PDF</h1>
    <p class="note">Add an adventure, bestiary or supplement from a ${esc(SYS.name)} PDF. Vanadium reads the text layout and pulls out chapters, headings, tables, read-aloud text, monster stat blocks and abilities. <b>The file stays on this device</b>: it is processed in your browser and saved to this browser's storage.</p>
    <label class="drop" id="drop"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/></svg><b>Drop a PDF here or tap to choose</b><span>${esc(SYS.importer.hint)}</span><input type="file" id="pdffile" accept="application/pdf,.pdf"></label><label class="row-c" style="margin-top:10px"><input type="checkbox" id="imp-imgs" checked> Keep the pictures and maps (stored in this browser)</label>
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
    const { extractPages, parsePack } = await import(SYS.importer.module);
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
    <div class="pvstats"><div class="stat">Pages<b>${p.stats.pages}</b></div><div class="stat">Chapters<b>${nch.length}</b></div><div class="stat">Headings<b>${nh}</b></div><div class="stat">Tables<b>${nt}</b></div><div class="stat">Monsters<b>${p.monsters.length}</b></div><div class="stat">Images<b>${(p.images || []).length}</b></div>${SYS.importer.stats ? SYS.importer.stats(p).map(([l, n]) => `<div class="stat">${l}<b>${n}</b></div>`).join('') : ''}<div class="stat">Abilities<b>${p.abilities.length + p.monsters.reduce((s, m) => s + m.items.length, 0)}</b></div></div>
    ${!nch.length || nh < 3 ? `<div class="warn">Very little structure was found. The text will still be readable, but headings may be missing.</div>` : `<div class="okb">Looks good. Review the chapters and monsters below, then add it to your library.</div>`}
    <div class="pvlist">${nch.map(c => `<div>${esc(c.title)}<span>${c.blocks.length} blocks</span></div>`).join('')}</div>
    ${p.monsters.length ? `<div class="pvlist">${p.monsters.slice(0, 200).map(m => `<div>${esc(m.name)}<span>Level ${m.level} ${esc(m.role)}${m.ev ? ' · EV ' + esc(m.ev) : ''}</span></div>`).join('')}</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pvsave">Add to library</button><button class="btn ghost" id="pvcancel">Discard</button></div></div>`;
  $('#pvcancel').onclick = () => { pending = null; stage.innerHTML = ''; };
  $('#pvsave').onclick = async () => {
    p.title = $('#pvtitle').value.trim() || p.title; p.kind = $('#pvkind').value;
    const btn = $('#pvsave'); btn.disabled = true; btn.textContent = 'Saving…';
    const clean = JSON.parse(JSON.stringify(p, (k, v) => (k === 'monMap' || k === 'gid' || k === 'pack' || k === '_t') ? undefined : v));
    clean.system = SYS.id;   // the book belongs to the system it was imported under
    let persisted = true;
    try { await IDB.put(clean); } catch (e) { persisted = false; memPacks.push(clean); }
    addPack(clean); buildIndex(); buildMenu(); pending = null;
    if (persisted && window.VSync) VSync.packsChanged();  // uploads it if sync is on
    toast(persisted ? 'Added to your library' : 'Added for this session (browser storage unavailable)');
    go('book--' + clean.id);
  };
}
// ---- importer for systems with their own file reader (SYS.importer.run), e.g. 5e JSON files ----
// run(files, progress) -> {packs: [pack], notes: [text]}; each pack is shown in a preview, then stored
// like a PDF import (this browser's IndexedDB, tagged with the system, synced if sync is on).
let pendingPacks = null;
function importPageFiles() {
  const I = SYS.importer, mine = PACKS.filter(p => !p.builtin);
  $('#main').innerHTML = `<div class="imp"><h1>${esc(I.label || 'Import')}</h1>
    <p class="note">${I.intro} <b>The files stay on this device</b>: they are read in your browser and saved to this browser's storage.</p>
    <label class="drop" id="drop"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/></svg><b>Drop files or a folder here, or tap to choose files</b><span>${esc(I.hint)}</span><input type="file" id="impfiles" accept="${esc(I.accept || '')}" multiple></label>
    <div class="row-c" style="margin-top:10px;gap:8px"><button class="btn ghost" id="impdir">Choose a folder…</button><input type="file" id="impdirin" webkitdirectory multiple hidden></div>
    <div class="stage" id="stage"></div>
    <div class="mine"><h2>Your imports</h2>${mine.length ? mine.map(p => `<div class="it"><div class="t"><b>${esc(p.title)}</b><span>${esc(KIND[p.kind] || p.kind)} · ${p.chapters.length} chapters · ${(p.monsters || []).length} monsters${SYS.packSummary ? esc(SYS.packSummary(p) || '') : ''} · imported ${esc((p.importedAt || '').slice(0, 10))}</span></div>${p.chapters.length ? `<a class="btn ghost" href="#book--${p.id}">Read</a>` : ''}<button class="btn danger" data-delpack="${p.id}">Remove</button></div>`).join('') : '<div class="note">Nothing imported yet.</div>'}</div></div>`;
  const drop = $('#drop'), inp = $('#impfiles'), dir = $('#impdirin');
  inp.onchange = () => inp.files.length && handleImportFiles([...inp.files]);
  $('#impdir').onclick = () => dir.click();
  dir.onchange = () => dir.files.length && handleImportFiles([...dir.files]);
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async e => {   // files and whole folders
    const items = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!items.length) return handleImportFiles([...e.dataTransfer.files]);
    const out = [], walk = async en => { if (en.isFile) out.push(await new Promise((res, rej) => en.file(res, rej))); else if (en.isDirectory) { const r = en.createReader(); for (;;) { const batch = await new Promise((res, rej) => r.readEntries(res, rej)); if (!batch.length) break; for (const x of batch) await walk(x); } } };
    for (const en of items) await walk(en);
    handleImportFiles(out);
  });
  document.title = 'Import — Vanadium';
}
async function handleImportFiles(files) {
  const stage = $('#stage');
  stage.innerHTML = `<div class="progt" id="pt">Reading ${files.length} file${files.length === 1 ? '' : 's'}…</div><div class="prog"><div id="pb"></div></div>`;
  const setP = (t, f) => { const pt = $('#pt'), pb = $('#pb'); if (pt) pt.textContent = t; if (pb) pb.style.width = Math.round(f * 100) + '%'; };
  try {
    const res = await SYS.importer.run(files, setP);
    pendingPacks = res.packs;
    const notes = res.notes || [];
    if (!pendingPacks.length) { stage.innerHTML = `<div class="warn">Nothing to import in ${files.length === 1 ? 'that file' : 'those files'}.${notes.length ? '<br>' + notes.map(esc).join('<br>') : ''}</div>`; return; }
    const n = (k, one, many) => k ? `${k} ${k === 1 ? one : many}` : '';
    const sum = p => [n(p.chapters.length, 'chapter', 'chapters'), n((p.monsters || []).length, 'monster', 'monsters'), ...Object.entries(p.entities || {}).map(([t, l]) => n(l.length, TYPES[t] ? TYPES[t].one.toLowerCase() : t, TYPES[t] ? TYPES[t].label.toLowerCase() : t))].filter(Boolean).join(' · ');
    stage.innerHTML = `<div class="pv"><div class="okb">Found ${pendingPacks.length} book${pendingPacks.length === 1 ? '' : 's'}. Check the titles, then add them to your library. Importing the same files again replaces the earlier import.</div>
      <div class="pvlist pvfiles">${pendingPacks.map((p, i) => `<div><label class="row-c" style="gap:8px;flex:1"><input type="checkbox" data-pk="${i}" checked><input class="pvt" data-pt="${i}" value="${esc(p.title)}" aria-label="Title"></label><span>${esc(KIND[p.kind] || p.kind)} · ${esc(sum(p))}${PK[p.id] ? ' · replaces your earlier import' : ''}</span></div>`).join('')}</div>
      ${notes.length ? `<details class="note"><summary>${notes.length} note${notes.length === 1 ? '' : 's'}</summary>${notes.map(n => `<div>${esc(n)}</div>`).join('')}</details>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pvsave">Add to library</button><button class="btn ghost" id="pvcancel">Discard</button></div></div>`;
    $('#pvcancel').onclick = () => { pendingPacks = null; stage.innerHTML = ''; };
    $('#pvsave').onclick = async () => {
      const btn = $('#pvsave'); btn.disabled = true; let n = 0, persisted = true;
      for (const [i, p] of pendingPacks.entries()) {
        if (!$(`[data-pk="${i}"]`).checked) continue;
        p.title = $(`[data-pt="${i}"]`).value.trim() || p.title;
        btn.textContent = `Saving ${++n}…`; await new Promise(r => setTimeout(r, 0));
        const clean = JSON.parse(JSON.stringify(p, (k, v) => (k === 'monMap' || k === 'gid' || k === 'pack' || k === '_t') ? undefined : v));
        clean.system = SYS.id; clean.importedAt = clean.importedAt || new Date().toISOString();
        try { await IDB.put(clean); } catch (e) { persisted = false; memPacks.push(clean); }
        addPack(clean);
      }
      buildIndex(); buildMenu(); pendingPacks = null;
      if (persisted && window.VSync) VSync.packsChanged();
      toast(persisted ? `Added ${n} book${n === 1 ? '' : 's'} to your library` : 'Added for this session (browser storage unavailable)');
      go('library');
    };
  } catch (e) {
    console.error(e);
    stage.innerHTML = `<div class="warn">Import failed: ${esc(e.message || e)}</div>`;
  }
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
  const what = `<p class="note">Keeps your ${esc(SYS.syncWhat || 'sessions, cards, pins, settings')} and imported books the same on every device and browser you use. Your data is stored on this site’s server under a private sync key. Anyone with the key can see and change everything, so keep it to yourself.</p>`;
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
      ${s.info && ((s.info.cards && s.info.cards.count) || (s.info.cardTraffic && s.info.cardTraffic.views)) ? `<div class="synccard"><h2>Card pictures</h2>
        <p>${s.info.cards.count} card picture${s.info.cards.count === 1 ? '' : 's'} uploaded for the QR codes on your card backs (${mb(s.info.cards.bytes)}). Anyone with a printed card can open its picture.${s.info.cardTraffic ? ` In the last 30 days they were opened <b>${s.info.cardTraffic.views}</b> time${s.info.cardTraffic.views === 1 ? '' : 's'} (${mb(s.info.cardTraffic.bytes)} sent, all keys on this server).` : ''}</p>
        ${s.info.cards.count ? '<p>Deleting them makes the QR codes on printed cards stop working. Exporting the cards again uploads them again (with the same QR codes).</p><div class="row"><button class="btn ghost danger" id="sycards">Delete all card pictures</button></div>' : ''}</div>` : ''}
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
  on('sycards', async b => { if (await confirmSheet('Delete all uploaded card pictures? The QR codes on cards you already printed will stop working.', 'Delete')) run(b, 'Deleting…', async () => { const n = await V.cardClear(); toast(`Deleted ${n} card picture${n === 1 ? '' : 's'}`); }); });
  const op = $('#syopen'); if (op) op.onchange = () => run(null, '', () => V.setOpen(op.checked));
  if (link && s.enabled) history.replaceState(null, '', '#sync');  // already connected: don't keep the key in the address bar
}

function pinnedPage() {
  const valid = pins.map(k => { const [t, id] = k.split('--'); return [t, BYID[t] && BYID[t][id], k]; }).filter(x => x[1]);
  const groups = SYS.pinGroups || [], grouped = new Set(groups.map(g => g.type));
  const rest = valid.filter(x => !grouped.has(x[0]));
  $('#main').innerHTML = `<div class="pinpage"><h1>Pinned Items</h1><div class="note">Star (★) any ability, monster or entry to collect it here: a hero's ability sheet or tonight's encounter. Saved in this browser only. ${valid.length ? '<button class="ibtn" id="clrpins" style="display:inline-flex;margin-left:8px">Clear all</button>' : ''}</div>
   ${!valid.length ? '<div class="empty">Nothing pinned yet.</div>' : ''}
   ${groups.map(g => { const xs = valid.filter(x => x[0] === g.type); return xs.length ? `<h2 class="abgh" style="margin-bottom:8px">${g.title(xs.map(x => x[1]))}</h2><div class="pincols">${xs.map(x => g.render(x[1])).join('')}</div>` : ''; }).join('\n   ')}
   ${rest.map(([t, e]) => `<div class="pincard">${entityView(t, e)}</div>`).join('')}</div>`;
  if ($('#clrpins')) $('#clrpins').onclick = () => { pins = []; store.set('pins', pins); updatePins(); pinnedPage(); };
  enhance($('#main'));
  document.title = 'Pinned — Vanadium';
}

// ---------- search ----------
let SIDX = [];
// search entries: {t: type, id, n: name, l: lowercased text, ex: extra line, ty?: label, go?: hash}
const CORE_PRI = { chapter: 1, rule: 6 };   // lower ranks first; systems add theirs (SYS.searchPriority)
function buildIndex() {
  SIDX = [];
  Object.keys(TYPES).forEach(t => itemsOf(t).forEach(e => SIDX.push({
    t, id: t === 'monsters' ? e.gid : e.id, n: e.name, l: e.name.toLowerCase(),
    ex: SYS.searchExtra ? SYS.searchExtra(t, e) : ''
  })));
  if (SYS.searchIndex) SYS.searchIndex(it => SIDX.push(it));   // system tools (Draw Steel: negotiations, montages)
  for (const p of PACKS) {
    p.chapters.forEach(c => {
      SIDX.push({ t: 'chapter', id: p.id + '--' + c.id, n: c.title, l: c.title.toLowerCase(), ex: p.title });
      c.blocks.forEach(b => { if (b.t === 'h' && b.lvl <= 5 && b.lvl !== 0 && b.text.length < 80) SIDX.push({ t: 'rule', id: p.id + '--' + c.id + '--' + b.id, n: b.text, l: b.text.toLowerCase(), ex: (p.core ? '' : p.title + ' · ') + c.title }); });
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
    sc += ((SYS.searchPriority || {})[it.t] ?? CORE_PRI[it.t] ?? 4) + it.l.length / 100;
    res.push([sc, it]);
  }
  res.sort((a, b) => a[0] - b[0]);
  const seen = new Set(), out = [];
  for (const [, it] of res) { if (it.t === 'rule' && seen.has(it.l)) continue; seen.add(it.l); out.push(it); if (out.length >= 50) break; }
  return out;
}
const srHtml = (list) => list.map((it, i) => `<div class="sr ${i === 0 && !isMob ? 'sel' : ''}" data-i="${i}"><span class="ty">${esc(it.ty || (it.t === 'rule' ? 'Rule' : it.t === 'chapter' ? 'Chapter' : TYPES[it.t].one))}</span><span class="nm">${esc(it.n)}</span><span class="ex">${esc(it.ex)}</span></div>`).join('');
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
  if (it.go) go(it.go); else if (it.t === 'rule' || it.t === 'chapter') go('book--' + it.id); else go(it.t + '--' + it.id);
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
const openRoller = () => { $('#roller').classList.add('on'); if (!isMob) $('#fab').style.display = 'none'; };
const closeRoller = () => { $('#roller').classList.remove('on'); $('#fab').style.display = ''; };
$('#fab').onclick = openRoller;
$('#roller').addEventListener('click', e => { if (e.target.closest('#rclose')) closeRoller(); });   // the panel's content comes from the system
// the system's dice roller panel and licence notice (called first thing in boot)
function mountSystemChrome() {
  const ids = Object.keys(SYSTEMS), sel = $('#syssel');   // the system switch, only when there is a choice
  if (sel && ids.length > 1) { sel.innerHTML = ids.map(id => `<option value="${id}" ${id === SYS.id ? 'selected' : ''}>${esc(isMob ? SYSTEMS[id].short || SYSTEMS[id].name : SYSTEMS[id].name)}</option>`).join(''); sel.hidden = false; sel.onchange = () => switchSystem(sel.value); }
  if (SYS.roller) { $('#roller').innerHTML = SYS.roller.html; $('#fab').title = SYS.roller.title; if (SYS.roller.mount) SYS.roller.mount(); }
  else { $('#fab').hidden = true; const rt = $('#tabbar button[data-tab="roll"]'); if (rt) rt.hidden = true; }   // a system without a dice roller
  $('footer').innerHTML = SYS.notice || '';
}

// ---------- scrim / sheets / peek ----------
let scrimCb = null;
function showScrim(cb, light) { scrimCb = cb; $('#scrim').classList.add('on'); }
function hideScrim() { $('#scrim').classList.remove('on'); scrimCb = null; }
$('#scrim').onclick = () => { const cb = scrimCb; hideScrim(); $('#sheet').classList.remove('on'); $('#peek').classList.remove('on'); if (cb) cb(); };
function closeSheets() { $('#sheet').classList.remove('on'); $('#peek').classList.remove('on'); hideScrim(); }
function peek(t, id) {
  const ent = BYID[t] && BYID[t][id]; if (!ent) return go(t + '--' + id);
  const body = (SYS.preview && SYS.preview(t, ent)) || `<div class="rd">${renderBlocks(ent.body)}</div>`;
  $('#peek').innerHTML = `<div class="grab"></div><div class="pk-h"><b>${esc(ent.name)}</b><a class="btn ghost" href="#${t}--${id}">Open</a></div>${body}`;
  $('#peek').classList.add('on'); showScrim(); $('#peek').scrollTop = 0;
  $$('#peek a[href]').forEach(a => a.addEventListener('click', closeSheets));
}
$$('#tabbar button').forEach(b => b.onclick = () => {
  const t = b.dataset.tab; closeSheets(); if (t !== 'roll') closeRoller();
  if (t === 'home') go(''); else if (t === 'library') go('library'); else if (t === 'pinned') go('pinned');
  else if (t === 'browse') SYS.browse(); else if (t === 'roll') { $('#roller').classList.contains('on') ? closeRoller() : openRoller(); }
});
function markTab() {
  const h = location.hash.slice(1); const a = h.split('--')[0];
  const t = !h ? 'home' : a === 'library' || a === 'book' || a === 'import' ? 'library' : a === 'pinned' ? 'pinned' : 'browse';
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
}

// ---------- global delegated clicks & hover ----------
document.addEventListener('click', e => {
  const pin = e.target.closest('[data-pin]'); if (pin) { e.preventDefault(); togglePin(pin.dataset.pin); return; }
  if (SYS.onClick && SYS.onClick(e)) return;   // system buttons (Draw Steel: roll, add to encounter, …)
  const zi = e.target.closest('img[data-zoom]'); if (zi) { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${zi.getAttribute('src')}" alt=""><button aria-label="Close">✕</button>`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); return; }
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
    hov.innerHTML = (SYS.preview && SYS.preview(t, ent)) || `<h2>${esc(ent.name)}</h2><div class="rd">${renderBlocks(ent.body)}</div>`;
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
function applyTheme(th) { document.documentElement.dataset.theme = th; gstore.set('theme2', th); const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = th === 'dark' ? '#18191c' : '#ffffff'; try { document.querySelectorAll('iframe').forEach(f => f.contentWindow && f.contentWindow.__stTheme && f.contentWindow.__stTheme()); } catch (e) {} }
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
  if (!a) { lastType = null; SYS.home(); return done(); }
  if (a === 'book') { lastType = null; bookPage(b || PACKS.find(p => p.core).id, c, d); return done(); }
  if (a === 'library') { lastType = null; libraryPage(); return done(); }
  if (a === 'import') { lastType = null; importPage(); return done(); }
  if (a === 'pinned') { lastType = null; pinnedPage(); return done(); }
  if (a === 'sync') { lastType = null; syncPage(); return done(); }
  if (a === 'sessions') { lastType = null; sessionsHub(); return done(); }
  if (a === 'session') { lastType = null; sessionPage(b, c); return done(); }
  if (a === 'cards') { lastType = null; cardsPage(); return done(); }
  if (a === 'roller') { openRoller(); history.replaceState(null, '', '#'); lastType = null; SYS.home(); return; }
  if (SYS.routes && SYS.routes[a]) { lastType = null; SYS.routes[a](b, c, d); return done(); }
  if (LIST[a]) {
    if (lastType === a && $('#lview')) showEntity(a, b);
    else { listPage(a, b); lastType = a; }
    if (isMob && b) { const v = $('#lview'); if (v) v.scrollTop = 0; }
    return;
  }
  SYS.home();
}
// ================= DRAW STEEL system module =================
// Everything Vanadium knows about Draw Steel that the core (app.js) doesn't: the rules data and
// its entity types, how abilities/monsters render, list columns and filters, class pages, the
// menu and home page, the power roller and the hooks the core calls (see registerSystem at the
// bottom; the hook contract is documented in app.js next to registerSystem).
// Draw Steel tools live next to this file: enc.js, neg.js, mtg.js, ds-print.js, respite-*.

// ==== built-in books ====
const BUILTIN = [
  { id: 'monsters', file: 'data/monsters.json', title: 'Draw Steel: Monsters', kind: 'bestiary' }
];

// ==== data setup (SYS.init) ====
let AB = {};   // ability id -> ability (Heroes book abilities)
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
}

// ==== icons for abilities and stat blocks (added to the core ICON set) ====
Object.assign(ICON, {
  dist: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 12h18M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4"/></svg>',
  tgt: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  die: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 2 21 7v10l-9 5-9-5V7z"/></svg>',
  melee: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></svg>',
  ranged: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 20 20 4M14 4h6v6M4 14v6h6"/></svg>',
  area: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
  trig: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  trait: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z"/></svg>',
  vil: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C7 2 4 5.5 4 10c0 3 1.5 5 3 6v3h2v-2h2v2h2v-2h2v2h2v-3c1.5-1 3-3 3-6 0-4.5-3-8-8-8zm-3 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>'
});

// ==== moved from app.js: render ====
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


// ==== moved from app.js: menu ====
function dsMenu() {
  return [
    ['Rules', [['library', 'Library'], ['book--heroes', 'Heroes Rulebook'], ['-'], ['conditions'], ['glossary'], ['skills']]],
    ['Heroes', [['classes'], ['ancestries'], ['cultures'], ['careers'], ['complications'], ['-'], ['kits'], ['perks'], ['abilities'], ['-'], ['respite', 'Respite & Downtime']]],
    ['Director', [['sessions', 'Sessions'], ['encounter', 'Encounter Builder'], ['negotiation', 'Negotiation Tracker'], ['montage', 'Montage Tests'], ['monsters'], ...PACKS.filter(p => p.kind === 'adventure').map(p => ['book--' + p.id, p.title]), ['book--monsters', 'Monsters Book'], ['book--encounters', 'Encounters Book'], ['-'], ['book--heroes--for-the-director', 'For the Director'], ['gods']]],
    ['Rewards', [['treasures'], ['cards', 'Cards: items, quests, followers'], ['titles']]],
    ['Utilities', [['import', 'Import a PDF'], ['roller', 'Power Roller'], ['pinned', 'Pinned Items'], ['-'], ['sync', 'Sync across devices'], ['!update', 'Check for updates']]]
  ];
}

// ==== moved from app.js: lists ====
const roleOf = m => (m.role || '').replace(/^(Minion|Horde|Platoon|Elite|Leader|Solo|Retainer)\s*/, '') || m.org;
const DS_LISTS = {
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

// ==== moved from app.js: classes ====
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


// ==== moved from app.js: respite ====
// ---------- respite (embedded tool) ----------
window.__stSave = (name, blob) => deliverFile(name, blob);
window.__stGotoPage = pg => gotoPage(String(pg));
function respitePage() {
  $('#main').innerHTML = `<div class="resp"><div class="resp-bar"><b>Respite &amp; Downtime</b><span class="sp"></span><span class="rlinks">Rules: <a href="#book--heroes--the-basics--respite">Respite</a> · <a href="#book--heroes--downtime-projects">Downtime projects</a> · <a href="#book--heroes--rewards--renown">Renown &amp; followers</a></span></div><iframe id="respframe" src="respite.html?v=f55fa3499c" title="Respite: a Draw Steel downtime companion"></iframe></div>`;
  document.title = 'Respite — Vanadium';
}

// ==== moved from app.js: home ====
function dsHome() {
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

// ==== moved from app.js: chars ====
const CH = ['Might', 'Agility', 'Reason', 'Intuition', 'Presence'];
let chars = store.get('chars', { Might: 0, Agility: 0, Reason: 0, Intuition: 0, Presence: 0 });
// the power roller panel: the core puts SYS.roller.html into #roller, then calls SYS.roller.mount()
const DS_ROLLER_HTML = `
  <div class="rh">Power Roll <button id="rclose">×</button></div>
  <div class="rb">
    <div class="chars" id="chars"></div>
    <div class="rrow">
      <select id="rchar"><option value="">No characteristic</option><option>Might</option><option>Agility</option><option>Reason</option><option>Intuition</option><option>Presence</option></select>
      <label>Bonus <input id="rbonus" type="number" value="0" style="width:52px"></label>
    </div>
    <div class="rrow">
      <select id="redge"><option value="0">No edge/bane</option><option value="1">Edge (+2)</option><option value="2">Double edge (tier up)</option><option value="-1">Bane (−2)</option><option value="-2">Double bane (tier down)</option></select>
    </div>
    <button class="bigroll" id="rgo">Roll 2d10</button>
    <div id="rlog"></div>
  </div>
`;
function dsMountRoller() {
  $('#chars').innerHTML = CH.map(c => `<label>${c.slice(0, 3)}<input type="number" inputmode="numeric" data-ch="${c}" value="${chars[c] ?? 0}"></label>`).join('');
  $$('#chars input').forEach(i => i.oninput = () => { chars[i.dataset.ch] = parseInt(i.value) || 0; store.set('chars', chars); });
  $('#rgo').onclick = () => powerRoll('', null, null);
}

// ==== moved from app.js: roll ====
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

// ==== moved from app.js: browse ====
function dsBrowse() {
  const sec = (t, ks) => `<h3>${t}</h3><div class="sgrid">${ks.map(([k, l, d]) => `<a href="#${k}"><b>${esc(l || TYPES[k].label)}</b><span>${esc(d || (TYPES[k] ? itemsOf(k).length + ' entries' : ''))}</span></a>`).join('')}</div>`;
  $('#sheet').innerHTML = `<div class="grab"></div>` +
    sec('Heroes', [['classes'], ['ancestries'], ['cultures'], ['careers'], ['kits'], ['perks'], ['complications'], ['abilities'], ['respite', 'Respite', 'Downtime projects & followers']]) +
    sec('Director', [['sessions', 'Sessions', 'Prep & print a game night'], ['encounter', 'Encounter Builder', 'Difficulty & initiative PDF'], ['cards', 'Cards', 'Print item, quest & follower cards'], ['negotiation', 'Negotiation', 'Interest, patience & arguments'], ['montage', 'Montage Tests', 'Successes, failures & rounds'], ['monsters'], ...PACKS.filter(p => p.kind === 'adventure').map(p => ['book--' + p.id, p.title, 'Adventure']), ['import', 'Import a PDF', 'Add your own books']]) +
    sec('Rules & rewards', [['conditions'], ['glossary'], ['skills'], ['treasures'], ['titles'], ['gods']]) +
    `<p style="font-size:10.5px;color:var(--ink3);margin-top:16px">Vanadium is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC. DRAW STEEL © 2024 MCDM Productions, LLC.</p>`;
  $('#sheet').classList.add('on'); showScrim();
  $$('#sheet a').forEach(a => a.addEventListener('click', closeSheets));
}
// ==== hooks the core calls (contract: see registerSystem in app.js) ====
function dsOnAddPack(p) {
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
// book blocks only Draw Steel has: power-roll tier lines and abilities
function dsRenderBlock(b, { pack, pm, idx }) {
  if (b.t === 'tier') return `<div class="tierp n${b.n}"${idx}>${pm}<span class="tb">${['', '≤11', '12–16', '17+'][b.n]}</span><span>${b.html}</span></div>`;
  if (b.t === 'ability') {
    const a = pack ? PAB[pack + ':' + b.ref] : AB[b.ref];
    return `<div${idx}>${pm}</div>` + (pack ? renderPackAbility(a, { nosrc: true }) : renderAbility(a));
  }
}
function dsAfterHeading(b, opts) {
  const k = (opts.packId || 'heroes') + ':' + opts.ch + ':' + b.id; let s = '';
  const nid = NEGBYHEAD[k]; if (nid) s += `<a class="btn negrunbtn" href="#negotiation--${nid}">▶ Run this negotiation</a>`;
  const mid = MTBYHEAD[k]; if (mid) s += `<a class="btn negrunbtn" href="#montage--${mid}">▶ Run this montage test</a>`;
  return s;
}
function dsAfterTable(b, bi, opts) {
  if (b.head.length >= 2 && /^Group/i.test(b.head[0]) && /Creature/i.test(b.head[1])) return `<button class="btn ghost sm loadencbtn" data-loadenc="${esc(opts.packId || 'heroes')}|${esc(opts.ch)}|${bi}">⚔ Load into Encounter Builder</button>`;
}
function dsChapterExtras(pack, c) {
  const id = MTBYHEAD[pack.id + ':' + c.id + ':_'];
  return id ? `<a class="btn negrunbtn" href="#montage--${id}">▶ Run this montage test</a>` : '';
}
function dsEntityMeta(type, e) {
  if (type === 'treasures') return [e.echelon ? ORD(e.echelon) + '-echelon' : '', e.type, e.sub].filter(Boolean).join(' ');
  if (type === 'titles') return ORD(e.echelon) + '-echelon title';
  if (type === 'perks') return e.type + ' perk';
  if (type === 'cultures') return e.aspect + ' culture aspect';
  if (type === 'skills') return e.group + ' skill';
  if (type === 'gods') return e.pantheon + (e.sub ? ' · ' + e.sub : '');
  if (type === 'kits') return e.kkind + ' kit';
}
function dsEntitySource(type, e) {
  return type === 'monsters' ? '' : `<div class="src">${esc(TYPES[type].one)} · <i>Draw Steel: Heroes</i>${e.src && e.src.pg ? `, <a data-page="${e.src.pg}">page ${esc(e.src.pg)}</a>` : ''}</div>`;
}
function dsPreview(t, ent) {
  if (t === 'abilities') return renderAbility(ent, { nosrc: true });
  if (t === 'monsters') return renderMonster(ent, { nosrc: true });
}
function dsSearchExtra(t, e) {
  return t === 'abilities' ? (e.group === 'Class' ? e.source : e.group) + (e.cost ? ' · ' + e.cost : '') : t === 'monsters' ? 'Lv ' + e.level + ' ' + e.role : t === 'treasures' ? e.type : t === 'perks' ? e.type : '';
}
function dsSearchIndex(push) {
  try { refreshNegotiations(); allNegs().forEach(n => push({ t: 'negotiations', ty: 'Negotiation', go: n.id ? 'negotiation--' + n.id : 'negotiation', id: n.id, n: n.name, l: n.name.toLowerCase(), ex: 'Negotiation · ' + (n.user ? 'yours' : (PK[n.pack]?.title || '')) })); NEG_ARCH.forEach(a => push({ t: 'negotiations', ty: 'Negotiation', go: 'negotiation', id: '', n: a.name + ' (negotiator archetype)', l: (a.name + ' negotiator').toLowerCase(), ex: 'Impression ' + a.impression })); } catch (e) { console.warn(e); }
  try { refreshMontages(); allMt().forEach(m => push({ t: 'montages', ty: 'Montage', go: 'montage--' + m.id, id: m.id, n: m.name, l: (m.name + ' montage').toLowerCase(), ex: 'Montage test · ' + (m.user ? 'yours' : (PK[m.pack]?.title || '')) })); } catch (e) { console.warn(e); }
}
function dsImportStats(p) {
  return [['Negotiations', extractNegotiations(p).length], ['Montages', extractMontages(p).length],
    ['Encounter tables', p.chapters.reduce((s, c) => s + c.blocks.filter(b => b.t === 'table' && /^Group/i.test(b.head[0] || '') && /Creature/i.test(b.head[1] || '')).length, 0)],
    ['Dastards', (() => { const ids = new Set(p.chapters.filter(c => /dastard/i.test(c.part || '')).map(c => c.id)); return p.monsters.filter(m => ids.has(m.ch)).length; })()]];
}
// roll buttons on abilities, "load into encounter" on book tables, "+ Encounter" on stat blocks
function dsOnClick(e) {
  const rb = e.target.closest('[data-roll]');
  if (rb) {
    const txt = rb.dataset.roll; const fx = txt.match(/2d10\s*\+\s*(\d+)/);
    openRoller(); powerRoll(rb.dataset.lab || '', fx ? null : (txt.match(/Might|Agility|Reason|Intuition|Presence/g) || []), rb.dataset.ab, fx ? +fx[1] : (/^\s*(Power Roll\s*)?2d10\s*$/.test(txt) ? 0 : null)); return true;
  }
  const le = e.target.closest('[data-loadenc]'); if (le) { e.preventDefault(); const [p, c, i] = le.dataset.loadenc.split('|'); loadBookEncounter(p, c, +i); return true; }
  const ae = e.target.closest('[data-addenc]'); if (ae) { e.preventDefault(); addToEncounter(ae.dataset.addenc); return true; }
}


// ================= ENCOUNTER BUILDER =================
const CONDS = ['Bleeding', 'Dazed', 'Frightened', 'Grabbed', 'Prone', 'Restrained', 'Slowed', 'Taunted', 'Weakened'];
const isObstacle = m => /Hazard|Trap|Fortification|Siege|Relic|Trigger|Mechanism|Terrain|Environment/i.test(m.role || '') || /dynamic-terrain/.test(m.ch || '');
const isMinion = m => /Minion/.test(m.role || '');
const isSolo = m => /Solo/.test(m.role || '');
const evNum = m => parseInt(String(m.ev || '').replace(/[^\d].*$/, '')) || 0;
const entryEV = (m, n) => isMinion(m) ? evNum(m) * n / 4 : evNum(m) * n;
const stam = m => parseInt((m.stats || {}).Stamina) || 0;

let ENC = store.get('enc', null);
let ENCS = store.get('encs', []);
function newEnc(party) {
  const p = party || (ENC ? { heroes: ENC.heroes, level: ENC.level, victories: ENC.victories, retainers: ENC.retainers } : { heroes: 4, level: 1, victories: 0, retainers: 0 });
  return { id: 'e' + Date.now().toString(36), name: 'New encounter', ...p, groups: [{ id: 'g1', name: 'Group 1', entries: [] }], setup: !party };
}
if (!ENC) ENC = newEnc();
const saveEnc = () => { store.set('enc', ENC); if (ENC && ENC.sessionRef) syncEncToSession(); };

function encMath(E = ENC) {
  const L = Math.max(1, Math.min(10, +E.level || 1));
  const heroES = 4 + 2 * L;
  const bodies = (+E.heroes || 0) + (+E.retainers || 0);
  const vicBonus = Math.floor((+E.victories || 0) / 2);
  const ES = (bodies + vicBonus) * heroES;
  let ev = 0, creatures = 0, minions = 0; const blocks = new Set();
  for (const g of E.groups) for (const e of g.entries) { const m = MON[e.gid]; if (!m) continue; ev += entryEV(m, e.n); blocks.add(m.gid); if (!isObstacle(m)) { creatures += e.n; if (isMinion(m)) minions += e.n; } }
  ev = Math.round(ev * 100) / 100;
  const t = { trivial: ES - heroES, easy: ES, standard: ES + heroES, hard: ES + 3 * heroES };
  const diff = ev === 0 ? 'none' : ev < t.trivial ? 'trivial' : ev < t.easy ? 'easy' : ev <= t.standard ? 'standard' : ev <= t.hard ? 'hard' : 'extreme';
  const worth = { none: 0, trivial: 0, easy: 1, standard: 1, hard: 2, extreme: '2+' }[diff];
  return { L, heroES, bodies, vicBonus, ES, ev, t, diff, worth, creatures, minions, blocks: blocks.size };
}
// ---------- fewer heroes: what to remove ----------
function encScaling(E = ENC) {
  const H = +E.heroes || 0; const out = [];
  const M0 = encMath(E); if (!M0.ev || H < 2) return out;
  const S = E.stones || {};
  const units = encUnits(E);
  const cands0 = units.filter(u => !u.leads && !isSolo(u.m) && !/Leader/i.test(u.m.role || '')).map(u => ({ u, ev: u.minion ? evNum(u.m) * u.size / 4 : evNum(u.m) })).filter(c => c.ev > 0);
  for (let n = H - 1; n >= Math.max(1, H - 2); n--) {
    const M1 = encMath({ ...E, heroes: n });
    const target = M0.ev * M1.ES / M0.ES;
    let cur = M0.ev; const removed = []; const cands = cands0.slice(); const gCount = {};
    units.forEach(u => gCount[u.g.id] = (gCount[u.g.id] || 0) + 1);
    for (;;) {
      let best = null, bestD = Math.abs(cur - target);
      for (const c of cands) { const d = Math.abs(cur - c.ev - target) - (gCount[c.u.g.id] || 0) * 0.01; if (d < bestD - 1e-9) { best = c; bestD = d; } }
      if (!best) break;
      cur -= best.ev; removed.push(best); cands.splice(cands.indexOf(best), 1); gCount[best.u.g.id]--;
    }
    cur = Math.round(cur * 100) / 100;
    const diff = cur < M1.t.trivial ? 'trivial' : cur < M1.t.easy ? 'easy' : cur <= M1.t.standard ? 'standard' : cur <= M1.t.hard ? 'hard' : 'extreme';
    // group the removals for a readable line
    const parts = {};
    for (const r of removed) { const k = r.u.m.gid + '|' + r.u.g.id + '|' + r.u.minion; const p = parts[k] || (parts[k] = { m: r.u.m, g: r.u.g, minion: r.u.minion, n: 0, cols: [] }); p.n += r.u.minion ? r.u.size : 1; const c = S[r.u.key]; if (c) p.cols.push(c.replace(/\*$/, '') + (r.u.minion ? ' chips' : '')); }
    const text = Object.values(parts).map(p => `${p.n} ${p.m.name}${p.minion ? ' (minions)' : ''} from ${p.g.name}${p.cols.length && STONES_ON ? ' [' + p.cols.join(', ') + ']' : ''}`);
    out.push({ n, text, ev: cur, es: M1.ES, diff, sameDiff: diff === M0.diff });
  }
  return out;
}
function scalingHtml() {
  const sc = encScaling(); const ba = ENC.bookAdjust;
  if (!sc.length && !ba) return '';
  return `<div class="encscale"><b>Fewer heroes tonight?</b>${sc.map(x => `<div><span class="sn">For ${x.n} hero${x.n > 1 ? 'es' : ''}:</span> ${x.text.length ? 'remove ' + esc(x.text.join(', ')) : 'no change needed'} <i>→ ${x.ev} EV vs ES ${x.es} (${x.diff})</i></div>`).join('')}${ba ? `<div class="bkadj"><span class="sn">From the book:</span><ul>${ba.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}</div>`;
}
function encWarnings(E = ENC) {
  const M = encMath(E); const w = [];
  const hi = M.L + ((+E.victories || 0) >= 6 ? 3 : 2);
  const seen = new Set();
  for (const g of E.groups) for (const e of g.entries) {
    const m = MON[e.gid]; if (!m || seen.has(m.gid)) continue; seen.add(m.gid);
    if (isSolo(m) && m.level > M.L + 1) w.push(`<b>${esc(m.name)}</b> is a level ${m.level} solo; solos should be no more than 1 level above the heroes (${M.L}).`);
    else if (!isObstacle(m) && m.level > hi) w.push(`<b>${esc(m.name)}</b> is level ${m.level}; keep creatures at level ${hi} or lower for this party.`);
    if (isMinion(m)) { const tot = E.groups.reduce((s, gg) => s + gg.entries.filter(x => x.gid === m.gid).reduce((a, x) => a + x.n, 0), 0); if (tot % 4) w.push(`Minions are bought four at a time: you have ${tot} ${esc(m.name)}.`); }
  }
  for (const g of E.groups) for (const e of g.entries) { const m = MON[e.gid]; if (m && isMinion(m) && e.n > 8) w.push(`${esc(g.name)}: a minion squad can hold at most eight (${e.n} ${esc(m.name)}).`); }
  const nh = (+E.heroes || 0) + (+E.retainers || 0);
  if (nh && M.creatures > 8 * nh) w.push(`${M.creatures} creatures is more than eight per hero.`);
  if (nh && M.creatures > 3 * nh && M.minions < M.creatures / 2) w.push(`With more than three creatures per hero, at least half should be minions (${M.minions} of ${M.creatures}).`);
  if (M.blocks > 6) w.push(`${M.blocks} different stat blocks: more than six gets hard to run.`);
  const hasSolo = E.groups.some(g => g.entries.some(e => MON[e.gid] && isSolo(MON[e.gid])));
  const live = E.groups.filter(g => g.entries.length);
  for (const g of live) {
    const gev = g.entries.reduce((s, e) => s + (MON[e.gid] ? entryEV(MON[e.gid], e.n) : 0), 0);
    const single = g.entries.length === 1 && (g.entries[0].n === 1 || isMinion(MON[g.entries[0].gid] || {}));
    if (gev > 2 * M.heroES && !single) w.push(`${esc(g.name)} is worth ${gev} EV, more than two heroes (${2 * M.heroES}). Consider splitting it.`);
  }
  const low = live.filter(g => g.entries.reduce((s, e) => s + (MON[e.gid] ? entryEV(MON[e.gid], e.n) : 0), 0) < M.heroES);
  if (low.length > 1) w.push(`${low.length} groups are worth less than one hero (${M.heroES} EV); only one group should be that light.`);
  if (!hasSolo && nh && live.length && Math.abs(live.length - nh) > 2) w.push(`${live.length} initiative groups for ${nh} heroes; aim for about ${Math.max(1, nh - 1)}–${nh + 1}.`);
  return w;
}

const DIFFS = ['trivial', 'easy', 'standard', 'hard', 'extreme'];
const DCOL = { none: 'var(--ink3)', trivial: '#7d8a96', easy: '#5f8f55', standard: '#c9a24a', hard: '#d4682f', extreme: '#b5302a' };
let encFilter = { q: '', kind: 'creatures', fit: true };

// ---------- stone colours ----------
const STONE_DEFAULT = [
  { name: 'Red', hex: '#d0312d', chips: true }, { name: 'Orange', hex: '#f28c28', chips: true }, { name: 'Yellow', hex: '#f4d03f', chips: true },
  { name: 'Green', hex: '#3a9d3a', chips: true }, { name: 'Blue', hex: '#2e6fd8', chips: true }, { name: 'Purple', hex: '#8e44ad', chips: true },
  { name: 'Pink', hex: '#f08cc0', chips: true }, { name: 'White', hex: '#f4f4f4', chips: true }, { name: 'Black', hex: '#222222', chips: true },
  { name: 'Brown', hex: '#8b5a2b', chips: false }
];
let STONES = store.get('stones', null) || STONE_DEFAULT.map(x => ({ ...x }));
let STONES_ON = store.get('stoneson', true);
const stoneHex = n => (STONES.find(x => x.name === n) || { hex: '#999999' }).hex;
const lumOf = hex => { const v = parseInt(hex.slice(1), 16); return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255; };
// units on the grid: one stone per non-minion creature, one chip colour per minion squad (4)
function encUnits(E = ENC) {
  const units = [];
  for (const g of E.groups) {
    const gu = [];
    g.entries.forEach(e => {
      const m = MON[e.gid]; if (!m || isObstacle(m)) return;
      if (isMinion(m)) { const sq = Math.ceil(e.n / 4); for (let k = 0; k < sq; k++) gu.push({ key: `${g.id}|${e.gid}|s${k}`, minion: true, m, g, size: Math.min(4, e.n - 4 * k), idx: k }); }
      else for (let k = 0; k < e.n; k++) gu.push({ key: `${g.id}|${e.gid}|${k}`, minion: false, m, g, idx: k });
    });
    // pair each squad with a captain from the same group
    const caps = gu.filter(u => !u.minion && !isSolo(u.m));
    gu.filter(u => u.minion).forEach((sq, i) => { const c = caps[i]; if (c) { sq.captain = c.key; c.leads = sq.key; } });
    units.push(...gu);
  }
  return units;
}
function assignStones(reroll) {
  const units = encUnits(); const byKey = Object.fromEntries(units.map(u => [u.key, u]));
  const old = reroll ? {} : (ENC.stones || {});
  const slots = []; const done = new Set();
  for (const u of units) {
    if (done.has(u.key)) continue;
    if (u.minion) { const keys = [u.key]; if (u.captain) keys.push(u.captain); keys.forEach(k => done.add(k)); slots.push({ keys, chips: true }); }
    else if (u.leads) continue; // handled with its squad
    else { done.add(u.key); slots.push({ keys: [u.key], chips: false }); }
  }
  const avail = STONES.filter(x => x.name); const chipNames = avail.filter(x => x.chips).map(x => x.name);
  const used = new Set(), res = {};
  // keep valid existing assignments
  for (const sl of slots) {
    const c = old[sl.keys[0]];
    if (c && !used.has(c) && sl.keys.every(k => old[k] === c) && avail.some(x => x.name === c) && (!sl.chips || chipNames.includes(c))) { used.add(c); sl.keys.forEach(k => res[k] = c); sl.ok = true; }
  }
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const open = slots.filter(s => !s.ok);
  let overflow = 0;
  for (const sl of shuffle(open.filter(s => s.chips))) {
    const c = shuffle(chipNames.filter(n => !used.has(n)))[0];
    if (c) { used.add(c); sl.keys.forEach(k => res[k] = c); } else { overflow++; const c2 = chipNames[Math.floor(Math.random() * chipNames.length)] || 'Grey'; sl.keys.forEach(k => res[k] = c2 + '*'); }
  }
  for (const sl of shuffle(open.filter(s => !s.chips))) {
    const free = avail.map(x => x.name).filter(n => !used.has(n));
    const noChip = shuffle(free.filter(n => !chipNames.includes(n))); // spend colours without chips first
    const c = noChip[0] || shuffle(free)[0];
    if (c) { used.add(c); res[sl.keys[0]] = c; } else { overflow++; const c2 = avail[Math.floor(Math.random() * avail.length)]?.name || 'Grey'; res[sl.keys[0]] = c2 + '*'; }
  }
  ENC.stones = res; ENC.stoneOverflow = overflow;
  return { units, byKey };
}
const swatch = (name, minion, title) => { const dup = /\*$/.test(name); const n = name.replace(/\*$/, ''); return `<span class="stone ${minion ? 'chip' : ''} ${dup ? 'dup' : ''}" style="background:${stoneHex(n)}" title="${esc(title || (n + (minion ? ' chips' : ' stone') + (dup ? ' (colour used twice: not enough colours)' : '')))}"></span>`; };
function stonesDialog() {
  const el = document.createElement('div'); el.className = 'dlg';
  const draw = () => { el.innerHTML = `<div class="dlg-b"><h2>Stone colours</h2><p>The colours of the stones you put on the grid. Each colour is used once: for one creature, or for a minion squad (chips) together with its captain. Untick “chips” for colours that have no minion chips.</p>
    <label class="row-c"><input type="checkbox" id="st-on" ${STONES_ON ? 'checked' : ''}> Assign stone colours in the encounter builder</label>
    <div class="stlist">${STONES.map((x, i) => `<div class="strow"><input type="color" data-sh="${i}" value="${x.hex}"><input data-sn="${i}" value="${esc(x.name)}"><label><input type="checkbox" data-sc="${i}" ${x.chips ? 'checked' : ''}> chips</label><button class="ibtn" data-sd="${i}">✕</button></div>`).join('')}</div>
    <div class="dlgfoot"><button class="btn ghost" id="st-add">+ Colour</button><button class="btn ghost" id="st-def">Defaults</button><span style="flex:1"></span><button class="btn" id="st-ok">Save & reroll</button></div></div>`;
    $$('[data-sh]', el).forEach(i => i.oninput = () => STONES[+i.dataset.sh].hex = i.value);
    $$('[data-sn]', el).forEach(i => i.oninput = () => STONES[+i.dataset.sn].name = i.value.trim());
    $$('[data-sc]', el).forEach(i => i.onchange = () => STONES[+i.dataset.sc].chips = i.checked);
    $$('[data-sd]', el).forEach(b => b.onclick = () => { STONES.splice(+b.dataset.sd, 1); draw(); });
    $('#st-add', el).onclick = () => { STONES.push({ name: 'Colour ' + (STONES.length + 1), hex: '#888888', chips: true }); draw(); };
    $('#st-def', el).onclick = () => { STONES = STONE_DEFAULT.map(x => ({ ...x })); draw(); };
    $('#st-ok', el).onclick = () => { STONES = STONES.filter(x => x.name); STONES_ON = $('#st-on', el).checked; store.set('stones', STONES); store.set('stoneson', STONES_ON); assignStones(true); saveEnc(); el.remove(); encounterPage(); };
  };
  draw(); el.onclick = e => { if (e.target === el) el.remove(); }; document.body.appendChild(el);
}
function encounterPage() {
  if (STONES_ON) { assignStones(false); saveEnc(); }
  const M = encMath();
  const max = Math.max(M.t.hard * 1.25, M.ev * 1.05, 1);
  const seg = [[0, M.t.trivial, 'trivial'], [M.t.trivial, M.t.easy, 'easy'], [M.t.easy, M.t.standard, 'standard'], [M.t.standard, M.t.hard, 'hard'], [M.t.hard, max, 'extreme']];
  const warns = encWarnings();
  const sref = ENC.sessionRef && sessById(ENC.sessionRef.sid);
  $('#main').innerHTML = `<div class="enc"><div class="enc-l">${sref ? `<div class="sessbar">Part of the session <b>${esc(sref.name)}</b>. Changes are saved to the session automatically. <a href="#session--${sref.id}--${ENC.sessionRef.did}">Back to session</a> · <a id="sessdetach">Stop editing it here</a></div>` : ''}
   <div class="enc-top"><input id="encname" class="encname" value="${esc(ENC.name)}" aria-label="Encounter name">
     <div class="enc-acts"><button class="btn" id="encpdf">${ICON.die.replace('width="11" height="11"', 'width="14" height="14"')} Export PDF</button><button class="btn ghost" id="encsave">Save</button><button class="btn ghost" id="encnew">New</button>${ENCS.length ? `<select id="encload" class="encsel"><option value="">Saved (${ENCS.length})…</option>${ENCS.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>` : ''}</div></div>
   <div class="party">
     <label>Heroes<input type="number" min="1" max="12" id="ph" value="${ENC.heroes}" inputmode="numeric"></label>
     <label>Level<input type="number" min="1" max="10" id="pl" value="${ENC.level}" inputmode="numeric"></label>
     <label>Avg. Victories<input type="number" min="0" max="30" id="pv" value="${ENC.victories}" inputmode="numeric"></label>
     <label>Retainers<input type="number" min="0" max="6" id="pr" value="${ENC.retainers || 0}" inputmode="numeric"></label>
     <div class="es"><span>Encounter strength</span><b>${M.ES}</b><small>${M.bodies} × ${M.heroES}${M.vicBonus ? ` + ${M.vicBonus} for Victories` : ''}</small></div>
   </div>
   <div class="meter-wrap">
     <div class="meter-h"><div><span class="dlabel" style="color:${DCOL[M.diff]}">${M.diff === 'none' ? 'Add monsters' : M.diff}</span><span class="evt">${M.ev} EV</span></div><div class="worth">${M.diff === 'none' ? '' : `Worth ${M.worth} Victor${M.worth === 1 ? 'y' : 'ies'} · Malice starts at ${+ENC.victories || 0}`}</div></div>
     <div class="meter">${seg.map(([a, b, k]) => `<div class="mseg ${k === M.diff ? 'on' : ''}" style="width:${(b - a) / max * 100}%;background:${DCOL[k]}"><span>${k}</span></div>`).join('')}<div class="mark" style="left:${Math.min(100, M.ev / max * 100)}%"></div></div>
     <div class="mticks"><span>Trivial &lt; ${M.t.trivial}</span><span>Easy &lt; ${M.t.easy}</span><span>Standard ≤ ${M.t.standard}</span><span>Hard ≤ ${M.t.hard}</span><span>Extreme &gt; ${M.t.hard}</span></div>
   </div>
   <div class="grp-h"><h2>Initiative groups</h2><div><button class="btn ghost sm" id="addgrp">+ Group</button><button class="btn ghost sm" id="frombook" title="Load an encounter table from a book">From a book…</button><button class="btn ghost sm" id="stonebtn" title="Randomly reassign stone colours">🎲 Stones</button><button class="btn ghost sm" id="stonecfg" title="Set up your stone colours">⚙</button><button class="btn ghost sm" id="autogrp" title="Arrange into groups worth about one to two heroes each">Auto-arrange</button><button class="btn sm mobonly" id="openpick">+ Monsters</button></div></div>
   <div id="groups">${ENC.groups.map((g, gi) => groupHtml(g, gi, M)).join('')}</div>
   ${STONES_ON && ENC.stoneOverflow ? `<div class="warn">Not enough stone colours for every creature: ${ENC.stoneOverflow} colour${ENC.stoneOverflow > 1 ? 's are' : ' is'} used twice (marked with a dot). Add colours under 🎲 Stones, or use fewer creatures.</div>` : ''}
   ${scalingHtml()}
   ${warns.length ? `<div class="encw"><b>Guidelines</b><ul>${warns.map(x => `<li>${x}</li>`).join('')}</ul></div>` : (M.ev ? `<div class="okb">This encounter follows the encounter-building guidelines.</div>` : '')}
   <p class="encnote">Rules from <i>Draw Steel: Monsters</i>, Step-by-Step Encounter Building. Each hero is worth ${M.heroES} (4 + 2 × level); every 2 Victories count as one more hero; minion EV is per four minions.</p>
  </div>
  <div class="enc-r" id="picker"><div class="pick-h"><div class="pick-top"><b>Add to encounter</b><button class="mbtn" id="closepick" style="color:var(--ink)">✕</button></div>
    <input id="pq" type="search" placeholder="Search monsters & obstacles…" value="${esc(encFilter.q)}">
    <div class="pick-tabs"><span class="pill ${encFilter.kind === 'creatures' ? 'inc' : ''}" data-kind="creatures">Creatures</span><span class="pill ${encFilter.kind === 'obstacles' ? 'inc' : ''}" data-kind="obstacles">Obstacles</span><label class="fit"><input type="checkbox" id="pfit" ${encFilter.fit ? 'checked' : ''}> Level ${M.L + ((+ENC.victories || 0) >= 6 ? 3 : 2)} or lower</label></div></div>
    <div class="pick-list" id="plist"></div></div></div>`;
  drawPicker();
  // events
  $('#encname').oninput = e => { ENC.name = e.target.value; saveEnc(); };
  const pf = (id, k) => $(id).onchange = e => { ENC[k] = Math.max(0, parseInt(e.target.value) || 0); if (k === 'level') ENC[k] = Math.max(1, Math.min(10, ENC[k])); if (k === 'heroes') ENC[k] = Math.max(1, ENC[k]); saveEnc(); encounterPage(); };
  pf('#ph', 'heroes'); pf('#pl', 'level'); pf('#pv', 'victories'); pf('#pr', 'retainers');
  $('#pq').oninput = e => { encFilter.q = e.target.value; drawPicker(); };
  $$('[data-kind]').forEach(p => p.onclick = () => { encFilter.kind = p.dataset.kind; $$('[data-kind]').forEach(x => x.classList.toggle('inc', x === p)); drawPicker(); });
  $('#pfit').onchange = e => { encFilter.fit = e.target.checked; drawPicker(); };
  $('#addgrp').onclick = () => { ENC.groups.push({ id: 'g' + Date.now().toString(36), name: 'Group ' + (ENC.groups.length + 1), entries: [] }); saveEnc(); encounterPage(); };
  $('#frombook').onclick = () => bookEncounterSheet();
  $('#stonebtn').onclick = () => { if (!STONES_ON) { stonesDialog(); return; } assignStones(true); saveEnc(); encounterPage(); toast('New stone colours'); };
  $('#stonecfg').onclick = stonesDialog;
  $('#autogrp').onclick = () => { autoArrange(); saveEnc(); encounterPage(); toast('Arranged into initiative groups'); };
  $('#encnew').onclick = () => { ENC = newEnc({ heroes: ENC.heroes, level: ENC.level, victories: ENC.victories, retainers: ENC.retainers }); saveEnc(); encounterPage(); };
  $('#encsave').onclick = () => { ENCS = ENCS.filter(e => e.id !== ENC.id); ENCS.unshift(JSON.parse(JSON.stringify(ENC))); store.set('encs', ENCS.slice(0, 50)); toast('Encounter saved'); encounterPage(); };
  if ($('#encload')) $('#encload').onchange = e => { const x = ENCS.find(s => s.id === e.target.value); if (x) { ENC = JSON.parse(JSON.stringify(x)); saveEnc(); encounterPage(); } };
  $('#encpdf').onclick = exportEncounterPdf;
  if ($('#sessdetach')) $('#sessdetach').onclick = () => { delete ENC.sessionRef; ENC.id = 'e' + Date.now().toString(36); store.set('enc', ENC); encounterPage(); toast('This is now a separate copy'); };
  $('#openpick').onclick = () => { $('#picker').classList.add('on'); showScrim(() => $('#picker').classList.remove('on')); setTimeout(() => $('#pq').focus(), 50); };
  $('#closepick').onclick = () => { $('#picker').classList.remove('on'); hideScrim(); };
  $('#groups').onclick = groupClick; $('#groups').onchange = groupChange;
  document.title = 'Encounter Builder — Vanadium';
  if (ENC.setup) setupDialog();
}
function entStones(g, e, m) {
  if (!STONES_ON || isObstacle(m) || !ENC.stones) return '';
  const S = ENC.stones; let out = '';
  if (isMinion(m)) { for (let k = 0; k < Math.ceil(e.n / 4); k++) { const c = S[`${g.id}|${e.gid}|s${k}`]; if (c) out += swatch(c, true); } }
  else for (let k = 0; k < e.n; k++) { const key = `${g.id}|${e.gid}|${k}`, c = S[key]; if (c) out += swatch(c, false, c.replace(/\*$/, '') + ' stone' + (encLeads(key) ? ' · captain of the ' + c.replace(/\*$/, '') + ' squad' : '')); }
  return out ? `<span class="stones">${out}</span>` : '';
}
let _leadCache = null;
const encLeads = key => { if (!_leadCache) { _leadCache = {}; encUnits().forEach(u => { if (u.leads) _leadCache[u.key] = u.leads; }); setTimeout(() => _leadCache = null, 0); } return _leadCache[key]; };
function groupHtml(g, gi, M) {
  const gev = g.entries.reduce((s, e) => s + (MON[e.gid] ? entryEV(MON[e.gid], e.n) : 0), 0);
  const tone = !g.entries.length ? '' : gev < M.heroES ? 'low' : gev > 2 * M.heroES ? 'high' : 'ok';
  return `<div class="grp" data-g="${gi}"><div class="grp-t"><input class="gname" data-gn="${gi}" value="${esc(g.name)}"><span class="gev ${tone}" title="Recommended ${M.heroES}–${2 * M.heroES} EV">${Math.round(gev * 100) / 100} EV</span><button class="ibtn" data-delg="${gi}" title="Remove group">✕</button></div>
   ${g.entries.length ? g.entries.map((e, ei) => { const m = MON[e.gid]; if (!m) return ''; const mn = isMinion(m);
    return `<div class="ent"><div class="ent-n"><a class="lnk" data-go="monsters--${m.gid}">${esc(m.name)}</a>${entStones(g, e, m)}<span>Lv ${m.level} ${esc(m.role)} · ${mn ? `${esc(m.ev)}` : `EV ${esc(m.ev)}`} · Stamina ${esc((m.stats || {}).Stamina || '—')}</span></div>
     <div class="step"><button data-dec="${gi}:${ei}">−</button><b>${e.n}</b><button data-inc="${gi}:${ei}">+</button></div>
     <select data-mv="${gi}:${ei}" title="Move to group">${ENC.groups.map((gg, k) => `<option value="${k}" ${k === gi ? 'selected' : ''}>${esc(gg.name)}</option>`).join('')}<option value="new">New group</option></select>
     <button class="ibtn" data-rm="${gi}:${ei}" title="Remove">✕</button></div>`; }).join('') : `<div class="gempty">Empty: add monsters from the list${isMob ? ' (+ Monsters)' : ' on the right'}.</div>`}</div>`;
}
function groupClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const pair = s => s.split(':').map(Number);
  if (b.dataset.inc || b.dataset.dec) {
    const [gi, ei] = pair(b.dataset.inc || b.dataset.dec); const en = ENC.groups[gi].entries[ei]; const m = MON[en.gid];
    const step = isMinion(m) ? 1 : 1;
    en.n = Math.max(0, en.n + (b.dataset.inc ? step : -step)); if (!en.n) ENC.groups[gi].entries.splice(ei, 1);
  } else if (b.dataset.rm) { const [gi, ei] = pair(b.dataset.rm); ENC.groups[gi].entries.splice(ei, 1); }
  else if (b.dataset.delg) { const gi = +b.dataset.delg; const ents = ENC.groups[gi].entries; ENC.groups.splice(gi, 1); if (!ENC.groups.length) ENC.groups.push({ id: 'g1', name: 'Group 1', entries: [] }); if (ents.length) ENC.groups[0].entries.push(...ents); }
  else return;
  saveEnc(); encounterPage();
}
function groupChange(e) {
  const t = e.target;
  if (t.dataset.gn) { ENC.groups[+t.dataset.gn].name = t.value || 'Group'; saveEnc(); return; }
  if (t.dataset.mv) {
    const [gi, ei] = t.dataset.mv.split(':').map(Number); const en = ENC.groups[gi].entries.splice(ei, 1)[0];
    if (t.value === 'new') ENC.groups.push({ id: 'g' + Date.now().toString(36), name: 'Group ' + (ENC.groups.length + 1), entries: [en] });
    else ENC.groups[+t.value].entries.push(en);
    saveEnc(); encounterPage();
  }
}
function drawPicker() {
  const M = encMath(); const hi = M.L + ((+ENC.victories || 0) >= 6 ? 3 : 2);
  const toks = encFilter.q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = MONS.filter(m => (encFilter.kind === 'obstacles') === isObstacle(m));
  if (encFilter.fit && encFilter.kind === 'creatures') list = list.filter(m => isSolo(m) ? m.level <= M.L + 1 : m.level <= hi);
  if (toks.length) list = list.filter(m => { const s = (m.name + ' ' + m.role + ' ' + (m.keywords || []).join(' ') + ' ' + (m.group || '')).toLowerCase(); return toks.every(t => s.includes(t)); });
  list = list.slice().sort((a, b) => toks.length ? (a.name.toLowerCase().startsWith(toks[0]) ? -1 : 0) - (b.name.toLowerCase().startsWith(toks[0]) ? -1 : 0) || a.level - b.level : a.level - b.level || a.name.localeCompare(b.name));
  const box = $('#plist'); if (!box) return;
  box.innerHTML = list.slice(0, 300).map(m => `<div class="prow"><div class="pn"><a class="lnk" data-go="monsters--${m.gid}">${esc(m.name)}</a><span>Lv ${m.level} ${esc(m.role)} · ${esc(m.group || '')}</span></div><span class="pev">${isMinion(m) ? esc(m.ev).replace(' for four minions', '/4') : 'EV ' + esc(m.ev)}</span><button class="addm" data-add="${m.gid}" title="Add">+</button></div>`).join('') || '<div class="empty">No matches.</div>';
  box.onclick = e => { const b = e.target.closest('[data-add]'); if (!b) return; addToEncounter(b.dataset.add); };
}
function addToEncounter(gid, quiet) {
  const m = MON[gid]; if (!m) return;
  const n = isMinion(m) ? 4 : 1;
  // add to last group that already has it, else last non-empty-or-first group
  let g = ENC.groups.find(gg => gg.entries.some(e => e.gid === gid));
  if (g) { const e = g.entries.find(x => x.gid === gid); e.n += n; }
  else {
    g = ENC.groups[ENC.groups.length - 1];
    if (g.entries.length && (isMinion(m) || isSolo(m) || isObstacle(m))) { g = { id: 'g' + Date.now().toString(36), name: isObstacle(m) ? 'Terrain' : 'Group ' + (ENC.groups.length + 1), entries: [] }; ENC.groups.push(g); }
    g.entries.push({ gid, n });
  }
  saveEnc();
  if (location.hash.slice(1) === 'encounter') { const keep = $('#plist')?.scrollTop; const open = $('#picker')?.classList.contains('on'); encounterPage(); if (open) { $('#picker').classList.add('on'); showScrim(() => $('#picker').classList.remove('on')); } if ($('#plist')) $('#plist').scrollTop = keep || 0; }
  if (!quiet) toast(`Added ${n > 1 ? n + ' × ' : ''}${esc(m.name)} · ${encMath().ev} EV (${encMath().diff})`);
}
function autoArrange() {
  const M = encMath(); const all = [];
  for (const g of ENC.groups) for (const e of g.entries) all.push({ ...e });
  const merged = {}; for (const e of all) merged[e.gid] = (merged[e.gid] || 0) + e.n;
  const groups = []; const terrain = [];
  const items = [];
  for (const [gid, n] of Object.entries(merged)) {
    const m = MON[gid]; if (!m) continue;
    if (isObstacle(m)) { terrain.push({ gid, n }); continue; }
    if (isMinion(m)) { let left = n; while (left > 0) { const k = Math.min(8, left > 8 && left < 12 ? Math.ceil(left / 2) : left); items.push({ gid, n: k, ev: entryEV(m, k), minion: true }); left -= k; } }
    else for (let i = 0; i < n; i++) items.push({ gid, n: 1, ev: evNum(m), solo: isSolo(m) || /Leader/.test(m.role) });
  }
  items.sort((a, b) => b.ev - a.ev);
  for (const it of items) {
    if (it.solo || it.ev >= 2 * M.heroES) { groups.push({ entries: [it], ev: it.ev }); continue; }
    let best = null;
    for (const g of groups) { if (g.locked) continue; if (g.ev + it.ev <= 2 * M.heroES && (!best || g.ev < best.ev)) best = g; }
    if (best && best.ev < M.heroES) { best.entries.push(it); best.ev += it.ev; }
    else groups.push({ entries: [it], ev: it.ev });
    if (it.solo) groups[groups.length - 1].locked = true;
  }
  // merge stacked single-creature same-type entries
  ENC.groups = groups.map((g, i) => { const c = {}; for (const e of g.entries) c[e.gid] = (c[e.gid] || 0) + e.n; return { id: 'g' + i + Date.now().toString(36), name: 'Group ' + (i + 1), entries: Object.entries(c).map(([gid, n]) => ({ gid, n })) }; });
  if (terrain.length) ENC.groups.push({ id: 'gt' + Date.now().toString(36), name: 'Terrain', entries: terrain });
  if (!ENC.groups.length) ENC.groups.push({ id: 'g1', name: 'Group 1', entries: [] });
}
function setupDialog() {
  if (document.querySelector('.dlg.setupdlg')) return;
  const el = document.createElement('div');
  el.className = 'dlg setupdlg';
  el.innerHTML = `<div class="dlg-b"><h2>Who's fighting?</h2><p>Tell me about the party so I can work out the encounter strength.</p>
    <div class="party dlgp"><label>Heroes<input type="number" id="dh" min="1" max="12" value="${ENC.heroes}" inputmode="numeric"></label><label>Hero level<input type="number" id="dl" min="1" max="10" value="${ENC.level}" inputmode="numeric"></label><label>Avg. Victories<input type="number" id="dv" min="0" max="30" value="${ENC.victories}" inputmode="numeric"></label><label>Retainers / NPC allies<input type="number" id="dr" min="0" max="6" value="${ENC.retainers || 0}" inputmode="numeric"></label></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" id="dok">Start building</button></div></div>`;
  document.body.appendChild(el);
  setTimeout(() => $('#dh').select(), 50);
  $('#dok').onclick = () => {
    ENC.heroes = Math.max(1, parseInt($('#dh').value) || 4); ENC.level = Math.max(1, Math.min(10, parseInt($('#dl').value) || 1));
    ENC.victories = Math.max(0, parseInt($('#dv').value) || 0); ENC.retainers = Math.max(0, parseInt($('#dr').value) || 0);
    ENC.setup = false; saveEnc(); el.remove(); encounterPage();
  };
}

// ---------- PDF export ----------
const pdfText = s => [...strip(String(s ?? '').replace(/<\/span>/g, '</span> ')).replace(/ ([,;.])/g, '$1').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/−/g, '-').replace(/\s+/g, ' ')].map(c => WINANSI_OK.test(c) ? c : '?').join('').trim();
async function exportEncounterPdf() {
  const live = ENC.groups.filter(g => g.entries.some(e => MON[e.gid]));
  if (!live.length) { toast('Add some monsters first'); return; }
  await runPdfJob($('#encpdf'), 'Export PDF', async () => {
    const bytes = await buildEncounterPdf(ENC);
    await deliverFile((ENC.name || 'encounter').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '-initiative.pdf', new Blob([bytes], { type: 'application/pdf' }));
  });
}
async function buildEncounterPdf(E) {
  const SAVED = ENC; ENC = E;
  try {
    if (STONES_ON) assignStones(false);
    const M = encMath();
    const live = ENC.groups.filter(g => g.entries.some(e => MON[e.gid]));
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    const doc = await PDFDocument.create();
    doc.setTitle(ENC.name); doc.setCreator('Vanadium');
    const F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold), FI = await doc.embedFont(StandardFonts.HelveticaOblique);
    const W = 595.28, H = 841.89, MG = 30; const CW = W - 2 * MG;
    const ink = rgb(0.1, 0.1, 0.1), grey = rgb(0.45, 0.45, 0.45), light = rgb(0.9, 0.9, 0.9), accent = rgb(0.78, 0.36, 0.15), dark = rgb(0.17, 0.16, 0.15);
    let page, y;
    const newPage = () => { page = doc.addPage([W, H]); y = H - MG; footer(); };
    const footer = () => { page.drawText(pdfText(`${ENC.name} · Vanadium · Draw Steel © MCDM Productions, LLC — used under the DRAW STEEL Creator License`), { x: MG, y: 16, size: 6.5, font: F, color: grey }); page.drawText(String(doc.getPageCount()), { x: W - MG - 10, y: 16, size: 7, font: F, color: grey }); };
    const T = (s, x, yy, size = 9, font = F, color = ink) => page.drawText(pdfText(s), { x, y: yy, size, font, color });
    const tw = (s, size, font = F) => font.widthOfTextAtSize(pdfText(s), size);
    const wrap = (s, width, size, font = F) => { const words = pdfText(s).split(' '); const out = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > width && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; };
    const box = (x, yy, w, h, o = {}) => page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: o.border || ink, borderWidth: o.bw ?? 0.8, ...(o.fill ? { color: o.fill } : {}) });
    const ensure = h => { if (y - h < MG + 14) newPage(); };
    newPage();
    // ---- header
    page.drawRectangle({ x: 0, y: H - 64, width: W, height: 64, color: dark });
    T(ENC.name, MG, H - 36, 20, FB, rgb(1, 1, 1));
    T(`${ENC.heroes} heroes${ENC.retainers ? ' + ' + ENC.retainers + ' retainers' : ''} · level ${M.L} · ${ENC.victories} avg. Victories`, MG, H - 53, 9, F, rgb(0.85, 0.85, 0.85));
    const dtxt = `${M.diff.toUpperCase()} · ${M.ev} EV vs ES ${M.ES} · worth ${M.worth} Victor${M.worth === 1 ? 'y' : 'ies'}`;
    T(dtxt, W - MG - tw(dtxt, 10, FB), H - 36, 10, FB, rgb(0.95, 0.6, 0.35));
    y = H - 84;
    // ---- malice tracker
    const rounds = 8; const nh = (+ENC.heroes || 0);
    T('MALICE', MG, y, 10, FB); T(`Start: ${+ENC.victories || 0} (avg. Victories). Each round gain heroes alive + round number.`, MG + 50, y, 8, F, grey);
    y -= 8;
    const cw = (CW - 70) / rounds;
    box(MG, y - 34, 70, 34, { fill: light }); T('Current', MG + 6, y - 13, 8, FB); T('Malice', MG + 6, y - 24, 8, FB);
    for (let r = 0; r < rounds; r++) { const x = MG + 70 + r * cw; box(x, y - 34, cw, 34); T(`R${r + 1}  +${nh + r + 1}`, x + 4, y - 10, 7.5, FB, grey); }
    y -= 50;
    // ---- fewer heroes
    { const sc = encScaling(); const ba = ENC.bookAdjust;
      if (sc.length || ba) {
        const lines = [];
        sc.forEach(x => lines.push([`For ${x.n} hero${x.n > 1 ? 'es' : ''}: `, (x.text.length ? 'remove ' + x.text.join(', ') : 'no change needed') + ` (${x.ev} EV vs ES ${x.es}, ${x.diff})`]));
        if (ba) ba.forEach((l, i) => lines.push([i ? '' : 'From the book: ', i ? '• ' + l : l, !!i]));
        T('FEWER HEROES?', MG, y, 10, FB); T('If someone can’t make it, take these creatures out to keep the difficulty.', MG + 92, y, 8, F, grey); y -= 6;
        const wl = []; lines.forEach(([a2, b2, ind]) => { const w = wrap(b2, CW - 20 - Math.max(tw(a2, 8, FB), tw('From the book: ', 8, FB)), 8); const ax = Math.max(tw(a2, 8, FB) + 3, ind ? tw('From the book: ', 8, FB) + 3 : 0); w.forEach((t, i) => wl.push([i ? '' : a2, t, ax])); });
        const bh = wl.length * 10.5 + 8; box(MG, y - bh, CW, bh, { fill: rgb(0.97, 0.95, 0.92), bw: 0.6 });
        wl.forEach(([a2, t, ax], i) => { const yy = y - 12 - i * 10.5; if (a2) T(a2, MG + 6, yy, 8, FB); T(t, MG + 6 + ax, yy, 8, F); });
        y -= bh + 16;
      } }
    // ---- turn tracker
    T('TURN ORDER', MG, y, 10, FB); T('Tick each side when it acts. Heroes and Director alternate choosing who goes next.', MG + 78, y, 8, F, grey); y -= 6;
    const rowH = 15, nameW = 170, rc = (CW - nameW) / rounds;
    const trow = (label, sub, fillc) => { ensure(rowH); box(MG, y - rowH, nameW, rowH, { fill: fillc }); T(label, MG + 4, y - 10.5, 8.5, FB); if (sub) { let t2 = pdfText(sub); const avail = nameW - 10 - tw(label, 8.5, FB); while (t2.length > 3 && tw(t2, 7) > avail) t2 = t2.slice(0, -2); if (t2 !== pdfText(sub)) t2 = t2.replace(/\s*\S?$/, '…'); T(t2, MG + 6 + tw(label, 8.5, FB), y - 10.5, 7, F, grey); } for (let r = 0; r < rounds; r++) { const x = MG + nameW + r * rc; box(x, y - rowH, rc, rowH); page.drawRectangle({ x: x + rc / 2 - 4, y: y - rowH + 3.5, width: 8, height: 8, borderColor: grey, borderWidth: 0.6 }); } y -= rowH; };
    box(MG, y - 12, nameW, 12, { fill: light }); T('Side', MG + 4, y - 9, 7.5, FB); for (let r = 0; r < rounds; r++) { box(MG + nameW + r * rc, y - 12, rc, 12, { fill: light }); T('Round ' + (r + 1), MG + nameW + r * rc + 4, y - 9, 7, FB); } y -= 12;
    for (let h = 0; h < nh + (+ENC.retainers || 0); h++) trow(h < nh ? `Hero ${h + 1}: ` : `Retainer ${h - nh + 1}: `, '________________', undefined);
    for (const g of live) { const ge = g.entries.reduce((s, e) => s + (MON[e.gid] ? entryEV(MON[e.gid], e.n) : 0), 0); trow(g.name, `${Math.round(ge * 100) / 100} EV · ` + g.entries.map(e => `${e.n}× ${MON[e.gid]?.name || ''}`).join(', '), rgb(0.97, 0.94, 0.9)); }
    y -= 14;
    // ---- initiative groups with creatures
    const CG = { x: MG + 236, w: CW - 242 };
    const condGrid = (top) => {
      const cols = 5, cw2 = CG.w / cols; const cells = [...CONDS, 'Other:'];
      cells.forEach((c, i) => {
        const cx = CG.x + (i % cols) * cw2, cy = top - 11 - Math.floor(i / cols) * 14;
        if (c === 'Other:') { T(c, cx + 2, cy + 1, 7, FB, grey); page.drawLine({ start: { x: cx + 26, y: cy }, end: { x: CG.x + CG.w, y: cy }, thickness: 0.5, color: grey }); return; }
        page.drawRectangle({ x: cx + 2, y: cy, width: 8.5, height: 8.5, borderColor: ink, borderWidth: 0.7 });
        T(c, cx + 14, cy + 1.5, 7, F, ink);
      });
    };
    const hexRgb = h => { const v = parseInt(String(h).slice(1), 16); return rgb((v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); };
    const stoneName = c => String(c || '').replace(/\*$/, '');
    const drawStone = (c, cx, cy, r, minion) => { const col = hexRgb(stoneHex(stoneName(c))); if (minion) page.drawRectangle({ x: cx - r * 1.2, y: cy - r * 0.8, width: r * 2.4, height: r * 1.6, color: col, borderColor: ink, borderWidth: 0.7 }); else page.drawCircle({ x: cx, y: cy, size: r, color: col, borderColor: ink, borderWidth: 0.7 }); };
    const SU = STONES_ON ? encUnits() : []; const SK = Object.fromEntries(SU.map(u => [u.key, u]));
    const cardHead = (title, meta, info, chars, extra, stone) => {
      let ox = 0; if (stone) { drawStone(stone.c, MG + 13, y - 10.5, 5.5, stone.minion); ox = stone.minion ? 18 : 14; }
      T(title, MG + 6 + ox, y - 14, 11.5, FB); T(meta, MG + 12 + ox + tw(title, 11.5, FB), y - 14, 7.5, F, grey);
      if (chars) T(chars, W - MG - 6 - tw(chars, 7.5, FB), y - 14, 7.5, FB, grey);
      T(info + (extra ? '  ·  ' + extra : ''), MG + 6, y - 25, 7.2, F, grey);
    };
    for (const g of live) {
      const ge = g.entries.reduce((s, e) => s + (MON[e.gid] ? entryEV(MON[e.gid], e.n) : 0), 0);
      ensure(90);
      page.drawRectangle({ x: MG, y: y - 18, width: CW, height: 18, color: dark });
      T(g.name.toUpperCase(), MG + 6, y - 12.5, 10, FB, rgb(1, 1, 1));
      const gt = `${Math.round(ge * 100) / 100} EV`; T(gt, W - MG - 6 - tw(gt, 9, FB), y - 12.5, 9, FB, rgb(0.95, 0.6, 0.35));
      y -= 22;
      for (const e of g.entries) {
        const m = MON[e.gid]; if (!m) continue; const st = m.stats || {}; const S = stam(m);
        const info = [st.Size && 'Size ' + st.Size, st.Speed && 'Speed ' + st.Speed, st.Stability != null && st.Stability !== '' && 'Stability ' + st.Stability, st['Free Strike'] && 'Free strike ' + st['Free Strike'], m.immunity && m.immunity !== '—' && 'Immunity ' + m.immunity, m.weakness && m.weakness !== '—' && 'Weakness ' + m.weakness, m.movement && m.movement !== '—' && 'Move: ' + m.movement].filter(Boolean).join(' · ');
        const chars = Object.keys(m.chars || {}).length ? ['Might', 'Agility', 'Reason', 'Intuition', 'Presence'].map(c => c[0] + ' ' + (m.chars[c] ?? '—')).join('   ') : '';
        const h = 64;
        const copies = isMinion(m) ? 1 : e.n;
        for (let k = 0; k < copies; k++) {
          ensure(h + 6);
          box(MG, y - h, CW, h, { bw: 0.9 });
          const top = y - 30;
          if (isMinion(m)) {
            const cap = (m.extra || []).find(x => /Captain/.test(x.k));
            const sqc = []; for (let q = 0; q < Math.ceil(e.n / 4); q++) sqc.push((ENC.stones || {})[`${g.id}|${e.gid}|s${q}`]);
            const sqTxt = STONES_ON && sqc[0] ? ' · ' + sqc.map(stoneName).join(' / ') + ' chips' : '';
            cardHead(`${e.n} × ${m.name}`, `Lv ${m.level} ${m.role} · squad${sqTxt}`, info, chars, cap ? 'With captain: ' + cap.v : '', STONES_ON && sqc[0] ? { c: sqc[0], minion: true } : null);
            box(MG + 6, top - 28, 70, 26, { fill: rgb(0.97, 0.95, 0.92) }); T('SQUAD STAMINA', MG + 10, top - 9, 6, FB, grey); T(String(S * e.n), MG + 10, top - 23, 12, FB);
            T(`${S} each · cross off`, MG + 82, top - 8, 6.5, F, grey);
            const per = Math.min(e.n, 8), sp = Math.min(18, 148 / Math.max(per, 1));
            for (let q = 0; q < e.n; q++) { const cx = MG + 90 + (q % 8) * sp, cy = top - 19 - Math.floor(q / 8) * 10; const sc = STONES_ON && sqc[Math.floor(q / 4)]; const hx = sc ? stoneHex(stoneName(sc)) : null; page.drawCircle({ x: cx, y: cy, size: 6, borderColor: ink, borderWidth: 0.8, ...(hx ? { color: hexRgb(hx) } : {}) }); T(String(q + 1), cx - (q >= 9 ? 3 : 1.7), cy - 2.3, 6, F, hx ? (lumOf(hx) > 0.55 ? ink : rgb(1, 1, 1)) : grey); }
          } else {
            const ukey = `${g.id}|${e.gid}|${k}`, sc = STONES_ON && !isObstacle(m) ? (ENC.stones || {})[ukey] : null; const lead = SK[ukey]?.leads;
            cardHead(m.name + (e.n > 1 ? ` #${k + 1}` : ''), `Lv ${m.level} ${m.role}${m.ev ? ' · EV ' + m.ev : ''}${sc ? ' · ' + stoneName(sc) + ' stone' + (lead ? ' (captain of the ' + stoneName(sc) + ' squad)' : '') : ''}`, info, chars, '', sc ? { c: sc, minion: false } : null);
            box(MG + 6, top - 28, 58, 26, { fill: rgb(0.97, 0.95, 0.92) }); T('MAX', MG + 10, top - 9, 6, FB, grey); T(String(S || '—'), MG + 10, top - 23, 12, FB);
            box(MG + 68, top - 28, 158, 26); T('STAMINA', MG + 72, top - 9, 6, FB, grey);
            if (S) { const wt = `winded ${Math.floor(S / 2)}`; T(wt, MG + 222 - tw(wt, 6, F), top - 9, 6, F, grey); }
          }
          condGrid(top);
          y -= h + 5;
        }
      }
      y -= 8;
    }
    // ---- stat block reference (card style) ----
    const seen = []; for (const g of live) for (const e of g.entries) if (MON[e.gid] && !seen.includes(e.gid)) seen.push(e.gid);
    const TR = await doc.embedFont(StandardFonts.TimesRoman), TB = await doc.embedFont(StandardFonts.TimesRomanBold), TI = await doc.embedFont(StandardFonts.TimesRomanItalic), TBI = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
    const black = rgb(0.08, 0.07, 0.07), rule = rgb(0.55, 0.55, 0.55), red = rgb(0.71, 0.13, 0.16);
    const san = s => [...String(s).replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/−/g, '-').replace(/ /g, ' ')].map(c => WINANSI_OK.test(c) ? c : '?').join('');
    const dec = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    // html -> runs [{t, b, i, chip}]
    const runsOf = (html) => {
      const out = []; let b = 0, i = 0;
      const re = /<span class="(pot|chr)">(.*?)<\/span>|<(\/?)(b|i|strong|em)>|<[^>]+>|([^<]+)/g; let m;
      while ((m = re.exec(html || ''))) {
        if (m[1]) out.push({ t: dec(m[2]).replace(/\s+/g, ''), chip: m[1] });
        else if (m[4]) { const on = m[3] ? -1 : 1; if (m[4] === 'b' || m[4] === 'strong') b = Math.max(0, b + on); else i = Math.max(0, i + on); }
        else if (m[5]) out.push({ t: dec(m[5]), b: b > 0, i: i > 0 });
      }
      return out;
    };
    const fontOf = r => r.b && r.i ? TBI : r.b ? TB : r.i ? TI : TR;
    const chipW = (t, sz) => FB.widthOfTextAtSize(san(t), sz * 0.78) + 4;
    // wrap runs into lines of atoms
    const wrapRuns = (runs, width, sz) => {
      const atoms = [];
      for (const r of runs) {
        if (r.chip) { atoms.push({ ...r, w: chipW(r.t, sz), sp: 0 }); continue; }
        const parts = san(r.t).split(/(\s+)/);
        for (const p of parts) { if (!p) continue; if (/^\s+$/.test(p)) { if (atoms.length) atoms[atoms.length - 1].sp = 1; continue; } atoms.push({ ...r, t: p, w: fontOf(r).widthOfTextAtSize(p, sz), sp: 0 }); }
      }
      atoms.forEach((a, k) => { if (a.chip === 'pot') { const n = atoms[k + 1]; a.sp = n && !n.chip && /^[,;.:)]/.test(n.t) ? 0 : 1; } });
      const lines = []; let cur = [], w = 0; const spw = TR.widthOfTextAtSize(' ', sz);
      for (const a of atoms) {
        const add = (cur.length && cur[cur.length - 1].sp ? spw : 0) + a.w;
        if (cur.length && w + add > width) { lines.push(cur); cur = [a]; w = a.w; } else { cur.push(a); w += add; }
      }
      if (cur.length) lines.push(cur);
      return lines;
    };
    const drawLine = (atoms, x, yy, sz, color = black) => {
      let cx = x; const spw = TR.widthOfTextAtSize(' ', sz);
      atoms.forEach((a, k) => {
        if (a.chip === 'pot') { page.drawRectangle({ x: cx, y: yy - sz * 0.2, width: a.w, height: sz * 0.98, color: black }); page.drawText(san(a.t), { x: cx + 2, y: yy + sz * 0.02, size: sz * 0.78, font: FB, color: rgb(1, 1, 1) }); }
        else if (a.chip === 'chr') { page.drawRectangle({ x: cx, y: yy - sz * 0.2, width: a.w, height: sz * 0.98, borderColor: black, borderWidth: 0.6 }); page.drawText(san(a.t), { x: cx + 2, y: yy + sz * 0.02, size: sz * 0.78, font: FB, color: black }); }
        else page.drawText(a.t, { x: cx, y: yy, size: sz, font: fontOf(a), color });
        cx += a.w + (a.sp ? spw : 0);
      });
    };
    // icons (drawn in a 9x9 box with top-left at x,yTop)
    const icon = (kind, x, yTop, s = 9) => {
      const o = { x, y: yTop, scale: s / 24 };
      if (kind === 'trig') { page.drawRectangle({ x, y: yTop - s, width: s, height: s, color: black }); page.drawText('!', { x: x + s * 0.36, y: yTop - s * 0.86, size: s * 0.9, font: FB, color: rgb(1, 1, 1) }); return; }
      if (kind === 'trait' || kind === 'vil') { page.drawSvgPath('M12 2l3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z', { ...o, color: kind === 'vil' ? red : black }); return; }
      if (kind === 'area') { page.drawSvgPath('M12 3a9 9 0 1 0 0.01 0z', { ...o, borderColor: black, borderWidth: 2.2 }); page.drawSvgPath('M12 8a4 4 0 1 0 0.01 0z', { ...o, color: black }); return; }
      if (kind === 'ranged') { page.drawSvgPath('M4 20 L20 4 M13 4 H20 V11', { ...o, borderColor: black, borderWidth: 2.4 }); page.drawSvgPath('M3 3h18v18H3z', { ...o, borderColor: black, borderWidth: 1.6 }); return; }
      if (kind === 'both') { page.drawSvgPath('M3 3h18v18H3z', { ...o, borderColor: black, borderWidth: 1.6 }); page.drawSvgPath('M6 18 L18 6 M6 6 L10 10', { ...o, borderColor: black, borderWidth: 2.2 }); return; }
      // melee
      page.drawSvgPath('M3 3h18v18H3z', { ...o, borderColor: black, borderWidth: 1.6 }); page.drawSvgPath('M6 18 L17 7 M14 6 L18 10', { ...o, borderColor: black, borderWidth: 2.2 });
    };
    const distIcon = (x, yTop, s = 8) => page.drawSvgPath('M3 21 V3 L21 21 Z M3 15 L9 21 M3 9 L15 21', { x, y: yTop, scale: s / 24, borderColor: black, borderWidth: 2.4 });
    const tgtIcon = (x, yTop, s = 8) => { const o = { x, y: yTop, scale: s / 24 }; page.drawSvgPath('M12 2a10 10 0 1 0 0.01 0z', { ...o, borderColor: black, borderWidth: 2.4 }); page.drawSvgPath('M12 7a5 5 0 1 0 0.01 0z', { ...o, borderColor: black, borderWidth: 2.4 }); page.drawSvgPath('M12 10.5a1.5 1.5 0 1 0 0.01 0z', { ...o, color: black }); };
    const tierBadge = (n, x, yy, sz) => {
      const w = 21, h = sz * 1.05;
      page.drawRectangle({ x, y: yy - sz * 0.22, width: w, height: h, borderColor: black, borderWidth: 0.7 });
      const lab = ['', '11', '12-16', '17+'][n]; const ls = sz * 0.68;
      let tx = x + (w - FB.widthOfTextAtSize(lab, ls) - (n === 1 ? 5 : 0)) / 2;
      if (n === 1) { // draw ≤
        const gx = tx, gy = yy + sz * 0.05; page.drawLine({ start: { x: gx + 3.2, y: gy + 4.2 }, end: { x: gx, y: gy + 2.6 }, thickness: 0.6, color: black }); page.drawLine({ start: { x: gx, y: gy + 2.6 }, end: { x: gx + 3.2, y: gy + 1 }, thickness: 0.6, color: black }); page.drawLine({ start: { x: gx, y: gy }, end: { x: gx + 3.2, y: gy }, thickness: 0.6, color: black }); tx += 5;
      }
      page.drawText(lab, { x: tx, y: yy + sz * 0.02, size: ls, font: FB, color: black });
      return w;
    };
    const chevronRule = (x, yy, w) => {
      const c = x + w / 2;
      page.drawLine({ start: { x, y: yy }, end: { x: c - 6, y: yy }, thickness: 0.6, color: rule });
      page.drawLine({ start: { x: c - 6, y: yy }, end: { x: c, y: yy - 4 }, thickness: 0.6, color: rule });
      page.drawLine({ start: { x: c, y: yy - 4 }, end: { x: c + 6, y: yy }, thickness: 0.6, color: rule });
      page.drawLine({ start: { x: c + 6, y: yy }, end: { x: x + w, y: yy }, thickness: 0.6, color: rule });
    };
    // column flow
    const GAP = 18, BW = (CW - GAP) / 2; let col = 0, colTop;
    newPage(); T('STAT BLOCK REFERENCE', MG, y - 4, 12, FB, grey); y -= 20; colTop = y;
    const bx = () => MG + col * (BW + GAP);
    const fits = h => y - h >= MG + 16;
    const place = h => { if (fits(h)) return; if (col === 0) { col = 1; y = colTop; } else { newPage(); col = 0; y = H - MG; colTop = y; } };
    // generic "unit": measure with dry run, then place and draw
    const unit = (fn) => { const y0 = y; let dry = true; const ctx = { dry }; const save = y; y = 10000; fn(true); const h = 10000 - y; y = save; place(h); fn(false); return h; };
    const SZ = 8.6, LH = SZ * 1.28, PAD = 6;
    const textBlock = (html, indent, dry, sz = SZ) => {
      const lines = wrapRuns(runsOf(html), BW - indent - PAD * 2, sz);
      for (const ln of lines) { if (!dry) drawLine(ln, bx() + PAD + indent, y - sz, sz); y -= sz * 1.28; }
    };
    const twoCol = (left, right, dry, fl = TR, fr = TR, sz = SZ, iconL, iconR) => {
      if (!dry) {
        let lx = bx() + PAD; if (iconL) { iconL(lx, y - 1.2); lx += 11; }
        if (left) page.drawText(san(left), { x: lx, y: y - sz, size: sz, font: fl, color: black });
        if (right) { const rw = fr.widthOfTextAtSize(san(right), sz); const rx = bx() + BW - PAD - rw; page.drawText(san(right), { x: rx, y: y - sz, size: sz, font: fr, color: black }); if (iconR) iconR(rx - 11, y - 1.2); }
      }
      y -= sz * 1.3;
    };
    const fitText = (s, w, f, sz) => { s = san(s); if (f.widthOfTextAtSize(s, sz) <= w) return s; while (s.length > 3 && f.widthOfTextAtSize(s + '…', sz) > w) s = s.slice(0, -1); return s + '…'; };
    for (const gid of seen) {
      const m = MON[gid]; const st = m.stats || {};
      const gcols = []; if (STONES_ON) { const seenC = new Set(); for (const u of SU) if (u.m.gid === gid) { const c = (ENC.stones || {})[u.key]; if (c && !seenC.has(c)) { seenC.add(c); gcols.push({ c: stoneName(c), minion: u.minion, label: stoneName(c) + (u.minion ? ' chips' : '') }); } } }
      // header + stats + defences + characteristics as one unit
      unit(dry => {
        const top = y, hh = 34;
        if (!dry) {
          const strips = 14;
          if (gcols.length) { // tint the header with the creature's stone colour(s)
            const segW = BW / gcols.length;
            gcols.forEach((c, si) => { const v = parseInt(stoneHex(c.c).slice(1), 16), R = (v >> 16) / 255, G = ((v >> 8) & 255) / 255, B = (v & 255) / 255;
              for (let s2 = 0; s2 < strips; s2++) { const t = s2 / (strips - 1), k = 0.62 - 0.5 * t, mix = (ch) => Math.min(1, ch * k + (1 - k)); page.drawRectangle({ x: bx() + si * segW, y: top - (s2 + 1) * hh / strips, width: segW + 0.3, height: hh / strips + 0.3, color: rgb(mix(R), mix(G), mix(B)) }); } });
          } else for (let s = 0; s < strips; s++) { const t = s / (strips - 1); page.drawRectangle({ x: bx(), y: top - (s + 1) * hh / strips, width: BW, height: hh / strips + 0.3, color: rgb(0.93 + 0.06 * t, 0.55 + 0.4 * t, 0.55 + 0.4 * t) }); }
          page.drawText(fitText(m.name, BW * 0.58, TB, 13), { x: bx() + PAD, y: top - 14, size: 13, font: TB, color: black });
          const lv = `Level ${m.level} ${m.role}`; const ls = TB.widthOfTextAtSize(san(lv), 9) > BW * 0.42 ? 7.5 : 9;
          page.drawText(san(lv), { x: bx() + BW - PAD - TB.widthOfTextAtSize(san(lv), ls), y: top - 13, size: ls, font: TB, color: black });
          page.drawText(fitText((m.keywords || []).join(', ') || '—', BW * 0.6, TR, 8.5), { x: bx() + PAD, y: top - 26, size: 8.5, font: TR, color: black });
          const ev = m.ev ? 'EV ' + m.ev : ''; if (ev) { const es = TR.widthOfTextAtSize(san(ev), 8.5) > BW * 0.38 ? 7 : 8.5; page.drawText(san(ev), { x: bx() + BW - PAD - TR.widthOfTextAtSize(san(ev), es), y: top - 26, size: es, font: TR, color: black }); }
          chevronRule(bx(), top - hh, BW);
        }
        y = top - hh - 6;
        if (gcols.length) {
          if (!dry) { let cx = bx() + PAD; page.drawText('On the grid:', { x: cx, y: y - 8, size: 7.5, font: TB, color: black }); cx += TB.widthOfTextAtSize('On the grid:', 7.5) + 6;
            for (const c of gcols) { const lab = san(c.label); const need = 12 + TR.widthOfTextAtSize(lab, 7.5) + 8; if (cx + need > bx() + BW) break; drawStone(c.c, cx + 4, y - 5.5, 3.6, c.minion); page.drawText(lab, { x: cx + 10, y: y - 8, size: 7.5, font: TR, color: black }); cx += need; } }
          y -= 13;
        }
        const keys = ['Size', 'Speed', 'Stamina', 'Stability', 'Free Strike'].filter(k => k in st);
        if (keys.length) {
          if (!dry) { const cw = BW / keys.length; keys.forEach((k, i) => { const cx = bx() + cw * i + cw / 2; const v = san(st[k] || '—'); page.drawText(v, { x: cx - TR.widthOfTextAtSize(v, 13) / 2, y: y - 13, size: 13, font: TR, color: black }); page.drawText(k, { x: cx - TB.widthOfTextAtSize(k, 8) / 2, y: y - 23, size: 8, font: TB, color: black }); }); }
          y -= 30;
        }
        const lbl = (lab, val, x, right) => { const a = san(lab + ': '), b2 = san(val || '—'); const w = TB.widthOfTextAtSize(a, SZ) + TR.widthOfTextAtSize(b2, SZ); const sx = right ? bx() + BW - PAD - w : x; page.drawText(a, { x: sx, y: y - SZ, size: SZ, font: TB, color: black }); page.drawText(b2, { x: sx + TB.widthOfTextAtSize(a, SZ), y: y - SZ, size: SZ, font: TR, color: black }); };
        if (m.immunity || m.weakness) { if (!dry) { lbl('Immunity', m.immunity, bx() + PAD); lbl('Weakness', m.weakness, 0, true); } y -= LH; }
        if (m.movement) { if (!dry) lbl('Movement', m.movement, bx() + PAD); y -= LH; }
        for (const x2 of m.extra || []) textBlock(`<b>${esc(x2.k)}:</b> ${esc(x2.v)}`, 0, dry);
        if (Object.keys(m.chars || {}).length) {
          y -= 2; const bh = 13;
          if (!dry) {
            page.drawRectangle({ x: bx() + 2, y: y - bh, width: BW - 4, height: bh, borderColor: black, borderWidth: 0.7 });
            const cw = (BW - 4) / 5;
            ['Might', 'Agility', 'Reason', 'Intuition', 'Presence'].forEach((c, i) => {
              let cx = bx() + 2 + cw * i + 4; const yy = y - bh + 3.6;
              const L = c[0], rest = c.slice(1); const lw = FB.widthOfTextAtSize(L, 7) + 3;
              page.drawRectangle({ x: cx, y: yy - 1.6, width: lw, height: 8.6, color: black }); page.drawText(L, { x: cx + 1.5, y: yy, size: 7, font: FB, color: rgb(1, 1, 1) }); cx += lw;
              page.drawText(rest, { x: cx, y: yy, size: 7.6, font: TR, color: black }); cx += TR.widthOfTextAtSize(rest, 7.6) + 2.5;
              page.drawText(san(m.chars[c] ?? '—'), { x: cx, y: yy, size: 7.6, font: TR, color: black });
            });
          }
          y -= bh + 4;
        }
        if (m.desc) textBlock(`<i>${m.desc.replace(/<\/?i>/g, '')}</i>`, 0, dry, 8);
      });
      // abilities
      for (const a of m.items || []) {
        unit(dry => {
          if (!dry) chevronRule(bx(), y, BW);
          y -= 8;
          const k = abKind(a); const kind = k === 'melee' && /Ranged/.test((a.keywords || []).join(' ')) ? 'both' : k;
          // header line
          if (!dry) {
            icon(kind, bx() + PAD, y - 0.5);
            let x = bx() + PAD + 13; const nm = san(a.name);
            page.drawText(nm, { x, y: y - 8.6, size: 9.6, font: TB, color: black }); x += TB.widthOfTextAtSize(nm, 9.6) + 4;
            if (a.roll) page.drawText(san(a.roll), { x, y: y - 8.6, size: 8.8, font: TR, color: black });
            if (a.cost) { const c = san(a.cost); page.drawText(c, { x: bx() + BW - PAD - TB.widthOfTextAtSize(c, 9), y: y - 8.6, size: 9, font: TB, color: /villain/i.test(c) ? red : black }); }
          }
          y -= 12;
          if ((a.keywords || []).length || a.action) twoCol((a.keywords || []).join(', ') || '—', a.action, dry);
          if (a.distance || a.target) {
            const d = strip(a.distance), t = strip(a.target);
            const tw2 = TR.widthOfTextAtSize(san(t), SZ), dw = TR.widthOfTextAtSize(san(d), SZ);
            if (dw + tw2 + 40 > BW - PAD * 2) { twoCol(d, '', dry, TR, TR, SZ, (x, yy) => distIcon(x, yy)); twoCol('', fitText(t, BW - 30, TR, SZ), dry, TR, TR, SZ, null, (x, yy) => tgtIcon(x, yy)); }
            else twoCol(d, t, dry, TR, TR, SZ, (x, yy) => distIcon(x, yy), (x, yy) => tgtIcon(x, yy));
          }
          y -= 2;
          for (const r of a.rows || []) {
            if (r.k === 'roll') continue;
            if (r.k === 'tier') {
              const lines = wrapRuns(runsOf(r.html), BW - PAD * 2 - 26, SZ);
              lines.forEach((ln, li) => { if (!dry) { if (li === 0) tierBadge(r.n, bx() + PAD, y - SZ, SZ); drawLine(ln, bx() + PAD + 26, y - SZ, SZ); } y -= LH; });
            } else { y -= 1.5; textBlock(r.html, 0, dry); }
          }
          y -= 4;
        });
      }
      unit(dry => { if (!dry) page.drawLine({ start: { x: bx(), y }, end: { x: bx() + BW, y }, thickness: 0.8, color: rule }); y -= 18; });
    }
    // ---- player damage tracker ----
    if (STONES_ON && SU.length) {
      newPage();
      page.drawRectangle({ x: 0, y: H - 56, width: W, height: 56, color: dark });
      T('DAMAGE TRACKER', MG, H - 32, 18, FB, rgb(1, 1, 1));
      T('For the players. Each row is one stone (or one minion squad of chips) on the grid.', MG, H - 47, 8.5, F, rgb(0.85, 0.85, 0.85));
      y = H - 74;
      const order = STONES.map(x => x.name);
      const rows = SU.map(u => ({ c: (ENC.stones || {})[u.key], minion: u.minion, size: u.size, cap: !!u.leads }))
        .sort((a, b) => order.indexOf(stoneName(a.c)) - order.indexOf(stoneName(b.c)) || (a.minion - b.minion));
      const C1 = 96, C2 = 178, C3 = 150, C4 = CW - C1 - C2 - C3, RH = 104;
      const hdr = () => { box(MG, y - 16, CW, 16, { fill: light }); [['Creature', 0], ['Description', C1], ['Damage dealt', C1 + C2], ['Statuses', C1 + C2 + C3]].forEach(([t, x]) => T(t.toUpperCase(), MG + x + 5, y - 11, 7, FB, grey)); y -= 16; };
      hdr();
      const short = ['Bleeding', 'Dazed', 'Frightened', 'Grabbed', 'Prone', 'Restrained', 'Slowed', 'Taunted', 'Weakened'];
      for (const r of rows) {
        if (y - RH < MG + 14) { newPage(); y = H - MG; hdr(); }
        box(MG, y - RH, CW, RH, { bw: 0.8 });
        [C1, C1 + C2, C1 + C2 + C3].forEach(x => page.drawLine({ start: { x: MG + x, y }, end: { x: MG + x, y: y - RH }, thickness: 0.6, color: grey }));
        const nm = stoneName(r.c), dup = /\*$/.test(r.c || '');
        if (r.minion) {
          for (let q = 0; q < (r.size || 4); q++) drawStone(r.c, MG + 14 + q * 17, y - 17, 5.5, true);
          T(nm + (dup ? ' (2)' : ''), MG + 7, y - 38, 12, FB); T(`Minion squad (${r.size || 4})`, MG + 7, y - 50, 7.5, F, grey);
          T('Minions down:', MG + 7, y - 70, 7, F, grey); for (let q = 0; q < (r.size || 4); q++) page.drawRectangle({ x: MG + 7 + q * 16, y: y - 88, width: 12, height: 12, borderColor: ink, borderWidth: 0.7 });
        } else {
          drawStone(r.c, MG + 19, y - 21, 11, false);
          T(nm + (dup ? ' (2)' : ''), MG + 7, y - 48, 12, FB);
          if (r.cap) { T('leads a', MG + 7, y - 60, 7, F, grey); T('minion squad', MG + 7, y - 69, 7, F, grey); }
        }
        for (let l = 1; l <= 4; l++) page.drawLine({ start: { x: MG + C1 + 7, y: y - 2 - l * 23 }, end: { x: MG + C1 + C2 - 7, y: y - 2 - l * 23 }, thickness: 0.45, color: rgb(0.75, 0.75, 0.75) });
        const dx = MG + C1 + C2; T('Total', dx + 7, y - RH + 9, 7, F, grey); page.drawRectangle({ x: dx + 32, y: y - RH + 5, width: C3 - 40, height: 16, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
        const sx = MG + C1 + C2 + C3, cw2 = C4 / 2;
        short.forEach((c, i) => { const cx = sx + 6 + (i % 2) * cw2, cy = y - 18 - Math.floor(i / 2) * 18; page.drawRectangle({ x: cx, y: cy, width: 9, height: 9, borderColor: ink, borderWidth: 0.7 }); T(c, cx + 12, cy + 1.5, 7, F); });
        y -= RH;
      }
      y -= 10; if (y > MG + 40) { T('Notes', MG, y - 4, 9, FB, grey); for (let l = 1; l * 18 < y - MG - 30; l++) page.drawLine({ start: { x: MG, y: y - 6 - l * 18 }, end: { x: W - MG, y: y - 6 - l * 18 }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) }); }
    }
    return await doc.save();
  } finally { ENC = SAVED; }
}


// ================= NEGOTIATION TRACKER =================
const MOTIVES = ['Benevolence', 'Discovery', 'Freedom', 'Greed', 'Higher Authority', 'Justice', 'Legacy', 'Peace', 'Power', 'Protection', 'Revelry', 'Vengeance'];
const ATTITUDES = [['Hostile', 1, 2, 'Openly opposed to the heroes. Barely willing to listen.'], ['Suspicious', 2, 2, 'Doubts the heroes’ motives but is willing to listen.'], ['Neutral', 2, 3, 'Would rather be somewhere else, but doesn’t want to be rude.'], ['Open', 3, 3, 'Willing to listen and help, as long as the heroes aren’t asking too much.'], ['Friendly', 3, 4, 'The heroes seem like the NPC’s people.'], ['Trusting', 3, 5, 'Will help if the characters don’t screw this up.']];
const OFFERS = {
  5: ['Yes, and …', 'Offers everything the heroes asked for, and sweetens the deal. This is their best and final offer.'],
  4: ['Yes.', 'Offers everything the heroes asked for and accepts what they offered, without sweetening the deal.'],
  3: ['Yes, but …', 'Gives the heroes what they want for everything they offered, plus a little extra: a favor or a payment.'],
  2: ['No, but …', 'Can’t give the heroes what they want, but offers less impactful goods or services for what they promised.'],
  1: ['No.', 'Rejects the idea outright, without a counteroffer. May press the heroes for a better deal.'],
  0: ['No, and …', 'Offers nothing, refuses to negotiate further, and seeks to harm the heroes.']
};
const RESP = {
  positive: ['That’s an excellent point.', 'You’ve given me much to consider.', 'Fair enough.', 'Makes sense to me.'],
  negative: ['I don’t buy that.', 'Poppycock!', 'I hear you, but I disagree.', 'That’s not going to sway me.'],
  impatient: ['I’ve heard that before.', 'Are you going to offer me anything real?', 'This debate is tiresome.', 'BORING!']
};
const canonMotive = s => { const t = String(s || '').trim().toLowerCase(); return MOTIVES.find(m => m.toLowerCase() === t) || (t ? String(s).trim().replace(/\s+/g, ' ') : ''); };
const clamp5 = n => Math.max(0, Math.min(5, n));

// ---- extract negotiation stat blocks from any book ----
function negStatsFromText(t, o) {
  let m;
  if ((m = t.match(/Interest:\s*(\d)/i))) o.interest = +m[1];
  if ((m = t.match(/Patience:\s*(\d)/i))) o.patience = +m[1];
  if ((m = t.match(/Impression(?: Score)?:\s*(\d+)/i))) o.impression = +m[1];
  if ((m = t.match(/Native Languages?:\s*([^.;]+?)(?=\s+(?:Interest|Patience|Impression):|$)/i))) o.language = m[1].trim();
}
function extractNegotiations(pack) {
  const out = [];
  for (const c of pack.chapters || []) {
    const B = c.blocks;
    for (let i = 0; i < B.length; i++) {
      const h = B[i];
      if (h.t !== 'h') continue;
      const mm = h.text.match(/^(.*?)\s+Negotiation Stats$/i);
      if (!mm) continue;
      const n = { id: (pack.heroes ? 'heroes' : pack.id) + '-' + slug(mm[1]), name: mm[1].trim(), interest: 2, patience: 3, impression: 1, language: '', motivations: [], pitfalls: [], outcomes: {}, notes: '', victories: '', intro: '', src: { pack: pack.id, ch: c.id, hid: h.id, pg: h.pg }, pack: pack.id };
      // intro: up to two paragraphs right before, inside the same section
      const pre = []; for (let k = i - 1; k >= 0 && k >= i - 4; k--) { const b = B[k]; if (b.t === 'h') { if (/Negotiation/i.test(b.text)) continue; break; } if (b.t === 'p' && b.style !== 'small') pre.unshift(strip(b.html)); }
      n.intro = pre.slice(-2).join('\n\n');
      let mode = '', last = null, sawOutcome = false;
      for (let j = i + 1; j < B.length && j < i + 50; j++) {
        const b = B[j];
        if (b.t === 'h') {
          const tx = b.text.trim();
          if (/^Motivations?$/i.test(tx)) { mode = 'm'; continue; }
          if (/^Pitfalls?$/i.test(tx)) { mode = 'p'; continue; }
          if (/^Victor(y|ies)$/i.test(tx)) { mode = 'v'; continue; }
          if (/Negotiation Stats$/i.test(tx)) break;
          if (/^(Negotiation )?Outcomes$/i.test(tx)) { mode = 'o'; continue; }
          if (sawOutcome) break;
          if (/^Roleplaying/i.test(tx)) { mode = 'r'; continue; }
          mode = 'x'; n.notes += (n.notes ? '\n\n' : '') + tx + ':'; continue;
        }
        const txt = b.t === 'table' ? [...b.head, ...b.rows.flat().map(strip)].join(' ') : strip(b.html || b.text || '');
        if (!txt) continue;
        if (/^(Interest|Patience|Impression|Native Language)s?:/i.test(txt) && !/^Interest\s+\d\s*:/i.test(txt)) { negStatsFromText(txt, n); n._stats = true; continue; }
        const om = txt.match(/^Interest\s+(\d)\s*(?:\([^)]*\))?\s*:\s*(.*)$/i);
        if (om) { n.outcomes[om[1]] = om[2].trim(); sawOutcome = true; mode = 'o'; last = null; continue; }
        if (/following outcomes/i.test(txt)) { mode = 'o'; continue; }
        if (mode === 'm' || mode === 'p') {
          const lm = txt.match(/^([A-Z][\w’' ]{2,24}):\s*(.*)$/);
          if (lm) { last = { name: canonMotive(lm[1]), text: lm[2].trim() }; (mode === 'm' ? n.motivations : n.pitfalls).push(last); continue; }
          if (last && b.t === 'p') { last.text += ' ' + txt; continue; }
          continue;
        }
        if (mode === 'v') { n.victories += (n.victories ? ' ' : '') + txt; continue; }
        if (mode === 'r') { n.notes += (n.notes ? '\n\n' : '') + txt; continue; }
        if (mode === 'x') { n.notes += '\n' + (b.t === 'li' ? '• ' : '') + txt; continue; }
        if (/following outcomes/i.test(txt)) continue;
        if (sawOutcome && !/^Interest/i.test(txt)) { if (b.t === 'p') n.notes += (n.notes ? '\n\n' : '') + txt; }
      }
      if (n._stats && (n.motivations.length || n.pitfalls.length)) { delete n._stats; out.push(n); }
    }
  }
  return out;
}
function extractArchetypes() {
  const ch = D.book.find(c => c.id === 'for-the-director'); if (!ch) return [];
  const out = []; let cur = null, mode = '';
  for (const b of ch.blocks) {
    if (b.t === 'h') {
      const m = b.text.match(/^(.*?)\s+Impression Score:\s*(\d+)$/);
      if (m) { cur = { id: 'arch-' + slug(m[1]), name: m[1], impression: +m[2], desc: '', motivations: [], pitfalls: [] }; out.push(cur); mode = 'd'; continue; }
      if (!cur) continue;
      if (/^Motivations$/.test(b.text)) { mode = 'm'; continue; }
      if (/^Pitfalls$/.test(b.text)) { mode = 'p'; continue; }
      if (b.lvl <= 3) { cur = null; continue; }
      continue;
    }
    if (!cur || b.t !== 'p') continue;
    const t = strip(b.html);
    if (mode === 'd') { cur.desc += (cur.desc ? ' ' : '') + t; continue; }
    const lm = t.match(/^([A-Z][\w’' ]{2,24}):\s*(.*)$/);
    if (lm && (mode === 'm' || mode === 'p')) (mode === 'm' ? cur.motivations : cur.pitfalls).push({ name: canonMotive(lm[1]), text: lm[2] });
  }
  return out;
}
// ---- pasted text parser ----
function parseNegText(txt) {
  const lines = txt.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
  const n = { id: 'u-' + Date.now().toString(36), name: '', interest: 2, patience: 3, impression: 1, language: '', motivations: [], pitfalls: [], outcomes: {}, notes: '', user: true };
  let mode = '', last = null;
  for (const ln of lines) {
    let m;
    if (!n.name && !/:/.test(ln) && !/^(Motivations?|Pitfalls?)$/i.test(ln)) { n.name = ln.replace(/\s+Negotiation Stats$/i, ''); continue; }
    if ((m = ln.match(/^(.*?)\s+Negotiation Stats$/i))) { n.name = m[1]; continue; }
    if (/^Motivations?:?$/i.test(ln)) { mode = 'm'; last = null; continue; }
    if (/^Pitfalls?:?$/i.test(ln)) { mode = 'p'; last = null; continue; }
    if (/^(Roleplaying|Notes)/i.test(ln)) { mode = 'r'; continue; }
    if ((m = ln.match(/^Interest\s+(\d)\s*:\s*(.*)$/i))) { n.outcomes[m[1]] = m[2]; mode = 'o'; last = { o: m[1] }; continue; }
    if (/(Interest|Patience|Impression|Native Language)s?:/i.test(ln) && mode !== 'm' && mode !== 'p') { negStatsFromText(ln, n); continue; }
    if ((mode === 'm' || mode === 'p') && (m = ln.match(/^([A-Z][\w’' ]{2,24}):\s*(.*)$/))) { last = { name: canonMotive(m[1]), text: m[2] }; (mode === 'm' ? n.motivations : n.pitfalls).push(last); continue; }
    if (mode === 'm' || mode === 'p') { if (last) last.text += ' ' + ln; else { const nm = canonMotive(ln); if (MOTIVES.includes(nm)) { last = { name: nm, text: '' }; (mode === 'm' ? n.motivations : n.pitfalls).push(last); } } continue; }
    if (mode === 'o' && last && last.o) { n.outcomes[last.o] += ' ' + ln; continue; }
    n.notes += (n.notes ? '\n' : '') + ln;
  }
  if (!n.name) n.name = 'Unnamed NPC';
  return n;
}

// ---- data ----
let NEGS_USER = store.get('negs', []);
let NEG_SESS = store.get('negsess', {});
const saveNegs = () => store.set('negs', NEGS_USER);
const saveSess = () => store.set('negsess', NEG_SESS);
let NEG_BOOK = [], NEG_ARCH = [];
const NEGBYHEAD = {};
function refreshNegotiations() {
  NEG_BOOK = []; for (const p of PACKS) NEG_BOOK.push(...extractNegotiations(p));
  const seen = new Set(); NEG_BOOK = NEG_BOOK.filter(n => { if (seen.has(n.id)) { n.id += '-' + Math.random().toString(36).slice(2, 5); } seen.add(n.id); return true; });
  for (const k in NEGBYHEAD) delete NEGBYHEAD[k];
  for (const n of NEG_BOOK) NEGBYHEAD[n.src.pack + ':' + n.src.ch + ':' + n.src.hid] = n.id;
  NEG_ARCH = extractArchetypes();
}
const allNegs = () => [...NEGS_USER, ...NEG_BOOK];
const negById = id => allNegs().find(n => n.id === id);

// ---- session helpers ----
function newSession(def) {
  return { defId: def.id, interest: def.interest, patience: def.patience, started: false, langHeroes: 0, attitude: '', used: {}, revealed: {}, discoverLocked: false, noMotArgs: 0, log: [], ended: null, share: true, heroes: [], who: '' };
}
function sessOf(def) { return NEG_SESS[def.id] || (NEG_SESS[def.id] = newSession(def)); }
function snapshot(s) { return JSON.stringify({ interest: s.interest, patience: s.patience, used: s.used, revealed: s.revealed, discoverLocked: s.discoverLocked, noMotArgs: s.noMotArgs, ended: s.ended }); }
function pushLog(s, text, kind, before) { s.log.push({ text, kind, before, i: s.interest, p: s.patience, at: Date.now() }); }
function checkEnd(s) {
  if (s.interest <= 0) s.ended = 'nodeal';
  else if (s.interest >= 5) s.ended = 'final';
  else if (s.patience <= 0) s.ended = 'final';
}

// ---- hub ----
let negUI = { step: 'type', type: null, target: null, lie: false, nat: false, repeat: false, rolled: null, bonus: 0, edge: 0, disc: null };
function negotiationHub() {
  refreshNegotiations();
  const inProg = allNegs().filter(n => NEG_SESS[n.id] && NEG_SESS[n.id].log.length && !NEG_SESS[n.id].ended);
  const byPack = {}; NEG_BOOK.forEach(n => (byPack[n.pack] = byPack[n.pack] || []).push(n));
  const card = n => `<a class="negc" href="#negotiation--${n.id}"><b>${esc(n.name)}</b><span>Interest ${n.interest} · Patience ${n.patience} · Impression ${n.impression}${n.language ? ' · ' + esc(n.language) : ''}</span><em>${n.motivations.length} motivations · ${n.pitfalls.length} pitfalls${NEG_SESS[n.id] && NEG_SESS[n.id].log.length ? ' · in progress' : ''}</em></a>`;
  $('#main').innerHTML = `<div class="neghub"><h1>Negotiation</h1>
    <p class="note">Run a negotiation step by step. Vanadium tracks the NPC’s interest and patience, which motivations have been used, what the players have discovered, and the offer on the table. The rules come from <a href="#book--heroes--negotiation">Chapter 11: Negotiation</a>.</p>
    <div class="negacts"><button class="btn" id="negnew">+ New negotiation</button><button class="btn ghost" id="negpaste">Paste a stat block</button><a class="btn ghost" href="#import">Import a PDF</a></div>
    ${inProg.length ? `<h2 class="negh">In progress</h2><div class="negg">${inProg.map(card).join('')}</div>` : ''}
    ${NEGS_USER.length ? `<h2 class="negh">Your negotiations</h2><div class="negg">${NEGS_USER.map(card).join('')}</div>` : ''}
    ${Object.entries(byPack).map(([pid, list]) => `<h2 class="negh">From ${esc(PK[pid]?.title || pid)}</h2><div class="negg">${list.map(card).join('')}</div>`).join('')}
    <h2 class="negh">Start from an archetype</h2><p class="note" style="margin-top:-4px">The sample negotiators from <i>For the Director</i>. Pick one and choose at least two motivations and pitfalls.</p>
    <div class="negg">${NEG_ARCH.map(a => `<button class="negc arch" data-arch="${a.id}"><b>${esc(a.name)}</b><span>Impression ${a.impression}</span><em>${esc(a.desc.slice(0, 110))}${a.desc.length > 110 ? '…' : ''}</em></button>`).join('')}</div></div>`;
  $('#negnew').onclick = () => negEditor(null);
  $('#negpaste').onclick = negPasteDialog;
  $$('[data-arch]').forEach(b => b.onclick = () => negEditor(null, NEG_ARCH.find(a => a.id === b.dataset.arch)));
  document.title = 'Negotiation — Vanadium';
}

// ---- editor ----
function negEditor(def, arch) {
  const d = def ? JSON.parse(JSON.stringify(def)) : { id: 'u-' + Date.now().toString(36), name: arch ? arch.name : '', interest: 2, patience: 3, impression: arch ? arch.impression : 1, language: '', motivations: [], pitfalls: [], outcomes: {}, notes: arch ? arch.desc : '', user: true };
  const roleOf = m => d.motivations.find(x => x.name === m) ? 'm' : d.pitfalls.find(x => x.name === m) ? 'p' : '';
  const textOf = m => (d.motivations.find(x => x.name === m) || d.pitfalls.find(x => x.name === m) || {}).text || (arch && (arch.motivations.find(x => x.name === m) || arch.pitfalls.find(x => x.name === m) || {}).text) || '';
  const sugg = m => arch ? (arch.motivations.some(x => x.name === m) ? 'suggested motivation' : arch.pitfalls.some(x => x.name === m) ? 'suggested pitfall' : '') : '';
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<div class="dlg-b negedit"><h2>${def ? 'Edit' : 'New'} negotiation${arch ? ' · ' + esc(arch.name) : ''}</h2>
    <div class="party dlgp"><label style="flex:2;min-width:200px;width:auto">NPC name<input id="ne-name" value="${esc(d.name)}" placeholder="e.g. Zola Honeycut"></label>
    <label>Attitude<select id="ne-att"><option value="">Custom…</option>${ATTITUDES.map(a => `<option value="${a[0]}">${a[0]} (${a[1]}/${a[2]})</option>`).join('')}</select></label>
    <label>Interest<input type="number" id="ne-i" min="1" max="4" value="${d.interest}"></label><label>Patience<input type="number" id="ne-p" min="1" max="5" value="${d.patience}"></label>
    <label>Impression<input type="number" id="ne-imp" min="1" max="12" value="${d.impression}"></label><label style="width:160px">Native language<input id="ne-lang" value="${esc(d.language)}" placeholder="optional"></label></div>
    <div class="negmot-h"><b>Motivations & pitfalls</b><span>Give the NPC at least two motivations and at least one pitfall.</span></div>
    <div class="negmots">${MOTIVES.map(m => `<div class="nm ${roleOf(m)}" data-m="${m}"><div class="nm-t"><b>${m}</b>${sugg(m) ? `<small>${sugg(m)}</small>` : ''}<span class="seg3"><button data-r="m" class="${roleOf(m) === 'm' ? 'on' : ''}">Motivation</button><button data-r="p" class="${roleOf(m) === 'p' ? 'on' : ''}">Pitfall</button><button data-r="" class="${!roleOf(m) ? 'on' : ''}">—</button></span></div><textarea rows="2" placeholder="What this means for this NPC (optional)">${esc(textOf(m))}</textarea></div>`).join('')}</div>
    <details ${Object.keys(d.outcomes).length ? 'open' : ''}><summary>Planned outcomes by interest (optional)</summary><div class="negouts">${[5, 4, 3, 2, 1, 0].map(k => `<label>Interest ${k} · ${OFFERS[k][0]}<input data-o="${k}" value="${esc(d.outcomes[k] || '')}" placeholder="${esc(OFFERS[k][1])}"></label>`).join('')}</div></details>
    <label class="negnotes">Notes for the Director<textarea id="ne-notes" rows="3">${esc(d.notes || '')}</textarea></label>
    <div class="dlgfoot">${def && def.user ? '<button class="btn danger" id="ne-del">Delete</button>' : ''}<span style="flex:1"></span><button class="btn ghost" id="ne-cancel">Cancel</button><button class="btn" id="ne-save">Save & run</button></div></div>`;
  document.body.appendChild(el);
  $('#ne-att', el).onchange = e => { const a = ATTITUDES.find(x => x[0] === e.target.value); if (a) { $('#ne-i', el).value = a[1]; $('#ne-p', el).value = a[2]; } };
  $$('.nm', el).forEach(row => row.onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; $$('[data-r]', row).forEach(x => x.classList.toggle('on', x === b)); row.className = 'nm ' + b.dataset.r; });
  $('#ne-cancel', el).onclick = () => el.remove();
  if ($('#ne-del', el)) $('#ne-del', el).onclick = async () => { if (await confirmSheet(`Delete “${d.name}”?`, 'Delete')) { NEGS_USER = NEGS_USER.filter(x => x.id !== d.id); delete NEG_SESS[d.id]; saveNegs(); saveSess(); el.remove(); go('negotiation'); } };
  $('#ne-save', el).onclick = () => {
    d.name = $('#ne-name', el).value.trim() || 'Unnamed NPC';
    d.interest = Math.max(1, Math.min(4, +$('#ne-i', el).value || 2)); d.patience = Math.max(1, Math.min(5, +$('#ne-p', el).value || 3));
    d.impression = Math.max(1, Math.min(12, +$('#ne-imp', el).value || 1)); d.language = $('#ne-lang', el).value.trim();
    d.motivations = []; d.pitfalls = [];
    $$('.nm', el).forEach(row => { const r = row.classList.contains('m') ? 'm' : row.classList.contains('p') ? 'p' : ''; if (!r) return; const item = { name: row.dataset.m, text: $('textarea', row).value.trim() }; (r === 'm' ? d.motivations : d.pitfalls).push(item); });
    if (d.motivations.length < 1) { toast('Pick at least one motivation'); return; }
    d.outcomes = {}; $$('[data-o]', el).forEach(i => { if (i.value.trim()) d.outcomes[i.dataset.o] = i.value.trim(); });
    d.notes = $('#ne-notes', el).value.trim(); d.user = true;
    NEGS_USER = NEGS_USER.filter(x => x.id !== d.id); NEGS_USER.unshift(d); saveNegs();
    if (NEG_SESS[d.id] && !NEG_SESS[d.id].started) NEG_SESS[d.id] = newSession(d);
    saveSess(); el.remove(); buildIndex(); go('negotiation--' + d.id);
  };
}
function negPasteDialog() {
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<div class="dlg-b"><h2>Paste a stat block</h2><p>Paste negotiation stats from a PDF, document or website. Vanadium picks out the interest, patience, impression, language, motivations, pitfalls and outcomes.</p>
    <textarea id="np-t" rows="11" style="width:100%;background:var(--bg);color:var(--ink);border:1px solid var(--line2);border-radius:5px;padding:10px;font-size:14px" placeholder="Zola Honeycut Negotiation Stats&#10;Interest: 2 Patience: 3 Impression: 3&#10;Motivations&#10;Benevolence: Zola always gives her thieves a bigger cut…&#10;Protection: The members of the Clock are her only family…&#10;Pitfalls&#10;Higher Authority: …&#10;Interest 5: …"></textarea>
    <div id="np-prev" class="note" style="margin-top:8px"></div>
    <div class="dlgfoot"><span style="flex:1"></span><button class="btn ghost" id="np-c">Cancel</button><button class="btn" id="np-ok">Review & save</button></div></div>`;
  document.body.appendChild(el);
  const ta = $('#np-t', el);
  ta.oninput = () => { const n = parseNegText(ta.value); $('#np-prev', el).textContent = ta.value.trim() ? `Found: ${n.name} · interest ${n.interest} · patience ${n.patience} · ${n.motivations.length} motivations · ${n.pitfalls.length} pitfalls · ${Object.keys(n.outcomes).length} outcomes` : ''; };
  $('#np-c', el).onclick = () => el.remove();
  $('#np-ok', el).onclick = () => { const n = parseNegText(ta.value); el.remove(); negEditor(n); };
  setTimeout(() => ta.focus(), 30);
}

// ---- runner ----
function negotiationPage(id) {
  refreshNegotiations();
  const def = negById(id);
  if (!def) { if (!PACKS.length || BUILTIN.some(b => id.startsWith(b.id))) { $('#main').innerHTML = '<div class="empty">Loading…</div>'; return; } go('negotiation'); return; }
  const s = sessOf(def);
  const pill = (n, v, cls) => `<div class="pips ${cls}">${[0, 1, 2, 3, 4, 5].map(k => `<span class="pip ${k <= v && k > 0 ? 'on' : ''} ${k === v ? 'cur' : ''}" data-set="${cls}" data-v="${k}">${k}</span>`).join('')}</div>`;
  const offer = OFFERS[s.interest];
  const custom = def.outcomes[s.interest];
  const endBanner = s.ended ? `<div class="negend ${s.ended}">${s.ended === 'nodeal' ? `<b>Negotiation over: no deal.</b> ${esc(def.name)}’s interest hit 0. They refuse further talks and may seek to harm the heroes.` : s.ended === 'final' ? `<b>Final offer.</b> ${s.interest >= 5 ? 'Interest reached 5.' : 'Patience ran out.'} The heroes can accept this offer or walk away, but the negotiation is over.` : s.ended === 'accepted' ? `<b>Deal struck</b> at interest ${s.interest} (“${OFFERS[s.interest][0]}”).` : `<b>The heroes walked away</b> at interest ${s.interest}.`}${def.victories ? `<div class="vict">${esc(def.victories)}</div>` : ''}</div>` : '';
  const mrow = (m, kind) => {
    const used = kind === 'm' && s.used[m.name], rev = s.revealed[m.name];
    return `<div class="nmot ${kind} ${used ? 'used' : ''}"><div class="nmot-h"><b>${esc(m.name)}</b><span class="tagk">${kind === 'm' ? 'Motivation' : 'Pitfall'}</span>${used ? '<span class="tagu">appealed</span>' : ''}<button class="eye ${rev ? 'on' : ''}" data-rev="${esc(m.name)}" title="${rev ? 'Known to the players' : 'Hidden from the players'}">${rev ? 'known' : 'hidden'}</button></div>${m.text ? `<p>${esc(m.text)}</p>` : ''}</div>`;
  };
  $('#main').innerHTML = `<div class="negrun"><div class="negmain">
    <div class="negtop"><div><div class="kind">${esc(def.user ? 'Your negotiation' : (PK[def.pack]?.title || ''))}</div><h1>${esc(def.name)}</h1>
      <div class="negmeta">Impression ${def.impression}${def.language ? ' · Native language: ' + esc(def.language) : ''}${def.src ? ` · <a data-gobook="${esc(def.src.pack)}--${esc(def.src.ch)}--${esc(def.src.hid)}">open in book</a>` : ''}</div></div>
      <div class="negtb"><button class="btn ghost sm" id="ng-pdf">PDF</button><button class="btn ghost sm" id="ng-table">Player view</button>${def.user ? '<button class="btn ghost sm" id="ng-edit">Edit</button>' : '<button class="btn ghost sm" id="ng-copy">Copy & edit</button>'}<button class="btn ghost sm" id="ng-reset">Restart</button><a class="btn ghost sm" href="#negotiation">All</a></div></div>
    ${endBanner}
    <div class="negstats"><div class="nstat"><span>Interest</span>${pill('Interest', s.interest, 'interest')}</div><div class="nstat"><span>Patience</span>${pill('Patience', s.patience, 'patience')}</div></div>
    <div class="negoffer"><div class="ol"><span>Current offer</span><b>${offer[0]}</b></div><div class="ot">${custom ? esc(custom) : esc(offer[1])}${custom ? `<small>${esc(offer[1])}</small>` : ''}</div></div>
    ${!s.started ? negSetupHtml(def, s) : s.ended ? `<div class="negpanel"><div class="actrow"><button class="btn ghost" id="ng-undo" ${s.log.length ? '' : 'disabled'}>Undo last step</button><button class="btn" id="ng-reset2">Run it again</button></div></div>` : negActionHtml(def, s)}
    <div class="neglog"><h3>Log</h3>${s.log.length ? s.log.slice().reverse().map(l => `<div class="lg ${l.kind || ''}"><span class="lgv">I ${l.i} · P ${l.p}</span>${esc(l.text)}</div>`).join('') : '<div class="note">Nothing yet.</div>'}</div>
  </div>
  <aside class="negside"><h3>Motivations</h3>${def.motivations.map(m => mrow(m, 'm')).join('') || '<div class="note">None</div>'}<h3>Pitfalls</h3>${def.pitfalls.map(m => mrow(m, 'p')).join('') || '<div class="note">None</div>'}
    ${Object.keys(def.outcomes).length ? `<h3>Outcomes</h3>${[5, 4, 3, 2, 1, 0].filter(k => def.outcomes[k]).map(k => `<div class="nout ${k === s.interest ? 'cur' : ''}"><b>${k} · ${OFFERS[k][0]}</b> ${esc(def.outcomes[k])}</div>`).join('')}` : ''}
    ${def.intro ? `<h3>Setup</h3><p class="nnote">${esc(def.intro)}</p>` : ''}${def.notes ? `<h3>Notes</h3><p class="nnote">${esc(def.notes)}</p>` : ''}
    <h3>Renown & Impression</h3><p class="nnote">A hero whose Renown is ${def.impression} or higher can sway this NPC if the NPC knows of them. Famous: edge on arguments using Flirt, Lead or Persuade. Infamous: edge with Brag, Interrogate or Intimidate.</p>
  </aside></div>`;
  wireNeg(def, s);
  document.title = def.name + ' — Negotiation';
}
function negSetupHtml(def, s) {
  return `<div class="negpanel"><h3>Opening the negotiation</h3>
   <p class="note">Before the first argument: confirm the NPC’s attitude and how many heroes can speak their native language${def.language ? ` (${esc(def.language)})` : ''}.</p>
   <div class="party dlgp"><label style="width:auto;min-width:220px">Starting attitude<select id="ng-att"><option value="">As written (interest ${def.interest}, patience ${def.patience})</option>${ATTITUDES.map(a => `<option value="${a[0]}">${a[0]}: interest ${a[1]}, patience ${a[2]}</option>`).join('')}</select></label>
   <label style="width:auto;min-width:220px">Heroes who speak ${def.language ? esc(def.language) : 'the NPC’s native language'}<select id="ng-lang"><option value="0">None (or only Caelian)</option><option value="1">1 or 2 heroes: patience +1</option><option value="2">3 or more: patience +2</option></select></label></div>
   <label class="row-c"><input type="checkbox" id="ng-share" ${s.share ? 'checked' : ''}> Show interest and patience in the player view</label>
   <div class="actrow"><button class="btn" id="ng-begin">Begin negotiation</button></div></div>`;
}
function negActionHtml(def, s) {
  const u = negUI;
  const tierBtns = (lab) => `<div class="tierpick">${[1, 2, 3].map(t => `<button class="tierb n${t} ${u.rolled && u.rolled.tier === t ? 'on' : ''}" data-tier="${t}"><span class="tb">${['', '≤11', '12–16', '17+'][t]}</span>${lab[t]}</button>`).join('')}</div>`;
  const rollRow = `<div class="rollrow"><span>Power roll + Reason, Intuition or Presence:</span><label>Bonus <input type="number" id="ng-bonus" value="${u.bonus}" inputmode="numeric"></label><select id="ng-edge"><option value="0">No edge/bane</option><option value="1" ${u.edge == 1 ? 'selected' : ''}>Edge (+2)</option><option value="2" ${u.edge == 2 ? 'selected' : ''}>Double edge</option><option value="-1" ${u.edge == -1 ? 'selected' : ''}>Bane (−2)</option><option value="-2" ${u.edge == -2 ? 'selected' : ''}>Double bane</option></select><button class="btn sm" id="ng-roll">Roll 2d10</button>${u.rolled && u.rolled.total != null ? `<b class="rollres">${u.rolled.total}${u.rolled.nat >= 19 ? ' · natural ' + u.rolled.nat : ''} → tier ${u.rolled.tier}</b>` : ''}</div>`;
  const usable = def.motivations.filter(m => !s.used[m.name]), usedM = def.motivations.filter(m => s.used[m.name]);
  let body = '';
  if (u.step === 'type') {
    body = `<h3>What does the argument appeal to?</h3>
      <div class="argtypes">${usable.map(m => `<button class="argt mot" data-type="mot" data-target="${esc(m.name)}"><b>${esc(m.name)}</b><span>Motivation${s.revealed[m.name] ? ' · known' : ''}</span></button>`).join('')}
      <button class="argt none" data-type="none"><b>No motivation or pitfall</b><span>Harder test${s.noMotArgs ? ` · ${s.noMotArgs} made` : ''}</span></button>
      ${usedM.map(m => `<button class="argt usedm" data-type="usedmot" data-target="${esc(m.name)}"><b>${esc(m.name)}</b><span>Already appealed</span></button>`).join('')}
      ${def.pitfalls.map(m => `<button class="argt pit" data-type="pit" data-target="${esc(m.name)}"><b>${esc(m.name)}</b><span>Pitfall</span></button>`).join('')}</div>
      <div class="actrow"><button class="btn ghost" id="ng-disc" ${s.discoverLocked ? 'disabled title="Make an argument before testing again"' : ''}>Discover a motivation or pitfall</button><button class="btn ghost" id="ng-undo" ${s.log.length ? '' : 'disabled'}>Undo</button><button class="btn ghost" id="ng-accept">Accept current offer</button><button class="btn ghost" id="ng-walk">Heroes walk away</button></div>`;
  } else if (u.step === 'resolve') {
    const t = u.type;
    if (t === 'pit') body = `<h3>Argument uses a pitfall: ${esc(u.target)}</h3><p class="note">The argument automatically fails. Interest −1 and patience −1. The NPC might warn the heroes not to treat them that way again.</p>`;
    else if (t === 'usedmot') body = `<h3>${esc(u.target)} has already been appealed to</h3><p class="note">Each motivation can be successfully appealed to only once. Interest stays the same and patience −1.</p>`;
    else if (t === 'mot') body = `<h3>Appeal to ${esc(u.target)}</h3><p class="note">Medium test (Reason, Intuition or Presence with any applicable skill). A particularly well-roleplayed argument can count as tier 3 without a test.</p>
      ${rollRow}${tierBtns({ 1: 'Patience −1', 2: 'Interest +1, patience −1', 3: 'Interest +1, patience unchanged' })}
      <label class="row-c"><input type="checkbox" id="ng-lie" ${u.lie ? 'checked' : ''}> The hero lied and was caught (interest −1 more if it fails to raise interest)</label>`;
    else if (t === 'none') body = `<h3>Argument without a motivation or pitfall</h3><p class="note">A more difficult test. On a natural 19 or 20, patience stays the same. Repeating the same argument automatically gets tier 1.</p>
      ${rollRow}${tierBtns({ 1: 'Interest −1, patience −1', 2: 'Patience −1', 3: 'Interest +1, patience −1' })}
      <label class="row-c"><input type="checkbox" id="ng-nat" ${u.nat || (u.rolled && u.rolled.nat >= 19) ? 'checked' : ''}> Natural 19 or 20 (patience unchanged)</label>
      <label class="row-c"><input type="checkbox" id="ng-rep" ${u.repeat ? 'checked' : ''}> They repeated an argument they already made (automatic tier 1)</label>
      <label class="row-c"><input type="checkbox" id="ng-lie" ${u.lie ? 'checked' : ''}> The hero lied and was caught (interest −1 more if it fails to raise interest)</label>`;
    const ready = t === 'pit' || t === 'usedmot' || (u.rolled && u.rolled.tier) || (t === 'none' && u.repeat);
    body += `<div class="actrow"><button class="btn ghost" id="ng-back">← Back</button><button class="btn" id="ng-apply" ${ready ? '' : 'disabled'}>Apply result</button></div>`;
  } else if (u.step === 'discover') {
    const hidden = [...def.motivations.map(m => [m, 'm']), ...def.pitfalls.map(m => [m, 'p'])].filter(([m]) => !s.revealed[m.name]);
    body = `<h3>Discover a motivation or pitfall</h3><p class="note">A hero reads the NPC with a Reason, Intuition or Presence test (the book’s example uses a hard test). No further discovery test can be made until the heroes make an argument.</p>
      ${rollRow}${tierBtns({ 1: 'Nothing learned; the NPC is annoyed: patience −1', 2: 'Nothing learned', 3: 'Learn one motivation or pitfall' })}
      ${u.rolled && u.rolled.tier === 3 ? `<div class="argtypes">${hidden.map(([m, k]) => `<button class="argt ${k === 'm' ? 'mot' : 'pit'} ${u.disc === m.name ? 'sel' : ''}" data-disc="${esc(m.name)}"><b>${esc(m.name)}</b><span>${k === 'm' ? 'Motivation' : 'Pitfall'}</span></button>`).join('') || '<div class="note">Everything is already known.</div>'}</div>` : ''}
      <div class="actrow"><button class="btn ghost" id="ng-back">← Back</button><button class="btn" id="ng-dapply" ${u.rolled && u.rolled.tier && (u.rolled.tier < 3 || u.disc || !hidden.length) ? '' : 'disabled'}>Apply</button></div>`;
  } else if (u.step === 'response') {
    const r = u.resp;
    body = `<h3>${esc(def.name)} responds ${r.kind === 'positive' ? 'positively' : r.kind === 'negative' ? 'negatively' : 'with impatience'}</h3>
      <p class="resp ${r.kind}">“${esc(RESP[r.kind][Math.floor(Math.random() * 4)])}”</p>
      <p class="note">${esc(r.summary)} Then make an offer at interest ${s.interest}: <b>${OFFERS[s.interest][0]}</b>${s.ended ? '' : ' The heroes can keep arguing, or accept.'}</p>
      <div class="actrow"><button class="btn" id="ng-next">${s.ended ? 'See result' : 'Next argument'}</button>${s.ended ? '' : '<button class="btn ghost" id="ng-accept">Accept this offer</button>'}</div>`;
  }
  return `<div class="negpanel">${body}</div>`;
}
function negRoll() {
  const d1 = 1 + Math.floor(Math.random() * 10), d2 = 1 + Math.floor(Math.random() * 10), nat = d1 + d2;
  const ed = +negUI.edge; const tot = nat + (+negUI.bonus || 0) + (ed === 1 ? 2 : ed === -1 ? -2 : 0);
  let tier = tot <= 11 ? 1 : tot <= 16 ? 2 : 3; if (ed === 2) tier = Math.min(3, tier + 1); if (ed === -2) tier = Math.max(1, tier - 1); if (nat >= 19) tier = 3;
  return { d1, d2, nat, total: tot, tier };
}
function wireNeg(def, s) {
  const re = () => { saveSess(); negotiationPage(def.id); };
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  on('#ng-reset', async () => { if (await confirmSheet('Restart this negotiation from the beginning?', 'Restart')) { NEG_SESS[def.id] = newSession(def); negUI = { step: 'type', bonus: 0, edge: 0 }; re(); } });
  on('#ng-reset2', () => { NEG_SESS[def.id] = newSession(def); negUI = { step: 'type', bonus: 0, edge: 0 }; re(); });
  on('#ng-edit', () => negEditor(def));
  on('#ng-copy', () => { const c = JSON.parse(JSON.stringify(def)); c.id = 'u-' + Date.now().toString(36); c.user = true; delete c.src; c.name = def.name; negEditor(c); });
  on('#ng-table', () => negPlayerView(def, s));
  on('#ng-pdf', () => runPdfJob($('#ng-pdf'), 'PDF', async () => { const b = await buildNegotiationPdf(def); await deliverFile(pdfFileName(def.name, 'negotiation'), new Blob([b], { type: 'application/pdf' })); }));
  $$('.pip').forEach(p => p.onclick = () => { const k = p.dataset.set, v = +p.dataset.v; const b = snapshot(s); s[k] = v; pushLog(s, `Director set ${k} to ${v}`, 'adj', b); if (s.started) { s.ended = null; checkEnd(s); } re(); });
  $$('[data-rev]').forEach(b => b.onclick = () => { s.revealed[b.dataset.rev] = !s.revealed[b.dataset.rev]; re(); });
  on('#ng-begin', () => {
    const b = snapshot(s); const att = ATTITUDES.find(a => a[0] === $('#ng-att').value);
    if (att) { s.interest = att[1]; s.patience = att[2]; s.attitude = att[0]; }
    const lb = +$('#ng-lang').value; s.patience = clamp5(s.patience + lb); s.share = $('#ng-share').checked; s.started = true;
    pushLog(s, `Negotiation opened${att ? ' (' + att[0] + ')' : ''}: interest ${s.interest}, patience ${s.patience}${lb ? ` (+${lb} for the native language)` : ''}`, 'start', b);
    negUI = { step: 'type', bonus: 0, edge: 0 }; re();
  });
  $$('[data-type]').forEach(b => b.onclick = () => { negUI = { ...negUI, step: 'resolve', type: b.dataset.type, target: b.dataset.target || null, rolled: null, lie: false, nat: false, repeat: false }; re(); });
  on('#ng-back', () => { negUI.step = 'type'; negUI.rolled = null; re(); });
  on('#ng-disc', () => { negUI = { ...negUI, step: 'discover', rolled: null, disc: null }; re(); });
  const keep = () => { const bi = $('#ng-bonus'), ei = $('#ng-edge'), li = $('#ng-lie'), ni = $('#ng-nat'), ri = $('#ng-rep'); if (bi) negUI.bonus = +bi.value || 0; if (ei) negUI.edge = +ei.value; if (li) negUI.lie = li.checked; if (ni) negUI.nat = ni.checked; if (ri) negUI.repeat = ri.checked; };
  $$('#ng-bonus,#ng-edge,#ng-lie,#ng-nat,#ng-rep').forEach(i => i.onchange = () => { keep(); if (i.id === 'ng-rep' && i.checked) negUI.rolled = { tier: 1 }; re(); });
  on('#ng-roll', () => { keep(); negUI.rolled = negRoll(); if (negUI.rolled.nat >= 19) negUI.nat = true; re(); });
  $$('[data-tier]').forEach(b => b.onclick = () => { keep(); negUI.rolled = { ...(negUI.rolled || {}), tier: +b.dataset.tier, total: negUI.rolled && negUI.rolled.tier === +b.dataset.tier ? negUI.rolled.total : null }; re(); });
  $$('[data-disc]').forEach(b => b.onclick = () => { negUI.disc = b.dataset.disc; re(); });
  on('#ng-apply', () => {
    keep(); const u = negUI; const b = snapshot(s); let di = 0, dp = 0, tier = u.rolled && u.rolled.tier, txt = '';
    if (u.type === 'pit') { di = -1; dp = -1; txt = `Argument used the pitfall ${u.target}: it fails`; s.revealed[u.target] = true; }
    else if (u.type === 'usedmot') { dp = -1; txt = `Appealed again to ${u.target} (already used)`; }
    else if (u.type === 'mot') { tier = tier || 1; if (tier === 1) dp = -1; else if (tier === 2) { di = 1; dp = -1; } else di = 1; if (di > 0) { s.used[u.target] = true; s.revealed[u.target] = true; } txt = `Appealed to ${u.target}: tier ${tier}`; }
    else if (u.type === 'none') { if (u.repeat) tier = 1; tier = tier || 1; if (tier === 1) { di = -1; dp = -1; } else if (tier === 2) dp = -1; else { di = 1; dp = -1; } if (u.nat) dp = 0; s.noMotArgs++; txt = `Argument without a motivation${u.repeat ? ' (repeated)' : ''}: tier ${tier}${u.nat ? ', natural 19–20' : ''}`; }
    if (u.lie && di <= 0 && u.type !== 'pit') { di -= 1; txt += '; caught in a lie'; }
    s.interest = clamp5(s.interest + di); s.patience = clamp5(s.patience + dp); s.discoverLocked = false;
    const kind = di > 0 ? 'positive' : di < 0 ? 'negative' : 'impatient';
    const sum = `Interest ${di > 0 ? '+' + di : di || '±0'}, patience ${dp > 0 ? '+' + dp : dp || '±0'}.`;
    pushLog(s, `${txt}. ${sum}`, kind, b); checkEnd(s);
    negUI = { step: 'response', resp: { kind, summary: sum }, bonus: u.bonus, edge: 0 }; re();
  });
  on('#ng-dapply', () => {
    const u = negUI, b = snapshot(s), t = u.rolled.tier;
    if (t === 1) { s.patience = clamp5(s.patience - 1); pushLog(s, 'Tried to read the NPC (tier 1): they noticed and are annoyed. Patience −1.', 'negative', b); }
    else if (t === 2) pushLog(s, 'Tried to read the NPC (tier 2): learned nothing.', 'impatient', b);
    else { if (u.disc) s.revealed[u.disc] = true; pushLog(s, `Read the NPC (tier 3): discovered ${u.disc || 'nothing new'}.`, 'positive', b); }
    s.discoverLocked = true; checkEnd(s); negUI = { step: 'type', bonus: u.bonus, edge: 0 }; re();
  });
  on('#ng-next', () => { negUI = { step: 'type', bonus: negUI.bonus, edge: 0 }; re(); });
  on('#ng-undo', () => { const l = s.log.pop(); if (l && l.before) Object.assign(s, JSON.parse(l.before)); if (l && l.kind === 'start') s.started = false; negUI = { step: 'type', bonus: 0, edge: 0 }; re(); });
  on('#ng-accept', () => { const b = snapshot(s); s.ended = 'accepted'; pushLog(s, `The heroes accepted the offer at interest ${s.interest} (${OFFERS[s.interest][0]})`, 'start', b); re(); });
  on('#ng-walk', () => { const b = snapshot(s); s.ended = 'walked'; pushLog(s, 'The heroes walked away from the negotiation', 'negative', b); re(); });
}
function negPlayerView(def, s) {
  const el = document.createElement('div'); el.className = 'pview';
  const draw = () => {
    const known = [...def.motivations.map(m => [m, 'Motivation']), ...def.pitfalls.map(m => [m, 'Pitfall'])].filter(([m]) => s.revealed[m.name]);
    el.innerHTML = `<button class="pv-x" title="Close">✕ Close player view</button><div class="pv-in"><div class="pv-k">Negotiating with</div><h1>${esc(def.name)}</h1>
      ${s.share ? `<div class="pv-stats"><div><span>Interest</span><b>${s.interest}</b><i>${[1, 2, 3, 4, 5].map(k => `<em class="${k <= s.interest ? 'on' : ''}"></em>`).join('')}</i></div><div><span>Patience</span><b>${s.patience}</b><i>${[1, 2, 3, 4, 5].map(k => `<em class="${k <= s.patience ? 'on p' : ''}"></em>`).join('')}</i></div></div>` : ''}
      <div class="pv-offer">${s.ended === 'nodeal' ? 'No deal' : `${OFFERS[s.interest][0]}`}${s.ended ? '<small>Negotiation over</small>' : ''}</div>
      <div class="pv-known"><h3>What you know</h3>${known.length ? known.map(([m, k]) => `<span class="${k === 'Pitfall' ? 'p' : 'm'}">${k === 'Pitfall' ? '⚠ ' : ''}${esc(m.name)}</span>`).join('') : '<p>Nothing yet. Ask what they want, or read them.</p>'}</div></div>`;
    $('.pv-x', el).onclick = () => el.remove();
  };
  draw(); document.body.appendChild(el);
}


// ================= MONTAGE TEST RUNNER =================
const ORDW = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };
const MT_TIERS = { // per difficulty: tier -> [result, label]
  easy: { 1: ['s', 'Success with a consequence'], 2: ['s', 'Success'], 3: ['s', 'Success with a reward'] },
  medium: { 1: ['f', 'Failure'], 2: ['s', 'Success with a consequence'], 3: ['s', 'Success'] },
  hard: { 1: ['f', 'Failure with a consequence'], 2: ['f', 'Failure'], 3: ['s', 'Success'] }
};
function mtLimits(diff, heroes) {
  const base = { easy: [5, 5], moderate: [6, 4], hard: [7, 3] }[diff] || [6, 4];
  const d = (+heroes || 5) - 5;
  return [Math.max(2, base[0] + d), Math.max(2, base[1] + d)];
}
const mtVictories = (outcome, diff) => outcome === 'success' ? (diff === 'hard' ? 2 : 1) : outcome === 'partial' ? (diff === 'easy' ? 0 : 1) : 0;

function parseChallenge(html, round) {
  let name = '', rest = '';
  const m = String(html).match(/^\s*<b>(.*?)<\/b>\s*(.*)$/s);
  if (m) { name = strip(m[1]).replace(/[:\s]+$/, ''); rest = strip(m[2]); }
  else { const t = strip(html); const k = t.match(/^([^:.!?]{2,60})[:!?]\s*(.*)$/); if (!k) return null; name = k[1]; rest = k[2]; }
  const chars = ((rest.match(/Suggested Characteristics?:\s*([^.]*)/i) || [])[1] || '').split(/,\s*|\s+or\s+/).map(s => s.trim()).filter(Boolean);
  const skills = ((rest.match(/Suggested Skills?:\s*([^.]*)/i) || [])[1] || '').split(/,\s*|\s+or\s+/).map(s => s.trim()).filter(Boolean);
  const desc = rest.replace(/\s*Suggested Characteristics?:.*$/i, '').trim();
  const mm = rest.match(/overcome (twice|two times|three times|thrice|(\d+) times)/i);
  const max = mm ? (/twice|two/i.test(mm[1]) ? 2 : /three|thrice/i.test(mm[1]) ? 3 : +mm[2]) : 1;
  return { name, desc, chars, skills, round: round || 1, max };
}
function extractMontages(pack) {
  const out = [];
  for (const c of pack.chapters || []) {
    const B = c.blocks;
    for (let i = 0; i < B.length; i++) {
      const h = B[i];
      if (h.t !== 'h' || !/^(Montage( Test)? )?Challenges$/i.test(h.text.trim())) continue;
      // find the montage's own heading
      let a = -1;
      for (let k = i - 1; k >= 0; k--) { const b = B[k]; if (b.t === 'h' && b.lvl < h.lvl && !/Setting the Scene|Difficulty|Montage/i.test(b.text)) { a = k; break; } }
      const top = a >= 0 ? B[a] : null;
      const name = top ? top.text : c.title;
      if (out.some(x => x.src.ch === c.id && x.name === name)) continue;
      let end = B.length;
      if (top) for (let k = a + 1; k < B.length; k++) { const b = B[k]; if (b.t === 'h' && b.lvl <= top.lvl) { end = k; break; } }
      const M = { id: (pack.heroes ? 'heroes' : pack.id) + '-' + slug(name), name, intro: '', scene: [], challenges: [], events: [], outcomes: {}, limits: null, notes: '', pack: pack.id, src: { pack: pack.id, ch: c.id, hid: top ? top.id : '', pg: (top || h).pg } };
      let mode = 'intro', addRound = 1, ev = null, okey = null;
      for (let k = (a >= 0 ? a + 1 : 0); k < end; k++) {
        const b = B[k];
        if (b.t === 'h') {
          const t = b.text.trim();
          if (/Setting the Scene/i.test(t)) mode = 'scene';
          else if (/Challenges$/i.test(t)) { mode = 'chal'; addRound = 1; }
          else if (/Outcomes$/i.test(t)) mode = 'out';
          else if (/^Total Success$/i.test(t)) { mode = 'okey'; okey = 'success'; }
          else if (/^Partial Success$/i.test(t)) { mode = 'okey'; okey = 'partial'; }
          else if (/^Total Failure$/i.test(t)) { mode = 'okey'; okey = 'failure'; }
          else if (mode === 'out' || mode === 'okey') { mode = 'after'; }
          else if (mode !== 'intro') mode = 'other';
          continue;
        }
        if (b.t === 'table') { if (b.head.some(x => /Success Limit/i.test(x))) M.limits = { head: b.head, rows: b.rows.map(r => r.map(strip)) }; continue; }
        const html = b.html || ''; const txt = strip(html);
        if (!txt) continue;
        if (mode === 'intro') { if (!/Test Difficulty$/i.test(txt) && txt.length > 30) M.intro += (M.intro ? '\n\n' : '') + txt; if (b.t === 'li' && /^[“"]/.test(txt)) M.scene.push(txt); continue; }
        if (mode === 'scene') { if (b.t === 'li' || /^[“"]/.test(txt)) M.scene.push(txt); else M.intro += (M.intro ? '\n\n' : '') + txt; continue; }
        if (mode === 'chal') {
          if (/^[“"]/.test(txt)) { if (ev) ev.read.push(txt); continue; }
          if (/^Add the following challenges?/i.test(txt)) { addRound = ev ? ev.round : 2; continue; }
          if (/following challenges are suitable/i.test(txt)) continue;
          const rm = txt.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th)\s+(montage( test)?\s+)?round\b|\bround\s+(\d)\b/i);
          if (rm && !/Suggested/i.test(txt)) { ev = { round: rm[1] ? ORDW[rm[1].toLowerCase()] : +rm[4], text: txt, read: [] }; M.events.push(ev); continue; }
          const ch = parseChallenge(html, addRound);
          if (ch && (ch.desc || ch.chars.length)) { M.challenges.push(ch); continue; }
          M.notes += (M.notes ? '\n' : '') + txt; continue;
        }
        if (mode === 'out') {
          const om = txt.match(/^(Total Success|Partial Success|Total Failure)\s*:\s*(.*)$/i);
          if (om) { okey = /Total Success/i.test(om[1]) ? 'success' : /Partial/i.test(om[1]) ? 'partial' : 'failure'; M.outcomes[okey] = om[2]; }
          else if (okey) M.outcomes[okey] += ' ' + txt;
          continue;
        }
        if (mode === 'okey' && okey) { M.outcomes[okey] = (M.outcomes[okey] ? M.outcomes[okey] + ' ' : '') + txt; continue; }
        if (mode === 'other') M.notes += (M.notes ? '\n' : '') + txt;
      }
      if (M.challenges.length >= 2) out.push(M);
    }
  }
  return out;
}
function parseMontageText(txt) {
  const L = txt.replace(/\r/g, '').split('\n').map(s => s.replace(/^[•¥*\-–]\s*/, '').trim()).filter(Boolean);
  const M = { id: 'mu-' + Date.now().toString(36), name: '', intro: '', scene: [], challenges: [], events: [], outcomes: {}, limits: null, notes: '', user: true };
  let mode = 'intro', addRound = 1, ev = null, last = null, okey = null;
  for (const ln of L) {
    if (!M.name) { M.name = ln.replace(/^./, c => c.toUpperCase()).replace(/\b\w+/g, w => w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w); continue; }
    if (/^Setting the Scene$/i.test(ln)) { mode = 'scene'; continue; }
    if (/^(Montage( Test)? )?Challenges$/i.test(ln)) { mode = 'chal'; continue; }
    if (/^(Montage( Test)? )?Outcomes$/i.test(ln)) { mode = 'out'; continue; }
    if (mode === 'intro') { M.intro += (M.intro ? ' ' : '') + ln; continue; }
    if (mode === 'scene') { if (/^[“"]/.test(ln) || !M.scene.length) M.scene.push(ln); else M.scene[M.scene.length - 1] += ' ' + ln; continue; }
    if (mode === 'chal') {
      if (/^[“"]/.test(ln)) { if (ev) ev.read.push(ln); continue; }
      if (/^Add the following challenges?/i.test(ln)) { addRound = ev ? ev.round : 2; continue; }
      const rm = ln.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+(montage( test)?\s+)?round\b|\bround\s+(\d)\b/i);
      if (rm && !/Suggested/i.test(ln) && !/^[^:]{2,50}:/.test(ln)) { ev = { round: rm[1] ? ORDW[rm[1].toLowerCase()] : +rm[4], text: ln, read: [] }; M.events.push(ev); continue; }
      const c = /^[^:!?]{2,60}[:!?]\s/.test(ln) ? parseChallenge(ln, addRound) : null;
      if (c) { M.challenges.push(c); last = c; continue; }
      if (last) { const merged = parseChallenge('<b>' + esc(last.name) + ':</b> ' + esc((last.desc + ' ' + (last.chars.length ? 'Suggested Characteristics: ' + last.chars.join(', ') + '. ' : '') + (last.skills.length ? 'Suggested Skills: ' + last.skills.join(', ') + '. ' : '') + ln).trim()), last.round); Object.assign(last, merged); }
      continue;
    }
    if (mode === 'out') {
      const om = ln.match(/^(Total Success|Partial Success|Total Failure)\s*:?\s*(.*)$/i);
      if (om) { okey = /Total Success/i.test(om[1]) ? 'success' : /Partial/i.test(om[1]) ? 'partial' : 'failure'; M.outcomes[okey] = om[2]; }
      else if (okey) M.outcomes[okey] += ' ' + ln;
    }
  }
  if (!M.name) M.name = 'Untitled montage';
  return M;
}

let MT_USER = store.get('mtg', []), MT_SESS = store.get('mtgsess', {});
const saveMt = () => store.set('mtg', MT_USER), saveMtS = () => store.set('mtgsess', MT_SESS);
let MT_BOOK = [];
const MTBYHEAD = {};
function refreshMontages() {
  MT_BOOK = []; for (const p of PACKS) MT_BOOK.push(...extractMontages(p));
  const seen = new Set(); MT_BOOK.forEach(m => { while (seen.has(m.id)) m.id += '-2'; seen.add(m.id); });
  for (const k in MTBYHEAD) delete MTBYHEAD[k];
  for (const m of MT_BOOK) MTBYHEAD[m.src.pack + ':' + m.src.ch + ':' + (m.src.hid || '_')] = m.id;
}
const allMt = () => [...MT_USER, ...MT_BOOK];
const mtById = id => allMt().find(m => m.id === id);
function newMtSess(M) {
  const heroes = (ENC && ENC.heroes) || 4; const [s, f] = mtLimits('moderate', heroes);
  return { started: false, heroes: Array.from({ length: heroes }, (_, i) => ({ name: 'Hero ' + (i + 1), skills: [] })), diff: 'moderate', sLimit: s, fLimit: f, rounds: 2, round: 1, succ: 0, fail: 0, acted: {}, over: {}, log: [], ended: null, share: true, malice: 0, tokens: 0, edges: {} };
}
const mtSessOf = M => MT_SESS[M.id] || (MT_SESS[M.id] = newMtSess(M));
const mtSnap = s => JSON.stringify({ ...s, log: undefined });
function mtCheckEnd(s, roundOver) {
  if (s.succ >= s.sLimit) s.ended = 'success';
  else if (s.fail >= s.fLimit || roundOver) s.ended = s.succ >= s.fail + 2 ? 'partial' : 'failure';
}
const mtVisible = (M, s) => M.challenges.map((c, i) => [c, i]).filter(([c]) => (c.round || 1) <= s.round);

// ---- hub ----
function montageHub() {
  refreshMontages();
  const byPack = {}; MT_BOOK.forEach(m => (byPack[m.pack] = byPack[m.pack] || []).push(m));
  const inProg = allMt().filter(m => MT_SESS[m.id] && MT_SESS[m.id].log.length && !MT_SESS[m.id].ended);
  const card = m => `<a class="negc mtc" href="#montage--${m.id}"><b>${esc(m.name)}</b><span>${m.challenges.length} challenges${m.events.length ? ' · ' + m.events.length + ' twist' + (m.events.length > 1 ? 's' : '') : ''}</span><em>${esc((m.intro || m.scene[0] || '').slice(0, 110))}${(m.intro || m.scene[0] || '').length > 110 ? '…' : ''}</em></a>`;
  $('#main').innerHTML = `<div class="neghub"><h1>Montage Tests</h1>
    <p class="note">Run a montage test round by round. Vanadium tracks successes and failures against the limits, which hero has acted, which skills they’ve used and which challenges are overcome, then tells you the outcome and the Victories earned. Rules: <a href="#book--heroes--tests--montage-tests">Montage Tests</a>.</p>
    <div class="negacts"><button class="btn" id="mtnew">+ New montage</button><button class="btn ghost" id="mtpaste">Paste a montage</button><a class="btn ghost" href="#import">Import a PDF</a></div>
    ${inProg.length ? `<h2 class="negh">In progress</h2><div class="negg">${inProg.map(card).join('')}</div>` : ''}
    ${MT_USER.length ? `<h2 class="negh">Your montages</h2><div class="negg">${MT_USER.map(card).join('')}</div>` : ''}
    ${Object.entries(byPack).map(([pid, list]) => `<h2 class="negh">From ${esc(PK[pid]?.title || pid)}</h2><div class="negg">${list.map(card).join('')}</div>`).join('')}
    ${!MT_BOOK.length && !MT_USER.length ? '<div class="empty">No montage tests yet. Import a book that has some, or make your own.</div>' : ''}</div>`;
  $('#mtnew').onclick = () => mtEditor(null);
  $('#mtpaste').onclick = mtPasteDialog;
  document.title = 'Montage Tests — Vanadium';
}
function mtEditor(def) {
  const d = def ? JSON.parse(JSON.stringify(def)) : { id: 'mu-' + Date.now().toString(36), name: '', intro: '', scene: [], challenges: [], events: [], outcomes: {}, user: true };
  const chText = d.challenges.map(c => `${c.round > 1 ? '[round ' + c.round + '] ' : ''}${c.name}: ${c.desc}${c.chars.length ? ' Suggested Characteristics: ' + c.chars.join(', ') + '.' : ''}${c.skills.length ? ' Suggested Skills: ' + c.skills.join(', ') + '.' : ''}${c.max > 1 ? ' This challenge can be overcome ' + (c.max === 2 ? 'twice' : c.max + ' times') + '.' : ''}`).join('\n');
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<div class="dlg-b negedit"><h2>${def ? 'Edit' : 'New'} montage test</h2>
    <label class="negnotes">Name<input id="me-n" value="${esc(d.name)}" placeholder="e.g. Escape the Burning Library"></label>
    <label class="negnotes">What the heroes are trying to do<textarea id="me-i" rows="2">${esc(d.intro)}</textarea></label>
    <label class="negnotes">Setting the scene (one read-aloud line per row)<textarea id="me-s" rows="3">${esc(d.scene.join('\n'))}</textarea></label>
    <label class="negnotes">Challenges (one per row: <i>Name: description. Suggested Characteristics: Might, Agility. Suggested Skills: Climb, Lift.</i> Start a row with [round 2] for a challenge that appears later)<textarea id="me-c" rows="7">${esc(chText)}</textarea></label>
    <div class="negouts"><label>Total success<input id="me-o1" value="${esc(d.outcomes.success || '')}"></label><label>Partial success<input id="me-o2" value="${esc(d.outcomes.partial || '')}"></label><label>Total failure<input id="me-o3" value="${esc(d.outcomes.failure || '')}"></label></div>
    <div class="dlgfoot">${def && def.user ? '<button class="btn danger" id="me-del">Delete</button>' : ''}<span style="flex:1"></span><button class="btn ghost" id="me-x">Cancel</button><button class="btn" id="me-ok">Save & run</button></div></div>`;
  document.body.appendChild(el);
  $('#me-x', el).onclick = () => el.remove();
  if ($('#me-del', el)) $('#me-del', el).onclick = async () => { if (await confirmSheet(`Delete “${d.name}”?`, 'Delete')) { MT_USER = MT_USER.filter(x => x.id !== d.id); delete MT_SESS[d.id]; saveMt(); saveMtS(); el.remove(); go('montage'); } };
  $('#me-ok', el).onclick = () => {
    d.name = $('#me-n', el).value.trim() || 'Untitled montage'; d.intro = $('#me-i', el).value.trim();
    d.scene = $('#me-s', el).value.split('\n').map(s => s.trim()).filter(Boolean);
    d.challenges = $('#me-c', el).value.split('\n').map(s => s.trim()).filter(Boolean).map(ln => { const r = ln.match(/^\[round (\d)\]\s*/i); const c = parseChallenge(ln.replace(/^\[round \d\]\s*/i, ''), r ? +r[1] : 1); return c; }).filter(Boolean);
    if (d.challenges.length < 1) { toast('Add at least one challenge'); return; }
    d.outcomes = { success: $('#me-o1', el).value.trim(), partial: $('#me-o2', el).value.trim(), failure: $('#me-o3', el).value.trim() };
    d.user = true; delete d.src; MT_USER = MT_USER.filter(x => x.id !== d.id); MT_USER.unshift(d); saveMt();
    if (MT_SESS[d.id] && !MT_SESS[d.id].started) delete MT_SESS[d.id]; saveMtS();
    el.remove(); buildIndex(); go('montage--' + d.id);
  };
}
function mtPasteDialog() {
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<div class="dlg-b"><h2>Paste a montage test</h2><p>Paste a montage from a PDF, document or website: the name, then <i>Setting the Scene</i>, <i>Montage Challenges</i> and <i>Montage Outcomes</i> sections.</p>
    <textarea id="mp-t" rows="12" style="width:100%;background:var(--bg);color:var(--ink);border:1px solid var(--line2);border-radius:5px;padding:10px;font-size:14px" placeholder="ROOFTOP CHASE&#10;The heroes chase a thief across the rooftops.&#10;Setting the Scene&#10;“Tiles slide underfoot…”&#10;Montage Challenges&#10;Leap the Gap: … Suggested Characteristics: Might, Agility. Suggested Skills: Jump, Gymnastics.&#10;Montage Outcomes&#10;Total Success: …"></textarea>
    <div id="mp-prev" class="note" style="margin-top:8px"></div>
    <div class="dlgfoot"><span style="flex:1"></span><button class="btn ghost" id="mp-x">Cancel</button><button class="btn" id="mp-ok">Review & save</button></div></div>`;
  document.body.appendChild(el);
  const ta = $('#mp-t', el);
  ta.oninput = () => { const m = parseMontageText(ta.value); $('#mp-prev', el).textContent = ta.value.trim() ? `Found: ${m.name} · ${m.scene.length} scene lines · ${m.challenges.length} challenges · ${Object.keys(m.outcomes).length} outcomes` : ''; };
  $('#mp-x', el).onclick = () => el.remove();
  $('#mp-ok', el).onclick = () => { const m = parseMontageText(ta.value); el.remove(); mtEditor(m); };
  setTimeout(() => ta.focus(), 30);
}

// ---- runner ----
let mtUI = { hero: null, action: 'test', ch: null, char: '', skill: '', diff: 'medium', rolled: null, bonus: 0, edge: 0, auto: 1, cons: 1 };
function montagePage(id) {
  refreshMontages();
  const M = mtById(id);
  if (!M) { if (!PACKS.length || BUILTIN.some(b => id.startsWith(b.id))) { $('#main').innerHTML = '<div class="empty">Loading…</div>'; return; } go('montage'); return; }
  const s = mtSessOf(M);
  const pips = (n, lim, cls) => `<div class="mtp ${cls}">${Array.from({ length: lim }, (_, k) => `<span class="${k < n ? 'on' : ''}"></span>`).join('')}<b>${n}<small>/${lim}</small></b></div>`;
  const vis = mtVisible(M, s);
  const evNow = M.events.filter(e => e.round === s.round);
  const outTxt = { success: 'Total success', partial: 'Partial success', failure: 'Total failure' };
  const endCard = s.ended ? `<div class="negend ${s.ended === 'failure' ? 'nodeal' : ''}"><b>${outTxt[s.ended]}</b>: ${s.succ} successes, ${s.fail} failures. ${esc(M.outcomes[s.ended] || '')}<div class="vict">Victories: ${mtVictories(s.ended, s.diff === 'moderate' ? 'moderate' : s.diff)} each (${s.diff} montage). ${s.malice ? `Consequences to apply: ${s.malice}. ` : ''}${s.tokens ? `Rewards earned: ${s.tokens}.` : ''}</div></div>` : '';
  const heroesActed = s.acted[s.round] || {};
  $('#main').innerHTML = `<div class="negrun"><div class="negmain">
    <div class="negtop"><div><div class="kind">${esc(M.user ? 'Your montage' : (PK[M.pack]?.title || ''))}</div><h1>${esc(M.name)}</h1>
      <div class="negmeta">${M.challenges.length} challenges${M.src ? ` · <a data-gobook="${esc(M.src.pack)}--${esc(M.src.ch)}${M.src.hid ? '--' + esc(M.src.hid) : ''}">open in book</a>` : ''}</div></div>
      <div class="negtb"><button class="btn ghost sm" id="mt-pdf">PDF</button><button class="btn ghost sm" id="mt-table">Player view</button>${M.user ? '<button class="btn ghost sm" id="mt-edit">Edit</button>' : '<button class="btn ghost sm" id="mt-copy">Copy & edit</button>'}<button class="btn ghost sm" id="mt-reset">Restart</button><a class="btn ghost sm" href="#montage">All</a></div></div>
    ${endCard}
    ${s.started ? `<div class="negstats"><div class="nstat"><span>Successes</span>${pips(s.succ, s.sLimit, 'succ')}</div><div class="nstat"><span>Failures</span>${pips(s.fail, s.fLimit, 'fail')}</div></div>
      <div class="mtround"><b>Round ${s.round} of ${s.rounds}</b><span class="mtheroes">${s.heroes.map((h, i) => `<span class="hchip ${heroesActed[i] ? 'done' : ''} ${mtUI.hero === i ? 'sel' : ''}" data-hero="${i}">${esc(h.name)}${s.edges[i] ? ' <i>edge</i>' : ''}</span>`).join('')}</span>${s.ended ? '' : `<button class="btn ghost sm" id="mt-endround">${s.round >= s.rounds ? 'End montage' : 'End round ' + s.round}</button>`}</div>
      ${evNow.length && !s.ended ? evNow.map(e => `<div class="mtev"><b>Round ${e.round}:</b> ${esc(e.text)}${e.read.map(r => `<div class="ra">${esc(r)}</div>`).join('')}${M.challenges.some(c => c.round === e.round) ? `<div class="note">New challenges: ${M.challenges.filter(c => c.round === e.round).map(c => esc(c.name)).join(', ')}</div>` : ''}</div>`).join('') : ''}
      ${s.ended ? `<div class="negpanel"><div class="actrow"><button class="btn ghost" id="mt-undo" ${s.log.length ? '' : 'disabled'}>Undo last step</button><button class="btn" id="mt-again">Run it again</button></div></div>` : mtActionHtml(M, s)}`
      : mtSetupHtml(M, s)}
    <div class="neglog"><h3>Log</h3>${s.log.length ? s.log.slice().reverse().map(l => `<div class="lg ${l.kind || ''}"><span class="lgv">${l.r ? 'R' + l.r + ' · ' : ''}${l.s}✓ ${l.f}✗</span>${esc(l.text)}</div>`).join('') : '<div class="note">Nothing yet.</div>'}</div>
  </div>
  <aside class="negside">
    ${M.intro ? `<h3>Goal</h3><p class="nnote">${esc(M.intro)}</p>` : ''}
    ${M.scene.length ? `<h3>Setting the scene</h3>${M.scene.map(x => `<div class="ra">${esc(x)}</div>`).join('')}` : ''}
    <h3>Challenges</h3>${M.challenges.map((c, i) => { const n = s.over[i] || 0, hidden = (c.round || 1) > s.round; return `<div class="mtch ${n >= c.max ? 'done' : ''} ${hidden ? 'later' : ''}"><div class="mtch-h"><b>${esc(c.name)}</b>${c.max > 1 ? `<span class="tagk">×${c.max}</span>` : ''}${hidden ? `<span class="tagk">round ${c.round}</span>` : ''}${n ? `<span class="tagu">${n >= c.max ? 'overcome' : n + '/' + c.max}</span>` : ''}</div>${c.desc ? `<p>${esc(c.desc)}</p>` : ''}${c.chars.length || c.skills.length ? `<div class="mtsug">${c.chars.map(x => `<span class="ck">${esc(x)}</span>`).join('')}${c.skills.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</div>`; }).join('')}
    ${Object.keys(M.outcomes).length ? `<h3>Outcomes</h3>${['success', 'partial', 'failure'].filter(k => M.outcomes[k]).map(k => `<div class="nout ${s.ended === k ? 'cur' : ''}"><b>${outTxt[k]}:</b> ${esc(M.outcomes[k])}</div>`).join('')}` : ''}
    ${M.notes ? `<h3>Notes</h3><p class="nnote">${esc(M.notes)}</p>` : ''}
  </aside></div>`;
  wireMt(M, s);
  document.title = M.name + ' — Montage';
}
function mtSetupHtml(M, s) {
  const lim = M.limits ? `<div class="note">This montage has its own limits: ${M.limits.rows.map(r => `${esc(r[0])} heroes ${esc(r[1])}/${esc(r[2])}`).join(' · ')}</div>` : '';
  return `<div class="negpanel"><h3>Set up the montage</h3>
    <div class="party dlgp"><label>Heroes<input type="number" id="mt-h" min="1" max="10" value="${s.heroes.length}" inputmode="numeric"></label>
    <label>Difficulty<select id="mt-d">${['easy', 'moderate', 'hard'].map(d => `<option ${s.diff === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label>Success limit<input type="number" id="mt-sl" min="1" value="${s.sLimit}"></label><label>Failure limit<input type="number" id="mt-fl" min="1" value="${s.fLimit}"></label><label>Rounds<input type="number" id="mt-r" min="1" max="6" value="${s.rounds}"></label></div>
    ${lim}
    <div class="mthnames">${s.heroes.map((h, i) => `<input data-hn="${i}" value="${esc(h.name)}" aria-label="Hero ${i + 1} name">`).join('')}</div>
    <label class="row-c"><input type="checkbox" id="mt-share" ${s.share ? 'checked' : ''}> Show successes and failures in the player view</label>
    <div class="actrow"><button class="btn" id="mt-begin">Begin montage</button></div>
    <p class="note" style="margin-top:8px">Each hero gets one action per round: a test, an assist, or using an ability or item. A hero can’t use the same skill twice. The montage ends at the success limit, the failure limit, or after round ${s.rounds}. Partial success needs at least two more successes than failures.</p></div>`;
}
function mtActionHtml(M, s) {
  const u = mtUI; const acted = s.acted[s.round] || {};
  if (u.hero == null || acted[u.hero]) { const nx = s.heroes.findIndex((_, i) => !acted[i]); u.hero = nx >= 0 ? nx : null; }
  if (u.hero == null) return `<div class="negpanel"><h3>Everyone has acted this round</h3><div class="actrow"><button class="btn" id="mt-endround2">${s.round >= s.rounds ? 'End the montage' : 'Start round ' + (s.round + 1)}</button><button class="btn ghost" id="mt-undo" ${s.log.length ? '' : 'disabled'}>Undo</button></div></div>`;
  const h = s.heroes[u.hero];
  const vis = mtVisible(M, s);
  const ch = u.ch != null ? M.challenges[u.ch] : null;
  const tiers = MT_TIERS[u.diff];
  const skillUsed = u.skill && h.skills.map(x => x.toLowerCase()).includes(u.skill.trim().toLowerCase());
  let body = `<h3>${esc(h.name)}’s turn${s.edges[u.hero] ? ' <span class="tagu">has an edge from an assist</span>' : ''}</h3>
    <div class="seg4">${[['test', 'Make a test'], ['assist', 'Assist another hero'], ['ability', 'Use an ability or item'], ['pass', 'Pass']].map(([k, l]) => `<button class="${u.action === k ? 'on' : ''}" data-act="${k}">${l}</button>`).join('')}</div>`;
  if (u.action === 'test') {
    body += `<div class="mtpick">${vis.map(([c, i]) => { const n = s.over[i] || 0; const done = n >= c.max; return `<button class="argt ${u.ch === i ? 'sel' : ''} ${done ? 'usedm' : 'mot'}" data-ch="${i}" ${done ? 'title="Already overcome"' : ''}><b>${esc(c.name)}</b><span>${done ? 'overcome' : (c.chars.join(', ') || 'any characteristic')}</span></button>`; }).join('')}<button class="argt none ${u.ch === -1 ? 'sel' : ''}" data-ch="-1"><b>Something else</b><span>A clever idea of their own</span></button></div>`;
    if (u.ch != null) {
      const chars = ch && ch.chars.length ? ch.chars : ['Might', 'Agility', 'Reason', 'Intuition', 'Presence'];
      body += `<div class="mtrow"><label>Characteristic<select id="mt-char">${['Might', 'Agility', 'Reason', 'Intuition', 'Presence'].map(c => `<option ${u.char === c ? 'selected' : ''}>${c}${chars.includes(c) && ch ? ' ★' : ''}</option>`).join('')}</select></label>
        <label>Skill<input id="mt-skill" list="mt-skills" value="${esc(u.skill)}" placeholder="optional"></label><datalist id="mt-skills">${(ch ? ch.skills : []).concat(D.skills.map(x => x.name)).filter((v, i, a) => a.indexOf(v) === i).map(x => `<option>${esc(x)}</option>`).join('')}</datalist>
        <label>Difficulty<select id="mt-diff">${['easy', 'medium', 'hard'].map(d => `<option ${u.diff === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label></div>
        <div class="warn" id="mt-skwarn" style="${skillUsed ? '' : 'display:none'}">${esc(h.name)} has already used this skill in this montage. A hero can’t use the same skill twice (unless you lift the restriction).</div>
        ${ch && ch.skills.length ? `<div class="mtsug">Suggested: ${ch.skills.map(x => `<span class="${h.skills.includes(x) ? 'usedsk' : ''}" data-sk="${esc(x)}">${esc(x)}</span>`).join('')}</div>` : ''}
        <div class="rollrow"><span>Power roll:</span><label>Bonus <input type="number" id="mt-bonus" value="${u.bonus}" inputmode="numeric"></label><select id="mt-edge"><option value="0">No edge/bane</option><option value="1" ${u.edge == 1 || (s.edges[u.hero] && u.edge === undefined) ? 'selected' : ''}>Edge (+2)</option><option value="2" ${u.edge == 2 ? 'selected' : ''}>Double edge</option><option value="-1" ${u.edge == -1 ? 'selected' : ''}>Bane (−2)</option><option value="-2" ${u.edge == -2 ? 'selected' : ''}>Double bane</option></select><button class="btn sm" id="mt-roll">Roll 2d10</button>${u.rolled && u.rolled.total != null ? `<b class="rollres">${u.rolled.total}${u.rolled.nat >= 19 ? ' · natural ' + u.rolled.nat : ''} → tier ${u.rolled.tier}</b>` : ''}</div>
        <div class="tierpick">${[1, 2, 3].map(t => `<button class="tierb n${t} ${u.rolled && u.rolled.tier === t ? 'on' : ''}" data-tier="${t}"><span class="tb">${['', '≤11', '12–16', '17+'][t]}</span>${tiers[t][1]}${u.rolled && u.rolled.nat >= 19 && t === 3 ? ' (natural 19–20: with a reward)' : ''}</button>`).join('')}</div>
        <div class="actrow"><button class="btn" id="mt-apply" ${u.rolled && u.rolled.tier ? '' : 'disabled'}>Apply result</button><button class="btn ghost" id="mt-auto">Clever idea: automatic success</button></div>`;
    }
  } else if (u.action === 'assist') {
    body += `<div class="mtrow"><label>Assisting<select id="mt-target">${s.heroes.map((x, i) => i === u.hero || acted[i] ? '' : `<option value="${i}">${esc(x.name)}</option>`).join('')}</select></label><label>Skill used<input id="mt-askill" placeholder="optional"></label></div>
      <p class="note">The assisting hero makes a test to help. On a success the other hero gains an edge on their test (a natural 19–20 or great result can give a double edge, at your discretion).</p>
      <div class="actrow"><button class="btn" data-assist="1">Assist succeeds: edge</button><button class="btn ghost" data-assist="0">Assist fails</button></div>`;
  } else if (u.action === 'ability') {
    body += `<p class="note">A hero can spend their turn using an item, ability or other option. You decide how many automatic successes it’s worth (the book’s example gives 2).</p>
      <div class="mtrow"><label>Automatic successes<input type="number" id="mt-autoN" min="0" max="5" value="${u.auto}"></label><label style="flex:2">What they did<input id="mt-what" placeholder="e.g. a magic fan fills the sails"></label></div>
      <div class="actrow"><button class="btn" id="mt-useab">Apply</button></div>`;
  } else {
    body += `<div class="actrow"><button class="btn" id="mt-pass">${esc(h.name)} passes this round</button></div>`;
  }
  body += `<div class="actrow" style="margin-top:10px"><button class="btn ghost sm" id="mt-undo" ${s.log.length ? '' : 'disabled'}>Undo</button><span class="note" style="margin:0">Consequences: ${s.malice} · Rewards: ${s.tokens}</span><button class="btn ghost sm" data-adj="malice">+1 consequence</button><button class="btn ghost sm" data-adj="tokens">+1 reward</button></div>`;
  return `<div class="negpanel">${body}</div>`;
}
function wireMt(M, s) {
  const re = () => { saveMtS(); montagePage(M.id); };
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  const log = (text, kind, before) => s.log.push({ text, kind, before, s: s.succ, f: s.fail, r: s.round });
  on('#mt-reset', async () => { if (await confirmSheet('Restart this montage test?', 'Restart')) { MT_SESS[M.id] = newMtSess(M); mtUI = { action: 'test', diff: 'medium', bonus: 0, edge: 0, auto: 1 }; re(); } });
  on('#mt-again', () => { MT_SESS[M.id] = newMtSess(M); mtUI = { action: 'test', diff: 'medium', bonus: 0, edge: 0, auto: 1 }; re(); });
  on('#mt-edit', () => mtEditor(M));
  on('#mt-copy', () => { const c = JSON.parse(JSON.stringify(M)); c.id = 'mu-' + Date.now().toString(36); c.user = true; delete c.src; mtEditor(c); });
  on('#mt-table', () => mtPlayerView(M, s));
  on('#mt-pdf', () => runPdfJob($('#mt-pdf'), 'PDF', async () => { const b = await buildMontagePdf(M); await deliverFile(pdfFileName(M.name, 'montage'), new Blob([b], { type: 'application/pdf' })); }));
  // setup
  const recalc = () => { const n = Math.max(1, +$('#mt-h').value || 4); const [a, b] = mtLimits($('#mt-d').value, n); $('#mt-sl').value = a; $('#mt-fl').value = b; s.diff = $('#mt-d').value; while (s.heroes.length < n) s.heroes.push({ name: 'Hero ' + (s.heroes.length + 1), skills: [] }); s.heroes.length = n; s.sLimit = a; s.fLimit = b; re(); };
  if ($('#mt-h')) { $('#mt-h').onchange = recalc; $('#mt-d').onchange = recalc; }
  $$('[data-hn]').forEach(i => i.onchange = () => { s.heroes[+i.dataset.hn].name = i.value || 'Hero'; saveMtS(); });
  on('#mt-begin', () => { s.sLimit = Math.max(1, +$('#mt-sl').value || s.sLimit); s.fLimit = Math.max(1, +$('#mt-fl').value || s.fLimit); s.rounds = Math.max(1, +$('#mt-r').value || 2); s.share = $('#mt-share').checked; s.started = true; const b = mtSnap(s); log(`Montage begins (${s.diff}, ${s.heroes.length} heroes): success limit ${s.sLimit}, failure limit ${s.fLimit}, ${s.rounds} rounds`, 'start', b); mtUI = { action: 'test', diff: 'medium', bonus: 0, auto: 1 }; re(); });
  // turn
  $$('[data-hero]').forEach(c => c.onclick = () => { if ((s.acted[s.round] || {})[+c.dataset.hero]) return; mtUI.hero = +c.dataset.hero; mtUI.rolled = null; re(); });
  $$('[data-act]').forEach(b => b.onclick = () => { mtUI.action = b.dataset.act; re(); });
  $$('[data-ch]').forEach(b => b.onclick = () => { const i = +b.dataset.ch; const c = M.challenges[i]; if (c && (s.over[i] || 0) >= c.max) { toast('That challenge is already overcome'); return; } mtUI.ch = i; mtUI.rolled = null; mtUI.char = c && c.chars.length ? (c.chars.find(x => ['Might', 'Agility', 'Reason', 'Intuition', 'Presence'].includes(x)) || 'Reason') : 'Reason'; mtUI.skill = ''; mtUI.edge = s.edges[mtUI.hero] ? 1 : 0; re(); });
  const keep = () => { const c = $('#mt-char'), k = $('#mt-skill'), d = $('#mt-diff'), bo = $('#mt-bonus'), e = $('#mt-edge'); if (c) mtUI.char = c.value.replace(' ★', ''); if (k) mtUI.skill = k.value; if (d) mtUI.diff = d.value; if (bo) mtUI.bonus = +bo.value || 0; if (e) mtUI.edge = +e.value; };
  $$('#mt-char,#mt-diff,#mt-edge').forEach(x => x.onchange = () => { keep(); re(); });
  if ($('#mt-skill')) $('#mt-skill').oninput = () => { mtUI.skill = $('#mt-skill').value; const used = s.heroes[mtUI.hero].skills.map(x => x.toLowerCase()).includes(mtUI.skill.trim().toLowerCase()); $('#mt-skwarn').style.display = used && mtUI.skill.trim() ? '' : 'none'; };
  $$('[data-sk]').forEach(x => x.onclick = () => { keep(); mtUI.skill = x.dataset.sk; re(); });
  on('#mt-roll', () => { keep(); const d1 = 1 + Math.floor(Math.random() * 10), d2 = 1 + Math.floor(Math.random() * 10), nat = d1 + d2; const ed = +mtUI.edge; const tot = nat + mtUI.bonus + (ed === 1 ? 2 : ed === -1 ? -2 : 0); let tier = tot <= 11 ? 1 : tot <= 16 ? 2 : 3; if (ed === 2) tier = Math.min(3, tier + 1); if (ed === -2) tier = Math.max(1, tier - 1); if (nat >= 19) tier = 3; mtUI.rolled = { total: tot, nat, tier }; re(); });
  $$('[data-tier]').forEach(b => b.onclick = () => { keep(); const t = +b.dataset.tier; mtUI.rolled = { ...(mtUI.rolled || {}), tier: t, total: mtUI.rolled && mtUI.rolled.tier === t ? mtUI.rolled.total : null }; re(); });
  const finishTurn = () => { (s.acted[s.round] = s.acted[s.round] || {})[mtUI.hero] = true; delete s.edges[mtUI.hero]; mtCheckEnd(s, false); mtUI = { action: 'test', diff: mtUI.diff, bonus: 0, auto: 1 }; };
  const apply = (forced) => {
    keep(); const b = mtSnap(s); const h = s.heroes[mtUI.hero]; const c = mtUI.ch >= 0 ? M.challenges[mtUI.ch] : null;
    let res, label, reward = false, cons = false;
    if (forced) { res = 's'; label = 'Automatic success'; }
    else { const t = mtUI.rolled.tier; [res, label] = MT_TIERS[mtUI.diff][t]; if (mtUI.rolled.nat >= 19) { res = 's'; label = 'Success with a reward (natural ' + mtUI.rolled.nat + ')'; } }
    if (/consequence/i.test(label)) cons = true; if (/reward/i.test(label)) reward = true;
    if (res === 's') { s.succ++; if (mtUI.ch >= 0) s.over[mtUI.ch] = (s.over[mtUI.ch] || 0) + 1; } else s.fail++;
    if (cons) s.malice += 1; if (reward) s.tokens += 1;
    if (mtUI.skill.trim()) h.skills.push(mtUI.skill.trim());
    log(`${h.name}: ${c ? c.name : 'their own idea'} (${forced ? 'no roll' : mtUI.diff + ' ' + mtUI.char + (mtUI.skill ? ' + ' + mtUI.skill : '')}) → ${label}`, res === 's' ? 'positive' : 'negative', b);
    finishTurn(); re();
  };
  on('#mt-apply', () => apply(false));
  on('#mt-auto', () => apply(true));
  $$('[data-assist]').forEach(x => x.onclick = () => { if (!$('#mt-target').value) { toast('Everyone else has already acted this round'); return; } const b = mtSnap(s); const t = +$('#mt-target').value; const ok = x.dataset.assist === '1'; if (ok) s.edges[t] = true; const sk = $('#mt-askill').value.trim(); if (sk) s.heroes[mtUI.hero].skills.push(sk); log(`${s.heroes[mtUI.hero].name} assists ${s.heroes[t].name}${sk ? ' with ' + sk : ''}: ${ok ? 'edge on their test' : 'no help'}`, ok ? 'positive' : 'impatient', b); finishTurn(); re(); });
  on('#mt-useab', () => { const b = mtSnap(s); const n = Math.max(0, +$('#mt-autoN').value || 0); s.succ += n; log(`${s.heroes[mtUI.hero].name} uses ${$('#mt-what').value.trim() || 'an ability or item'}: ${n} automatic success${n === 1 ? '' : 'es'}`, 'positive', b); finishTurn(); re(); });
  on('#mt-pass', () => { const b = mtSnap(s); log(`${s.heroes[mtUI.hero].name} passes`, 'impatient', b); finishTurn(); re(); });
  const endRound = () => { const b = mtSnap(s); if (s.round >= s.rounds) { mtCheckEnd(s, true); log(`Time runs out after round ${s.round}`, 'start', b); } else { s.round++; s.edges = {}; log(`Round ${s.round} begins`, 'start', b); } mtUI.hero = null; re(); };
  on('#mt-endround', endRound); on('#mt-endround2', endRound);
  $$('[data-adj]').forEach(x => x.onclick = () => { s[x.dataset.adj]++; re(); });
  on('#mt-undo', () => { const l = s.log.pop(); if (l && l.before) { const st = JSON.parse(l.before); const lg = s.log; Object.assign(s, st); s.log = lg; } mtUI = { action: 'test', diff: 'medium', bonus: 0, auto: 1 }; re(); });
}
function mtPlayerView(M, s) {
  const el = document.createElement('div'); el.className = 'pview';
  const vis = mtVisible(M, s);
  el.innerHTML = `<button class="pv-x">✕ Close player view</button><div class="pv-in"><div class="pv-k">Montage test</div><h1>${esc(M.name)}</h1>
    ${s.started && s.share ? `<div class="pv-stats"><div><span>Successes</span><b>${s.succ}<small style="font-size:24px;opacity:.6">/${s.sLimit}</small></b></div><div><span>Failures</span><b>${s.fail}<small style="font-size:24px;opacity:.6">/${s.fLimit}</small></b></div><div><span>Round</span><b>${s.round}<small style="font-size:24px;opacity:.6">/${s.rounds}</small></b></div></div>` : ''}
    ${s.ended ? `<div class="pv-offer">${{ success: 'Total success!', partial: 'Partial success', failure: 'Total failure' }[s.ended]}</div>` : ''}
    ${!s.started || s.round === 1 ? M.scene.map(x => `<p class="pv-ra">${esc(x)}</p>`).join('') : M.events.filter(e => e.round <= s.round).map(e => e.read.map(r => `<p class="pv-ra">${esc(r)}</p>`).join('')).join('')}
    <div class="pv-known"><h3>Challenges</h3>${vis.map(([c, i]) => `<span class="${(s.over[i] || 0) >= c.max ? 'm' : 'open'}">${(s.over[i] || 0) >= c.max ? '✓ ' : ''}${esc(c.name)}</span>`).join('')}</div></div>`;
  $('.pv-x', el).onclick = () => el.remove();
  document.body.appendChild(el);
}

// ================= BOOK ENCOUNTERS → ENCOUNTER BUILDER =================
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, sixteen: 16 };
const singulars = w => uniq([w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y'), w.replace(/ves$/, 'f'), w.replace(/eses$/, 'esis'), w.replace(/men$/, 'man'), w.replace(/i$/, 'us')]);
function matchMonster(raw, packId) {
  const t = raw.toLowerCase().replace(/[’']/g, '’').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9’\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nm = x => x.name.toLowerCase().replace(/[’']/g, '’');
  const pool = MONS.filter(m => !packId || m.pack === packId).concat(MONS.filter(m => packId && m.pack !== packId));
  const words = t.split(' ');
  for (let n = Math.min(words.length, 6); n >= 1; n--) {
    const w = words.slice(0, n);
    const forms = [w.join(' ')];
    w.forEach((x, k) => singulars(x).forEach(sg => forms.push([...w.slice(0, k), sg, ...w.slice(k + 1)].join(' '))));
    for (const f of forms) { const m = pool.find(x => nm(x) === f); if (m) return m; }
  }
  return null;
}
function parseCreatureCell(txt) {
  const out = []; const re = /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|sixteen|\d+)\s+(.+?)(?=(?:\s+(?:and\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+[a-z])|,\s*|$)/gi; let m;
  const s = strip(txt).replace(/\s+/g, ' ');
  while ((m = re.exec(s))) { const n = NUMW[m[1].toLowerCase()] ?? parseInt(m[1]); const rest = m[2].trim(); if (rest) out.push({ n, text: rest }); }
  return out;
}
function bookEncounterTables() {
  const list = [];
  for (const p of PACKS) for (const c of p.chapters) {
    let head = null;
    c.blocks.forEach((b, i) => {
      if (b.t === 'h' && b.lvl <= 3 && b.lvl > 0) head = b.text;
      if (b.t === 'table' && b.head.length >= 2 && /^Group/i.test(b.head[0]) && /Creature/i.test(b.head[1])) list.push({ pack: p.id, ch: c.id, chTitle: c.title, part: c.part, i, name: head ? head : c.title, table: b });
    });
  }
  return list;
}
function bookEncounterData(packId, chId, idx) {
  const p = PK[packId]; const c = p && p.chapters.find(x => x.id === chId); const t = c && c.blocks[idx]; if (!t) return null;
  let head = c.title; for (let k = idx; k >= 0; k--) { const b = c.blocks[k]; if (b.t === 'h' && b.lvl <= 3 && b.lvl > 0) { head = b.text; break; } }
  const groups = [], missing = [];
  for (const r of t.rows) {
    const entries = [];
    for (const it of parseCreatureCell(r[1] || '')) {
      const m = matchMonster(it.text, packId);
      if (!m) { missing.push(`${it.n} ${it.text}`); continue; }
      const ex = entries.find(e => e.gid === m.gid); if (ex) ex.n += it.n; else entries.push({ gid: m.gid, n: it.n });
    }
    if (entries.length) groups.push({ id: 'g' + groups.length + Date.now().toString(36), name: 'Group ' + strip(r[0] || String(groups.length + 1)), entries });
  }
  const adj = [];
  for (let k = idx + 1; k < Math.min(c.blocks.length, idx + 14); k++) {
    const b = c.blocks[k];
    if (b.t === 'table') break;
    if (b.t === 'h' && /adjust/i.test(b.text)) { for (let j = k + 1; j < c.blocks.length; j++) { const x = c.blocks[j]; if (x.t === 'h' || x.t === 'table') break; const tx = strip(x.html || ''); if (tx) adj.push(tx); } break; }
  }
  return { name: (c.title !== head ? c.title + ': ' : '') + head, head, groups, missing, adj: adj.length ? adj : null };
}
async function loadBookEncounter(packId, chId, idx) {
  const d = bookEncounterData(packId, chId, idx); if (!d) return;
  if (!d.groups.length) { toast('Couldn’t match any creatures in that table'); return; }
  const hasStuff = ENC.groups.some(g => g.entries.length);
  if (hasStuff && !(await confirmSheet(`Replace the current encounter (“${ENC.name}”) with ${d.head}?`, 'Replace'))) return;
  ENC.name = d.name; ENC.groups = d.groups; ENC.setup = false; ENC.bookAdjust = d.adj; ENC.stones = {}; saveEnc();
  go('encounter');
  setTimeout(() => toast(d.missing.length ? `Loaded. Not found: ${esc(d.missing.join(', '))}` : `Loaded ${d.groups.length} groups from ${esc(d.head)}`), 300);
}
function bookEncounterSheet(onPick) {
  const list = bookEncounterTables();
  const el = document.createElement('div'); el.className = 'dlg';
  const byPack = {}; list.forEach(x => (byPack[x.pack] = byPack[x.pack] || []).push(x));
  el.innerHTML = `<div class="dlg-b negedit"><h2>Load an encounter from a book</h2><p>Every encounter group table in your books. Picking one fills the builder with its initiative groups.</p>
    <input id="be-q" type="search" placeholder="Filter…" style="width:100%;margin-bottom:10px;background:var(--bg);color:var(--ink);border:1px solid var(--line2);border-radius:4px;padding:8px">
    <div id="be-l">${Object.entries(byPack).map(([pid, xs]) => `<h3 class="negh" style="margin-top:10px">${esc(PK[pid]?.title || pid)}</h3>${xs.map(x => `<button class="beitem" data-be="${x.pack}|${x.ch}|${x.i}" data-q="${esc((x.chTitle + ' ' + x.name).toLowerCase())}"><b>${esc(x.name)}</b><span>${esc(x.chTitle)} · ${x.table.rows.length} groups</span></button>`).join('')}`).join('') || '<div class="empty">No encounter tables found in your books.</div>'}</div>
    <div class="dlgfoot"><span style="flex:1"></span><button class="btn ghost" id="be-x">Close</button></div></div>`;
  document.body.appendChild(el);
  $('#be-x', el).onclick = () => el.remove();
  $('#be-q', el).oninput = e => { const q = e.target.value.toLowerCase(); $$('.beitem', el).forEach(b => b.style.display = b.dataset.q.includes(q) ? '' : 'none'); };
  $$('[data-be]', el).forEach(b => b.onclick = () => { const [p, c, i] = b.dataset.be.split('|'); el.remove(); onPick ? onPick(p, c, +i) : loadBookEncounter(p, c, +i); });
}
window.__mt = () => ({ get MT_BOOK() { return MT_BOOK; }, refreshMontages, allNegs, refreshNegotiations, MONS, bookEncounterTables, parseCreatureCell, matchMonster });

// Draw Steel PDF sheets: montage tests and negotiations (moved from print.js)
// ---------- montage sheet ----------
async function buildMontagePdf(M) {
  const w = await makeWriter(M.name);
  w.newPage();
  w.header(M.name, 'Montage test' + (M.user ? '' : ' · ' + (PK[M.pack]?.title || '')) + (M.src?.pg ? ', p. ' + M.src.pg : ''), `${M.challenges.length} challenges`);
  if (M.intro) w.para(esc(M.intro), { size: 9.5 });
  if (M.scene.length) { w.h('Setting the scene', 3); M.scene.forEach(x => w.quote(esc(x))); }
  // setup
  w.h('Setup', 2, 'Pick the difficulty, then circle the limits for your number of heroes.');
  const diffs = ['easy', 'moderate', 'hard']; const hs = [2, 3, 4, 5, 6, 7, 8];
  w.table(['Difficulty', ...hs.map(n => n + ' heroes'), 'Victories'], diffs.map(d => [`<b>${d[0].toUpperCase() + d.slice(1)}</b>`, ...hs.map(n => { const [a, b] = mtLimits(d, n); return `${a} / ${b}`; }), d === 'easy' ? 'Total success: 1' : d === 'moderate' ? 'Success 1 · Partial 1' : 'Success 2 · Partial 1']), [1.4, 1, 1, 1, 1, 1, 1, 1, 2.2], { size: 8 });
  if (M.limits) w.para(`<i>This montage’s own limits: ${M.limits.rows.map(r => esc(r.join(' / '))).join('; ')}</i>`, { size: 8 });
  w.para('<b>Limits</b> are shown as success limit / failure limit. The montage ends at either limit or after the last round. <b>Partial success</b>: time runs out (or the failure limit is hit) with at least two more successes than failures.', { size: 8, color: w.grey });
  // trackers
  w.h('Tracker', 2);
  w.ensure(70);
  const track = (label, n) => { w.T(label, w.MG, w.y - 11, 9, w.FB); for (let k = 0; k < n; k++) w.box(w.MG + 70 + k * 22, w.y - 16, 18, 18, { bw: 0.8 }); w.T('limit: ____', w.MG + 70 + n * 22 + 6, w.y - 11, 8, w.F, w.grey); w.y -= 24; };
  track('Successes', 12); track('Failures', 12);
  w.T('Round', w.MG, w.y - 11, 9, w.FB); ['1', '2', '3'].forEach((r, k) => { w.box(w.MG + 70 + k * 40, w.y - 16, 18, 18); w.T(r, w.MG + 92 + k * 40, w.y - 11, 8, w.F, w.grey); }); w.T('Consequences: ________   Rewards: ________', w.MG + 200, w.y - 11, 8.5, w.F, w.grey); w.y -= 28;
  for (const r of [1, 2]) {
    w.h('Round ' + r, 3, 'One action per hero: a test, an assist, or an ability/item.');
    w.table(['Hero', 'Challenge', 'Characteristic + skill', 'Easy / Med / Hard', 'Result'], Array.from({ length: 5 }, () => ['', '', '', 'E  ·  M  ·  H', 'Pass / Fail']), [1.3, 1.8, 1.8, 1.1, 0.8], { minH: 20, size: 8 });
    const ev = M.events.filter(e => e.round === r); ev.forEach(e => { w.para(`<b>Round ${e.round}:</b> ${esc(e.text)}`, { size: 9 }); e.read.forEach(x => w.quote(esc(x))); });
  }
  w.ensure(120); w.para('<b>Skills already used</b> (a hero can’t use the same skill twice):', { size: 8.5 });
  w.table(null, Array.from({ length: 5 }, () => ['Hero:', '']), [1, 4], { minH: 18, size: 8 });
  // challenges
  w.h('Challenges', 2, 'Tick a box each time a challenge is overcome.');
  for (const c of M.challenges) {
    const body = `<b>${esc(c.name)}</b>${c.round > 1 ? ` <i>(appears in round ${c.round})</i>` : ''}${c.max > 1 ? ` <i>(can be overcome ${c.max} times)</i>` : ''}. ${esc(c.desc)}${c.chars.length ? ` <b>Characteristics:</b> ${esc(c.chars.join(', '))}.` : ''}${c.skills.length ? ` <b>Skills:</b> ${esc(c.skills.join(', '))}.` : ''}`;
    w.ensure(28); const y0 = w.y; for (let k = 0; k < c.max; k++) w.cb(w.MG + 2 + k * 11, w.y - 9.5, 8.5);
    const ind = 6 + c.max * 11;
    w.flow(body, { size: 9, width: w.CW - ind, x: w.MG + ind }); w.y -= 5;
  }
  // reference
  w.h('Test results', 3);
  w.table(['', '≤11 (tier 1)', '12–16 (tier 2)', '17+ (tier 3)'], [['<b>Easy</b>', 'Success with a consequence', 'Success', 'Success with a reward'], ['<b>Medium</b>', 'Failure', 'Success with a consequence', 'Success'], ['<b>Hard</b>', 'Failure with a consequence', 'Failure', 'Success']], [1, 2, 2, 2], { size: 8 });
  w.para('A natural 19 or 20 is always a success with a reward. A good idea can be an automatic success. An assist that succeeds gives the other hero an edge.', { size: 8, color: w.grey });
  if (Object.keys(M.outcomes).length) {
    w.h('Outcomes', 2);
    [['success', 'Total success'], ['partial', 'Partial success'], ['failure', 'Total failure']].forEach(([k, l]) => { if (M.outcomes[k]) w.checkItem(`<b>${l}:</b> ${esc(M.outcomes[k])}`); });
  }
  if (M.notes) { w.h('Notes', 3); M.notes.split('\n').forEach(l => w.para(esc(l), { size: 8.5 })); }
  return w.bytes();
}
// ---------- negotiation sheet ----------
async function buildNegotiationPdf(N) {
  const w = await makeWriter(N.name);
  w.newPage();
  w.header(N.name, 'Negotiation' + (N.user ? '' : ' · ' + (PK[N.pack]?.title || '')) + (N.src?.pg ? ', p. ' + N.src.pg : ''), `Impression ${N.impression ?? '—'}`);
  if (N.intro) w.para(esc(N.intro), { size: 9.5 });
  // trackers
  w.ensure(110);
  const tracker = (label, start, note) => {
    w.T(label, w.MG, w.y - 12, 11, w.FB); w.T(`starts at ${start}` + (note ? ' · ' + note : ''), w.MG + 80, w.y - 12, 8, w.F, w.grey); w.y -= 18;
    for (let k = 0; k <= 5; k++) { const x = w.MG + 14 + k * 46; w.circ(x, w.y - 12, 11, { bw: k === start ? 2 : 0.8 }); w.T(String(k), x - 3, w.y - 15.5, 11, w.FB, k === start ? w.ink : w.grey); }
    w.y -= 34;
  };
  tracker('Interest', N.interest, 'at 5 they agree, at 0 they walk away');
  tracker('Patience', N.patience, 'at 0 they end the negotiation: make an offer');
  w.para(`<b>Language:</b> ${esc(N.language || '—')}  ·  <b>Impression:</b> ${N.impression ?? '—'}  ·  Starting attitude: ______________`, { size: 8.5, color: w.grey });
  w.h('Motivations', 2, 'Tick when used. A motivation only works once.');
  N.motivations.forEach(m => w.checkItem(`<b>${esc(m.name)}:</b> ${esc(m.text)}`, false, { size: 9 }));
  if (!N.motivations.length) w.para('<i>None listed.</i>');
  w.h('Pitfalls', 2, 'An argument that hits a pitfall fails: interest −1, patience −1.');
  N.pitfalls.forEach(m => w.bullet(`<b>${esc(m.name)}:</b> ${esc(m.text)}`, { size: 9 }));
  if (!N.pitfalls.length) w.para('<i>None listed.</i>');
  w.h('Arguments', 2);
  w.table(['Argument', 'Tier 1 (≤11)', 'Tier 2 (12–16)', 'Tier 3 (17+)'], [
    ['<b>Appeals to an unused motivation</b> (medium test)', 'Patience −1', 'Interest +1, patience −1', 'Interest +1'],
    ['<b>No motivation or pitfall</b> (harder test)', 'Interest −1, patience −1', 'Patience −1', 'Interest +1, patience −1'],
    ['<b>Uses a pitfall</b>', 'Interest −1, patience −1', '', ''],
    ['<b>Same motivation again</b>', 'Patience −1', '', '']
  ], [2.4, 1.5, 1.5, 1.5], { size: 8 });
  w.para('A natural 19–20 on an argument without a motivation keeps patience the same. Caught in a lie: interest −1 more. Repeating an argument: automatic tier 1. Reading the NPC (Intuition): tier 1 patience −1, tier 3 learn a motivation or pitfall.', { size: 8, color: w.grey });
  w.h('Log', 3);
  w.table(['Hero', 'Argument', 'Motivation / pitfall', 'Tier', 'Interest', 'Patience'], Array.from({ length: 8 }, () => ['', '', '', '', '', '']), [1.2, 2.6, 1.6, 0.6, 0.8, 0.8], { minH: 20, size: 8 });
  w.h('Outcomes', 2, 'When interest hits 5, patience hits 0, or the heroes stop: the NPC makes an offer based on interest.');
  for (let k = 5; k >= 0; k--) { const t = N.outcomes[k] || OFFERS[k][1]; w.checkItem(`<b>Interest ${k} · ${esc(OFFERS[k][0])}</b> ${esc(t)}`, false, { size: 9 }); }
  if (N.victories) w.para(`<b>Victories:</b> ${esc(N.victories)}`, { size: 9 });
  if (N.notes) { w.h('Notes', 3); N.notes.split(/\n+/).forEach(l => w.para(esc(l), { size: 8.5 })); }
  return w.bytes();
}

// Draw Steel items for Sessions (the core sess.js handles folders, pages and export):
// combat encounters, montage tests and negotiations, plus the party used for encounter maths.
// Registered as SYS.session in drawsteel.js.
function syncEncToSession() {
  const r = ENC.sessionRef; const S = sessById(r.sid); const d = S && S.docs.find(x => x.id === r.did);
  if (!d) { delete ENC.sessionRef; return; }
  const c = JSON.parse(JSON.stringify(ENC)); delete c.sessionRef; d.enc = c; d.title = c.name || d.title; saveSessions();
}
const dsSessParty = S => ({ heroes: S.heroes, level: S.level, victories: S.victories, retainers: 0 });
function dsSessRefHtml(S, d, top) {
  const ref = d.type === 'mtg' ? (refreshMontages(), mtById(d.ref)) : (refreshNegotiations(), negById(d.ref));
  if (!ref) return top + `<div class="empty">This ${sessKind(d.type).label.toLowerCase()} is no longer available (was its book removed?).</div>`;
  if (d.type === 'mtg') return top + `<div class="actrow"><a class="btn" href="#montage--${ref.id}">▶ Run this montage</a></div>
    ${ref.intro ? `<p>${esc(ref.intro)}</p>` : ''}${ref.scene.map(x => `<div class="ra">${esc(x)}</div>`).join('')}
    <h3>Challenges</h3>${ref.challenges.map(c => `<div class="mtch"><div class="mtch-h"><b>${esc(c.name)}</b>${c.round > 1 ? `<span class="tagk">round ${c.round}</span>` : ''}</div><p>${esc(c.desc)}</p><div class="mtsug">${c.chars.map(x => `<span class="ck">${esc(x)}</span>`).join('')}${c.skills.map(x => `<span>${esc(x)}</span>`).join('')}</div></div>`).join('')}`;
  return top + `<div class="actrow"><a class="btn" href="#negotiation--${ref.id}">▶ Run this negotiation</a></div>
    ${ref.intro ? `<p>${esc(ref.intro)}</p>` : ''}<p><b>Interest</b> ${ref.interest} · <b>Patience</b> ${ref.patience} · <b>Impression</b> ${ref.impression ?? '—'}${ref.language ? ' · <b>Language</b> ' + esc(ref.language) : ''}</p>
    <h3>Motivations</h3>${ref.motivations.map(m => `<p><b>${esc(m.name)}:</b> ${esc(m.text)}</p>`).join('') || '<p class="note">None</p>'}
    <h3>Pitfalls</h3>${ref.pitfalls.map(m => `<p><b>${esc(m.name)}:</b> ${esc(m.text)}</p>`).join('') || '<p class="note">None</p>'}`;
}
const DS_SESSION = {
  planText: 'combat encounters, montages and negotiations',
  party: [{ id: 'h', key: 'heroes', label: 'Heroes', min: 1, max: 12 }, { id: 'l', key: 'level', label: 'Level', min: 1, max: 10 }, { id: 'v', key: 'victories', label: 'Avg. Victories', min: 0 }],
  partyNote: 'The party here is used for encounters you add to this session.',
  newParty: () => ({ heroes: ENC?.heroes || 4, level: ENC?.level || 1, victories: ENC?.victories || 0 }),
  partyLine: S => `${S.heroes} heroes, level ${S.level}, ${S.victories} avg. Victories`,
  overviewExtra: S => { const encs = S.docs.filter(x => x.type === 'enc'); return encs.length ? `<p class="note">Combat this session: ${encs.map(x => esc(x.title)).join(', ')}.</p>` : ''; },
  kinds: {
    enc: {
      icon: '⚔', label: 'Combat encounter', noun: 'encounter', addLabel: '⚔ Encounter',
      summary: x => x.enc ? ' · ' + (() => { const m = encMath(x.enc); return m.diff + ', ' + m.ev + ' EV'; })() : '',
      html(S, d, top) {
        const E = d.enc; if (!E) return top + '<div class="empty">Missing encounter.</div>';
        const M = encMath(E);
        const SAVED = ENC; ENC = E; if (STONES_ON) assignStones(false); const sc = scalingHtml(); ENC = SAVED;
        return top + `<div class="sencsum"><span class="dlabel" style="color:${DCOL[M.diff]}">${M.diff}</span> <b>${M.ev} EV</b> vs encounter strength ${M.ES} · ${E.heroes} heroes, level ${M.L}, ${E.victories} Victories · worth ${M.worth} Victor${M.worth === 1 ? 'y' : 'ies'}</div>
      <div class="actrow"><button class="btn" id="d-open">Open in Encounter Builder</button><button class="btn ghost" id="d-repl">Replace with the builder’s current encounter</button></div>
      ${E.groups.map(g => `<div class="grp"><div class="grp-t"><b class="gname" style="border:0">${esc(g.name)}</b></div>${g.entries.map(e => { const m = MON[e.gid]; return m ? `<div class="ent"><div class="ent-n"><a class="lnk" data-go="monsters--${m.gid}">${e.n} × ${esc(m.name)}</a>${(() => { const S2 = ENC; ENC = E; const h = entStones(g, e, m); ENC = S2; return h; })()}<span>Lv ${m.level} ${esc(m.role)} · ${isMinion(m) ? esc(m.ev) : 'EV ' + esc(m.ev)} · Stamina ${esc((m.stats || {}).Stamina || '—')}</span></div></div>` : ''; }).join('')}</div>`).join('')}
      ${sc}`;
      },
      onRename: d => { if (d.enc) d.enc.name = d.title; },
      wire(S, d) {
        if ($('#d-open')) $('#d-open').onclick = () => { ENC = JSON.parse(JSON.stringify(d.enc)); ENC.sessionRef = { sid: S.id, did: d.id }; ENC.setup = false; store.set('enc', ENC); go('encounter'); };
        if ($('#d-repl')) $('#d-repl').onclick = async () => { if (!ENC.groups.some(g => g.entries.length)) { toast('The encounter builder is empty'); return; } if (await confirmSheet(`Replace “${d.title}” with “${ENC.name}” from the builder?`, 'Replace')) { const c = JSON.parse(JSON.stringify(ENC)); delete c.sessionRef; d.enc = c; d.title = c.name; saveSessions(); sessionPage(S.id, d.id); } };
      },
      add(S, add) {
        const party = dsSessParty(S);
        const items = [];
        if (ENC.groups.some(g => g.entries.length)) items.push({ id: 'cur', name: ENC.name, sub: (() => { const m = encMath(); return m.diff + ' · ' + m.ev + ' EV'; })(), group: 'In the Encounter Builder now' });
        ENCS.forEach(e => items.push({ id: 'saved:' + e.id, name: e.name, sub: e.groups.reduce((s, g) => s + g.entries.length, 0) + ' kinds of creature', group: 'Saved encounters' }));
        items.push({ id: 'new', name: 'Empty encounter', sub: 'Build it in the Encounter Builder', group: 'New' }, { id: 'book', name: 'From a book…', sub: 'Any delve or adventure encounter table', group: 'New' });
        return pickerSheet('Add a combat encounter', items, id => {
          let e;
          if (id === 'cur') e = JSON.parse(JSON.stringify(ENC));
          else if (id.startsWith('saved:')) e = JSON.parse(JSON.stringify(ENCS.find(x => 'saved:' + x.id === id)));
          else if (id === 'new') e = newEnc(party);
          else return bookEncounterSheet((p, c, i) => { const bd = bookEncounterData(p, c, i); if (!bd || !bd.groups.length) { toast('Couldn’t match any creatures in that table'); return; } const e2 = newEnc(party); e2.name = bd.name; e2.groups = bd.groups; e2.bookAdjust = bd.adj; e2.setup = false; add({ type: 'enc', title: e2.name, enc: e2 }); });
          delete e.sessionRef; e.id = 'e' + Date.now().toString(36); e.setup = false;
          if (id === 'new') e.name = 'Encounter ' + (S.docs.filter(x => x.type === 'enc').length + 1);
          add({ type: 'enc', title: e.name, enc: e });
        });
      },
      async pdf(S, d) { if (!d.enc.groups.some(g => g.entries.some(e => MON[e.gid]))) return null; const b = await buildEncounterPdf(d.enc); saveSessions(); return b; }
    },
    mtg: {
      icon: '🏃', label: 'Montage test', noun: 'montage', addLabel: '🏃 Montage',
      html: dsSessRefHtml,
      add(S, add) { refreshMontages(); return pickerSheet('Add a montage test', allMt().map(m => ({ id: m.id, name: m.name, sub: m.challenges.length + ' challenges', group: m.user ? 'Your montages' : (PK[m.pack]?.title || '') })), id => add({ type: 'mtg', ref: id, title: mtById(id).name })); },
      pdf(S, d) { refreshMontages(); const m = mtById(d.ref); return m ? buildMontagePdf(m) : null; }
    },
    neg: {
      icon: '🗣', label: 'Negotiation', noun: 'negotiation', addLabel: '🗣 Negotiation',
      html: dsSessRefHtml,
      add(S, add) { refreshNegotiations(); return pickerSheet('Add a negotiation', allNegs().map(n => ({ id: n.id, name: n.name, sub: `Interest ${n.interest} · Patience ${n.patience}`, group: n.user ? 'Your negotiations' : (PK[n.pack]?.title || '') })), id => add({ type: 'neg', ref: id, title: negById(id).name })); },
      pdf(S, d) { refreshNegotiations(); const n = negById(d.ref); return n ? buildNegotiationPdf(n) : null; }
    }
  }
};

// Draw Steel card kinds for the core card generator (cards.js): treasure cards, retainer and
// follower cards, Draw Steel quest rewards and how rewards are found in adventure text.
// Registered as SYS.cards in register.js. (Moved verbatim from cards.js where possible.)

const DS_CARD_COL = { Consumable: '#3d7a4a', Trinket: '#2d5f8a', Leveled: '#6b3fa0', Artifact: '#a8322d', quest: '#a87a1e', follower: '#2a7f7a', retainer: '#7a4a2a' };

const REWARD_LABELS = ['Victories', 'Title', 'Treasure', 'Project Source', 'Renown', 'Wealth', 'Retainer', 'Other'];

const CRAFT_RE = /^(Item Prerequisite|Project Source|Project Roll Characteristic|Project Goal)s?:/i;

const retainerList = () => MONS.filter(m => /Retainer/i.test(m.role || ''));

function itemCard(t, craft) {
  const sub = [t.type === 'Leveled' ? 'Leveled ' + (t.sub || 'treasure').toLowerCase() : t.type, t.echelon ? ORD(t.echelon) + ' echelon' : ''].filter(Boolean).join(' · ');
  const paras = [];
  for (const b of t.body || []) {
    const html = (b.html || (b.text ? esc(b.text) : '')).trim(); if (!html) continue;
    const txt = strip(html);
    if (/^Keywords?:/i.test(txt)) continue;
    if (!craft && CRAFT_RE.test(txt)) continue;
    if (b.t === 'tier') { paras.push(`<b>${['', '≤11', '12–16', '17+'][b.n]}:</b> ${html}`); continue; }
    html.split(/(?=<b>\s*\d+(?:st|nd|rd|th) Level)/).forEach(h => paras.push((b.t === 'li' ? '• ' : '') + h.trim()));
  }
  return { name: t.name, sub, keywords: t.keywords || '', paras, color: DS_CARD_COL[t.type] || '#555555', back: t.type || 'Treasure', foot: 'Draw Steel' + (t.src?.pg ? ' · Heroes p. ' + t.src.pg : '') };
}

const tierTxt = rows => { const t = rows.filter(r => r.k === 'tier'); return t.length ? t.map(r => `<b>${['', '≤11', '12–16', '17+'][r.n]}</b> ${r.html}`).join('; ') : ''; };

function followerCard(f) {
  if (f.type === 'retainer') {
    const m = MON[f.gid]; if (!m) return { name: f.name || 'Retainer', sub: 'Retainer (stat block not found)', paras: [], color: DS_CARD_COL.retainer, back: 'Retainer' };
    const st = m.stats || {}, ch = m.chars || {};
    const stats = [['Stamina', st.Stamina], ['Speed', (st.Speed || '') + (m.movement && m.movement !== '—' ? '*' : '')], ['Size', st.Size], ['Stability', st.Stability], ['Free strike', st['Free Strike']], ['Might', ch.Might], ['Agility', ch.Agility], ['Reason', ch.Reason], ['Intuition', ch.Intuition], ['Presence', ch.Presence]].filter(x => x[1] != null && x[1] !== '');
    const paras = [];
    if (f.name) paras.push(`<i>${esc(m.name)}${m.desc ? ' · ' + esc(m.desc) : ''}</i>`);
    const misc = [m.movement && m.movement !== '—' ? '<b>*Movement:</b> ' + esc(m.movement) : '', m.immunity && m.immunity !== '—' ? '<b>Immunity:</b> ' + esc(m.immunity) : '', m.weakness && m.weakness !== '—' ? '<b>Weakness:</b> ' + esc(m.weakness) : ''].filter(Boolean);
    if (misc.length) paras.push(misc.join(' · '));
    for (const a of m.items || []) {
      const head = `<b>${esc(a.name)}${a.action ? '' : '.'}</b>${a.action ? ` <i>(${esc([a.action, a.distance, a.target].filter(Boolean).join(', '))})</i>` : ''}`;
      const fields = (a.rows || []).filter(r => r.k === 'field').map(r => r.html).join(' ');
      const tiers = tierTxt(a.rows || []);
      paras.push(head + (tiers ? ' ' + tiers + '.' : '') + (fields ? ' ' + fields : ''));
    }
    if (f.notes) paras.push(esc(f.notes));
    paras.push('<b>Mentor:</b> ____________________');
    return { name: f.name || m.name, sub: `Level ${m.level} ${m.role}`, keywords: '', stats, paras, color: DS_CARD_COL.retainer, back: 'Retainer', foot: (PK[m.pack]?.title || '') + (m.pg ? ' p. ' + m.pg : '') };
  }
  const art = f.type === 'artisan';
  const chars = { Might: 0, Agility: 0, Reason: 1, Intuition: art ? 0 : 1, Presence: 0 }; if (art) chars[f.char === 'Agility' ? 'Agility' : 'Might'] = 1;
  const stats = Object.entries(chars).map(([k, v]) => [k, (v > 0 ? '+' : '') + v]);
  const langs = ['Caelian', ...(f.languages || []).filter(Boolean)];
  const paras = [`<b>Skills:</b> ${esc((f.skills || []).join(', ') || '—')}`, `<b>Languages:</b> ${esc(langs.join(', '))}`,
    `${art ? 'A crafting expert' : 'A research expert'}. Contributes one project roll per day to a downtime project you choose, whether you spend those days in respite, adventuring, or other activities. Must remain at your stronghold or the project site, with access to the necessary materials.`];
  if (f.notes) paras.push(esc(f.notes));
  return { name: f.name || (art ? 'Artisan' : 'Sage'), sub: (art ? 'Artisan' : 'Sage') + ' follower' + (f.ancestry ? ' · ' + f.ancestry : ''), keywords: '', stats, paras, color: DS_CARD_COL.follower, back: 'Follower', foot: 'Draw Steel · Heroes p. 350' };
}

const DS_CARD_ICONS = { Consumable: 'gi:potion-ball', Trinket: 'gi:gem-pendant', Artifact: 'gi:crystal-ball', Weapon: 'gi:broadsword', Armor: 'gi:breastplate', Implement: 'gi:wizard-staff', Other: 'gi:gem-chain', Leveled: 'gi:crossed-swords', quest: 'gi:scroll-unfurled', retainer: 'gi:swordman', artisan: 'gi:anvil-impact', sage: 'gi:spell-book' };

// ---- follower editor ----
function followerEditor(f0) {
  const isNew = !f0.id; const f = JSON.parse(JSON.stringify({ name: '', ancestry: '', skills: [], languages: ['', ''], char: 'Might', notes: '', ...f0 }));
  const el = document.createElement('div'); el.className = 'dlg';
  const rets = retainerList(); const byPack = {}; rets.forEach(m => (byPack[m.pack] = byPack[m.pack] || []).push(m));
  if (f.type === 'retainer' && !f.gid && rets[0]) f.gid = rets[0].gid;
  const draw = () => {
    const grp = f.type === 'artisan' ? 'Crafting' : 'Lore';
    const skills = D.skills.filter(s => s.group === grp).map(s => s.name);
    el.innerHTML = `<div class="dlg-b negedit"><h2>${isNew ? 'New' : 'Edit'} ${f.type === 'retainer' ? 'retainer' : f.type} card</h2>
      ${f.type === 'retainer' ? `<label class="negnotes">Retainer<select id="fe-g">${Object.entries(byPack).map(([p, ms]) => `<optgroup label="${esc(PK[p]?.title || p)}">${ms.map(m => `<option value="${m.gid}" ${f.gid === m.gid ? 'selected' : ''}>${esc(m.name)} (level ${m.level} ${esc(m.role.replace(/ Retainer$/, ''))})</option>`).join('')}</optgroup>`).join('')}</select></label>
        ${!rets.length ? '<div class="warn">No retainer stat blocks found. Retainers come from the Monsters book.</div>' : ''}
        <label class="negnotes">Name (optional)<input id="fe-n" value="${esc(f.name)}" placeholder="Leave empty to use the stat block’s name"></label>`
      : `<div class="mtrow"><label>Name<input id="fe-n" value="${esc(f.name)}"></label><label>Ancestry<input id="fe-a" value="${esc(f.ancestry)}"></label>${f.type === 'artisan' ? `<label>Characteristic at 1<select id="fe-c"><option ${f.char === 'Might' ? 'selected' : ''}>Might</option><option ${f.char === 'Agility' ? 'selected' : ''}>Agility</option></select></label>` : ''}</div>
        <div class="negnotes">Four ${grp.toLowerCase()} skills (${f.skills.length}/4)</div>
        <div class="fskills">${skills.map(s => `<label><input type="checkbox" data-sk="${esc(s)}" ${f.skills.includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join('')}</div>
        <div class="mtrow"><label>Languages: Caelian +<input id="fe-l1" value="${esc(f.languages[0] || '')}"></label><label>and<input id="fe-l2" value="${esc(f.languages[1] || '')}"></label></div>`}
      <label class="negnotes">Notes (optional)<input id="fe-x" value="${esc(f.notes)}"></label>
      <div class="dlgfoot">${!isNew ? '<button class="btn danger" id="fe-del">Delete</button>' : ''}<span style="flex:1"></span><button class="btn ghost" id="fe-q">Cancel</button><button class="btn" id="fe-ok">${isNew ? 'Add card' : 'Save'}</button></div></div>`;
    const keep = () => { f.name = $('#fe-n', el).value.trim(); f.notes = $('#fe-x', el).value.trim(); if ($('#fe-g', el)) f.gid = $('#fe-g', el).value; if ($('#fe-a', el)) f.ancestry = $('#fe-a', el).value.trim(); if ($('#fe-c', el)) f.char = $('#fe-c', el).value; if ($('#fe-l1', el)) f.languages = [$('#fe-l1', el).value.trim(), $('#fe-l2', el).value.trim()]; };
    $$('[data-sk]', el).forEach(c => c.onchange = () => { keep(); const s = c.dataset.sk; if (c.checked) { if (f.skills.length >= 4) { toast('A follower knows four skills'); c.checked = false; return; } f.skills.push(s); } else f.skills = f.skills.filter(x => x !== s); draw(); });
    $('#fe-q', el).onclick = () => el.remove();
    if ($('#fe-del', el)) $('#fe-del', el).onclick = async () => { if (await confirmSheet('Delete this card?', 'Delete')) { CARDS.followers = CARDS.followers.filter(x => x.id !== f.id); CARDS.deck = CARDS.deck.filter(x => !(x.k === 'follower' && x.id === f.id)); saveCards(); el.remove(); cardsPage(); } };
    $('#fe-ok', el).onclick = () => { keep(); if (f.type === 'retainer' && !MON[f.gid]) { toast('Pick a retainer'); return; } if (!f.id) { f.id = uid('f'); CARDS.followers.push(f); addToDeck('follower', f.id); } else { const i = CARDS.followers.findIndex(x => x.id === f.id); CARDS.followers[i] = f; } CARDS.tab = 'follower'; saveCards(); el.remove(); cardsPage(); };
  };
  draw(); document.body.appendChild(el);
}

const NUMWORD = { one: 1, two: 2, three: 3, four: 4, five: 5, a: 1, an: 1 };
function sectionRewards(blocks) {
  const R = { vic: 0, treasure: [], title: [], renown: 0, wealth: 0, source: [], retainer: [], other: [] };
  const add = (arr, v) => { v = v.trim().replace(/\s+/g, ' '); const k = v.toLowerCase().replace(/s$/, ''); if (v && !arr.some(x => x.toLowerCase().replace(/s$/, '') === k)) arr.push(v); };
  const tnames = D.treasures.map(t => t.name).sort((a, b) => b.length - a.length);
  for (const b of blocks) {
    if (b.t === 'h') { const m = b.text.match(/^Title:\s*(.+)$/i); if (m) add(R.title, m[1]); continue; }
    const txt = strip(b.html || (b.rows ? b.rows.flat().join(' ') : '') || '');
    let m; const vre = /\b(?:earns?|gains?)\s+(\d+|one|two|three|four|five)\s+(?:additional\s+)?Victor(?:y|ies)\b/gi;
    while ((m = vre.exec(txt))) R.vic = Math.max(R.vic, +m[1] || NUMWORD[m[1].toLowerCase()] || 0);
    const tre = /\(see\s+([^)]*?)\s+in\s+Treasures?\s+in\s+Handouts\)|((?:[A-Z][\w’'\-]*\s?){1,5})\s*\(see\s+Treasures?\s+in\s+Handouts\)/g;
    while ((m = tre.exec(txt))) add(R.treasure, (m[1] || m[2]).replace(/^(?:a|an|the)\s+/i, ''));
    for (const n of tnames) if (new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(txt) && !R.treasure.some(x => x.includes(n))) add(R.treasure, n);
    const rre = /\bgains?\s+(\d+|one|two)\s+Renown/gi; while ((m = rre.exec(txt))) R.renown = Math.max(R.renown, +m[1] || NUMWORD[m[1].toLowerCase()]);
    const wre = /Wealth\s+(?:score\s+)?(?:increases|goes up)\s+by\s+(\d+|one|two)/gi; while ((m = wre.exec(txt))) R.wealth = Math.max(R.wealth, +m[1] || NUMWORD[m[1].toLowerCase()]);
    const pre = /project source (?:for|of) (?:an? |the )?([A-Z][\w’'\- ]+)/gi; while ((m = pre.exec(txt))) add(R.source, m[1]);
    const tie = /([A-Z][\w’'\- ]+?)\s+title\s+\(see Titles/g; while ((m = tie.exec(txt))) add(R.title, m[1]);
    if (/becom\w* a retainer/i.test(txt)) { const who = txt.match(/([A-Z][\w’']+)\s+(?:also\s+)?pledges/); if (who) add(R.retainer, who[1]); }
  }
  return R;
}
function questsFromChapter(pack, ch, L) {
  const B = ch.blocks; const out = [];
  const leadDesc = name => { const li = B.find(b => b.t === 'li' && new RegExp('^\\s*<b>\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*</b>', 'i').test(b.html || '')); return li ? strip(li.html).replace(/^[^:]+:\s*/, '') : ''; };
  for (let i = 0; i < B.length; i++) {
    const h = B[i]; if (h.t !== 'h' || h.lvl !== L) continue;
    let end = B.length; for (let k = i + 1; k < B.length; k++) if (B[k].t === 'h' && B[k].lvl <= L) { end = k; break; }
    const sec = B.slice(i + 1, end);
    // scenes one level down are added up; inside a scene, alternative outcomes take the best
    const subL = Math.min(...sec.filter(b => b.t === 'h').map(b => b.lvl).concat([99]));
    const isScene = b => b.t === 'h' && b.lvl === subL && subL <= L + 2 && !/^(Total|Partial|Victor|Reward|Ending|Encounter Adjust|Tactics|Terrain|Development)/i.test(b.text);
    let vic = 0; const R = sectionRewards(sec);
    if (subL < 99 && sec.some(isScene)) { let cur = []; const parts = []; for (const b of sec) { if (isScene(b)) { parts.push(cur); cur = []; } cur.push(b); } parts.push(cur); vic = parts.reduce((s, p) => s + sectionRewards(p).vic, 0); } else vic = R.vic;
    let desc = leadDesc(h.text);
    if (!desc) { const p = sec.find(b => (b.t === 'p') && !/^[“"]/.test(strip(b.html || '')) && strip(b.html || '').length > 40); desc = p ? strip(p.html) : ''; }
    if (desc.length > 260) { const cut = desc.slice(0, 260); desc = cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, 180)) || cut; if (!/[.!?]$/.test(desc)) desc += '…'; }
    const rewards = [];
    if (vic) rewards.push({ label: 'Victories', value: (sec.some(isScene) ? 'up to ' : '') + vic });
    R.title.forEach(v => rewards.push({ label: 'Title', value: v }));
    R.treasure.forEach(v => rewards.push({ label: 'Treasure', value: v }));
    R.source.forEach(v => rewards.push({ label: 'Project Source', value: v }));
    if (R.renown) rewards.push({ label: 'Renown', value: '+' + R.renown });
    if (R.wealth) rewards.push({ label: 'Wealth', value: '+' + R.wealth });
    R.retainer.forEach(v => rewards.push({ label: 'Retainer', value: v }));
    out.push({ id: uid('q'), title: h.text, text: desc, rewards, source: `${pack.title} · ${ch.title}`, pg: h.pg });
  }
  return out;
}

// ---- the Draw Steel part of the card generator (SYS.cards) ----
const dsTreasuresByType = () => { const byType = {}; D.treasures.forEach(t => (byType[t.type] = byType[t.type] || []).push(t)); return byType; };
const DS_CARDS = {
  intro: 'treasures, quests, followers and retainers',
  tabs: [['item', 'Items'], ['quest', 'Quests'], ['follower', 'Followers & retainers']],
  icons: DS_CARD_ICONS,
  rewards: {
    labels: REWARD_LABELS,
    hints: { Victories: '2', Title: 'Fey Friend', Treasure: 'Healing Potion', 'Project Source': 'Quantum Satchel', Renown: '+1', Wealth: '+1', Retainer: 'Lamprey', Other: '' },
    defaults: [{ label: 'Victories', value: '' }, { label: 'Treasure', value: '' }]
  },
  questsFromChapter,
  questRewardsText: 'Victories, treasures, titles, Renown and retainers',
  optionsHtml: () => `<label class="row-c"><input type="checkbox" id="c-craft" ${CARDS.craft ? 'checked' : ''}> Crafting info</label>`,
  wireOptions: re => { $('#c-craft').onchange = e => { CARDS.craft = e.target.checked; re(); }; },
  kinds: {
    item: {
      entry(d) { const t = D.treasures.find(x => x.id === d.id); const e = t && { label: t.name, kind: t.type, c: itemCard(t, CARDS.craft) }; if (e) e.c.hint = t.type === 'Leveled' ? (t.sub || 'Leveled') : t.type; return e; },
      adder() { const T = D.treasures, byType = dsTreasuresByType(); return `<div class="cardadd"><div class="csearch">${ico('search', 16)}<input id="c-q" placeholder="Search ${T.length} treasures…" autocomplete="off"><div id="c-qres" class="cqres"></div></div>
      <select id="c-addall"><option value="">Add all of a type…</option>${Object.keys(byType).map(ty => `<option>${esc(ty)}</option>`).join('')}</select></div>`; },
      wire(re) {
        const T = D.treasures, byType = dsTreasuresByType();
      const cq = $('#c-q');
      if (cq) {
        const show = () => { const q = cq.value.trim().toLowerCase(); const box = $('#c-qres'); if (!q) { box.innerHTML = ''; box.classList.remove('on'); return; }
          const hits = T.filter(t => (t.name + ' ' + t.type + ' ' + (t.keywords || '') + ' ' + (t.sub || '')).toLowerCase().includes(q)).sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name)).slice(0, 12);
          box.innerHTML = hits.map(t => { const c = { name: t.name, hint: t.type === 'Leveled' ? (t.sub || 'Leveled') : t.type }; return `<button data-addi="${t.id}"><span class="cd-ic" style="--cc:${DS_CARD_COL[t.type] || '#555'}">${iconSvg(autoIcon(c))}</span><b>${esc(t.name)}</b><small>${esc(t.type)}${t.echelon ? ' · ' + ORD(t.echelon) + ' echelon' : ''}</small>${CARDS.deck.some(x => x.k === 'item' && x.id === t.id) ? '<em>in deck</em>' : ''}</button>`; }).join('') || '<div class="empty">No treasure matches.</div>';
          box.classList.add('on');
          $$('[data-addi]', box).forEach(b => b.onmousedown = e => { e.preventDefault(); addToDeck('item', b.dataset.addi); saveCards(); cardsPage(); setTimeout(() => { const n = $('#c-q'); if (n) { n.value = cq.value; n.focus(); n.dispatchEvent(new Event('input')); } }, 0); });
        };
        cq.oninput = show; cq.onfocus = show; cq.onblur = () => setTimeout(() => $('#c-qres')?.classList.remove('on'), 150);
        cq.onkeydown = e => { if (e.key === 'Enter') { const f = $('#c-qres [data-addi]'); if (f) f.dispatchEvent(new MouseEvent('mousedown')); } if (e.key === 'Escape') { cq.value = ''; show(); } };
        $('#c-addall').onchange = e => { const ty = e.target.value; if (!ty) return; byType[ty].forEach(t => { if (!CARDS.deck.some(x => x.k === 'item' && x.id === t.id)) CARDS.deck.push({ k: 'item', id: t.id, n: 1 }); }); re(); };
      }
      }
    },
    follower: {
      entry(d) { const f = CARDS.followers.find(x => x.id === d.id); const e = f && { label: f.name || MON[f.gid]?.name || f.type, kind: f.type === 'retainer' ? 'Retainer' : f.type === 'artisan' ? 'Artisan' : 'Sage', c: followerCard(f), obj: f }; if (e) e.c.hint = f.type; return e; },
      adder: () => `<div class="cardadd"><button class="btn" id="f-ret">+ Retainer</button><button class="btn ghost" id="f-art">+ Artisan</button><button class="btn ghost" id="f-sage">+ Sage</button></div>`,
      wire() { $('#f-ret').onclick = () => followerEditor({ type: 'retainer' }); $('#f-art').onclick = () => followerEditor({ type: 'artisan' }); $('#f-sage').onclick = () => followerEditor({ type: 'sage' }); }
    }
  }
};

// Registers Draw Steel with the core. Loaded LAST of the Draw Steel files (see SYSTEM_FILES in
// mksite.py): the object below is built at load time, so everything it names must already exist.
// Hook contract: see registerSystem in app.js.
registerSystem({
  id: 'drawsteel', name: 'Draw Steel', short: 'DS',
  data: { file: 'data/heroes.json', loading: 'Loading the rules…' },
  init: initHeroes,
  corePack: () => ({ id: 'heroes', title: 'Draw Steel: Heroes', kind: 'core', builtin: true, chapters: D.book, monsters: [], abilities: [], heroes: true }),
  builtin: BUILTIN,
  lists: DS_LISTS,
  menu: dsMenu, home: dsHome, browse: dsBrowse,
  routes: {
    encounter: () => encounterPage(),
    respite: () => respitePage(),
    negotiation: b => b ? negotiationPage(b) : negotiationHub(),
    montage: b => b ? montagePage(b) : montageHub(),
    classes: b => b ? classPage(b) : classIndex()
  },
  packRoutes: ['monsters', 'negotiation', 'montage', 'encounter'],
  renderMonster, renderAbility,
  renderBlock: dsRenderBlock, afterHeading: dsAfterHeading, afterTable: dsAfterTable, chapterExtras: dsChapterExtras,
  onAddPack: dsOnAddPack,
  entityMeta: dsEntityMeta, entitySource: dsEntitySource, preview: dsPreview,
  pinGroups: [
    { type: 'monsters', title: ms => `Monsters · ${ms.reduce((s, m) => s + (parseInt(m.ev) || 0), 0)} EV total`, render: m => renderMonster(m) },
    { type: 'abilities', title: () => 'Abilities', render: a => renderAbility(a) }
  ],
  linkTypes: ['conditions'],
  noLink: '.ab-n,.ma-n,.mon-n,.pot,.chr',   // names inside ability cards and stat blocks are never auto-linked
  searchExtra: dsSearchExtra, searchIndex: dsSearchIndex,
  searchPriority: { conditions: 0, classes: 0, ancestries: 1, kits: 2, monsters: 2, abilities: 3, glossary: 3 },
  packSummary: p => p.core ? ' · ' + D.abilities.length + ' abilities' : '',
  importer: { module: './lib/dsparse.mjs', hint: 'Works best with MCDM-format Draw Steel PDFs that contain selectable text', stats: dsImportStats },
  onClick: dsOnClick,
  pdfNotice: 'Draw Steel © MCDM Productions, LLC, used under the DRAW STEEL Creator License',
  session: DS_SESSION,
  cards: DS_CARDS,
  roller: { title: 'Power roll (2d10)', html: DS_ROLLER_HTML, mount: dsMountRoller },
  notice: 'Vanadium is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC. DRAW STEEL © 2024 MCDM Productions, LLC.',
  syncWhat: 'sessions, encounters, montages, negotiations, cards, pins, characters, Respite heroes, settings',
});

// ================= 5e (SRD 5.2) system module =================
// Fifth-edition rules from the System Reference Document 5.2 (CC BY 4.0), data built by
// mkdata.py from the pinned 5e-database files in srd/. Everything here is reached by the core
// through SYS (see registerSystem in app.js); registration is in register.js.
// No Wizards of the Coast trademarks in the UI: the system is called "5e (SRD 5.2)".

const S5_ATTRIB = 'This work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. Vanadium is not affiliated with or endorsed by Wizards of the Coast.';
const S5_TYPES = {
  spells: { label: 'Spells', one: 'Spell' }, monsters: { label: 'Monsters', one: 'Monster' }, items: { label: 'Magic Items', one: 'Magic Item' },
  classes: { label: 'Classes', one: 'Class' }, species: { label: 'Species', one: 'Species' }, backgrounds: { label: 'Backgrounds', one: 'Background' },
  feats: { label: 'Feats', one: 'Feat' }, conditions: { label: 'Conditions', one: 'Condition' }, equipment: { label: 'Equipment', one: 'Item' }
};
function s5Init() {
  TYPES = S5_TYPES;
  BYID = {}; Object.keys(TYPES).forEach(t => { BYID[t] = {}; (D[t] || []).forEach(e => BYID[t][e.id] = e); });
  BYID.monsters = MON;
}

// ---- spells ----
const s5SpellLine = s => (s.level === 0 ? `${s.school} Cantrip` : `Level ${s.level} ${s.school}`) + (s.classes.length ? ` (${s.classes.join(', ')})` : '');
const s5Lvl = s => s.level === 0 ? 'Cantrip' : String(s.level);
function s5SpellCard(s, opts = {}) {
  const pinned = isPinned('spells', s.id);
  return `<div class="s5spell" data-spell="${esc(s.id)}">${opts.nohead ? '' : `<div class="s5-h"><div><div class="s5-n"><a data-go="spells--${esc(s.id)}">${esc(s.name)}</a></div><div class="s5-t">${esc(s5SpellLine(s))}</div></div>${opts.nopin ? '' : `<button class="ab-pin ${pinned ? 'on' : ''}" data-pin="spells--${esc(s.id)}" title="Pin">★</button>`}</div>`}
    <div class="s5-meta"><div><b>Casting Time</b>${esc(s.time)}${s.ritual ? ' or Ritual' : ''}</div><div><b>Range</b>${esc(s.range)}</div><div><b>Components</b>${esc(s.components)}</div><div><b>Duration</b>${esc(s.duration)}</div></div>
    <div class="rd s5-body">${s5Dicify(renderBlocks(s.body), s.name)}</div></div>`;
}

// ---- monsters (2024-style stat block) ----
const S5_AB = [['str', 'Str'], ['dex', 'Dex'], ['con', 'Con'], ['int', 'Int'], ['wis', 'Wis'], ['cha', 'Cha']];
const s5Mod = v => { const x = Math.floor((v - 10) / 2); return x >= 0 ? '+' + x : '−' + (-x); };
const s5Num = s => parseFloat(String(s).replace(/,/g, '')) || 0;
function s5RenderMonster(m, opts = {}) {
  if (!m) return '';
  const pinned = isPinned('monsters', m.gid);
  const line = (l, v) => v ? `<div><b>${l}</b> ${esc(v)}</div>` : '';
  const sec = (title, list) => list && list.length ? `<div class="s5-sec">${title ? `<h4>${title}</h4>` : ''}${list.map(a => `<p><b><i>${esc(a.name)}.</i></b> ${s5Dicify(a.html, m.name + ': ' + a.name.replace(/\s*\(.*\)$/, ''))}${a.spells ? a.spells.map(x => `<span class="s5-spl">${x}</span>`).join('') : ''}</p>`).join('')}</div>` : '';
  let h = `<div class="s5mon" data-mon="${m.gid}"><div class="s5-h"><div><div class="s5-n"><a data-go="monsters--${m.gid}">${esc(m.name)}</a></div><div class="s5-t">${esc(m.size)} ${esc(m.type)}, ${esc(m.alignment)}</div></div><button class="ab-pin ${pinned ? 'on' : ''}" data-pin="monsters--${m.gid}" title="Pin">★</button></div>
    <div class="s5-core"><div><b>AC</b> ${esc(m.ac)}${m.acNote ? ` (${esc(m.acNote)})` : ''}</div><div><b>Initiative</b> <button class="s5-roll" data-dice="1d20${s5Signed(m.init)}" data-lab="${esc(m.name)}: initiative">${esc(m.init)} (${10 + s5Int(m.init)})</button></div><div><b>HP</b> ${esc(m.hp)}${m.hpRoll ? ` (${esc(m.hpRoll)})` : ''}</div><div><b>Speed</b> ${esc(m.speed)}</div></div>
    <div class="s5-abs">${S5_AB.map(([k, l]) => `<div><span>${l}</span><b>${m.ab[k]}</b><button class="s5-roll" data-dice="1d20${s5Signed(s5Mod(m.ab[k]))}" data-lab="${esc(m.name)}: ${l} check" title="Roll a ${l} check">${s5Mod(m.ab[k])}</button><button class="s5-roll s5-save" data-dice="1d20${s5Signed(m.saves[k])}" data-lab="${esc(m.name)}: ${l} save" title="Roll a ${l} saving throw">save ${esc(m.saves[k])}</button></div>`).join('')}</div>
    <div class="s5-lines">${line('Skills', m.skills)}${line('Vulnerabilities', m.vuln)}${line('Resistances', m.resist)}${line('Immunities', m.immune)}${line('Gear', m.gear)}${line('Senses', m.senses)}${line('Languages', m.languages)}<div><b>CR</b> ${esc(m.cr)} (XP ${esc(m.xp)}; PB ${esc(m.pb)})</div></div>
    ${sec('Traits', m.traits)}${sec('Actions', m.actions)}${sec('Bonus Actions', m.bonus)}${sec('Reactions', m.reactions)}${sec('Legendary Actions', m.legendary)}`;
  if (!opts.nosrc) h += `<div class="mon-src"><span>${esc(m.group || '')}</span><a data-gobook="${esc(m.pack)}--${esc(m.ch || '')}">${esc(PK[m.pack]?.title || '')}</a></div>`;
  return h + '</div>';
}
const S5_SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const S5_RARITY = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact', 'Rarity Varies'];
const s5Rarity = it => (S5_RARITY.find(r => it.rarity.startsWith(r)) || it.rarity);
const s5Time = s => /^Action/.test(s.time) ? 'Action' : /^Bonus Action/.test(s.time) ? 'Bonus Action' : /^Reaction/.test(s.time) ? 'Reaction' : 'Longer';

// ---- lists ----
const s5Head = (type, e, meta, tools2 = '') => `<div class="ent-h"><div style="flex:1"><h2>${esc(e.name)}</h2><div class="meta">${esc(meta)}</div></div>${tools2 || tools(type, e)}</div>`;
const S5_LISTS = {
  spells: {
    cols: [['Name', s => s.name, 'nm'], ['Level', s5Lvl, 'mu', s => s.level], ['School', s => s.school, 'mu'], ['Casting Time', s => s.time.replace(/,.*$/, ''), 'mu'], ['Range', s => s.range, 'mu'], ['Source', e => s5Src(e), 'mu']],
    filters: [['Source', e => s5Src(e)], ['Level', s5Lvl, (x, y) => (x === 'Cantrip' ? 0 : +x) - (y === 'Cantrip' ? 0 : +y)], ['School', s => s.school], ['Class', s => s.classes, null, true],
      ['Casting time', s5Time], ['Ritual', s => s.ritual ? 'Ritual' : 'Not a ritual'], ['Concentration', s => s.conc ? 'Concentration' : 'No concentration']],
    text: s => s.name + ' ' + s.school + ' ' + s.classes.join(' ') + ' ' + s.body.map(b => strip(b.html || b.text || '')).join(' '),
    view: s => s5Head('spells', s, s5SpellLine(s)) + s5SpellCard(s, { nohead: true })   // the page header already names it
  },
  monsters: {
    idOf: m => m.gid,
    cols: [['Name', m => m.name, 'nm'], ['CR', m => m.cr, 'mu', m => m.crNum], ['Type', m => m.type, 'mu'], ['Size', m => m.size, 'mu', m => S5_SIZES.indexOf(m.size)]],
    filters: [['Source', m => PK[m.pack]?.title], ['CR', m => 'CR ' + m.cr, (x, y) => s5CrNum(x.slice(3)) - s5CrNum(y.slice(3))], ['Type', m => m.type], ['Size', m => m.size, (x, y) => S5_SIZES.indexOf(x) - S5_SIZES.indexOf(y)],
      ['Has legendary actions', m => m.legendary.length ? 'Yes' : 'No']],
    text: m => m.name + ' ' + m.type + ' ' + [...m.traits, ...m.actions, ...m.bonus, ...m.reactions, ...m.legendary].map(a => a.name + ' ' + strip(a.html)).join(' '),
    view: m => `<div class="ent-h"><div style="flex:1"><h2>${esc(m.name)}</h2><div class="meta">CR ${esc(m.cr)} ${esc(m.type)} · ${esc(m.size)}</div></div><div class="ent-tools"><button class="ibtn ${isPinned('monsters', m.gid) ? 'on' : ''}" data-pin="monsters--${m.gid}">★</button><button class="ibtn" data-addenc5="${m.gid}" title="Add to encounter">+ Encounter</button><button class="ibtn" data-gobook="${esc(m.pack)}--${esc(m.ch || '')}">Book</button></div></div>${s5RenderMonster(m)}`
  },
  items: {
    cols: [['Name', i => i.name, 'nm'], ['Type', i => i.type, 'mu'], ['Rarity', s5Rarity, 'mu', i => S5_RARITY.indexOf(s5Rarity(i))], ['Attunement', i => i.attune ? 'Yes' : '', 'mu']],
    filters: [['Type', i => i.type], ['Rarity', s5Rarity, (x, y) => S5_RARITY.indexOf(x) - S5_RARITY.indexOf(y)], ['Attunement', i => i.attune ? 'Requires attunement' : 'No attunement']]
  },
  classes: { cols: [['Name', c => c.name, 'nm'], ['Hit Die', c => c.hitDie ? 'd' + c.hitDie : '', 'mu', c => +c.hitDie || 0], ['Primary Ability', c => c.primary, 'mu'], ['Source', e => s5Src(e), 'mu']], filters: [['Source', e => s5Src(e)]] },
  species: { cols: [['Name', s => s.name, 'nm'], ['Size', s => s.size, 'mu'], ['Speed', s => s.speed + ' ft.', 'mu', s => s.speed]], filters: [] },
  backgrounds: { cols: [['Name', b => b.name, 'nm'], ['Feat', b => b.feat, 'mu'], ['Skills', b => b.skills.join(', '), 'mu']], filters: [] },
  feats: { cols: [['Name', f => f.name, 'nm'], ['Type', f => f.type, 'mu']], filters: [['Type', f => f.type]] },
  conditions: { cols: [['Name', c => c.name, 'nm']], filters: [] },
  equipment: { cols: [['Name', e => e.name, 'nm'], ['Category', e => e.category, 'mu'], ['Cost', e => e.cost, 'mu', e => s5Cost(e.cost)], ['Weight', e => e.weight ? e.weight + ' lb.' : '', 'mu', e => +e.weight || 0]], filters: [['Category', e => e.category]] }
};
const s5CrNum = s => s.includes('/') ? s.split('/').reduce((a, b) => +a / +b) : +s;
const s5Cost = c => { const m = String(c).match(/([\d.]+)\s*(cp|sp|ep|gp|pp)/); return m ? +m[1] * { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 }[m[2]] : -1; };

function s5EntityMeta(type, e) {
  if (type === 'items') {   // 2024 style: "Wondrous Item, Uncommon (requires attunement)"
    const base = e.sub ? strip(e.sub) : e.type.replace(/s$/, '');
    return base + (new RegExp(s5Rarity(e), 'i').test(base) ? '' : ', ' + e.rarity) + (e.attune && !/attunement/i.test(base) ? ' (requires attunement)' : '');
  }
  if (type === 'classes') return [e.hitDie ? `d${e.hitDie} Hit Point Die` : '', e.primary ? 'Primary ability: ' + e.primary : '', e.pack ? s5Src(e) : ''].filter(Boolean).join(' · ');
  if (type === 'species') return `${e.size} · Speed ${e.speed} feet`;
  if (type === 'backgrounds') return `Background · Feat: ${e.feat}`;
  if (type === 'feats') return `${e.type} Feat`;
  if (type === 'equipment') return [e.category, e.cost, e.weight ? e.weight + ' lb.' : ''].filter(Boolean).join(' · ');
}
const s5EntitySource = (type, e) => type === 'monsters' ? '' : e.pack ? `<div class="src">${esc(TYPES[type].one)} · <i>${esc(s5Src(e))}</i>${e.pg ? ', page ' + esc(e.pg) : ''} · imported</div>` : `<div class="src">${esc(TYPES[type].one)} · <i>System Reference Document 5.2</i> (CC BY 4.0)</div>`;
function s5Preview(t, e) {
  if (t === 'monsters') return s5RenderMonster(e, { nosrc: true });
  if (t === 'spells') return s5SpellCard(e, { nopin: true });
}

// ---- menu, home, mobile browse ----
function s5Menu() {
  return [
    ['Rules', [['library', 'Library'], ['book--srd52', 'SRD 5.2 Reference'], ['-'], ['conditions'], ['equipment']]],
    ['Characters', [['classes'], ['species'], ['backgrounds'], ['feats'], ['-'], ['spells']]],
    ['Game Master', [['sessions', 'Sessions'], ['encounter', 'Encounter Builder'], ['initiative', 'Initiative Tracker'], ['-'], ['monsters'], ['book--srd5-monsters', 'Monsters A–Z'], ['imports', 'Imports'], ['-'], ['items'], ['cards', 'Cards: items, spells, quests']]],
    ['Utilities', [['import', 'Import files'], ['roller', 'Dice Roller'], ['pinned', 'Pinned Items'], ['-'], ['sync', 'Sync across devices'], ['!update', 'Check for updates']]]
  ];
}
const S5_BLURB = { spells: 'Every SRD spell with level, school, classes and full text', monsters: 'Stat blocks for every SRD creature, filter by CR, type and size', items: 'Magic items by type, rarity and attunement',
  classes: 'Twelve classes with feature tables, features and a subclass each', species: 'Traits and options for each species', backgrounds: 'Ability scores, feats, skills and equipment',
  feats: 'Origin, general, fighting style and epic boon feats', conditions: 'Blinded, Charmed, Prone and the rest', equipment: 'Weapons, armor, tools and adventuring gear' };
function s5Home() {
  const nImp = PACKS.filter(p => !p.builtin).length;
  const ok = k => TYPES[k] || !k.startsWith('book--') || PK[k.split('--')[1]];
  const tiles = [
    ['Rules', [['book--srd52', 'SRD 5.2 Reference', 'Abilities and skills, conditions, weapons, armor and more'], ['conditions'], ['equipment']]],
    ['Characters', [['classes'], ['species'], ['backgrounds'], ['feats'], ['spells']]],
    ['Run the game', [['encounter', 'Encounter Builder', 'Pick monsters, see Low / Moderate / High difficulty'], ['initiative', 'Initiative Tracker', 'Turn order, HP and conditions'], ['sessions', 'Sessions', 'Prep folders for your game night'], ['roller', 'Dice Roller', 'Any dice, d20 with advantage']]],
    ['Game master', [['monsters'], ['book--srd5-monsters', 'Monsters A–Z', 'Read the bestiary like a book'], ['items'], ['imports', 'Imports', nImp ? `Your ${nImp} imported book${nImp === 1 ? '' : 's'}: adventures, bestiaries, spells, classes` : 'Nothing imported yet'], ['library', 'Library', 'All books, including your imports'], ['import', 'Import files', 'Your own books, adventures and bestiaries (JSON)'], ['pinned', 'Pinned items', 'Your starred spells, monsters and rules']]]
  ];
  $('#main').innerHTML = `<div class="home"><div class="hero"><h1>5e rules, at your fingertips</h1><p>A fast, searchable reference for the fifth edition System Reference Document 5.2.</p>
    <div class="hsearch">${ico('search', 20)}<input id="hq" placeholder="Search spells, monsters, items, rules…" ${isMob ? 'readonly' : ''}><kbd>/</kbd></div>
    <div class="hchips">${[['spells', 'Spells'], ['monsters', 'Monsters'], ['items', 'Magic Items'], ['book--srd52', 'Rules']].map(([k, l]) => `<a href="#${k}">${l}</a>`).join('')}</div></div>
    <div class="hwrap">${tiles.map(([sec, ts]) => `<div class="gsec">${sec}</div><div class="grid">` + ts.filter(([k]) => ok(k)).map(([k, l, d]) => `<a class="tile" href="#${k}"><b>${esc(l || TYPES[k].label)}</b><span>${esc(d || S5_BLURB[k] || '')}</span>${TYPES[k] ? `<em>${itemsOf(k).length} entries</em>` : ''}</a>`).join('') + '</div>').join('')}</div></div>`;
  const hq = $('#hq');
  if (isMob) hq.onclick = openMSearch;
  else { hq.oninput = () => { $('#q').value = hq.value; doSearch(hq.value, hq); }; hq.onkeydown = e => searchKeys(e); hq.focus({ preventScroll: true }); }
  document.title = 'Vanadium — 5e Reference (SRD 5.2)';
}
function s5Browse() {
  const sec = (t, ks) => `<h3>${t}</h3><div class="sgrid">${ks.map(([k, l, d]) => `<a href="#${k}"><b>${esc(l || TYPES[k].label)}</b><span>${esc(d || (TYPES[k] ? itemsOf(k).length + ' entries' : ''))}</span></a>`).join('')}</div>`;
  $('#sheet').innerHTML = `<div class="grab"></div>` +
    sec('Characters', [['classes'], ['species'], ['backgrounds'], ['feats'], ['spells']]) +
    sec('Game master', [['encounter', 'Encounter Builder', 'Difficulty & PDF'], ['initiative', 'Initiative', 'Turns, HP & conditions'], ['monsters'], ['items'], ['sessions', 'Sessions', 'Prep & print a game night'], ['cards', 'Cards', 'Items, spells & quests'], ['imports', 'Imports', 'Your imported books'], ['import', 'Import files', 'Add your own books (JSON)']]) +
    sec('Rules', [['book--srd52', 'SRD 5.2 Reference', 'Reference chapters'], ['conditions'], ['equipment']]) +
    `<p style="font-size:10.5px;color:var(--ink3);margin-top:16px">${esc(S5_ATTRIB)}</p>`;
  $('#sheet').classList.add('on'); showScrim();
  $$('#sheet a').forEach(a => a.addEventListener('click', closeSheets));
}

// ---- search ----
function s5SearchExtra(t, e) {
  if (t === 'spells') return s5SpellLine(e);
  if (t === 'monsters') return `CR ${e.cr} ${e.type}`;
  if (t === 'items') return s5Rarity(e) + ' ' + e.type.toLowerCase();
  if (t === 'feats') return e.type + ' feat';
  if (t === 'equipment') return e.category;
  return '';
}

// ---- dice (SYS.roller): d20 with advantage/disadvantage, any NdM+K expression ----
const s5Int = s => parseInt(String(s).replace(/[−–]/g, '-').replace(/\s+/g, '')) || 0;
const s5Signed = s => { const n = s5Int(s); return n >= 0 ? '+' + n : String(n); };
function s5ParseDice(expr) {   // "2d6 + 3", "d20+5", "1d8 − 1" -> [{n, d}|{k}] (null if not dice)
  const e = String(expr).replace(/[−–]/g, '-').replace(/\s+/g, '').toLowerCase();
  if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(e)) return null;
  return e.match(/[+-]?(\d*d\d+|\d+)/g).map(t => { const sg = t[0] === '-' ? -1 : 1, b = t.replace(/^[+-]/, ''); if (b.includes('d')) { const [n, d] = b.split('d'); return { s: sg, n: +(n || 1), d: +d }; } return { s: sg, k: +b }; });
}
const s5Die = d => 1 + Math.floor(Math.random() * d);
const S5_DICE_HTML = `
  <div class="rh">Dice <button id="rclose">×</button></div>
  <div class="rb">
    <div class="r5dice">${[4, 6, 8, 10, 12, 20, 100].map(d => `<button data-dice="1d${d}" data-lab="d${d}">d${d}</button>`).join('')}</div>
    <div class="rrow"><input id="r5expr" placeholder="2d6+3, d20+5 …" autocomplete="off" spellcheck="false"><button class="bigroll" id="r5go">Roll</button></div>
    <div class="rrow"><select id="r5adv" title="Applies to d20 rolls"><option value="0">Normal d20</option><option value="1">Advantage</option><option value="-1">Disadvantage</option></select></div>
    <div id="r5log"></div>
  </div>`;
function s5Roll(expr, label) {
  const terms = s5ParseDice(expr); if (!terms) { toast('Not a dice roll: ' + esc(expr)); return; }
  const adv = +($('#r5adv') || {}).value || 0, parts = []; let tot = 0, nat = null;
  const d20 = terms.filter(t => t.d === 20 && t.n === 1).length === 1;   // advantage applies to a single d20
  for (const t of terms) {
    if (t.k != null) { tot += t.s * t.k; parts.push((t.s < 0 ? '− ' : '+ ') + t.k); continue; }
    let rolls = Array.from({ length: t.n }, () => s5Die(t.d)), note = '';
    if (t.d === 20 && t.n === 1 && d20 && adv) { const a = rolls[0], b = s5Die(20); rolls = [adv > 0 ? Math.max(a, b) : Math.min(a, b)]; note = ` [${a}, ${b}] ${adv > 0 ? 'adv' : 'dis'}`; nat = rolls[0]; }
    else if (t.d === 20 && t.n === 1) nat = rolls[0];
    const sum = rolls.reduce((a, b) => a + b, 0); tot += t.s * sum;
    parts.push((parts.length ? (t.s < 0 ? '− ' : '+ ') : (t.s < 0 ? '−' : '')) + `${t.n}d${t.d}` + (note || ` [${rolls.join(', ')}]`));
  }
  const tag = nat === 20 ? '<span class="tl" style="background:var(--ok)">Natural 20</span>' : nat === 1 ? '<span class="tl" style="background:var(--bad)">Natural 1</span>' : '';
  $('#r5log').insertAdjacentHTML('afterbegin', `<div class="rl"><div class="tot">${tot}</div><div><div class="lab">${esc(label || expr)}</div><div class="tt">${esc(parts.join(' '))}</div>${tag}</div></div>`);
  toast(`${label ? esc(label) + ': ' : ''}<b>${tot}</b>${nat === 20 ? ' (natural 20!)' : nat === 1 ? ' (natural 1)' : ''}`);
  return tot;
}
function s5MountRoller() {
  const go = () => { const v = $('#r5expr').value.trim(); if (v) s5Roll(v, v); };
  $('#r5go').onclick = go; $('#r5expr').onkeydown = e => { if (e.key === 'Enter') go(); };
}
// make dice in rules text clickable: "Attack Roll: +11", "13 (2d6 + 6)", "8d6", "1d4 + 2"
function s5Dicify(html, label) {
  return String(html).split(/(<[^>]+>)/).map(seg => seg.startsWith('<') ? seg : seg
    .replace(/(Attack Roll:)\s*([+−-]\d+)/g, (m, a, b) => `${a} <button class="s5-roll" data-dice="1d20${s5Signed(b)}" data-lab="${esc(label)}: attack">${b}</button>`)
    .replace(/\b(\d+d\d+(?:\s*[+−-]\s*\d+)?)(?![^<]*<\/button>)/g, (m, d) => `<button class="s5-roll" data-dice="${esc(d)}" data-lab="${esc(label)}">${d}</button>`)).join('');
}

// ---- imported books (s5-import.js): book blocks and cross-references ----
const s5Src = e => e.pack ? (e.srcCode || '').toUpperCase() || PK[e.pack]?.title || 'Imported' : 'SRD 5.2';   // short: PHB, XPHB, SRD 5.2
function s5Find(kind, name, src) {
  const n = String(name).toLowerCase(), list = kind === 'creature' ? MONS : itemsOf(kind === 'spell' ? 'spells' : 'items');
  return list.find(x => x.name.toLowerCase() === n && (!src || x.srcCode === src)) || list.find(x => x.name.toLowerCase() === n) || null;
}
function s5RenderBlock(b, { pm, idx }) {
  if (b.t === 's5read') return `<div class="s5read"${idx}>${pm}${renderBlocks(b.blocks)}</div>`;
  if (b.t === 's5inset') return `<aside class="s5inset"${idx}>${pm}${b.title ? `<div class="ah">${esc(b.title)}</div>` : ''}${renderBlocks(b.blocks)}</aside>`;
  if (b.t === 's5mref') {
    const m = s5Find('creature', b.name, b.source);
    return `<div${idx}>${pm}</div>` + (m ? s5RenderMonster(m, { nosrc: true }) : `<p class="small s5-missing">Stat block: <b>${esc(b.name)}</b>. Import the bestiary it comes from to see it here.</p>`);
  }
}
function s5FindClick(e) {
  const f = e.target.closest('[data-s5find]'); if (!f) return false;
  e.preventDefault();
  const [kind, name, src] = f.dataset.s5find.split('|'), x = s5Find(kind, name, src);
  if (x) go((kind === 'creature' ? 'monsters--' + x.gid : kind === 'spell' ? 'spells--' + x.id : 'items--' + x.id));
  else toast(`“${esc(name)}” isn’t in your library${kind === 'creature' ? ' (import its bestiary)' : kind === 'spell' ? ' (import its spells)' : ''}`);
  return true;
}
function s5PackSummary(p) {
  const n = Object.entries(p.entities || {}).map(([t, l]) => l.length + ' ' + (TYPES[t] ? TYPES[t].label.toLowerCase() : t));
  return n.length ? ' · ' + n.join(' · ') : '';
}

// ---- #imports: every imported book in one place (instead of a home tile / menu entry each) ----
let s5ImpQ = '';
function s5ImportsPage() {
  const mine = PACKS.filter(p => !p.builtin).sort((a, b) => a.title.localeCompare(b.title));
  const groups = [['adventure', 'Adventures'], ['book', 'Books'], ['bestiary', 'Bestiaries'], ['supplement', 'Spells and classes']];
  const q = s5ImpQ.trim().toLowerCase(), shown = mine.filter(p => !q || p.title.toLowerCase().includes(q));
  const what = p => [p.chapters.filter(c => c.blocks.length).length && p.chapters.filter(c => c.blocks.length).length + ' chapters', (p.monsters || []).length && p.monsters.length + ' monsters', s5PackSummary(p).replace(/^ · /, '')].filter(Boolean).join(' · ');
  const row = p => `<div class="s5imp"><div><b>${p.chapters.some(c => c.blocks.length) ? `<a href="#book--${esc(p.id)}">${esc(p.title)}</a>` : esc(p.title)}</b><span>${esc(what(p))}</span></div>
    <div class="s5imp-a">${p.chapters.some(c => c.blocks.length) ? `<a class="btn ghost sm" href="#book--${esc(p.id)}">Read</a>` : ''}${(p.monsters || []).length ? `<a class="btn ghost sm" href="#monsters" data-srcfilter="${esc(p.title)}">Monsters</a>` : ''}${p.entities?.spells ? '<a class="btn ghost sm" href="#spells">Spells</a>' : ''}${p.entities?.classes ? '<a class="btn ghost sm" href="#classes">Classes</a>' : ''}</div></div>`;
  $('#main').innerHTML = `<div class="lib s5imps"><h1>Imports <small>${mine.length}</small></h1>
    <p class="note">The books you imported from your own JSON files. Their monsters, spells and classes are also in the lists. <a href="#import">Import more</a> · <a href="#library">Library</a></p>
    ${mine.length ? `<input id="s5-impq" type="search" placeholder="Filter ${mine.length} books…" value="${esc(s5ImpQ)}" autocomplete="off">` : ''}
    ${groups.map(([k, label]) => { const xs = shown.filter(p => (p.kind === k) || (k === 'supplement' && !groups.some(g => g[0] === p.kind))); return xs.length ? `<h2>${label} <small>${xs.length}</small></h2><div class="s5implist">${xs.map(row).join('')}</div>` : ''; }).join('')
    || (mine.length ? '<div class="empty">No book matches.</div>' : '<div class="empty">Nothing imported yet. <a href="#import">Import files</a></div>')}</div>`;
  const f = $('#s5-impq'); if (f) f.oninput = () => { s5ImpQ = f.value; const pos = f.selectionStart; s5ImportsPage(); const n = $('#s5-impq'); n.focus(); n.setSelectionRange(pos, pos); };
  document.title = 'Imports — Vanadium';
}

// ================= 5e tools: encounter builder, initiative tracker, session items =================
// Encounter difficulty follows the SRD 5.2 "Combat Encounters" rules: each character gets an XP
// budget for Low / Moderate / High difficulty by level (XP Budget per Character table); the party's
// budget is the sum. The SRD only covers parties of one level; summing per character is the
// natural extension for mixed levels. Creature XP is simply added up (no multipliers in 2024).
// State (per system, see store): enc (the builder), encs (saved), init (the initiative tracker).

const S5_BUDGET = [null, [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100], [600, 1000, 1400], [750, 1300, 1700],
  [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100], [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200],
  [3300, 5400, 7800], [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000]];
const S5_DIFF = ['Low', 'Moderate', 'High'];
const S5_CONDS = ['Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];
const s5Uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const s5Xp = m => s5Num(String(m.xp).split(', or')[0]);   // "11,500, or 13,000 in lair" -> 11500

function s5NewEnc(party) {
  return { id: s5Uid('e'), name: 'New encounter', party: party || Array.from({ length: 4 }, (_, i) => ({ name: 'Character ' + (i + 1), level: 1 })), entries: [] };
}
let S5ENC = store.get('enc', null) || s5NewEnc();
let S5ENCS = store.get('encs', []);
const s5SaveEnc = () => { store.set('enc', S5ENC); if (S5ENC.sessionRef) s5SyncEncToSession(); };
function s5EncMath(E = S5ENC) {
  const budget = [0, 0, 0];
  for (const c of E.party) { const b = S5_BUDGET[Math.min(20, Math.max(1, +c.level || 1))]; budget.forEach((_, i) => budget[i] += b[i]); }
  let xp = 0, count = 0;
  for (const e of E.entries) { const m = MON[e.gid]; if (m) { xp += s5Xp(m) * e.n; count += e.n; } }
  const di = xp === 0 ? -1 : xp <= budget[0] ? 0 : xp <= budget[1] ? 1 : xp <= budget[2] ? 2 : 3;
  const label = di < 0 ? 'Empty' : di < 3 ? S5_DIFF[di] : 'Beyond High';
  return { budget, xp, count, di, label };
}
const S5_DCOL = ['var(--ok)', 'var(--gold)', 'var(--accent)', 'var(--bad)'];

// ---- encounter builder (#encounter) ----
let s5EncQ = '';
function s5EncounterPage() {
  if (!MONS.length) { $('#main').innerHTML = '<div class="empty">Loading monsters…</div>'; return; }
  const E = S5ENC, M = s5EncMath(E);
  const lv = [...new Set(E.party.map(c => +c.level))];
  const picks = s5EncQ.trim() ? MONS.filter(m => m.name.toLowerCase().includes(s5EncQ.trim().toLowerCase())).slice(0, 40) : [];
  const bar = M.budget[2] ? Math.min(100, M.xp / M.budget[2] * 100) : 0;
  $('#main').innerHTML = `<div class="neghub s5enc"><h1>Encounter Builder</h1>
    <p class="note">Pick creatures for your party. The difficulty uses the SRD 5.2 XP budget per character (Low, Moderate, High), added up for every character in the party.</p>
    <div class="s5enc-g"><div class="s5enc-l">
      <div class="s5card"><h2>Party <span class="s5-sub">${E.party.length} character${E.party.length === 1 ? '' : 's'}${lv.length === 1 ? ', level ' + lv[0] : ''}</span></h2>
        ${E.party.map((c, i) => `<div class="s5row"><input data-pn="${i}" value="${esc(c.name)}" aria-label="Name"><label>Level <input type="number" data-pl="${i}" min="1" max="20" value="${c.level}"></label><button class="ibtn" data-pdel="${i}" title="Remove">✕</button></div>`).join('')}
        <div class="s5row"><button class="btn ghost sm" id="s5-padd">+ Character</button><label>All at level <input type="number" id="s5-pall" min="1" max="20" value="${lv.length === 1 ? lv[0] : ''}" placeholder="–"></label></div></div>
      <div class="s5card"><h2>Add creatures</h2><input id="s5-q" type="search" placeholder="Search ${MONS.length} monsters…" value="${esc(s5EncQ)}" autocomplete="off">
        <div class="s5picks">${picks.map(m => `<button data-add5="${esc(m.gid)}"><b>${esc(m.name)}</b><span>CR ${esc(m.cr)} · ${s5Xp(m).toLocaleString('en')} XP</span></button>`).join('') || (s5EncQ ? '<div class="empty">No monster matches.</div>' : '<div class="note">Type a name, or use “+ Encounter” on any monster page.</div>')}</div></div>
    </div><div class="s5enc-r">
      <div class="s5card"><div class="s5row"><input id="s5-ename" class="encname" value="${esc(E.name)}" aria-label="Encounter name"></div>
        <div class="s5diff" style="--dc:${S5_DCOL[Math.max(0, M.di)]}"><b>${M.label}</b><span>${M.xp.toLocaleString('en')} XP · ${M.count} creature${M.count === 1 ? '' : 's'}</span></div>
        <div class="s5bud"><div class="s5bar"><i style="width:${bar}%;background:${S5_DCOL[Math.max(0, M.di)]}"></i>${M.budget.map((b, i) => `<em style="left:${b / M.budget[2] * 100}%"></em>`).join('')}</div>
          <div class="s5budl">${M.budget.map((b, i) => `<span><b>${S5_DIFF[i]}</b> ${b.toLocaleString('en')} XP</span>`).join('')}</div></div>
        ${E.entries.length ? `<div class="s5ents">${E.entries.map((e, i) => { const m = MON[e.gid]; return m ? `<div class="s5ent"><a class="lnk" data-go="monsters--${esc(m.gid)}">${esc(m.name)}</a><span>CR ${esc(m.cr)} · ${(s5Xp(m) * e.n).toLocaleString('en')} XP</span><div class="step"><button data-edec="${i}">−</button><b>${e.n}</b><button data-einc="${i}">+</button></div></div>` : ''; }).join('')}</div>` : '<div class="empty">No creatures yet.</div>'}
        <div class="negacts"><button class="btn" id="s5-init" ${E.entries.length ? '' : 'disabled'}>⚔ Run initiative</button><button class="btn ghost" id="s5-save">Save</button><button class="btn ghost" id="s5-new">New</button><button class="btn ghost" id="s5-pdf" ${E.entries.length ? '' : 'disabled'}>PDF</button></div>
        ${E.sessionRef ? '<p class="note">This encounter is part of a session; changes are saved there too.</p>' : ''}</div>
      ${S5ENCS.length ? `<div class="s5card"><h2>Saved encounters</h2>${S5ENCS.map((s, i) => { const sm = s5EncMath(s); return `<div class="s5ent"><a data-eload="${i}">${esc(s.name)}</a><span>${sm.label} · ${sm.xp.toLocaleString('en')} XP</span><button class="ibtn" data-erm="${i}" title="Delete">✕</button></div>`; }).join('')}</div>` : ''}
    </div></div></div>`;
  const re = () => { s5SaveEnc(); s5EncounterPage(); };
  $$('[data-pn]').forEach(i => i.onchange = () => { E.party[+i.dataset.pn].name = i.value.trim() || 'Character'; s5SaveEnc(); });
  $$('[data-pl]').forEach(i => i.onchange = () => { E.party[+i.dataset.pl].level = Math.min(20, Math.max(1, +i.value || 1)); re(); });
  $$('[data-pdel]').forEach(b => b.onclick = () => { E.party.splice(+b.dataset.pdel, 1); if (!E.party.length) E.party.push({ name: 'Character 1', level: 1 }); re(); });
  $('#s5-padd').onclick = () => { E.party.push({ name: 'Character ' + (E.party.length + 1), level: E.party[E.party.length - 1]?.level || 1 }); re(); };
  $('#s5-pall').onchange = e => { const l = Math.min(20, Math.max(1, +e.target.value || 1)); E.party.forEach(c => c.level = l); re(); };
  const q = $('#s5-q'); q.oninput = () => { s5EncQ = q.value; const pos = q.selectionStart; s5EncounterPage(); const n = $('#s5-q'); n.focus(); n.setSelectionRange(pos, pos); };
  $$('[data-add5]').forEach(b => b.onclick = () => { s5AddToEnc(b.dataset.add5, true); });
  $$('[data-einc]').forEach(b => b.onclick = () => { E.entries[+b.dataset.einc].n++; re(); });
  $$('[data-edec]').forEach(b => b.onclick = () => { const e = E.entries[+b.dataset.edec]; e.n--; if (e.n <= 0) E.entries.splice(+b.dataset.edec, 1); re(); });
  $('#s5-ename').onchange = e => { E.name = e.target.value.trim() || 'Encounter'; s5SaveEnc(); };
  $('#s5-save').onclick = () => { const c = JSON.parse(JSON.stringify(E)); delete c.sessionRef; const i = S5ENCS.findIndex(x => x.id === c.id); if (i >= 0) S5ENCS[i] = c; else S5ENCS.unshift(c); store.set('encs', S5ENCS); toast('Saved “' + esc(c.name) + '”'); s5EncounterPage(); };
  $('#s5-new').onclick = () => { S5ENC = s5NewEnc(JSON.parse(JSON.stringify(E.party))); re(); };
  $$('[data-eload]').forEach(a => a.onclick = () => { S5ENC = JSON.parse(JSON.stringify(S5ENCS[+a.dataset.eload])); re(); });
  $$('[data-erm]').forEach(b => b.onclick = async () => { if (await confirmSheet(`Delete the saved encounter “${S5ENCS[+b.dataset.erm].name}”?`, 'Delete')) { S5ENCS.splice(+b.dataset.erm, 1); store.set('encs', S5ENCS); s5EncounterPage(); } });
  $('#s5-init').onclick = () => { s5StartInitiative(E); go('initiative'); };
  $('#s5-pdf').onclick = () => runPdfJob($('#s5-pdf'), 'PDF', async () => { const b = await s5EncounterPdf(E); await deliverFile(pdfFileName(E.name), new Blob([b], { type: 'application/pdf' })); });
  enhance($('#main'));
  document.title = 'Encounter Builder — Vanadium';
}
function s5AddToEnc(gid, stay) {
  const m = MON[gid]; if (!m) return;
  const ex = S5ENC.entries.find(e => e.gid === gid); if (ex) ex.n++; else S5ENC.entries.push({ gid, n: 1 });
  s5SaveEnc();
  const M = s5EncMath(); toast(`Added ${esc(m.name)} · ${M.xp.toLocaleString('en')} XP (${M.label.toLowerCase()})`);
  if (stay) s5EncounterPage();
}

// ---- initiative tracker (#initiative) ----
let S5INIT = store.get('init', null) || { round: 1, turn: 0, list: [] };
const s5SaveInit = () => store.set('init', S5INIT);
const s5InitSort = () => S5INIT.list.sort((a, b) => (b.init ?? -99) - (a.init ?? -99) || (b.mod ?? 0) - (a.mod ?? 0) || a.name.localeCompare(b.name));
function s5StartInitiative(E) {
  const list = E.party.map(c => ({ id: s5Uid('c'), name: c.name, pc: true, init: null, mod: 0, conds: [] }));
  for (const e of E.entries) {
    const m = MON[e.gid]; if (!m) continue;
    for (let k = 1; k <= e.n; k++) {
      const mod = s5Int(m.init);
      list.push({ id: s5Uid('c'), name: m.name + (e.n > 1 ? ' ' + k : ''), gid: m.gid, init: s5Die(20) + mod, mod, ac: m.ac, hp: m.hp, maxHp: m.hp, conds: [] });
    }
  }
  S5INIT = { round: 1, turn: 0, name: E.name, list }; s5InitSort(); s5SaveInit();
}
function s5InitiativePage() {
  const T = S5INIT, cur = T.list[T.turn];
  $('#main').innerHTML = `<div class="neghub s5ini"><h1>Initiative${T.name ? ` <span class="s5-sub">${esc(T.name)}</span>` : ''}</h1>
    <div class="negacts"><span class="s5round">Round <b>${T.round}</b>${cur ? ` · <b>${esc(cur.name)}</b>’s turn` : ''}</span><span style="flex:1"></span>
      <button class="btn ghost" id="i5-prev" ${T.list.length ? '' : 'disabled'}>← Back</button><button class="btn" id="i5-next" ${T.list.length ? '' : 'disabled'}>Next turn →</button></div>
    ${T.list.length ? `<div class="s5itable">${T.list.map((c, i) => `<div class="s5irow ${i === T.turn ? 'cur' : ''} ${c.hp === 0 ? 'down' : ''}">
      <input class="s5iinit" type="number" data-iinit="${i}" value="${c.init ?? ''}" placeholder="–" aria-label="Initiative">
      <div class="s5iname">${c.gid ? `<a class="lnk" data-go="monsters--${esc(c.gid)}">${esc(c.name)}</a>` : `<b>${esc(c.name)}</b>`}<span>${c.pc ? 'Character' : `AC ${esc(c.ac)} · init ${c.mod >= 0 ? '+' : '−'}${Math.abs(c.mod)}`}</span>
        <div class="s5conds">${(c.conds || []).map(k => `<button class="chip inc" data-iuncond="${i}|${esc(k)}" title="Remove">${esc(k)} ×</button>`).join('')}<select data-icond="${i}" aria-label="Add a condition"><option value="">+ condition</option>${S5_CONDS.filter(k => !(c.conds || []).includes(k)).map(k => `<option>${k}</option>`).join('')}</select></div></div>
      ${c.maxHp != null ? `<div class="s5ihp"><b>${c.hp}</b><span>/ ${c.maxHp} HP</span><input data-ihp="${i}" placeholder="−7 or +5" aria-label="Damage or healing"></div>` : '<div class="s5ihp"></div>'}
      <button class="ibtn" data-idel="${i}" title="Remove">✕</button></div>`).join('')}</div>` : '<div class="empty">No one in the fight yet. Start from the <a href="#encounter">Encounter Builder</a>, or add combatants below.</div>'}
    <div class="s5card"><div class="s5row"><input id="i5-name" placeholder="Name"><input id="i5-init" type="number" placeholder="Initiative" style="width:110px"><input id="i5-hp" type="number" placeholder="HP (optional)" style="width:130px"><button class="btn ghost" id="i5-add">Add</button></div>
      <div class="s5row"><button class="btn ghost sm" id="i5-reroll">Re-roll monster initiative</button><button class="btn ghost sm danger" id="i5-clear">Clear</button></div>
      <p class="note">Monster initiative is d20 + the creature’s Initiative from its SRD 5.2 stat block. Type the characters’ rolls into the boxes; the order updates when you leave a box.</p></div></div>`;
  const re = () => { s5SaveInit(); s5InitiativePage(); };
  const step = d => { const n = T.list.length; if (!n) return; T.turn += d; if (T.turn >= n) { T.turn = 0; T.round++; } if (T.turn < 0) { if (T.round > 1) { T.turn = n - 1; T.round--; } else T.turn = 0; } re(); };
  if ($('#i5-next')) { $('#i5-next').onclick = () => step(1); $('#i5-prev').onclick = () => step(-1); }
  $$('[data-iinit]').forEach(i => i.onchange = () => { const c = T.list[+i.dataset.iinit], curId = T.list[T.turn]?.id; c.init = i.value === '' ? null : +i.value; s5InitSort(); T.turn = Math.max(0, T.list.findIndex(x => x.id === curId)); re(); });
  $$('[data-ihp]').forEach(i => i.onkeydown = e => { if (e.key !== 'Enter') return; const c = T.list[+i.dataset.ihp], v = s5Int(i.value); if (!v) return; c.hp = Math.max(0, Math.min(c.maxHp, c.hp + (/^\s*\+/.test(i.value) ? Math.abs(v) : -Math.abs(v)))); re(); });
  $$('[data-icond]').forEach(s => s.onchange = () => { if (!s.value) return; const c = T.list[+s.dataset.icond]; (c.conds = c.conds || []).push(s.value); re(); });
  $$('[data-iuncond]').forEach(b => b.onclick = () => { const [i, k] = b.dataset.iuncond.split('|'); const c = T.list[+i]; c.conds = c.conds.filter(x => x !== k); re(); });
  $$('[data-idel]').forEach(b => b.onclick = () => { const i = +b.dataset.idel; T.list.splice(i, 1); if (T.turn >= T.list.length) T.turn = 0; else if (i < T.turn) T.turn--; re(); });
  $('#i5-add').onclick = () => { const name = $('#i5-name').value.trim(); if (!name) { toast('Give the combatant a name'); return; } const hp = +$('#i5-hp').value || null; const curId = T.list[T.turn]?.id; T.list.push({ id: s5Uid('c'), name, pc: !hp, init: $('#i5-init').value === '' ? null : +$('#i5-init').value, mod: 0, hp, maxHp: hp, conds: [] }); s5InitSort(); T.turn = Math.max(0, T.list.findIndex(x => x.id === curId)); re(); };
  $('#i5-reroll').onclick = () => { const curId = T.list[T.turn]?.id; T.list.forEach(c => { if (c.gid) c.init = s5Die(20) + c.mod; }); s5InitSort(); T.turn = Math.max(0, T.list.findIndex(x => x.id === curId)); re(); };
  $('#i5-clear').onclick = async () => { if (await confirmSheet('Clear the initiative tracker?', 'Clear')) { S5INIT = { round: 1, turn: 0, list: [] }; re(); } };
  document.title = 'Initiative — Vanadium';
}

// ---- printable encounter sheet ----
async function s5EncounterPdf(E) {
  const M = s5EncMath(E), w = await makeWriter(E.name); w.newPage();
  w.header(E.name, `${E.party.length} characters (${[...new Set(E.party.map(c => 'level ' + c.level))].join(', ')}) · ${M.xp.toLocaleString('en')} XP · ${M.label}`, 'Encounter');
  w.table(['Difficulty', 'XP budget', 'This encounter'], M.budget.map((b, i) => [`<b>${S5_DIFF[i]}</b>`, b.toLocaleString('en') + ' XP', M.di === i ? '<b>◀</b>' : '']), [1, 1, 1]);
  w.h('Creatures', 2);
  w.table(['Creature', 'CR', 'AC', 'HP', 'Initiative', 'XP'], E.entries.filter(e => MON[e.gid]).map(e => { const m = MON[e.gid]; return [`${e.n} × <b>${esc(m.name)}</b>`, m.cr, String(m.ac), `${m.hp} (${m.hpRoll})`, m.init, (s5Xp(m) * e.n).toLocaleString('en')]; }), [2.4, 0.6, 0.6, 1.4, 0.9, 0.9]);
  for (const e of E.entries) {
    const m = MON[e.gid]; if (!m) continue;
    w.h(m.name, 3, `${m.size} ${m.type}, ${m.alignment}`);
    w.para(`<b>AC</b> ${m.ac} · <b>Initiative</b> ${esc(m.init)} · <b>HP</b> ${m.hp} (${esc(m.hpRoll)}) · <b>Speed</b> ${esc(m.speed)}`, { size: 9 });
    w.para(S5_AB.map(([k, l]) => `<b>${l}</b> ${m.ab[k]} (${s5Mod(m.ab[k])}, save ${esc(m.saves[k])})`).join(' · '), { size: 8.5 });
    const lines = [['Skills', m.skills], ['Vulnerabilities', m.vuln], ['Resistances', m.resist], ['Immunities', m.immune], ['Senses', m.senses], ['Languages', m.languages]].filter(x => x[1]);
    if (lines.length) w.para(lines.map(([l, v]) => `<b>${l}</b> ${esc(v)}`).join(' · '), { size: 8.5 });
    for (const [title, list] of [['Traits', m.traits], ['Actions', m.actions], ['Bonus Actions', m.bonus], ['Reactions', m.reactions], ['Legendary Actions', m.legendary]]) {
      if (!list.length) continue;
      w.para(`<b>${title.toUpperCase()}</b>`, { size: 8.5 });
      for (const a of list) w.para(`<b><i>${esc(a.name)}.</i></b> ${a.html}${a.spells ? ' ' + a.spells.join('; ') : ''}`, { size: 8.5 });
    }
  }
  return w.bytes();
}

// ---- sessions: 5e encounters as session items ----
function s5SyncEncToSession() {
  const r = S5ENC.sessionRef; const S = sessById(r.sid); const d = S && S.docs.find(x => x.id === r.did);
  if (!d) { delete S5ENC.sessionRef; return; }
  const c = JSON.parse(JSON.stringify(S5ENC)); delete c.sessionRef; d.enc = c; d.title = c.name || d.title; saveSessions();
}
const S5_SESSION = {
  planText: 'combat encounters',
  party: [{ id: 'h', key: 'heroes', label: 'Characters', min: 1, max: 12 }, { id: 'l', key: 'level', label: 'Level', min: 1, max: 20 }],
  partyNote: 'The party here is used for encounters you add to this session.',
  newParty: () => ({ heroes: S5ENC.party.length || 4, level: S5ENC.party[0]?.level || 1 }),
  partyLine: S => `${S.heroes} characters, level ${S.level}`,
  overviewExtra: S => { const encs = S.docs.filter(x => x.type === 'enc'); return encs.length ? `<p class="note">Combat this session: ${encs.map(x => esc(x.title)).join(', ')}.</p>` : ''; },
  kinds: {
    enc: {
      icon: '⚔', label: 'Combat encounter', noun: 'encounter', addLabel: '⚔ Encounter',
      summary: x => x.enc ? (() => { const m = s5EncMath(x.enc); return ` · ${m.label}, ${m.xp.toLocaleString('en')} XP`; })() : '',
      html(S, d, top) {
        const E = d.enc; if (!E) return top + '<div class="empty">Missing encounter.</div>';
        const M = s5EncMath(E);
        return top + `<div class="s5diff" style="--dc:${S5_DCOL[Math.max(0, M.di)]}"><b>${M.label}</b><span>${M.xp.toLocaleString('en')} XP · budgets ${M.budget.map((b, i) => S5_DIFF[i] + ' ' + b.toLocaleString('en')).join(', ')} · ${E.party.length} characters</span></div>
          <div class="actrow"><button class="btn" id="d-open">Open in Encounter Builder</button><button class="btn ghost" id="d-run">⚔ Run initiative</button><button class="btn ghost" id="d-repl">Replace with the builder’s current encounter</button></div>
          ${E.entries.map(e => { const m = MON[e.gid]; return m ? `<div class="s5ent"><a class="lnk" data-go="monsters--${esc(m.gid)}">${e.n} × ${esc(m.name)}</a><span>CR ${esc(m.cr)} · AC ${m.ac} · HP ${m.hp} · ${(s5Xp(m) * e.n).toLocaleString('en')} XP</span></div>` : ''; }).join('')}`;
      },
      onRename: d => { if (d.enc) d.enc.name = d.title; },
      wire(S, d) {
        if ($('#d-open')) $('#d-open').onclick = () => { S5ENC = JSON.parse(JSON.stringify(d.enc)); S5ENC.sessionRef = { sid: S.id, did: d.id }; store.set('enc', S5ENC); go('encounter'); };
        if ($('#d-run')) $('#d-run').onclick = () => { s5StartInitiative(d.enc); go('initiative'); };
        if ($('#d-repl')) $('#d-repl').onclick = async () => { if (!S5ENC.entries.length) { toast('The encounter builder is empty'); return; } if (await confirmSheet(`Replace “${d.title}” with “${S5ENC.name}” from the builder?`, 'Replace')) { const c = JSON.parse(JSON.stringify(S5ENC)); delete c.sessionRef; d.enc = c; d.title = c.name; saveSessions(); sessionPage(S.id, d.id); } };
      },
      add(S, add) {
        const party = Array.from({ length: S.heroes || 4 }, (_, i) => ({ name: 'Character ' + (i + 1), level: S.level || 1 }));
        const items = [];
        if (S5ENC.entries.length) items.push({ id: 'cur', name: S5ENC.name, sub: (() => { const m = s5EncMath(); return m.label + ' · ' + m.xp.toLocaleString('en') + ' XP'; })(), group: 'In the Encounter Builder now' });
        S5ENCS.forEach(e => items.push({ id: 'saved:' + e.id, name: e.name, sub: e.entries.length + ' kinds of creature', group: 'Saved encounters' }));
        items.push({ id: 'new', name: 'Empty encounter', sub: 'Build it in the Encounter Builder', group: 'New' });
        return pickerSheet('Add a combat encounter', items, id => {
          let e = id === 'cur' ? JSON.parse(JSON.stringify(S5ENC)) : id.startsWith('saved:') ? JSON.parse(JSON.stringify(S5ENCS.find(x => 'saved:' + x.id === id))) : s5NewEnc(party);
          delete e.sessionRef; e.id = s5Uid('e');
          if (id === 'new') e.name = 'Encounter ' + (S.docs.filter(x => x.type === 'enc').length + 1);
          add({ type: 'enc', title: e.name, enc: e });
        });
      },
      async pdf(S, d) { return d.enc && d.enc.entries.some(e => MON[e.gid]) ? s5EncounterPdf(d.enc) : null; }
    }
  }
};

// dice buttons, "+ Encounter" on monster pages
function s5OnClick(e) {
  const r = e.target.closest('[data-dice]'); if (r) { e.preventDefault(); openRoller(); s5Roll(r.dataset.dice, r.dataset.lab || r.dataset.dice); return true; }
  const a = e.target.closest('[data-addenc5]'); if (a) { e.preventDefault(); s5AddToEnc(a.dataset.addenc5); return true; }
}

// ================= 5e importer: JSON files in the 5etools data format =================
// Reads the files a person owns and brings into Vanadium themselves (bestiary-*.json,
// adventure-*.json, book-*.json, spells-*.json, class-*.json; sources.json supplies spell classes).
// Everything is converted in the browser and stored like any import (IndexedDB, private sync);
// nothing is fetched from anywhere: pictures referenced by the files are skipped.
// Output: packs with chapters (books), monsters (s5RenderMonster format) and entities
// (spells and classes for the lists). Wired up as SYS.importer.run in register.js.

const S5I_SIZE = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' };
const S5I_SCHOOL = { A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment', V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation', P: 'Psionic' };
const S5I_ALIGN = { L: 'Lawful', N: 'Neutral', NX: 'Neutral', NY: 'Neutral', C: 'Chaotic', G: 'Good', E: 'Evil' };
// SRD 5.2 "Experience Points by Challenge Rating" and "Proficiency Bonus by Challenge Rating"
const S5I_XP = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000 };
const s5iPB = cr => { const n = s5CrNum(String(cr)) || 0; return n < 5 ? 2 : n < 9 ? 3 : n < 13 ? 4 : n < 17 ? 5 : n < 21 ? 6 : n < 25 ? 7 : n < 29 ? 8 : 9; };
const s5iSlug = s => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const s5iCap = s => String(s).replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const s5iOrd = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// ---- {@tag ...} markup -> html ----
const S5I_ATK = { mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:', 'mw,rw': 'Melee or Ranged Weapon Attack:', ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:', 'ms,rs': 'Melee or Ranged Spell Attack:', m: 'Melee Attack Roll:', r: 'Ranged Attack Roll:', 'm,r': 'Melee or Ranged Attack Roll:' };
const S5I_FIND = { creature: 'creature', spell: 'spell', item: 'item' };
function s5iTag(tag, body) {
  const parts = body.split('|'), text = parts[0], shown = (parts[2] || parts[0]).trim();
  switch (tag) {
    case 'b': case 'bold': return `<b>${text}</b>`;
    case 'i': case 'italic': case 'note': return `<i>${text}</i>`;
    case 's': case 'strike': return `<s>${text}</s>`;
    case 'u': case 'underline': return `<u>${text}</u>`;
    case 'sup': return `<sup>${text}</sup>`;
    case 'sub': return `<sub>${text}</sub>`;
    case 'h': return '<i>Hit:</i> ';
    case 'm': return '<i>Miss:</i> ';
    case 'atk': case 'atkr': return `<i>${S5I_ATK[text.trim()] || 'Attack:'}</i>`;
    case 'hit': return `<button class="s5-roll" data-dice="1d20${s5Signed(text)}">${s5Signed(text)}</button>`;
    case 'd20': return `<button class="s5-roll" data-dice="1d20${s5Signed(text)}">${s5Signed(text)}</button>`;
    case 'damage': case 'dice': { const d = text.replace(/×/g, '*'); return s5ParseDice(d) ? `<button class="s5-roll" data-dice="${esc(d)}">${esc(parts[1] && tag === 'dice' ? parts[1] : text)}</button>` : esc(parts[1] || text); }
    case 'scaledice': case 'scaledamage': return esc(parts[2] || parts[0]);
    case 'dc': return 'DC ' + esc(parts[1] || text);
    case 'recharge': return text ? `(Recharge ${esc(text)}–6)` : '(Recharge 6)';
    case 'chance': return `${esc(parts[1] || text + ' percent')}`;
    case 'actSave': return `<i>${s5iCap({ str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' }[text.trim()] || text)} Saving Throw:</i>`;
    case 'actSaveFail': return text ? `<i>Failure by ${esc(text)} or More:</i>` : '<i>Failure:</i>';
    case 'actSaveSuccess': return '<i>Success:</i>';
    case 'actSaveSuccessOrFail': return '<i>Failure or Success:</i>';
    case 'actTrigger': return '<i>Trigger:</i>';
    case 'actResponse': return '<i>Response:</i>';
    case 'hitYourSpellAttack': return esc(parts[0] || 'your spell attack modifier');
    case 'link': return `<a href="${esc(parts[1] || '')}" target="_blank" rel="noopener">${text}</a>`;
    case 'condition': case 'status': { const id = s5iSlug(text); return BYID && BYID.conditions && BYID.conditions[id] ? `<span class="lnk" data-go="conditions--${id}">${esc(shown)}</span>` : esc(shown); }
    case 'creature': case 'spell': case 'item':
      return `<a class="lnk" data-s5find="${S5I_FIND[tag]}|${esc(text.trim())}|${esc((parts[1] || '').trim().toLowerCase())}">${esc(shown)}</a>`;
    case 'filter': return esc(text);
    case '5etoolsImg': case 'comic': return '';
    default: return esc(shown);   // book, adventure, skill, sense, action, variantrule, quickref, table, area, …
  }
}
function s5iText(s) {
  let out = esc(String(s ?? ''));
  for (let i = 0; i < 6 && out.includes('{@'); i++) out = out.replace(/\{@(\w+)\s*([^{}]*)\}/g, (m, t, b) => s5iTag(t, b.replace(/&amp;/g, '&').replace(/&quot;/g, '"')));
  return out.replace(/\{@\w+\s*([^{}|]*)[^{}]*\}/g, '$1');
}
// short html for a monster ability (lists flattened)
function s5iInline(entries) {
  return (entries || []).map(e => {
    if (typeof e === 'string' || typeof e === 'number') return s5iText(e);
    if (e.type === 'list') return e.items.map(it => '• ' + (typeof it === 'string' ? s5iText(it) : `${it.name ? `<b>${s5iText(it.name)}.</b> ` : ''}${s5iInline(it.entries || (it.entry ? [it.entry] : []))}`)).join('<br>');
    if (e.type === 'entries' || e.type === 'item' || e.type === 'inset') return `${e.name ? `<b>${s5iText(e.name)}.</b> ` : ''}${s5iInline(e.entries || (e.entry ? [e.entry] : []))}`;
    if (e.type === 'table') return (e.rows || []).map(r => (r.row || r).map(c => s5iText(typeof c === 'object' ? (c.roll ? (c.roll.exact ?? `${c.roll.min}–${c.roll.max}`) : c.entry || '') : c)).join(' — ')).join('<br>');
    return s5iInline(e.entries || []);
  }).join('<br>');
}

// ---- entries -> book blocks ----
function s5iBlocks(entries, depth, ctx) {
  const out = [];
  const head = (name, id) => { const base = s5iSlug(name); let hid = id ? 'e' + id : base; while (ctx.ids.has(hid)) hid = base + '-' + (++ctx.n); ctx.ids.add(hid); return { t: 'h', lvl: Math.min(5, depth + 1), text: String(name).replace(/\{@\w+\s*([^{}|]*)[^{}]*\}/g, '$1'), id: hid }; };
  for (const e of entries || []) {
    if (e == null) continue;
    if (typeof e === 'string' || typeof e === 'number') { out.push({ t: 'p', style: 'body', html: s5iText(e) }); continue; }
    switch (e.type) {
      case 'section': case 'entries': case 'flowBlock': case 'homebrew':
        if (e.name) out.push(head(e.name, e.id));
        out.push(...s5iBlocks(e.entries, depth + (e.name ? 1 : 0), ctx)); break;
      case 'inset': case 'variant': case 'variantInner': case 'variantSub': case 'flowchart':
        out.push({ t: 's5inset', title: (e.type.startsWith('variant') ? 'Variant: ' : '') + (e.name || ''), blocks: s5iBlocks(e.entries || e.blocks, 3, ctx) }); break;
      case 'insetReadaloud':
        out.push({ t: 's5read', blocks: s5iBlocks(e.entries, 3, ctx) }); break;
      case 'quote':
        out.push({ t: 'p', style: 'body', html: '<i>' + (e.entries || []).map(s5iText).join('<br>') + '</i>' + (e.by ? ` <span class="s5-by">— ${s5iText(e.by)}${e.from ? ', <i>' + s5iText(e.from) + '</i>' : ''}</span>` : '') }); break;
      case 'list': case 'options':
        for (const it of e.items || e.entries || []) {
          if (typeof it === 'string') out.push({ t: 'li', html: s5iText(it) });
          else if (it.type === 'list') out.push(...s5iBlocks([it], depth, ctx));
          else out.push({ t: 'li', html: `${it.name ? `<b>${s5iText(it.name)}.</b> ` : ''}${s5iInline(it.entries || (it.entry ? [it.entry] : []))}` });
        }
        break;
      case 'table': {
        if (e.caption) out.push({ t: 'p', style: 'body', html: `<b>${s5iText(e.caption)}</b>` });
        const cell = c => typeof c === 'object' && c ? (c.type === 'cell' ? (c.roll ? (c.roll.exact != null ? String(c.roll.exact) : `${c.roll.min}–${c.roll.max}`) : s5iInline([c.entry])) : s5iInline([c])) : s5iText(c);
        out.push({ t: 'table', head: (e.colLabels || []).map(h => String(h).replace(/\{@\w+\s*([^{}|]*)[^{}]*\}/g, '$1')), rows: (e.rows || []).map(r => (r.row || r).map(cell)) });
        break;
      }
      case 'tableGroup': out.push(...s5iBlocks(e.tables, depth, ctx)); break;
      case 'statblock':
        if (e.tag === 'creature' || !e.tag) out.push({ t: 's5mref', name: e.name, source: (e.source || '').toLowerCase() });
        else out.push({ t: 'p', style: 'body', html: `<b>${s5iText(e.name || '')}</b> <span class="s5-by">(${esc(e.tag)})</span>` });
        break;
      case 'statblockInline':
        if (e.dataType === 'monster' && e.data) { const m = s5iMonster(e.data, ctx.src); if (m) { ctx.monsters.push(m); out.push({ t: 'monster', ref: m.id }); } }
        break;
      case 'abilityDc': out.push({ t: 'p', style: 'body', html: `<b>${s5iText(e.name)} save DC</b> = 8 + your Proficiency Bonus + your ${(e.attributes || []).map(a => s5iCap({ str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' }[a] || a)).join(' or ')} modifier` }); break;
      case 'abilityAttackMod': out.push({ t: 'p', style: 'body', html: `<b>${s5iText(e.name)} attack modifier</b> = your Proficiency Bonus + your ${(e.attributes || []).map(a => s5iCap({ str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' }[a] || a)).join(' or ')} modifier` }); break;
      case 'refClassFeature': case 'refSubclassFeature': case 'refOptionalfeature': {
        const f = ctx.ref && ctx.ref(e); if (f) { out.push(head(f.name)); out.push(...s5iBlocks(f.entries, depth + 1, ctx)); }
        break;
      }
      case 'image': case 'gallery': case 'hr': break;   // pictures aren't in the files; nothing is fetched
      case 'item': out.push({ t: 'li', html: `${e.name ? `<b>${s5iText(e.name)}.</b> ` : ''}${s5iInline(e.entries || (e.entry ? [e.entry] : []))}` }); break;
      case 'dice': out.push({ t: 'p', style: 'body', html: (e.toRoll || []).map(d => `<button class="s5-roll" data-dice="${d.number}d${d.faces}${d.modifier ? s5Signed(d.modifier) : ''}">${d.number}d${d.faces}${d.modifier ? s5Signed(d.modifier) : ''}</button>`).join(' + ') }); break;
      default:
        if (e.entries) out.push(...s5iBlocks(e.entries, depth, ctx));
        else if (e.entry) out.push(...s5iBlocks([e.entry], depth, ctx));
    }
  }
  return out;
}

// ---- monsters ----
const s5iJoinList = (arr, key) => (arr || []).map(x => typeof x === 'string' ? s5iCap(x) : x.special ? x.special : `${s5iJoinList(x[key], key)}${x.note ? ' ' + x.note : ''}${x.cond ? '' : ''}`.trim()).filter(Boolean).join(', ');
function s5iAlign(a) {
  if (!a || !a.length) return '';
  if (typeof a[0] === 'object') return a.map(x => x.special || s5iAlign(x.alignment) + (x.chance ? ` (${x.chance}%)` : '')).join(' or ');
  if (a.includes('A')) return 'Any Alignment';
  if (a.includes('U')) return 'Unaligned';
  if (a.length === 1 && a[0] === 'N') return 'Neutral';
  if (a.length > 2) { const ax = a.filter(x => ['L', 'NX', 'C'].includes(x)), ay = a.filter(x => ['G', 'NY', 'E'].includes(x)); if (ax.length === 3 && ay.length === 1) return 'Any ' + S5I_ALIGN[ay[0]]; if (ay.length === 3 && ax.length === 1) return 'Any ' + S5I_ALIGN[ax[0]]; if (!a.includes('E') && a.length === 5) return 'Any Non-Evil'; if (!a.includes('G') && a.length === 5) return 'Any Non-Good'; return 'Any Alignment'; }
  return a.map(x => S5I_ALIGN[x] || x).join(' ');
}
function s5iType(t) {
  if (!t) return '';
  if (typeof t === 'string') return s5iCap(t);
  const base = typeof t.type === 'object' ? (t.type.choose || []).map(s5iCap).join(' or ') : s5iCap(t.type);
  if (t.swarmSize) return `Swarm of ${S5I_SIZE[t.swarmSize] || ''} ${base}s`;
  return base + (t.tags && t.tags.length ? ` (${t.tags.map(x => typeof x === 'string' ? s5iCap(x) : s5iCap((x.prefix ? x.prefix + ' ' : '') + x.tag)).join(', ')})` : '');
}
function s5iSpeed(sp) {
  if (!sp) return '';
  const v = x => typeof x === 'object' ? `${x.number} ft.${x.condition ? ' ' + x.condition.replace(/\{@\w+\s*([^{}|]*)[^{}]*\}/g, '$1') : ''}` : x === true ? '' : `${x} ft.`;
  const out = [];
  if (sp.walk != null) out.push(v(sp.walk));
  for (const k of ['burrow', 'climb', 'fly', 'swim']) if (sp[k] != null) out.push(`${s5iCap(k)} ${v(sp[k])}`);
  const s = out.join(', ');
  return s + (sp.canHover && !/hover/.test(s) ? ' (hover)' : '');
}
function s5iSpellcasting(sc) {
  const lines = [];
  if (sc.will) lines.push(`<b>At Will:</b> ${sc.will.map(s5iText).join(', ')}`);
  for (const [k, list] of Object.entries(sc.daily || {})) lines.push(`<b>${k.replace('e', '')}/Day${k.endsWith('e') ? ' Each' : ''}:</b> ${list.map(s5iText).join(', ')}`);
  for (const [lvl, o] of Object.entries(sc.spells || {})) lines.push(`<b>${lvl === '0' ? 'Cantrips (at will)' : s5iOrd(+lvl) + ' level' + (o.slots ? ` (${o.slots} slot${o.slots === 1 ? '' : 's'})` : '')}:</b> ${(o.spells || []).map(s5iText).join(', ')}`);
  for (const [k, list] of Object.entries(sc.recharge || {})) lines.push(`<b>Recharge ${k}:</b> ${list.map(s5iText).join(', ')}`);
  return { name: s5iText(sc.name || 'Spellcasting').replace(/<[^>]+>/g, ''), html: s5iInline(sc.headerEntries || []) + (sc.footerEntries ? ' ' + s5iInline(sc.footerEntries) : ''), spells: lines };
}
function s5iMonster(m, src) {
  if (!m || !m.name || m._copy) return null;
  const ab = { str: m.str ?? 10, dex: m.dex ?? 10, con: m.con ?? 10, int: m.int ?? 10, wis: m.wis ?? 10, cha: m.cha ?? 10 };
  const crRaw = m.cr == null ? '—' : typeof m.cr === 'object' ? m.cr.cr : String(m.cr);
  const pb = s5iPB(crRaw), mod = k => Math.floor((ab[k] - 10) / 2);
  const ac0 = (m.ac || [])[0], acv = typeof ac0 === 'object' ? ac0.ac ?? ac0.special : ac0;
  const acNote = typeof ac0 === 'object' && ac0 ? [(ac0.from || []).map(x => s5iText(x).replace(/<[^>]+>/g, '')).join(', '), ac0.condition ? s5iText(ac0.condition).replace(/<[^>]+>/g, '') : ''].filter(Boolean).join(' ') : '';
  const saves = {}; for (const k of Object.keys(ab)) saves[k] = m.save && m.save[k] ? s5Signed(m.save[k]) : s5Mod(ab[k]).replace('−', '-').replace(/^-/, '−');
  const skills = Object.entries(m.skill || {}).filter(([k]) => k !== 'other').map(([k, v]) => `${s5iCap(k)} ${String(v).replace(/^-/, '−')}`).join(', ');
  const xpN = typeof m.cr === 'object' && m.cr.xp != null ? m.cr.xp : S5I_XP[crRaw] ?? 0;
  const xpL = typeof m.cr === 'object' && m.cr.lair ? (m.cr.xpLair ?? S5I_XP[m.cr.lair]) : null;
  const initMod = m.initiative && typeof m.initiative === 'object' ? (m.initiative.initiative ?? (mod('dex') + pb * (m.initiative.proficiency || 0))) : typeof m.initiative === 'number' ? m.initiative : mod('dex');
  const ability = a => ({ name: s5iText(a.name || '').replace(/<[^>]+>/g, ''), html: s5iInline(a.entries) });
  const bucket = { trait: [], action: [], bonus: [], reaction: [], legendary: [] };
  for (const sc of m.spellcasting || []) (bucket[sc.displayAs || 'trait'] || bucket.trait).push(s5iSpellcasting(sc));
  const immune = [s5iJoinList(m.immune, 'immune'), s5iJoinList(m.conditionImmune, 'conditionImmune')].filter(Boolean).join('; ');
  const senses = [...(m.senses || []).map(x => s5iCap(s5iText(x).replace(/<[^>]+>/g, '')).replace(/ Ft\./g, ' ft.')), `Passive Perception ${m.passive ?? 10 + mod('wis')}`];
  const id = s5iSlug(m.name) + '~' + (m.source || src || '').toLowerCase();
  return {
    id, name: m.name, srcCode: (m.source || src || '').toLowerCase(), pg: m.page || '',
    size: (m.size || []).map(x => S5I_SIZE[x] || x).join(' or '), type: s5iType(m.type), alignment: (m.alignmentPrefix ? m.alignmentPrefix : '') + s5iAlign(m.alignment),
    ac: acv ?? '—', acNote, init: s5Signed(initMod).replace('-', '−'), initSrd: !!m.initiative,
    hp: m.hp ? m.hp.average ?? m.hp.special ?? '—' : '—', hpRoll: m.hp && m.hp.formula ? m.hp.formula.replace(/\s*([+-])\s*/g, ' $1 ').replace('-', '−') : '',
    speed: s5iSpeed(m.speed), ab, saves, skills,
    vuln: s5iJoinList(m.vulnerable, 'vulnerable'), resist: s5iJoinList(m.resist, 'resist'), immune,
    senses: senses.join(', ').replace(/, Passive/, '; Passive'), languages: (m.languages || []).map(x => s5iText(x).replace(/<[^>]+>/g, '')).join(', ') || '—',
    gear: (m.gear || []).map(g => s5iText(typeof g === 'string' ? `{@item ${g}}` : g.item ? `{@item ${g.item}}` : '').replace(/<[^>]+>/g, '')).filter(Boolean).join(', '),
    cr: crRaw, crNum: s5CrNum(crRaw) || 0, xp: xpN.toLocaleString('en') + (xpL ? `, or ${xpL.toLocaleString('en')} in lair` : ''), pb: '+' + pb,
    traits: [...(m.trait || []).map(ability), ...bucket.trait], actions: [...(m.action || []).map(ability), ...bucket.action],
    bonus: [...(m.bonus || []).map(ability), ...bucket.bonus], reactions: [...(m.reaction || []).map(ability), ...bucket.reaction],
    legendary: [...(m.legendary || []).map(ability), ...bucket.legendary, ...(m.mythic || []).map(a => ({ ...ability(a), name: 'Mythic: ' + ability(a).name }))],
    group: s5iType(typeof m.type === 'object' ? m.type.type : m.type)
  };
}
// _copy: a monster made from another one plus changes (_mod). Base must be among the imported files.
function s5iApplyCopy(m, index) {
  const c = m._copy, base = index.get((c.name + '|' + (c.source || '')).toLowerCase());
  if (!base) return null;
  const b = base._copy ? s5iApplyCopy(base, index) : base; if (!b) return null;
  const out = JSON.parse(JSON.stringify(b));
  for (const [k, v] of Object.entries(m)) if (k !== '_copy') out[k] = v;
  const mods = c._mod || {};
  const wq = w => w.replace(/"/g, '\\"');   // keep a capital letter at the start of the replaced text ("The toad" -> "The matriarch")
  const txt = (o, re, w) => JSON.parse(JSON.stringify(o).replace(re, m => /^[A-Z]/.test(m) && /^[a-z]/.test(w) ? wq(w[0].toUpperCase() + w.slice(1)) : wq(w)));
  for (const [prop, ops] of Object.entries(mods)) for (const op of [].concat(ops)) {
    if (op === 'remove') { delete out[prop]; continue; }
    const arrProp = prop === '*' ? null : prop;
    if (op.mode === 'replaceTxt') { const re = new RegExp(op.replace, op.flags || 'g'); for (const k of arrProp ? [arrProp] : ['trait', 'action', 'bonus', 'reaction', 'legendary']) if (out[k]) out[k] = txt(out[k], re, op.with); continue; }
    const arr = out[arrProp] = out[arrProp] || [];
    const items = [].concat(op.items || []), nm = x => typeof x === 'string' ? x : x.name;
    if (op.mode === 'appendArr') arr.push(...items);
    else if (op.mode === 'prependArr') arr.unshift(...items);
    else if (op.mode === 'insertArr') arr.splice(op.index || 0, 0, ...items);
    else if (op.mode === 'removeArr') { const rm = [].concat(op.names || op.items || []).map(x => nm(x)); out[arrProp] = arr.filter(x => !rm.includes(nm(x))); }
    else if (op.mode === 'replaceArr') { const i = arr.findIndex(x => nm(x) === (typeof op.replace === 'string' ? op.replace : op.replace?.index != null ? nm(arr[op.replace.index]) : '')); if (i >= 0) arr.splice(i, 1, ...items); else arr.push(...items); }
    else if (op.mode === 'replaceOrAppendArr') { const i = arr.findIndex(x => nm(x) === op.replace); if (i >= 0) arr.splice(i, 1, ...items); else arr.push(...items); }
  }
  delete out._copy;
  return out;
}

// ---- spells ----
function s5iSpell(s, classes, src) {
  const t = (s.time || [])[0] || {};
  const unit = { action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction' }[t.unit];
  const time = unit && t.number === 1 ? unit + (t.condition ? ', which you take ' + s5iText(t.condition).replace(/<[^>]+>/g, '') : '') : `${t.number || ''} ${t.unit || ''}${t.number > 1 ? 's' : ''}`.trim();
  const r = s.range || {}, d = r.distance || {};
  const range = r.type === 'special' ? 'Special' : d.type === 'self' ? 'Self' : d.type === 'touch' ? 'Touch' : d.type === 'sight' ? 'Sight' : d.type === 'unlimited' ? 'Unlimited' :
    r.type === 'point' ? `${d.amount} ${d.type === 'feet' && d.amount === 1 ? 'foot' : d.type}` : `Self (${d.amount}-${d.type === 'feet' ? 'foot' : d.type} ${r.type})`;
  const c = s.components || {}, m = c.m;
  const components = [c.v && 'V', c.s && 'S', m && 'M'].filter(Boolean).join(', ') + (m ? ` (${typeof m === 'object' ? m.text : m === true ? '' : m})` : '');
  const du = (s.duration || [])[0] || {}, dd = du.duration || {};
  const duration = du.type === 'instant' ? 'Instantaneous' : du.type === 'permanent' ? 'Until dispelled' + ((du.ends || []).includes('trigger') ? ' or triggered' : '') : du.type === 'special' ? 'Special' :
    `${du.concentration ? 'Concentration, up to ' : ''}${dd.amount} ${dd.type}${dd.amount > 1 ? 's' : ''}`;
  const ctx = { ids: new Set(), n: 0, monsters: [], src };
  const body = s5iBlocks(s.entries, 2, ctx);
  for (const h of s.entriesHigherLevel || []) { const bl = s5iBlocks(h.entries, 2, ctx); if (bl[0] && bl[0].t === 'p') bl[0].html = `<b><i>${s5iText(h.name || 'At Higher Levels')}.</i></b> ` + bl[0].html; body.push(...bl); }
  return { id: s5iSlug(s.name) + '~' + (s.source || src).toLowerCase(), name: s.name, srcCode: (s.source || src).toLowerCase(), pg: s.page || '', level: s.level, school: S5I_SCHOOL[s.school] || s.school,
    classes, time, range, components, duration, conc: !!du.concentration, ritual: !!(s.meta && s.meta.ritual), body };
}

// ---- classes ----
function s5iClasses(file) {
  const out = [], feats = file.classFeature || [], subFeats = file.subclassFeature || [];
  for (const c of file.class || []) {
    const fname = ref => (typeof ref === 'string' ? ref : ref.classFeature).split('|');
    const findF = ref => { const [name, cls, csrc, lvl, fsrc] = fname(ref); return feats.find(f => f.name === name && f.className === cls && String(f.level) === lvl && (!fsrc || f.source === fsrc) && (!csrc || (f.classSource || f.source) === csrc)) || feats.find(f => f.name === name && f.className === cls && String(f.level) === lvl); };
    const refSub = e => { const [name, cls, csrc, sub, ssrc, lvl] = (e.subclassFeature || '').split('|'); return subFeats.find(f => f.name === name && f.className === cls && f.subclassShortName === sub && String(f.level) === lvl); };
    const refCls = e => { const p = (e.classFeature || '').split('|'); return findF(e.classFeature) || null; };
    const ctx = { ids: new Set(), n: 0, monsters: [], src: c.source, ref: e => e.type === 'refSubclassFeature' ? refSub(e) : e.type === 'refClassFeature' ? refCls(e) : null };
    const hd = c.hd ? `d${c.hd.faces}` : '';
    const prim = (c.primaryAbility || []).map(o => Object.keys(o).map(k => s5iCap({ str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' }[k] || k)).join(' and ')).join(' or ');
    const body = [{ t: 'p', style: 'body', html: [prim && `<b>Primary Ability:</b> ${prim}`, hd && `<b>Hit Point Die:</b> ${hd} per ${esc(c.name)} level`, (c.proficiency || []).length && `<b>Saving Throws:</b> ${(c.proficiency || []).map(x => x.toUpperCase()).join(', ')}`].filter(Boolean).join(' · ') }];
    const levelFeats = Array.from({ length: 20 }, () => []);
    for (const ref of c.classFeatures || []) { const [name, , , lvl] = fname(ref); if (+lvl >= 1 && +lvl <= 20) levelFeats[+lvl - 1].push(name); }
    const groups = c.classTableGroups || [];
    const cols = groups.flatMap(g => (g.colLabels || []).map(l => String(l).replace(/\{@\w+\s*([^{}|]*)[^{}]*\}/g, '$1')));
    const cellv = v => typeof v === 'object' && v ? (v.value != null ? (v.type === 'dice' ? `${v.toRoll?.[0]?.number}d${v.toRoll?.[0]?.faces}` : v.value) : v.toRoll ? `${v.toRoll[0].number}d${v.toRoll[0].faces}` : v.type === 'bonus' ? '+' + v.value : '') : v === 0 ? '—' : v;
    const rows = Array.from({ length: 20 }, (_, i) => [String(i + 1), '+' + (2 + Math.floor(i / 4)), esc(levelFeats[i].join(', ') || '—'), ...groups.flatMap(g => (g.rows || g.rowsSpellProgression || [])[i] || []).map(v => esc(String(cellv(v) ?? '')))]);
    body.push({ t: 'h', lvl: 2, text: `${c.name} Features`, id: 'features' }, { t: 'table', head: ['Level', 'Proficiency Bonus', 'Class Features', ...cols], rows });
    for (const ref of c.classFeatures || []) { const f = findF(ref); if (!f) continue; body.push({ t: 'h', lvl: 3, text: `Level ${f.level}: ${f.name}`, id: s5iSlug(f.name + '-' + f.level) }); body.push(...s5iBlocks(f.entries, 3, ctx)); }
    for (const sc of (file.subclass || []).filter(s => s.className === c.name && s.classSource === c.source)) {
      body.push({ t: 'h', lvl: 2, text: `Subclass: ${sc.name}`, id: s5iSlug('sub-' + sc.shortName) });
      for (const ref of sc.subclassFeatures || []) { const [name, cls, , sub, , lvl] = String(ref).split('|'); const f = subFeats.find(x => x.name === name && x.className === cls && x.subclassShortName === sub && String(x.level) === lvl); if (f) { body.push({ t: 'h', lvl: 3, text: `Level ${f.level}: ${f.name}`, id: s5iSlug(sc.shortName + '-' + f.name + '-' + f.level) }); body.push(...s5iBlocks(f.entries, 3, ctx)); } }
    }
    out.push({ id: s5iSlug(c.name) + '~' + c.source.toLowerCase(), name: c.name, srcCode: c.source.toLowerCase(), hitDie: c.hd ? c.hd.faces : '', primary: prim, subclasses: (file.subclass || []).filter(s => s.className === c.name && s.classSource === c.source).map(s => s.name), body });
  }
  return out;
}

// ---- the importer ----
async function s5ImportFiles(files, progress) {
  const notes = [], parsed = [];
  for (const [i, f] of files.entries()) {
    progress(`Reading ${f.name} (${i + 1} of ${files.length})…`, i / files.length * 0.5);
    if (!/\.json$/i.test(f.name)) { notes.push(`${f.name}: not a JSON file, skipped`); continue; }
    try { parsed.push({ name: f.name, data: JSON.parse(await f.text()) }); } catch (e) { notes.push(`${f.name}: could not be read (${e.message})`); }
  }
  const sources = parsed.find(p => /^sources\.json$/i.test(p.name))?.data || {};
  // every raw monster in the batch, for _copy
  const index = new Map(); for (const p of parsed) for (const m of p.data.monster || []) index.set((m.name + '|' + (m.source || '')).toLowerCase(), m);
  const packs = [];
  const kindTitle = { adventure: 'Adventure', book: 'Book', bestiary: 'Monsters', spells: 'Spells', classes: 'Classes' };
  const newPack = (src, kind) => ({ id: `imp-5et-${s5iSlug(src)}-${kind}`, title: `${src} — ${kindTitle[kind]}`, kind: kind === 'adventure' ? 'adventure' : kind === 'bestiary' ? 'bestiary' : kind === 'book' ? 'book' : 'supplement', source: src, chapters: [], monsters: [], abilities: [], format: '5etools' });
  const AUX = /^(index|fluff-index|sources|foundry)\.json$|^fluff-/i;   // support files: used above (sources.json) or ignored
  for (const [i, { name, data }] of parsed.entries()) {
    if (AUX.test(name)) continue;
    progress(`Converting ${name}…`, 0.5 + i / parsed.length * 0.5); await new Promise(r => setTimeout(r, 0));
    if (data.adventureData || data.bookData) {
      for (const a of data.adventureData || data.bookData) {
        const kind = data.adventureData ? 'adventure' : 'book', p = newPack(a.source || a.id || name, kind), ctx = { ids: new Set(), n: 0, monsters: [], src: a.source };
        p.chapters = (a.data || []).map((sec, k) => ({ id: s5iSlug(sec.name || 'chapter-' + (k + 1)) + '-' + k, title: (sec.name || `Chapter ${k + 1}`).replace(/\{@\w+\s*([^{}|]*)[^{}]*\}/g, '$1'), blocks: s5iBlocks(sec.entries, 1, ctx) }));
        p.monsters = ctx.monsters; packs.push(p);
      }
    } else if (data.monster) {
      const src = data.monster.find(m => m.source)?.source || name.replace(/^bestiary-|\.json$/g, '').toUpperCase(), p = newPack(src, 'bestiary');
      let skipped = 0;
      for (const raw of data.monster) {
        const m = s5iMonster(raw._copy ? s5iApplyCopy(raw, index) : raw, src);
        if (m) p.monsters.push(m); else skipped++;
      }
      if (skipped) notes.push(`${name}: ${skipped === 1 ? '1 monster is' : skipped + ' monsters are'} based on a monster that isn't in these files and ${skipped === 1 ? 'was' : 'were'} skipped (import that bestiary together with this one)`);
      p.monsters.sort((a, b) => a.name.localeCompare(b.name));
      const letters = [...new Set(p.monsters.map(m => m.name[0].toUpperCase()))];
      p.chapters = letters.map(L => ({ id: L.toLowerCase(), title: `Monsters: ${L}`, blocks: p.monsters.filter(m => m.name[0].toUpperCase() === L).flatMap(m => [{ t: 'h', lvl: 2, text: m.name, id: s5iSlug(m.id) }, { t: 'monster', ref: m.id }]) }));
      for (const m of p.monsters) m.ch = m.name[0].toLowerCase();
      if (p.monsters.length) packs.push(p);
    } else if (data.spell) {
      const src = data.spell.find(s => s.source)?.source || name.replace(/^spells-|\.json$/g, '').toUpperCase(), p = newPack(src, 'spells');
      p.entities = { spells: data.spell.map(s => s5iSpell(s, [...new Set(((sources[s.source] || {})[s.name]?.class || []).filter(c => !c.definedInSource).map(c => c.name))].sort(), src)) };
      if (!Object.keys(sources).length) notes.push(`${name}: add sources.json from the same folder to see which classes can cast each spell`);
      packs.push(p);
    } else if (data.class) {
      const p = newPack(data.class[0].source + ' ' + data.class[0].name, 'classes');
      p.id = `imp-5et-class-${s5iSlug(data.class[0].name)}`; p.title = `${data.class[0].name} (class)`;
      p.entities = { classes: s5iClasses(data) }; packs.push(p);
    } else if (!/^(index|fluff-index|sources|foundry)\.json$|^fluff-/i.test(name)) notes.push(`${name}: no adventure, book, monsters, spells or class found, skipped`);
  }
  // two files must never become the same book (one would silently replace the other)
  const seen = new Set();
  for (const p of packs) { if (seen.has(p.id)) { let k = 2; while (seen.has(p.id + '-' + k)) k++; p.id += '-' + k; p.title += ` (${k})`; } seen.add(p.id); }
  progress('Done', 1);
  return { packs, notes };
}

// ================= 5e cards: magic items, spells, 5e quest rewards (SYS.cards) =================
// The core card generator (cards.js) does styles, icons, the deck, PDF and QR codes; this adds the
// 5e card kinds. Cards draw from the SRD and from imported books (spells and classes in the lists).

const S5C_RARITY = { Common: '#6b6b6b', Uncommon: '#3d7a4a', Rare: '#2d5f8a', 'Very Rare': '#6b3fa0', Legendary: '#c2531f', Artifact: '#a8322d', 'Rarity Varies': '#555555' };
const S5C_SCHOOL = { Abjuration: '#2d5f8a', Conjuration: '#a87a1e', Divination: '#2a7f7a', Enchantment: '#b0406f', Evocation: '#c2531f', Illusion: '#6b3fa0', Necromancy: '#3b4a63', Transmutation: '#5b6b2e' };
const S5C_ICONS = {
  'Wondrous Items': 'gi:swap-bag', 'Wondrous Item': 'gi:swap-bag', Weapons: 'gi:broadsword', Weapon: 'gi:broadsword', Armor: 'gi:breastplate', Potion: 'gi:potion-ball', Potions: 'gi:potion-ball',
  Ring: 'gi:diamond-ring', Rings: 'gi:diamond-ring', Rod: 'gi:orb-wand', Rods: 'gi:orb-wand', Scroll: 'gi:scroll-unfurled', Scrolls: 'gi:scroll-unfurled', Staff: 'gi:wizard-staff', Staffs: 'gi:wizard-staff',
  Wand: 'gi:crystal-wand', Wands: 'gi:crystal-wand', Ammunition: 'gi:arrow-cluster',
  Abjuration: 'gi:magic-shield', Conjuration: 'gi:magic-portal', Divination: 'gi:third-eye', Enchantment: 'gi:charm', Evocation: 'gi:fireball', Illusion: 'gi:invisible', Necromancy: 'gi:dread-skull', Transmutation: 'gi:transform'
};
// card text: keep <b>, <i>, <br>; links and dice buttons become plain text; tables become lines
const s5cClean = h => String(h || '').replace(/<(?!\/?(b|i|br)\b)[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const s5cParas = blocks => (blocks || []).flatMap(b => b.t === 'p' || b.t === 'li' ? [(b.t === 'li' ? '• ' : '') + s5cClean(b.html)] : b.t === 'table' ? [(b.head.length ? '<b>' + b.head.map(esc).join(' · ') + '</b><br>' : '') + b.rows.map(r => r.map(s5cClean).join(' · ')).join('<br>')] : b.t === 'h' ? [`<b>${esc(b.text)}</b>`] : []).filter(Boolean);
const s5cSrc = e => e.pack ? (PK[e.pack]?.title || '') + (e.pg ? ' p. ' + e.pg : '') : 'SRD 5.2';

function s5cItemCard(it) {
  return { name: it.name, sub: s5EntityMeta('items', it), keywords: '', paras: s5cParas(it.body), color: S5C_RARITY[s5Rarity(it)] || '#555555', back: 'Magic Item', foot: s5cSrc(it), hint: it.type };
}
function s5cSpellCard(s) {
  const meta = `<b>Casting Time:</b> ${esc(s.time)}${s.ritual ? ' or Ritual' : ''} · <b>Range:</b> ${esc(s.range)} · <b>Components:</b> ${esc(s.components)} · <b>Duration:</b> ${esc(s.duration)}`;
  return { name: s.name, sub: s.level === 0 ? `${s.school} cantrip` : `Level ${s.level} ${s.school}`, keywords: s.classes.join(', '), paras: [meta, ...s5cParas(s.body)], color: S5C_SCHOOL[s.school] || '#555555', back: 'Spell', foot: s5cSrc(s), hint: s.school };
}
const s5cFind = (t, id) => itemsOf(t).find(x => x.id === id);

const S5_CARDS = {
  intro: 'magic items, spells and quests',
  tabs: [['item', 'Magic items'], ['spell', 'Spells'], ['quest', 'Quests']],
  icons: S5C_ICONS,
  rewards: { labels: ['XP', 'Gold', 'Magic Item', 'Other'], hints: { XP: '450', Gold: '250 gp', 'Magic Item': 'Bag of Holding', Other: '' }, defaults: [{ label: 'XP', value: '' }, { label: 'Gold', value: '' }] },
  kinds: {
    item: {
      entry(d) { const it = s5cFind('items', d.id); return it && { label: it.name, kind: s5Rarity(it), c: s5cItemCard(it) }; },
      adder() {
        const rar = [...new Set(itemsOf('items').map(s5Rarity))].sort((a, b) => S5_RARITY.indexOf(a) - S5_RARITY.indexOf(b));
        return `<div class="cardadd"><div class="csearch">${ico('search', 16)}<input id="c5-q" placeholder="Search ${itemsOf('items').length} magic items…" autocomplete="off"><div id="c5-qres" class="cqres"></div></div>
          <select id="c5-all"><option value="">Add all of a rarity…</option>${rar.map(r => `<option>${esc(r)}</option>`).join('')}</select></div>`;
      },
      wire(re) {
        s5cSearch('items', 'item', it => `${s5Rarity(it)} · ${it.type}`, it => S5C_RARITY[s5Rarity(it)], it => it.type);
        $('#c5-all').onchange = e => { const r = e.target.value; if (!r) return; itemsOf('items').filter(it => s5Rarity(it) === r).forEach(it => { if (!CARDS.deck.some(x => x.k === 'item' && x.id === it.id)) CARDS.deck.push({ k: 'item', id: it.id, n: 1 }); }); re(); };
      }
    },
    spell: {
      entry(d) { const s = s5cFind('spells', d.id); return s && { label: s.name, kind: s.level === 0 ? 'Cantrip' : 'Level ' + s.level, c: s5cSpellCard(s) }; },
      adder() {
        const sp = itemsOf('spells'), cls = [...new Set(sp.flatMap(s => s.classes))].sort();
        return `<div class="cardadd"><div class="csearch">${ico('search', 16)}<input id="c5-q" placeholder="Search ${sp.length} spells…" autocomplete="off"><div id="c5-qres" class="cqres"></div></div>
          <select id="c5-cls"><option value="">Class…</option>${cls.map(c => `<option>${esc(c)}</option>`).join('')}</select>
          <select id="c5-lvl"><option value="">Level…</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => `<option value="${l}">${l === 0 ? 'Cantrips' : 'Level ' + l}</option>`).join('')}</select><button class="btn ghost" id="c5-addcl">Add all</button></div>`;
      },
      wire(re) {
        s5cSearch('spells', 'spell', s => (s.level === 0 ? 'Cantrip' : 'Level ' + s.level) + ' · ' + s.school + (s.pack ? ' · ' + (PK[s.pack]?.title || '') : ''), s => S5C_SCHOOL[s.school], s => s.school);
        $('#c5-addcl').onclick = () => {
          const c = $('#c5-cls').value, l = $('#c5-lvl').value;
          if (!c && l === '') { toast('Pick a class, a level, or both'); return; }
          const pick = itemsOf('spells').filter(s => (!c || s.classes.includes(c)) && (l === '' || s.level === +l));
          const seen = new Set(); pick.forEach(s => { if (seen.has(s.name)) return; seen.add(s.name); if (!CARDS.deck.some(x => x.k === 'spell' && x.id === s.id)) CARDS.deck.push({ k: 'spell', id: s.id, n: 1 }); });
          toast(`Added ${seen.size} spell card${seen.size === 1 ? '' : 's'}`); re();
        };
      }
    }
  }
};
// search box shared by both kinds (same behaviour as Draw Steel's treasure search)
function s5cSearch(type, kind, sub, color, hint) {
  const cq = $('#c5-q'); if (!cq) return;
  const show = () => {
    const q = cq.value.trim().toLowerCase(), box = $('#c5-qres'); if (!q) { box.innerHTML = ''; box.classList.remove('on'); return; }
    const hits = itemsOf(type).filter(x => x.name.toLowerCase().includes(q)).sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name)).slice(0, 12);
    box.innerHTML = hits.map(x => `<button data-add5c="${esc(x.id)}"><span class="cd-ic" style="--cc:${color(x) || '#555'}">${iconSvg(autoIcon({ name: x.name, hint: hint(x) }))}</span><b>${esc(x.name)}</b><small>${esc(sub(x))}</small>${CARDS.deck.some(d => d.k === kind && d.id === x.id) ? '<em>in deck</em>' : ''}</button>`).join('') || '<div class="empty">No match.</div>';
    box.classList.add('on');
    $$('[data-add5c]', box).forEach(b => b.onmousedown = e => { e.preventDefault(); addToDeck(kind, b.dataset.add5c); saveCards(); cardsPage(); setTimeout(() => { const n = $('#c5-q'); if (n) { n.value = cq.value; n.focus(); n.dispatchEvent(new Event('input')); } }, 0); });
  };
  cq.oninput = show; cq.onfocus = show; cq.onblur = () => setTimeout(() => $('#c5-qres')?.classList.remove('on'), 150);
  cq.onkeydown = e => { if (e.key === 'Enter') { const f = $('#c5-qres [data-add5c]'); if (f) f.dispatchEvent(new MouseEvent('mousedown')); } if (e.key === 'Escape') { cq.value = ''; show(); } };
}

// Registers 5e (SRD 5.2) with the core. Loaded last of the srd5 files (SYSTEM_FILES in mksite.py).
// Tools (encounter builder, initiative, dice, session items): s5-tools.js. Cards: s5-cards.js.
// Importer for your own books (JSON files in the 5etools data format): s5-import.js.
registerSystem({
  id: 'srd5', name: '5e (SRD 5.2)', short: '5e',
  data: { file: 'data/srd5.json', loading: 'Loading the SRD 5.2 rules…' },
  init: s5Init,
  corePack: () => ({ id: 'srd52', title: 'SRD 5.2 Reference', kind: 'core', builtin: true, chapters: D.book, monsters: [], abilities: [] }),
  builtin: [{ id: 'srd5-monsters', file: 'data/srd5-monsters.json', title: 'SRD 5.2 Monsters', kind: 'bestiary' }],
  lists: S5_LISTS,
  menu: s5Menu, home: s5Home, browse: s5Browse,
  routes: { encounter: () => s5EncounterPage(), initiative: () => s5InitiativePage(), imports: () => s5ImportsPage() },
  packRoutes: ['monsters', 'encounter', 'initiative', 'imports'],
  roller: { title: 'Dice', html: S5_DICE_HTML, mount: s5MountRoller },
  session: S5_SESSION,
  onClick: e => s5FindClick(e) || s5OnClick(e),
  cards: S5_CARDS,
  renderBlock: s5RenderBlock,
  packSummary: s5PackSummary,
  renderMonster: s5RenderMonster,
  entityMeta: s5EntityMeta, entitySource: s5EntitySource, preview: s5Preview,
  pinGroups: [
    { type: 'monsters', title: ms => `Monsters · ${ms.reduce((s, m) => s + s5Num(m.xp), 0).toLocaleString('en')} XP total`, render: m => s5RenderMonster(m) },
    { type: 'spells', title: () => 'Spells', render: s => s5SpellCard(s) }
  ],
  linkTypes: ['conditions'],
  noLink: '.s5-n,.s5-spl,.s5iname',
  searchExtra: s5SearchExtra,
  searchPriority: { conditions: 0, classes: 0, spells: 1, species: 1, monsters: 2, items: 2, feats: 2, backgrounds: 2, equipment: 3 },
  importer: { run: s5ImportFiles, accept: '.json,application/json', label: 'Import files', noun: 'books',
    intro: 'Add your own 5e books, adventures, bestiaries, spells and classes from JSON files in the 5etools data format. Monsters become stat blocks, adventures become readable books with read-aloud boxes and stat blocks in place, and spells and classes join the lists.',
    hint: 'JSON files or a whole folder: bestiary-, adventure-, book-, spells- (with sources.json) and class- files' },
  pdfNotice: 'Includes SRD 5.2 material by Wizards of the Coast LLC, licensed CC BY 4.0 (creativecommons.org/licenses/by/4.0)',
  notice: S5_ATTRIB,
  syncWhat: 'sessions, encounters, initiative, cards, pins, settings'
});


// ================= PRINTING: shared PDF writer, file delivery, markdown (system sheets live in systems/*) =================
// ---------- pdf-lib, WinAnsi text and file delivery (moved from enc.js: used by every PDF) ----------
let PDFLib = null;
async function loadPdfLib() { if (!PDFLib) PDFLib = await import('./lib/pdf-lib.esm.min.js'); return PDFLib; }
const WINANSI_OK = /[ -~ -ÿ’‘“”–—•…×€™]/;
async function deliverFile(filename, blob) {
  let dl = null;
  try { dl = window.claude && window.claude.use ? await Promise.race([window.claude.use('downloads'), new Promise(r => setTimeout(() => r(null), 4000))]) : null; } catch (e) { dl = null; }
  if (dl) {
    try { const r = await dl.save({ filename, data: blob }); toast(r.status === 'delivered' ? 'Sent' : 'PDF saved'); return; }
    catch (e) { if (e && e.code === 'declined') { toast('Download cancelled'); return; } if (e && e.code === 'rate_limited') { toast('A save prompt is already open'); return; } }
  }
  // outside claude.ai: plain browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('PDF ready');
  window.__lastPdf = blob;
}

const PSAN = s => [...String(s ?? '').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/−/g, '-').replace(/[   ]/g, ' ').replace(/[★☆]/g, '*').replace(/[✓✔]/g, 'v')].map(c => WINANSI_OK.test(c) ? c : (c === '\n' ? ' ' : '?')).join('');
const decEnt = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
async function makeWriter(title, o = {}) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = o.doc || await PDFDocument.create();
  if (!o.doc) { doc.setTitle(PSAN(title)); doc.setCreator('Vanadium'); }
  const w = { doc, rgb, title, W: 595.28, H: 841.89, MG: 36, page: null, y: 0, pages: 0, footer: o.footer !== false };
  w.CW = w.W - 2 * w.MG;
  w.F = await doc.embedFont(StandardFonts.Helvetica); w.FB = await doc.embedFont(StandardFonts.HelveticaBold);
  w.FI = await doc.embedFont(StandardFonts.HelveticaOblique); w.FBI = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  w.TI = await doc.embedFont(StandardFonts.TimesRomanItalic);
  w.TR = await doc.embedFont(StandardFonts.TimesRoman); w.TB = await doc.embedFont(StandardFonts.TimesRomanBold); w.TBI = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  w.ink = rgb(0.1, 0.1, 0.1); w.grey = rgb(0.45, 0.45, 0.45); w.light = rgb(0.92, 0.92, 0.92); w.dark = rgb(0.17, 0.16, 0.15); w.cream = rgb(0.97, 0.95, 0.92); w.accent = rgb(0.85, 0.42, 0.2);
  w.tw = (s, size, font = w.F) => font.widthOfTextAtSize(PSAN(s), size);
  w.T = (s, x, y, size = 9, font = w.F, color = w.ink) => w.page.drawText(PSAN(s), { x, y, size, font, color });
  w.newPage = () => { w.page = doc.addPage([w.W, w.H]); w.y = w.H - w.MG; w.pages++; if (w.footer) w.T(`${w.title} · Vanadium · ${SYS.pdfNotice}`, w.MG, 18, 6.5, w.F, w.grey); };
  w.ensure = h => { if (!w.page || w.y - h < w.MG + 14) w.newPage(); };
  w.box = (x, y, bw, bh, o = {}) => w.page.drawRectangle({ x, y, width: bw, height: bh, borderColor: o.border || w.ink, borderWidth: o.bw ?? 0.7, ...(o.fill ? { color: o.fill } : {}) });
  w.fill = (x, y, bw, bh, color) => w.page.drawRectangle({ x, y, width: bw, height: bh, color });
  w.cb = (x, y, s = 8, filled) => w.page.drawRectangle({ x, y, width: s, height: s, borderColor: w.ink, borderWidth: 0.7, ...(filled ? { color: w.ink } : {}) });
  w.circ = (x, y, r, o = {}) => w.page.drawCircle({ x, y, size: r, borderColor: o.border || w.ink, borderWidth: o.bw ?? 0.8, ...(o.fill ? { color: o.fill } : {}) });
  w.line = (x1, y1, x2, y2, t = 0.5, color = w.grey) => w.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color });
  // html (b/i/strong/em/code/a) -> tokens
  w.tokens = (html, base = {}) => {
    const out = []; let b = base.b ? 1 : 0, i = base.i ? 1 : 0, space = false;
    const re = /<(\/?)(b|i|strong|em)\b[^>]*>|<br\s*\/?>|<[^>]+>|([^<]+)/g; let m;
    while ((m = re.exec(String(html || '')))) {
      if (m[2]) { const d = m[1] ? -1 : 1; if (m[2] === 'b' || m[2] === 'strong') b = Math.max(0, b + d); else i = Math.max(0, i + d); continue; }
      if (/^<br/i.test(m[0])) { out.push({ br: true }); space = false; continue; }
      if (!m[3]) continue;
      for (const part of decEnt(m[3]).split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { space = true; continue; }
        const FS = base.times ? { r: w.TR, b: w.TB, i: w.TI, bi: w.TBI } : { r: w.F, b: w.FB, i: base.serif ? w.TI : w.FI, bi: w.FBI };
        out.push({ t: part, f: b && i ? FS.bi : b ? FS.b : i ? FS.i : FS.r, sp: space && out.length > 0 }); space = false;
      }
    }
    return out;
  };
  w.layout = (html, o = {}) => {
    const size = o.size || 9.5, width = o.width || w.CW; const toks = w.tokens(html, o);
    const lines = []; let cur = [], cw = 0;
    for (const t of toks) {
      if (t.br) { lines.push(cur); cur = []; cw = 0; continue; }
      const tw = t.f.widthOfTextAtSize(PSAN(t.t), size), sw = t.sp && cur.length ? w.F.widthOfTextAtSize(' ', size) : 0;
      if (cw + sw + tw > width && cur.length) { lines.push(cur); cur = [{ ...t, sp: false, w: tw }]; cw = tw; }
      else { cur.push({ ...t, sp: !!(t.sp && cur.length), w: tw }); cw += sw + tw; }
    }
    if (cur.length) lines.push(cur);
    return lines;
  };
  w.flow = (html, o = {}) => { // draws wrapped text at w.y with page breaks; returns lines drawn
    const size = o.size || 9.5, lead = size * (o.lead || 1.35), x0 = o.x ?? w.MG; const lines = w.layout(html, o);
    for (const ln of lines) {
      w.ensure(lead + 2);
      let x = x0; const yy = w.y - size;
      for (const t of ln) { if (t.sp) x += w.F.widthOfTextAtSize(' ', size); w.page.drawText(PSAN(t.t), { x, y: yy, size, font: t.f, color: o.color || w.ink }); x += t.w; }
      w.y -= lead;
    }
    return lines.length;
  };
  w.height = (html, o = {}) => w.layout(html, o).length * (o.size || 9.5) * (o.lead || 1.35);
  w.header = (title, sub, right) => {
    w.ensure(70); const top = w.y + w.MG - 2;
    w.fill(0, top - 60, w.W, 60, w.dark);
    let ts = 20; while (w.tw(title, ts, w.FB) > w.CW - (right ? w.tw(right, 10, w.FB) + 20 : 0) && ts > 11) ts -= 1;
    w.T(title, w.MG, top - 32, ts, w.FB, w.rgb(1, 1, 1));
    if (sub) w.T(sub, w.MG, top - 48, 8.5, w.F, w.rgb(0.85, 0.85, 0.85));
    if (right) w.T(right, w.W - w.MG - w.tw(right, 10, w.FB), top - 32, 10, w.FB, w.rgb(0.95, 0.6, 0.35));
    w.y = top - 76;
  };
  w.h = (text, lvl = 2, note) => {
    const size = lvl <= 1 ? 15 : lvl === 2 ? 12 : lvl === 3 ? 10.5 : 9.5;
    w.ensure(size + 26); w.y -= lvl <= 2 ? 6 : 3;
    w.T(lvl <= 2 ? String(text).toUpperCase() : text, w.MG, w.y - size, size, w.FB, lvl <= 2 ? w.ink : w.ink);
    if (note) w.T(note, w.MG + w.tw(lvl <= 2 ? String(text).toUpperCase() : text, size, w.FB) + 8, w.y - size, 7.5, w.F, w.grey);
    w.y -= size + (lvl <= 2 ? 4 : 3);
    if (lvl <= 2) { w.line(w.MG, w.y, w.MG + w.CW, w.y, 0.8, w.accent); w.y -= 6; }
  };
  w.para = (html, o = {}) => { w.flow(html, o); w.y -= o.after ?? 4; };
  w.quote = (html) => { const h = w.height(html, { size: 10, width: w.CW - 16, serif: true, i: true }) + 8; w.ensure(Math.min(h, 120)); const top = w.y; w.y -= 4; w.flow(html, { size: 10, width: w.CW - 16, x: w.MG + 12, i: true, serif: true }); const bot = w.y - 2; if (top - bot < 600) { w.fill(w.MG, bot, 3, top - bot, w.rgb(0.79, 0.64, 0.29)); } w.y -= 6; };
  w.bullet = (html, o = {}) => { const ind = o.indent || 0, mark = o.mark || '•'; w.ensure(14); w.T(mark, w.MG + ind + 2, w.y - (o.size || 9.5), o.size || 9.5, w.FB); w.flow(html, { size: o.size || 9.5, width: w.CW - ind - 14, x: w.MG + ind + 14 }); w.y -= 2; };
  w.checkItem = (html, checked, o = {}) => { w.ensure(14); w.cb(w.MG + 2, w.y - 9, 8, checked); w.flow(html, { size: o.size || 9.5, width: w.CW - 16, x: w.MG + 16 }); w.y -= 3; };
  w.writeLines = (n, gap = 18, x = w.MG, width = w.CW) => { for (let k = 0; k < n; k++) { w.ensure(gap); w.y -= gap; w.line(x, w.y, x + width, w.y, 0.4, w.rgb(0.78, 0.78, 0.78)); } w.y -= 4; };
  w.table = (head, rows, widths, o = {}) => {
    const size = o.size || 8.5, pad = 4; const tot = widths.reduce((a, b) => a + b, 0); const ws = widths.map(x => x / tot * w.CW);
    const rowH = r => Math.max(...r.map((c, k) => w.height(c, { size, width: ws[k] - 2 * pad }))) + 2 * pad;
    const drawRow = (r, hdr) => { const h = Math.max(o.minH || 0, rowH(r)); w.ensure(h); let x = w.MG; r.forEach((c, k) => { w.box(x, w.y - h, ws[k], h, { bw: 0.5, border: w.grey, ...(hdr ? { fill: w.light } : {}) }); const sy = w.y; w.y -= pad - 1; w.flow(hdr ? `<b>${c}</b>` : c, { size, width: ws[k] - 2 * pad, x: x + pad }); w.y = sy; x += ws[k]; }); w.y -= h; };
    if (head) drawRow(head, true);
    for (const r of rows) drawRow(r);
    w.y -= 8;
  };
  w.bytes = () => doc.save();
  return w;
}
async function mergePdfs(parts, title) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create(); out.setTitle(PSAN(title)); out.setCreator('Vanadium');
  for (const bytes of parts) { const src = await PDFDocument.load(bytes); const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach(p => out.addPage(p)); }
  return out.save();
}
const pdfFileName = (s, suffix) => (s || 'vanadium').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + (suffix ? '-' + suffix : '') + '.pdf';
async function runPdfJob(btn, label, fn) {
  const old = btn ? btn.innerHTML : ''; if (btn) { btn.disabled = true; btn.textContent = 'Building PDF…'; }
  try { await fn(); } catch (e) { console.error(e); toast('PDF export failed: ' + esc(e.message || e)); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = old || label; } }
}

// ---------- markdown ----------
function mdInline(s) {
  let t = esc(s);
  const codes = []; t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<b>$1</b>').replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<i>$2</i>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, u) => /^(https?:|#|mailto:)/.test(u) ? `<a href="${u}"${/^#/.test(u) ? '' : ' target="_blank" rel="noopener"'}>${a}</a>` : a);
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return t;
}
function mdBlocks(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n'); const B = []; let para = null, quote = null;
  const flush = () => { if (para) { B.push({ t: 'p', html: mdInline(para.join(' ')) }); para = null; } if (quote) { B.push({ t: 'quote', html: mdInline(quote.join(' ')) }); quote = null; } };
  for (let i = 0; i < L.length; i++) {
    const ln = L[i]; let m;
    if (/^```/.test(ln)) { flush(); const code = []; for (i++; i < L.length && !/^```/.test(L[i]); i++) code.push(L[i]); B.push({ t: 'code', text: code.join('\n') }); continue; }
    if (!ln.trim()) { flush(); continue; }
    if (/^\s*[-*+]\s*$/.test(ln)) { flush(); B.push({ t: 'li', html: '', ind: 0 }); continue; }
    if (/^\s*\d+[.)]\s*$/.test(ln)) { flush(); B.push({ t: 'ol', n: parseInt(ln), html: '', ind: 0 }); continue; }
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { flush(); B.push({ t: 'h', lvl: m[1].length, html: mdInline(m[2]), text: m[2] }); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) { flush(); B.push({ t: 'hr' }); continue; }
    if ((m = ln.match(/^>\s?(.*)$/))) { if (para) flush(); (quote = quote || []).push(m[1]); continue; }
    if ((m = ln.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/))) { flush(); B.push({ t: 'check', done: m[2] !== ' ', html: mdInline(m[3]), ind: m[1].length >= 2 ? 1 : 0 }); continue; }
    if ((m = ln.match(/^(\s*)[-*+]\s+(.*)$/))) { flush(); B.push({ t: 'li', html: mdInline(m[2]), ind: m[1].length >= 2 ? 1 : 0 }); continue; }
    if ((m = ln.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) { flush(); B.push({ t: 'ol', n: +m[2], html: mdInline(m[3]), ind: m[1].length >= 2 ? 1 : 0 }); continue; }
    if (/^\s*\|/.test(ln)) { flush(); const rows = []; for (; i < L.length && /^\s*\|/.test(L[i]); i++) { if (/^\s*\|?\s*:?-{2,}/.test(L[i])) continue; rows.push(L[i].trim().replace(/^\||\|$/g, '').split('|').map(c => mdInline(c.trim()))); } i--; B.push({ t: 'table', head: rows[0] || [], rows: rows.slice(1) }); continue; }
    if (quote) flush();
    (para = para || []).push(ln.trim());
  }
  flush();
  return B;
}
function mdHtml(src) {
  const B = mdBlocks(src); let h = '', list = null;
  const close = () => { if (list) { h += `</${list}>`; list = null; } };
  for (const b of B) {
    const lt = b.t === 'li' || b.t === 'check' ? 'ul' : b.t === 'ol' ? 'ol' : null;
    if (lt !== list) { close(); if (lt) { h += `<${lt}>`; list = lt; } }
    if (b.t === 'h') h += `<h${Math.min(6, b.lvl + 1)}>${b.html}</h${Math.min(6, b.lvl + 1)}>`;
    else if (b.t === 'p') h += `<p>${b.html}</p>`;
    else if (b.t === 'quote') h += `<blockquote class="mdq">${b.html}</blockquote>`;
    else if (b.t === 'li' || b.t === 'ol') h += `<li${b.ind ? ' class="ind"' : ''}>${b.html}</li>`;
    else if (b.t === 'check') h += `<li class="chk${b.ind ? ' ind' : ''}"><span class="cbx ${b.done ? 'on' : ''}"></span>${b.html}</li>`;
    else if (b.t === 'hr') h += '<hr>';
    else if (b.t === 'code') h += `<pre>${esc(b.text)}</pre>`;
    else if (b.t === 'table') h += `<div class="tblw"><table class="dt"><thead><tr>${b.head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  close();
  return h;
}
async function buildMarkdownPdf(title, src, sub) {
  const w = await makeWriter(title);
  w.newPage(); w.header(title, sub || 'Session notes');
  for (const b of mdBlocks(src)) {
    if (b.t === 'h') w.h(strip(b.html), Math.max(1, b.lvl));
    else if (b.t === 'p') w.para(b.html, { size: 10 });
    else if (b.t === 'quote') w.quote(b.html);
    else if (b.t === 'li') w.bullet(b.html, { indent: b.ind * 14, size: 10 });
    else if (b.t === 'ol') w.bullet(b.html, { indent: b.ind * 14, mark: b.n + '.', size: 10 });
    else if (b.t === 'check') { w.ensure(14); w.cb(w.MG + 2 + b.ind * 14, w.y - 9.5, 8.5, b.done); w.flow(b.html, { size: 10, width: w.CW - 18 - b.ind * 14, x: w.MG + 16 + b.ind * 14 }); w.y -= 3; }
    else if (b.t === 'hr') { w.ensure(14); w.y -= 6; w.line(w.MG, w.y, w.MG + w.CW, w.y, 0.6); w.y -= 8; }
    else if (b.t === 'code') { b.text.split('\n').forEach(l => w.para(esc(l) || ' ', { size: 8.5, after: 0 })); w.y -= 4; }
    else if (b.t === 'table') w.table(b.head, b.rows, b.head.map(() => 1), { size: 8.5 });
  }
  return w.bytes();
}


// ================= SESSIONS =================
// One folder per game night. Pages (markdown) are built in; everything else a session can hold
// comes from the game system (SYS.session.kinds, e.g. Draw Steel encounters, montages,
// negotiations), together with the party fields shown on the overview (SYS.session.party).
let SESSIONS = store.get('sessions', []);
const saveSessions = () => store.set('sessions', SESSIONS);
const sessById = id => SESSIONS.find(s => s.id === id);
const SESS_PAGE = { icon: '📝', label: 'Page' };
const sessKind = t => t === 'page' ? SESS_PAGE : ((SYS.session || {}).kinds || {})[t] || { icon: '•', label: t };
const sessKinds = () => Object.entries((SYS.session || {}).kinds || {});
const today = () => new Date().toISOString().slice(0, 10);
function newSessionObj() {
  const n = SESSIONS.length + 1;
  return { id: 's' + Date.now().toString(36), name: 'Session ' + n, date: today(), ...(SYS.session?.newParty ? SYS.session.newParty() : {}),
    docs: [{ id: 'd' + Date.now().toString(36), type: 'page', title: 'Session plan', md: '# Session ' + n + '\n\n## Recap\n\n- \n\n## Scenes\n\n1. \n\n> Read-aloud text goes in a quote block like this.\n\n## Loose ends\n\n- [ ] \n' }] };
}
function sessionsHub() {
  $('#main').innerHTML = `<div class="neghub"><h1>Sessions</h1>
    <p class="note">One folder per game night. Write notes and read-aloud text in markdown, add the ${esc(SYS.session?.planText || 'material')} you plan to run, and export the whole session as one PDF for the table.</p>
    <div class="negacts"><button class="btn" id="snew">+ New session</button></div>
    ${SESSIONS.length ? `<div class="negg">${SESSIONS.map(s => `<a class="negc sesc" href="#session--${s.id}"><b>${esc(s.name)}</b><span>${esc(s.date || '')} · ${s.docs.length} item${s.docs.length === 1 ? '' : 's'}</span><em>${s.docs.map(d => sessKind(d.type).icon + ' ' + esc(d.title)).slice(0, 4).join(' · ')}${s.docs.length > 4 ? ' …' : ''}</em></a>`).join('')}</div>` : '<div class="empty">No sessions yet.</div>'}</div>`;
  $('#snew').onclick = () => { const s = newSessionObj(); SESSIONS.unshift(s); saveSessions(); go('session--' + s.id + '--' + s.docs[0].id); };
  document.title = 'Sessions — Vanadium';
}
let sessEdit = false;
function sessionPage(sid, did) {
  const S = sessById(sid); if (!S) { go('sessions'); return; }
  if (!PACKS.length) { $('#main').innerHTML = '<div class="empty">Loading…</div>'; return; }
  const d = did ? S.docs.find(x => x.id === did) : null;
  const party = SYS.session?.party || [];
  const nouns = ['page', ...sessKinds().map(([, k]) => k.noun)];
  const nav = `<div class="bk-books"><a class="ch" href="#sessions">← All sessions</a></div>
    <div class="sess-meta"><input id="s-name" value="${esc(S.name)}" aria-label="Session name"><input id="s-date" type="date" value="${esc(S.date || '')}"></div>
    <a class="ch ${!d ? 'cur' : ''}" href="#session--${S.id}">Overview</a>
    ${S.docs.map((x, i) => `<div class="sdoc ${d && d.id === x.id ? 'cur' : ''}"><a href="#session--${S.id}--${x.id}"><span class="di">${sessKind(x.type).icon}</span>${esc(x.title || sessKind(x.type).label)}</a><span class="sdoc-b"><button data-up="${i}" title="Move up">↑</button><button data-dn="${i}" title="Move down">↓</button></span></div>`).join('')}
    <div class="sadd"><b>Add</b><button class="btn ghost sm" data-add="page">📝 Page</button>${sessKinds().map(([t, k]) => `<button class="btn ghost sm" data-add="${t}">${k.addLabel}</button>`).join('')}</div>
    <div class="sadd"><button class="btn" id="s-export">⬇ Export this session</button><button class="btn ghost sm danger" id="s-del">Delete session</button></div>`;
  let main = '';
  if (!d) {
    main = `<h1 class="chap-title">${esc(S.name)}</h1><div class="kind">${esc(S.date || '')}</div>
      ${party.length ? `<div class="party dlgp" style="margin:12px 0">${party.map(f => `<label>${f.label}<input type="number" id="s-${f.id}" min="${f.min}"${f.max != null ? ` max="${f.max}"` : ''} value="${S[f.key]}"></label>`).join('')}</div>
      <p class="note">${SYS.session.partyNote}</p>` : ''}
      <div class="soverview">${S.docs.map(x => `<a class="beitem" href="#session--${S.id}--${x.id}"><b>${sessKind(x.type).icon} ${esc(x.title || sessKind(x.type).label)}</b><span>${sessKind(x.type).label}${sessKind(x.type).summary ? sessKind(x.type).summary(x) : ''}${x.type === 'page' ? ' · ' + (x.md || '').split(/\s+/).filter(Boolean).length + ' words' : ''}</span></a>`).join('') || `<div class="empty">Nothing in this session yet. Add a ${nouns.length > 1 ? nouns.slice(0, -1).join(', ') + ' or ' + nouns[nouns.length - 1] : nouns[0]}.</div>`}</div>
      ${SYS.session?.overviewExtra ? SYS.session.overviewExtra(S) : ''}`;
  } else main = sessDocHtml(S, d);
  $('#main').innerHTML = `<div class="bk sess"><div class="bk-nav" id="bnav">${nav}</div><div class="bk-main" id="bmain">${main}</div>
    <button class="mtoc-btn" id="mtoc"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Session</button></div>`;
  const nv = $('#bnav'); $('#mtoc').onclick = () => { nv.classList.add('on'); showScrim(() => nv.classList.remove('on')); };
  $$('#bnav a').forEach(a => a.addEventListener('click', () => { if (isMob) { nv.classList.remove('on'); hideScrim(); } }));
  $('#s-name').onchange = e => { S.name = e.target.value || 'Session'; saveSessions(); };
  $('#s-date').onchange = e => { S.date = e.target.value; saveSessions(); };
  $$('[data-up],[data-dn]').forEach(b => b.onclick = () => { const i = +(b.dataset.up ?? b.dataset.dn), j = b.dataset.up != null ? i - 1 : i + 1; if (j < 0 || j >= S.docs.length) return; [S.docs[i], S.docs[j]] = [S.docs[j], S.docs[i]]; saveSessions(); sessionPage(sid, did); });
  $$('[data-add]').forEach(b => b.onclick = () => sessAdd(S, b.dataset.add));
  $('#s-export').onclick = () => exportSession(S, $('#s-export'));
  $('#s-del').onclick = async () => { if (await confirmSheet(`Delete “${S.name}” and everything in it?`, 'Delete')) { SESSIONS = SESSIONS.filter(x => x !== S); saveSessions(); go('sessions'); } };
  if (!d) party.forEach(f => { const el = $('#s-' + f.id); el.onchange = () => { S[f.key] = Math.max(f.min, +el.value || 0); saveSessions(); }; });
  if (d) wireSessDoc(S, d);
  document.title = (d ? d.title + ' · ' : '') + S.name + ' — Vanadium';
}
function sessDocHtml(S, d) {
  const top = `<div class="sdoc-top"><input id="d-title" class="encname" value="${esc(d.title)}" aria-label="Title"><div class="negtb">${d.type === 'page' ? `<button class="btn ghost sm" id="d-edit">${sessEdit ? 'Done' : 'Edit'}</button>` : ''}<button class="btn ghost sm" id="d-pdf">PDF</button><button class="btn ghost sm danger" id="d-del">Remove</button></div></div><div class="kind">${sessKind(d.type).label}</div>`;
  if (d.type === 'page') {
    if (sessEdit) return top + `<div class="mdedit"><textarea id="d-md" spellcheck="true">${esc(d.md || '')}</textarea><div class="rd mdprev" id="d-prev">${mdHtml(d.md)}</div></div>
      <p class="note">Markdown: <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>- list</code>, <code>1. list</code>, <code>- [ ] checkbox</code>, <code>&gt; read-aloud</code>, <code>| tables |</code>, <code>---</code>, <code>[link](https://…)</code>.</p>`;
    return top + `<div class="rd mdview">${mdHtml(d.md) || '<p class="note">Empty page. Click Edit to write.</p>'}</div>`;
  }
  const k = sessKind(d.type);
  return k.html ? k.html(S, d, top) : top + `<div class="empty">This item type isn’t available in ${esc(SYS.name)}.</div>`;
}
function wireSessDoc(S, d) {
  const k = sessKind(d.type);
  $('#d-title').onchange = e => { d.title = e.target.value || k.label; if (k.onRename) k.onRename(d); saveSessions(); sessionPage(S.id, d.id); };
  $('#d-del').onclick = async () => { if (await confirmSheet(`Remove “${d.title}” from this session?`, 'Remove')) { S.docs = S.docs.filter(x => x !== d); saveSessions(); go('session--' + S.id); } };
  $('#d-pdf').onclick = () => runPdfJob($('#d-pdf'), 'PDF', async () => { const b = await docPdf(S, d); if (b) await deliverFile(pdfFileName(d.title), new Blob([b], { type: 'application/pdf' })); });
  if ($('#d-edit')) $('#d-edit').onclick = () => { sessEdit = !sessEdit; sessionPage(S.id, d.id); if (sessEdit) setTimeout(() => $('#d-md')?.focus(), 30); };
  const ta = $('#d-md'); let tm;
  if (ta) ta.oninput = () => { d.md = ta.value; clearTimeout(tm); tm = setTimeout(() => { saveSessions(); $('#d-prev').innerHTML = mdHtml(d.md); }, 250); };
  if (k.wire) k.wire(S, d);
}
function pickerSheet(title, items, onPick) { // items: [{id, name, sub, group}]
  const el = document.createElement('div'); el.className = 'dlg';
  const groups = {}; items.forEach(x => (groups[x.group] = groups[x.group] || []).push(x));
  el.innerHTML = `<div class="dlg-b negedit"><h2>${esc(title)}</h2><input id="pk-q" type="search" placeholder="Filter…" style="width:100%;margin-bottom:10px;background:var(--bg);color:var(--ink);border:1px solid var(--line2);border-radius:4px;padding:8px">
    <div>${Object.entries(groups).map(([g, xs]) => `<h3 class="negh" style="margin-top:10px">${esc(g)}</h3>${xs.map(x => `<button class="beitem" data-pk="${esc(x.id)}" data-q="${esc((x.name + ' ' + (x.sub || '')).toLowerCase())}"><b>${esc(x.name)}</b><span>${esc(x.sub || '')}</span></button>`).join('')}`).join('') || '<div class="empty">Nothing to add.</div>'}</div>
    <div class="dlgfoot"><span style="flex:1"></span><button class="btn ghost" id="pk-x">Close</button></div></div>`;
  document.body.appendChild(el);
  $('#pk-x', el).onclick = () => el.remove();
  $('#pk-q', el).oninput = e => { const q = e.target.value.toLowerCase(); $$('.beitem', el).forEach(b => b.style.display = b.dataset.q.includes(q) ? '' : 'none'); };
  $$('[data-pk]', el).forEach(b => b.onclick = () => { el.remove(); onPick(b.dataset.pk); });
  setTimeout(() => $('#pk-q', el).focus(), 30);
}
function sessAdd(S, type) {
  const add = doc => { doc.id = 'd' + Date.now().toString(36); S.docs.push(doc); saveSessions(); if (doc.type === 'page') sessEdit = true; go('session--' + S.id + '--' + doc.id); };
  if (type === 'page') return add({ type: 'page', title: 'New page', md: '# New page\n\n' });
  const k = sessKind(type); if (k.add) k.add(S, add);
}
async function docPdf(S, d) {
  if (d.type === 'page') return buildMarkdownPdf(d.title, d.md, S.name);
  const k = sessKind(d.type); return k.pdf ? k.pdf(S, d) : null;
}
async function exportSession(S, btn) {
  await runPdfJob(btn, '⬇ Export this session', async () => {
    const w = await makeWriter(S.name); w.newPage();
    w.header(S.name, `${S.date || ''}${SYS.session?.partyLine ? ' · ' + SYS.session.partyLine(S) : ''}`, 'Session');
    w.h('Contents', 2);
    const parts = [], skipped = [];
    for (const d of S.docs) { const b = await docPdf(S, d); if (b) parts.push([d, b]); else skipped.push(d.title); }
    const { PDFDocument } = await loadPdfLib();
    let pg = 2;
    for (const [d, b] of parts) { const n = (await PDFDocument.load(b)).getPageCount(); w.ensure(16); w.T(`${sessKind(d.type).label}`, w.MG, w.y - 11, 8.5, w.F, w.grey); w.T(d.title, w.MG + 110, w.y - 11, 10.5, w.FB); w.T('p. ' + pg, w.MG + w.CW - w.tw('p. ' + pg, 10, w.F), w.y - 11, 10, w.F); w.y -= 18; pg += n; }
    if (skipped.length) w.para(`<i>Skipped (empty or unavailable): ${esc(skipped.join(', '))}</i>`, { size: 8 });
    const cover = await w.bytes();
    const out = await mergePdfs([cover, ...parts.map(x => x[1])], S.name);
    await deliverFile(pdfFileName(S.name, 'session'), new Blob([out], { type: 'application/pdf' }));
  });
}



// ================= CARDS: items, quests, followers =================
const CARD_SIZES = { poker: ['Poker (63 × 88 mm)', 63, 88], tarot: ['Tarot (70 × 120 mm)', 70, 120], large: ['Large (89 × 127 mm)', 89, 127] };
const CARD_COL = { quest: '#a87a1e' };   // colours per card kind; systems add theirs (SYS.cards.colors)
let CARDS = store.get('cards', null) || {};
if (!CARDS.deck) CARDS.deck = (CARDS.items || []).map(x => ({ k: 'item', id: x.id, n: x.n }));
delete CARDS.items;
CARDS = { size: 'poker', backs: true, craft: false, tab: 'item', quests: [], followers: [], ...CARDS };
const saveCards = () => store.set('cards', CARDS);
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

function questCard(q) {
  const paras = [];
  if (q.text) q.text.split(/\n+/).forEach(p => paras.push(esc(p)));
  const rw = (q.rewards || []).filter(r => r.value || r.label === 'Other');
  if (rw.length) paras.push('<b>Rewards</b><br>' + rw.map(r => `[] <b>${esc(r.label)}:</b> ${esc(r.value)}`).join('<br>'));
  return { name: q.title || 'Quest', sub: 'Quest' + (q.from ? ' · ' + q.from : ''), keywords: '', paras, color: q.color || CARD_COL.quest, back: 'Quest', check: true, foot: q.source || '' };
}
// ---- icons (game-icons.net CC BY 3.0, Material Design Icons Apache 2.0) ----
const ICON_LIBS = { gi: { name: 'Game icons', n: 4134, credit: 'game-icons.net (CC BY 3.0)' }, mdi: { name: 'Material icons', n: 7636, credit: 'Material Design Icons (Apache 2.0)' } };
const ICONS = {}; const iconLoads = {};
function loadIcons(pre) { if (ICONS[pre]) return Promise.resolve(ICONS[pre]); return iconLoads[pre] || (iconLoads[pre] = getJSON(`data/icons-${pre}.json`).then(d => { ICONS[pre] = d; d.names = Object.keys(d.icons); return d; })); }
const iconDef = ref => { if (!ref) return null; const [pre, name] = ref.split(':'); const L = ICONS[pre]; const v = L && L.icons[name]; return v ? { w: L.w, d: v[0], eo: !!v[1] } : null; };
const iconSvg = (ref, cls = '') => { const d = iconDef(ref); return d ? `<svg class="${cls}" viewBox="0 0 ${d.w} ${d.w}" aria-hidden="true"><path fill="currentColor"${d.eo ? ' fill-rule="evenodd"' : ''} d="${d.d}"/></svg>` : ''; };
const ICON_DEFAULT = { quest: 'gi:scroll-unfurled' };   // systems add theirs (SYS.cards.icons)
const cardIconFor = k => (SYS.cards?.icons || {})[k] || ICON_DEFAULT[k];
const ICON_SYN = { potion: 'potion-ball', elixir: 'potion-ball', draught: 'round-bottom-flask', tonic: 'round-bottom-flask', oil: 'oil-drum', salve: 'round-bottom-flask', ring: 'diamond-ring', amulet: 'gem-pendant', necklace: 'gem-pendant', pendant: 'gem-pendant', cloak: 'cloak', mantle: 'cloak', boots: 'boots', helm: 'visored-helm', helmet: 'visored-helm', crown: 'crown', shield: 'shield', armor: 'breastplate', plate: 'breastplate', mail: 'chain-mail', blade: 'broadsword', sword: 'broadsword', axe: 'battle-axe', hammer: 'war-pick', spear: 'spear-head', bow: 'pocket-bow', dagger: 'bowie-knife', dart: 'dart', staff: 'wizard-staff', wand: 'orb-wand', orb: 'crystal-ball', book: 'spell-book', tome: 'spell-book', scroll: 'scroll-unfurled', map: 'treasure-map', key: 'key', lantern: 'lantern-flame', lamp: 'lantern-flame', bag: 'swap-bag', satchel: 'knapsack', gloves: 'gloves', gauntlet: 'mailed-fist', belt: 'belt', mask: 'mask', coin: 'two-coins', bell: 'ringing-bell', horn: 'hunting-horn', skull: 'skull-crossed-bones', bone: 'bone-knife', eye: 'eye-target', feather: 'feather', heart: 'heart-bottle', egg: 'egg-clutch', seed: 'seedling', flower: 'flower-emblem', fire: 'fire', flame: 'fire', ice: 'ice-cube', snow: 'snowflake-1', storm: 'lightning-storm', lightning: 'lightning-storm', star: 'star-swirl', moon: 'moon', sun: 'sun', chain: 'chain', rope: 'rope-coil', hourglass: 'hourglass', mirror: 'hand-mirror', dust: 'powder', powder: 'powder', bomb: 'unlit-bomb', bead: 'bead', stone: 'stone-pile', gem: 'cut-diamond', crystal: 'crystal-growth', spider: 'spider-alt', dragon: 'dragon-head', wing: 'feathered-wing', blood: 'drop', water: 'water-drop', poison: 'poison-bottle', thorn: 'thorny-vine', smoke: 'smoke-bomb', mead: 'beer-stein', ale: 'beer-stein', wine: 'wine-bottle', food: 'meat', bread: 'sliced-bread' };
function autoIcon(c) {
  const gi = ICONS.gi;
  const words = String(c.name || '').toLowerCase().replace(/[’']s\b/g, '').split(/[^a-z]+/).filter(w => w.length > 2);
  if (gi) {
    for (const w of words) { const sg = w.replace(/s$/, ''); const syn = ICON_SYN[w] || ICON_SYN[sg]; if (syn && gi.icons[syn]) return 'gi:' + syn; }
    for (const w of words.slice().reverse()) { const sg = w.replace(/s$/, ''); if (gi.icons[sg]) return 'gi:' + sg; }
  }
  return cardIconFor(c.hint) || cardIconFor(c.type) || 'gi:sparkles';
}
const CARD_STYLES = { modern: ['Modern', 'Coloured header band, clean white body'], classic: ['Classic', 'Parchment, serif type, ornamental frame'], bold: ['Bold', 'Full-colour card with a big icon'], minimal: ['Ink saver', 'White card, thin coloured frame — cheap to print'] };
const CARD_PALETTE = ['#3d7a4a', '#2d5f8a', '#6b3fa0', '#a8322d', '#a87a1e', '#2a7f7a', '#7a4a2a', '#c2531f', '#b0406f', '#3b4a63', '#5b6b2e', '#1d1d1f'];
const cardKey = d => d.k + ':' + d.id;
function custOf(d) { return (CARDS.custom || {})[cardKey(d)] || {}; }
function deckEntry(d) {
  let e = null;
  if (d.k === 'quest') { const q = CARDS.quests.find(x => x.id === d.id); e = q && { label: q.title, kind: 'Quest', c: questCard(q), obj: q }; if (e) e.c.hint = 'quest'; }
  else { const k = (SYS.cards?.kinds || {})[d.k]; e = k ? k.entry(d) : null; }   // system card kinds (Draw Steel: treasures, followers)
  if (!e) return null;
  const cu = custOf(d), c = e.c;
  if (cu.title) c.name = cu.title; if (cu.sub) c.sub = cu.sub; if (cu.color) c.color = cu.color; if (cu.back) c.back = cu.back;
  c.icon = cu.icon === 'none' ? null : (cu.icon || autoIcon(c));
  return e;
}
const addToDeck = (k, id) => { const ex = CARDS.deck.find(x => x.k === k && x.id === id); if (ex) ex.n++; else CARDS.deck.push({ k, id, n: 1 }); };
function cardHtml(c, n, i) {
  const st = CARDS.style || 'modern';
  const body = `${c.stats ? `<div class="ic-st">${c.stats.map(([l, v]) => `<span><small>${esc(l)}</small>${esc(v)}</span>`).join('')}</div>` : ''}${c.paras.map(p => `<p>${p.replace(/(^|<br>)\[\] /g, '$1<span class="ic-bx"></span>')}</p>`).join('')}`;
  const ic = c.icon ? iconSvg(c.icon) : '';
  return `<div class="icard st-${st}" style="--cc:${c.color}" data-cust="${i}" title="Click to customise">
    <div class="ic-h">${ic ? `<span class="ic-i">${ic}</span>` : ''}<span class="ic-t"><b>${esc(c.name)}</b><small>${esc(c.sub)}</small></span>${c.check ? '<span class="ic-ck"></span>' : ''}</div>
    <div class="ic-b">${st === 'classic' ? '<div class="ic-orn"><i></i><span></span><i></i></div>' : ''}${c.keywords ? `<div class="ic-kw">${esc(c.keywords)}</div>` : ''}${body}${CARDS.watermark !== false && ic ? `<span class="ic-wm">${ic}</span>` : ''}</div>
    ${n > 1 ? `<span class="ic-n">×${n}</span>` : ''}</div>`;
}
// Card kinds: quest cards are built in; a system adds its own (SYS.cards.kinds: Draw Steel treasures,
// followers & retainers), each with a tab, an "add" row and how a deck entry becomes a card.
function cardsPage() {
  const C = SYS.cards || {}, kinds = C.kinds || {};
  if (!ICONS.gi) { $('#main').innerHTML = '<div class="neghub cardsp"><h1>Cards</h1><div class="empty">Loading icons…</div></div>'; loadIcons('gi').then(() => { if (/^#cards/.test(location.hash)) cardsPage(); }).catch(() => { ICONS.gi = { w: 512, icons: {}, names: [] }; cardsPage(); }); return; }
  const rows = CARDS.deck.map((d, i) => ({ d, i, e: deckEntry(d) })).filter(x => x.e);
  const tabList = C.tabs || [['quest', 'Quests']];
  const tab = tabList.some(([k]) => k === CARDS.tab) ? CARDS.tab : tabList[0][0]; const st = CARDS.style || 'modern';
  const tabs = `<div class="seg4 ctabs">${tabList.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-ctab="${k}">${l}</button>`).join('')}</div>`;
  let adder = '';
  if (tab === 'quest') adder = `<div class="cardadd"><button class="btn" id="q-new">+ New quest card</button>${C.questsFromChapter ? '<button class="btn ghost" id="q-adv">Create from adventure…</button>' : ''}
      ${CARDS.quests.length ? `<select id="q-pick"><option value="">Add one of your quests again…</option>${CARDS.quests.map(q => `<option value="${q.id}">${esc(q.title)}</option>`).join('')}</select>` : ''}</div>`;
  else if (kinds[tab]) adder = kinds[tab].adder();
  $('#main').innerHTML = `<div class="neghub cardsp"><h1>Cards</h1>
    <p class="note">Print ${esc(C.intro || 'quests')} as cards. Click any card to change its icon, colour or text.</p>
    ${tabs}${adder}
    <div class="cdesign"><div class="cd-h">Card style</div><div class="cstyles">${Object.entries(CARD_STYLES).map(([k, [l, d]]) => `<button class="cstyle ${st === k ? 'on' : ''}" data-cstyle="${k}"><span class="cs-prev st-${k}"><i></i><em></em><em></em></span><b>${l}</b><small>${d}</small></button>`).join('')}</div>
      <div class="cardopts"><label>Size <select id="c-size">${Object.entries(CARD_SIZES).map(([k, v]) => `<option value="${k}" ${CARDS.size === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
      <label>Text <select id="c-text"><option value="auto" ${(CARDS.text || 'auto') === 'auto' ? 'selected' : ''}>Fit to card</option><option value="large" ${CARDS.text === 'large' ? 'selected' : ''}>Larger (more cards)</option></select></label>
      <label class="row-c"><input type="checkbox" id="c-wm" ${CARDS.watermark !== false ? 'checked' : ''}> Icon watermark</label>
      <label class="row-c"><input type="checkbox" id="c-backs" ${CARDS.backs ? 'checked' : ''}> Print backs</label>
      <label class="row-c"><input type="checkbox" id="c-iback" ${CARDS.iconBack !== false ? 'checked' : ''}> Card icon on back</label>
      ${(() => { const syncOn = window.VSync && VSync.status().enabled; return `<label class="row-c" title="${syncOn ? 'Each card back gets a QR code. Players scan it to get the card as a JPG. The pictures are uploaded to this site and public to anyone with the code.' : 'Needs sync: the card pictures are uploaded with your sync key.'}"><input type="checkbox" id="c-qr" ${CARDS.qr && syncOn ? 'checked' : ''} ${syncOn ? '' : 'disabled'}> QR code on back (JPG for players)${syncOn ? '' : ' · <a href="#sync">needs sync</a>'}</label>`; })()}
      ${C.optionsHtml ? C.optionsHtml() : ''}</div></div>
    <div class="negacts"><button class="btn" id="c-pdf" ${rows.length ? '' : 'disabled'}>Export cards PDF (${rows.reduce((s, x) => s + x.d.n, 0)})</button>${rows.length ? '<button class="btn ghost" id="c-clear">Clear deck</button>' : ''}</div>
    ${rows.length ? `<div class="cdeck">${rows.map(({ d, i, e }) => `<div class="cdeck-r"><button class="cd-ic" data-cicon="${i}" style="--cc:${e.c.color}" title="Change icon">${e.c.icon ? iconSvg(e.c.icon) : '—'}</button><b>${esc(e.c.name)}</b><span>${esc(e.kind)}</span><button class="ibtn" data-cust="${i}" title="Customise">✎</button><div class="step"><button data-cdec="${i}">−</button><b>${d.n}</b><button data-cinc="${i}">+</button></div><button class="ibtn" data-crm="${i}" title="Remove from deck">✕</button></div>`).join('')}</div>
      <div class="cgrid">${rows.map(x => cardHtml(x.e.c, x.d.n, x.i)).join('')}</div>` : '<div class="empty">No cards yet.</div>'}
    <p class="note credit">Icons: <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a> by Lorc, Delapouite and contributors (CC BY 3.0) · <a href="https://pictogrammers.com/library/mdi/" target="_blank" rel="noopener">Material Design Icons</a> (Apache 2.0)</p></div>`;
  const re = () => { saveCards(); cardsPage(); };
  $$('[data-ctab]').forEach(b => b.onclick = () => { CARDS.tab = b.dataset.ctab; re(); });
  $$('[data-cstyle]').forEach(b => b.onclick = () => { CARDS.style = b.dataset.cstyle; re(); });
  if ($('#q-new')) $('#q-new').onclick = () => questEditor(null);
  if ($('#q-adv')) $('#q-adv').onclick = questsFromAdventureDialog;
  if ($('#q-pick')) $('#q-pick').onchange = e => { if (e.target.value) { addToDeck('quest', e.target.value); re(); } };
  if (kinds[tab] && kinds[tab].wire) kinds[tab].wire(re);
  $('#c-size').onchange = e => { CARDS.size = e.target.value; re(); };
  $('#c-text').onchange = e => { CARDS.text = e.target.value; saveCards(); };
  $('#c-wm').onchange = e => { CARDS.watermark = e.target.checked; re(); };
  $('#c-backs').onchange = e => { CARDS.backs = e.target.checked; saveCards(); };
  $('#c-iback').onchange = e => { CARDS.iconBack = e.target.checked; saveCards(); };
  $('#c-qr').onchange = e => { CARDS.qr = e.target.checked; if (CARDS.qr) CARDS.backs = true; re(); };  // QR codes live on the backs
  if (C.wireOptions) C.wireOptions(re);
  if ($('#c-clear')) $('#c-clear').onclick = async () => { if (await confirmSheet('Remove all cards from the deck? (Your quests and followers stay saved.)', 'Clear')) { CARDS.deck = []; re(); } };
  $$('[data-cinc]').forEach(b => b.onclick = () => { CARDS.deck[+b.dataset.cinc].n++; re(); });
  $$('[data-cdec]').forEach(b => b.onclick = () => { const x = CARDS.deck[+b.dataset.cdec]; x.n--; if (x.n <= 0) CARDS.deck.splice(+b.dataset.cdec, 1); re(); });
  $$('[data-crm]').forEach(b => b.onclick = () => { CARDS.deck.splice(+b.dataset.crm, 1); re(); });
  $$('[data-cust]').forEach(b => b.onclick = () => cardCustomizer(+b.dataset.cust));
  $$('[data-cicon]').forEach(b => b.onclick = () => { const d = CARDS.deck[+b.dataset.cicon]; const e = deckEntry(d); iconPicker(e.c, ref => { setCust(d, { icon: ref }); re(); }); });
  if ($('#c-pdf')) $('#c-pdf').onclick = () => runPdfJob($('#c-pdf'), 'Export cards PDF', async () => { const b = await exportCardsPdf($('#c-pdf')); await deliverFile('vanadium-cards.pdf', new Blob([b], { type: 'application/pdf' })); });
  document.title = 'Cards — Vanadium';
}
function setCust(d, patch) { CARDS.custom = CARDS.custom || {}; const k = cardKey(d); const cur = { ...(CARDS.custom[k] || {}), ...patch }; Object.keys(cur).forEach(x => { if (cur[x] === '' || cur[x] == null) delete cur[x]; }); if (Object.keys(cur).length) CARDS.custom[k] = cur; else delete CARDS.custom[k]; saveCards(); }
function cardCustomizer(i) {
  const d = CARDS.deck[i]; const base = deckEntry({ ...d, id: d.id }); if (!base) return;
  const cu0 = { ...custOf(d) };
  const orig = (() => { const sv = CARDS.custom; CARDS.custom = {}; const e = deckEntry(d); CARDS.custom = sv; return e.c; })();
  const el = document.createElement('div'); el.className = 'dlg';
  const draw = () => {
    const cu = custOf(d); const e = deckEntry(d);
    el.innerHTML = `<div class="dlg-b ccust"><h2>Customise card</h2><div class="ccust-g"><div class="ccust-f">
      <label class="negnotes">Title<input id="cc-t" value="${esc(cu.title || '')}" placeholder="${esc(orig.name)}"></label>
      <label class="negnotes">Subtitle<input id="cc-s" value="${esc(cu.sub || '')}" placeholder="${esc(orig.sub)}"></label>
      <div class="negnotes">Icon</div><div class="cc-icon"><span class="cd-ic big" style="--cc:${e.c.color}">${e.c.icon ? iconSvg(e.c.icon) : '—'}</span><button class="btn ghost sm" id="cc-pick">Choose icon…</button><button class="btn ghost sm" id="cc-noicon">No icon</button>${cu.icon ? '<button class="btn ghost sm" id="cc-autoi">Automatic</button>' : ''}</div>
      <div class="negnotes">Colour</div><div class="cc-pal">${CARD_PALETTE.map(c => `<button data-col="${c}" style="background:${c}" class="${e.c.color.toLowerCase() === c ? 'on' : ''}"></button>`).join('')}<input type="color" id="cc-col" value="${e.c.color}" title="Custom colour">${cu.color ? '<button class="btn ghost sm" id="cc-dcol">Default</button>' : ''}</div>
      <label class="negnotes">Label on the back<input id="cc-b" value="${esc(cu.back || '')}" placeholder="${esc(orig.back)}"></label>
      <label class="row-c"><input type="checkbox" id="cc-all"> Apply this colour to every ${esc(base.kind.toLowerCase())} card</label>
      </div><div class="ccust-p">${cardHtml(e.c, 1, -1)}</div></div>
      <div class="dlgfoot"><button class="btn ghost" id="cc-reset">Reset card</button><span style="flex:1"></span><button class="btn ghost" id="cc-x">Cancel</button><button class="btn" id="cc-ok">Done</button></div></div>`;
    const keep = () => setCust(d, { title: $('#cc-t', el).value.trim(), sub: $('#cc-s', el).value.trim(), back: $('#cc-b', el).value.trim() });
    ['#cc-t', '#cc-s', '#cc-b'].forEach(s => $(s, el).onchange = () => { keep(); draw(); });
    $('#cc-pick', el).onclick = () => { keep(); iconPicker(deckEntry(d).c, ref => { setCust(d, { icon: ref }); draw(); }); };
    $('#cc-noicon', el).onclick = () => { keep(); setCust(d, { icon: 'none' }); draw(); };
    if ($('#cc-autoi', el)) $('#cc-autoi', el).onclick = () => { keep(); setCust(d, { icon: '' }); draw(); };
    $$('[data-col]', el).forEach(b => b.onclick = () => { keep(); setCust(d, { color: b.dataset.col }); draw(); });
    $('#cc-col', el).onchange = e2 => { keep(); setCust(d, { color: e2.target.value }); draw(); };
    if ($('#cc-dcol', el)) $('#cc-dcol', el).onclick = () => { keep(); setCust(d, { color: '' }); draw(); };
    $('#cc-reset', el).onclick = () => { setCust(d, { title: '', sub: '', icon: '', color: '', back: '' }); draw(); };
    $('#cc-x', el).onclick = () => { CARDS.custom = CARDS.custom || {}; if (Object.keys(cu0).length) CARDS.custom[cardKey(d)] = cu0; else delete CARDS.custom[cardKey(d)]; saveCards(); el.remove(); cardsPage(); };
    $('#cc-ok', el).onclick = () => { keep(); if ($('#cc-all', el).checked) { const col = custOf(d).color; CARDS.deck.forEach(x => { const ex = deckEntry(x); if (ex && ex.kind === base.kind) setCust(x, { color: col || '' }); }); } el.remove(); cardsPage(); };
  };
  draw(); document.body.appendChild(el);
}
function iconPicker(c, onPick) {
  const el = document.createElement('div'); el.className = 'dlg';
  const st = { lib: 'gi', q: '' };
  const sugg = () => { const words = String(c.name || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2); const L = ICONS.gi; if (!L) return []; const out = new Set([autoIcon(c)]); for (const w of words) { const sg = w.replace(/s$/, ''); L.names.filter(n => n.split('-').includes(sg) || n.split('-').includes(w)).slice(0, 8).forEach(n => out.add('gi:' + n)); } [cardIconFor(c.hint), cardIconFor(c.type)].filter(Boolean).forEach(x => out.add(x)); return [...out].slice(0, 16); };
  el.innerHTML = `<div class="dlg-b ipick"><h2>Choose an icon</h2>
    <div class="ip-top"><div class="seg4 iplib">${Object.entries(ICON_LIBS).map(([k, v]) => `<button data-lib="${k}" class="${k === st.lib ? 'on' : ''}">${v.name} <small>${v.n.toLocaleString()}</small></button>`).join('')}</div>
    <div class="csearch">${ico('search', 16)}<input id="ip-q" placeholder="Search icons, e.g. potion, sword, skull, castle…" autocomplete="off"></div></div>
    <div class="ip-sug-h">Suggested for “${esc(c.name)}”</div><div class="ip-grid sug" id="ip-sug"></div>
    <div class="ip-sug-h" id="ip-rh"></div><div class="ip-grid" id="ip-res"></div>
    <div class="dlgfoot"><span class="note" id="ip-cred" style="margin:0;font-size:12px"></span><span style="flex:1"></span><button class="btn ghost" id="ip-x">Cancel</button></div></div>`;
  document.body.appendChild(el);
  const cell = ref => `<button data-ic="${ref}" title="${esc(ref.split(':')[1].replace(/-/g, ' '))}">${iconSvg(ref)}<span>${esc(ref.split(':')[1].replace(/-/g, ' '))}</span></button>`;
  const bind = () => $$('[data-ic]', el).forEach(b => b.onclick = () => { el.remove(); onPick(b.dataset.ic); });
  const render = async () => {
    $('#ip-res', el).innerHTML = '<div class="empty">Loading icons…</div>';
    await loadIcons(st.lib); await loadIcons('gi');
    $('#ip-sug', el).innerHTML = sugg().filter(iconDef).map(cell).join('');
    const L = ICONS[st.lib]; const terms = st.q.toLowerCase().split(/\s+/).filter(Boolean);
    let names = terms.length ? L.names.filter(n => terms.every(t => n.includes(t))) : L.names;
    if (terms.length) names.sort((a, b) => (b.split('-').includes(terms[0]) - a.split('-').includes(terms[0])) || a.length - b.length);
    const shown = names.slice(0, 300);
    $('#ip-rh', el).textContent = terms.length ? `${names.length.toLocaleString()} matches${names.length > 300 ? ' (showing 300)' : ''}` : `Browse ${ICON_LIBS[st.lib].name.toLowerCase()} (showing 300 of ${names.length.toLocaleString()})`;
    $('#ip-res', el).innerHTML = shown.map(n => cell(st.lib + ':' + n)).join('') || '<div class="empty">No icons match. Try another word or the other library.</div>';
    $('#ip-cred', el).textContent = 'Icons: ' + ICON_LIBS[st.lib].credit;
    bind();
  };
  let tm; $('#ip-q', el).oninput = e => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value.trim(); render(); }, 150); };
  $$('[data-lib]', el).forEach(b => b.onclick = () => { st.lib = b.dataset.lib; $$('[data-lib]', el).forEach(x => x.classList.toggle('on', x === b)); render(); });
  $('#ip-x', el).onclick = () => el.remove();
  el.onclick = e => { if (e.target === el) el.remove(); };
  render(); setTimeout(() => $('#ip-q', el)?.focus(), 30);
}
// ---- quest editor ----
function questEditor(q) {
  const RW = SYS.cards?.rewards || { labels: ['Other'], hints: {}, defaults: [] };   // reward types are the system's (Draw Steel: Victories, Renown, …)
  const isNew = !q; q = q ? JSON.parse(JSON.stringify(q)) : { id: uid('q'), title: '', text: '', rewards: JSON.parse(JSON.stringify(RW.defaults)) };
  const el = document.createElement('div'); el.className = 'dlg';
  const draw = () => {
    el.innerHTML = `<div class="dlg-b negedit"><h2>${isNew ? 'New' : 'Edit'} quest card</h2>
      <label class="negnotes">Quest<input id="qe-t" value="${esc(q.title)}" placeholder="e.g. The Missing Bell"></label>
      <label class="negnotes">What the heroes were asked to do<textarea id="qe-x" rows="3" placeholder="Brother Aldo asked you to find out who stole the temple bell.">${esc(q.text)}</textarea></label>
      <label class="negnotes">Given by / where (optional, shown under the title)<input id="qe-f" value="${esc(q.from || '')}" placeholder="Brother Aldo · Temple of the Tide"></label>
      <div class="negnotes">Rewards</div>
      ${q.rewards.map((r, i) => `<div class="qrow"><select data-rl="${i}">${RW.labels.map(l => `<option ${r.label === l ? 'selected' : ''}>${l}</option>`).join('')}</select><input data-rv="${i}" value="${esc(r.value)}" placeholder="${RW.hints[r.label] || ''}"><button class="ibtn" data-rd="${i}">✕</button></div>`).join('')}
      <button class="btn ghost sm" id="qe-add">+ Reward</button>
      <div class="dlgfoot">${!isNew ? '<button class="btn danger" id="qe-del">Delete quest</button>' : ''}<span style="flex:1"></span><button class="btn ghost" id="qe-x2">Cancel</button><button class="btn" id="qe-ok">${isNew ? 'Add card' : 'Save'}</button></div></div>`;
    const keep = () => { q.title = $('#qe-t', el).value.trim(); q.text = $('#qe-x', el).value.trim(); q.from = $('#qe-f', el).value.trim(); $$('[data-rl]', el).forEach(s => q.rewards[+s.dataset.rl].label = s.value); $$('[data-rv]', el).forEach(s => q.rewards[+s.dataset.rv].value = s.value.trim()); };
    $('#qe-add', el).onclick = () => { keep(); q.rewards.push({ label: 'Other', value: '' }); draw(); };
    $$('[data-rd]', el).forEach(b => b.onclick = () => { keep(); q.rewards.splice(+b.dataset.rd, 1); draw(); });
    $$('[data-rl]', el).forEach(s => s.onchange = () => { keep(); draw(); });
    $('#qe-x2', el).onclick = () => el.remove();
    if ($('#qe-del', el)) $('#qe-del', el).onclick = async () => { if (await confirmSheet(`Delete the quest “${q.title}”?`, 'Delete')) { CARDS.quests = CARDS.quests.filter(x => x.id !== q.id); CARDS.deck = CARDS.deck.filter(x => !(x.k === 'quest' && x.id === q.id)); saveCards(); el.remove(); cardsPage(); } };
    $('#qe-ok', el).onclick = () => { keep(); if (!q.title) { toast('Give the quest a name'); return; } q.rewards = q.rewards.filter(r => r.value); const i = CARDS.quests.findIndex(x => x.id === q.id); if (i >= 0) CARDS.quests[i] = q; else { CARDS.quests.push(q); addToDeck('quest', q.id); } CARDS.tab = 'quest'; saveCards(); el.remove(); cardsPage(); };
  };
  draw(); document.body.appendChild(el); setTimeout(() => $('#qe-t', el)?.focus(), 30);
}
// ---- quests from an adventure ----
function questsFromAdventureDialog() {
  const packs = PACKS.filter(p => (p.chapters || []).length > 1);
  if (!packs.length) { toast('Import an adventure first'); return; }
  const st = { pack: (packs.find(p => p.kind === 'adventure') || packs[0]).id, ch: '', L: 0, sel: {} };
  const el = document.createElement('div'); el.className = 'dlg';
  const levels = ch => [...new Set(ch.blocks.filter(b => b.t === 'h' && b.lvl >= 1 && b.lvl <= 4).map(b => b.lvl))].sort();
  const bestLevel = (p, ch) => { let best = levels(ch)[0] || 1, bestN = -1; for (const L of levels(ch)) { const qs = SYS.cards.questsFromChapter(p, ch, L); const n = qs.filter(q => q.rewards.length).length; if (n > bestN && qs.length <= 30) { best = L; bestN = n; } if (n >= 3) { best = L; break; } } return best; };
  let cands = [];
  const draw = () => {
    const p = PK[st.pack]; const chs = p.chapters.filter(c => c.blocks.some(b => b.t === 'h'));
    if (!st.ch || !chs.some(c => c.id === st.ch)) { const c2 = chs.find(c => /chapter\s*2/i.test(c.title)) || chs.find(c => /^chapter/i.test(c.title)) || chs[0]; st.ch = c2.id; st.L = 0; }
    const ch = p.chapters.find(c => c.id === st.ch);
    if (!st.L) st.L = bestLevel(p, ch);
    cands = SYS.cards.questsFromChapter(p, ch, st.L); cands.forEach((q, i) => { if (st.sel[i] == null) st.sel[i] = q.rewards.length > 0 && !/^(Running|Beginning|Complicating|Introduction|Using|How to|Credits|Appendix)/i.test(q.title); });
    const nameOf = L => ({ 1: 'Top-level sections', 2: 'Sections', 3: 'Sub-sections', 4: 'Small sections' }[L] || 'Level ' + L);
    el.innerHTML = `<div class="dlg-b negedit"><h2>Quest cards from an adventure</h2>
      <p>Pick a chapter. Each section becomes a quest card with its rewards: ${SYS.cards.questRewardsText} found in the text. You can edit every card afterwards.</p>
      <div class="mtrow"><label>Book<select id="qa-p">${packs.map(x => `<option value="${x.id}" ${x.id === st.pack ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
        <label>Chapter<select id="qa-c">${chs.map(c => `<option value="${c.id}" ${c.id === st.ch ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
        <label>One card per<select id="qa-l">${levels(ch).map(L => `<option value="${L}" ${L === st.L ? 'selected' : ''}>${nameOf(L)} (${ch.blocks.filter(b => b.t === 'h' && b.lvl === L).length})</option>`).join('')}</select></label></div>
      <div class="qacands">${cands.map((q, i) => `<label class="qac ${st.sel[i] ? 'on' : ''}"><input type="checkbox" data-qs="${i}" ${st.sel[i] ? 'checked' : ''}><div><b>${esc(q.title)}</b><span>${esc(q.text.slice(0, 140))}${q.text.length > 140 ? '…' : ''}</span><em>${q.rewards.length ? q.rewards.map(r => esc(r.label + ': ' + r.value)).join(' · ') : 'No rewards found'}</em></div></label>`).join('') || '<div class="empty">No sections at this level.</div>'}</div>
      <div class="dlgfoot"><button class="btn ghost sm" id="qa-all">All</button><button class="btn ghost sm" id="qa-none">None</button><span style="flex:1"></span><button class="btn ghost" id="qa-x">Cancel</button><button class="btn" id="qa-ok">Add ${Object.values(st.sel).filter(Boolean).length} quest cards</button></div></div>`;
    $('#qa-p', el).onchange = e => { st.pack = e.target.value; st.ch = ''; st.L = 0; st.sel = {}; draw(); };
    $('#qa-c', el).onchange = e => { st.ch = e.target.value; st.L = 0; st.sel = {}; draw(); };
    $('#qa-l', el).onchange = e => { st.L = +e.target.value; st.sel = {}; draw(); };
    $$('[data-qs]', el).forEach(c => c.onchange = () => { st.sel[+c.dataset.qs] = c.checked; draw(); });
    $('#qa-all', el).onclick = () => { cands.forEach((_, i) => st.sel[i] = true); draw(); };
    $('#qa-none', el).onclick = () => { cands.forEach((_, i) => st.sel[i] = false); draw(); };
    $('#qa-x', el).onclick = () => el.remove();
    $('#qa-ok', el).onclick = () => { const pick = cands.filter((_, i) => st.sel[i]); if (!pick.length) { toast('Pick at least one'); return; } pick.forEach(q => { CARDS.quests.push(q); addToDeck('quest', q.id); }); CARDS.tab = 'quest'; saveCards(); el.remove(); cardsPage(); toast(`Added ${pick.length} quest cards`); };
  };
  draw(); document.body.appendChild(el);
}
// ---- PDF ----
// opt.frontsOnly: no back pages (used to render card JPGs)
// opt.collect:    filled with {faces: [content key per face], geo: page layout}
// opt.qr:         [url per face] → QR code on each back (implies backs)
async function buildCardsPdf(opt = {}) {
  if (opt.qr) await loadQr();
  await loadIcons('gi'); if (CARDS.deck.some(d => (custOf(d).icon || '').startsWith('mdi:'))) await loadIcons('mdi');
  const w = await makeWriter('Cards', { footer: false }); const { rgb } = w; const ST = CARDS.style || 'modern';
  const [, mw, mh] = CARD_SIZES[CARDS.size] || CARD_SIZES.poker; const mm = 2.83465; const cw = mw * mm, ch = mh * mm, gap = 3 * mm;
  const cols = Math.max(1, Math.floor((w.W - 20 + gap) / (cw + gap))), rows = Math.max(1, Math.floor((w.H - 30 + gap) / (ch + gap))); const per = cols * rows;
  const ox = (w.W - (cols * cw + (cols - 1) * gap)) / 2, oy = (w.H - (rows * ch + (rows - 1) * gap)) / 2 + 4;
  const hexA = h => { const v = parseInt(String(h).slice(1), 16); return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
  const hex = h => rgb(...hexA(h));
  const tint = (h, k) => rgb(...hexA(h).map(c => c + (1 - c) * k));
  const shade = (h, k) => rgb(...hexA(h).map(c => c * (1 - k)));
  const white = rgb(1, 1, 1), parch = rgb(0.965, 0.937, 0.875), parchInk = rgb(0.17, 0.13, 0.09);
  const rr = (ww, hh, r) => `M ${r} 0 H ${ww - r} A ${r} ${r} 0 0 1 ${ww} ${r} V ${hh - r} A ${r} ${r} 0 0 1 ${ww - r} ${hh} H ${r} A ${r} ${r} 0 0 1 0 ${hh - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  const shape = (x, y, ww, hh, r, o) => w.page.drawSvgPath(rr(ww, hh, r), { x, y: y + hh, ...o });
  const icon = (ref, x, y, size, color, opacity) => { const d = iconDef(ref); if (!d) return; w.page.drawSvgPath(d.d, { x, y: y + size, scale: size / d.w, color, ...(opacity != null ? { opacity } : {}) }); };
  const fit = (t, size, font, max) => { while (w.tw(t, size, font) > max && t.length > 3) t = t.slice(0, -2).trimEnd() + '…'; return t; };
  const times = ST === 'classic';
  const fonts = times ? { r: w.TR, b: w.TB, i: w.TI } : { r: w.F, b: w.FB, i: w.FI };
  const PAD = 10, STC = 5;
  // geometry per style: header height (from top), body inset, footer reserve
  const G = { modern: { head: 34, inset: 5, foot: 18 }, classic: { head: 52, inset: 9, foot: 20 }, bold: { head: Math.min(78, ch * 0.3), inset: 6, foot: 16 }, minimal: { head: 32, inset: 4, foot: 16 } }[ST];
  const statH = c => c.stats ? Math.ceil(c.stats.length / STC) * 19 + 4 : 0;
  const bodyX = G.inset + PAD - 3, bodyW = cw - 2 * bodyX;
  const faces = [];
  const minSize = CARDS.text === 'large' ? 7.5 : 6, maxSize = CARDS.text === 'large' ? 9.5 : 8.5;
  for (const d of CARDS.deck) {
    const e = deckEntry(d); if (!e) continue; const c = e.c;
    const avail = k => ch - G.head - (ST === 'classic' ? 14 : 8) - (c.keywords ? 10 : 0) - G.foot - (k === 0 ? statH(c) : 0);
    const html = c.paras.join('<br><br>'); const lo = { width: bodyW, times };
    let size = maxSize, lines;
    for (; size >= minSize; size -= 0.25) { lines = w.layout(html, { ...lo, size }); if (lines.length * size * 1.22 <= avail(0)) break; }
    if (size < minSize) { size = minSize; lines = w.layout(html, { ...lo, size }); }
    const chunks = []; let k = 0, pos = 0;
    while (pos < lines.length || !chunks.length) { const n = Math.max(1, Math.floor(avail(k) / (size * 1.22))); let sl = lines.slice(pos, pos + n); while (sl.length && !sl[0].length) { pos++; sl = lines.slice(pos, pos + n); } chunks.push(sl); pos += n; k++; if (pos >= lines.length) break; }
    for (let n = 0; n < d.n; n++) chunks.forEach((ls, i) => faces.push({ c, lines: ls, size, first: i === 0, part: chunks.length > 1 ? `${i + 1}/${chunks.length}` : '' }));
  }
  faces.forEach((f, i) => f.idx = i);
  // everything that changes how a face looks → same key means the same picture
  if (opt.collect) { opt.collect.faces = faces.map(f => JSON.stringify({ v: 1, ST, cs: CARDS.size || 'poker', wm: CARDS.watermark !== false, fs: f.size, part: f.part, c: f.c })); opt.collect.geo = { cols, rows, per, ox, oy, cw, ch, gap, W: w.W, H: w.H }; }
  const drawText = (f, x, yy, ink) => {
    for (const ln of f.lines) { let xx = x;
      for (const t of ln) { if (t.sp) xx += fonts.r.widthOfTextAtSize(' ', f.size);
        if (t.t === '[]') { const s = f.size * 0.85; w.page.drawRectangle({ x: xx, y: yy - f.size + 0.2, width: s, height: s, borderColor: ink, borderWidth: 0.6 }); xx += s + 1; continue; }
        w.page.drawText(PSAN(t.t), { x: xx, y: yy - f.size, size: f.size, font: t.f, color: ink }); xx += t.w; }
      yy -= f.size * 1.22; }
  };
  const drawStats = (f, x, yy, width, ink, mut, rule) => {
    const cellW = width / STC;
    f.c.stats.forEach(([l, v], i) => { const cx = x + (i % STC) * cellW, cy = yy - Math.floor(i / STC) * 19; w.T(String(l).toUpperCase(), cx + 1, cy - 6, 4.8, fonts.b, mut); w.T(String(v ?? ''), cx + 1, cy - 15, 8.5, fonts.b, ink); });
    const h = statH(f.c); w.line(x, yy - h + 2, x + width, yy - h + 2, 0.4, rule); return h;
  };
  const checkBox = (x, y, s, color) => w.page.drawRectangle({ x, y, width: s, height: s, borderColor: color, borderWidth: 1.3 });
  const drawFront = (f, x, y) => {
    const c = f.c, col = hex(c.color), top = y + ch; const sub = c.sub + (f.part ? '  (' + f.part + ')' : '');
    let yy, ink = w.ink, mut = w.grey;
    if (ST === 'modern') {
      shape(x, y, cw, ch, 9, { color: col });
      shape(x + G.inset, y + G.inset, cw - 2 * G.inset, ch - G.head - G.inset, 6, { color: white });
      let tx = x + 10;
      if (c.icon) { w.page.drawCircle({ x: x + 21, y: top - 17, size: 12, color: white }); icon(c.icon, x + 13, top - 25, 16, col); tx = x + 38; }
      const ckW = c.check ? 18 : 0, maxT = cw - (tx - x) - 10 - ckW;
      let ts = 11; while (w.tw(c.name, ts, w.FB) > maxT && ts > 7) ts -= 0.5;
      w.T(fit(c.name, ts, w.FB, maxT), tx, top - 15, ts, w.FB, white);
      w.T(fit(sub, 6.3, w.F, maxT), tx, top - 25, 6.3, w.F, tint(c.color, 0.75));
      if (c.check) checkBox(x + cw - 22, top - 23, 12, white);
      if (CARDS.watermark !== false && c.icon) icon(c.icon, x + cw - G.inset - 62, y + G.inset + G.foot - 4, 58, col, 0.07);
      yy = top - G.head - 9;
    } else if (ST === 'classic') {
      shape(x, y, cw, ch, 6, { color: parch });
      w.page.drawRectangle({ x: x + 4, y: y + 4, width: cw - 8, height: ch - 8, borderColor: col, borderWidth: 1.6 });
      w.page.drawRectangle({ x: x + 7, y: y + 7, width: cw - 14, height: ch - 14, borderColor: col, borderWidth: 0.5 });
      [[x + 4, y + 4], [x + cw - 4, y + 4], [x + 4, top - 4], [x + cw - 4, top - 4]].forEach(([px, py]) => w.page.drawSvgPath('M 0 -4 L 4 0 L 0 4 L -4 0 Z', { x: px, y: py, color: col }));
      ink = parchInk; mut = rgb(0.42, 0.35, 0.27);
      if (c.icon) icon(c.icon, x + cw / 2 - 9, top - 30, 18, col);
      let ts = 11.5; const maxT = cw - 30; while (w.tw(c.name, ts, w.TB) > maxT && ts > 7) ts -= 0.5;
      const nm = fit(c.name, ts, w.TB, maxT); w.T(nm, x + cw / 2 - w.tw(nm, ts, w.TB) / 2, top - (c.icon ? 41 : 26), ts, w.TB, ink);
      const sb = fit(sub, 6.8, w.TI, maxT); w.T(sb, x + cw / 2 - w.tw(sb, 6.8, w.TI) / 2, top - (c.icon ? 50 : 35), 6.8, w.TI, mut);
      if (c.check) checkBox(x + cw - 22, top - 22, 11, col);
      const oy2 = top - G.head - 4; w.line(x + 16, oy2, x + cw / 2 - 6, oy2, 0.6, col); w.line(x + cw / 2 + 6, oy2, x + cw - 16, oy2, 0.6, col); w.page.drawSvgPath('M 0 -3 L 3 0 L 0 3 L -3 0 Z', { x: x + cw / 2, y: oy2, color: col });
      if (CARDS.watermark !== false && c.icon) icon(c.icon, x + cw / 2 - 36, y + ch / 2 - 46, 72, col, 0.06);
      yy = oy2 - 8;
    } else if (ST === 'bold') {
      shape(x, y, cw, ch, 9, { color: col });
      if (CARDS.watermark !== false && c.icon) icon(c.icon, x + cw - 66, top - 70, 80, white, 0.12);
      if (c.icon) icon(c.icon, x + 10, top - 34, 24, white);
      const maxT = cw - 20 - (c.check ? 18 : 0); let ts = 13; while (w.tw(c.name, ts, w.FB) > maxT && ts > 7.5) ts -= 0.5;
      w.T(fit(c.name, ts, w.FB, maxT), x + 10, top - G.head + 22, ts, w.FB, white);
      w.T(fit(sub, 6.5, w.F, maxT), x + 10, top - G.head + 11, 6.5, w.F, tint(c.color, 0.7));
      if (c.check) checkBox(x + cw - 22, top - 22, 12, white);
      shape(x + G.inset, y + G.inset, cw - 2 * G.inset, ch - G.head - G.inset, 6, { color: white });
      yy = top - G.head - 9;
    } else {
      shape(x, y, cw, ch, 8, { color: white, borderColor: col, borderWidth: 1.2 });
      let tx = x + 10;
      if (c.icon) { icon(c.icon, x + 9, top - 25, 16, col); tx = x + 30; }
      const maxT = cw - (tx - x) - 10 - (c.check ? 16 : 0); let ts = 10.5; while (w.tw(c.name, ts, w.FB) > maxT && ts > 7) ts -= 0.5;
      w.T(fit(c.name, ts, w.FB, maxT), tx, top - 15, ts, w.FB, w.ink);
      w.T(fit(sub, 6.3, w.F, maxT), tx, top - 24, 6.3, w.F, col);
      if (c.check) checkBox(x + cw - 20, top - 21, 11, col);
      w.line(x + 8, top - G.head + 2, x + cw - 8, top - G.head + 2, 0.6, col);
      yy = top - G.head - 6;
    }
    const bx = x + bodyX;
    if (c.keywords) { w.T(fit(c.keywords, 6.5, fonts.i, bodyW), bx, yy - 6, 6.5, fonts.i, mut); yy -= 10; }
    if (f.first && c.stats) yy -= drawStats(f, bx, yy, bodyW, ink, mut, ST === 'classic' ? tint(c.color, 0.6) : rgb(0.82, 0.82, 0.82));
    drawText(f, bx, yy, ink);
    if (c.foot) { const ft = fit(c.foot, 5.5, fonts.r, bodyW); if (ST === 'classic') w.T(ft, x + cw / 2 - w.tw(ft, 5.5, fonts.r) / 2, y + 11, 5.5, fonts.r, mut); else w.T(ft, bx, y + (ST === 'bold' || ST === 'modern' ? G.inset + 5 : 8), 5.5, fonts.r, mut); }
  };
  // QR code as vector squares (one rectangle per horizontal run), on a white rounded tile
  const drawQr = (url, x0, y0, size) => {
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    const n = qr.getModuleCount(), quiet = 2, m = size / (n + 2 * quiet), ink = rgb(0, 0, 0);
    shape(x0, y0, size, size, 3, { color: white });
    for (let r = 0; r < n; r++) for (let c0 = 0; c0 < n;) {
      if (!qr.isDark(r, c0)) { c0++; continue; }
      let e = c0; while (e < n && qr.isDark(r, e)) e++;
      w.page.drawRectangle({ x: x0 + (quiet + c0) * m, y: y0 + size - (quiet + r + 1) * m - 0.02, width: (e - c0) * m, height: m + 0.04, color: ink }); // tiny overlap: no hairline gaps
      c0 = e;
    }
  };
  const qrGeo = (f, x, y) => { const url = opt.qr && opt.qr[f.idx]; const q = url ? Math.min(cw * 0.36, ch * 0.26) : 0; return { url, q, qx: x + cw / 2 - q / 2, qy: y + 12 }; };
  const drawBack = (f, x, y) => { drawBackArt(f, x, y); const g = qrGeo(f, x, y); if (g.url) drawQr(g.url, g.qx, g.qy, g.q); };
  const drawBackArt = (f, x, y) => {
    const c = f.c, col = hex(c.color), url = opt.qr && opt.qr[f.idx];
    // with a QR code: tile at the bottom centre, icon + label centred in the space above it
    const q = url ? Math.min(cw * 0.36, ch * 0.26) : 0, qy = y + 12;
    const cx = x + cw / 2, cy = url ? (qy + q + 8 + y + ch) / 2 + 6 : y + ch / 2 + 8;
    const ref = CARDS.iconBack !== false && c.icon ? c.icon : null; const s = url ? Math.min(cw * 0.42, (ch - q - 20) * 0.42) : Math.min(cw, ch) * 0.42;
    const lab = String(c.back || 'Card').toUpperCase();
    if (ST === 'classic' || ST === 'minimal') {
      if (ST === 'classic') { shape(x, y, cw, ch, 6, { color: parch }); w.page.drawRectangle({ x: x + 4, y: y + 4, width: cw - 8, height: ch - 8, borderColor: col, borderWidth: 1.6 }); w.page.drawRectangle({ x: x + 7, y: y + 7, width: cw - 14, height: ch - 14, borderColor: col, borderWidth: 0.5 }); }
      else shape(x, y, cw, ch, 8, { color: white, borderColor: col, borderWidth: 1.2 });
      if (ref) icon(ref, cx - s / 2, cy - s / 2, s, col); else w.page.drawSvgPath(`M 0 ${-s / 2} L ${s * 0.3} 0 L 0 ${s / 2} L ${-s * 0.3} 0 Z`, { x: cx, y: cy, borderColor: col, borderWidth: 1.6 });
      const fnt = ST === 'classic' ? w.TB : w.FB; w.T(lab, cx - w.tw(lab, 10, fnt) / 2, cy - s / 2 - 18, 10, fnt, col);
      return;
    }
    shape(x, y, cw, ch, 9, { color: col });
    shape(x + 7, y + 7, cw - 14, ch - 14, 6, { borderColor: tint(c.color, 0.45), borderWidth: 0.8 });
    w.page.drawCircle({ x: cx, y: cy, size: s * 0.68, color: shade(c.color, 0.18) });
    if (ref) icon(ref, cx - s * 0.4, cy - s * 0.4, s * 0.8, white);
    else { w.page.drawSvgPath(`M 0 ${-s * 0.4} L ${s * 0.25} 0 L 0 ${s * 0.4} L ${-s * 0.25} 0 Z`, { x: cx, y: cy, color: white }); }
    w.T(lab, cx - w.tw(lab, 10.5, w.FB) / 2, cy - s * 0.68 - 18, 10.5, w.FB, white);
  };
  const crop = (x, y) => { const L = 6, g = 2; const c = rgb(0.6, 0.6, 0.6); [[x, y], [x + cw, y], [x, y + ch], [x + cw, y + ch]].forEach(([px, py]) => { const sx = px === x ? -1 : 1, sy = py === y ? -1 : 1; w.line(px + sx * g, py, px + sx * (g + L), py, 0.3, c); w.line(px, py + sy * g, px, py + sy * (g + L), 0.3, c); }); };
  const credit = () => w.T('Icons: game-icons.net (CC BY 3.0) · Material Design Icons (Apache 2.0) · ' + SYS.pdfNotice, 20, 10, 5.5, w.F, rgb(0.6, 0.6, 0.6));
  for (let p0 = 0; p0 < faces.length; p0 += per) {
    const pageFaces = faces.slice(p0, p0 + per);
    w.newPage(); credit();
    pageFaces.forEach((f, i) => { const c = i % cols, r = Math.floor(i / cols); const x = ox + c * (cw + gap), y = w.H - oy - (r + 1) * ch - r * gap; crop(x, y); drawFront(f, x, y); });
    if (!opt.frontsOnly && (CARDS.backs || opt.qr)) { w.newPage(); pageFaces.forEach((f, i) => { const c = cols - 1 - (i % cols), r = Math.floor(i / cols); const x = ox + c * (cw + gap), y = w.H - oy - (r + 1) * ch - r * gap; drawBack(f, x, y); }); }
  }
  return w.bytes();
}

// ---- QR codes → public card JPGs (uploaded through sync.php, served by card.php) ----
let qrLoad = null;
function loadQr() {  // lib/qrcode.js: qrcode-generator 1.4.4 (MIT), defines window.qrcode
  return qrLoad || (qrLoad = new Promise((res, rej) => { if (window.qrcode) return res(); const s = document.createElement('script'); s.src = 'lib/qrcode.js?v=f55fa3499c'; s.onload = res; s.onerror = () => { qrLoad = null; rej(new Error('could not load the QR code library')); }; document.head.appendChild(s); }));
}
// 22-char id from the key's private salt + what the face looks like: stable, but unguessable
async function cardImageId(salt, content) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '\n' + content)));
  return btoa(String.fromCharCode(...h)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 22);
}
async function exportCardsPdf(btn) {
  if (!CARDS.qr) return buildCardsPdf();
  const V = window.VSync;
  if (!V || !V.status().enabled) throw new Error('QR codes need sync to be on (Utilities → Sync across devices)');
  const say = t => { if (btn) btn.textContent = t; };
  say('Drawing cards…');
  const col = {}; const fronts = await buildCardsPdf({ frontsOnly: true, collect: col });
  const salt = await V.cardSalt();
  const ids = await Promise.all(col.faces.map(c => cardImageId(salt, c)));
  const have = new Set(await V.cardHas([...new Set(ids)]));
  const need = []; ids.forEach((id, i) => { if (!have.has(id) && !need.some(n => n.id === id)) need.push({ id, i }); });
  if (need.length) {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: fronts, isEvalSupported: false, verbosity: 0 }), doc = await task.promise;
    const g = col.geo, scale = 3.5;  // ≈ 250 dpi
    let pageNo = 0, pageCanvas = null, done = 0;
    for (const { id, i } of need) {
      const p = Math.floor(i / g.per) + 1, k = i % g.per, cc = k % g.cols, rr = Math.floor(k / g.cols);
      if (p !== pageNo) {
        const page = await doc.getPage(p), vp = page.getViewport({ scale });
        pageCanvas = document.createElement('canvas'); pageCanvas.width = Math.ceil(vp.width); pageCanvas.height = Math.ceil(vp.height);
        const ctx = pageCanvas.getContext('2d');
        await page.render({ canvasContext: ctx, canvas: pageCanvas, viewport: vp }).promise; pageNo = p;
      }
      const card = document.createElement('canvas'); card.width = Math.round(g.cw * scale); card.height = Math.round(g.ch * scale);
      const sx = (g.ox + cc * (g.cw + g.gap)) * scale, sy = (g.oy + rr * (g.ch + g.gap)) * scale;  // pdf y is from the bottom, canvas from the top
      const cx = card.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, card.width, card.height);
      cx.drawImage(pageCanvas, sx, sy, card.width, card.height, 0, 0, card.width, card.height);
      const blob = await new Promise(r => card.toBlob(r, 'image/jpeg', 0.88));
      say(`Uploading card pictures ${++done}/${need.length}…`);
      await V.cardPut(id, blob);
    }
    try { await task.destroy(); } catch (e) { }  // cleanup only; never fail the export over it
  }
  const base = new URL('card.php', location.href); base.hash = ''; base.search = '';
  say('Building PDF…');
  return buildCardsPdf({ qr: ids.map(id => base.href + '?id=' + id) });
}

boot();
