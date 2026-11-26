
// ================= NEGOTIATION TRACKER =================
const MOTIVES = ['Benevolence', 'Discovery', 'Freedom', 'Greed', 'Higher Authority', 'Justice', 'Legacy', 'Peace', 'Power', 'Protection', 'Revelry', 'Vengeance'];
const ATTITUDES = [['Hostile', 1, 2, 'Openly opposed to the heroes. Barely willing to listen.'], ['Suspicious', 2, 2, 'Doubts the heroes’ motives but is willing to listen.'], ['Neutral', 2, 3, 'Would rather be somewhere else, but doesn’t want to be rude.'], ['Open', 3, 3, 'Willing to listen and help, as long as the heroes aren’t asking too much.'], ['Friendly', 3, 4, 'The heroes seem like the NPC’s people.'], ['Trusting', 3, 5, 'Will help if the characters don’t screw this up.']];
const OFFERS = {
  5: ['Yes, and …', 'Offers everything the heroes asked for, and sweetens the deal. This is their best and final offer.'],
  4: ['Yes.', 'Offers everything the heroes asked for and accepts what they offered, without sweetening the deal.'],
  3: ['Yes, but …', 'Gives the heroes what they want for everything they offered, plus a little extra: a favor or a payment.'],
  2: ['No, but …', 'Can’t give the heroes what they want, but offers less impactful goods or services for what they promised.'],
  1: ['No.', 'Rejects the idea outright, without a counteroffer. May press the heroes for a better deal.'],
  0: ['No, and …', 'Offers nothing, refuses to negotiate further, and seeks to harm the heroes.']
};
const RESP = {
  positive: ['That’s an excellent point.', 'You’ve given me much to consider.', 'Fair enough.', 'Makes sense to me.'],
  negative: ['I don’t buy that.', 'Poppycock!', 'I hear you, but I disagree.', 'That’s not going to sway me.'],
  impatient: ['I’ve heard that before.', 'Are you going to offer me anything real?', 'This debate is tiresome.', 'BORING!']
};
const canonMotive = s => { const t = String(s || '').trim().toLowerCase(); return MOTIVES.find(m => m.toLowerCase() === t) || (t ? String(s).trim().replace(/\s+/g, ' ') : ''); };
const clamp5 = n => Math.max(0, Math.min(5, n));

