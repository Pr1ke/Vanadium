import fs from 'fs';
const p = JSON.parse(fs.readFileSync(process.argv[2]));
const mode = process.argv[3] || 'outline';
const strip = s => (s||'').replace(/<[^>]+>/g,'');
if (mode==='outline') for (const c of p.chapters){ console.log('## '+c.title); for (const b of c.blocks){ if(b.t==='h') console.log('  '.repeat(b.lvl)+b.lvl+' '+b.text+' p'+b.pg); else if(b.t!=='p'&&b.t!=='li') console.log('      ['+b.t+'] '+(b.ref||b.head?.join(' | '))); } }
if (mode==='mon') for (const m of p.monsters.slice(+process.argv[4]||0, (+process.argv[4]||0)+(+process.argv[5]||3))) console.log(JSON.stringify(m,null,1).replace(/<[^>]+>/g,''));
if (mode==='text') { const c=p.chapters[+process.argv[4]]; for (const b of c.blocks.slice(+process.argv[5]||0, (+process.argv[5]||0)+(+process.argv[6]||40))) console.log(b.t, b.lvl??'', strip(b.html||b.text||b.ref||JSON.stringify(b.rows)).slice(0,300)); }
