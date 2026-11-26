
// ================= SESSIONS =================
// One folder per game night. Pages (markdown) are built in; everything else a session can hold
// comes from the game system (SYS.session.kinds, e.g. Draw Steel encounters, montages,
// negotiations), together with the party fields shown on the overview (SYS.session.party).
let SESSIONS = store.get('sessions', []);
const saveSessions = () => store.set('sessions', SESSIONS);
const sessById = id => SESSIONS.find(s => s.id === id);
const SESS_PAGE = { icon: '📝', label: 'Page' };
const sessKind = t => t === 'page' ? SESS_PAGE : ((SYS.session || {}).kinds || {})[t] || { icon: '•', label: t };
const sessKinds = () => Object.entries((SYS.session || {}).kinds || {});
const today = () => new Date().toISOString().slice(0, 10);
function newSessionObj() {
  const n = SESSIONS.length + 1;
  return { id: 's' + Date.now().toString(36), name: 'Session ' + n, date: today(), ...(SYS.session?.newParty ? SYS.session.newParty() : {}),
    docs: [{ id: 'd' + Date.now().toString(36), type: 'page', title: 'Session plan', md: '# Session ' + n + '\n\n## Recap\n\n- \n\n## Scenes\n\n1. \n\n> Read-aloud text goes in a quote block like this.\n\n## Loose ends\n\n- [ ] \n' }] };
}
function sessionsHub() {
  $('#main').innerHTML = `<div class="neghub"><h1>Sessions</h1>
    <p class="note">One folder per game night. Write notes and read-aloud text in markdown, add the ${esc(SYS.session?.planText || 'material')} you plan to run, and export the whole session as one PDF for the table.</p>
    <div class="negacts"><button class="btn" id="snew">+ New session</button></div>
    ${SESSIONS.length ? `<div class="negg">${SESSIONS.map(s => `<a class="negc sesc" href="#session--${s.id}"><b>${esc(s.name)}</b><span>${esc(s.date || '')} · ${s.docs.length} item${s.docs.length === 1 ? '' : 's'}</span><em>${s.docs.map(d => sessKind(d.type).icon + ' ' + esc(d.title)).slice(0, 4).join(' · ')}${s.docs.length > 4 ? ' …' : ''}</em></a>`).join('')}</div>` : '<div class="empty">No sessions yet.</div>'}</div>`;
  $('#snew').onclick = () => { const s = newSessionObj(); SESSIONS.unshift(s); saveSessions(); go('session--' + s.id + '--' + s.docs[0].id); };
  document.title = 'Sessions — Vanadium';
}
let sessEdit = false;
function sessionPage(sid, did) {
  const S = sessById(sid); if (!S) { go('sessions'); return; }
  if (!PACKS.length) { $('#main').innerHTML = '<div class="empty">Loading…</div>'; return; }
  const d = did ? S.docs.find(x => x.id === did) : null;
  const party = SYS.session?.party || [];
  const nouns = ['page', ...sessKinds().map(([, k]) => k.noun)];
  const nav = `<div class="bk-books"><a class="ch" href="#sessions">← All sessions</a></div>
    <div class="sess-meta"><input id="s-name" value="${esc(S.name)}" aria-label="Session name"><input id="s-date" type="date" value="${esc(S.date || '')}"></div>
    <a class="ch ${!d ? 'cur' : ''}" href="#session--${S.id}">Overview</a>
    ${S.docs.map((x, i) => `<div class="sdoc ${d && d.id === x.id ? 'cur' : ''}"><a href="#session--${S.id}--${x.id}"><span class="di">${sessKind(x.type).icon}</span>${esc(x.title || sessKind(x.type).label)}</a><span class="sdoc-b"><button data-up="${i}" title="Move up">↑</button><button data-dn="${i}" title="Move down">↓</button></span></div>`).join('')}
    <div class="sadd"><b>Add</b><button class="btn ghost sm" data-add="page">📝 Page</button>${sessKinds().map(([t, k]) => `<button class="btn ghost sm" data-add="${t}">${k.addLabel}</button>`).join('')}</div>
    <div class="sadd"><button class="btn" id="s-export">⬇ Export this session</button><button class="btn ghost sm danger" id="s-del">Delete session</button></div>`;
  let main = '';
  if (!d) {
    main = `<h1 class="chap-title">${esc(S.name)}</h1><div class="kind">${esc(S.date || '')}</div>
      ${party.length ? `<div class="party dlgp" style="margin:12px 0">${party.map(f => `<label>${f.label}<input type="number" id="s-${f.id}" min="${f.min}"${f.max != null ? ` max="${f.max}"` : ''} value="${S[f.key]}"></label>`).join('')}</div>
      <p class="note">${SYS.session.partyNote}</p>` : ''}
      <div class="soverview">${S.docs.map(x => `<a class="beitem" href="#session--${S.id}--${x.id}"><b>${sessKind(x.type).icon} ${esc(x.title || sessKind(x.type).label)}</b><span>${sessKind(x.type).label}${sessKind(x.type).summary ? sessKind(x.type).summary(x) : ''}${x.type === 'page' ? ' · ' + (x.md || '').split(/\s+/).filter(Boolean).length + ' words' : ''}</span></a>`).join('') || `<div class="empty">Nothing in this session yet. Add a ${nouns.length > 1 ? nouns.slice(0, -1).join(', ') + ' or ' + nouns[nouns.length - 1] : nouns[0]}.</div>`}</div>
      ${SYS.session?.overviewExtra ? SYS.session.overviewExtra(S) : ''}`;
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
  if (!d) party.forEach(f => { const el = $('#s-' + f.id); el.onchange = () => { S[f.key] = Math.max(f.min, +el.value || 0); saveSessions(); }; });
  if (d) wireSessDoc(S, d);
  document.title = (d ? d.title + ' · ' : '') + S.name + ' — Vanadium';
}
function sessDocHtml(S, d) {
  const top = `<div class="sdoc-top"><input id="d-title" class="encname" value="${esc(d.title)}" aria-label="Title"><div class="negtb">${d.type === 'page' ? `<button class="btn ghost sm" id="d-edit">${sessEdit ? 'Done' : 'Edit'}</button>` : ''}<button class="btn ghost sm" id="d-pdf">PDF</button><button class="btn ghost sm danger" id="d-del">Remove</button></div></div><div class="kind">${sessKind(d.type).label}</div>`;
  if (d.type === 'page') {
    if (sessEdit) return top + `<div class="mdedit"><textarea id="d-md" spellcheck="true">${esc(d.md || '')}</textarea><div class="rd mdprev" id="d-prev">${mdHtml(d.md)}</div></div>
      <p class="note">Markdown: <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>- list</code>, <code>1. list</code>, <code>- [ ] checkbox</code>, <code>&gt; read-aloud</code>, <code>| tables |</code>, <code>---</code>, <code>[link](https://…)</code>.</p>`;
    return top + `<div class="rd mdview">${mdHtml(d.md) || '<p class="note">Empty page. Click Edit to write.</p>'}</div>`;
  }
  const k = sessKind(d.type);
  return k.html ? k.html(S, d, top) : top + `<div class="empty">This item type isn’t available in ${esc(SYS.name)}.</div>`;
}
function wireSessDoc(S, d) {
  const k = sessKind(d.type);
  $('#d-title').onchange = e => { d.title = e.target.value || k.label; if (k.onRename) k.onRename(d); saveSessions(); sessionPage(S.id, d.id); };
  $('#d-del').onclick = async () => { if (await confirmSheet(`Remove “${d.title}” from this session?`, 'Remove')) { S.docs = S.docs.filter(x => x !== d); saveSessions(); go('session--' + S.id); } };
  $('#d-pdf').onclick = () => runPdfJob($('#d-pdf'), 'PDF', async () => { const b = await docPdf(S, d); if (b) await deliverFile(pdfFileName(d.title), new Blob([b], { type: 'application/pdf' })); });
  if ($('#d-edit')) $('#d-edit').onclick = () => { sessEdit = !sessEdit; sessionPage(S.id, d.id); if (sessEdit) setTimeout(() => $('#d-md')?.focus(), 30); };
  const ta = $('#d-md'); let tm;
  if (ta) ta.oninput = () => { d.md = ta.value; clearTimeout(tm); tm = setTimeout(() => { saveSessions(); $('#d-prev').innerHTML = mdHtml(d.md); }, 250); };
  if (k.wire) k.wire(S, d);
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
  if (type === 'page') return add({ type: 'page', title: 'New page', md: '# New page\n\n' });
  const k = sessKind(type); if (k.add) k.add(S, add);
}
async function docPdf(S, d) {
  if (d.type === 'page') return buildMarkdownPdf(d.title, d.md, S.name);
  const k = sessKind(d.type); return k.pdf ? k.pdf(S, d) : null;
}
async function exportSession(S, btn) {
  await runPdfJob(btn, '⬇ Export this session', async () => {
    const w = await makeWriter(S.name); w.newPage();
    w.header(S.name, `${S.date || ''}${SYS.session?.partyLine ? ' · ' + SYS.session.partyLine(S) : ''}`, 'Session');
    w.h('Contents', 2);
    const parts = [], skipped = [];
    for (const d of S.docs) { const b = await docPdf(S, d); if (b) parts.push([d, b]); else skipped.push(d.title); }
    const { PDFDocument } = await loadPdfLib();
    let pg = 2;
    for (const [d, b] of parts) { const n = (await PDFDocument.load(b)).getPageCount(); w.ensure(16); w.T(`${sessKind(d.type).label}`, w.MG, w.y - 11, 8.5, w.F, w.grey); w.T(d.title, w.MG + 110, w.y - 11, 10.5, w.FB); w.T('p. ' + pg, w.MG + w.CW - w.tw('p. ' + pg, 10, w.F), w.y - 11, 10, w.F); w.y -= 18; pg += n; }
    if (skipped.length) w.para(`<i>Skipped (empty or unavailable): ${esc(skipped.join(', '))}</i>`, { size: 8 });
    const cover = await w.bytes();
    const out = await mergePdfs([cover, ...parts.map(x => x[1])], S.name);
    await deliverFile(pdfFileName(S.name, 'session'), new Blob([out], { type: 'application/pdf' }));
  });
}

