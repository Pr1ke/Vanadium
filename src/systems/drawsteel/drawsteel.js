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
  $('#main').innerHTML = `<div class="resp"><div class="resp-bar"><b>Respite &amp; Downtime</b><span class="sp"></span><span class="rlinks">Rules: <a href="#book--heroes--the-basics--respite">Respite</a> · <a href="#book--heroes--downtime-projects">Downtime projects</a> · <a href="#book--heroes--rewards--renown">Renown &amp; followers</a></span></div><iframe id="respframe" src="respite.html?v=__ASSETV__" title="Respite: a Draw Steel downtime companion"></iframe></div>`;
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
$('#chars').innerHTML = CH.map(c => `<label>${c.slice(0, 3)}<input type="number" inputmode="numeric" data-ch="${c}" value="${chars[c] ?? 0}"></label>`).join('');
$$('#chars input').forEach(i => i.oninput = () => { chars[i.dataset.ch] = parseInt(i.value) || 0; store.set('chars', chars); });

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
$('#rgo').onclick = () => powerRoll('', null, null);

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

registerSystem({
  id: 'drawsteel', name: 'Draw Steel',
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
  pdfNotice: 'Draw Steel © MCDM Productions, LLC, used under the DRAW STEEL Creator License'
});
