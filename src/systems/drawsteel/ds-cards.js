// Draw Steel card kinds for the core card generator (cards.js): treasure cards, retainer and
// follower cards, Draw Steel quest rewards and how rewards are found in adventure text.
// Registered as SYS.cards in register.js. (Moved verbatim from cards.js where possible.)

const DS_CARD_COL = { Consumable: '#3d7a4a', Trinket: '#2d5f8a', Leveled: '#6b3fa0', Artifact: '#a8322d', quest: '#a87a1e', follower: '#2a7f7a', retainer: '#7a4a2a' };

const REWARD_LABELS = ['Victories', 'Title', 'Treasure', 'Project Source', 'Renown', 'Wealth', 'Retainer', 'Other'];

const CRAFT_RE = /^(Item Prerequisite|Project Source|Project Roll Characteristic|Project Goal)s?:/i;

const retainerList = () => MONS.filter(m => /Retainer/i.test(m.role || ''));

function itemCard(t, craft) {
  const sub = [t.type === 'Leveled' ? 'Leveled ' + (t.sub || 'treasure').toLowerCase() : t.type, t.echelon ? ORD(t.echelon) + ' echelon' : ''].filter(Boolean).join(' · ');
  const paras = [];
  for (const b of t.body || []) {
    const html = (b.html || (b.text ? esc(b.text) : '')).trim(); if (!html) continue;
    const txt = strip(html);
    if (/^Keywords?:/i.test(txt)) continue;
    if (!craft && CRAFT_RE.test(txt)) continue;
    if (b.t === 'tier') { paras.push(`<b>${['', '≤11', '12–16', '17+'][b.n]}:</b> ${html}`); continue; }
    html.split(/(?=<b>\s*\d+(?:st|nd|rd|th) Level)/).forEach(h => paras.push((b.t === 'li' ? '• ' : '') + h.trim()));
  }
  return { name: t.name, sub, keywords: t.keywords || '', paras, color: DS_CARD_COL[t.type] || '#555555', back: t.type || 'Treasure', foot: 'Draw Steel' + (t.src?.pg ? ' · Heroes p. ' + t.src.pg : '') };
}

const tierTxt = rows => { const t = rows.filter(r => r.k === 'tier'); return t.length ? t.map(r => `<b>${['', '≤11', '12–16', '17+'][r.n]}</b> ${r.html}`).join('; ') : ''; };

function followerCard(f) {
  if (f.type === 'retainer') {
    const m = MON[f.gid]; if (!m) return { name: f.name || 'Retainer', sub: 'Retainer (stat block not found)', paras: [], color: DS_CARD_COL.retainer, back: 'Retainer' };
    const st = m.stats || {}, ch = m.chars || {};
    const stats = [['Stamina', st.Stamina], ['Speed', (st.Speed || '') + (m.movement && m.movement !== '—' ? '*' : '')], ['Size', st.Size], ['Stability', st.Stability], ['Free strike', st['Free Strike']], ['Might', ch.Might], ['Agility', ch.Agility], ['Reason', ch.Reason], ['Intuition', ch.Intuition], ['Presence', ch.Presence]].filter(x => x[1] != null && x[1] !== '');
    const paras = [];
    if (f.name) paras.push(`<i>${esc(m.name)}${m.desc ? ' · ' + esc(m.desc) : ''}</i>`);
    const misc = [m.movement && m.movement !== '—' ? '<b>*Movement:</b> ' + esc(m.movement) : '', m.immunity && m.immunity !== '—' ? '<b>Immunity:</b> ' + esc(m.immunity) : '', m.weakness && m.weakness !== '—' ? '<b>Weakness:</b> ' + esc(m.weakness) : ''].filter(Boolean);
    if (misc.length) paras.push(misc.join(' · '));
    for (const a of m.items || []) {
      const head = `<b>${esc(a.name)}${a.action ? '' : '.'}</b>${a.action ? ` <i>(${esc([a.action, a.distance, a.target].filter(Boolean).join(', '))})</i>` : ''}`;
      const fields = (a.rows || []).filter(r => r.k === 'field').map(r => r.html).join(' ');
      const tiers = tierTxt(a.rows || []);
      paras.push(head + (tiers ? ' ' + tiers + '.' : '') + (fields ? ' ' + fields : ''));
    }
    if (f.notes) paras.push(esc(f.notes));
    paras.push('<b>Mentor:</b> ____________________');
    return { name: f.name || m.name, sub: `Level ${m.level} ${m.role}`, keywords: '', stats, paras, color: DS_CARD_COL.retainer, back: 'Retainer', foot: (PK[m.pack]?.title || '') + (m.pg ? ' p. ' + m.pg : '') };
  }
  const art = f.type === 'artisan';
  const chars = { Might: 0, Agility: 0, Reason: 1, Intuition: art ? 0 : 1, Presence: 0 }; if (art) chars[f.char === 'Agility' ? 'Agility' : 'Might'] = 1;
  const stats = Object.entries(chars).map(([k, v]) => [k, (v > 0 ? '+' : '') + v]);
  const langs = ['Caelian', ...(f.languages || []).filter(Boolean)];
  const paras = [`<b>Skills:</b> ${esc((f.skills || []).join(', ') || '—')}`, `<b>Languages:</b> ${esc(langs.join(', '))}`,
    `${art ? 'A crafting expert' : 'A research expert'}. Contributes one project roll per day to a downtime project you choose, whether you spend those days in respite, adventuring, or other activities. Must remain at your stronghold or the project site, with access to the necessary materials.`];
  if (f.notes) paras.push(esc(f.notes));
  return { name: f.name || (art ? 'Artisan' : 'Sage'), sub: (art ? 'Artisan' : 'Sage') + ' follower' + (f.ancestry ? ' · ' + f.ancestry : ''), keywords: '', stats, paras, color: DS_CARD_COL.follower, back: 'Follower', foot: 'Draw Steel · Heroes p. 350' };
}

