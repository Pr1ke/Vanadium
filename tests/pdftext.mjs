// Prints the text of a PDF, page by page (for comparing exported PDFs in tests/snapshot.py):
//   node tests/pdftext.mjs file.pdf
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), verbosity: 0, isEvalSupported: false }).promise;
const out = [];
for (let i = 1; i <= doc.numPages; i++) {
  const tc = await (await doc.getPage(i)).getTextContent();
  out.push(`--- page ${i}\n` + tc.items.map(t => t.str).join(' ').replace(/\s+/g, ' ').trim());
}
process.stdout.write(out.join('\n'));
