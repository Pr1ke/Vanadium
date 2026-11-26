// Draw Steel PDF sheets: montage tests and negotiations (moved from print.js)
// ---------- montage sheet ----------
async function buildMontagePdf(M) {
  const w = await makeWriter(M.name);
  w.newPage();
  w.header(M.name, 'Montage test' + (M.user ? '' : ' · ' + (PK[M.pack]?.title || '')) + (M.src?.pg ? ', p. ' + M.src.pg : ''), `${M.challenges.length} challenges`);
  if (M.intro) w.para(esc(M.intro), { size: 9.5 });
  if (M.scene.length) { w.h('Setting the scene', 3); M.scene.forEach(x => w.quote(esc(x))); }
  // setup
  w.h('Setup', 2, 'Pick the difficulty, then circle the limits for your number of heroes.');
  const diffs = ['easy', 'moderate', 'hard']; const hs = [2, 3, 4, 5, 6, 7, 8];
  w.table(['Difficulty', ...hs.map(n => n + ' heroes'), 'Victories'], diffs.map(d => [`<b>${d[0].toUpperCase() + d.slice(1)}</b>`, ...hs.map(n => { const [a, b] = mtLimits(d, n); return `${a} / ${b}`; }), d === 'easy' ? 'Total success: 1' : d === 'moderate' ? 'Success 1 · Partial 1' : 'Success 2 · Partial 1']), [1.4, 1, 1, 1, 1, 1, 1, 1, 2.2], { size: 8 });
  if (M.limits) w.para(`<i>This montage’s own limits: ${M.limits.rows.map(r => esc(r.join(' / '))).join('; ')}</i>`, { size: 8 });
  w.para('<b>Limits</b> are shown as success limit / failure limit. The montage ends at either limit or after the last round. <b>Partial success</b>: time runs out (or the failure limit is hit) with at least two more successes than failures.', { size: 8, color: w.grey });
  // trackers
  w.h('Tracker', 2);
  w.ensure(70);
  const track = (label, n) => { w.T(label, w.MG, w.y - 11, 9, w.FB); for (let k = 0; k < n; k++) w.box(w.MG + 70 + k * 22, w.y - 16, 18, 18, { bw: 0.8 }); w.T('limit: ____', w.MG + 70 + n * 22 + 6, w.y - 11, 8, w.F, w.grey); w.y -= 24; };
  track('Successes', 12); track('Failures', 12);
  w.T('Round', w.MG, w.y - 11, 9, w.FB); ['1', '2', '3'].forEach((r, k) => { w.box(w.MG + 70 + k * 40, w.y - 16, 18, 18); w.T(r, w.MG + 92 + k * 40, w.y - 11, 8, w.F, w.grey); }); w.T('Consequences: ________   Rewards: ________', w.MG + 200, w.y - 11, 8.5, w.F, w.grey); w.y -= 28;
  for (const r of [1, 2]) {
    w.h('Round ' + r, 3, 'One action per hero: a test, an assist, or an ability/item.');
    w.table(['Hero', 'Challenge', 'Characteristic + skill', 'Easy / Med / Hard', 'Result'], Array.from({ length: 5 }, () => ['', '', '', 'E  ·  M  ·  H', 'Pass / Fail']), [1.3, 1.8, 1.8, 1.1, 0.8], { minH: 20, size: 8 });
    const ev = M.events.filter(e => e.round === r); ev.forEach(e => { w.para(`<b>Round ${e.round}:</b> ${esc(e.text)}`, { size: 9 }); e.read.forEach(x => w.quote(esc(x))); });
  }
  w.ensure(120); w.para('<b>Skills already used</b> (a hero can’t use the same skill twice):', { size: 8.5 });
  w.table(null, Array.from({ length: 5 }, () => ['Hero:', '']), [1, 4], { minH: 18, size: 8 });
  // challenges
  w.h('Challenges', 2, 'Tick a box each time a challenge is overcome.');
  for (const c of M.challenges) {
    const body = `<b>${esc(c.name)}</b>${c.round > 1 ? ` <i>(appears in round ${c.round})</i>` : ''}${c.max > 1 ? ` <i>(can be overcome ${c.max} times)</i>` : ''}. ${esc(c.desc)}${c.chars.length ? ` <b>Characteristics:</b> ${esc(c.chars.join(', '))}.` : ''}${c.skills.length ? ` <b>Skills:</b> ${esc(c.skills.join(', '))}.` : ''}`;
    w.ensure(28); const y0 = w.y; for (let k = 0; k < c.max; k++) w.cb(w.MG + 2 + k * 11, w.y - 9.5, 8.5);
    const ind = 6 + c.max * 11;
    w.flow(body, { size: 9, width: w.CW - ind, x: w.MG + ind }); w.y -= 5;
  }
  // reference
  w.h('Test results', 3);
  w.table(['', '≤11 (tier 1)', '12–16 (tier 2)', '17+ (tier 3)'], [['<b>Easy</b>', 'Success with a consequence', 'Success', 'Success with a reward'], ['<b>Medium</b>', 'Failure', 'Success with a consequence', 'Success'], ['<b>Hard</b>', 'Failure with a consequence', 'Failure', 'Success']], [1, 2, 2, 2], { size: 8 });
  w.para('A natural 19 or 20 is always a success with a reward. A good idea can be an automatic success. An assist that succeeds gives the other hero an edge.', { size: 8, color: w.grey });
  if (Object.keys(M.outcomes).length) {
    w.h('Outcomes', 2);
    [['success', 'Total success'], ['partial', 'Partial success'], ['failure', 'Total failure']].forEach(([k, l]) => { if (M.outcomes[k]) w.checkItem(`<b>${l}:</b> ${esc(M.outcomes[k])}`); });
  }
  if (M.notes) { w.h('Notes', 3); M.notes.split('\n').forEach(l => w.para(esc(l), { size: 8.5 })); }
  return w.bytes();
}
// ---------- negotiation sheet ----------
async function buildNegotiationPdf(N) {
  const w = await makeWriter(N.name);
  w.newPage();
  w.header(N.name, 'Negotiation' + (N.user ? '' : ' · ' + (PK[N.pack]?.title || '')) + (N.src?.pg ? ', p. ' + N.src.pg : ''), `Impression ${N.impression ?? '—'}`);
  if (N.intro) w.para(esc(N.intro), { size: 9.5 });
  // trackers
  w.ensure(110);
  const tracker = (label, start, note) => {
    w.T(label, w.MG, w.y - 12, 11, w.FB); w.T(`starts at ${start}` + (note ? ' · ' + note : ''), w.MG + 80, w.y - 12, 8, w.F, w.grey); w.y -= 18;
    for (let k = 0; k <= 5; k++) { const x = w.MG + 14 + k * 46; w.circ(x, w.y - 12, 11, { bw: k === start ? 2 : 0.8 }); w.T(String(k), x - 3, w.y - 15.5, 11, w.FB, k === start ? w.ink : w.grey); }
    w.y -= 34;
  };
  tracker('Interest', N.interest, 'at 5 they agree, at 0 they walk away');
  tracker('Patience', N.patience, 'at 0 they end the negotiation: make an offer');
  w.para(`<b>Language:</b> ${esc(N.language || '—')}  ·  <b>Impression:</b> ${N.impression ?? '—'}  ·  Starting attitude: ______________`, { size: 8.5, color: w.grey });
  w.h('Motivations', 2, 'Tick when used. A motivation only works once.');
  N.motivations.forEach(m => w.checkItem(`<b>${esc(m.name)}:</b> ${esc(m.text)}`, false, { size: 9 }));
  if (!N.motivations.length) w.para('<i>None listed.</i>');
  w.h('Pitfalls', 2, 'An argument that hits a pitfall fails: interest −1, patience −1.');
  N.pitfalls.forEach(m => w.bullet(`<b>${esc(m.name)}:</b> ${esc(m.text)}`, { size: 9 }));
  if (!N.pitfalls.length) w.para('<i>None listed.</i>');
  w.h('Arguments', 2);
  w.table(['Argument', 'Tier 1 (≤11)', 'Tier 2 (12–16)', 'Tier 3 (17+)'], [
    ['<b>Appeals to an unused motivation</b> (medium test)', 'Patience −1', 'Interest +1, patience −1', 'Interest +1'],
    ['<b>No motivation or pitfall</b> (harder test)', 'Interest −1, patience −1', 'Patience −1', 'Interest +1, patience −1'],
    ['<b>Uses a pitfall</b>', 'Interest −1, patience −1', '', ''],
    ['<b>Same motivation again</b>', 'Patience −1', '', '']
  ], [2.4, 1.5, 1.5, 1.5], { size: 8 });
  w.para('A natural 19–20 on an argument without a motivation keeps patience the same. Caught in a lie: interest −1 more. Repeating an argument: automatic tier 1. Reading the NPC (Intuition): tier 1 patience −1, tier 3 learn a motivation or pitfall.', { size: 8, color: w.grey });
  w.h('Log', 3);
  w.table(['Hero', 'Argument', 'Motivation / pitfall', 'Tier', 'Interest', 'Patience'], Array.from({ length: 8 }, () => ['', '', '', '', '', '']), [1.2, 2.6, 1.6, 0.6, 0.8, 0.8], { minH: 20, size: 8 });
  w.h('Outcomes', 2, 'When interest hits 5, patience hits 0, or the heroes stop: the NPC makes an offer based on interest.');
  for (let k = 5; k >= 0; k--) { const t = N.outcomes[k] || OFFERS[k][1]; w.checkItem(`<b>Interest ${k} · ${esc(OFFERS[k][0])}</b> ${esc(t)}`, false, { size: 9 }); }
  if (N.victories) w.para(`<b>Victories:</b> ${esc(N.victories)}`, { size: 9 });
  if (N.notes) { w.h('Notes', 3); N.notes.split(/\n+/).forEach(l => w.para(esc(l), { size: 8.5 })); }
  return w.bytes();
}
