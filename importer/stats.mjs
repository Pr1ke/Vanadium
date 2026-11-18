import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({data, fontExtraProperties:true, isEvalSupported:false, verbosity:0}).promise;
const st = {}; const ex = {};
const [a,b] = (process.argv[3]||'1-'+doc.numPages).split('-').map(Number);
for (let n=a;n<=b;n++){
  const p = await doc.getPage(n); const tc = await p.getTextContent(); await p.getOperatorList();
  for (const it of tc.items){ if(!it.str.trim()) continue; let f; try{f=p.commonObjs.get(it.fontName).name}catch(e){f='?'}
    f=f.replace(/^[A-Z]{6}\+/,''); const k=f+'@'+Math.round(Math.hypot(it.transform[0],it.transform[1])*10)/10;
    st[k]=(st[k]||0)+it.str.length; (ex[k]=ex[k]||[]).length<4 && ex[k].push(it.str.slice(0,30)); }
  p.cleanup();
}
for (const [k,v] of Object.entries(st).sort((x,y)=>y[1]-x[1])) console.log(v,k,JSON.stringify(ex[k]));
