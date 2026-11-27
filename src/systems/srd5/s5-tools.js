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
const s5SaveEnc = () => { s5AssignTokens(S5ENC, false); store.set('enc', S5ENC); if (S5ENC.sessionRef) s5SyncEncToSession(); };
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

// ---- token colours: one coloured token per creature on the table, so everyone knows which goblin is
// which. Kept on the encounter (E.tokens: "gid|k" -> colour name; "*" = colour used twice). Same idea
// and look as Draw Steel's stones, with this system's own palette and on/off setting (store tokens/tokenson).
const S5_TOK_DEFAULT = [
  { name: 'Red', hex: '#d0312d' }, { name: 'Orange', hex: '#f28c28' }, { name: 'Yellow', hex: '#f4d03f' }, { name: 'Green', hex: '#3a9d3a' },
  { name: 'Blue', hex: '#2e6fd8' }, { name: 'Purple', hex: '#8e44ad' }, { name: 'Pink', hex: '#f08cc0' }, { name: 'White', hex: '#f4f4f4' },
  { name: 'Black', hex: '#222222' }, { name: 'Brown', hex: '#8b5a2b' }];
let S5TOK = store.get('tokens', null) || S5_TOK_DEFAULT.map(x => ({ ...x }));
let S5TOK_ON = store.get('tokenson', true);
const s5TokName = c => String(c || '').replace(/\*$/, '');
const s5TokHex = c => (S5TOK.find(x => x.name === s5TokName(c)) || { hex: '#999999' }).hex;
const s5Units = E => E.entries.flatMap(e => MON[e.gid] ? Array.from({ length: e.n }, (_, k) => ({ key: `${e.gid}|${k}`, gid: e.gid, k, n: e.n })) : []);
function s5AssignTokens(E, reroll) {
  if (!S5TOK_ON) return E;
  const old = reroll ? {} : (E.tokens || {}), names = S5TOK.filter(x => x.name).map(x => x.name), units = s5Units(E);
  const res = {}, used = new Set(); let over = 0;
  for (const u of units) { const c = old[u.key]; if (c && !/\*$/.test(c) && names.includes(c) && !used.has(c)) { res[u.key] = c; used.add(c); } }
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (const u of units) {
    if (res[u.key]) continue;
    const c = shuffle(names.filter(n => !used.has(n)))[0];
    if (c) { res[u.key] = c; used.add(c); } else { over++; res[u.key] = (names[Math.floor(Math.random() * names.length)] || 'Grey') + '*'; }
  }
  E.tokens = res; E.tokenOver = over; return E;
}
const s5Swatch = c => { const dup = /\*$/.test(c), n = s5TokName(c); return `<span class="stone ${dup ? 'dup' : ''}" style="background:${s5TokHex(c)}" title="${esc(n + ' token' + (dup ? ' (colour used twice: not enough colours)' : ''))}"></span>`; };
const s5EntTokens = (E, e) => S5TOK_ON && E.tokens ? `<span class="stones">${Array.from({ length: e.n }, (_, k) => E.tokens[`${e.gid}|${k}`]).filter(Boolean).map(s5Swatch).join('')}</span>` : '';
function s5TokensDialog(after) {
  const el = document.createElement('div'); el.className = 'dlg';
  const draw = () => { el.innerHTML = `<div class="dlg-b"><h2>Token colours</h2><p>The colours of the tokens or miniature bases you put on the table. Each creature gets its own colour, so “the red goblin” is never ambiguous. A colour is only used twice when there aren’t enough (marked with a dotted ring).</p>
    <label class="row-c"><input type="checkbox" id="tk-on" ${S5TOK_ON ? 'checked' : ''}> Give creatures token colours</label>
    <div class="stlist">${S5TOK.map((x, i) => `<div class="strow"><input type="color" data-th="${i}" value="${x.hex}"><input data-tn="${i}" value="${esc(x.name)}" aria-label="Colour name"><button class="ibtn" data-td="${i}" title="Remove">✕</button></div>`).join('')}</div>
    <div class="dlgfoot"><button class="btn ghost" id="tk-add">+ Colour</button><button class="btn ghost" id="tk-def">Defaults</button><span style="flex:1"></span><button class="btn" id="tk-ok">Save & reroll</button></div></div>`;
    $$('[data-th]', el).forEach(i => i.oninput = () => S5TOK[+i.dataset.th].hex = i.value);
    $$('[data-tn]', el).forEach(i => i.oninput = () => S5TOK[+i.dataset.tn].name = i.value.trim());
    $$('[data-td]', el).forEach(b => b.onclick = () => { S5TOK.splice(+b.dataset.td, 1); draw(); });
    $('#tk-add', el).onclick = () => { S5TOK.push({ name: 'Colour ' + (S5TOK.length + 1), hex: '#888888' }); draw(); };
    $('#tk-def', el).onclick = () => { S5TOK = S5_TOK_DEFAULT.map(x => ({ ...x })); draw(); };
    $('#tk-ok', el).onclick = () => { S5TOK = S5TOK.filter(x => x.name); S5TOK_ON = $('#tk-on', el).checked; store.set('tokens', S5TOK); store.set('tokenson', S5TOK_ON); el.remove(); after(); };
  };
  draw(); el.onclick = e => { if (e.target === el) el.remove(); }; document.body.appendChild(el);
}