// ---- extract negotiation stat blocks from any book ----
function negStatsFromText(t, o) {
  let m;
  if ((m = t.match(/Interest:\s*(\d)/i))) o.interest = +m[1];
  if ((m = t.match(/Patience:\s*(\d)/i))) o.patience = +m[1];
  if ((m = t.match(/Impression(?: Score)?:\s*(\d+)/i))) o.impression = +m[1];
  if ((m = t.match(/Native Languages?:\s*([^.;]+?)(?=\s+(?:Interest|Patience|Impression):|$)/i))) o.language = m[1].trim();
}
function extractNegotiations(pack) {
  const out = [];
  for (const c of pack.chapters || []) {
    const B = c.blocks;
    for (let i = 0; i < B.length; i++) {
      const h = B[i];
      if (h.t !== 'h') continue;
      const mm = h.text.match(/^(.*?)\s+Negotiation Stats$/i);
      if (!mm) continue;
      const n = { id: (pack.heroes ? 'heroes' : pack.id) + '-' + slug(mm[1]), name: mm[1].trim(), interest: 2, patience: 3, impression: 1, language: '', motivations: [], pitfalls: [], outcomes: {}, notes: '', victories: '', intro: '', src: { pack: pack.id, ch: c.id, hid: h.id, pg: h.pg }, pack: pack.id };
      // intro: up to two paragraphs right before, inside the same section
      const pre = []; for (let k = i - 1; k >= 0 && k >= i - 4; k--) { const b = B[k]; if (b.t === 'h') { if (/Negotiation/i.test(b.text)) continue; break; } if (b.t === 'p' && b.style !== 'small') pre.unshift(strip(b.html)); }
      n.intro = pre.slice(-2).join('\n\n');
      let mode = '', last = null, sawOutcome = false;
      for (let j = i + 1; j < B.length && j < i + 50; j++) {
        const b = B[j];
        if (b.t === 'h') {
          const tx = b.text.trim();
          if (/^Motivations?$/i.test(tx)) { mode = 'm'; continue; }
          if (/^Pitfalls?$/i.test(tx)) { mode = 'p'; continue; }
          if (/^Victor(y|ies)$/i.test(tx)) { mode = 'v'; continue; }
          if (/Negotiation Stats$/i.test(tx)) break;
          if (/^(Negotiation )?Outcomes$/i.test(tx)) { mode = 'o'; continue; }
          if (sawOutcome) break;
          if (/^Roleplaying/i.test(tx)) { mode = 'r'; continue; }
          mode = 'x'; n.notes += (n.notes ? '\n\n' : '') + tx + ':'; continue;
        }
        const txt = b.t === 'table' ? [...b.head, ...b.rows.flat().map(strip)].join(' ') : strip(b.html || b.text || '');
        if (!txt) continue;
        if (/^(Interest|Patience|Impression|Native Language)s?:/i.test(txt) && !/^Interest\s+\d\s*:/i.test(txt)) { negStatsFromText(txt, n); n._stats = true; continue; }
        const om = txt.match(/^Interest\s+(\d)\s*(?:\([^)]*\))?\s*:\s*(.*)$/i);
        if (om) { n.outcomes[om[1]] = om[2].trim(); sawOutcome = true; mode = 'o'; last = null; continue; }
        if (/following outcomes/i.test(txt)) { mode = 'o'; continue; }
        if (mode === 'm' || mode === 'p') {
          const lm = txt.match(/^([A-Z][\w’' ]{2,24}):\s*(.*)$/);
          if (lm) { last = { name: canonMotive(lm[1]), text: lm[2].trim() }; (mode === 'm' ? n.motivations : n.pitfalls).push(last); continue; }
          if (last && b.t === 'p') { last.text += ' ' + txt; continue; }
          continue;
        }
        if (mode === 'v') { n.victories += (n.victories ? ' ' : '') + txt; continue; }
        if (mode === 'r') { n.notes += (n.notes ? '\n\n' : '') + txt; continue; }
        if (mode === 'x') { n.notes += '\n' + (b.t === 'li' ? '• ' : '') + txt; continue; }
        if (/following outcomes/i.test(txt)) continue;
        if (sawOutcome && !/^Interest/i.test(txt)) { if (b.t === 'p') n.notes += (n.notes ? '\n\n' : '') + txt; }
      }
      if (n._stats && (n.motivations.length || n.pitfalls.length)) { delete n._stats; out.push(n); }
    }
  }
  return out;
}
function extractArchetypes() {
  const ch = D.book.find(c => c.id === 'for-the-director'); if (!ch) return [];
  const out = []; let cur = null, mode = '';
  for (const b of ch.blocks) {
    if (b.t === 'h') {
      const m = b.text.match(/^(.*?)\s+Impression Score:\s*(\d+)$/);
      if (m) { cur = { id: 'arch-' + slug(m[1]), name: m[1], impression: +m[2], desc: '', motivations: [], pitfalls: [] }; out.push(cur); mode = 'd'; continue; }
      if (!cur) continue;
      if (/^Motivations$/.test(b.text)) { mode = 'm'; continue; }
      if (/^Pitfalls$/.test(b.text)) { mode = 'p'; continue; }
      if (b.lvl <= 3) { cur = null; continue; }
      continue;
    }
    if (!cur || b.t !== 'p') continue;
    const t = strip(b.html);
    if (mode === 'd') { cur.desc += (cur.desc ? ' ' : '') + t; continue; }
    const lm = t.match(/^([A-Z][\w’' ]{2,24}):\s*(.*)$/);
    if (lm && (mode === 'm' || mode === 'p')) (mode === 'm' ? cur.motivations : cur.pitfalls).push({ name: canonMotive(lm[1]), text: lm[2] });
  }
  return out;
}
// ---- pasted text parser ----
function parseNegText(txt) {
  const lines = txt.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
  const n = { id: 'u-' + Date.now().toString(36), name: '', interest: 2, patience: 3, impression: 1, language: '', motivations: [], pitfalls: [], outcomes: {}, notes: '', user: true };
  let mode = '', last = null;
  for (const ln of lines) {
    let m;
    if (!n.name && !/:/.test(ln) && !/^(Motivations?|Pitfalls?)$/i.test(ln)) { n.name = ln.replace(/\s+Negotiation Stats$/i, ''); continue; }
    if ((m = ln.match(/^(.*?)\s+Negotiation Stats$/i))) { n.name = m[1]; continue; }
    if (/^Motivations?:?$/i.test(ln)) { mode = 'm'; last = null; continue; }
    if (/^Pitfalls?:?$/i.test(ln)) { mode = 'p'; last = null; continue; }
    if (/^(Roleplaying|Notes)/i.test(ln)) { mode = 'r'; continue; }
    if ((m = ln.match(/^Interest\s+(\d)\s*:\s*(.*)$/i))) { n.outcomes[m[1]] = m[2]; mode = 'o'; last = { o: m[1] }; continue; }
    if (/(Interest|Patience|Impression|Native Language)s?:/i.test(ln) && mode !== 'm' && mode !== 'p') { negStatsFromText(ln, n); continue; }
    if ((mode === 'm' || mode === 'p') && (m = ln.match(/^([A-Z][\w’' ]{2,24}):\s*(.*)$/))) { last = { name: canonMotive(m[1]), text: m[2] }; (mode === 'm' ? n.motivations : n.pitfalls).push(last); continue; }
    if (mode === 'm' || mode === 'p') { if (last) last.text += ' ' + ln; else { const nm = canonMotive(ln); if (MOTIVES.includes(nm)) { last = { name: nm, text: '' }; (mode === 'm' ? n.motivations : n.pitfalls).push(last); } } continue; }
    if (mode === 'o' && last && last.o) { n.outcomes[last.o] += ' ' + ln; continue; }
    n.notes += (n.notes ? '\n' : '') + ln;
  }
  if (!n.name) n.name = 'Unnamed NPC';
  return n;
}

// ---- data ----
let NEGS_USER = store.get('negs', []);
let NEG_SESS = store.get('negsess', {});
const saveNegs = () => store.set('negs', NEGS_USER);
const saveSess = () => store.set('negsess', NEG_SESS);
let NEG_BOOK = [], NEG_ARCH = [];
const NEGBYHEAD = {};
function refreshNegotiations() {
  NEG_BOOK = []; for (const p of PACKS) NEG_BOOK.push(...extractNegotiations(p));
  const seen = new Set(); NEG_BOOK = NEG_BOOK.filter(n => { if (seen.has(n.id)) { n.id += '-' + Math.random().toString(36).slice(2, 5); } seen.add(n.id); return true; });
  for (const k in NEGBYHEAD) delete NEGBYHEAD[k];
  for (const n of NEG_BOOK) NEGBYHEAD[n.src.pack + ':' + n.src.ch + ':' + n.src.hid] = n.id;
  NEG_ARCH = extractArchetypes();
}
const allNegs = () => [...NEGS_USER, ...NEG_BOOK];
const negById = id => allNegs().find(n => n.id === id);

// ---- session helpers ----
function newSession(def) {
  return { defId: def.id, interest: def.interest, patience: def.patience, started: false, langHeroes: 0, attitude: '', used: {}, revealed: {}, discoverLocked: false, noMotArgs: 0, log: [], ended: null, share: true, heroes: [], who: '' };
}
function sessOf(def) { return NEG_SESS[def.id] || (NEG_SESS[def.id] = newSession(def)); }
function snapshot(s) { return JSON.stringify({ interest: s.interest, patience: s.patience, used: s.used, revealed: s.revealed, discoverLocked: s.discoverLocked, noMotArgs: s.noMotArgs, ended: s.ended }); }
function pushLog(s, text, kind, before) { s.log.push({ text, kind, before, i: s.interest, p: s.patience, at: Date.now() }); }
function checkEnd(s) {
  if (s.interest <= 0) s.ended = 'nodeal';
  else if (s.interest >= 5) s.ended = 'final';
  else if (s.patience <= 0) s.ended = 'final';
}

// ---- hub ----
let negUI = { step: 'type', type: null, target: null, lie: false, nat: false, repeat: false, rolled: null, bonus: 0, edge: 0, disc: null };
function negotiationHub() {
  refreshNegotiations();
  const inProg = allNegs().filter(n => NEG_SESS[n.id] && NEG_SESS[n.id].log.length && !NEG_SESS[n.id].ended);
  const byPack = {}; NEG_BOOK.forEach(n => (byPack[n.pack] = byPack[n.pack] || []).push(n));
  const card = n => `<a class="negc" href="#negotiation--${n.id}"><b>${esc(n.name)}</b><span>Interest ${n.interest} · Patience ${n.patience} · Impression ${n.impression}${n.language ? ' · ' + esc(n.language) : ''}</span><em>${n.motivations.length} motivations · ${n.pitfalls.length} pitfalls${NEG_SESS[n.id] && NEG_SESS[n.id].log.length ? ' · in progress' : ''}</em></a>`;
  $('#main').innerHTML = `<div class="neghub"><h1>Negotiation</h1>
    <p class="note">Run a negotiation step by step. Vanadium tracks the NPC’s interest and patience, which motivations have been used, what the players have discovered, and the offer on the table. The rules come from <a href="#book--heroes--negotiation">Chapter 11: Negotiation</a>.</p>
    <div class="negacts"><button class="btn" id="negnew">+ New negotiation</button><button class="btn ghost" id="negpaste">Paste a stat block</button><a class="btn ghost" href="#import">Import a PDF</a></div>
    ${inProg.length ? `<h2 class="negh">In progress</h2><div class="negg">${inProg.map(card).join('')}</div>` : ''}
    ${NEGS_USER.length ? `<h2 class="negh">Your negotiations</h2><div class="negg">${NEGS_USER.map(card).join('')}</div>` : ''}
    ${Object.entries(byPack).map(([pid, list]) => `<h2 class="negh">From ${esc(PK[pid]?.title || pid)}</h2><div class="negg">${list.map(card).join('')}</div>`).join('')}
    <h2 class="negh">Start from an archetype</h2><p class="note" style="margin-top:-4px">The sample negotiators from <i>For the Director</i>. Pick one and choose at least two motivations and pitfalls.</p>
    <div class="negg">${NEG_ARCH.map(a => `<button class="negc arch" data-arch="${a.id}"><b>${esc(a.name)}</b><span>Impression ${a.impression}</span><em>${esc(a.desc.slice(0, 110))}${a.desc.length > 110 ? '…' : ''}</em></button>`).join('')}</div></div>`;
  $('#negnew').onclick = () => negEditor(null);
  $('#negpaste').onclick = negPasteDialog;
  $$('[data-arch]').forEach(b => b.onclick = () => negEditor(null, NEG_ARCH.find(a => a.id === b.dataset.arch)));
  document.title = 'Negotiation — Vanadium';
}

// ---- editor ----
function negEditor(def, arch) {
  const d = def ? JSON.parse(JSON.stringify(def)) : { id: 'u-' + Date.now().toString(36), name: arch ? arch.name : '', interest: 2, patience: 3, impression: arch ? arch.impression : 1, language: '', motivations: [], pitfalls: [], outcomes: {}, notes: arch ? arch.desc : '', user: true };
  const roleOf = m => d.motivations.find(x => x.name === m) ? 'm' : d.pitfalls.find(x => x.name === m) ? 'p' : '';
  const textOf = m => (d.motivations.find(x => x.name === m) || d.pitfalls.find(x => x.name === m) || {}).text || (arch && (arch.motivations.find(x => x.name === m) || arch.pitfalls.find(x => x.name === m) || {}).text) || '';
  const sugg = m => arch ? (arch.motivations.some(x => x.name === m) ? 'suggested motivation' : arch.pitfalls.some(x => x.name === m) ? 'suggested pitfall' : '') : '';
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<div class="dlg-b negedit"><h2>${def ? 'Edit' : 'New'} negotiation${arch ? ' · ' + esc(arch.name) : ''}</h2>
    <div class="party dlgp"><label style="flex:2;min-width:200px;width:auto">NPC name<input id="ne-name" value="${esc(d.name)}" placeholder="e.g. Zola Honeycut"></label>
    <label>Attitude<select id="ne-att"><option value="">Custom…</option>${ATTITUDES.map(a => `<option value="${a[0]}">${a[0]} (${a[1]}/${a[2]})</option>`).join('')}</select></label>
    <label>Interest<input type="number" id="ne-i" min="1" max="4" value="${d.interest}"></label><label>Patience<input type="number" id="ne-p" min="1" max="5" value="${d.patience}"></label>
    <label>Impression<input type="number" id="ne-imp" min="1" max="12" value="${d.impression}"></label><label style="width:160px">Native language<input id="ne-lang" value="${esc(d.language)}" placeholder="optional"></label></div>
    <div class="negmot-h"><b>Motivations & pitfalls</b><span>Give the NPC at least two motivations and at least one pitfall.</span></div>
    <div class="negmots">${MOTIVES.map(m => `<div class="nm ${roleOf(m)}" data-m="${m}"><div class="nm-t"><b>${m}</b>${sugg(m) ? `<small>${sugg(m)}</small>` : ''}<span class="seg3"><button data-r="m" class="${roleOf(m) === 'm' ? 'on' : ''}">Motivation</button><button data-r="p" class="${roleOf(m) === 'p' ? 'on' : ''}">Pitfall</button><button data-r="" class="${!roleOf(m) ? 'on' : ''}">—</button></span></div><textarea rows="2" placeholder="What this means for this NPC (optional)">${esc(textOf(m))}</textarea></div>`).join('')}</div>
    <details ${Object.keys(d.outcomes).length ? 'open' : ''}><summary>Planned outcomes by interest (optional)</summary><div class="negouts">${[5, 4, 3, 2, 1, 0].map(k => `<label>Interest ${k} · ${OFFERS[k][0]}<input data-o="${k}" value="${esc(d.outcomes[k] || '')}" placeholder="${esc(OFFERS[k][1])}"></label>`).join('')}</div></details>
    <label class="negnotes">Notes for the Director<textarea id="ne-notes" rows="3">${esc(d.notes || '')}</textarea></label>
    <div class="dlgfoot">${def && def.user ? '<button class="btn danger" id="ne-del">Delete</button>' : ''}<span style="flex:1"></span><button class="btn ghost" id="ne-cancel">Cancel</button><button class="btn" id="ne-save">Save & run</button></div></div>`;
  document.body.appendChild(el);
  $('#ne-att', el).onchange = e => { const a = ATTITUDES.find(x => x[0] === e.target.value); if (a) { $('#ne-i', el).value = a[1]; $('#ne-p', el).value = a[2]; } };
  $$('.nm', el).forEach(row => row.onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; $$('[data-r]', row).forEach(x => x.classList.toggle('on', x === b)); row.className = 'nm ' + b.dataset.r; });
  $('#ne-cancel', el).onclick = () => el.remove();
  if ($('#ne-del', el)) $('#ne-del', el).onclick = async () => { if (await confirmSheet(`Delete “${d.name}”?`, 'Delete')) { NEGS_USER = NEGS_USER.filter(x => x.id !== d.id); delete NEG_SESS[d.id]; saveNegs(); saveSess(); el.remove(); go('negotiation'); } };
  $('#ne-save', el).onclick = () => {
    d.name = $('#ne-name', el).value.trim() || 'Unnamed NPC';
    d.interest = Math.max(1, Math.min(4, +$('#ne-i', el).value || 2)); d.patience = Math.max(1, Math.min(5, +$('#ne-p', el).value || 3));
    d.impression = Math.max(1, Math.min(12, +$('#ne-imp', el).value || 1)); d.language = $('#ne-lang', el).value.trim();
    d.motivations = []; d.pitfalls = [];
    $$('.nm', el).forEach(row => { const r = row.classList.contains('m') ? 'm' : row.classList.contains('p') ? 'p' : ''; if (!r) return; const item = { name: row.dataset.m, text: $('textarea', row).value.trim() }; (r === 'm' ? d.motivations : d.pitfalls).push(item); });
    if (d.motivations.length < 1) { toast('Pick at least one motivation'); return; }
    d.outcomes = {}; $$('[data-o]', el).forEach(i => { if (i.value.trim()) d.outcomes[i.dataset.o] = i.value.trim(); });
    d.notes = $('#ne-notes', el).value.trim(); d.user = true;
    NEGS_USER = NEGS_USER.filter(x => x.id !== d.id); NEGS_USER.unshift(d); saveNegs();
    if (NEG_SESS[d.id] && !NEG_SESS[d.id].started) NEG_SESS[d.id] = newSession(d);
    saveSess(); el.remove(); buildIndex(); go('negotiation--' + d.id);
  };
}
function negPasteDialog() {
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<div class="dlg-b"><h2>Paste a stat block</h2><p>Paste negotiation stats from a PDF, document or website. Vanadium picks out the interest, patience, impression, language, motivations, pitfalls and outcomes.</p>
    <textarea id="np-t" rows="11" style="width:100%;background:var(--bg);color:var(--ink);border:1px solid var(--line2);border-radius:5px;padding:10px;font-size:14px" placeholder="Zola Honeycut Negotiation Stats&#10;Interest: 2 Patience: 3 Impression: 3&#10;Motivations&#10;Benevolence: Zola always gives her thieves a bigger cut…&#10;Protection: The members of the Clock are her only family…&#10;Pitfalls&#10;Higher Authority: …&#10;Interest 5: …"></textarea>
    <div id="np-prev" class="note" style="margin-top:8px"></div>
    <div class="dlgfoot"><span style="flex:1"></span><button class="btn ghost" id="np-c">Cancel</button><button class="btn" id="np-ok">Review & save</button></div></div>`;
  document.body.appendChild(el);
  const ta = $('#np-t', el);
  ta.oninput = () => { const n = parseNegText(ta.value); $('#np-prev', el).textContent = ta.value.trim() ? `Found: ${n.name} · interest ${n.interest} · patience ${n.patience} · ${n.motivations.length} motivations · ${n.pitfalls.length} pitfalls · ${Object.keys(n.outcomes).length} outcomes` : ''; };
  $('#np-c', el).onclick = () => el.remove();
  $('#np-ok', el).onclick = () => { const n = parseNegText(ta.value); el.remove(); negEditor(n); };
  setTimeout(() => ta.focus(), 30);
}

// ---- runner ----
function negotiationPage(id) {
  refreshNegotiations();
  const def = negById(id);
  if (!def) { if (!PACKS.length || BUILTIN.some(b => id.startsWith(b.id))) { $('#main').innerHTML = '<div class="empty">Loading…</div>'; return; } go('negotiation'); return; }
  const s = sessOf(def);
  const pill = (n, v, cls) => `<div class="pips ${cls}">${[0, 1, 2, 3, 4, 5].map(k => `<span class="pip ${k <= v && k > 0 ? 'on' : ''} ${k === v ? 'cur' : ''}" data-set="${cls}" data-v="${k}">${k}</span>`).join('')}</div>`;
  const offer = OFFERS[s.interest];
  const custom = def.outcomes[s.interest];
  const endBanner = s.ended ? `<div class="negend ${s.ended}">${s.ended === 'nodeal' ? `<b>Negotiation over: no deal.</b> ${esc(def.name)}’s interest hit 0. They refuse further talks and may seek to harm the heroes.` : s.ended === 'final' ? `<b>Final offer.</b> ${s.interest >= 5 ? 'Interest reached 5.' : 'Patience ran out.'} The heroes can accept this offer or walk away, but the negotiation is over.` : s.ended === 'accepted' ? `<b>Deal struck</b> at interest ${s.interest} (“${OFFERS[s.interest][0]}”).` : `<b>The heroes walked away</b> at interest ${s.interest}.`}${def.victories ? `<div class="vict">${esc(def.victories)}</div>` : ''}</div>` : '';
  const mrow = (m, kind) => {
    const used = kind === 'm' && s.used[m.name], rev = s.revealed[m.name];
    return `<div class="nmot ${kind} ${used ? 'used' : ''}"><div class="nmot-h"><b>${esc(m.name)}</b><span class="tagk">${kind === 'm' ? 'Motivation' : 'Pitfall'}</span>${used ? '<span class="tagu">appealed</span>' : ''}<button class="eye ${rev ? 'on' : ''}" data-rev="${esc(m.name)}" title="${rev ? 'Known to the players' : 'Hidden from the players'}">${rev ? 'known' : 'hidden'}</button></div>${m.text ? `<p>${esc(m.text)}</p>` : ''}</div>`;
  };
  $('#main').innerHTML = `<div class="negrun"><div class="negmain">
    <div class="negtop"><div><div class="kind">${esc(def.user ? 'Your negotiation' : (PK[def.pack]?.title || ''))}</div><h1>${esc(def.name)}</h1>
      <div class="negmeta">Impression ${def.impression}${def.language ? ' · Native language: ' + esc(def.language) : ''}${def.src ? ` · <a data-gobook="${esc(def.src.pack)}--${esc(def.src.ch)}--${esc(def.src.hid)}">open in book</a>` : ''}</div></div>
      <div class="negtb"><button class="btn ghost sm" id="ng-pdf">PDF</button><button class="btn ghost sm" id="ng-table">Player view</button>${def.user ? '<button class="btn ghost sm" id="ng-edit">Edit</button>' : '<button class="btn ghost sm" id="ng-copy">Copy & edit</button>'}<button class="btn ghost sm" id="ng-reset">Restart</button><a class="btn ghost sm" href="#negotiation">All</a></div></div>
    ${endBanner}
    <div class="negstats"><div class="nstat"><span>Interest</span>${pill('Interest', s.interest, 'interest')}</div><div class="nstat"><span>Patience</span>${pill('Patience', s.patience, 'patience')}</div></div>
    <div class="negoffer"><div class="ol"><span>Current offer</span><b>${offer[0]}</b></div><div class="ot">${custom ? esc(custom) : esc(offer[1])}${custom ? `<small>${esc(offer[1])}</small>` : ''}</div></div>
    ${!s.started ? negSetupHtml(def, s) : s.ended ? `<div class="negpanel"><div class="actrow"><button class="btn ghost" id="ng-undo" ${s.log.length ? '' : 'disabled'}>Undo last step</button><button class="btn" id="ng-reset2">Run it again</button></div></div>` : negActionHtml(def, s)}
    <div class="neglog"><h3>Log</h3>${s.log.length ? s.log.slice().reverse().map(l => `<div class="lg ${l.kind || ''}"><span class="lgv">I ${l.i} · P ${l.p}</span>${esc(l.text)}</div>`).join('') : '<div class="note">Nothing yet.</div>'}</div>
  </div>
  <aside class="negside"><h3>Motivations</h3>${def.motivations.map(m => mrow(m, 'm')).join('') || '<div class="note">None</div>'}<h3>Pitfalls</h3>${def.pitfalls.map(m => mrow(m, 'p')).join('') || '<div class="note">None</div>'}
    ${Object.keys(def.outcomes).length ? `<h3>Outcomes</h3>${[5, 4, 3, 2, 1, 0].filter(k => def.outcomes[k]).map(k => `<div class="nout ${k === s.interest ? 'cur' : ''}"><b>${k} · ${OFFERS[k][0]}</b> ${esc(def.outcomes[k])}</div>`).join('')}` : ''}
    ${def.intro ? `<h3>Setup</h3><p class="nnote">${esc(def.intro)}</p>` : ''}${def.notes ? `<h3>Notes</h3><p class="nnote">${esc(def.notes)}</p>` : ''}
    <h3>Renown & Impression</h3><p class="nnote">A hero whose Renown is ${def.impression} or higher can sway this NPC if the NPC knows of them. Famous: edge on arguments using Flirt, Lead or Persuade. Infamous: edge with Brag, Interrogate or Intimidate.</p>
  </aside></div>`;
  wireNeg(def, s);
  document.title = def.name + ' — Negotiation';
}
function negSetupHtml(def, s) {
  return `<div class="negpanel"><h3>Opening the negotiation</h3>
   <p class="note">Before the first argument: confirm the NPC’s attitude and how many heroes can speak their native language${def.language ? ` (${esc(def.language)})` : ''}.</p>
   <div class="party dlgp"><label style="width:auto;min-width:220px">Starting attitude<select id="ng-att"><option value="">As written (interest ${def.interest}, patience ${def.patience})</option>${ATTITUDES.map(a => `<option value="${a[0]}">${a[0]}: interest ${a[1]}, patience ${a[2]}</option>`).join('')}</select></label>
   <label style="width:auto;min-width:220px">Heroes who speak ${def.language ? esc(def.language) : 'the NPC’s native language'}<select id="ng-lang"><option value="0">None (or only Caelian)</option><option value="1">1 or 2 heroes: patience +1</option><option value="2">3 or more: patience +2</option></select></label></div>
   <label class="row-c"><input type="checkbox" id="ng-share" ${s.share ? 'checked' : ''}> Show interest and patience in the player view</label>
   <div class="actrow"><button class="btn" id="ng-begin">Begin negotiation</button></div></div>`;
}
function negActionHtml(def, s) {
  const u = negUI;
  const tierBtns = (lab) => `<div class="tierpick">${[1, 2, 3].map(t => `<button class="tierb n${t} ${u.rolled && u.rolled.tier === t ? 'on' : ''}" data-tier="${t}"><span class="tb">${['', '≤11', '12–16', '17+'][t]}</span>${lab[t]}</button>`).join('')}</div>`;
  const rollRow = `<div class="rollrow"><span>Power roll + Reason, Intuition or Presence:</span><label>Bonus <input type="number" id="ng-bonus" value="${u.bonus}" inputmode="numeric"></label><select id="ng-edge"><option value="0">No edge/bane</option><option value="1" ${u.edge == 1 ? 'selected' : ''}>Edge (+2)</option><option value="2" ${u.edge == 2 ? 'selected' : ''}>Double edge</option><option value="-1" ${u.edge == -1 ? 'selected' : ''}>Bane (−2)</option><option value="-2" ${u.edge == -2 ? 'selected' : ''}>Double bane</option></select><button class="btn sm" id="ng-roll">Roll 2d10</button>${u.rolled && u.rolled.total != null ? `<b class="rollres">${u.rolled.total}${u.rolled.nat >= 19 ? ' · natural ' + u.rolled.nat : ''} → tier ${u.rolled.tier}</b>` : ''}</div>`;
  const usable = def.motivations.filter(m => !s.used[m.name]), usedM = def.motivations.filter(m => s.used[m.name]);
  let body = '';
  if (u.step === 'type') {
    body = `<h3>What does the argument appeal to?</h3>
      <div class="argtypes">${usable.map(m => `<button class="argt mot" data-type="mot" data-target="${esc(m.name)}"><b>${esc(m.name)}</b><span>Motivation${s.revealed[m.name] ? ' · known' : ''}</span></button>`).join('')}
      <button class="argt none" data-type="none"><b>No motivation or pitfall</b><span>Harder test${s.noMotArgs ? ` · ${s.noMotArgs} made` : ''}</span></button>
      ${usedM.map(m => `<button class="argt usedm" data-type="usedmot" data-target="${esc(m.name)}"><b>${esc(m.name)}</b><span>Already appealed</span></button>`).join('')}
      ${def.pitfalls.map(m => `<button class="argt pit" data-type="pit" data-target="${esc(m.name)}"><b>${esc(m.name)}</b><span>Pitfall</span></button>`).join('')}</div>
      <div class="actrow"><button class="btn ghost" id="ng-disc" ${s.discoverLocked ? 'disabled title="Make an argument before testing again"' : ''}>Discover a motivation or pitfall</button><button class="btn ghost" id="ng-undo" ${s.log.length ? '' : 'disabled'}>Undo</button><button class="btn ghost" id="ng-accept">Accept current offer</button><button class="btn ghost" id="ng-walk">Heroes walk away</button></div>`;
  } else if (u.step === 'resolve') {
    const t = u.type;
    if (t === 'pit') body = `<h3>Argument uses a pitfall: ${esc(u.target)}</h3><p class="note">The argument automatically fails. Interest −1 and patience −1. The NPC might warn the heroes not to treat them that way again.</p>`;
    else if (t === 'usedmot') body = `<h3>${esc(u.target)} has already been appealed to</h3><p class="note">Each motivation can be successfully appealed to only once. Interest stays the same and patience −1.</p>`;
    else if (t === 'mot') body = `<h3>Appeal to ${esc(u.target)}</h3><p class="note">Medium test (Reason, Intuition or Presence with any applicable skill). A particularly well-roleplayed argument can count as tier 3 without a test.</p>
      ${rollRow}${tierBtns({ 1: 'Patience −1', 2: 'Interest +1, patience −1', 3: 'Interest +1, patience unchanged' })}
      <label class="row-c"><input type="checkbox" id="ng-lie" ${u.lie ? 'checked' : ''}> The hero lied and was caught (interest −1 more if it fails to raise interest)</label>`;
    else if (t === 'none') body = `<h3>Argument without a motivation or pitfall</h3><p class="note">A more difficult test. On a natural 19 or 20, patience stays the same. Repeating the same argument automatically gets tier 1.</p>
      ${rollRow}${tierBtns({ 1: 'Interest −1, patience −1', 2: 'Patience −1', 3: 'Interest +1, patience −1' })}
      <label class="row-c"><input type="checkbox" id="ng-nat" ${u.nat || (u.rolled && u.rolled.nat >= 19) ? 'checked' : ''}> Natural 19 or 20 (patience unchanged)</label>
      <label class="row-c"><input type="checkbox" id="ng-rep" ${u.repeat ? 'checked' : ''}> They repeated an argument they already made (automatic tier 1)</label>
      <label class="row-c"><input type="checkbox" id="ng-lie" ${u.lie ? 'checked' : ''}> The hero lied and was caught (interest −1 more if it fails to raise interest)</label>`;
    const ready = t === 'pit' || t === 'usedmot' || (u.rolled && u.rolled.tier) || (t === 'none' && u.repeat);
    body += `<div class="actrow"><button class="btn ghost" id="ng-back">← Back</button><button class="btn" id="ng-apply" ${ready ? '' : 'disabled'}>Apply result</button></div>`;
  } else if (u.step === 'discover') {
    const hidden = [...def.motivations.map(m => [m, 'm']), ...def.pitfalls.map(m => [m, 'p'])].filter(([m]) => !s.revealed[m.name]);
    body = `<h3>Discover a motivation or pitfall</h3><p class="note">A hero reads the NPC with a Reason, Intuition or Presence test (the book’s example uses a hard test). No further discovery test can be made until the heroes make an argument.</p>
      ${rollRow}${tierBtns({ 1: 'Nothing learned; the NPC is annoyed: patience −1', 2: 'Nothing learned', 3: 'Learn one motivation or pitfall' })}
      ${u.rolled && u.rolled.tier === 3 ? `<div class="argtypes">${hidden.map(([m, k]) => `<button class="argt ${k === 'm' ? 'mot' : 'pit'} ${u.disc === m.name ? 'sel' : ''}" data-disc="${esc(m.name)}"><b>${esc(m.name)}</b><span>${k === 'm' ? 'Motivation' : 'Pitfall'}</span></button>`).join('') || '<div class="note">Everything is already known.</div>'}</div>` : ''}
      <div class="actrow"><button class="btn ghost" id="ng-back">← Back</button><button class="btn" id="ng-dapply" ${u.rolled && u.rolled.tier && (u.rolled.tier < 3 || u.disc || !hidden.length) ? '' : 'disabled'}>Apply</button></div>`;
  } else if (u.step === 'response') {
    const r = u.resp;
    body = `<h3>${esc(def.name)} responds ${r.kind === 'positive' ? 'positively' : r.kind === 'negative' ? 'negatively' : 'with impatience'}</h3>
      <p class="resp ${r.kind}">“${esc(RESP[r.kind][Math.floor(Math.random() * 4)])}”</p>
      <p class="note">${esc(r.summary)} Then make an offer at interest ${s.interest}: <b>${OFFERS[s.interest][0]}</b>${s.ended ? '' : ' The heroes can keep arguing, or accept.'}</p>
      <div class="actrow"><button class="btn" id="ng-next">${s.ended ? 'See result' : 'Next argument'}</button>${s.ended ? '' : '<button class="btn ghost" id="ng-accept">Accept this offer</button>'}</div>`;
  }
  return `<div class="negpanel">${body}</div>`;
}
function negRoll() {
  const d1 = 1 + Math.floor(Math.random() * 10), d2 = 1 + Math.floor(Math.random() * 10), nat = d1 + d2;
  const ed = +negUI.edge; const tot = nat + (+negUI.bonus || 0) + (ed === 1 ? 2 : ed === -1 ? -2 : 0);
  let tier = tot <= 11 ? 1 : tot <= 16 ? 2 : 3; if (ed === 2) tier = Math.min(3, tier + 1); if (ed === -2) tier = Math.max(1, tier - 1); if (nat >= 19) tier = 3;
  return { d1, d2, nat, total: tot, tier };
}
function wireNeg(def, s) {
  const re = () => { saveSess(); negotiationPage(def.id); };
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  on('#ng-reset', async () => { if (await confirmSheet('Restart this negotiation from the beginning?', 'Restart')) { NEG_SESS[def.id] = newSession(def); negUI = { step: 'type', bonus: 0, edge: 0 }; re(); } });
  on('#ng-reset2', () => { NEG_SESS[def.id] = newSession(def); negUI = { step: 'type', bonus: 0, edge: 0 }; re(); });
  on('#ng-edit', () => negEditor(def));
  on('#ng-copy', () => { const c = JSON.parse(JSON.stringify(def)); c.id = 'u-' + Date.now().toString(36); c.user = true; delete c.src; c.name = def.name; negEditor(c); });
  on('#ng-table', () => negPlayerView(def, s));
  on('#ng-pdf', () => runPdfJob($('#ng-pdf'), 'PDF', async () => { const b = await buildNegotiationPdf(def); await deliverFile(pdfFileName(def.name, 'negotiation'), new Blob([b], { type: 'application/pdf' })); }));
  $$('.pip').forEach(p => p.onclick = () => { const k = p.dataset.set, v = +p.dataset.v; const b = snapshot(s); s[k] = v; pushLog(s, `Director set ${k} to ${v}`, 'adj', b); if (s.started) { s.ended = null; checkEnd(s); } re(); });
  $$('[data-rev]').forEach(b => b.onclick = () => { s.revealed[b.dataset.rev] = !s.revealed[b.dataset.rev]; re(); });
  on('#ng-begin', () => {
    const b = snapshot(s); const att = ATTITUDES.find(a => a[0] === $('#ng-att').value);
    if (att) { s.interest = att[1]; s.patience = att[2]; s.attitude = att[0]; }
    const lb = +$('#ng-lang').value; s.patience = clamp5(s.patience + lb); s.share = $('#ng-share').checked; s.started = true;
    pushLog(s, `Negotiation opened${att ? ' (' + att[0] + ')' : ''}: interest ${s.interest}, patience ${s.patience}${lb ? ` (+${lb} for the native language)` : ''}`, 'start', b);
    negUI = { step: 'type', bonus: 0, edge: 0 }; re();
  });
  $$('[data-type]').forEach(b => b.onclick = () => { negUI = { ...negUI, step: 'resolve', type: b.dataset.type, target: b.dataset.target || null, rolled: null, lie: false, nat: false, repeat: false }; re(); });
  on('#ng-back', () => { negUI.step = 'type'; negUI.rolled = null; re(); });
  on('#ng-disc', () => { negUI = { ...negUI, step: 'discover', rolled: null, disc: null }; re(); });
  const keep = () => { const bi = $('#ng-bonus'), ei = $('#ng-edge'), li = $('#ng-lie'), ni = $('#ng-nat'), ri = $('#ng-rep'); if (bi) negUI.bonus = +bi.value || 0; if (ei) negUI.edge = +ei.value; if (li) negUI.lie = li.checked; if (ni) negUI.nat = ni.checked; if (ri) negUI.repeat = ri.checked; };
  $$('#ng-bonus,#ng-edge,#ng-lie,#ng-nat,#ng-rep').forEach(i => i.onchange = () => { keep(); if (i.id === 'ng-rep' && i.checked) negUI.rolled = { tier: 1 }; re(); });
  on('#ng-roll', () => { keep(); negUI.rolled = negRoll(); if (negUI.rolled.nat >= 19) negUI.nat = true; re(); });
  $$('[data-tier]').forEach(b => b.onclick = () => { keep(); negUI.rolled = { ...(negUI.rolled || {}), tier: +b.dataset.tier, total: negUI.rolled && negUI.rolled.tier === +b.dataset.tier ? negUI.rolled.total : null }; re(); });
  $$('[data-disc]').forEach(b => b.onclick = () => { negUI.disc = b.dataset.disc; re(); });
  on('#ng-apply', () => {
    keep(); const u = negUI; const b = snapshot(s); let di = 0, dp = 0, tier = u.rolled && u.rolled.tier, txt = '';
    if (u.type === 'pit') { di = -1; dp = -1; txt = `Argument used the pitfall ${u.target}: it fails`; s.revealed[u.target] = true; }
    else if (u.type === 'usedmot') { dp = -1; txt = `Appealed again to ${u.target} (already used)`; }
    else if (u.type === 'mot') { tier = tier || 1; if (tier === 1) dp = -1; else if (tier === 2) { di = 1; dp = -1; } else di = 1; if (di > 0) { s.used[u.target] = true; s.revealed[u.target] = true; } txt = `Appealed to ${u.target}: tier ${tier}`; }
    else if (u.type === 'none') { if (u.repeat) tier = 1; tier = tier || 1; if (tier === 1) { di = -1; dp = -1; } else if (tier === 2) dp = -1; else { di = 1; dp = -1; } if (u.nat) dp = 0; s.noMotArgs++; txt = `Argument without a motivation${u.repeat ? ' (repeated)' : ''}: tier ${tier}${u.nat ? ', natural 19–20' : ''}`; }
    if (u.lie && di <= 0 && u.type !== 'pit') { di -= 1; txt += '; caught in a lie'; }
    s.interest = clamp5(s.interest + di); s.patience = clamp5(s.patience + dp); s.discoverLocked = false;
    const kind = di > 0 ? 'positive' : di < 0 ? 'negative' : 'impatient';
    const sum = `Interest ${di > 0 ? '+' + di : di || '±0'}, patience ${dp > 0 ? '+' + dp : dp || '±0'}.`;
    pushLog(s, `${txt}. ${sum}`, kind, b); checkEnd(s);
    negUI = { step: 'response', resp: { kind, summary: sum }, bonus: u.bonus, edge: 0 }; re();
  });
  on('#ng-dapply', () => {
    const u = negUI, b = snapshot(s), t = u.rolled.tier;
    if (t === 1) { s.patience = clamp5(s.patience - 1); pushLog(s, 'Tried to read the NPC (tier 1): they noticed and are annoyed. Patience −1.', 'negative', b); }
    else if (t === 2) pushLog(s, 'Tried to read the NPC (tier 2): learned nothing.', 'impatient', b);
    else { if (u.disc) s.revealed[u.disc] = true; pushLog(s, `Read the NPC (tier 3): discovered ${u.disc || 'nothing new'}.`, 'positive', b); }
    s.discoverLocked = true; checkEnd(s); negUI = { step: 'type', bonus: u.bonus, edge: 0 }; re();
  });
  on('#ng-next', () => { negUI = { step: 'type', bonus: negUI.bonus, edge: 0 }; re(); });
  on('#ng-undo', () => { const l = s.log.pop(); if (l && l.before) Object.assign(s, JSON.parse(l.before)); if (l && l.kind === 'start') s.started = false; negUI = { step: 'type', bonus: 0, edge: 0 }; re(); });
  on('#ng-accept', () => { const b = snapshot(s); s.ended = 'accepted'; pushLog(s, `The heroes accepted the offer at interest ${s.interest} (${OFFERS[s.interest][0]})`, 'start', b); re(); });
  on('#ng-walk', () => { const b = snapshot(s); s.ended = 'walked'; pushLog(s, 'The heroes walked away from the negotiation', 'negative', b); re(); });
}
function negPlayerView(def, s) {
  const el = document.createElement('div'); el.className = 'pview';
  const draw = () => {
    const known = [...def.motivations.map(m => [m, 'Motivation']), ...def.pitfalls.map(m => [m, 'Pitfall'])].filter(([m]) => s.revealed[m.name]);
    el.innerHTML = `<button class="pv-x" title="Close">✕ Close player view</button><div class="pv-in"><div class="pv-k">Negotiating with</div><h1>${esc(def.name)}</h1>
      ${s.share ? `<div class="pv-stats"><div><span>Interest</span><b>${s.interest}</b><i>${[1, 2, 3, 4, 5].map(k => `<em class="${k <= s.interest ? 'on' : ''}"></em>`).join('')}</i></div><div><span>Patience</span><b>${s.patience}</b><i>${[1, 2, 3, 4, 5].map(k => `<em class="${k <= s.patience ? 'on p' : ''}"></em>`).join('')}</i></div></div>` : ''}
      <div class="pv-offer">${s.ended === 'nodeal' ? 'No deal' : `${OFFERS[s.interest][0]}`}${s.ended ? '<small>Negotiation over</small>' : ''}</div>
      <div class="pv-known"><h3>What you know</h3>${known.length ? known.map(([m, k]) => `<span class="${k === 'Pitfall' ? 'p' : 'm'}">${k === 'Pitfall' ? '⚠ ' : ''}${esc(m.name)}</span>`).join('') : '<p>Nothing yet. Ask what they want, or read them.</p>'}</div></div>`;
    $('.pv-x', el).onclick = () => el.remove();
  };
  draw(); document.body.appendChild(el);
}
