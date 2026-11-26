
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
  return qrLoad || (qrLoad = new Promise((res, rej) => { if (window.qrcode) return res(); const s = document.createElement('script'); s.src = 'lib/qrcode.js?v=__ASSETV__'; s.onload = res; s.onerror = () => { qrLoad = null; rej(new Error('could not load the QR code library')); }; document.head.appendChild(s); }));
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
