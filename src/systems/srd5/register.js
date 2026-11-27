// Registers 5e (SRD 5.2) with the core. Loaded last of the srd5 files (SYSTEM_FILES in mksite.py).
// Tools (encounter builder, initiative, dice, session items): s5-tools.js. Cards: s5-cards.js.
// Importer for your own books (JSON files in the 5etools data format): s5-import.js.
registerSystem({
  id: 'srd5', name: '5e (SRD 5.2)', short: '5e',
  data: { file: 'data/srd5.json', loading: 'Loading the SRD 5.2 rules…' },
  init: s5Init,
  corePack: () => ({ id: 'srd52', title: 'SRD 5.2 Reference', kind: 'core', builtin: true, chapters: D.book, monsters: [], abilities: [] }),
  builtin: [{ id: 'srd5-monsters', file: 'data/srd5-monsters.json', title: 'SRD 5.2 Monsters', kind: 'bestiary' }],
  lists: S5_LISTS,
  menu: s5Menu, home: s5Home, browse: s5Browse,
  routes: { encounter: () => s5EncounterPage(), initiative: () => s5InitiativePage(), imports: () => s5ImportsPage() },
  packRoutes: ['monsters', 'encounter', 'initiative', 'imports'],
  roller: { title: 'Dice', html: S5_DICE_HTML, mount: s5MountRoller },
  session: S5_SESSION,
  onClick: e => s5FindClick(e) || s5OnClick(e),
  cards: S5_CARDS,
  renderBlock: s5RenderBlock,
  packSummary: s5PackSummary,
  renderMonster: s5RenderMonster,
  entityMeta: s5EntityMeta, entitySource: s5EntitySource, preview: s5Preview,
  pinGroups: [
    { type: 'monsters', title: ms => `Monsters · ${ms.reduce((s, m) => s + s5Num(m.xp), 0).toLocaleString('en')} XP total`, render: m => s5RenderMonster(m) },
    { type: 'spells', title: () => 'Spells', render: s => s5SpellCard(s) }
  ],
  linkTypes: ['conditions'],
  noLink: '.s5-n,.s5-spl,.s5iname',
  searchExtra: s5SearchExtra,
  searchPriority: { conditions: 0, classes: 0, spells: 1, species: 1, monsters: 2, items: 2, feats: 2, backgrounds: 2, equipment: 3 },
  importer: { run: s5ImportFiles, accept: '.json,application/json', label: 'Import files', noun: 'books',
    intro: 'Add your own 5e books, adventures, bestiaries, spells and classes from JSON files in the 5etools data format. Monsters become stat blocks, adventures become readable books with read-aloud boxes and stat blocks in place, and spells and classes join the lists.',
    hint: 'JSON files or a whole folder: bestiary-, adventure-, book-, spells- (with sources.json) and class- files' },
  pdfNotice: 'Includes SRD 5.2 material by Wizards of the Coast LLC, licensed CC BY 4.0 (creativecommons.org/licenses/by/4.0)',
  notice: S5_ATTRIB,
  syncWhat: 'sessions, encounters, initiative, cards, pins, settings'
});
