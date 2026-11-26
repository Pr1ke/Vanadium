// Draw Steel items for Sessions (the core sess.js handles folders, pages and export):
// combat encounters, montage tests and negotiations, plus the party used for encounter maths.
// Registered as SYS.session in drawsteel.js.
function syncEncToSession() {
  const r = ENC.sessionRef; const S = sessById(r.sid); const d = S && S.docs.find(x => x.id === r.did);
  if (!d) { delete ENC.sessionRef; return; }
  const c = JSON.parse(JSON.stringify(ENC)); delete c.sessionRef; d.enc = c; d.title = c.name || d.title; saveSessions();
}
const dsSessParty = S => ({ heroes: S.heroes, level: S.level, victories: S.victories, retainers: 0 });
function dsSessRefHtml(S, d, top) {
  const ref = d.type === 'mtg' ? (refreshMontages(), mtById(d.ref)) : (refreshNegotiations(), negById(d.ref));
  if (!ref) return top + `<div class="empty">This ${sessKind(d.type).label.toLowerCase()} is no longer available (was its book removed?).</div>`;
  if (d.type === 'mtg') return top + `<div class="actrow"><a class="btn" href="#montage--${ref.id}">▶ Run this montage</a></div>
    ${ref.intro ? `<p>${esc(ref.intro)}</p>` : ''}${ref.scene.map(x => `<div class="ra">${esc(x)}</div>`).join('')}
    <h3>Challenges</h3>${ref.challenges.map(c => `<div class="mtch"><div class="mtch-h"><b>${esc(c.name)}</b>${c.round > 1 ? `<span class="tagk">round ${c.round}</span>` : ''}</div><p>${esc(c.desc)}</p><div class="mtsug">${c.chars.map(x => `<span class="ck">${esc(x)}</span>`).join('')}${c.skills.map(x => `<span>${esc(x)}</span>`).join('')}</div></div>`).join('')}`;
  return top + `<div class="actrow"><a class="btn" href="#negotiation--${ref.id}">▶ Run this negotiation</a></div>
    ${ref.intro ? `<p>${esc(ref.intro)}</p>` : ''}<p><b>Interest</b> ${ref.interest} · <b>Patience</b> ${ref.patience} · <b>Impression</b> ${ref.impression ?? '—'}${ref.language ? ' · <b>Language</b> ' + esc(ref.language) : ''}</p>
    <h3>Motivations</h3>${ref.motivations.map(m => `<p><b>${esc(m.name)}:</b> ${esc(m.text)}</p>`).join('') || '<p class="note">None</p>'}
    <h3>Pitfalls</h3>${ref.pitfalls.map(m => `<p><b>${esc(m.name)}:</b> ${esc(m.text)}</p>`).join('') || '<p class="note">None</p>'}`;
}
const DS_SESSION = {
  planText: 'combat encounters, montages and negotiations',
  party: [{ id: 'h', key: 'heroes', label: 'Heroes', min: 1, max: 12 }, { id: 'l', key: 'level', label: 'Level', min: 1, max: 10 }, { id: 'v', key: 'victories', label: 'Avg. Victories', min: 0 }],
  partyNote: 'The party here is used for encounters you add to this session.',
  newParty: () => ({ heroes: ENC?.heroes || 4, level: ENC?.level || 1, victories: ENC?.victories || 0 }),
  partyLine: S => `${S.heroes} heroes, level ${S.level}, ${S.victories} avg. Victories`,
  overviewExtra: S => { const encs = S.docs.filter(x => x.type === 'enc'); return encs.length ? `<p class="note">Combat this session: ${encs.map(x => esc(x.title)).join(', ')}.</p>` : ''; },
  kinds: {
    enc: {
      icon: '⚔', label: 'Combat encounter', noun: 'encounter', addLabel: '⚔ Encounter',
      summary: x => x.enc ? ' · ' + (() => { const m = encMath(x.enc); return m.diff + ', ' + m.ev + ' EV'; })() : '',
      html(S, d, top) {
        const E = d.enc; if (!E) return top + '<div class="empty">Missing encounter.</div>';
        const M = encMath(E);
        const SAVED = ENC; ENC = E; if (STONES_ON) assignStones(false); const sc = scalingHtml(); ENC = SAVED;
        return top + `<div class="sencsum"><span class="dlabel" style="color:${DCOL[M.diff]}">${M.diff}</span> <b>${M.ev} EV</b> vs encounter strength ${M.ES} · ${E.heroes} heroes, level ${M.L}, ${E.victories} Victories · worth ${M.worth} Victor${M.worth === 1 ? 'y' : 'ies'}</div>
      <div class="actrow"><button class="btn" id="d-open">Open in Encounter Builder</button><button class="btn ghost" id="d-repl">Replace with the builder’s current encounter</button></div>
      ${E.groups.map(g => `<div class="grp"><div class="grp-t"><b class="gname" style="border:0">${esc(g.name)}</b></div>${g.entries.map(e => { const m = MON[e.gid]; return m ? `<div class="ent"><div class="ent-n"><a class="lnk" data-go="monsters--${m.gid}">${e.n} × ${esc(m.name)}</a>${(() => { const S2 = ENC; ENC = E; const h = entStones(g, e, m); ENC = S2; return h; })()}<span>Lv ${m.level} ${esc(m.role)} · ${isMinion(m) ? esc(m.ev) : 'EV ' + esc(m.ev)} · Stamina ${esc((m.stats || {}).Stamina || '—')}</span></div></div>` : ''; }).join('')}</div>`).join('')}
      ${sc}`;
      },
      onRename: d => { if (d.enc) d.enc.name = d.title; },
      wire(S, d) {
        if ($('#d-open')) $('#d-open').onclick = () => { ENC = JSON.parse(JSON.stringify(d.enc)); ENC.sessionRef = { sid: S.id, did: d.id }; ENC.setup = false; store.set('enc', ENC); go('encounter'); };
        if ($('#d-repl')) $('#d-repl').onclick = async () => { if (!ENC.groups.some(g => g.entries.length)) { toast('The encounter builder is empty'); return; } if (await confirmSheet(`Replace “${d.title}” with “${ENC.name}” from the builder?`, 'Replace')) { const c = JSON.parse(JSON.stringify(ENC)); delete c.sessionRef; d.enc = c; d.title = c.name; saveSessions(); sessionPage(S.id, d.id); } };
      },
      add(S, add) {
        const party = dsSessParty(S);
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
      },
      async pdf(S, d) { if (!d.enc.groups.some(g => g.entries.some(e => MON[e.gid]))) return null; const b = await buildEncounterPdf(d.enc); saveSessions(); return b; }
    },
    mtg: {
      icon: '🏃', label: 'Montage test', noun: 'montage', addLabel: '🏃 Montage',
      html: dsSessRefHtml,
      add(S, add) { refreshMontages(); return pickerSheet('Add a montage test', allMt().map(m => ({ id: m.id, name: m.name, sub: m.challenges.length + ' challenges', group: m.user ? 'Your montages' : (PK[m.pack]?.title || '') })), id => add({ type: 'mtg', ref: id, title: mtById(id).name })); },
      pdf(S, d) { refreshMontages(); const m = mtById(d.ref); return m ? buildMontagePdf(m) : null; }
    },
    neg: {
      icon: '🗣', label: 'Negotiation', noun: 'negotiation', addLabel: '🗣 Negotiation',
      html: dsSessRefHtml,
      add(S, add) { refreshNegotiations(); return pickerSheet('Add a negotiation', allNegs().map(n => ({ id: n.id, name: n.name, sub: `Interest ${n.interest} · Patience ${n.patience}`, group: n.user ? 'Your negotiations' : (PK[n.pack]?.title || '') })), id => add({ type: 'neg', ref: id, title: negById(id).name })); },
      pdf(S, d) { refreshNegotiations(); const n = negById(d.ref); return n ? buildNegotiationPdf(n) : null; }
    }
  }
};
