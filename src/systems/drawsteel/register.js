// Registers Draw Steel with the core. Loaded LAST of the Draw Steel files (see SYSTEM_FILES in
// mksite.py): the object below is built at load time, so everything it names must already exist.
// Hook contract: see registerSystem in app.js.
registerSystem({
  id: 'drawsteel', name: 'Draw Steel', short: 'DS',
  data: { file: 'data/heroes.json', loading: 'Loading the rules…' },
  init: initHeroes,
  corePack: () => ({ id: 'heroes', title: 'Draw Steel: Heroes', kind: 'core', builtin: true, chapters: D.book, monsters: [], abilities: [], heroes: true }),
  builtin: BUILTIN,
  lists: DS_LISTS,
  menu: dsMenu, home: dsHome, browse: dsBrowse,
  routes: {
    encounter: () => encounterPage(),
    respite: () => respitePage(),
    negotiation: b => b ? negotiationPage(b) : negotiationHub(),
    montage: b => b ? montagePage(b) : montageHub(),
    classes: b => b ? classPage(b) : classIndex()
  },
  packRoutes: ['monsters', 'negotiation', 'montage', 'encounter'],
  renderMonster, renderAbility,
  renderBlock: dsRenderBlock, afterHeading: dsAfterHeading, afterTable: dsAfterTable, chapterExtras: dsChapterExtras,
  onAddPack: dsOnAddPack,
  entityMeta: dsEntityMeta, entitySource: dsEntitySource, preview: dsPreview,
  pinGroups: [
    { type: 'monsters', title: ms => `Monsters · ${ms.reduce((s, m) => s + (parseInt(m.ev) || 0), 0)} EV total`, render: m => renderMonster(m) },
    { type: 'abilities', title: () => 'Abilities', render: a => renderAbility(a) }
  ],
  linkTypes: ['conditions'],
  noLink: '.ab-n,.ma-n,.mon-n,.pot,.chr',   // names inside ability cards and stat blocks are never auto-linked
  searchExtra: dsSearchExtra, searchIndex: dsSearchIndex,
  searchPriority: { conditions: 0, classes: 0, ancestries: 1, kits: 2, monsters: 2, abilities: 3, glossary: 3 },
  packSummary: p => p.core ? ' · ' + D.abilities.length + ' abilities' : '',
  importer: { module: './lib/dsparse.mjs', hint: 'Works best with MCDM-format Draw Steel PDFs that contain selectable text', stats: dsImportStats },
  onClick: dsOnClick,
  pdfNotice: 'Draw Steel © MCDM Productions, LLC, used under the DRAW STEEL Creator License',
  session: DS_SESSION,
  cards: DS_CARDS,
  roller: { title: 'Power roll (2d10)', html: DS_ROLLER_HTML, mount: dsMountRoller },
  notice: 'Vanadium is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC. DRAW STEEL © 2024 MCDM Productions, LLC.',
  syncWhat: 'sessions, encounters, montages, negotiations, cards, pins, characters, Respite heroes, settings',
});
