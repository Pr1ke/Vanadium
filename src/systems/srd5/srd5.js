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
    <div class="rd s5-body">${renderBlocks(s.body)}</div></div>`;
}

// ---- monsters (2024-style stat block) ----
const S5_AB = [['str', 'Str'], ['dex', 'Dex'], ['con', 'Con'], ['int', 'Int'], ['wis', 'Wis'], ['cha', 'Cha']];
const s5Mod = v => { const x = Math.floor((v - 10) / 2); return x >= 0 ? '+' + x : '−' + (-x); };
const s5Num = s => parseFloat(String(s).replace(/,/g, '')) || 0;
function s5RenderMonster(m, opts = {}) {
  if (!m) return '';
  const pinned = isPinned('monsters', m.gid);
  const line = (l, v) => v ? `<div><b>${l}</b> ${esc(v)}</div>` : '';
  const sec = (title, list) => list && list.length ? `<div class="s5-sec">${title ? `<h4>${title}</h4>` : ''}${list.map(a => `<p><b><i>${esc(a.name)}.</i></b> ${a.html}${a.spells ? a.spells.map(x => `<span class="s5-spl">${x}</span>`).join('') : ''}</p>`).join('')}</div>` : '';
  let h = `<div class="s5mon" data-mon="${m.gid}"><div class="s5-h"><div><div class="s5-n"><a data-go="monsters--${m.gid}">${esc(m.name)}</a></div><div class="s5-t">${esc(m.size)} ${esc(m.type)}, ${esc(m.alignment)}</div></div><button class="ab-pin ${pinned ? 'on' : ''}" data-pin="monsters--${m.gid}" title="Pin">★</button></div>
    <div class="s5-core"><div><b>AC</b> ${esc(m.ac)}${m.acNote ? ` (${esc(m.acNote)})` : ''}</div><div><b>HP</b> ${esc(m.hp)}${m.hpRoll ? ` (${esc(m.hpRoll)})` : ''}</div><div><b>Speed</b> ${esc(m.speed)}</div></div>
    <div class="s5-abs">${S5_AB.map(([k, l]) => `<div><span>${l}</span><b>${m.ab[k]}</b><em>${s5Mod(m.ab[k])}</em><i>save ${esc(m.saves[k])}</i></div>`).join('')}</div>
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
    cols: [['Name', s => s.name, 'nm'], ['Level', s5Lvl, 'mu', s => s.level], ['School', s => s.school, 'mu'], ['Casting Time', s => s.time.replace(/,.*$/, ''), 'mu'], ['Range', s => s.range, 'mu']],
    filters: [['Level', s5Lvl, (x, y) => (x === 'Cantrip' ? 0 : +x) - (y === 'Cantrip' ? 0 : +y)], ['School', s => s.school], ['Class', s => s.classes, null, true],
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
    view: m => `<div class="ent-h"><div style="flex:1"><h2>${esc(m.name)}</h2><div class="meta">CR ${esc(m.cr)} ${esc(m.type)} · ${esc(m.size)}</div></div><div class="ent-tools"><button class="ibtn ${isPinned('monsters', m.gid) ? 'on' : ''}" data-pin="monsters--${m.gid}">★</button><button class="ibtn" data-gobook="${esc(m.pack)}--${esc(m.ch || '')}">Book</button></div></div>${s5RenderMonster(m)}`
  },
  items: {
    cols: [['Name', i => i.name, 'nm'], ['Type', i => i.type, 'mu'], ['Rarity', s5Rarity, 'mu', i => S5_RARITY.indexOf(s5Rarity(i))], ['Attunement', i => i.attune ? 'Yes' : '', 'mu']],
    filters: [['Type', i => i.type], ['Rarity', s5Rarity, (x, y) => S5_RARITY.indexOf(x) - S5_RARITY.indexOf(y)], ['Attunement', i => i.attune ? 'Requires attunement' : 'No attunement']]
  },
  classes: { cols: [['Name', c => c.name, 'nm'], ['Hit Die', c => 'd' + c.hitDie, 'mu', c => c.hitDie], ['Primary Ability', c => c.primary, 'mu']], filters: [] },
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
  if (type === 'classes') return `d${e.hitDie} Hit Point Die · Primary ability: ${e.primary}`;
  if (type === 'species') return `${e.size} · Speed ${e.speed} feet`;
  if (type === 'backgrounds') return `Background · Feat: ${e.feat}`;
  if (type === 'feats') return `${e.type} Feat`;
  if (type === 'equipment') return [e.category, e.cost, e.weight ? e.weight + ' lb.' : ''].filter(Boolean).join(' · ');
}
const s5EntitySource = (type, e) => type === 'monsters' ? '' : `<div class="src">${esc(TYPES[type].one)} · <i>System Reference Document 5.2</i> (CC BY 4.0)</div>`;
function s5Preview(t, e) {
  if (t === 'monsters') return s5RenderMonster(e, { nosrc: true });
  if (t === 'spells') return s5SpellCard(e, { nopin: true });
}

