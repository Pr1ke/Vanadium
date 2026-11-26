// Writes a small test PDF for the importer (PDFs are git-ignored, so tests make their own):
//   node tests/make_fixture_pdf.mjs out.pdf
// Two "chapters" with headings, body text, a Group/Creatures encounter table and a short monster
// stat block, so the import preview has something to count.
import { PDFDocument, StandardFonts } from '../site/lib/pdf-lib.esm.min.js';
import fs from 'node:fs';
const doc = await PDFDocument.create();
const R = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
doc.setTitle('Snapshot Test Adventure');
const page = lines => { const p = doc.addPage([612, 792]); let y = 740; for (const [t, size, bold] of lines) { p.drawText(t, { x: 60, y, size, font: bold ? B : R }); y -= size * 1.6; } };
page([['Chapter 1: The Old Mine', 22, 1], ['The heroes arrive at the mine at dusk. Smoke rises from the shaft.', 10], ['Read the following aloud when they enter the tunnels.', 10],
  ['Ambush in the Dark', 14, 1], ['Group', 10, 1], ['Creatures', 10, 1], ['1', 10], ['Two goblin snipers', 10], ['2', 10], ['One goblin underboss', 10],
  ['Treasure', 14, 1], ['A small chest holds 30 gold coins and a healing potion.', 10]]);
page([['Chapter 2: The Ember Gem', 22, 1], ['Deep below, the gem glows in a cracked altar.', 10],
  ['Mine Warden', 14, 1], ['Level 2 Minion Brute', 10, 1], ['EV 4', 10], ['Stamina 8   Speed 5   Size 1M   Stability 0   Free Strike 2', 10],
  ['Might +2   Agility +0   Reason -1   Intuition +0   Presence -1', 10], ['Pick Swing (Signature Ability)', 10, 1], ['Melee, Strike, Weapon', 10]]);
fs.writeFileSync(process.argv[2], await doc.save({ useObjectStreams: false }));
console.log('wrote', process.argv[2]);
