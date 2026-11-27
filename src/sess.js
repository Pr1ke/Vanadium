
// ================= SESSIONS =================
// One folder per game night. Pages (markdown) are built in; everything else a session can hold
// comes from the game system (SYS.session.kinds, e.g. Draw Steel encounters, montages,
// negotiations), together with the party fields shown on the overview (SYS.session.party).
// Folders (type 'folder') group items inside a session; an item's `parent` is the folder it is in.
// S.docs stays one ordered list, so sessions without folders work exactly as before.
let SESSIONS = store.get('sessions', []);
const saveSessions = () => store.set('sessions', SESSIONS);
const sessById = id => SESSIONS.find(s => s.id === id);
const SESS_PAGE = { icon: '📝', label: 'Page' };
const SESS_FOLDER = { icon: '📁', label: 'Folder' };
const sessKind = t => t === 'page' ? SESS_PAGE : t === 'folder' ? SESS_FOLDER : ((SYS.session || {}).kinds || {})[t] || { icon: '•', label: t };
const sessKinds = () => Object.entries((SYS.session || {}).kinds || {});
const today = () => new Date().toISOString().slice(0, 10);
const isFolder = d => d.type === 'folder';
const sessParent = (S, d) => d.parent && S.docs.some(f => f.id === d.parent && isFolder(f)) ? d.parent : null;   // a missing folder = top level
const sessChildren = (S, pid) => S.docs.filter(d => sessParent(S, d) === (pid || null));
function sessTree(S, pid = null, depth = 0, out = []) { for (const d of sessChildren(S, pid)) { out.push([d, depth]); if (isFolder(d)) sessTree(S, d.id, depth + 1, out); } return out; }
const sessItems = S => S.docs.filter(d => !isFolder(d));   // pages, encounters, … (not folders)
const sessCount = (S, id) => sessTree(S, id).filter(([x]) => !isFolder(x)).length;
const sessDepth = depth => depth ? ` style="--d:${depth}"` : '';
const sessNewId = S => { let id; do id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); while (S.docs.some(x => x.id === id)); return id; };
function newSessionObj() {
  const n = SESSIONS.length + 1;
  return { id: 's' + Date.now().toString(36), name: 'Session ' + n, date: today(), ...(SYS.session?.newParty ? SYS.session.newParty() : {}),
    docs: [{ id: 'd' + Date.now().toString(36), type: 'page', title: 'Session plan', md: '# Session ' + n + '\n\n## Recap\n\n- \n\n## Scenes\n\n1. \n\n> Read-aloud text goes in a quote block like this.\n\n## Loose ends\n\n- [ ] \n' }] };
}
function sessionsHub() {
  $('#main').innerHTML = `<div class="neghub"><h1>Sessions</h1>
    <p class="note">One folder per game night. Write notes and read-aloud text in markdown, add the ${esc(SYS.session?.planText || 'material')} you plan to run, group them in folders, and export the whole session as one PDF for the table.</p>
    <div class="negacts"><button class="btn" id="snew">+ New session</button></div>
    ${SESSIONS.length ? `<div class="negg">${SESSIONS.map(s => { const items = sessItems(s); return `<a class="negc sesc" href="#session--${s.id}"><b>${esc(s.name)}</b><span>${esc(s.date || '')} · ${items.length} item${items.length === 1 ? '' : 's'}</span><em>${s.docs.map(d => sessKind(d.type).icon + ' ' + esc(d.title)).slice(0, 4).join(' · ')}${s.docs.length > 4 ? ' …' : ''}</em></a>`; }).join('')}</div>` : '<div class="empty">No sessions yet.</div>'}</div>`;
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
  const here = d ? (isFolder(d) ? d.id : sessParent(S, d)) : null, hereF = here && S.docs.find(x => x.id === here);   // new items go into the folder you are in
  const rows = []; let hide = null;
  for (const [x, depth] of sessTree(S)) { if (hide != null && depth > hide) continue; hide = null; rows.push([x, depth]); if (isFolder(x) && x.collapsed) hide = depth; }
  const mv = i => `<span class="sdoc-b"><button data-up="${i}" title="Move up">↑</button><button data-dn="${i}" title="Move down">↓</button></span>`;
  const nav = `<div class="bk-books"><a class="ch" href="#sessions">← All sessions</a></div>
    <div class="sess-meta"><input id="s-name" value="${esc(S.name)}" aria-label="Session name"><input id="s-date" type="date" value="${esc(S.date || '')}"></div>
    <a class="ch ${!d ? 'cur' : ''}" href="#session--${S.id}">Overview</a>
    ${rows.map(([x, depth]) => { const i = S.docs.indexOf(x), cur = d && d.id === x.id ? 'cur' : ''; return isFolder(x)
      ? `<div class="sdoc sfold ${cur}"${sessDepth(depth)}><button class="sfold-t" data-ftog="${x.id}" title="${x.collapsed ? 'Open' : 'Close'} folder" aria-expanded="${!x.collapsed}">${x.collapsed ? '▸' : '▾'}</button><a href="#session--${S.id}--${x.id}"><span class="di">${x.collapsed ? '📁' : '📂'}</span>${esc(x.title || 'Folder')}<small>${sessCount(S, x.id)}</small></a>${mv(i)}</div>`
      : `<div class="sdoc ${cur}"${sessDepth(depth)}><a href="#session--${S.id}--${x.id}"><span class="di">${sessKind(x.type).icon}</span>${esc(x.title || sessKind(x.type).label)}</a>${mv(i)}</div>`; }).join('')}
    <div class="sadd"><b>Add${hereF ? ` <span class="sadd-in">to 📁 ${esc(hereF.title)}</span>` : ''}</b><button class="btn ghost sm" data-add="page">📝 Page</button>${sessKinds().map(([t, k]) => `<button class="btn ghost sm" data-add="${t}">${k.addLabel}</button>`).join('')}<button class="btn ghost sm" data-add="folder">📁 Folder</button></div>
    <div class="sadd"><button class="btn" id="s-export">⬇ Export this session</button><button class="btn ghost sm danger" id="s-del">Delete session</button></div>`;
  let main = '';
  if (!d) {
    main = `<h1 class="chap-title">${esc(S.name)}</h1><div class="kind">${esc(S.date || '')}</div>
      ${party.length ? `<div class="party dlgp" style="margin:12px 0">${party.map(f => `<label>${f.label}<input type="number" id="s-${f.id}" min="${f.min}"${f.max != null ? ` max="${f.max}"` : ''} value="${S[f.key]}"></label>`).join('')}</div>
      <p class="note">${SYS.session.partyNote}</p>` : ''}
      <div class="soverview">${sessTree(S).map(([x, depth]) => sessEntry(S, x, depth)).join('') || `<div class="empty">Nothing in this session yet. Add a ${nouns.length > 1 ? nouns.slice(0, -1).join(', ') + ' or ' + nouns[nouns.length - 1] : nouns[0]}.</div>`}</div>
      ${SYS.session?.overviewExtra ? SYS.session.overviewExtra(S) : ''}`;
  } else main = sessDocHtml(S, d);
  $('#main').innerHTML = `<div class="bk sess"><div class="bk-nav" id="bnav">${nav}</div><div class="bk-main" id="bmain">${main}</div>
    <button class="mtoc-btn" id="mtoc"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Session</button></div>`;
  const nv = $('#bnav'); $('#mtoc').onclick = () => { nv.classList.add('on'); showScrim(() => nv.classList.remove('on')); };
  $$('#bnav a').forEach(a => a.addEventListener('click', () => { if (isMob) { nv.classList.remove('on'); hideScrim(); } }));
  $('#s-name').onchange = e => { S.name = e.target.value || 'Session'; saveSessions(); };
  $('#s-date').onchange = e => { S.date = e.target.value; saveSessions(); };
  $$('[data-up],[data-dn]').forEach(b => b.onclick = () => {   // moves among the items in the same folder
    const x = S.docs[+(b.dataset.up ?? b.dataset.dn)], sib = sessChildren(S, sessParent(S, x)), y = sib[sib.indexOf(x) + (b.dataset.up != null ? -1 : 1)];
    if (!y) return; const i = S.docs.indexOf(x), j = S.docs.indexOf(y); [S.docs[i], S.docs[j]] = [S.docs[j], S.docs[i]]; saveSessions(); sessionPage(sid, did);
  });
  $$('[data-ftog]').forEach(b => b.onclick = () => { const f = S.docs.find(x => x.id === b.dataset.ftog); f.collapsed = !f.collapsed; saveSessions(); sessionPage(sid, did); });
  $$('[data-add]').forEach(b => b.onclick = () => sessAdd(S, b.dataset.add, here));
  $('#s-export').onclick = () => exportSession(S, $('#s-export'));
  $('#s-del').onclick = async () => { if (await confirmSheet(`Delete “${S.name}” and everything in it?`, 'Delete')) { SESSIONS = SESSIONS.filter(x => x !== S); saveSessions(); go('sessions'); } };
  if (!d) party.forEach(f => { const el = $('#s-' + f.id); el.onchange = () => { S[f.key] = Math.max(f.min, +el.value || 0); saveSessions(); }; });
  if (d) wireSessDoc(S, d);
  document.title = (d ? d.title + ' · ' : '') + S.name + ' — Vanadium';
}
function sessEntry(S, x, depth = 0) {   // one line in the overview / a folder's page
  const k = sessKind(x.type), n = isFolder(x) ? sessCount(S, x.id) : 0;
  return `<a class="beitem${isFolder(x) ? ' sfold-o' : ''}" href="#session--${S.id}--${x.id}"${sessDepth(depth)}><b>${k.icon} ${esc(x.title || k.label)}</b><span>${isFolder(x) ? `Folder · ${n} item${n === 1 ? '' : 's'}` : k.label + (k.summary ? k.summary(x) : '')}${x.type === 'page' ? ' · ' + (x.md || '').split(/\s+/).filter(Boolean).length + ' words' : ''}</span></a>`;
}
function sessDocHtml(S, d) {
  const inside = new Set(isFolder(d) ? sessTree(S, d.id).map(([x]) => x.id) : []);
  const dests = sessTree(S).filter(([x]) => isFolder(x) && x.id !== d.id && !inside.has(x.id)), par = sessParent(S, d);
  const move = dests.length || par ? `<select id="d-move" title="Move to a folder" aria-label="Move to a folder"><option value="">${par ? 'Move to: top level' : 'Top level'}</option>${dests.map(([x, depth]) => `<option value="${x.id}" ${par === x.id ? 'selected' : ''}>${'  '.repeat(depth)}📁 ${esc(x.title)}</option>`).join('')}</select>` : '';
  const top = `<div class="sdoc-top"><input id="d-title" class="encname" value="${esc(d.title)}" aria-label="Title"><div class="negtb">${move}${d.type === 'page' ? `<button class="btn ghost sm" id="d-edit">${sessEdit ? 'Done' : 'Edit'}</button>` : ''}<button class="btn ghost sm" id="d-pdf">PDF</button><button class="btn ghost sm danger" id="d-del">Remove</button></div></div><div class="kind">${sessKind(d.type).label}</div>`;
  if (isFolder(d)) return top + `<div class="soverview">${sessChildren(S, d.id).map(x => sessEntry(S, x)).join('') || '<div class="empty">This folder is empty.</div>'}</div>
    <p class="note">Anything you add while you’re in this folder goes into it (the Add buttons in the sidebar). To move something in or out, use the menu at the top of its page. The PDF button prints everything in the folder.</p>`;
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
  $('#d-title').onchange = e => {   // re-render later: a change on blur can fire while another click is already replacing the page
    d.title = e.target.value || k.label; if (k.onRename) k.onRename(d); saveSessions();
    const el = e.target; setTimeout(() => { if ($('#d-title') === el) sessionPage(S.id, d.id); }, 0);
  };
  $('#d-del').onclick = async () => {
    const up = sessParent(S, d);
    if (isFolder(d)) {   // never deletes what's inside: it moves up one level
      const kids = sessChildren(S, d.id);
      if (!await confirmSheet(`Remove the folder “${d.title}”?${kids.length ? ` The ${kids.length} item${kids.length === 1 ? '' : 's'} in it move up one level.` : ''}`, 'Remove folder')) return;
      kids.forEach(x => { if (up) x.parent = up; else delete x.parent; });
    } else if (!await confirmSheet(`Remove “${d.title}” from this session?`, 'Remove')) return;
    S.docs = S.docs.filter(x => x !== d); saveSessions(); go('session--' + S.id + (up ? '--' + up : ''));
  };
  if ($('#d-move')) $('#d-move').onchange = e => { if (e.target.value) d.parent = e.target.value; else delete d.parent; saveSessions(); sessionPage(S.id, d.id); };
  $('#d-pdf').onclick = () => runPdfJob($('#d-pdf'), 'PDF', async () => { const b = await docPdf(S, d); if (b) await deliverFile(pdfFileName(d.title), new Blob([b], { type: 'application/pdf' })); else toast(isFolder(d) ? 'Nothing in this folder to print.' : 'Nothing to print.'); });
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
function sessAdd(S, type, parent) {
  const add = doc => {
    doc.id = sessNewId(S); if (parent) doc.parent = parent; S.docs.push(doc); saveSessions(); if (doc.type === 'page') sessEdit = true; go('session--' + S.id + '--' + doc.id);
    if (doc.type === 'folder') setTimeout(() => { const t = $('#d-title'); if (t) { t.focus(); t.select(); } }, 60);
  };
  if (type === 'folder') return add({ type: 'folder', title: 'New folder' });
  if (type === 'page') return add({ type: 'page', title: 'New page', md: '# New page\n\n' });
  const k = sessKind(type); if (k.add) k.add(S, add);
}
async function docPdf(S, d) {
  if (isFolder(d)) {   // everything in the folder, in order
    const parts = []; for (const [x] of sessTree(S, d.id)) if (!isFolder(x)) { const b = await docPdf(S, x); if (b) parts.push(b); }
    return parts.length ? mergePdfs(parts, d.title) : null;
  }
  if (d.type === 'page') return buildMarkdownPdf(d.title, d.md, S.name);
  const k = sessKind(d.type); return k.pdf ? k.pdf(S, d) : null;
}
async function exportSession(S, btn) {
  await runPdfJob(btn, '⬇ Export this session', async () => {
    const w = await makeWriter(S.name); w.newPage();
    w.header(S.name, `${S.date || ''}${SYS.session?.partyLine ? ' · ' + SYS.session.partyLine(S) : ''}`, 'Session');
    w.h('Contents', 2);
    const tree = sessTree(S), parts = [], skipped = [];   // printed in folder order
    for (const [d] of tree) if (!isFolder(d)) { const b = await docPdf(S, d); if (b) parts.push([d, b]); else skipped.push(d.title); }
    const { PDFDocument } = await loadPdfLib();
    const start = new Map(); let pg = 2;
    for (const [d, b] of parts) { start.set(d, pg); pg += (await PDFDocument.load(b)).getPageCount(); }
    for (const [d, depth] of tree) {
      const x = w.MG + depth * 14;
      if (isFolder(d)) { if (sessTree(S, d.id).some(([c]) => start.has(c))) { w.ensure(18); w.T(d.title, x, w.y - 11, 10.5, w.FB); w.y -= 16; } continue; }
      if (!start.has(d)) continue; const p0 = 'p. ' + start.get(d);
      w.ensure(16); w.T(`${sessKind(d.type).label}`, x, w.y - 11, 8.5, w.F, w.grey); w.T(d.title, x + 110, w.y - 11, 10.5, w.FB); w.T(p0, w.MG + w.CW - w.tw(p0, 10, w.F), w.y - 11, 10, w.F); w.y -= 18;
    }
    if (skipped.length) w.para(`<i>Skipped (empty or unavailable): ${esc(skipped.join(', '))}</i>`, { size: 8 });
    const cover = await w.bytes();
    const out = await mergePdfs([cover, ...parts.map(x => x[1])], S.name);
    await deliverFile(pdfFileName(S.name, 'session'), new Blob([out], { type: 'application/pdf' }));
  });
}