// ---- menu, home, mobile browse ----
function s5Menu() {
  return [
    ['Rules', [['library', 'Library'], ['book--srd52', 'SRD 5.2 Reference'], ['-'], ['conditions'], ['equipment']]],
    ['Characters', [['classes'], ['species'], ['backgrounds'], ['feats'], ['-'], ['spells']]],
    ['Game Master', [['sessions', 'Sessions'], ['monsters'], ['book--srd5-monsters', 'Monsters A–Z'], ...PACKS.filter(p => p.kind === 'adventure').map(p => ['book--' + p.id, p.title]), ['-'], ['items'], ['cards', 'Cards: quests']]],
    ['Utilities', [['import', 'Import a PDF'], ['pinned', 'Pinned Items'], ['-'], ['sync', 'Sync across devices'], ['!update', 'Check for updates']]]
  ];
}
const S5_BLURB = { spells: 'Every SRD spell with level, school, classes and full text', monsters: 'Stat blocks for every SRD creature, filter by CR, type and size', items: 'Magic items by type, rarity and attunement',
  classes: 'Twelve classes with feature tables, features and a subclass each', species: 'Traits and options for each species', backgrounds: 'Ability scores, feats, skills and equipment',
  feats: 'Origin, general, fighting style and epic boon feats', conditions: 'Blinded, Charmed, Prone and the rest', equipment: 'Weapons, armor, tools and adventuring gear' };
function s5Home() {
  const adv = PACKS.filter(p => p.kind === 'adventure');
  const ok = k => TYPES[k] || !k.startsWith('book--') || PK[k.split('--')[1]];
  const tiles = [
    ['Rules', [['book--srd52', 'SRD 5.2 Reference', 'Abilities and skills, conditions, weapons, armor and more'], ['conditions'], ['equipment']]],
    ['Characters', [['classes'], ['species'], ['backgrounds'], ['feats'], ['spells']]],
    ['Game master', [['monsters'], ['book--srd5-monsters', 'Monsters A–Z', 'Read the bestiary like a book'], ['items'], ['sessions', 'Sessions', 'Prep folders for your game night'], ...adv.map(p => ['book--' + p.id, p.title, 'Adventure · imported']), ['library', 'Library', 'All books, including your imports'], ['import', 'Import a PDF', 'Add your own books'], ['pinned', 'Pinned items', 'Your starred spells, monsters and rules']]]
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
    sec('Game master', [['monsters'], ['items'], ['sessions', 'Sessions', 'Prep & print a game night'], ['cards', 'Cards', 'Print quest cards'], ...PACKS.filter(p => p.kind === 'adventure').map(p => ['book--' + p.id, p.title, 'Adventure']), ['import', 'Import a PDF', 'Add your own books']]) +
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
