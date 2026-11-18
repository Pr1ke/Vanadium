import * as pdfjs from '/opt/npm-tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { extractPages, parsePack } from './dsparse.mjs';
const [,, pdf, out, title, kind, id] = process.argv;
const rawDir = '/tmp/imgraw/' + id; fs.mkdirSync(rawDir, { recursive: true });
let n = 0;
const encode = async (obj) => {
  if (!obj.data) return null;
  const k = n++; const ch = obj.kind === 1 ? 1 : obj.kind === 2 ? 3 : 4;
  let data = obj.data;
  if (obj.kind === 1) { // 1bpp packed -> 8bit
    const rowB = Math.ceil(obj.width / 8); const o = new Uint8Array(obj.width * obj.height);
    for (let y = 0; y < obj.height; y++) for (let x = 0; x < obj.width; x++) o[y * obj.width + x] = (data[y * rowB + (x >> 3)] >> (7 - (x & 7)) & 1) ? 255 : 0;
    data = o;
  }
  fs.writeFileSync(`${rawDir}/${k}.raw`, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  fs.writeFileSync(`${rawDir}/${k}.json`, JSON.stringify({ w: obj.width, h: obj.height, ch }));
  return `data/img/${id}/${k}.webp`;
};
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), fontExtraProperties: true, isEvalSupported: false, verbosity: 0 }).promise;
const pages = await extractPages(doc, (a, t) => { if (a % 50 == 0) console.error(a + '/' + t); }, { images: { OPS: pdfjs.OPS, encode } });
fs.writeFileSync(out + '.pages.json', JSON.stringify(pages));
const pack = parsePack(JSON.parse(JSON.stringify(pages)), { title, kind, id });
fs.writeFileSync(out, JSON.stringify(pack));
console.log(JSON.stringify({ monsters: pack.monsters.length, images: pack.images.length, raw: n, monImgs: pack.monsters.filter(m => m.img != null).length }));
