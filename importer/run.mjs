import * as pdfjs from '/opt/npm-tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { extractPages, parsePack } from './dsparse.mjs';
const [,, pdf, out, title, kind, id] = process.argv;
const cache = out + '.pages.json';
let pages;
if (fs.existsSync(cache)) pages = JSON.parse(fs.readFileSync(cache));
else {
  const doc = await pdfjs.getDocument({data: new Uint8Array(fs.readFileSync(pdf)), fontExtraProperties:true, isEvalSupported:false, verbosity:0}).promise;
  pages = await extractPages(doc, (n,t)=>{ if(n%50==0) console.error(n+'/'+t); });
  fs.writeFileSync(cache, JSON.stringify(pages));
}
const t0 = Date.now();
const pack = parsePack(JSON.parse(JSON.stringify(pages)), {title, kind, id});
console.error('parse ms', Date.now()-t0);
fs.writeFileSync(out, JSON.stringify(pack));
console.log(JSON.stringify({chapters: pack.chapters.map(c=>c.title+':'+c.blocks.length), monsters: pack.monsters.length, abilities: pack.abilities.length, stats: pack.stats}, null, 0));
