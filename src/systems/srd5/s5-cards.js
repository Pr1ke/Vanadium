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
