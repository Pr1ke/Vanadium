
// ================= SESSIONS =================
let SESSIONS = store.get('sessions', []);
const saveSessions = () => store.set('sessions', SESSIONS);
const sessById = id => SESSIONS.find(s => s.id === id);
const DOCICON = { page: '📝', enc: '⚔', mtg: '🏃', neg: '🗣' };
const DOCKIND = { page: 'Page', enc: 'Combat encounter', mtg: 'Montage test', neg: 'Negotiation' };
const today = () => new Date().toISOString().slice(0, 10);
function newSessionObj() {
  const n = SESSIONS.length + 1;
  return { id: 's' + Date.now().toString(36), name: 'Session ' + n, date: today(), heroes: ENC?.heroes || 4, level: ENC?.level || 1, victories: ENC?.victories || 0,
    docs: [{ id: 'd' + Date.now().toString(36), type: 'page', title: 'Session plan', md: '# Session ' + n + '\n\n## Recap\n\n- \n\n## Scenes\n\n1. \n\n> Read-aloud text goes in a quote block like this.\n\n## Loose ends\n\n- [ ] \n' }] };
}
function syncEncToSession() {
  const r = ENC.sessionRef; const S = sessById(r.sid); const d = S && S.docs.find(x => x.id === r.did);
  if (!d) { delete ENC.sessionRef; return; }
  const c = JSON.parse(JSON.stringify(ENC)); delete c.sessionRef; d.enc = c; d.title = c.name || d.title; saveSessions();
}
function sessionsHub() {
  $('#main').innerHTML = `<div class="neghub"><h1>Sessions</h1>
    <p class="note">One folder per game night. Write notes and read-aloud text in markdown, add the combat encounters, montages and negotiations you plan to run, and export the whole session as one PDF for the table.</p>
    <div class="negacts"><button class="btn" id="snew">+ New session</button></div>
    ${SESSIONS.length ? `<div class="negg">${SESSIONS.map(s => `<a class="negc sesc" href="#session--${s.id}"><b>${esc(s.name)}</b><span>${esc(s.date || '')} · ${s.docs.length} item${s.docs.length === 1 ? '' : 's'}</span><em>${s.docs.map(d => DOCICON[d.type] + ' ' + esc(d.title)).slice(0, 4).join(' · ')}${s.docs.length > 4 ? ' …' : ''}</em></a>`).join('')}</div>` : '<div class="empty">No sessions yet.</div>'}</div>`;
  $('#snew').onclick = () => { const s = newSessionObj(); SESSIONS.unshift(s); saveSessions(); go('session--' + s.id + '--' + s.docs[0].id); };
  document.title = 'Sessions — Vanadium';
}
let sessEdit = false;
function sessionPage(sid, did) {
  const S = sessById(sid); if (!S) { go('sessions'); return; }
  if (!PACKS.length) { $('#main').innerHTML = '<div class="empty">Loading…</div>'; return; }
  const d = did ? S.docs.find(x => x.id === did) : null;
  const nav = `<div class="bk-books"><a class="ch" href="#sessions">← All sessions</a></div>
    <div class="sess-meta"><input id="s-name" value="${esc(S.name)}" aria-label="Session name"><input id="s-date" type="date" value="${esc(S.date || '')}"></div>
    <a class="ch ${!d ? 'cur' : ''}" href="#session--${S.id}">Overview</a>
    ${S.docs.map((x, i) => `<div class="sdoc ${d && d.id === x.id ? 'cur' : ''}"><a href="#session--${S.id}--${x.id}"><span class="di">${DOCICON[x.type]}</span>${esc(x.title || DOCKIND[x.type])}</a><span class="sdoc-b"><button data-up="${i}" title="Move up">↑</button><button data-dn="${i}" title="Move down">↓</button></span></div>`).join('')}
    <div class="sadd"><b>Add</b><button class="btn ghost sm" data-add="page">📝 Page</button><button class="btn ghost sm" data-add="enc">⚔ Encounter</button><button class="btn ghost sm" data-add="mtg">🏃 Montage</button><button class="btn ghost sm" data-add="neg">🗣 Negotiation</button></div>
    <div class="sadd"><button class="btn" id="s-export">⬇ Export this session</button><button class="btn ghost sm danger" id="s-del">Delete session</button></div>`;
  let main = '';
  if (!d) {
    const encs = S.docs.filter(x => x.type === 'enc');
    main = `<h1 class="chap-title">${esc(S.name)}</h1><div class="kind">${esc(S.date || '')}</div>
      <div class="party dlgp" style="margin:12px 0"><label>Heroes<input type="number" id="s-h" min="1" max="12" value="${S.heroes}"></label><label>Level<input type="number" id="s-l" min="1" max="10" value="${S.level}"></label><label>Avg. Victories<input type="number" id="s-v" min="0" value="${S.victories}"></label></div>
      <p class="note">The party here is used for encounters you add to this session.</p>
      <div class="soverview">${S.docs.map(x => `<a class="beitem" href="#session--${S.id}--${x.id}"><b>${DOCICON[x.type]} ${esc(x.title || DOCKIND[x.type])}</b><span>${DOCKIND[x.type]}${x.type === 'enc' && x.enc ? ' · ' + (() => { const m = encMath(x.enc); return m.diff + ', ' + m.ev + ' EV'; })() : ''}${x.type === 'page' ? ' · ' + (x.md || '').split(/\s+/).filter(Boolean).length + ' words' : ''}</span></a>`).join('') || '<div class="empty">Nothing in this session yet. Add a page, encounter, montage or negotiation.</div>'}</div>
      ${encs.length ? `<p class="note">Combat this session: ${encs.map(x => esc(x.title)).join(', ')}.</p>` : ''}`;
  } else main = sessDocHtml(S, d);
  $('#main').innerHTML = `<div class="bk sess"><div class="bk-nav" id="bnav">${nav}</div><div class="bk-main" id="bmain">${main}</div>
    <button class="mtoc-btn" id="mtoc"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Session</button></div>`;
  const nv = $('#bnav'); $('#mtoc').onclick = () => { nv.classList.add('on'); showScrim(() => nv.classList.remove('on')); };
  $$('#bnav a').forEach(a => a.addEventListener('click', () => { if (isMob) { nv.classList.remove('on'); hideScrim(); } }));
  $('#s-name').onchange = e => { S.name = e.target.value || 'Session'; saveSessions(); };
  $('#s-date').onchange = e => { S.date = e.target.value; saveSessions(); };
  $$('[data-up],[data-dn]').forEach(b => b.onclick = () => { const i = +(b.dataset.up ?? b.dataset.dn), j = b.dataset.up != null ? i - 1 : i + 1; if (j < 0 || j >= S.docs.length) return; [S.docs[i], S.docs[j]] = [S.docs[j], S.docs[i]]; saveSessions(); sessionPage(sid, did); });
  $$('[data-add]').forEach(b => b.onclick = () => sessAdd(S, b.dataset.add));
  $('#s-export').onclick = () => exportSession(S, $('#s-export'));
  $('#s-del').onclick = async () => { if (await confirmSheet(`Delete “${S.name}” and everything in it?`, 'Delete')) { SESSIONS = SESSIONS.filter(x => x !== S); saveSessions(); go('sessions'); } };
  if (!d) ['h', 'l', 'v'].forEach(k => { const el = $('#s-' + k); el.onchange = () => { S[{ h: 'heroes', l: 'level', v: 'victories' }[k]] = Math.max(k === 'v' ? 0 : 1, +el.value || 0); saveSessions(); }; });
  if (d) wireSessDoc(S, d);
  document.title = (d ? d.title + ' · ' : '') + S.name + ' — Vanadium';
}
function sessDocHtml(S, d) {
  const top = `<div class="sdoc-top"><input id="d-title" class="encname" value="${esc(d.title)}" aria-label="Title"><div class="negtb">${d.type === 'page' ? `<button class="btn ghost sm" id="d-edit">${sessEdit ? 'Done' : 'Edit'}</button>` : ''}<button class="btn ghost sm" id="d-pdf">PDF</button><button class="btn ghost sm danger" id="d-del">Remove</button></div></div><div class="kind">${DOCKIND[d.type]}</div>`;
  if (d.type === 'page') {
    if (sessEdit) return top + `<div class="mdedit"><textarea id="d-md" spellcheck="true">${esc(d.md || '')}</textarea><div class="rd mdprev" id="d-prev">${mdHtml(d.md)}</div></div>
      <p class="note">Markdown: <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>- list</code>, <code>1. list</code>, <code>- [ ] checkbox</code>, <code>&gt; read-aloud</code>, <code>| tables |</code>, <code>---</code>, <code>[link](https://…)</code>.</p>`;
    return top + `<div class="rd mdview">${mdHtml(d.md) || '<p class="note">Empty page. Click Edit to write.</p>'}</div>`;
  }
  if (d.type === 'enc') {
    const E = d.enc; if (!E) return top + '<div class="empty">Missing encounter.</div>';
    const M = encMath(E);
    const SAVED = ENC; ENC = E; if (STONES_ON) assignStones(false); const sc = scalingHtml(); ENC = SAVED;
    return top + `<div class="sencsum"><span class="dlabel" style="color:${DCOL[M.diff]}">${M.diff}</span> <b>${M.ev} EV</b> vs encounter strength ${M.ES} · ${E.heroes} heroes, level ${M.L}, ${E.victories} Victories · worth ${M.worth} Victor${M.worth === 1 ? 'y' : 'ies'}</div>
      <div class="actrow"><button class="btn" id="d-open">Open in Encounter Builder</button><button class="btn ghost" id="d-repl">Replace with the builder’s current encounter</button></div>
      ${E.groups.map(g => `<div class="grp"><div class="grp-t"><b class="gname" style="border:0">${esc(g.name)}</b></div>${g.entries.map(e => { const m = MON[e.gid]; return m ? `<div class="ent"><div class="ent-n"><a class="lnk" data-go="monsters--${m.gid}">${e.n} × ${esc(m.name)}</a>${(() => { const S2 = ENC; ENC = E; const h = entStones(g, e, m); ENC = S2; return h; })()}<span>Lv ${m.level} ${esc(m.role)} · ${isMinion(m) ? esc(m.ev) : 'EV ' + esc(m.ev)} · Stamina ${esc((m.stats || {}).Stamina || '—')}</span></div></div>` : ''; }).join('')}</div>`).join('')}
      ${sc}`;
  }
  const ref = d.type === 'mtg' ? (refreshMontages(), mtById(d.ref)) : (refreshNegotiations(), negById(d.ref));
  if (!ref) return top + `<div class="empty">This ${DOCKIND[d.type].toLowerCase()} is no longer available (was its book removed?).</div>`;
  if (d.type === 'mtg') return top + `<div class="actrow"><a class="btn" href="#montage--${ref.id}">▶ Run this montage</a></div>
    ${ref.intro ? `<p>${esc(ref.intro)}</p>` : ''}${ref.scene.map(x => `<div class="ra">${esc(x)}</div>`).join('')}
    <h3>Challenges</h3>${ref.challenges.map(c => `<div class="mtch"><div class="mtch-h"><b>${esc(c.name)}</b>${c.round > 1 ? `<span class="tagk">round ${c.round}</span>` : ''}</div><p>${esc(c.desc)}</p><div class="mtsug">${c.chars.map(x => `<span class="ck">${esc(x)}</span>`).join('')}${c.skills.map(x => `<span>${esc(x)}</span>`).join('')}</div></div>`).join('')}`;
  return top + `<div class="actrow"><a class="btn" href="#negotiation--${ref.id}">▶ Run this negotiation</a></div>
    ${ref.intro ? `<p>${esc(ref.intro)}</p>` : ''}<p><b>Interest</b> ${ref.interest} · <b>Patience</b> ${ref.patience} · <b>Impression</b> ${ref.impression ?? '—'}${ref.language ? ' · <b>Language</b> ' + esc(ref.language) : ''}</p>
    <h3>Motivations</h3>${ref.motivations.map(m => `<p><b>${esc(m.name)}:</b> ${esc(m.text)}</p>`).join('') || '<p class="note">None</p>'}
    <h3>Pitfalls</h3>${ref.pitfalls.map(m => `<p><b>${esc(m.name)}:</b> ${esc(m.text)}</p>`).join('') || '<p class="note">None</p>'}`;
}
function wireSessDoc(S, d) {
  $('#d-title').onchange = e => { d.title = e.target.value || DOCKIND[d.type]; if (d.type === 'enc' && d.enc) d.enc.name = d.title; saveSessions(); sessionPage(S.id, d.id); };
  $('#d-del').onclick = async () => { if (await confirmSheet(`Remove “${d.title}” from this session?`, 'Remove')) { S.docs = S.docs.filter(x => x !== d); saveSessions(); go('session--' + S.id); } };
  $('#d-pdf').onclick = () => runPdfJob($('#d-pdf'), 'PDF', async () => { const b = await docPdf(S, d); if (b) await deliverFile(pdfFileName(d.title), new Blob([b], { type: 'application/pdf' })); });
  if ($('#d-edit')) $('#d-edit').onclick = () => { sessEdit = !sessEdit; sessionPage(S.id, d.id); if (sessEdit) setTimeout(() => $('#d-md')?.focus(), 30); };
  const ta = $('#d-md'); let tm;
  if (ta) ta.oninput = () => { d.md = ta.value; clearTimeout(tm); tm = setTimeout(() => { saveSessions(); $('#d-prev').innerHTML = mdHtml(d.md); }, 250); };
  if ($('#d-open')) $('#d-open').onclick = () => { ENC = JSON.parse(JSON.stringify(d.enc)); ENC.sessionRef = { sid: S.id, did: d.id }; ENC.setup = false; store.set('enc', ENC); go('encounter'); };
  if ($('#d-repl')) $('#d-repl').onclick = async () => { if (!ENC.groups.some(g => g.entries.length)) { toast('The encounter builder is empty'); return; } if (await confirmSheet(`Replace “${d.title}” with “${ENC.name}” from the builder?`, 'Replace')) { const c = JSON.parse(JSON.stringify(ENC)); delete c.sessionRef; d.enc = c; d.title = c.name; saveSessions(); sessionPage(S.id, d.id); } };
}
function pickerSheet(title, items, onPick) { // items: [{id, name, sub, group}]
  const el = document.createElement('div'); el.className = 'dlg';
  const groups = {}; items.forEach(x => (groups[x.group] = groups[x.group] || []).push(x));
  el.innerHTML = `<div class="dlg-b negedit"><h2>${esc(title)}</h2><input id="pk-q" type="search" placeholder="Filter…" style="width:100%;margin-bottom:10px;background:var(--bg);color:var(--ink);border:1px solid var(--line2);border-radius:4px;padding:8px">
    <div>${Object.entries(groups).map(([g, xs]) => `<h3 class="negh" style="margin-top:10px">${esc(g)}</h3>${xs.map(x => `<button class="beitem" data-pk="${esc(x.id)}" data-q="${esc((x.name + ' ' + (x.sub || '')).toLowerCase())}"><b>${esc(x.name)}</b><span>${esc(x.sub || '')}</span></button>`).join('')}`).join('') || '<div class="empty">Nothing to add.</div>'}</div>
    <div class="dlgfoot"><span style="flex:1"></span><button class="btn ghost" id="pk-x">Close</button></div></div>`;
  document.body.appendChild(el);
  $('#pk-x', el).onclick = () => el.remove();
  $('#pk-q', el).oninput = e => { const q = e.target.value.toLowerCase(); $$('.beitem', el).forEach(b => b.style.display = b.dataset.q.includes(q) ? '' : 'none'); };
  $$('[data-pk]', el).forEach(b => b.onclick = () => { el.remove(); onPick(b.dataset.pk); });
  setTimeout(() => $('#pk-q', el).focus(), 30);
}
function sessAdd(S, type) {
  const add = doc => { doc.id = 'd' + Date.now().toString(36); S.docs.push(doc); saveSessions(); if (doc.type === 'page') sessEdit = true; go('session--' + S.id + '--' + doc.id); };
  const party = { heroes: S.heroes, level: S.level, victories: S.victories, retainers: 0 };
  if (type === 'page') return add({ type: 'page', title: 'New page', md: '# New page\n\n' });
  if (type === 'mtg') { refreshMontages(); return pickerSheet('Add a montage test', allMt().map(m => ({ id: m.id, name: m.name, sub: m.challenges.length + ' challenges', group: m.user ? 'Your montages' : (PK[m.pack]?.title || '') })), id => add({ type: 'mtg', ref: id, title: mtById(id).name })); }
  if (type === 'neg') { refreshNegotiations(); return pickerSheet('Add a negotiation', allNegs().map(n => ({ id: n.id, name: n.name, sub: `Interest ${n.interest} · Patience ${n.patience}`, group: n.user ? 'Your negotiations' : (PK[n.pack]?.title || '') })), id => add({ type: 'neg', ref: id, title: negById(id).name })); }
  if (type === 'enc') {
    const items = [];
    if (ENC.groups.some(g => g.entries.length)) items.push({ id: 'cur', name: ENC.name, sub: (() => { const m = encMath(); return m.diff + ' · ' + m.ev + ' EV'; })(), group: 'In the Encounter Builder now' });
    ENCS.forEach(e => items.push({ id: 'saved:' + e.id, name: e.name, sub: e.groups.reduce((s, g) => s + g.entries.length, 0) + ' kinds of creature', group: 'Saved encounters' }));
    items.push({ id: 'new', name: 'Empty encounter', sub: 'Build it in the Encounter Builder', group: 'New' }, { id: 'book', name: 'From a book…', sub: 'Any delve or adventure encounter table', group: 'New' });
    return pickerSheet('Add a combat encounter', items, id => {
      let e;
      if (id === 'cur') e = JSON.parse(JSON.stringify(ENC));
      else if (id.startsWith('saved:')) e = JSON.parse(JSON.stringify(ENCS.find(x => 'saved:' + x.id === id)));
      else if (id === 'new') e = newEnc(party);
      else return bookEncounterSheet((p, c, i) => { const bd = bookEncounterData(p, c, i); if (!bd || !bd.groups.length) { toast('Couldn’t match any creatures in that table'); return; } const e2 = newEnc(party); e2.name = bd.name; e2.groups = bd.groups; e2.bookAdjust = bd.adj; e2.setup = false; add({ type: 'enc', title: e2.name, enc: e2 }); });
      delete e.sessionRef; e.id = 'e' + Date.now().toString(36); e.setup = false;
      if (id === 'new') e.name = 'Encounter ' + (S.docs.filter(x => x.type === 'enc').length + 1);
      add({ type: 'enc', title: e.name, enc: e });
    });
  }
}
async function docPdf(S, d) {
  if (d.type === 'page') return buildMarkdownPdf(d.title, d.md, S.name);
  if (d.type === 'enc') { if (!d.enc.groups.some(g => g.entries.some(e => MON[e.gid]))) return null; const b = await buildEncounterPdf(d.enc); saveSessions(); return b; }
  if (d.type === 'mtg') { refreshMontages(); const m = mtById(d.ref); return m ? buildMontagePdf(m) : null; }
  if (d.type === 'neg') { refreshNegotiations(); const n = negById(d.ref); return n ? buildNegotiationPdf(n) : null; }
}
async function exportSession(S, btn) {
  await runPdfJob(btn, '⬇ Export this session', async () => {
    const w = await makeWriter(S.name); w.newPage();
    w.header(S.name, `${S.date || ''} · ${S.heroes} heroes, level ${S.level}, ${S.victories} avg. Victories`, 'Session');
    w.h('Contents', 2);
    const parts = [], skipped = [];
    for (const d of S.docs) { const b = await docPdf(S, d); if (b) parts.push([d, b]); else skipped.push(d.title); }
    const { PDFDocument } = await loadPdfLib();
    let pg = 2;
    for (const [d, b] of parts) { const n = (await PDFDocument.load(b)).getPageCount(); w.ensure(16); w.T(`${DOCKIND[d.type]}`, w.MG, w.y - 11, 8.5, w.F, w.grey); w.T(d.title, w.MG + 110, w.y - 11, 10.5, w.FB); w.T('p. ' + pg, w.MG + w.CW - w.tw('p. ' + pg, 10, w.F), w.y - 11, 10, w.F); w.y -= 18; pg += n; }
    if (skipped.length) w.para(`<i>Skipped (empty or unavailable): ${esc(skipped.join(', '))}</i>`, { size: 8 });
    const cover = await w.bytes();
    const out = await mergePdfs([cover, ...parts.map(x => x[1])], S.name);
    await deliverFile(pdfFileName(S.name, 'session'), new Blob([out], { type: 'application/pdf' }));
  });
}

