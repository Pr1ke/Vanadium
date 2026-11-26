// A deliberately tiny second game system, used only by tests/systems_test.py to exercise the
// system switch and per-system data. It is NOT part of the real build. It also documents the
// minimum a system needs: data + init, corePack, lists, menu, home, browse, renderMonster, notices.
registerSystem({
  id: 'sample', name: 'Sample System', short: 'Sample',
  data: { file: 'data/sample.json', loading: 'Loading the sample rules…' },
  init() {
    TYPES = { spells: { label: 'Spells', one: 'Spell' }, monsters: { label: 'Monsters', one: 'Monster' } };
    BYID = {}; Object.keys(TYPES).forEach(t => { BYID[t] = {}; (D[t] || []).forEach(e => BYID[t][e.id] = e); });
    BYID.monsters = MON;
  },
  corePack: () => ({ id: 'srd', title: 'Sample Rules', kind: 'core', builtin: true, chapters: D.book, monsters: [], abilities: [] }),
  builtin: [],
  lists: {
    spells: { cols: [['Name', e => e.name, 'nm'], ['Level', e => String(e.level), 'mu', e => e.level]], filters: [['Level', e => 'Level ' + e.level]] },
    monsters: { idOf: m => m.gid, cols: [['Name', m => m.name, 'nm']], filters: [], text: m => m.name, view: m => `<h2>${esc(m.name)}</h2>` }
  },
  menu: () => [
    ['Rules', [['library', 'Library'], ['book--srd', 'Sample Rules'], ['spells']]],
    ['Tools', [['sessions', 'Sessions'], ['cards', 'Cards'], ['import', 'Import a PDF'], ['pinned', 'Pinned Items'], ['sync', 'Sync across devices']]]
  ],
  home() { $('#main').innerHTML = '<div class="home"><h1 id="samplehome">Sample System</h1><p>A test system.</p></div>'; document.title = 'Sample — Vanadium'; },
  browse() { },
  renderMonster: m => m ? `<div class="mon">${esc(m.name)}</div>` : '',
  importer: { module: './lib/dsparse.mjs', hint: 'Any PDF with selectable text' },
  pdfNotice: 'Sample System test content',
  notice: 'Sample System footer notice'
});
