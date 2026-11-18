// Vanadium sync client. Loaded as a classic script BEFORE app.js (see body.html):
// it pulls the latest synced data into localStorage first, then loads app.js, so every
// module starts with current data. Afterwards it pushes local changes (debounced) and
// pulls other devices' changes when the tab becomes visible.
//
// Synced: every localStorage key starting with st_ (except st_sync_* and st_updchk) and the
// Respite tool's key, last write wins per key. Imported books (IndexedDB "steeltools"/packs)
// are uploaded once in 1 MB gzip chunks and downloaded on devices that don't have them.
// Server: sync.php. Nothing is sent anywhere unless the user turns sync on.
(function () {
  'use strict';
  let LS = null; try { LS = window.localStorage; } catch (e) { }
  const RESPITE = 'drawsteel-respite-v1';
  const K = { key: 'st_sync_key', meta: 'st_sync_meta', dirty: 'st_sync_dirty', rev: 'st_sync_rev', last: 'st_sync_last', pdel: 'st_sync_pdel' };
  const CHUNK = 1024 * 1024;
  const tracked = k => typeof k === 'string' && ((k.startsWith('st_') && !k.startsWith('st_sync_') && k !== 'st_updchk') || k === RESPITE);

  // raw storage (never marks anything dirty)
  const oSet = Storage.prototype.setItem, oRem = Storage.prototype.removeItem;
  const rget = k => { try { return LS.getItem(k); } catch (e) { return null; } };
  const rset = (k, v) => { try { v == null ? oRem.call(LS, k) : oSet.call(LS, k, v); return true; } catch (e) { return false; } };
  const jget = (k, d) => { try { const v = rget(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const jset = (k, v) => rset(k, JSON.stringify(v));

  const S = { status: 'off', error: '', info: null, remotePacks: null, progress: null, appStarted: false, hooks: null };
  const listeners = new Set();
  const emit = () => listeners.forEach(f => { try { f(); } catch (e) { } });
  const key = () => rget(K.key);
  const setErr = e => { S.error = e ? (e.message || String(e)) : ''; S.status = e ? 'error' : 'idle'; emit(); };

  // ---- change tracking: patch setItem/removeItem (also used for the Respite iframe) ----
  function mark(k) {
    const meta = jget(K.meta, {}); meta[k] = Date.now(); jset(K.meta, meta);
    const d = new Set(jget(K.dirty, [])); d.add(k); jset(K.dirty, [...d]);
    schedulePush();
  }
  function patch(win) {
    const P = win.Storage.prototype; if (P.__vsync) return; P.__vsync = true;
    const set = P.setItem, rem = P.removeItem;
    P.setItem = function (k, v) {
      const watch = key() && tracked(k) && this === win.localStorage;
      const old = watch ? this.getItem(k) : null;
      set.call(this, k, v);
      if (watch && old !== String(v)) mark(k);
    };
    P.removeItem = function (k) {
      const watch = key() && tracked(k) && this === win.localStorage && this.getItem(k) != null;
      rem.call(this, k);
      if (watch) mark(k);
    };
  }
  if (LS) patch(window);

  // ---- server calls ----
  async function api(a, { method = 'GET', query = '', body, raw, k = key(), keepalive = false } = {}) {
    const headers = {}; if (k) headers['X-Sync-Key'] = k;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (raw) headers['Content-Type'] = 'application/octet-stream';
    let r;
    try { r = await fetch('sync.php?a=' + a + query, { method, headers, cache: 'no-store', keepalive, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) }); }
    catch (e) { throw new Error('Could not reach the server. Are you offline?'); }
    let j = null; try { j = await r.json(); } catch (e) { }
    if (!j) throw new Error(r.status === 404 ? 'This server has no sync.php. Sync needs the PHP version of the site.' : 'Unexpected reply from the sync server (' + r.status + ').');
    if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.status = r.status; throw e; }
    return j;
  }

  // ---- items ----
  function applyRemote(k, it, meta, dirty, changed) {
    const cur = rget(k);
    if (cur !== it.v) { if (!rset(k, it.v)) return; changed.push(k); }
    meta[k] = it.t; dirty.delete(k);
  }
  async function pull() {
    const st = await api('state', { query: '&since=' + (jget(K.rev, 0) || 0) });
    S.info = { owner: st.owner, open: st.open, usage: st.usage, quota: st.quota, cards: st.cards, cardTraffic: st.cardTraffic, salt: st.salt };
    S.remotePacks = st.packs || {};
    const meta = jget(K.meta, {}), dirty = new Set(jget(K.dirty, [])), changed = [];
    for (const [k, it] of Object.entries(st.items || {})) {
      if (!tracked(k)) continue;
      const lt = meta[k] || 0;
      if (it.t > lt) applyRemote(k, it, meta, dirty, changed);
      else if (it.t < lt) dirty.add(k);
    }
    jset(K.meta, meta); jset(K.dirty, [...dirty]); jset(K.rev, st.rev); jset(K.last, Date.now());
    if (changed.length && S.appStarted) notifyChanged();
    if (dirty.size) schedulePush();
    return changed;
  }
  let pushing = false, pushAgain = false, pushT = null;
  function schedulePush(ms = 1500) { clearTimeout(pushT); pushT = setTimeout(() => push().catch(setErr), ms); }
  async function push({ keepalive = false } = {}) {
    if (!key()) return;
    if (pushing) { pushAgain = true; return; }
    const dirty = jget(K.dirty, []); if (!dirty.length) return;
    pushing = true; S.status = 'syncing'; emit();
    try {
      const meta = jget(K.meta, {}), sent = {};
      let batch = {}, size = 0;
      const send = async () => {
        const r = await api('put', { method: 'POST', body: { items: batch }, keepalive: keepalive && size < 60000 });
        const m = jget(K.meta, {}), d = new Set(jget(K.dirty, [])), changed = [];
        for (const k of Object.keys(batch)) if (m[k] === sent[k]) d.delete(k);   // unchanged since we sent it
        for (const [k, it] of Object.entries(r.rejected || {})) applyRemote(k, it, m, d, changed); // server had newer
        jset(K.meta, m); jset(K.dirty, [...d]);
        if (changed.length) notifyChanged();
        batch = {}; size = 0;
      };
      for (const k of dirty) {
        const v = rget(k); sent[k] = meta[k] || Date.now();
        batch[k] = { t: sent[k], v }; size += k.length + (v ? v.length : 0);
        if (size > 2e6) await send();
      }
      if (Object.keys(batch).length) await send();
      jset(K.last, Date.now()); setErr(null);
    } finally {
      pushing = false;
      if (pushAgain) { pushAgain = false; schedulePush(200); }
    }
  }

  // ---- imported books ----
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => { const q = indexedDB.open('steeltools', 1); q.onupgradeneeded = () => q.result.createObjectStore('packs', { keyPath: 'id' }); q.onsuccess = () => res(this.db = q.result); q.onerror = () => rej(q.error); });
    },
    async req(mode, f) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('packs', mode); const r = f(t.objectStore('packs')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); },
    all() { return this.req('readonly', s => s.getAll()); },
    put(p) { return this.req('readwrite', s => s.put(p)); },
    del(id) { return this.req('readwrite', s => s.delete(id)); }
  };
  const gz = async (u8, dir) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(dir ? new CompressionStream('gzip') : new DecompressionStream('gzip'))).arrayBuffer());
  const prog = (label, done, total) => { S.progress = label ? { label, done, total } : null; emit(); };

  async function uploadPack(p) {
    const title = p.title || p.id;
    prog('Uploading “' + title + '”', 0, 1);
    const data = await gz(new TextEncoder().encode(JSON.stringify(p)), true);
    const n = Math.max(1, Math.ceil(data.length / CHUNK));
    for (let i = 0; i < n; i++) {
      await api('pack_chunk', { method: 'POST', query: '&id=' + encodeURIComponent(p.id) + '&n=' + i, raw: data.subarray(i * CHUNK, (i + 1) * CHUNK) });
      prog('Uploading “' + title + '”', i + 1, n);
    }
    const t = Date.now();
    try { await api('pack_done', { method: 'POST', body: { id: p.id, title, t, chunks: n, size: data.length } }); }
    catch (e) { if (e.status === 409) { await removeLocalPack(p.id); return; } throw e; }
    S.remotePacks[p.id] = { t, title, chunks: n, size: data.length };
  }
  async function downloadPack(id, r) {
    const title = r.title || id, parts = []; let len = 0;
    for (let i = 0; i < r.chunks; i++) {
      prog('Downloading “' + title + '”', i, r.chunks);
      const res = await fetch('sync.php?a=pack_chunk&id=' + encodeURIComponent(id) + '&n=' + i, { headers: { 'X-Sync-Key': key() }, cache: 'no-store' });
      if (!res.ok) throw new Error('Download of “' + title + '” failed (' + res.status + ').');
      const u8 = new Uint8Array(await res.arrayBuffer()); parts.push(u8); len += u8.length;
    }
    const all = new Uint8Array(len); let o = 0; for (const u of parts) { all.set(u, o); o += u.length; }
    const p = JSON.parse(new TextDecoder().decode(await gz(all, false)));
    await idb.put(p);
    if (S.hooks) S.hooks.added(p);
  }
  async function removeLocalPack(id) { try { await idb.del(id); } catch (e) { } if (S.hooks) S.hooks.removed(id); }

  let packBusy = false, packAgain = false;
  async function syncPacks() {
    if (!key() || !S.hooks) return;
    if (packBusy) { packAgain = true; return; }
    if (typeof CompressionStream === 'undefined' || !window.indexedDB) return;
    packBusy = true; S.status = 'syncing'; emit();
    try {
      for (const d of jget(K.pdel, [])) {   // deletions made on this device
        await api('pack_del', { method: 'POST', body: d });
        jset(K.pdel, jget(K.pdel, []).filter(x => x.id !== d.id));
      }
      await pull();
      const R = S.remotePacks, local = await idb.all(), have = new Set(local.map(p => p.id));
      for (const p of local) if (R[p.id] && R[p.id].deleted) await removeLocalPack(p.id);
      for (const p of local) if (!R[p.id]) await uploadPack(p);
      for (const [id, r] of Object.entries(R)) if (!r.deleted && !have.has(id)) await downloadPack(id, r);
      setErr(null);
    } catch (e) { setErr(e); }
    finally {
      packBusy = false; prog(null);
      if (packAgain) { packAgain = false; syncPacks(); }
    }
  }

  // ---- whole sync ----
  async function syncNow() {
    if (!key()) return;
    S.status = 'syncing'; emit();
    try { await pull(); await push(); setErr(null); } catch (e) { setErr(e); }
    await syncPacks();
  }
  function notifyChanged() {
    if (window.vShowBar) window.vShowBar('syncbar', 'Changes from another device were synced. Reload to see them.');
  }

  // join a space: mark this device's data so the synced copy wins where both have a value
  function adopt(k, fresh) {
    rset(K.key, k); jset(K.rev, 0); jset(K.pdel, []);
    const meta = {}, dirty = [];
    for (let i = 0; i < LS.length; i++) { const n = LS.key(i); if (tracked(n)) { meta[n] = fresh ? Date.now() : 1; dirty.push(n); } }
    jset(K.meta, meta); jset(K.dirty, dirty);
  }

  const VSync = {
    patch,
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    status() {
      return { enabled: !!key(), key: key(), status: key() ? S.status : 'off', error: S.error, info: S.info, progress: S.progress,
        last: jget(K.last, 0), pending: jget(K.dirty, []).length, books: S.remotePacks ? Object.values(S.remotePacks).filter(r => !r.deleted).length : null,
        https: location.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) };
    },
    validKey: k => /^[A-Za-z0-9_-]{43}$/.test(k || ''),
    async create() { const r = await api('create', { method: 'POST', body: {}, k: null }); adopt(r.key, true); await syncNow(); return r; },
    async connect(k) {
      k = (k || '').trim(); if (!this.validKey(k)) throw new Error('That doesn’t look like a sync key (43 letters, digits, - and _).');
      await api('state', { k });   // throws "Unknown sync key." if wrong
      adopt(k, false); await syncNow(); notifyChanged();
    },
    disconnect() { for (const n of Object.values(K)) rset(n, null); S.info = null; S.remotePacks = null; setErr(null); S.status = 'off'; emit(); },
    async rotate() { await push(); const r = await api('rotate', { method: 'POST', body: {} }); rset(K.key, r.key); emit(); return r.key; },
    async setOpen(open) { await api('setopen', { method: 'POST', body: { open } }); if (S.info) S.info.open = open; emit(); },
    syncNow,
    // ---- public card images (QR codes on card backs; see card.php) ----
    async cardSalt() { if (!S.info || !S.info.salt) await pull(); return S.info.salt; },
    async cardHas(ids) { return (await api('card_has', { method: 'POST', body: { ids } })).have || []; },
    async cardPut(id, blob) { await api('card_put', { method: 'POST', query: '&id=' + encodeURIComponent(id), raw: blob }); },
    async cardClear() { const r = await api('card_clear', { method: 'POST', body: {} }); await pull(); emit(); return r.removed; },
    packsChanged() { if (key()) syncPacks(); },
    packDeleted(id) { if (!key()) return; const l = jget(K.pdel, []).filter(x => x.id !== id); l.push({ id, t: Date.now() }); jset(K.pdel, l); syncPacks(); },
    appReady(hooks) {
      S.hooks = hooks;
      if (!key()) return;
      syncPacks();
      let lastPull = Date.now();
      const tick = () => { if (key() && !document.hidden && Date.now() - lastPull > 20000) { lastPull = Date.now(); pull().catch(setErr); } };
      document.addEventListener('visibilitychange', tick);
      setInterval(tick, 2 * 60 * 1000 + 1000);
      window.addEventListener('pagehide', () => { if (jget(K.dirty, []).length) push({ keepalive: true }).catch(() => { }); });
    }
  };
  window.VSync = VSync;

  // ---- boot: pull first (max 4 s), then start the app ----
  // index.html loads this as sync.js?v=<build> data-v=<build>; pass the same version to app.js
  const ASSET_V = (document.currentScript && document.currentScript.dataset && document.currentScript.dataset.v) || '';
  function startApp() {
    if (S.appStarted) return; S.appStarted = true;
    const s = document.createElement('script'); s.type = 'module'; s.src = ASSET_V ? 'app.js?v=' + ASSET_V : 'app.js'; document.body.appendChild(s);
  }
  if (LS && key()) {
    S.status = 'syncing';
    const p = pull().then(() => setErr(null), setErr);
    Promise.race([p, new Promise(r => setTimeout(r, 4000))]).then(startApp);
    p.then(() => push()).catch(setErr);
  } else startApp();
})();
