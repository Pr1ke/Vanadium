import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({data, fontExtraProperties:true, useSystemFonts:false, isEvalSupported:false}).promise;
console.log('pages', doc.numPages);
const p = await doc.getPage(+process.argv[3]);
const tc = await p.getTextContent();
await p.getOperatorList();
for (const it of tc.items.slice(0, +process.argv[4]||80)){
  let fn = it.fontName; let f; try { f = p.commonObjs.get(it.fontName); } catch(e){}
  console.log(Math.round(it.transform[5]), Math.round(it.transform[4]), Math.round(it.transform[0]), (f&&f.name)||fn, tc.styles[it.fontName]?.fontFamily, JSON.stringify(it.str), it.hasEOL?'EOL':'');
}
