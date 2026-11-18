import fs from 'fs'; import { parsePack } from './dsparse.mjs';
const [,, pagesF, out, title, kind, id] = process.argv;
const pack = parsePack(JSON.parse(fs.readFileSync(pagesF)), { title, kind, id });
fs.writeFileSync(out, JSON.stringify(pack)); console.log(id, pack.monsters.length, pack.images.length, pack.monsters.filter(m => m.img != null).length);
