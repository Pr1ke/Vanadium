// Registers 5e (SRD 5.2) with the core. Loaded last of the srd5 files (SYSTEM_FILES in mksite.py).
// Tools (encounter builder, initiative, dice, session items) live in s5-tools.js; 5e stat blocks in the importer come in step 5.
registerSystem({
  id: 'srd5', name: '5e (SRD 5.2)', short: '5e',
  data: { file: 'data/srd5.json', loading: 'Loading the SRD 5.2 rules…' },
  init: s5Init,
  corePack: () => ({ id: 'srd52', title: 'SRD 5.2 Reference', kind: 'core', builtin: true, chapters: D.book, monsters: [], abilities: [] }),
  builtin: [{ id: 'srd5-monsters', file: 'data/srd5-monsters.json', title: 'SRD 5.2 Monsters', kind: 'bestiary' }],
  lists: S5_LISTS,
  menu: s5Menu, home: s5Home, browse: s5Browse,
  routes: { encounter: () => s5EncounterPage(), initiative: () => s5InitiativePage() },
  packRoutes: ['monsters', 'encounter', 'initiative'],
  roller: { title: 'Dice', html: S5_DICE_HTML, mount: s5MountRoller },
  session: S5_SESSION,
  onClick: s5OnClick,
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
  importer: { module: './lib/dsparse.mjs', hint: 'PDFs with selectable text. Text, headings and tables are imported; 5e stat blocks are not recognised yet.' },
  pdfNotice: 'Includes SRD 5.2 material by Wizards of the Coast LLC, licensed CC BY 4.0 (creativecommons.org/licenses/by/4.0)',
  notice: S5_ATTRIB,
  syncWhat: 'sessions, encounters, initiative, cards, pins, settings'
});
