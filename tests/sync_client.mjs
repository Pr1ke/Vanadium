// Runs site/sync.js in two simulated "devices" (separate vm contexts) against an in-memory
// JS mirror of sync.php's API, to test the client's merge/push/pull/pack logic.
import vm from 'node:vm'; import fs from 'node:fs'; import assert from 'node:assert/strict';
const SRC = fs.readFileSync(process.argv[2], 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- fake server (mirrors sync.php semantics) ----------
const spaces = {}; let owner = null, open = false;
const rnd = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
function server(url, opt = {}) {
  const u = new URL(url, 'https://x/'), a = u.searchParams.get('a'), m = opt.method || 'GET';
  const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  const body = () => JSON.parse(opt.body || '{}');
  if (a === 'create') { const k = rnd(); spaces[k] = { rev: 0, items: {}, packs: {}, chunks: {} }; if (!owner) owner = k; else if (!open) return j({ error: 'only owner' }, 403); return j({ key: k, owner: owner === k }); }
  const k = opt.headers?.['X-Sync-Key'], sp = spaces[k]; if (!sp) return j({ error: 'Unknown sync key.' }, 401);
  if (a === 'state') { const since = +u.searchParams.get('since'); const items = {}; for (const [n, it] of Object.entries(sp.items)) if (it.r > since) items[n] = { t: it.t, v: it.v }; return j({ rev: sp.rev, items, packs: sp.packs, owner: owner === k, open, usage: 0, quota: 1e9 }); }
  if (a === 'put') { const rej = {}; for (const [n, it] of Object.entries(body().items)) { const c = sp.items[n]; if (c && c.t >= it.t) { if (c.t > it.t) rej[n] = { t: c.t, v: c.v }; continue; } sp.items[n] = { t: it.t, v: it.v, r: ++sp.rev }; } return j({ rev: sp.rev, rejected: rej }); }
  const id = u.searchParams.get('id'), n = u.searchParams.get('n');
  if (a === 'pack_chunk' && m === 'POST') { sp.chunks[id + ':' + n] = new Uint8Array(opt.body); return j({ ok: 1 }); }
  if (a === 'pack_chunk') { const c = sp.chunks[id + ':' + n]; return c ? new Response(c) : j({ error: 'no' }, 404); }
  if (a === 'pack_done') { const b = body(); const o = sp.packs[b.id]; if (o && o.deleted && o.t >= b.t) return j({ error: 'deleted' }, 409); sp.packs[b.id] = { t: b.t, title: b.title, chunks: b.chunks, size: b.size, r: ++sp.rev }; return j({ ok: 1 }); }
  if (a === 'pack_del') { const b = body(); sp.packs[b.id] = { t: b.t, deleted: true, r: ++sp.rev }; return j({ ok: 1 }); }
  if (a === 'rotate') { const nk = rnd(); spaces[nk] = sp; delete spaces[k]; if (owner === k) owner = nk; return j({ key: nk }); }
  if (a === 'setopen') { open = body().open; return j({ open }); }
  return j({ error: 'bad' }, 400);
}

// ---------- a device ----------
function device(name) {
  class Storage { constructor() { this._m = new Map(); } getItem(k) { return this._m.has(k) ? this._m.get(k) : null; } setItem(k, v) { this._m.set(k, String(v)); } removeItem(k) { this._m.delete(k); } key(i) { return [...this._m.keys()][i] ?? null; } get length() { return this._m.size; } }
  const ls = new Storage(), packs = new Map(), bars = [], log = { added: [], removed: [] };
  const indexedDB = { open() { const q = {}; setTimeout(() => { q.result = { transaction() { const t = {}; const store = { getAll() { const r = {}; r.result = [...packs.values()].map(p => structuredClone(p)); return r; }, put(p) { packs.set(p.id, structuredClone(p)); }, delete(id) { packs.delete(id); } }; t.objectStore = () => store; setTimeout(() => t.oncomplete && t.oncomplete()); return t; } }; q.onsuccess(); }); return q; } };
  let appLoaded = 0;
  const document = { hidden: false, addEventListener() { }, body: { appendChild(s) { if (s.src === 'app.js') appLoaded++; } }, createElement: () => ({}) };
  const ctx = { Storage, localStorage: ls, indexedDB, document, location: { protocol: 'https:', hostname: 'x', origin: 'https://x', pathname: '/' },
    fetch: async (u, o) => server(u, o), setTimeout, clearTimeout, setInterval: () => 0, Date, JSON, Promise, Set, Map, Object, Uint8Array, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, encodeURIComponent, Math, String, Error, console,
    addEventListener() { } };
  ctx.window = ctx; ctx.window.vShowBar = (id, msg) => bars.push(id);
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  const V = ctx.VSync;
  V.appReady({ added: p => log.added.push(p.id), removed: id => log.removed.push(id) });
  // what app.js's store.set does: goes through the (patched) Storage.prototype.setItem
  const set = (k, v) => ls.setItem('st_' + k, JSON.stringify(v));
  const get = k => JSON.parse(ls.getItem('st_' + k));
  return { name, ls, packs, bars, log, V, set, get, appLoaded: () => appLoaded, ctx };
}
const settle = async () => { await sleep(1700); for (let i = 0; i < 20; i++) await sleep(20); };

// ---------- scenarios ----------
const A = device('A');
assert.equal(A.appLoaded(), 1, 'app loads immediately when sync is off');
A.set('cards', ['fireball']); A.set('pins', ['monsters--goblin']); A.ls.setItem('drawsteel-respite-v1', '{"heroes":[1]}');
A.packs.set('imp-book-1', { id: 'imp-book-1', title: 'Big Book', chapters: [{ blocks: [(await import('node:crypto')).randomBytes(2_250_000).toString('base64')] }] }); // 3 MB, incompressible like images
assert.equal(A.V.status().enabled, false);
await A.V.create();
await settle();
const key = A.V.status().key;
assert.ok(A.V.validKey(key), 'key format');
const sp = spaces[key];
assert.equal(JSON.parse(sp.items.st_cards.v)[0], 'fireball', 'A pushed cards on create');
assert.ok(sp.items['drawsteel-respite-v1'], 'respite key synced');
assert.ok(!sp.items.st_sync_key && !sp.items.st_sync_meta, 'sync bookkeeping never uploaded');
assert.ok(sp.packs['imp-book-1'] && sp.packs['imp-book-1'].chunks >= 1, 'book uploaded');
console.log('ok  create: items + book uploaded, chunks =', sp.packs['imp-book-1'].chunks);

// B has its own older data, then connects: synced copy wins on overlap, B-only data is kept and uploaded
const B = device('B');
B.set('cards', ['phone-card']); B.set('chars', { b: 1 });
await B.V.connect(key); await settle();
assert.deepEqual(B.get('cards'), ['fireball'], 'synced copy wins on connect');
assert.deepEqual(B.get('chars'), { b: 1 }, 'B-only key kept');
assert.ok(sp.items.st_chars, 'B-only key uploaded');
assert.ok(B.packs.has('imp-book-1') && B.packs.get('imp-book-1').chapters[0].blocks[0].length === 3_000_000, 'book downloaded intact');
assert.deepEqual(B.log.added, ['imp-book-1'], 'app told about the new book');
console.log('ok  connect: overlap -> synced wins, B-only kept, book downloaded');

// B edits, A pulls on next sync -> value applied + reload bar
B.set('cards', ['fireball', 'potion']); await settle();
await A.V.syncNow(); await settle();
assert.deepEqual(A.get('cards'), ['fireball', 'potion'], 'A got B edit');
assert.ok(A.bars.includes('syncbar'), 'A shown reload bar');
console.log('ok  edit on B reaches A, reload bar shown');

// same value written again -> not marked dirty
const before = sp.rev; A.set('cards', ['fireball', 'potion']); await settle();
assert.equal(sp.rev, before, 'unchanged value not pushed');
console.log('ok  rewriting an identical value is not pushed');

// removal syncs as a tombstone
A.ls.removeItem('st_pins'); await settle(); await B.V.syncNow(); await settle();
assert.equal(B.ls.getItem('st_pins'), null, 'removal reached B');
console.log('ok  removeItem syncs');

// conflict: both edit offline-ish; the later write wins on both
A.set('chars', { who: 'A' }); await sleep(5); B.set('chars', { who: 'B' });
await settle(); await A.V.syncNow(); await B.V.syncNow(); await settle();
assert.deepEqual(A.get('chars'), { who: 'B' }); assert.deepEqual(B.get('chars'), { who: 'B' });
console.log('ok  conflicting edits: last write wins on both devices');

// book deleted on B -> removed on A; not re-uploaded by A
B.packs.delete('imp-book-1'); B.V.packDeleted('imp-book-1'); await settle();
assert.ok(sp.packs['imp-book-1'].deleted, 'tombstone on server');
await A.V.syncNow(); await settle();
assert.ok(!A.packs.has('imp-book-1'), 'A removed the book'); assert.deepEqual(A.log.removed, ['imp-book-1']);
assert.ok(sp.packs['imp-book-1'].deleted, 'A did not re-upload it');
console.log('ok  book deletion propagates and sticks');

// device with a key pulls BEFORE starting the app
const C = device('C'); await C.V.connect(key); await settle();
const C2ls = C.ls; // simulate a reload of C: new context, same storage
const D = (() => { const d = device('C-reload'); return d; })();
for (const [k, v] of C2ls._m) D.ls._m.set(k, v);
B.set('cards', ['newest']); await settle();
const ctx2 = D.ctx; const appBefore = D.appLoaded();
vm.runInContext(SRC.replace("'use strict';", "'use strict'; window.VSync=null;"), ctx2); // fresh boot of sync.js in that context
await sleep(300);
assert.equal(D.appLoaded(), appBefore + 1, 'app loaded after pull');
assert.deepEqual(JSON.parse(D.ls.getItem('st_cards')), ['newest'], 'data pulled before app start');
console.log('ok  page load: pulls first, then starts the app');

// rotate: old key stops working, data kept
const nk = await A.V.rotate();
assert.ok(spaces[nk] && !spaces[key], 'rotated'); await B.V.syncNow();
assert.match(B.V.status().error, /Unknown sync key/, 'old key fails on B');
console.log('ok  rotate: new key works, old key rejected');

// non-owner create blocked until owner opens it
const E = device('E');
await assert.rejects(E.V.create(), /only owner/); await A.V.setOpen(true); await E.V.create();
assert.ok(E.V.status().enabled && E.V.status().key !== nk, 'E has its own space');
console.log('ok  second key needs owner permission, gets its own space');
console.log('\nALL SYNC CLIENT TESTS PASSED');
process.exit(0);