const DS_CARD_ICONS = { Consumable: 'gi:potion-ball', Trinket: 'gi:gem-pendant', Artifact: 'gi:crystal-ball', Weapon: 'gi:broadsword', Armor: 'gi:breastplate', Implement: 'gi:wizard-staff', Other: 'gi:gem-chain', Leveled: 'gi:crossed-swords', quest: 'gi:scroll-unfurled', retainer: 'gi:swordman', artisan: 'gi:anvil-impact', sage: 'gi:spell-book' };

// ---- follower editor ----
function followerEditor(f0) {
  const isNew = !f0.id; const f = JSON.parse(JSON.stringify({ name: '', ancestry: '', skills: [], languages: ['', ''], char: 'Might', notes: '', ...f0 }));
  const el = document.createElement('div'); el.className = 'dlg';
  const rets = retainerList(); const byPack = {}; rets.forEach(m => (byPack[m.pack] = byPack[m.pack] || []).push(m));
  if (f.type === 'retainer' && !f.gid && rets[0]) f.gid = rets[0].gid;
  const draw = () => {
    const grp = f.type === 'artisan' ? 'Crafting' : 'Lore';
    const skills = D.skills.filter(s => s.group === grp).map(s => s.name);
    el.innerHTML = `<div class="dlg-b negedit"><h2>${isNew ? 'New' : 'Edit'} ${f.type === 'retainer' ? 'retainer' : f.type} card</h2>
      ${f.type === 'retainer' ? `<label class="negnotes">Retainer<select id="fe-g">${Object.entries(byPack).map(([p, ms]) => `<optgroup label="${esc(PK[p]?.title || p)}">${ms.map(m => `<option value="${m.gid}" ${f.gid === m.gid ? 'selected' : ''}>${esc(m.name)} (level ${m.level} ${esc(m.role.replace(/ Retainer$/, ''))})</option>`).join('')}</optgroup>`).join('')}</select></label>
        ${!rets.length ? '<div class="warn">No retainer stat blocks found. Retainers come from the Monsters book.</div>' : ''}
        <label class="negnotes">Name (optional)<input id="fe-n" value="${esc(f.name)}" placeholder="Leave empty to use the stat block’s name"></label>`
      : `<div class="mtrow"><label>Name<input id="fe-n" value="${esc(f.name)}"></label><label>Ancestry<input id="fe-a" value="${esc(f.ancestry)}"></label>${f.type === 'artisan' ? `<label>Characteristic at 1<select id="fe-c"><option ${f.char === 'Might' ? 'selected' : ''}>Might</option><option ${f.char === 'Agility' ? 'selected' : ''}>Agility</option></select></label>` : ''}</div>
        <div class="negnotes">Four ${grp.toLowerCase()} skills (${f.skills.length}/4)</div>
        <div class="fskills">${skills.map(s => `<label><input type="checkbox" data-sk="${esc(s)}" ${f.skills.includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join('')}</div>
        <div class="mtrow"><label>Languages: Caelian +<input id="fe-l1" value="${esc(f.languages[0] || '')}"></label><label>and<input id="fe-l2" value="${esc(f.languages[1] || '')}"></label></div>`}
      <label class="negnotes">Notes (optional)<input id="fe-x" value="${esc(f.notes)}"></label>
      <div class="dlgfoot">${!isNew ? '<button class="btn danger" id="fe-del">Delete</button>' : ''}<span style="flex:1"></span><button class="btn ghost" id="fe-q">Cancel</button><button class="btn" id="fe-ok">${isNew ? 'Add card' : 'Save'}</button></div></div>`;
    const keep = () => { f.name = $('#fe-n', el).value.trim(); f.notes = $('#fe-x', el).value.trim(); if ($('#fe-g', el)) f.gid = $('#fe-g', el).value; if ($('#fe-a', el)) f.ancestry = $('#fe-a', el).value.trim(); if ($('#fe-c', el)) f.char = $('#fe-c', el).value; if ($('#fe-l1', el)) f.languages = [$('#fe-l1', el).value.trim(), $('#fe-l2', el).value.trim()]; };
    $$('[data-sk]', el).forEach(c => c.onchange = () => { keep(); const s = c.dataset.sk; if (c.checked) { if (f.skills.length >= 4) { toast('A follower knows four skills'); c.checked = false; return; } f.skills.push(s); } else f.skills = f.skills.filter(x => x !== s); draw(); });
    $('#fe-q', el).onclick = () => el.remove();
    if ($('#fe-del', el)) $('#fe-del', el).onclick = async () => { if (await confirmSheet('Delete this card?', 'Delete')) { CARDS.followers = CARDS.followers.filter(x => x.id !== f.id); CARDS.deck = CARDS.deck.filter(x => !(x.k === 'follower' && x.id === f.id)); saveCards(); el.remove(); cardsPage(); } };
    $('#fe-ok', el).onclick = () => { keep(); if (f.type === 'retainer' && !MON[f.gid]) { toast('Pick a retainer'); return; } if (!f.id) { f.id = uid('f'); CARDS.followers.push(f); addToDeck('follower', f.id); } else { const i = CARDS.followers.findIndex(x => x.id === f.id); CARDS.followers[i] = f; } CARDS.tab = 'follower'; saveCards(); el.remove(); cardsPage(); };
  };
  draw(); document.body.appendChild(el);
}

const NUMWORD = { one: 1, two: 2, three: 3, four: 4, five: 5, a: 1, an: 1 };
function sectionRewards(blocks) {
  const R = { vic: 0, treasure: [], title: [], renown: 0, wealth: 0, source: [], retainer: [], other: [] };
  const add = (arr, v) => { v = v.trim().replace(/\s+/g, ' '); const k = v.toLowerCase().replace(/s$/, ''); if (v && !arr.some(x => x.toLowerCase().replace(/s$/, '') === k)) arr.push(v); };
  const tnames = D.treasures.map(t => t.name).sort((a, b) => b.length - a.length);
  for (const b of blocks) {
    if (b.t === 'h') { const m = b.text.match(/^Title:\s*(.+)$/i); if (m) add(R.title, m[1]); continue; }
    const txt = strip(b.html || (b.rows ? b.rows.flat().join(' ') : '') || '');
    let m; const vre = /\b(?:earns?|gains?)\s+(\d+|one|two|three|four|five)\s+(?:additional\s+)?Victor(?:y|ies)\b/gi;
    while ((m = vre.exec(txt))) R.vic = Math.max(R.vic, +m[1] || NUMWORD[m[1].toLowerCase()] || 0);
    const tre = /\(see\s+([^)]*?)\s+in\s+Treasures?\s+in\s+Handouts\)|((?:[A-Z][\w’'\-]*\s?){1,5})\s*\(see\s+Treasures?\s+in\s+Handouts\)/g;
    while ((m = tre.exec(txt))) add(R.treasure, (m[1] || m[2]).replace(/^(?:a|an|the)\s+/i, ''));
    for (const n of tnames) if (new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(txt) && !R.treasure.some(x => x.includes(n))) add(R.treasure, n);
    const rre = /\bgains?\s+(\d+|one|two)\s+Renown/gi; while ((m = rre.exec(txt))) R.renown = Math.max(R.renown, +m[1] || NUMWORD[m[1].toLowerCase()]);
    const wre = /Wealth\s+(?:score\s+)?(?:increases|goes up)\s+by\s+(\d+|one|two)/gi; while ((m = wre.exec(txt))) R.wealth = Math.max(R.wealth, +m[1] || NUMWORD[m[1].toLowerCase()]);
    const pre = /project source (?:for|of) (?:an? |the )?([A-Z][\w’'\- ]+)/gi; while ((m = pre.exec(txt))) add(R.source, m[1]);
    const tie = /([A-Z][\w’'\- ]+?)\s+title\s+\(see Titles/g; while ((m = tie.exec(txt))) add(R.title, m[1]);
    if (/becom\w* a retainer/i.test(txt)) { const who = txt.match(/([A-Z][\w’']+)\s+(?:also\s+)?pledges/); if (who) add(R.retainer, who[1]); }
  }
  return R;
}
function questsFromChapter(pack, ch, L) {
  const B = ch.blocks; const out = [];
  const leadDesc = name => { const li = B.find(b => b.t === 'li' && new RegExp('^\\s*<b>\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*</b>', 'i').test(b.html || '')); return li ? strip(li.html).replace(/^[^:]+:\s*/, '') : ''; };
  for (let i = 0; i < B.length; i++) {
    const h = B[i]; if (h.t !== 'h' || h.lvl !== L) continue;
    let end = B.length; for (let k = i + 1; k < B.length; k++) if (B[k].t === 'h' && B[k].lvl <= L) { end = k; break; }
    const sec = B.slice(i + 1, end);
    // scenes one level down are added up; inside a scene, alternative outcomes take the best
    const subL = Math.min(...sec.filter(b => b.t === 'h').map(b => b.lvl).concat([99]));
    const isScene = b => b.t === 'h' && b.lvl === subL && subL <= L + 2 && !/^(Total|Partial|Victor|Reward|Ending|Encounter Adjust|Tactics|Terrain|Development)/i.test(b.text);
    let vic = 0; const R = sectionRewards(sec);
    if (subL < 99 && sec.some(isScene)) { let cur = []; const parts = []; for (const b of sec) { if (isScene(b)) { parts.push(cur); cur = []; } cur.push(b); } parts.push(cur); vic = parts.reduce((s, p) => s + sectionRewards(p).vic, 0); } else vic = R.vic;
    let desc = leadDesc(h.text);
    if (!desc) { const p = sec.find(b => (b.t === 'p') && !/^[“"]/.test(strip(b.html || '')) && strip(b.html || '').length > 40); desc = p ? strip(p.html) : ''; }
    if (desc.length > 260) { const cut = desc.slice(0, 260); desc = cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, 180)) || cut; if (!/[.!?]$/.test(desc)) desc += '…'; }
    const rewards = [];
    if (vic) rewards.push({ label: 'Victories', value: (sec.some(isScene) ? 'up to ' : '') + vic });
    R.title.forEach(v => rewards.push({ label: 'Title', value: v }));
    R.treasure.forEach(v => rewards.push({ label: 'Treasure', value: v }));
    R.source.forEach(v => rewards.push({ label: 'Project Source', value: v }));
    if (R.renown) rewards.push({ label: 'Renown', value: '+' + R.renown });
    if (R.wealth) rewards.push({ label: 'Wealth', value: '+' + R.wealth });
    R.retainer.forEach(v => rewards.push({ label: 'Retainer', value: v }));
    out.push({ id: uid('q'), title: h.text, text: desc, rewards, source: `${pack.title} · ${ch.title}`, pg: h.pg });
  }
  return out;
}

// ---- the Draw Steel part of the card generator (SYS.cards) ----
const dsTreasuresByType = () => { const byType = {}; D.treasures.forEach(t => (byType[t.type] = byType[t.type] || []).push(t)); return byType; };
const DS_CARDS = {
  intro: 'treasures, quests, followers and retainers',
  tabs: [['item', 'Items'], ['quest', 'Quests'], ['follower', 'Followers & retainers']],
  icons: DS_CARD_ICONS,
  rewards: {
    labels: REWARD_LABELS,
    hints: { Victories: '2', Title: 'Fey Friend', Treasure: 'Healing Potion', 'Project Source': 'Quantum Satchel', Renown: '+1', Wealth: '+1', Retainer: 'Lamprey', Other: '' },
    defaults: [{ label: 'Victories', value: '' }, { label: 'Treasure', value: '' }]
  },
  questsFromChapter,
  questRewardsText: 'Victories, treasures, titles, Renown and retainers',
  optionsHtml: () => `<label class="row-c"><input type="checkbox" id="c-craft" ${CARDS.craft ? 'checked' : ''}> Crafting info</label>`,
  wireOptions: re => { $('#c-craft').onchange = e => { CARDS.craft = e.target.checked; re(); }; },
  kinds: {
    item: {
      entry(d) { const t = D.treasures.find(x => x.id === d.id); const e = t && { label: t.name, kind: t.type, c: itemCard(t, CARDS.craft) }; if (e) e.c.hint = t.type === 'Leveled' ? (t.sub || 'Leveled') : t.type; return e; },
      adder() { const T = D.treasures, byType = dsTreasuresByType(); return `<div class="cardadd"><div class="csearch">${ico('search', 16)}<input id="c-q" placeholder="Search ${T.length} treasures…" autocomplete="off"><div id="c-qres" class="cqres"></div></div>
      <select id="c-addall"><option value="">Add all of a type…</option>${Object.keys(byType).map(ty => `<option>${esc(ty)}</option>`).join('')}</select></div>`; },
      wire(re) {
        const T = D.treasures, byType = dsTreasuresByType();
      const cq = $('#c-q');
      if (cq) {
        const show = () => { const q = cq.value.trim().toLowerCase(); const box = $('#c-qres'); if (!q) { box.innerHTML = ''; box.classList.remove('on'); return; }
          const hits = T.filter(t => (t.name + ' ' + t.type + ' ' + (t.keywords || '') + ' ' + (t.sub || '')).toLowerCase().includes(q)).sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name)).slice(0, 12);
          box.innerHTML = hits.map(t => { const c = { name: t.name, hint: t.type === 'Leveled' ? (t.sub || 'Leveled') : t.type }; return `<button data-addi="${t.id}"><span class="cd-ic" style="--cc:${DS_CARD_COL[t.type] || '#555'}">${iconSvg(autoIcon(c))}</span><b>${esc(t.name)}</b><small>${esc(t.type)}${t.echelon ? ' · ' + ORD(t.echelon) + ' echelon' : ''}</small>${CARDS.deck.some(x => x.k === 'item' && x.id === t.id) ? '<em>in deck</em>' : ''}</button>`; }).join('') || '<div class="empty">No treasure matches.</div>';
          box.classList.add('on');
          $$('[data-addi]', box).forEach(b => b.onmousedown = e => { e.preventDefault(); addToDeck('item', b.dataset.addi); saveCards(); cardsPage(); setTimeout(() => { const n = $('#c-q'); if (n) { n.value = cq.value; n.focus(); n.dispatchEvent(new Event('input')); } }, 0); });
        };
        cq.oninput = show; cq.onfocus = show; cq.onblur = () => setTimeout(() => $('#c-qres')?.classList.remove('on'), 150);
        cq.onkeydown = e => { if (e.key === 'Enter') { const f = $('#c-qres [data-addi]'); if (f) f.dispatchEvent(new MouseEvent('mousedown')); } if (e.key === 'Escape') { cq.value = ''; show(); } };
        $('#c-addall').onchange = e => { const ty = e.target.value; if (!ty) return; byType[ty].forEach(t => { if (!CARDS.deck.some(x => x.k === 'item' && x.id === t.id)) CARDS.deck.push({ k: 'item', id: t.id, n: 1 }); }); re(); };
      }
      }
    },
    follower: {
      entry(d) { const f = CARDS.followers.find(x => x.id === d.id); const e = f && { label: f.name || MON[f.gid]?.name || f.type, kind: f.type === 'retainer' ? 'Retainer' : f.type === 'artisan' ? 'Artisan' : 'Sage', c: followerCard(f), obj: f }; if (e) e.c.hint = f.type; return e; },
      adder: () => `<div class="cardadd"><button class="btn" id="f-ret">+ Retainer</button><button class="btn ghost" id="f-art">+ Artisan</button><button class="btn ghost" id="f-sage">+ Sage</button></div>`,
      wire() { $('#f-ret').onclick = () => followerEditor({ type: 'retainer' }); $('#f-art').onclick = () => followerEditor({ type: 'artisan' }); $('#f-sage').onclick = () => followerEditor({ type: 'sage' }); }
    }
  }
};
