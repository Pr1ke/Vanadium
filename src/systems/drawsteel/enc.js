
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