// ---- encounter builder (#encounter) ----
let s5EncQ = '';
function s5EncounterPage() {
  if (!MONS.length) { $('#main').innerHTML = '<div class="empty">Loading monsters…</div>'; return; }
  const E = S5ENC, M = s5EncMath(E);
  if (S5TOK_ON && E.entries.length && s5Units(E).some(u => !(E.tokens || {})[u.key])) { s5AssignTokens(E, false); store.set('enc', E); }
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
        ${E.entries.length ? `<div class="s5ents">${E.entries.map((e, i) => { const m = MON[e.gid]; return m ? `<div class="s5ent"><a class="lnk" data-go="monsters--${esc(m.gid)}">${esc(m.name)}${s5EntTokens(E, e)}</a><span>CR ${esc(m.cr)} · ${(s5Xp(m) * e.n).toLocaleString('en')} XP</span><div class="step"><button data-edec="${i}">−</button><b>${e.n}</b><button data-einc="${i}">+</button></div></div>` : ''; }).join('')}</div>` : '<div class="empty">No creatures yet.</div>'}
        <div class="negacts"><button class="btn" id="s5-init" ${E.entries.length ? '' : 'disabled'}>⚔ Run initiative</button><button class="btn ghost" id="s5-save">Save</button><button class="btn ghost" id="s5-new">New</button><button class="btn ghost" id="s5-pdf" ${E.entries.length ? '' : 'disabled'} title="Printable sheet: turn order, token colours, HP and condition trackers, stat blocks">⬇ Table sheet (PDF)</button></div>
        <div class="negacts s5tokbar"><button class="btn ghost sm" id="s5-tok" ${E.entries.length ? '' : 'disabled'} title="${S5TOK_ON ? 'New token colours' : 'Token colours are off'}">🎲 Tokens</button><button class="btn ghost sm" id="s5-tokcfg" title="Token colours">⚙</button>${S5TOK_ON && E.tokenOver ? `<span class="note">Not enough colours: ${E.tokenOver} used twice (dotted ring). Add colours under ⚙.</span>` : ''}</div>
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
  $('#s5-tok').onclick = () => { if (!S5TOK_ON) { s5TokensDialog(re); return; } s5AssignTokens(E, true); re(); toast('New token colours'); };
  $('#s5-tokcfg').onclick = () => s5TokensDialog(() => { s5AssignTokens(E, true); re(); });
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
  const tok = S5TOK_ON ? (s5AssignTokens(E, false).tokens || {}) : {};
  const list = E.party.map(c => ({ id: s5Uid('c'), name: c.name, pc: true, init: null, mod: 0, conds: [] }));
  for (const e of E.entries) {
    const m = MON[e.gid]; if (!m) continue;
    for (let k = 1; k <= e.n; k++) {
      const mod = s5Int(m.init);
      list.push({ id: s5Uid('c'), name: m.name + (e.n > 1 ? ' ' + k : ''), gid: m.gid, init: s5Die(20) + mod, mod, ac: m.ac, hp: m.hp, maxHp: m.hp, conds: [], ...(tok[`${e.gid}|${k - 1}`] ? { tok: tok[`${e.gid}|${k - 1}`] } : {}) });
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
      <div class="s5iname">${c.gid ? `<span class="s5itok">${c.tok && S5TOK_ON ? s5Swatch(c.tok) : ''}<a class="lnk" data-go="monsters--${esc(c.gid)}">${esc(c.name)}</a></span>` : `<b>${esc(c.name)}</b>`}<span>${c.pc ? 'Character' : `AC ${esc(c.ac)} · init ${c.mod >= 0 ? '+' : '−'}${Math.abs(c.mod)}`}</span>
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
  if (S5TOK_ON && s5Units(E).some(u => !(E.tokens || {})[u.key])) s5AssignTokens(E, false);
  const M = s5EncMath(E), w = await makeWriter(E.name); w.newPage();
  const { rgb } = w, cream = w.cream;
  const hexRgb = h => { const v = parseInt(String(h).slice(1), 16); return rgb((v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); };
  const tokOf = key => S5TOK_ON && E.tokens ? E.tokens[key] : null;
  const dot = (c, x, y, r = 5) => w.circ(x, y, r, { fill: hexRgb(s5TokHex(c)), bw: 0.7 });
  const fit = (s, width, size, font = w.F) => { s = PSAN(s); if (w.tw(s, size, font) <= width) return s; while (s.length > 1 && w.tw(s + '...', size, font) > width) s = s.slice(0, -1); return s + '...'; };
  const sec = (t, note) => { w.ensure(46); w.y -= 4; w.T(t, w.MG, w.y - 10, 10, w.FB); if (note) w.T(fit(note, w.CW - w.tw(t, 10, w.FB) - 10, 7.5), w.MG + w.tw(t, 10, w.FB) + 8, w.y - 10, 7.5, w.F, w.grey); w.y -= 16; };
  w.header(E.name, `${E.party.length} characters (${[...new Set(E.party.map(c => 'level ' + c.level))].join(', ')}) · ${M.xp.toLocaleString('en')} XP · ${M.label}`, 'Encounter');
  w.para(`<b>Difficulty: ${M.label}.</b> XP budget for this party: ${M.budget.map((b, i) => `${S5_DIFF[i]} ${b.toLocaleString('en')}`).join(' · ')}. This encounter: ${M.xp.toLocaleString('en')} XP.`, { size: 8.5 });
  const units = s5Units(E);
  // ---- turn order: one row per combatant, a tick box per round
  sec('TURN ORDER', 'Write each initiative in the first column, then tick a round when that combatant has acted.');
  const rounds = 10, initW = 34, nameW = 190, rc = (w.CW - initW - nameW) / rounds, rowH = 15;
  const trow = (cells, o = {}) => {
    w.ensure(rowH); const y = w.y - rowH;
    w.box(w.MG, y, initW, rowH, { bw: 0.5, fill: o.head ? w.light : undefined }); if (cells.init) w.T(cells.init, w.MG + 4, y + 4.5, 7.5, w.FB, w.grey);
    w.box(w.MG + initW, y, nameW, rowH, { bw: 0.5, fill: o.head ? w.light : o.pc ? cream : undefined });
    let x = w.MG + initW + 5; if (cells.tok) { dot(cells.tok, x + 4, y + rowH / 2, 4.5); x += 13; }
    w.T(fit(cells.name, nameW - (x - w.MG - initW) - 4, 8.5, w.FB), x, y + 4.5, 8.5, w.FB);
    for (let r = 0; r < rounds; r++) { const rx = w.MG + initW + nameW + r * rc; w.box(rx, y, rc, rowH, { bw: 0.5, fill: o.head ? w.light : undefined }); if (o.head) w.T('R' + (r + 1), rx + rc / 2 - w.tw('R' + (r + 1), 7, w.FB) / 2, y + 4.5, 7, w.FB); }
    w.y -= rowH;
  };
  trow({ init: 'Init', name: 'Combatant' }, { head: true });
  E.party.forEach(c => trow({ name: c.name }, { pc: true }));
  units.forEach(u => { const m = MON[u.gid]; trow({ name: m.name + (u.n > 1 ? ' #' + (u.k + 1) : ''), tok: tokOf(u.key) }); });
  for (let i = 0; i < 2; i++) trow({ name: '' });
  w.y -= 8;
  // ---- one card per creature: token, AC and the rest, HP tracker, limited uses, conditions
  sec('CREATURES', 'Track hit points and conditions here. Bloodied: at half hit points or fewer.');
  const CONDS = [...S5_CONDS, 'Concentrating'], gx = w.MG + 262, gw = w.CW - 262 - 6, ccols = 4, ccw = gw / ccols;
  for (const u of units) {
    const m = MON[u.gid], c = tokOf(u.key);
    // limited uses (N/Day, Recharge, legendary actions), laid out in rows under the HP boxes
    const uses = [];
    for (const a of [...(m.traits || []), ...(m.actions || []), ...(m.bonus || []), ...(m.reactions || [])]) {
      const d = /(\d+)\/Day/.exec(a.name), r = /Recharge ([^)]+)/.exec(a.name), nm = a.name.replace(/\s*\(.*$/, '');
      if (d) uses.push([nm, +d[1]]); else if (r) uses.push([`${nm} (recharge ${r[1]})`, 1]);
    }
    if ((m.legendary || []).length) uses.push(['Legendary actions', 3]);
    const urows = [[]], ux0 = w.MG + 7, umax = gx - 10; let ux = ux0;
    for (const [nm, n] of uses) { const lw = w.tw(nm, 6.8) + 4 + n * 10; if (ux + lw > umax && urows[urows.length - 1].length) { urows.push([]); ux = ux0; } urows[urows.length - 1].push([nm, n, ux]); ux += lw + 8; }
    const h = Math.max(80, 66 + urows.length * 11);
    w.ensure(h + 6); const top = w.y;
    w.box(w.MG, top - h, w.CW, h, { bw: 0.9 });
    let x = w.MG + 7; if (c) { dot(c, x + 5, top - 10.5, 5.5); x += 15; }
    const title = fit(m.name + (u.n > 1 ? ' #' + (u.k + 1) : ''), 240, 11.5, w.FB), tw = w.tw(title, 11.5, w.FB); w.T(title, x, top - 14, 11.5, w.FB);
    const meta = `${c ? s5TokName(c) + ' token · ' : ''}CR ${m.cr} · ${m.size} ${m.type}`;
    w.T(fit(meta, w.CW - (x - w.MG) - tw - 16, 7.5), x + tw + 8, top - 14, 7.5, w.F, w.grey);
    const info = [`AC ${m.ac}`, `Speed ${m.speed}`, `Initiative ${m.init}`, m.resist && 'Resistances ' + m.resist, m.immune && 'Immunities ' + m.immune, m.vuln && 'Vulnerabilities ' + m.vuln, m.senses].filter(Boolean).join(' · ');
    w.T(fit(info, w.CW - 14, 7.2), w.MG + 7, top - 25, 7.2, w.F, w.grey);
    // hit points
    const by = top - 58;
    w.box(w.MG + 7, by, 50, 26, { fill: cream }); w.T('MAX HP', w.MG + 11, by + 18, 6, w.FB, w.grey); w.T(String(m.hp), w.MG + 11, by + 5, 12, w.FB);
    w.box(w.MG + 61, by, 140, 26); w.T('HIT POINTS', w.MG + 65, by + 18, 6, w.FB, w.grey); const bl = `bloodied <= ${Math.floor(m.hp / 2)}`; w.T(bl, w.MG + 197 - w.tw(bl, 6), by + 18, 6, w.F, w.grey);
    w.box(w.MG + 205, by, 46, 26); w.T('TEMP HP', w.MG + 209, by + 18, 6, w.FB, w.grey);
    urows.forEach((row, ri) => { const uy = by - 13 - ri * 11; for (const [nm, n, x0] of row) { w.T(nm, x0, uy + 1, 6.8); let bx = x0 + w.tw(nm, 6.8) + 4; for (let i = 0; i < n; i++) { w.cb(bx, uy, 7.5); bx += 10; } } });
    // conditions
    CONDS.forEach((k, i) => { const cx = gx + (i % ccols) * ccw, cy = top - 40 - Math.floor(i / ccols) * 11; w.cb(cx, cy, 7.5); w.T(k, cx + 10, cy + 1.2, 6.8); });
    w.y = top - h - 5;
  }
  // ---- stat blocks, one per kind of creature
  w.h('Stat blocks', 2);
  for (const e of E.entries) {
    const m = MON[e.gid]; if (!m) continue;
    const toks = S5TOK_ON && E.tokens ? Array.from({ length: e.n }, (_, k) => E.tokens[`${e.gid}|${k}`]).filter(Boolean) : [];
    w.h(m.name + (e.n > 1 ? ` (x${e.n})` : ''), 3, `${m.size} ${m.type}, ${m.alignment}${toks.length ? ' · tokens: ' + toks.map(s5TokName).join(', ') : ''}`);
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
        if (S5TOK_ON && s5Units(E).some(u => !(E.tokens || {})[u.key])) { s5AssignTokens(E, false); saveSessions(); }
        return top + `<div class="s5diff" style="--dc:${S5_DCOL[Math.max(0, M.di)]}"><b>${M.label}</b><span>${M.xp.toLocaleString('en')} XP · budgets ${M.budget.map((b, i) => S5_DIFF[i] + ' ' + b.toLocaleString('en')).join(', ')} · ${E.party.length} characters</span></div>
          <div class="actrow"><button class="btn" id="d-open">Open in Encounter Builder</button><button class="btn ghost" id="d-run">⚔ Run initiative</button><button class="btn ghost" id="d-repl">Replace with the builder’s current encounter</button></div>
          ${E.entries.map(e => { const m = MON[e.gid]; return m ? `<div class="s5ent"><a class="lnk" data-go="monsters--${esc(m.gid)}">${e.n} × ${esc(m.name)}${s5EntTokens(E, e)}</a><span>CR ${esc(m.cr)} · AC ${m.ac} · HP ${m.hp} · ${(s5Xp(m) * e.n).toLocaleString('en')} XP</span></div>` : ''; }).join('')}`;
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
      async pdf(S, d) { if (!d.enc || !d.enc.entries.some(e => MON[e.gid])) return null; const b = await s5EncounterPdf(d.enc); saveSessions(); return b; }
    }
  }
};

// dice buttons, "+ Encounter" on monster pages
function s5OnClick(e) {
  const r = e.target.closest('[data-dice]'); if (r) { e.preventDefault(); openRoller(); s5Roll(r.dataset.dice, r.dataset.lab || r.dataset.dice); return true; }
  const a = e.target.closest('[data-addenc5]'); if (a) { e.preventDefault(); s5AddToEnc(a.dataset.addenc5); return true; }
}
