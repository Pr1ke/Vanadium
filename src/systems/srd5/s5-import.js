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

// ---- pictures: references only ----
// {href: {type: 'internal', path: 'adventure/ToA/x.webp'}} -> a relative path, shown from the owner's picture
// folder; {type: 'external', url} is kept as a full URL. No image data is stored, nothing is downloaded here.
function s5iImage(e) {
  const h = e && e.href; if (!h) return null;
  const path = h.type === 'internal' ? h.path : h.type === 'external' ? h.url : null;
  if (!path || /^\s*(javascript|data):/i.test(path)) return null;
  return { t: 's5img', path, title: e.title ? String(e.title).replace(/\{@\w+\s*([^{}|]*)[^{}]*\}/g, '$1') : '', w: e.width || 0, h: e.height || 0 };
}
// 5etools' token naming: img/bestiary/tokens/<SOURCE>/<Name>.webp (accents dropped, quotes removed)
const s5iTokenPath = (name, src) => `bestiary/tokens/${src}/${String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Æ/g, 'AE').replace(/æ/g, 'ae').replace(/"/g, '')}.webp`;

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
      // pictures: only the path is kept; the app shows it from the owner's picture folder (Imports page setting)
      case 'image': { const im = s5iImage(e); if (im) out.push(im); break; }
      case 'gallery': for (const g of e.images || []) { const im = s5iImage(g); if (im) out.push(im); } break;
      case 'hr': break;
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
    group: s5iType(typeof m.type === 'object' ? m.type.type : m.type),
    token: m.hasToken ? (m.token ? s5iTokenPath(m.token.name, m.token.source) : s5iTokenPath(m.name, m.source || src)) : ''
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
  out.hasToken = !!m.hasToken; delete out.token;   // a variant's token is its own, never the base monster's
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
  // artwork paths from fluff files in the batch (fluff-bestiary-*: monsterFluff, fluff-class-*: classFluff)
  const art = new Map();
  for (const p of parsed) for (const k of ['monsterFluff', 'classFluff']) for (const f of p.data[k] || []) {
    const im = (f.images || []).map(s5iImage).find(Boolean); if (im) art.set((k + '|' + f.name + '|' + (f.source || '')).toLowerCase(), im);
  }
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
        if (m) { const a = art.get(('monsterFluff|' + raw.name + '|' + (raw.source || src)).toLowerCase()); if (a) m.art = a.path; p.monsters.push(m); } else skipped++;
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
      p.entities = { classes: s5iClasses(data) };
      for (const c of p.entities.classes) { const a = art.get(('classFluff|' + c.name + '|' + c.srcCode).toLowerCase()); if (a) c.body.unshift(a); }   // class artwork at the top
      packs.push(p);
    } else if (!/^(index|fluff-index|sources|foundry)\.json$|^fluff-/i.test(name)) notes.push(`${name}: no adventure, book, monsters, spells or class found, skipped`);
  }
  // two files must never become the same book (one would silently replace the other)
  const seen = new Set();
  for (const p of packs) { if (seen.has(p.id)) { let k = 2; while (seen.has(p.id + '-' + k)) k++; p.id += '-' + k; p.title += ` (${k})`; } seen.add(p.id); }
  progress('Done', 1);
  return { packs, notes };
}
