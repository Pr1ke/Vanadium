
// ================= MONTAGE TEST RUNNER =================
const ORDW = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };
const MT_TIERS = { // per difficulty: tier -> [result, label]
  easy: { 1: ['s', 'Success with a consequence'], 2: ['s', 'Success'], 3: ['s', 'Success with a reward'] },
  medium: { 1: ['f', 'Failure'], 2: ['s', 'Success with a consequence'], 3: ['s', 'Success'] },
  hard: { 1: ['f', 'Failure with a consequence'], 2: ['f', 'Failure'], 3: ['s', 'Success'] }
};
function mtLimits(diff, heroes) {
  const base = { easy: [5, 5], moderate: [6, 4], hard: [7, 3] }[diff] || [6, 4];
  const d = (+heroes || 5) - 5;
  return [Math.max(2, base[0] + d), Math.max(2, base[1] + d)];
}
const mtVictories = (outcome, diff) => outcome === 'success' ? (diff === 'hard' ? 2 : 1) : outcome === 'partial' ? (diff === 'easy' ? 0 : 1) : 0;

function parseChallenge(html, round) {
  let name = '', rest = '';
  const m = String(html).match(/^\s*<b>(.*?)<\/b>\s*(.*)$/s);
  if (m) { name = strip(m[1]).replace(/[:\s]+$/, ''); rest = strip(m[2]); }
  else { const t = strip(html); const k = t.match(/^([^:.!?]{2,60})[:!?]\s*(.*)$/); if (!k) return null; name = k[1]; rest = k[2]; }
  const chars = ((rest.match(/Suggested Characteristics?:\s*([^.]*)/i) || [])[1] || '').split(/,\s*|\s+or\s+/).map(s => s.trim()).filter(Boolean);
  const skills = ((rest.match(/Suggested Skills?:\s*([^.]*)/i) || [])[1] || '').split(/,\s*|\s+or\s+/).map(s => s.trim()).filter(Boolean);
  const desc = rest.replace(/\s*Suggested Characteristics?:.*$/i, '').trim();
  const mm = rest.match(/overcome (twice|two times|three times|thrice|(\d+) times)/i);
  const max = mm ? (/twice|two/i.test(mm[1]) ? 2 : /three|thrice/i.test(mm[1]) ? 3 : +mm[2]) : 1;
  return { name, desc, chars, skills, round: round || 1, max };
}
function extractMontages(pack) {
  const out = [];
  for (const c of pack.chapters || []) {
    const B = c.blocks;
    for (let i = 0; i < B.length; i++) {
      const h = B[i];
      if (h.t !== 'h' || !/^(Montage( Test)? )?Challenges$/i.test(h.text.trim())) continue;
      // find the montage's own heading
      let a = -1;
      for (let k = i - 1; k >= 0; k--) { const b = B[k]; if (b.t === 'h' && b.lvl < h.lvl && !/Setting the Scene|Difficulty|Montage/i.test(b.text)) { a = k; break; } }
      const top = a >= 0 ? B[a] : null;
      const name = top ? top.text : c.title;
      if (out.some(x => x.src.ch === c.id && x.name === name)) continue;
      let end = B.length;
      if (top) for (let k = a + 1; k < B.length; k++) { const b = B[k]; if (b.t === 'h' && b.lvl <= top.lvl) { end = k; break; } }
      const M = { id: (pack.heroes ? 'heroes' : pack.id) + '-' + slug(name), name, intro: '', scene: [], challenges: [], events: [], outcomes: {}, limits: null, notes: '', pack: pack.id, src: { pack: pack.id, ch: c.id, hid: top ? top.id : '', pg: (top || h).pg } };
      let mode = 'intro', addRound = 1, ev = null, okey = null;
      for (let k = (a >= 0 ? a + 1 : 0); k < end; k++) {
        const b = B[k];
        if (b.t === 'h') {
          const t = b.text.trim();
          if (/Setting the Scene/i.test(t)) mode = 'scene';
          else if (/Challenges$/i.test(t)) { mode = 'chal'; addRound = 1; }
          else if (/Outcomes$/i.test(t)) mode = 'out';
          else if (/^Total Success$/i.test(t)) { mode = 'okey'; okey = 'success'; }
          else if (/^Partial Success$/i.test(t)) { mode = 'okey'; okey = 'partial'; }
          else if (/^Total Failure$/i.test(t)) { mode = 'okey'; okey = 'failure'; }
          else if (mode === 'out' || mode === 'okey') { mode = 'after'; }
          else if (mode !== 'intro') mode = 'other';
          continue;
        }
        if (b.t === 'table') { if (b.head.some(x => /Success Limit/i.test(x))) M.limits = { head: b.head, rows: b.rows.map(r => r.map(strip)) }; continue; }
        const html = b.html || ''; const txt = strip(html);
        if (!txt) continue;
        if (mode === 'intro') { if (!/Test Difficulty$/i.test(txt) && txt.length > 30) M.intro += (M.intro ? '\n\n' : '') + txt; if (b.t === 'li' && /^[“"]/.test(txt)) M.scene.push(txt); continue; }
        if (mode === 'scene') { if (b.t === 'li' || /^[“"]/.test(txt)) M.scene.push(txt); else M.intro += (M.intro ? '\n\n' : '') + txt; continue; }
        if (mode === 'chal') {
          if (/^[“"]/.test(txt)) { if (ev) ev.read.push(txt); continue; }
          if (/^Add the following challenges?/i.test(txt)) { addRound = ev ? ev.round : 2; continue; }
          if (/following challenges are suitable/i.test(txt)) continue;
          const rm = txt.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th)\s+(montage( test)?\s+)?round\b|\bround\s+(\d)\b/i);
          if (rm && !/Suggested/i.test(txt)) { ev = { round: rm[1] ? ORDW[rm[1].toLowerCase()] : +rm[4], text: txt, read: [] }; M.events.push(ev); continue; }
          const ch = parseChallenge(html, addRound);
          if (ch && (ch.desc || ch.chars.length)) { M.challenges.push(ch); continue; }
          M.notes += (M.notes ? '\n' : '') + txt; continue;
        }
        if (mode === 'out') {
          const om = txt.match(/^(Total Success|Partial Success|Total Failure)\s*:\s*(.*)$/i);
          if (om) { okey = /Total Success/i.test(om[1]) ? 'success' : /Partial/i.test(om[1]) ? 'partial' : 'failure'; M.outcomes[okey] = om[2]; }
          else if (okey) M.outcomes[okey] += ' ' + txt;
          continue;
        }
        if (mode === 'okey' && okey) { M.outcomes[okey] = (M.outcomes[okey] ? M.outcomes[okey] + ' ' : '') + txt; continue; }
        if (mode === 'other') M.notes += (M.notes ? '\n' : '') + txt;
      }
      if (M.challenges.length >= 2) out.push(M);
    }
  }
  return out;
}
function parseMontageText(txt) {
  const L = txt.replace(/\r/g, '').split('\n').map(s => s.replace(/^[•¥*\-–]\s*/, '').trim()).filter(Boolean);
  const M = { id: 'mu-' + Date.now().toString(36), name: '', intro: '', scene: [], challenges: [], events: [], outcomes: {}, limits: null, notes: '', user: true };
  let mode = 'intro', addRound = 1, ev = null, last = null, okey = null;
  for (const ln of L) {
    if (!M.name) { M.name = ln.replace(/^./, c => c.toUpperCase()).replace(/\b\w+/g, w => w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w); continue; }
    if (/^Setting the Scene$/i.test(ln)) { mode = 'scene'; continue; }
    if (/^(Montage( Test)? )?Challenges$/i.test(ln)) { mode = 'chal'; continue; }
    if (/^(Montage( Test)? )?Outcomes$/i.test(ln)) { mode = 'out'; continue; }
    if (mode === 'intro') { M.intro += (M.intro ? ' ' : '') + ln; continue; }
    if (mode === 'scene') { if (/^[“"]/.test(ln) || !M.scene.length) M.scene.push(ln); else M.scene[M.scene.length - 1] += ' ' + ln; continue; }
    if (mode === 'chal') {
      if (/^[“"]/.test(ln)) { if (ev) ev.read.push(ln); continue; }
      if (/^Add the following challenges?/i.test(ln)) { addRound = ev ? ev.round : 2; continue; }
      const rm = ln.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+(montage( test)?\s+)?round\b|\bround\s+(\d)\b/i);
      if (rm && !/Suggested/i.test(ln) && !/^[^:]{2,50}:/.test(ln)) { ev = { round: rm[1] ? ORDW[rm[1].toLowerCase()] : +rm[4], text: ln, read: [] }; M.events.push(ev); continue; }
      const c = /^[^:!?]{2,60}[:!?]\s/.test(ln) ? parseChallenge(ln, addRound) : null;
      if (c) { M.challenges.push(c); last = c; continue; }
      if (last) { const merged = parseChallenge('<b>' + esc(last.name) + ':</b> ' + esc((last.desc + ' ' + (last.chars.length ? 'Suggested Characteristics: ' + last.chars.join(', ') + '. ' : '') + (last.skills.length ? 'Suggested Skills: ' + last.skills.join(', ') + '. ' : '') + ln).trim()), last.round); Object.assign(last, merged); }
      continue;
    }
    if (mode === 'out') {
      const om = ln.match(/^(Total Success|Partial Success|Total Failure)\s*:?\s*(.*)$/i);
      if (om) { okey = /Total Success/i.test(om[1]) ? 'success' : /Partial/i.test(om[1]) ? 'partial' : 'failure'; M.outcomes[okey] = om[2]; }
      else if (okey) M.outcomes[okey] += ' ' + ln;
    }
  }
  if (!M.name) M.name = 'Untitled montage';
  return M;
}

let MT_USER = store.get('mtg', []), MT_SESS = store.get('mtgsess', {});
const saveMt = () => store.set('mtg', MT_USER), saveMtS = () => store.set('mtgsess', MT_SESS);
let MT_BOOK = [];
const MTBYHEAD = {};
function refreshMontages() {
  MT_BOOK = []; for (const p of PACKS) MT_BOOK.push(...extractMontages(p));
  const seen = new Set(); MT_BOOK.forEach(m => { while (seen.has(m.id)) m.id += '-2'; seen.add(m.id); });
  for (const k in MTBYHEAD) delete MTBYHEAD[k];
  for (const m of MT_BOOK) MTBYHEAD[m.src.pack + ':' + m.src.ch + ':' + (m.src.hid || '_')] = m.id;
}
const allMt = () => [...MT_USER, ...MT_BOOK];
const mtById = id => allMt().find(m => m.id === id);
function newMtSess(M) {
  const heroes = (ENC && ENC.heroes) || 4; const [s, f] = mtLimits('moderate', heroes);
  return { started: false, heroes: Array.from({ length: heroes }, (_, i) => ({ name: 'Hero ' + (i + 1), skills: [] })), diff: 'moderate', sLimit: s, fLimit: f, rounds: 2, round: 1, succ: 0, fail: 0, acted: {}, over: {}, log: [], ended: null, share: true, malice: 0, tokens: 0, edges: {} };
}
const mtSessOf = M => MT_SESS[M.id] || (MT_SESS[M.id] = newMtSess(M));
const mtSnap = s => JSON.stringify({ ...s, log: undefined });
function mtCheckEnd(s, roundOver) {
  if (s.succ >= s.sLimit) s.ended = 'success';
  else if (s.fail >= s.fLimit || roundOver) s.ended = s.succ >= s.fail + 2 ? 'partial' : 'failure';
}
const mtVisible = (M, s) => M.challenges.map((c, i) => [c, i]).filter(([c]) => (c.round || 1) <= s.round);

// ---- hub ----
function montageHub() {
  refreshMontages();
  const byPack = {}; MT_BOOK.forEach(m => (byPack[m.pack] = byPack[m.pack] || []).push(m));
  const inProg = allMt().filter(m => MT_SESS[m.id] && MT_SESS[m.id].log.length && !MT_SESS[m.id].ended);
  const card = m => `<a class="negc mtc" href="#montage--${m.id}"><b>${esc(m.name)}</b><span>${m.challenges.length} challenges${m.events.length ? ' · ' + m.events.length + ' twist' + (m.events.length > 1 ? 's' : '') : ''}</span><em>${esc((m.intro || m.scene[0] || '').slice(0, 110))}${(m.intro || m.scene[0] || '').length > 110 ? '…' : ''}</em></a>`;
  $('#main').innerHTML = `<div class="neghub"><h1>Montage Tests</h1>
    <p class="note">Run a montage test round by round. Vanadium tracks successes and failures against the limits, which hero has acted, which skills they’ve used and which challenges are overcome, then tells you the outcome and the Victories earned. Rules: <a href="#book--heroes--tests--montage-tests">Montage Tests</a>.</p>
    <div class="negacts"><button class="btn" id="mtnew">+ New montage</button><button class="btn ghost" id="mtpaste">Paste a montage</button><a class="btn ghost" href="#import">Import a PDF</a></div>
    ${inProg.length ? `<h2 class="negh">In progress</h2><div class="negg">${inProg.map(card).join('')}</div>` : ''}
    ${MT_USER.length ? `<h2 class="negh">Your montages</h2><div class="negg">${MT_USER.map(card).join('')}</div>` : ''}
    ${Object.entries(byPack).map(([pid, list]) => `<h2 class="negh">From ${esc(PK[pid]?.title || pid)}</h2><div class="negg">${list.map(card).join('')}</div>`).join('')}
    ${!MT_BOOK.length && !MT_USER.length ? '<div class="empty">No montage tests yet. Import a book that has some, or make your own.</div>' : ''}</div>`;
  $('#mtnew').onclick = () => mtEditor(null);
  $('#mtpaste').onclick = mtPasteDialog;
  document.title = 'Montage Tests — Vanadium';
}
function mtEditor(def) {
  const d = def ? JSON.parse(JSON.stringify(def)) : { id: 'mu-' + Date.now().toString(36), name: '', intro: '', scene: [], challenges: [], events: [], outcomes: {}, user: true };
  const chText = d.challenges.map(c => `${c.round > 1 ? '[round ' + c.round + '] ' : ''}${c.name}: ${c.desc}${c.chars.length ? ' Suggested Characteristics: ' + c.chars.join(', ') + '.' : ''}${c.skills.length ? ' Suggested Skills: ' + c.skills.join(', ') + '.' : ''}${c.max > 1 ? ' This challenge can be overcome ' + (c.max === 2 ? 'twice' : c.max + ' times') + '.' : ''}`).join('\n');
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<div class="dlg-b negedit"><h2>${def ? 'Edit' : 'New'} montage test</h2>
    <label class="negnotes">Name<input id="me-n" value="${esc(d.name)}" placeholder="e.g. Escape the Burning Library"></label>
    <label class="negnotes">What the heroes are trying to do<textarea id="me-i" rows="2">${esc(d.intro)}</textarea></label>
    <label class="negnotes">Setting the scene (one read-aloud line per row)<textarea id="me-s" rows="3">${esc(d.scene.join('\n'))}</textarea></label>
    <label class="negnotes">Challenges (one per row: <i>Name: description. Suggested Characteristics: Might, Agility. Suggested Skills: Climb, Lift.</i> Start a row with [round 2] for a challenge that appears later)<textarea id="me-c" rows="7">${esc(chText)}</textarea></label>
    <div class="negouts"><label>Total success<input id="me-o1" value="${esc(d.outcomes.success || '')}"></label><label>Partial success<input id="me-o2" value="${esc(d.outcomes.partial || '')}"></label><label>Total failure<input id="me-o3" value="${esc(d.outcomes.failure || '')}"></label></div>
    <div class="dlgfoot">${def && def.user ? '<button class="btn danger" id="me-del">Delete</button>' : ''}<span style="flex:1"></span><button class="btn ghost" id="me-x">Cancel</button><button class="btn" id="me-ok">Save & run</button></div></div>`;
  document.body.appendChild(el);
  $('#me-x', el).onclick = () => el.remove();
  if ($('#me-del', el)) $('#me-del', el).onclick = async () => { if (await confirmSheet(`Delete “${d.name}”?`, 'Delete')) { MT_USER = MT_USER.filter(x => x.id !== d.id); delete MT_SESS[d.id]; saveMt(); saveMtS(); el.remove(); go('montage'); } };
  $('#me-ok', el).onclick = () => {
    d.name = $('#me-n', el).value.trim() || 'Untitled montage'; d.intro = $('#me-i', el).value.trim();
    d.scene = $('#me-s', el).value.split('\n').map(s => s.trim()).filter(Boolean);
    d.challenges = $('#me-c', el).value.split('\n').map(s => s.trim()).filter(Boolean).map(ln => { const r = ln.match(/^\[round (\d)\]\s*/i); const c = parseChallenge(ln.replace(/^\[round \d\]\s*/i, ''), r ? +r[1] : 1); return c; }).filter(Boolean);
    if (d.challenges.length < 1) { toast('Add at least one challenge'); return; }
    d.outcomes = { success: $('#me-o1', el).value.trim(), partial: $('#me-o2', el).value.trim(), failure: $('#me-o3', el).value.trim() };
    d.user = true; delete d.src; MT_USER = MT_USER.filter(x => x.id !== d.id); MT_USER.unshift(d); saveMt();
    if (MT_SESS[d.id] && !MT_SESS[d.id].started) delete MT_SESS[d.id]; saveMtS();
    el.remove(); buildIndex(); go('montage--' + d.id);
  };
}
function mtPasteDialog() {
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<div class="dlg-b"><h2>Paste a montage test</h2><p>Paste a montage from a PDF, document or website: the name, then <i>Setting the Scene</i>, <i>Montage Challenges</i> and <i>Montage Outcomes</i> sections.</p>
    <textarea id="mp-t" rows="12" style="width:100%;background:var(--bg);color:var(--ink);border:1px solid var(--line2);border-radius:5px;padding:10px;font-size:14px" placeholder="ROOFTOP CHASE&#10;The heroes chase a thief across the rooftops.&#10;Setting the Scene&#10;“Tiles slide underfoot…”&#10;Montage Challenges&#10;Leap the Gap: … Suggested Characteristics: Might, Agility. Suggested Skills: Jump, Gymnastics.&#10;Montage Outcomes&#10;Total Success: …"></textarea>
    <div id="mp-prev" class="note" style="margin-top:8px"></div>
    <div class="dlgfoot"><span style="flex:1"></span><button class="btn ghost" id="mp-x">Cancel</button><button class="btn" id="mp-ok">Review & save</button></div></div>`;
  document.body.appendChild(el);
  const ta = $('#mp-t', el);
  ta.oninput = () => { const m = parseMontageText(ta.value); $('#mp-prev', el).textContent = ta.value.trim() ? `Found: ${m.name} · ${m.scene.length} scene lines · ${m.challenges.length} challenges · ${Object.keys(m.outcomes).length} outcomes` : ''; };
  $('#mp-x', el).onclick = () => el.remove();
  $('#mp-ok', el).onclick = () => { const m = parseMontageText(ta.value); el.remove(); mtEditor(m); };
  setTimeout(() => ta.focus(), 30);
}

// ---- runner ----
let mtUI = { hero: null, action: 'test', ch: null, char: '', skill: '', diff: 'medium', rolled: null, bonus: 0, edge: 0, auto: 1, cons: 1 };
function montagePage(id) {
  refreshMontages();
  const M = mtById(id);
  if (!M) { if (!PACKS.length || BUILTIN.some(b => id.startsWith(b.id))) { $('#main').innerHTML = '<div class="empty">Loading…</div>'; return; } go('montage'); return; }
  const s = mtSessOf(M);
  const pips = (n, lim, cls) => `<div class="mtp ${cls}">${Array.from({ length: lim }, (_, k) => `<span class="${k < n ? 'on' : ''}"></span>`).join('')}<b>${n}<small>/${lim}</small></b></div>`;
  const vis = mtVisible(M, s);
  const evNow = M.events.filter(e => e.round === s.round);
  const outTxt = { success: 'Total success', partial: 'Partial success', failure: 'Total failure' };
  const endCard = s.ended ? `<div class="negend ${s.ended === 'failure' ? 'nodeal' : ''}"><b>${outTxt[s.ended]}</b>: ${s.succ} successes, ${s.fail} failures. ${esc(M.outcomes[s.ended] || '')}<div class="vict">Victories: ${mtVictories(s.ended, s.diff === 'moderate' ? 'moderate' : s.diff)} each (${s.diff} montage). ${s.malice ? `Consequences to apply: ${s.malice}. ` : ''}${s.tokens ? `Rewards earned: ${s.tokens}.` : ''}</div></div>` : '';
  const heroesActed = s.acted[s.round] || {};
  $('#main').innerHTML = `<div class="negrun"><div class="negmain">
    <div class="negtop"><div><div class="kind">${esc(M.user ? 'Your montage' : (PK[M.pack]?.title || ''))}</div><h1>${esc(M.name)}</h1>
      <div class="negmeta">${M.challenges.length} challenges${M.src ? ` · <a data-gobook="${esc(M.src.pack)}--${esc(M.src.ch)}${M.src.hid ? '--' + esc(M.src.hid) : ''}">open in book</a>` : ''}</div></div>
      <div class="negtb"><button class="btn ghost sm" id="mt-pdf">PDF</button><button class="btn ghost sm" id="mt-table">Player view</button>${M.user ? '<button class="btn ghost sm" id="mt-edit">Edit</button>' : '<button class="btn ghost sm" id="mt-copy">Copy & edit</button>'}<button class="btn ghost sm" id="mt-reset">Restart</button><a class="btn ghost sm" href="#montage">All</a></div></div>
    ${endCard}
    ${s.started ? `<div class="negstats"><div class="nstat"><span>Successes</span>${pips(s.succ, s.sLimit, 'succ')}</div><div class="nstat"><span>Failures</span>${pips(s.fail, s.fLimit, 'fail')}</div></div>
      <div class="mtround"><b>Round ${s.round} of ${s.rounds}</b><span class="mtheroes">${s.heroes.map((h, i) => `<span class="hchip ${heroesActed[i] ? 'done' : ''} ${mtUI.hero === i ? 'sel' : ''}" data-hero="${i}">${esc(h.name)}${s.edges[i] ? ' <i>edge</i>' : ''}</span>`).join('')}</span>${s.ended ? '' : `<button class="btn ghost sm" id="mt-endround">${s.round >= s.rounds ? 'End montage' : 'End round ' + s.round}</button>`}</div>
      ${evNow.length && !s.ended ? evNow.map(e => `<div class="mtev"><b>Round ${e.round}:</b> ${esc(e.text)}${e.read.map(r => `<div class="ra">${esc(r)}</div>`).join('')}${M.challenges.some(c => c.round === e.round) ? `<div class="note">New challenges: ${M.challenges.filter(c => c.round === e.round).map(c => esc(c.name)).join(', ')}</div>` : ''}</div>`).join('') : ''}
      ${s.ended ? `<div class="negpanel"><div class="actrow"><button class="btn ghost" id="mt-undo" ${s.log.length ? '' : 'disabled'}>Undo last step</button><button class="btn" id="mt-again">Run it again</button></div></div>` : mtActionHtml(M, s)}`
      : mtSetupHtml(M, s)}
    <div class="neglog"><h3>Log</h3>${s.log.length ? s.log.slice().reverse().map(l => `<div class="lg ${l.kind || ''}"><span class="lgv">${l.r ? 'R' + l.r + ' · ' : ''}${l.s}✓ ${l.f}✗</span>${esc(l.text)}</div>`).join('') : '<div class="note">Nothing yet.</div>'}</div>
  </div>
  <aside class="negside">
    ${M.intro ? `<h3>Goal</h3><p class="nnote">${esc(M.intro)}</p>` : ''}
    ${M.scene.length ? `<h3>Setting the scene</h3>${M.scene.map(x => `<div class="ra">${esc(x)}</div>`).join('')}` : ''}
    <h3>Challenges</h3>${M.challenges.map((c, i) => { const n = s.over[i] || 0, hidden = (c.round || 1) > s.round; return `<div class="mtch ${n >= c.max ? 'done' : ''} ${hidden ? 'later' : ''}"><div class="mtch-h"><b>${esc(c.name)}</b>${c.max > 1 ? `<span class="tagk">×${c.max}</span>` : ''}${hidden ? `<span class="tagk">round ${c.round}</span>` : ''}${n ? `<span class="tagu">${n >= c.max ? 'overcome' : n + '/' + c.max}</span>` : ''}</div>${c.desc ? `<p>${esc(c.desc)}</p>` : ''}${c.chars.length || c.skills.length ? `<div class="mtsug">${c.chars.map(x => `<span class="ck">${esc(x)}</span>`).join('')}${c.skills.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</div>`; }).join('')}
    ${Object.keys(M.outcomes).length ? `<h3>Outcomes</h3>${['success', 'partial', 'failure'].filter(k => M.outcomes[k]).map(k => `<div class="nout ${s.ended === k ? 'cur' : ''}"><b>${outTxt[k]}:</b> ${esc(M.outcomes[k])}</div>`).join('')}` : ''}
    ${M.notes ? `<h3>Notes</h3><p class="nnote">${esc(M.notes)}</p>` : ''}
  </aside></div>`;
  wireMt(M, s);
  document.title = M.name + ' — Montage';
}
function mtSetupHtml(M, s) {
  const lim = M.limits ? `<div class="note">This montage has its own limits: ${M.limits.rows.map(r => `${esc(r[0])} heroes ${esc(r[1])}/${esc(r[2])}`).join(' · ')}</div>` : '';
  return `<div class="negpanel"><h3>Set up the montage</h3>
    <div class="party dlgp"><label>Heroes<input type="number" id="mt-h" min="1" max="10" value="${s.heroes.length}" inputmode="numeric"></label>
    <label>Difficulty<select id="mt-d">${['easy', 'moderate', 'hard'].map(d => `<option ${s.diff === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label>Success limit<input type="number" id="mt-sl" min="1" value="${s.sLimit}"></label><label>Failure limit<input type="number" id="mt-fl" min="1" value="${s.fLimit}"></label><label>Rounds<input type="number" id="mt-r" min="1" max="6" value="${s.rounds}"></label></div>
    ${lim}
    <div class="mthnames">${s.heroes.map((h, i) => `<input data-hn="${i}" value="${esc(h.name)}" aria-label="Hero ${i + 1} name">`).join('')}</div>
    <label class="row-c"><input type="checkbox" id="mt-share" ${s.share ? 'checked' : ''}> Show successes and failures in the player view</label>
    <div class="actrow"><button class="btn" id="mt-begin">Begin montage</button></div>
    <p class="note" style="margin-top:8px">Each hero gets one action per round: a test, an assist, or using an ability or item. A hero can’t use the same skill twice. The montage ends at the success limit, the failure limit, or after round ${s.rounds}. Partial success needs at least two more successes than failures.</p></div>`;
}
function mtActionHtml(M, s) {
  const u = mtUI; const acted = s.acted[s.round] || {};
  if (u.hero == null || acted[u.hero]) { const nx = s.heroes.findIndex((_, i) => !acted[i]); u.hero = nx >= 0 ? nx : null; }
  if (u.hero == null) return `<div class="negpanel"><h3>Everyone has acted this round</h3><div class="actrow"><button class="btn" id="mt-endround2">${s.round >= s.rounds ? 'End the montage' : 'Start round ' + (s.round + 1)}</button><button class="btn ghost" id="mt-undo" ${s.log.length ? '' : 'disabled'}>Undo</button></div></div>`;
  const h = s.heroes[u.hero];
  const vis = mtVisible(M, s);
  const ch = u.ch != null ? M.challenges[u.ch] : null;
  const tiers = MT_TIERS[u.diff];
  const skillUsed = u.skill && h.skills.map(x => x.toLowerCase()).includes(u.skill.trim().toLowerCase());
  let body = `<h3>${esc(h.name)}’s turn${s.edges[u.hero] ? ' <span class="tagu">has an edge from an assist</span>' : ''}</h3>
    <div class="seg4">${[['test', 'Make a test'], ['assist', 'Assist another hero'], ['ability', 'Use an ability or item'], ['pass', 'Pass']].map(([k, l]) => `<button class="${u.action === k ? 'on' : ''}" data-act="${k}">${l}</button>`).join('')}</div>`;
  if (u.action === 'test') {
    body += `<div class="mtpick">${vis.map(([c, i]) => { const n = s.over[i] || 0; const done = n >= c.max; return `<button class="argt ${u.ch === i ? 'sel' : ''} ${done ? 'usedm' : 'mot'}" data-ch="${i}" ${done ? 'title="Already overcome"' : ''}><b>${esc(c.name)}</b><span>${done ? 'overcome' : (c.chars.join(', ') || 'any characteristic')}</span></button>`; }).join('')}<button class="argt none ${u.ch === -1 ? 'sel' : ''}" data-ch="-1"><b>Something else</b><span>A clever idea of their own</span></button></div>`;
    if (u.ch != null) {
      const chars = ch && ch.chars.length ? ch.chars : ['Might', 'Agility', 'Reason', 'Intuition', 'Presence'];
      body += `<div class="mtrow"><label>Characteristic<select id="mt-char">${['Might', 'Agility', 'Reason', 'Intuition', 'Presence'].map(c => `<option ${u.char === c ? 'selected' : ''}>${c}${chars.includes(c) && ch ? ' ★' : ''}</option>`).join('')}</select></label>
        <label>Skill<input id="mt-skill" list="mt-skills" value="${esc(u.skill)}" placeholder="optional"></label><datalist id="mt-skills">${(ch ? ch.skills : []).concat(D.skills.map(x => x.name)).filter((v, i, a) => a.indexOf(v) === i).map(x => `<option>${esc(x)}</option>`).join('')}</datalist>
        <label>Difficulty<select id="mt-diff">${['easy', 'medium', 'hard'].map(d => `<option ${u.diff === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label></div>
        <div class="warn" id="mt-skwarn" style="${skillUsed ? '' : 'display:none'}">${esc(h.name)} has already used this skill in this montage. A hero can’t use the same skill twice (unless you lift the restriction).</div>
        ${ch && ch.skills.length ? `<div class="mtsug">Suggested: ${ch.skills.map(x => `<span class="${h.skills.includes(x) ? 'usedsk' : ''}" data-sk="${esc(x)}">${esc(x)}</span>`).join('')}</div>` : ''}
        <div class="rollrow"><span>Power roll:</span><label>Bonus <input type="number" id="mt-bonus" value="${u.bonus}" inputmode="numeric"></label><select id="mt-edge"><option value="0">No edge/bane</option><option value="1" ${u.edge == 1 || (s.edges[u.hero] && u.edge === undefined) ? 'selected' : ''}>Edge (+2)</option><option value="2" ${u.edge == 2 ? 'selected' : ''}>Double edge</option><option value="-1" ${u.edge == -1 ? 'selected' : ''}>Bane (−2)</option><option value="-2" ${u.edge == -2 ? 'selected' : ''}>Double bane</option></select><button class="btn sm" id="mt-roll">Roll 2d10</button>${u.rolled && u.rolled.total != null ? `<b class="rollres">${u.rolled.total}${u.rolled.nat >= 19 ? ' · natural ' + u.rolled.nat : ''} → tier ${u.rolled.tier}</b>` : ''}</div>
        <div class="tierpick">${[1, 2, 3].map(t => `<button class="tierb n${t} ${u.rolled && u.rolled.tier === t ? 'on' : ''}" data-tier="${t}"><span class="tb">${['', '≤11', '12–16', '17+'][t]}</span>${tiers[t][1]}${u.rolled && u.rolled.nat >= 19 && t === 3 ? ' (natural 19–20: with a reward)' : ''}</button>`).join('')}</div>
        <div class="actrow"><button class="btn" id="mt-apply" ${u.rolled && u.rolled.tier ? '' : 'disabled'}>Apply result</button><button class="btn ghost" id="mt-auto">Clever idea: automatic success</button></div>`;
    }
  } else if (u.action === 'assist') {
    body += `<div class="mtrow"><label>Assisting<select id="mt-target">${s.heroes.map((x, i) => i === u.hero || acted[i] ? '' : `<option value="${i}">${esc(x.name)}</option>`).join('')}</select></label><label>Skill used<input id="mt-askill" placeholder="optional"></label></div>
      <p class="note">The assisting hero makes a test to help. On a success the other hero gains an edge on their test (a natural 19–20 or great result can give a double edge, at your discretion).</p>
      <div class="actrow"><button class="btn" data-assist="1">Assist succeeds: edge</button><button class="btn ghost" data-assist="0">Assist fails</button></div>`;
  } else if (u.action === 'ability') {
    body += `<p class="note">A hero can spend their turn using an item, ability or other option. You decide how many automatic successes it’s worth (the book’s example gives 2).</p>
      <div class="mtrow"><label>Automatic successes<input type="number" id="mt-autoN" min="0" max="5" value="${u.auto}"></label><label style="flex:2">What they did<input id="mt-what" placeholder="e.g. a magic fan fills the sails"></label></div>
      <div class="actrow"><button class="btn" id="mt-useab">Apply</button></div>`;
  } else {
    body += `<div class="actrow"><button class="btn" id="mt-pass">${esc(h.name)} passes this round</button></div>`;
  }
  body += `<div class="actrow" style="margin-top:10px"><button class="btn ghost sm" id="mt-undo" ${s.log.length ? '' : 'disabled'}>Undo</button><span class="note" style="margin:0">Consequences: ${s.malice} · Rewards: ${s.tokens}</span><button class="btn ghost sm" data-adj="malice">+1 consequence</button><button class="btn ghost sm" data-adj="tokens">+1 reward</button></div>`;
  return `<div class="negpanel">${body}</div>`;
}
function wireMt(M, s) {
  const re = () => { saveMtS(); montagePage(M.id); };
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  const log = (text, kind, before) => s.log.push({ text, kind, before, s: s.succ, f: s.fail, r: s.round });
  on('#mt-reset', async () => { if (await confirmSheet('Restart this montage test?', 'Restart')) { MT_SESS[M.id] = newMtSess(M); mtUI = { action: 'test', diff: 'medium', bonus: 0, edge: 0, auto: 1 }; re(); } });
  on('#mt-again', () => { MT_SESS[M.id] = newMtSess(M); mtUI = { action: 'test', diff: 'medium', bonus: 0, edge: 0, auto: 1 }; re(); });
  on('#mt-edit', () => mtEditor(M));
  on('#mt-copy', () => { const c = JSON.parse(JSON.stringify(M)); c.id = 'mu-' + Date.now().toString(36); c.user = true; delete c.src; mtEditor(c); });
  on('#mt-table', () => mtPlayerView(M, s));
  on('#mt-pdf', () => runPdfJob($('#mt-pdf'), 'PDF', async () => { const b = await buildMontagePdf(M); await deliverFile(pdfFileName(M.name, 'montage'), new Blob([b], { type: 'application/pdf' })); }));
  // setup
  const recalc = () => { const n = Math.max(1, +$('#mt-h').value || 4); const [a, b] = mtLimits($('#mt-d').value, n); $('#mt-sl').value = a; $('#mt-fl').value = b; s.diff = $('#mt-d').value; while (s.heroes.length < n) s.heroes.push({ name: 'Hero ' + (s.heroes.length + 1), skills: [] }); s.heroes.length = n; s.sLimit = a; s.fLimit = b; re(); };
  if ($('#mt-h')) { $('#mt-h').onchange = recalc; $('#mt-d').onchange = recalc; }
  $$('[data-hn]').forEach(i => i.onchange = () => { s.heroes[+i.dataset.hn].name = i.value || 'Hero'; saveMtS(); });
  on('#mt-begin', () => { s.sLimit = Math.max(1, +$('#mt-sl').value || s.sLimit); s.fLimit = Math.max(1, +$('#mt-fl').value || s.fLimit); s.rounds = Math.max(1, +$('#mt-r').value || 2); s.share = $('#mt-share').checked; s.started = true; const b = mtSnap(s); log(`Montage begins (${s.diff}, ${s.heroes.length} heroes): success limit ${s.sLimit}, failure limit ${s.fLimit}, ${s.rounds} rounds`, 'start', b); mtUI = { action: 'test', diff: 'medium', bonus: 0, auto: 1 }; re(); });
  // turn
  $$('[data-hero]').forEach(c => c.onclick = () => { if ((s.acted[s.round] || {})[+c.dataset.hero]) return; mtUI.hero = +c.dataset.hero; mtUI.rolled = null; re(); });
  $$('[data-act]').forEach(b => b.onclick = () => { mtUI.action = b.dataset.act; re(); });
  $$('[data-ch]').forEach(b => b.onclick = () => { const i = +b.dataset.ch; const c = M.challenges[i]; if (c && (s.over[i] || 0) >= c.max) { toast('That challenge is already overcome'); return; } mtUI.ch = i; mtUI.rolled = null; mtUI.char = c && c.chars.length ? (c.chars.find(x => ['Might', 'Agility', 'Reason', 'Intuition', 'Presence'].includes(x)) || 'Reason') : 'Reason'; mtUI.skill = ''; mtUI.edge = s.edges[mtUI.hero] ? 1 : 0; re(); });
  const keep = () => { const c = $('#mt-char'), k = $('#mt-skill'), d = $('#mt-diff'), bo = $('#mt-bonus'), e = $('#mt-edge'); if (c) mtUI.char = c.value.replace(' ★', ''); if (k) mtUI.skill = k.value; if (d) mtUI.diff = d.value; if (bo) mtUI.bonus = +bo.value || 0; if (e) mtUI.edge = +e.value; };
  $$('#mt-char,#mt-diff,#mt-edge').forEach(x => x.onchange = () => { keep(); re(); });
  if ($('#mt-skill')) $('#mt-skill').oninput = () => { mtUI.skill = $('#mt-skill').value; const used = s.heroes[mtUI.hero].skills.map(x => x.toLowerCase()).includes(mtUI.skill.trim().toLowerCase()); $('#mt-skwarn').style.display = used && mtUI.skill.trim() ? '' : 'none'; };
  $$('[data-sk]').forEach(x => x.onclick = () => { keep(); mtUI.skill = x.dataset.sk; re(); });
  on('#mt-roll', () => { keep(); const d1 = 1 + Math.floor(Math.random() * 10), d2 = 1 + Math.floor(Math.random() * 10), nat = d1 + d2; const ed = +mtUI.edge; const tot = nat + mtUI.bonus + (ed === 1 ? 2 : ed === -1 ? -2 : 0); let tier = tot <= 11 ? 1 : tot <= 16 ? 2 : 3; if (ed === 2) tier = Math.min(3, tier + 1); if (ed === -2) tier = Math.max(1, tier - 1); if (nat >= 19) tier = 3; mtUI.rolled = { total: tot, nat, tier }; re(); });
  $$('[data-tier]').forEach(b => b.onclick = () => { keep(); const t = +b.dataset.tier; mtUI.rolled = { ...(mtUI.rolled || {}), tier: t, total: mtUI.rolled && mtUI.rolled.tier === t ? mtUI.rolled.total : null }; re(); });
  const finishTurn = () => { (s.acted[s.round] = s.acted[s.round] || {})[mtUI.hero] = true; delete s.edges[mtUI.hero]; mtCheckEnd(s, false); mtUI = { action: 'test', diff: mtUI.diff, bonus: 0, auto: 1 }; };
  const apply = (forced) => {
    keep(); const b = mtSnap(s); const h = s.heroes[mtUI.hero]; const c = mtUI.ch >= 0 ? M.challenges[mtUI.ch] : null;
    let res, label, reward = false, cons = false;
    if (forced) { res = 's'; label = 'Automatic success'; }
    else { const t = mtUI.rolled.tier; [res, label] = MT_TIERS[mtUI.diff][t]; if (mtUI.rolled.nat >= 19) { res = 's'; label = 'Success with a reward (natural ' + mtUI.rolled.nat + ')'; } }
    if (/consequence/i.test(label)) cons = true; if (/reward/i.test(label)) reward = true;
    if (res === 's') { s.succ++; if (mtUI.ch >= 0) s.over[mtUI.ch] = (s.over[mtUI.ch] || 0) + 1; } else s.fail++;
    if (cons) s.malice += 1; if (reward) s.tokens += 1;
    if (mtUI.skill.trim()) h.skills.push(mtUI.skill.trim());
    log(`${h.name}: ${c ? c.name : 'their own idea'} (${forced ? 'no roll' : mtUI.diff + ' ' + mtUI.char + (mtUI.skill ? ' + ' + mtUI.skill : '')}) → ${label}`, res === 's' ? 'positive' : 'negative', b);
    finishTurn(); re();
  };
  on('#mt-apply', () => apply(false));
  on('#mt-auto', () => apply(true));
  $$('[data-assist]').forEach(x => x.onclick = () => { if (!$('#mt-target').value) { toast('Everyone else has already acted this round'); return; } const b = mtSnap(s); const t = +$('#mt-target').value; const ok = x.dataset.assist === '1'; if (ok) s.edges[t] = true; const sk = $('#mt-askill').value.trim(); if (sk) s.heroes[mtUI.hero].skills.push(sk); log(`${s.heroes[mtUI.hero].name} assists ${s.heroes[t].name}${sk ? ' with ' + sk : ''}: ${ok ? 'edge on their test' : 'no help'}`, ok ? 'positive' : 'impatient', b); finishTurn(); re(); });
  on('#mt-useab', () => { const b = mtSnap(s); const n = Math.max(0, +$('#mt-autoN').value || 0); s.succ += n; log(`${s.heroes[mtUI.hero].name} uses ${$('#mt-what').value.trim() || 'an ability or item'}: ${n} automatic success${n === 1 ? '' : 'es'}`, 'positive', b); finishTurn(); re(); });
  on('#mt-pass', () => { const b = mtSnap(s); log(`${s.heroes[mtUI.hero].name} passes`, 'impatient', b); finishTurn(); re(); });
  const endRound = () => { const b = mtSnap(s); if (s.round >= s.rounds) { mtCheckEnd(s, true); log(`Time runs out after round ${s.round}`, 'start', b); } else { s.round++; s.edges = {}; log(`Round ${s.round} begins`, 'start', b); } mtUI.hero = null; re(); };
  on('#mt-endround', endRound); on('#mt-endround2', endRound);
  $$('[data-adj]').forEach(x => x.onclick = () => { s[x.dataset.adj]++; re(); });
  on('#mt-undo', () => { const l = s.log.pop(); if (l && l.before) { const st = JSON.parse(l.before); const lg = s.log; Object.assign(s, st); s.log = lg; } mtUI = { action: 'test', diff: 'medium', bonus: 0, auto: 1 }; re(); });
}
function mtPlayerView(M, s) {
  const el = document.createElement('div'); el.className = 'pview';
  const vis = mtVisible(M, s);
  el.innerHTML = `<button class="pv-x">✕ Close player view</button><div class="pv-in"><div class="pv-k">Montage test</div><h1>${esc(M.name)}</h1>
    ${s.started && s.share ? `<div class="pv-stats"><div><span>Successes</span><b>${s.succ}<small style="font-size:24px;opacity:.6">/${s.sLimit}</small></b></div><div><span>Failures</span><b>${s.fail}<small style="font-size:24px;opacity:.6">/${s.fLimit}</small></b></div><div><span>Round</span><b>${s.round}<small style="font-size:24px;opacity:.6">/${s.rounds}</small></b></div></div>` : ''}
    ${s.ended ? `<div class="pv-offer">${{ success: 'Total success!', partial: 'Partial success', failure: 'Total failure' }[s.ended]}</div>` : ''}
    ${!s.started || s.round === 1 ? M.scene.map(x => `<p class="pv-ra">${esc(x)}</p>`).join('') : M.events.filter(e => e.round <= s.round).map(e => e.read.map(r => `<p class="pv-ra">${esc(r)}</p>`).join('')).join('')}
    <div class="pv-known"><h3>Challenges</h3>${vis.map(([c, i]) => `<span class="${(s.over[i] || 0) >= c.max ? 'm' : 'open'}">${(s.over[i] || 0) >= c.max ? '✓ ' : ''}${esc(c.name)}</span>`).join('')}</div></div>`;
  $('.pv-x', el).onclick = () => el.remove();
  document.body.appendChild(el);
}

// ================= BOOK ENCOUNTERS → ENCOUNTER BUILDER =================
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, sixteen: 16 };
const singulars = w => uniq([w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y'), w.replace(/ves$/, 'f'), w.replace(/eses$/, 'esis'), w.replace(/men$/, 'man'), w.replace(/i$/, 'us')]);
function matchMonster(raw, packId) {
  const t = raw.toLowerCase().replace(/[’']/g, '’').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9’\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nm = x => x.name.toLowerCase().replace(/[’']/g, '’');
  const pool = MONS.filter(m => !packId || m.pack === packId).concat(MONS.filter(m => packId && m.pack !== packId));
  const words = t.split(' ');
  for (let n = Math.min(words.length, 6); n >= 1; n--) {
    const w = words.slice(0, n);
    const forms = [w.join(' ')];
    w.forEach((x, k) => singulars(x).forEach(sg => forms.push([...w.slice(0, k), sg, ...w.slice(k + 1)].join(' '))));
    for (const f of forms) { const m = pool.find(x => nm(x) === f); if (m) return m; }
  }
  return null;
}
function parseCreatureCell(txt) {
  const out = []; const re = /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|sixteen|\d+)\s+(.+?)(?=(?:\s+(?:and\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+[a-z])|,\s*|$)/gi; let m;
  const s = strip(txt).replace(/\s+/g, ' ');
  while ((m = re.exec(s))) { const n = NUMW[m[1].toLowerCase()] ?? parseInt(m[1]); const rest = m[2].trim(); if (rest) out.push({ n, text: rest }); }
  return out;
}
function bookEncounterTables() {
  const list = [];
  for (const p of PACKS) for (const c of p.chapters) {
    let head = null;
    c.blocks.forEach((b, i) => {
      if (b.t === 'h' && b.lvl <= 3 && b.lvl > 0) head = b.text;
      if (b.t === 'table' && b.head.length >= 2 && /^Group/i.test(b.head[0]) && /Creature/i.test(b.head[1])) list.push({ pack: p.id, ch: c.id, chTitle: c.title, part: c.part, i, name: head ? head : c.title, table: b });
    });
  }
  return list;
}
function bookEncounterData(packId, chId, idx) {
  const p = PK[packId]; const c = p && p.chapters.find(x => x.id === chId); const t = c && c.blocks[idx]; if (!t) return null;
  let head = c.title; for (let k = idx; k >= 0; k--) { const b = c.blocks[k]; if (b.t === 'h' && b.lvl <= 3 && b.lvl > 0) { head = b.text; break; } }
  const groups = [], missing = [];
  for (const r of t.rows) {
    const entries = [];
    for (const it of parseCreatureCell(r[1] || '')) {
      const m = matchMonster(it.text, packId);
      if (!m) { missing.push(`${it.n} ${it.text}`); continue; }
      const ex = entries.find(e => e.gid === m.gid); if (ex) ex.n += it.n; else entries.push({ gid: m.gid, n: it.n });
    }
    if (entries.length) groups.push({ id: 'g' + groups.length + Date.now().toString(36), name: 'Group ' + strip(r[0] || String(groups.length + 1)), entries });
  }
  const adj = [];
  for (let k = idx + 1; k < Math.min(c.blocks.length, idx + 14); k++) {
    const b = c.blocks[k];
    if (b.t === 'table') break;
    if (b.t === 'h' && /adjust/i.test(b.text)) { for (let j = k + 1; j < c.blocks.length; j++) { const x = c.blocks[j]; if (x.t === 'h' || x.t === 'table') break; const tx = strip(x.html || ''); if (tx) adj.push(tx); } break; }
  }
  return { name: (c.title !== head ? c.title + ': ' : '') + head, head, groups, missing, adj: adj.length ? adj : null };
}
async function loadBookEncounter(packId, chId, idx) {
  const d = bookEncounterData(packId, chId, idx); if (!d) return;
  if (!d.groups.length) { toast('Couldn’t match any creatures in that table'); return; }
  const hasStuff = ENC.groups.some(g => g.entries.length);
  if (hasStuff && !(await confirmSheet(`Replace the current encounter (“${ENC.name}”) with ${d.head}?`, 'Replace'))) return;
  ENC.name = d.name; ENC.groups = d.groups; ENC.setup = false; ENC.bookAdjust = d.adj; ENC.stones = {}; saveEnc();
  go('encounter');
  setTimeout(() => toast(d.missing.length ? `Loaded. Not found: ${esc(d.missing.join(', '))}` : `Loaded ${d.groups.length} groups from ${esc(d.head)}`), 300);
}
function bookEncounterSheet(onPick) {
  const list = bookEncounterTables();
  const el = document.createElement('div'); el.className = 'dlg';
  const byPack = {}; list.forEach(x => (byPack[x.pack] = byPack[x.pack] || []).push(x));
  el.innerHTML = `<div class="dlg-b negedit"><h2>Load an encounter from a book</h2><p>Every encounter group table in your books. Picking one fills the builder with its initiative groups.</p>
    <input id="be-q" type="search" placeholder="Filter…" style="width:100%;margin-bottom:10px;background:var(--bg);color:var(--ink);border:1px solid var(--line2);border-radius:4px;padding:8px">
    <div id="be-l">${Object.entries(byPack).map(([pid, xs]) => `<h3 class="negh" style="margin-top:10px">${esc(PK[pid]?.title || pid)}</h3>${xs.map(x => `<button class="beitem" data-be="${x.pack}|${x.ch}|${x.i}" data-q="${esc((x.chTitle + ' ' + x.name).toLowerCase())}"><b>${esc(x.name)}</b><span>${esc(x.chTitle)} · ${x.table.rows.length} groups</span></button>`).join('')}`).join('') || '<div class="empty">No encounter tables found in your books.</div>'}</div>
    <div class="dlgfoot"><span style="flex:1"></span><button class="btn ghost" id="be-x">Close</button></div></div>`;
  document.body.appendChild(el);
  $('#be-x', el).onclick = () => el.remove();
  $('#be-q', el).oninput = e => { const q = e.target.value.toLowerCase(); $$('.beitem', el).forEach(b => b.style.display = b.dataset.q.includes(q) ? '' : 'none'); };
  $$('[data-be]', el).forEach(b => b.onclick = () => { const [p, c, i] = b.dataset.be.split('|'); el.remove(); onPick ? onPick(p, c, +i) : loadBookEncounter(p, c, +i); });
}
window.__mt = () => ({ get MT_BOOK() { return MT_BOOK; }, refreshMontages, allNegs, refreshNegotiations, MONS, bookEncounterTables, parseCreatureCell, matchMonster });
