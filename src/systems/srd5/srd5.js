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
  const tok = m.token ? s5ImgUrl(m.token) : '';   // imported monsters: token and artwork from the owner's picture folder
  let h = `${m.art && !opts.nosrc ? s5ImgFigure(m.art, 'mon-art', '') : ''}<div class="s5mon" data-mon="${m.gid}"><div class="s5-h">${tok ? `<span class="s5tok"><img src="${esc(tok)}" alt="" loading="lazy" data-zoom="1" ${S5_IMG_MISSING}></span>` : ''}<div style="flex:1"><div class="s5-n"><a data-go="monsters--${m.gid}">${esc(m.name)}</a></div><div class="s5-t">${esc(m.size)} ${esc(m.type)}, ${esc(m.alignment)}</div></div><button class="ab-pin ${pinned ? 'on' : ''}" data-pin="monsters--${m.gid}" title="Pin">★</button></div>
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
  if (b.t === 's5img') { const f = s5ImgFigure(b.path, 'bkimg ' + (!b.w || b.w > 330 ? 'wide' : 'side'), b.title); return f ? `<div${idx}>${pm}</div>` + f : ''; }
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
    ${s5PicturesCard()}
    ${mine.length ? `<input id="s5-impq" type="search" placeholder="Filter ${mine.length} books…" value="${esc(s5ImpQ)}" autocomplete="off">` : ''}
    ${groups.map(([k, label]) => { const xs = shown.filter(p => (p.kind === k) || (k === 'supplement' && !groups.some(g => g[0] === p.kind))); return xs.length ? `<h2>${label} <small>${xs.length}</small></h2><div class="s5implist">${xs.map(row).join('')}</div>` : ''; }).join('')
    || (mine.length ? '<div class="empty">No book matches.</div>' : '<div class="empty">Nothing imported yet. <a href="#import">Import files</a></div>')}</div>`;
  const f = $('#s5-impq'); if (f) f.oninput = () => { s5ImpQ = f.value; const pos = f.selectionStart; s5ImportsPage(); const n = $('#s5-impq'); n.focus(); n.setSelectionRange(pos, pos); };
  s5WirePictures(s5ImportsPage);
  document.title = 'Imports — Vanadium';
}

// ---- pictures in imported books: only paths are stored; they are shown from the owner's picture
// folder (Imports page → Pictures). Until that is set, no picture is loaded from anywhere.
const s5ImgBase = () => { const b = String(store.get('imgbase', '') || '').trim(); return /^(javascript|data|vbscript):/i.test(b) ? '' : b; };
function s5ImgUrl(path) {
  const base = s5ImgBase(); if (!base || !path) return '';
  if (/^https?:\/\//i.test(path)) return path;   // a full address in the file (only used once pictures are on)
  return base.replace(/\/?$/, '/') + String(path).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}
const S5_IMG_MISSING = `onerror="this.closest('figure,.s5tok')?.classList.add('s5img-missing')"`;   // not on the server: hide, don't show a broken image
function s5ImgFigure(path, cls, caption) {
  const u = s5ImgUrl(path); if (!u) return '';
  return `<figure class="${cls}"><img loading="lazy" src="${esc(u)}" alt="${esc(caption || '')}" data-zoom="1" ${S5_IMG_MISSING}>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
}
function s5PicturePaths() {   // every picture path in the imported books, for the settings card
  const out = []; const walk = bl => { for (const b of bl || []) { if (b.t === 's5img') out.push(b.path); if (b.blocks) walk(b.blocks); } };
  for (const p of PACKS.filter(p => !p.builtin)) { for (const c of p.chapters || []) walk(c.blocks); for (const m of p.monsters || []) { if (m.token) out.push(m.token); if (m.art) out.push(m.art); } for (const c of (p.entities || {}).classes || []) walk(c.body); }
  return out;
}
function s5PicturesCard() {
  const paths = s5PicturePaths(), base = s5ImgBase();
  if (!paths.length) return '';
  return `<div class="s5card s5pics"><h2>Pictures <span class="s5-sub">${paths.length.toLocaleString('en')} referenced</span></h2>
    <p class="note">Your imported books refer to pictures, maps and monster tokens by path, for example <code>${esc(paths[0])}</code>. Vanadium doesn’t store or download them. Put the picture folder on your server and enter its address; each picture is shown from that address plus its path.${base ? '' : ' <b>Pictures are off until you set this.</b>'}</p>
    <div class="s5row"><input id="s5-imgbase" placeholder="/vanadium-img/  or  https://your-site/img/" value="${esc(base)}" autocomplete="off" spellcheck="false"><button class="btn" id="s5-imgsave">Save</button>${base ? '<button class="btn ghost" id="s5-imgoff">Turn pictures off</button>' : ''}</div>
    ${base ? `<p class="note">Example: <a href="${esc(s5ImgUrl(paths[0]))}" target="_blank" rel="noopener">${esc(s5ImgUrl(paths[0]))}</a>. Pictures that aren’t on the server are simply left out.</p>` : ''}
    <p class="note">Anything in a public web folder can be opened by anyone who knows its address.</p></div>`;
}
function s5WirePictures(rerender) {
  const save = v => { store.set('imgbase', v); toast(v ? 'Pictures on' : 'Pictures off'); rerender(); };
  if ($('#s5-imgsave')) $('#s5-imgsave').onclick = () => { const v = $('#s5-imgbase').value.trim(); if (/^(javascript|data|vbscript):/i.test(v)) { toast('That is not a folder address'); return; } save(v); };
  if ($('#s5-imgbase')) $('#s5-imgbase').onkeydown = e => { if (e.key === 'Enter') $('#s5-imgsave').click(); };
  if ($('#s5-imgoff')) $('#s5-imgoff').onclick = () => save('');
}
