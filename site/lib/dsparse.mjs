// Steeltools PDF parser — works in the browser and in node with pdf.js.
// extractPages(doc) -> raw pages; parsePack(pages, meta) -> {chapters, monsters, abilities}

// opts.images = { OPS, encode: async ({width, height, kind, data, bitmap}) => ref }  (optional)
export async function extractPages(doc, onProgress, opts = {}) {
  const pages = [];
  const imgCache = new Map();
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    let ops = null;
    try { ops = await p.getOperatorList(); } catch (e) { }
    const imgs = [];
    if (ops && opts.images) { try { await collectImages(p, ops, vp, opts.images, imgCache, imgs); } catch (e) { console.warn('images p' + n, e); } }
    const items = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      let fname = '';
      try { const f = p.commonObjs.get(it.fontName); fname = (f && f.name) || ''; } catch (e) { }
      if (!fname) fname = (tc.styles[it.fontName] && tc.styles[it.fontName].fontFamily) || it.fontName;
      const [a, b, c, d, e, f] = it.transform;
      items.push({ s: it.str, f: fname.replace(/^[A-Z]{6}\+/, ''), z: Math.round(Math.hypot(a, b) * 10) / 10, x: e, y: vp.height - f, w: it.width, rot: Math.abs(b) > 0.01 || Math.abs(c) > 0.01 });
    }
    pages.push({ n, w: vp.width, h: vp.height, items, imgs });
    p.cleanup();
    if (onProgress) onProgress(n, doc.numPages);
  }
  return pages;
}

async function collectImages(p, ops, vp, IO, cache, out) {
  const O = IO.OPS; const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  const getObj = name => new Promise(res => { const src = name.startsWith('g_') ? p.commonObjs : p.objs; try { src.get(name, res); } catch (e) { try { res(src.get(name)); } catch (e2) { res(null); } } setTimeout(() => res(null), 4000); });
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k], args = ops.argsArray[k];
    if (fn === O.save) stack.push(ctm.slice());
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(ctm, args);
    else if (fn === O.paintFormXObjectBegin && args && args[0]) { stack.push(ctm.slice()); ctm = mul(ctm, args[0]); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) {
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]], ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const w = x1 - x0, h = y1 - y0;
      if (w < 40 || h < 40) continue;                       // icons, bullets, ornaments
      if (w * h > vp.width * vp.height * 0.8) continue;     // page backgrounds
      const obj = fn === O.paintInlineImageXObject ? args[0] : await getObj(args[0]);
      if (!obj || (obj.width || 0) < 64 || (obj.height || 0) < 64) continue;
      let key = typeof args[0] === 'string' && args[0].startsWith('g_') ? args[0] : null;
      if (!key) { const d = obj.data; let hsh = 0; if (d) for (let q = 0; q < d.length; q += Math.max(1, (d.length / 997) | 0)) hsh = (hsh * 31 + d[q]) | 0; key = obj.width + 'x' + obj.height + ':' + hsh; }
      let ref = cache.get(key);
      if (ref === undefined) { ref = await IO.encode(obj); cache.set(key, ref); }
      if (ref == null) continue;
      out.push({ x: x0, y: vp.height - y1, w, h, key, ref, pw: obj.width, ph: obj.height });
    }
  }
}

// ---------------------------------------------------------------------------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isGlyphF = f => /Glyph|Potenc/i.test(f);
const isBoldF = f => /Bold|Black|DBd|Heavy|Semibold|Demi/i.test(f);
const isItalF = f => /Italic|Oblique|It$/i.test(f);
const ACTIONS = ['free triggered action', 'free triggered', 'triggered action', 'triggered', 'free maneuver', 'main action', 'maneuver', 'no action', 'move action', 'free main action', 'villain action'];
const canonAction = a => {
  a = a.toLowerCase();
  if (a === 'triggered' || a === 'triggered action') return 'Triggered action';
  if (a.startsWith('free triggered')) return 'Free triggered action';
  return a[0].toUpperCase() + a.slice(1);
};
const slug = s => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const TIERCH = new Set(['á', 'é', 'í', '1', '2', '3', '!', '@', '#', 'Á', 'É', 'Í']);

function potency(s) {
  const t = s.trim();
  let m = t.match(/^([marip])\s*<\s*([wvs])\]*$/i);
  if (m) return `<span class="pot">${m[1].toUpperCase()}&lt;${{ w: 'WEAK', v: 'AVERAGE', s: 'STRONG' }[m[2].toLowerCase()]}</span>`;
  m = t.match(/^([marip])\s*<\s*(\d)\]*$/i);
  if (m) return `<span class="pot">${m[1].toUpperCase()}&lt;${m[2]}</span>`;
  if (/^[MARIP]$/.test(t)) return `<span class="chr">${t}</span>`;
  return null;
}

export function parsePack(pages, meta = {}) {
  const packId = meta.id || slug(meta.title || 'pack');
  // ---------- 1. clean items, page labels ----------
  const labels = {};
  for (const pg of pages) {
    const keep = [];
    for (const it of pg.items) {
      if (it.rot) continue;
      if (!it.s.trim() && !/\s/.test(it.s)) continue;
      const top = it.y;
      if (top > pg.h * 0.955 || top < pg.h * 0.035) {
        if (/^\s*\d{1,3}\s*$/.test(it.s)) labels[pg.n] = it.s.trim();
        continue;
      }
      if (it.x < pg.w * 0.035 || it.x > pg.w * 0.965) continue;
      keep.push(it);
    }
    const seen = new Set();
    pg.clean = keep.filter(it => { const k = it.s + '|' + Math.round(it.x) + '|' + Math.round(it.y); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  // ---------- 2. style statistics ----------
  const stat = {};
  for (const pg of pages) for (const it of pg.clean) {
    const t = it.s.trim(); if (!t) continue;
    const k = it.f + '@' + it.z; stat[k] = (stat[k] || 0) + t.length;
  }
  const keys = Object.keys(stat).sort((a, b) => stat[b] - stat[a]);
  const bodyKey = keys.find(k => !isGlyphF(k)) || keys[0];
  const bodySize = parseFloat(bodyKey.split('@')[1]);
  const bodyFam = bodyKey.split('@')[0].replace(/-.*/, '');
  const famOf = f => f.replace(/-.*/, '');
  const headingStyle = (f, z) => {
    if (isGlyphF(f)) return false;
    if (z >= bodySize * 1.18) return true;
    if (famOf(f) !== bodyFam && isBoldF(f) && z >= bodySize * 1.15) return true;
    return false;
  };
  // heading levels: distinct (size, weight) among heading styles, ordered desc
  const hstyles = [...new Set(keys.filter(k => { const [f, z] = k.split('@'); return headingStyle(f, +z); }))]
    .map(k => { const [f, z] = k.split('@'); return { k, z: +z, w: /Black|Heavy/.test(f) ? 2 : isBoldF(f) ? 1 : 0 }; })
    .sort((a, b) => b.z - a.z || b.w - a.w);
  const sizeLv = {};
  let lv = 0;
  const chapterMin = bodySize * 2.6;
  const distinct = [];
  for (const h of hstyles) { const key = h.z + ':' + h.w; if (!distinct.includes(key)) distinct.push(key); }
  for (const key of distinct) {
    const z = +key.split(':')[0];
    if (z >= chapterMin) sizeLv[key] = 0;
    else { lv = Math.min(6, lv + 1); sizeLv[key] = lv; }
  }
  const levelOf = (f, z) => { const key = z + ':' + (/Black|Heavy/.test(f) ? 2 : isBoldF(f) ? 1 : 0); return sizeLv[key]; };

  // ---------- 3. lines with column-aware reading order ----------
  const lines = [];
  const imgAt = [];
  const keyCount = {};
  for (const pg of pages) for (const im of pg.imgs || []) keyCount[im.key] = (keyCount[im.key] || 0) + 1;
  for (const pg of pages) {
    const mid = pg.w / 2;
    const its = pg.clean.filter(i => i.s.trim() || i.s.length).sort((a, b) => a.y - b.y || a.x - b.x);
    // group by baseline
    const groups = [];
    for (const it of its) {
      const g = groups.length && groups[groups.length - 1];
      const tol = isGlyphF(it.f) || (g && g.items.some(q => isGlyphF(q.f))) ? Math.max(4.6, it.z * 0.55) : Math.max(2.6, it.z * 0.32);
      if (g && Math.abs(it.y - g.y) <= tol) g.items.push(it); else groups.push({ y: it.y, items: [it] });
    }
    const L = [], R = [], seq = [];
    for (const g of groups) {
      g.items.sort((a, b) => a.x - b.x);
      const vis = g.items.filter(i => i.s.trim());
      if (!vis.length) continue;
      const spans = vis.some(i => i.x < mid - 6 && i.x + i.w > mid + 6);
      const left = vis.filter(i => i.x + i.w / 2 < mid), right = vis.filter(i => i.x + i.w / 2 >= mid);
      let full = spans;
      if (!full && left.length && right.length) {
        const le = Math.max(...left.map(i => i.x + i.w)), rs = Math.min(...right.map(i => i.x));
        if (rs - le < Math.max(6, g.items[0].z * 0.9)) full = true;
      }
      if (full) { seq.push({ kind: 'F', y: g.y, items: g.items }); }
      else {
        if (left.length) seq.push({ kind: 'L', y: g.y, items: g.items.filter(i => i.x + Math.max(i.w, 1) / 2 < mid) });
        if (right.length) seq.push({ kind: 'R', y: g.y, items: g.items.filter(i => i.x + Math.max(i.w, 1) / 2 >= mid) });
      }
    }
    for (const im of pg.imgs || []) {
      if (keyCount[im.key] >= 3) continue; // repeated decoration
      const kind = im.x < mid - 6 && im.x + im.w > mid + 6 ? 'F' : im.x + im.w / 2 < mid ? 'L' : 'R';
      seq.push({ kind, y: im.y, img: im });
    }
    seq.sort((a, b) => a.y - b.y);
    // order: segments split by full-width lines
    let segL = [], segR = [];
    const flush = () => { for (const l of segL) pushLine(l); for (const l of segR) pushLine(l); segL = []; segR = []; };
    const colMin = { L: Math.min(...seq.filter(s => s.kind === 'L' && s.items).map(s => s.items.find(i => i.s.trim()).x), 1e9), R: Math.min(...seq.filter(s => s.kind === 'R' && s.items).map(s => s.items.find(i => i.s.trim()).x), 1e9) };
    function pushLine(l) {
      if (l.img) { imgAt.push({ ...l.img, at: lines.length, pg: pg.n }); return; }
      const items = l.items;
      const vis = items.filter(i => i.s.trim());
      const x = vis[0].x;
      const first = vis.find(i => !isGlyphF(i.f)) || vis[0];
      const right = Math.max(...vis.map(i => i.x + i.w));
      lines.push({ pg: pg.n, y: l.y, x, right, col: l.kind, colX: l.kind === 'F' ? Math.min(colMin.L, x) : colMin[l.kind], items, f: first.f, z: first.z, pw: pg.w });
    }
    for (const s of seq) {
      if (s.img) { (s.kind === 'R' ? segR : segL).push(s); continue; }
      if (s.kind === 'F') { flush(); pushLine(s); }
      else if (s.kind === 'L') segL.push(s); else segR.push(s);
    }
    flush();
  }
  // text helpers
  const CHW = /\b([MARIP]) (ight|gility|eason|ntuition|resence)\b/g;
  for (const l of lines) {
    l.text = joinItems(l.items, true).replace(/\s+/g, ' ').trim().replace(CHW, '$1$2');
    l.segs = segments(l.items);
  }
  function joinItems(items, plain) {
    let out = '', prev = null;
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (prev && !/\s$/.test(out) && !/^\s/.test(it.s) && it.x - (prev.x + prev.w) > it.z * 0.18) out += ' ';
      out += plain ? it.s : renderItem(it, items[k + 1]);
      prev = it;
    }
    return out;
  }
  function renderItem(it, next) {
    const t = it.s;
    if (isGlyphF(it.f)) {
      const p = potency(t);
      if (p) {
        // "M" + "ight" style split words
        if (/^[MARIP]$/.test(t.trim()) && next && /^[a-z]/.test(next.s) && next.x - (it.x + it.w) < 2) return t.trim();
        return p;
      }
      const g = t.trim();
      if (g === '¥' || g === '•') return '';
      if (g.length <= 1) return '';
      if (/^[A-Z]\s*<\s*\d/.test(g)) return `<span class="pot">${esc(g.replace(/\s+/g, ''))}</span>`;
      return esc(t);
    }
    let h = esc(t);
    if (isBoldF(it.f) && !/Md$/.test(it.f)) h = `<b>${h}</b>`;
    if (isItalF(it.f)) h = `<i>${h}</i>`;
    return h;
  }
  function segments(items) {
    // split a line into column segments by large gaps
    const segs = []; let cur = null, prevEnd = -1e9;
    for (const it of items) {
      if (!it.s.trim()) { if (cur) cur.items.push(it); continue; }
      if (!cur || it.x - prevEnd > Math.max(it.z * 1.6, 9)) { cur = { x: it.x, items: [] }; segs.push(cur); }
      cur.items.push(it); prevEnd = it.x + it.w;
    }
    for (const s of segs) { s.text = joinItems(s.items, true).trim().replace(/\b([MARIP]) (ight|gility|eason|ntuition|resence)\b/g, '$1$2'); s.html = norm(joinItems(s.items, false)); s.end = Math.max(...s.items.filter(i => i.s.trim()).map(i => i.x + i.w)); }
    return segs;
  }
  function norm(h) {
    return h.replace(/\b([MARIP]) ?(<b>)?(ight|gility|eason|ntuition|resence)\b/g, '$2$1$3').replace(/<\/b>(\s*)<b>/g, '$1').replace(/<\/i>(\s*)<i>/g, '$1').replace(/<b>\s*<\/b>|<i>\s*<\/i>/g, ' ')
      .replace(/(<\/span>)\s+([,;.])/g, '$1$2').replace(/\s+/g, ' ').trim();
  }
  const lineHtml = l => norm(joinItems(l.items, false));
  function join(a, b) {
    a = a.replace(/\s+$/, ''); b = b.replace(/^\s+/, '');
    const ta = a.replace(/(<[^>]*>)+$/, '');
    if (/[a-z]-$/.test(ta) && /^(<[^>]*>)*[a-z]/.test(b)) { const m = a.match(/-((<[^>]*>)*)$/); return a.slice(0, m.index) + m[1] + b; }
    if (/[—–\/]$/.test(ta)) return a + b;
    return a + ' ' + b;
  }
  const firstVis = l => l.items.find(i => i.s.trim());
  const glyphLead = l => { const f = firstVis(l); return f && isGlyphF(f.f) ? f.s.trim() : null; };
  const isBullet = l => { const g = glyphLead(l); return g === '¥' || g === '•' || /^[•●▪]/.test(l.text); };
  const tierGap = l => { const v = l.items.filter(it => it.s.trim()); return v.length >= 2 && v[1].x - v[0].x > Math.max(14, bodySize * 2) && /^[!@#]$/.test(v[0].s.trim()); };
  const isTierLine = l => { const f = firstVis(l); return f && isGlyphF(f.f) && (f.z >= bodySize * 1.3 || tierGap(l)) && TIERCH.has(f.s.trim()) || (f && /^MCDM/.test(f.f) && f.z >= bodySize * 1.5 && /^[áéí]$/.test(f.s.trim())); };
  const lineLevel = l => { const f = firstVis(l); if (!f || isGlyphF(f.f)) return undefined; if (/^([\d\s.STMLsml—–+\-/]|or\b)+$/.test(l.text) || isTierLine(l)) return undefined; if (!headingStyle(f.f, f.z)) return undefined; return levelOf(f.f, f.z); };
  const endsAction = t => { const lt = t.toLowerCase(); return ACTIONS.find(a => lt.endsWith(a)); };

  if (meta.debugLines) meta.debugLines(lines);
  // ---------- 4. blocks ----------
  const blocks = [];
  const monsters = [], abilities = [];
  const usedIds = new Set();
  const uid = (base) => { let id = slug(base), k = 2; while (usedIds.has(id)) id = slug(base) + '-' + k++; usedIds.add(id); return id; };
  let i = 0; const N = lines.length;
  let para = null;
  const flushPara = () => { if (para) { para.html = norm(para.html); if (para.html) blocks.push(para); } para = null; };
  const pgLabel = n => labels[n] || String(n);

  // monster ability (glyph-led) parser; returns [ability, nextIndex]
  function parseMAbility(j) {
    const H = lines[j];
    const g = glyphLead(H);
    const segs = H.segs;
    const vis = H.items.filter(it => it.s.trim());
    const nameItems = []; let k = g ? 1 : 0;
    // name: bold display items after glyph
    let rest = [];
    for (; k < vis.length; k++) { if (!isGlyphF(vis[k].f) && (isBoldF(vis[k].f) || famOf(vis[k].f) !== bodyFam) && !/2d10/.test(vis[k].s)) nameItems.push(vis[k]); else break; }
    rest = vis.slice(k);
    let name = nameItems.map(x => x.s).join(' ').replace(/\s+/g, ' ').trim();
    let roll = '', cost = '';
    const rt = rest.map(x => x.s).join(' ').replace(/\s+/g, ' ').trim();
    const rm = rt.match(/2d10(\s*\+\s*\d+)?/); if (rm) roll = rm[0].replace(/\s+/g, ' ');
    const after = rt.replace(/2d10(\s*\+\s*\d+)?/, '').trim();
    if (after) cost = after;
    // if name absorbed cost at right edge (bold) split by segments
    if (segs.length >= 2 && !cost) { const last = segs[segs.length - 1]; if (last.text !== name && name.endsWith(last.text)) { cost = last.text; name = name.slice(0, -last.text.length).trim(); } }
    if (!name) return [null, j];
    const ab = { name, glyph: g, roll, cost, keywords: [], action: '', distance: '', target: '', rows: [], trait: false };
    let bodyInd = (nameItems.length ? nameItems[0].x : H.x + 10) - H.colX;
    const ind = l => l.x - l.colX;
    let m = j + 1;
    // "flush" layout (Word-made PDFs): body lines start under the glyph, wrapped lines hang slightly left
    const nx0 = lines[j + 1];
    const flush = g && nameItems.length && nx0 && nx0.pg === H.pg && nx0.col === H.col && Math.abs(nx0.x - H.x) < 2.5 && nameItems[0].x - H.x > 5;
    if (flush) bodyInd = ind(H) - 2;
    const onlyG = l => l.items.every(it => !it.s.trim() || isGlyphF(it.f));
    const newAbility = l => { if (!glyphLead(l) || isTierLine(l) || isBullet(l)) return false; const v = l.items.filter(it => it.s.trim()); const n = v.find(it => !isGlyphF(it.f)); const gs = v.filter(it => isGlyphF(it.f) && !potency(it.s)); return !!n && isBoldF(n.f) && gs.length === 1; };
    const nx = lines[m];
    if (nx && nx.pg === H.pg && endsAction(nx.text) && !isTierLine(nx)) {
      const a = endsAction(nx.text);
      ab.action = canonAction(a);
      ab.keywords = nx.text.slice(0, nx.text.length - a.length).replace(/[,\s—–-]+$/, '').split(/,\s*/).filter(s => s && !/^[—–-]$/.test(s));
      m++;
    } else {
      ab.trait = true;
      const kwLike = nx && nx.text.length < 70 && (/^[—–-]$/.test(nx.text) || /^[A-Z][a-z]+(, [A-Z][a-z]+)*$/.test(nx.text));
      const nn = lines[m + 1];
      const distNext = nn && glyphLead(nn) && nn.items.filter(it => isGlyphF(it.f) && it.s.trim() && !potency(it.s)).length >= 2 && !isTierLine(nn);
      if (/Villain Action/i.test(ab.cost)) { ab.action = 'Villain action'; ab.trait = false; }
      if (kwLike && (distNext || /Villain Action/i.test(ab.cost))) { ab.keywords = /^[—–-]$/.test(nx.text) ? [] : nx.text.split(/,\s*/); ab.trait = false; m++; }
      else if (nx && ab.roll && nx.text.length < 60 && !/[.:]/.test(nx.text) && /^[A-Z][a-z]+(, [A-Z][a-z]+)*$/.test(nx.text)) { ab.keywords = nx.text.split(/,\s*/); ab.trait = false; m++; }
    }
    // distance / target
    const dl = lines[m];
    if (dl && !ab.trait) {
      const gl = dl.items.filter(it => isGlyphF(it.f) && it.s.trim() && !potency(it.s));
      if (glyphLead(dl) && gl.length >= 2 && !isTierLine(dl)) {
        let part = null, d = [], t = [];
        for (const it of dl.items) {
          if (it === gl[0]) { part = 'd'; continue; } if (it === gl[1]) { part = 't'; continue; }
          if (part === 'd') d.push(it); else if (part === 't') t.push(it);
        }
        ab.distance = norm(joinItems(d, false)); ab.target = norm(joinItems(t, false)); m++;
      }
    }
    let prev = null, tierN = 0;
    for (; m < N; m++) {
      const M = lines[m];
      if (flush && (onlyG(M) && !isTierLine(M) || newAbility(M) || M.col !== H.col && M.pg === H.pg && ind(M) < bodyInd - 6)) break;
      if (flush && M.pg !== lines[m - 1].pg && newAbility(M)) break;
      if (glyphLead(M) && !isTierLine(M) && !isBullet(M) && ind(M) < bodyInd - 4) break;
      if (abHeadNoGlyph(M)) break;
      if (!isTierLine(M) && lineLevel(M) !== undefined) break;
      if (isMonsterHeader(m)) break;
      if (ind(M) < bodyInd - (flush ? 7 : 4) && !isTierLine(M)) break;
      const html = lineHtml(M);
      if (isTierLine(M)) { tierN = Math.min(3, tierN + 1); const r = { k: 'tier', n: tierN, html }; ab.rows.push(r); prev = r; continue; }
      const gap = prev && M.pg === lines[m - 1].pg && M.col === lines[m - 1].col ? M.y - lines[m - 1].y : 0;
      if (/^(<b>)?[A-Z0-9][^:]{0,40}:/.test(html) && /^<b>/.test(html)) { const r = { k: 'field', html }; ab.rows.push(r); prev = r; continue; }
      if (prev && gap > bodySize * 2.1) { const r = { k: 'field', html }; ab.rows.push(r); prev = r; continue; }
      if (prev) { prev.html = norm(join(prev.html, html)); continue; }
      const r = { k: 'field', html }; ab.rows.push(r); prev = r;
    }
    if (ab.roll) ab.rows.unshift({ k: 'roll', html: 'Power Roll ' + ab.roll });
    return [ab, m];
  }

  const abHeadNoGlyph = l => { const f = firstVis(l); return f && !isGlyphF(f.f) && famOf(f.f) !== bodyFam && isBoldF(f.f) && f.z < bodySize * 1.5 && (/\s2d10(\s*\+\s*\d+)?\b/.test(l.text) && /(Signature Ability|Malice|Villain Action \d|Ability)$/.test(l.text)); };
  function isMonsterHeader(j) {
    const L0 = lines[j]; if (!L0) return false;
    const L1 = lines[j + 1];
    if (L1 && L1.pg === L0.pg && /^(Level|LEVEL)\s+\d+\b/.test(L1.text) && L0.text.length < 50 && !/Level|LEVEL/.test(L0.text) && lines[j + 2] && /\bEV\b/.test(lines[j + 2].text)) { L0.text = L0.text + ' ' + L1.text; L1.text = ''; L1.merged = true; return true; }
    if (!/^(.+?)\s+(Level|LEVEL)\s+\d+\b/.test(L0.text) || L0.text.length > 90) return false;
    const o = lines[j + 1] && lines[j + 1].merged ? 1 : 0;
    const n1 = lines[j + 1 + o], n2 = lines[j + 2 + o];
    return !!((n1 && /\bEV\s*\d+|\bEV\s*—/.test(n1.text)) || (n1 && /Stamina/.test(n1.text)) || (n2 && /Stamina/.test(n2.text + ' ' + ((lines[j + 3] || {}).text || ''))));
  }

  function parseMonster(j) {
    const H = lines[j];
    const mm = H.text.match(/^(.*?)\s+(Level\s+(\d+)\s*(.*))$/i);
    const tc = x => x === x.toUpperCase() && /[A-Z]{2}/.test(x) ? x.toLowerCase().replace(/(^|[\s\-(/])([a-z])/g, (a, b, c) => b + c.toUpperCase()).replace(/\b(Of|The|And|In|On|A|An|To|For)\b/g, (w, _, o) => o ? w.toLowerCase() : w) : x;
    const mon = { name: tc(mm[1].trim()), level: +mm[3], role: tc(mm[4].trim()), keywords: [], ev: '', stats: {}, chars: {}, immunity: '', weakness: '', movement: '', extra: [], items: [], pg: pgLabel(H.pg) };
    const roleWords = mon.role.split(/\s+/);
    mon.org = /Minion|Horde|Platoon|Elite|Leader|Solo|Retainer|Fortification|Swarm|Troop/.test(mon.role) ? (mon.role.match(/Minion|Horde|Platoon|Elite|Leader|Solo|Retainer|Fortification|Swarm|Troop/) || [''])[0] : (roleWords[0] || '');
    let m = j + 1;
    if (lines[m] && lines[m].merged) m++;
    const K = lines[m];
    if (K && /\bEV\b/.test(K.text)) {
      const em = K.text.match(/^(.*?)\s*EV\s*(.+)$/);
      mon.keywords = (em[1] || '').split(/,\s*/).map(s => s.trim()).filter(s => s && s !== '—');
      mon.ev = em[2].trim(); m++;
    }
    const blockX = H.x;
    const onlyGlyph = l => l.items.every(it => !it.s.trim() || isGlyphF(it.f));
    let descN = 0;
    while (m < N) {
      const A = lines[m]; const t = A.text;
      if (isMonsterHeader(m)) break;
      if (lineLevel(A) !== undefined) break;
      if (onlyGlyph(A) && !isTierLine(A)) { m++; continue; }
      if (/^Immunity:|^Weakness:/.test(t)) { const a = t.match(/Immunity:\s*(.*?)(?=\s*Weakness:|$)/); const b = t.match(/Weakness:\s*(.*)$/); if (a) mon.immunity = a[1].trim(); if (b) mon.weakness = b[1].trim(); m++; continue; }
      if (/^Movement:/.test(t)) { mon.movement = t.replace(/^Movement:\s*/, '').replace(/\s*(With )?Captain:.*$/, ''); const c = t.match(/(With Captain|Captain):\s*(.*)$/); if (c) mon.extra.push({ k: c[1], v: c[2] }); m++; continue; }
      if (/^(With Captain|Captain):/.test(t)) { mon.extra.push({ k: t.split(':')[0], v: t.split(':').slice(1).join(':').trim() }); m++; continue; }
      if (/Might\s*[+–−-]?\s*\d/.test(t) && /Presence/.test(t)) {
        for (const c of ['Might', 'Agility', 'Reason', 'Intuition', 'Presence']) { const x = t.match(new RegExp(c + '\\s*([+–−-]?\\s*\\d+)')); if (x) mon.chars[c] = x[1].replace(/\s/g, '').replace('−', '–').replace(/^-/, '–'); }
        m++; continue;
      }
      const Bn = lines[m + 1];
      if (Bn && /Size/.test(Bn.text) && /Stamina/.test(Bn.text) && !/:/.test(Bn.text)) {
        const vals = A.segs.length >= 3 ? A.segs.map(s => s.text) : A.text.split(/\s+/);
        if (vals.every(v => v.length <= 8)) {
          const labs = Bn.text.replace(/Free Strike/, 'Free_Strike').replace(/Stabilty/, 'Stability').split(/\s+/).map(s => s.replace('_', ' '));
          labs.forEach((lab, ix) => mon.stats[lab] = vals[ix] ?? '');
          m += 2; continue;
        }
      }
      // pipe style: "6|Size| 0|Speed| 100|Stamina| All|Stability| 5|Free Strike"
      if (/\|/.test(t) && /Size/.test(t) && /Stamina/.test(t) && !/:/.test(t)) {
        const parts = t.split('|').map(x => x.trim()).filter(Boolean);
        for (let q = 0; q + 1 < parts.length; q += 2) { const lab = parts[q + 1].replace(/Stabilty/, 'Stability'); if (/^(Size|Speed|Stamina|Stability|Free Strike)$/.test(lab)) mon.stats[lab] = parts[q]; }
        m++; continue;
      }
      if (/^(Stamina|Size|Speed|Stability|Free Strike|EV):/.test(t)) {
        const re = /(Stamina|Size|Speed|Stability|Free Strike):\s*([^:]*?)(?=\s+(?:Stamina|Size|Speed|Stability|Free Strike):|$)/g; let x;
        while ((x = re.exec(t))) mon.stats[x[1]] = x[2].trim();
        m++; continue;
      }
      const g = glyphLead(A);
      if ((g && !isBullet(A) && !isTierLine(A)) || abHeadNoGlyph(A)) {
        const [ab, nm] = parseMAbility(m);
        if (!ab) break;
        mon.items.push(ab); m = Math.max(nm, m + 1); continue;
      }
      if (!mon.items.length && descN < 5 && A.x >= blockX - 4) { mon.desc = mon.desc ? join(mon.desc, lineHtml(A)) : lineHtml(A); descN++; m++; continue; }
      if (A.x > A.colX + 6 && mon.items.length) { const last = mon.items[mon.items.length - 1]; const r = last.rows[last.rows.length - 1]; if (r) { r.html = norm(join(r.html, lineHtml(A))); m++; continue; } }
      break;
    }
    return [mon, m];
  }

  function parseHAbility(j) {
    // Heroes-style: heading name, italic flavor, keyword/action line
    const L0 = lines[j];
    let m = j + 1, flavor = '';
    while (m < N && m < j + 6 && lines[m].items.some(it => isItalF(it.f)) && !endsAction(lines[m].text)) { flavor = flavor ? join(flavor, lineHtml(lines[m])) : lineHtml(lines[m]); m++; }
    const K = lines[m];
    if (!K || !endsAction(K.text) || K.text.length > 80) return [null, j];
    const a = endsAction(K.text);
    let name = L0.text, cost = '';
    const cm = name.match(/^(.*?)\s*\(([^)]*\d[^)]*)\)\s*$/); if (cm) { name = cm[1]; cost = cm[2]; }
    const ab = { name, cost, flavor: norm(flavor), keywords: K.text.slice(0, K.text.length - a.length).replace(/[,\s—–-]+$/, '').split(/,\s*/).filter(s => s && !/^[—–-]$/.test(s)), action: canonAction(a), distance: '', target: '', rows: [] };
    m++;
    const dl = lines[m];
    if (dl) {
      const gl = dl.items.filter(it => isGlyphF(it.f) && it.s.trim() && !potency(it.s));
      if (glyphLead(dl) && gl.length >= 2) {
        let part = null, d = [], t = [];
        for (const it of dl.items) { if (it === gl[0]) { part = 'd'; continue; } if (it === gl[1]) { part = 't'; continue; } if (part === 'd') d.push(it); else if (part === 't') t.push(it); }
        ab.distance = norm(joinItems(d, false)); ab.target = norm(joinItems(t, false)); m++;
      }
    }
    const baseI = L0.x - L0.colX; let prev = null, tierN = 0;
    for (; m < N; m++) {
      const M = lines[m];
      if (!isTierLine(M) && lineLevel(M) !== undefined) break;
      if (M.x - M.colX < baseI - 3 && !isTierLine(M)) break;
      if (M.x < M.colX + 6 && !isTierLine(M)) break;
      const html = lineHtml(M);
      if (isTierLine(M)) { tierN = Math.min(3, tierN + 1); const r = { k: 'tier', n: tierN, html }; ab.rows.push(r); prev = r; continue; }
      if (/^Power Roll/.test(M.text)) { const r = { k: 'roll', html: M.text.replace(/:\s*$/, '') }; ab.rows.push(r); prev = r; continue; }
      if (/^<b>[^<:]{1,40}:/.test(html) && M.x - M.colX <= baseI + 4) { const r = { k: 'field', html }; ab.rows.push(r); prev = r; continue; }
      if (prev) { prev.html = norm(join(prev.html, html)); continue; }
      const r = { k: 'field', html }; ab.rows.push(r); prev = r;
    }
    return [ab, m];
  }

  // tables
  function isTableHeader(l) {
    if (l.segs.length < 2) return false;
    if (l.segs.filter(s => /^[A-Z][\w’' ]{1,30}:\s*\S/.test(s.text)).length >= 2) return false; // label: value pairs, not a header
    if (lineLevel(l) !== undefined && l.z > bodySize * 1.3) return false;
    return l.segs.every(s => s.items.filter(i => i.s.trim()).every(i => isBoldF(i.f) || famOf(i.f) !== bodyFam)) && l.text.length < 140 && !endsAction(l.text) && !/\bLevel\s+\d+/.test(l.text) && !glyphLead(l);
  }
  function parseTable(j) {
    const H = lines[j];
    let head = H.segs.map(s => ({ x: s.x, text: s.text }));
    let m = j + 1;
    // stacked header lines
    while (m < N && isTableHeader(lines[m]) && lines[m].pg === H.pg && lines[m].y - lines[m - 1].y < H.z * 1.6) {
      for (const s of lines[m].segs) { const h = head.find(c => Math.abs(c.x - s.x) < 10); if (h) h.text += ' ' + s.text; else head.push({ x: s.x, text: s.text }); }
      m++;
    }
    head.sort((a, b) => a.x - b.x);
    const cols = head.map(h => h.x);
    const colOf = x => { let k = 0; cols.forEach((c, ci) => { if (x >= c - 8) k = ci; }); return k; };
    const segsAll = [];
    let lastY = lines[m - 1].y, lastPg = H.pg;
    const tx = cols[0];
    for (; m < N; m++) {
      const L = lines[m];
      if (L.pg !== lastPg || L.col !== H.col) break;
      if (lineLevel(L) !== undefined && L.z > bodySize * 1.05) break;
      if (isTableHeader(L) && L.segs.length === head.length && L.y - lastY > L.z * 1.5) break;
      if (L.x < tx - 8) break;
      if (L.y - lastY > Math.max(L.z, bodySize) * 2.6) break;
      if (isMonsterHeader(m)) break;
      for (const s of L.segs) segsAll.push({ y: L.y, c: colOf(s.x), html: s.html, text: s.text });
      lastY = L.y;
    }
    // rows anchored on column-0 cells
    let anchors = segsAll.filter(s => s.c === 0);
    const lh = bodySize * 1.35;
    const merged = [];
    for (const a of anchors) { const p = merged[merged.length - 1]; if (p && a.y - p.y2 < lh * 1.25 && /^[a-z(]/.test(a.text)) { p.html = join(p.html, a.html); p.y2 = a.y; } else merged.push({ y: a.y, y2: a.y, html: a.html }); }
    let rows;
    if (merged.length && segsAll.some(s => s.c > 0)) {
      rows = merged.map(a => ({ y: (a.y + a.y2) / 2, cells: [a.html] }));
      const bounds = rows.map((r, ri) => ri + 1 < rows.length ? (r.y + rows[ri + 1].y) / 2 : 1e9);
      // cells in other columns: assign by vertical band; for multi-line cells keep order
      for (const s of segsAll) {
        if (s.c === 0) continue;
        let ri = bounds.findIndex(b => s.y < b); if (ri < 0) ri = rows.length - 1;
        // a cell above first anchor belongs to first row
        const r = rows[ri]; r.cells[s.c] = r.cells[s.c] ? join(r.cells[s.c], s.html) : s.html;
      }
      // if the first column cell is vertically centred, earlier text belongs to it — band split already handles
    } else {
      rows = []; let cur = null, cy = null;
      for (const s of segsAll) { if (!cur || s.y !== cy) { cur = { cells: [] }; rows.push(cur); cy = s.y; } cur.cells[s.c] = s.html; }
    }
    const out = rows.map(r => Array.from({ length: head.length }, (_, k) => norm(r.cells[k] || '')));
    return [{ t: 'table', head: head.map(h => h.text), rows: out.filter(r => r.some(Boolean)), pg: pgLabel(H.pg) }, m];
  }

  let cur0 = 0;
  const _bpush = blocks.push.bind(blocks);
  blocks.push = (...bs) => { for (const b of bs) if (b.__at == null) b.__at = cur0; return _bpush(...bs); };
  while (i < N) {
    const L = lines[i];
    cur0 = i;
    if (!L.text) { i++; continue; }
    // monster stat block
    if (isMonsterHeader(i)) {
      flushPara();
      const [mon, nm] = parseMonster(i);
      mon.id = uid(mon.name);
      monsters.push(mon);
      blocks.push({ t: 'monster', ref: mon.id, pg: mon.pg });
      i = Math.max(nm, i + 1); continue;
    }
    // glyph-led monster-style ability outside a stat block (malice features, terrain, etc.)
    const gl = glyphLead(L);
    if (gl && !isBullet(L) && !isTierLine(L) && gl.length === 1 && L.items.filter(it => it.s.trim()).length >= 2) {
      const nxt = L.items.filter(it => it.s.trim())[1];
      if (nxt && (isBoldF(nxt.f) || famOf(nxt.f) !== bodyFam)) {
        const [ab, nm] = parseMAbility(i);
        if (ab && (ab.rows.length || ab.action)) {
          flushPara();
          ab.id = uid(ab.name); ab.pg = pgLabel(L.pg);
          abilities.push(ab); blocks.push({ t: 'ability', ref: ab.id, pg: ab.pg }); i = nm; continue;
        }
      }
    }
    if (abHeadNoGlyph(L)) {
      const [ab, nm] = parseMAbility(i);
      if (ab && (ab.rows.length || ab.action)) { flushPara(); ab.id = uid(ab.name); ab.pg = pgLabel(L.pg); abilities.push(ab); blocks.push({ t: 'ability', ref: ab.id, pg: ab.pg }); i = nm; continue; }
    }
    const lvl = lineLevel(L);
    if (lvl !== undefined) {
      // heroes-style ability?
      if (lvl >= 3) {
        const [ab, nm] = parseHAbility(i);
        if (ab) { flushPara(); ab.id = uid(ab.name); ab.pg = pgLabel(L.pg); abilities.push(ab); blocks.push({ t: 'ability', ref: ab.id, pg: ab.pg }); i = nm; continue; }
      }
      flushPara();
      let text = L.text, j = i + 1;
      while (j < N && lines[j].f === L.f && lines[j].z === L.z && lines[j].pg === L.pg && lines[j].y - lines[j - 1].y < L.z * 1.5 && lines[j].y > lines[j - 1].y) { text += ' ' + lines[j].text; j++; }
      if (text.trim().length === 1 && j < N) { lines[j].dropcap = text.trim(); i = j; continue; }
      blocks.push({ t: 'h', lvl, text: text.replace(/\s+/g, ' ').trim(), pg: pgLabel(L.pg) });
      i = j; continue;
    }
    if (isTableHeader(L)) {
      const [tb, nm] = parseTable(i);
      if (tb.rows.length) { flushPara(); blocks.push(tb); i = nm; continue; }
    }
    if (isTierLine(L)) {
      flushPara();
      const prevB = blocks[blocks.length - 1];
      const n = prevB && prevB.t === 'tier' ? Math.min(3, prevB.n + 1) : 1;
      const tb = { t: 'tier', n, html: lineHtml(L), pg: pgLabel(L.pg) };
      let j = i + 1;
      while (j < N && !isTierLine(lines[j]) && lineLevel(lines[j]) === undefined && !glyphLead(lines[j]) && lines[j].pg === L.pg && lines[j].y - lines[j - 1].y < Math.max(L.z, bodySize) * 1.7 && lines[j].y > lines[j - 1].y && lines[j].x >= L.x - 1 && lines[j].col === L.col && !/^<b>[^<:]{1,45}:/.test(lineHtml(lines[j])) && !isBullet(lines[j])) { tb.html = norm(join(tb.html, lineHtml(lines[j]))); j++; }
      blocks.push(tb); i = j; continue;
    }
    // paragraph text
    const bullet = isBullet(L);
    let html = lineHtml(L);
    if (L.dropcap) html = L.dropcap + html.replace(/^\s+/, '');
    const small = L.z < bodySize * 0.92;
    const style = small ? 'small' : 'body';
    const startsLabel = /^<b>[^<:]{1,45}:/.test(html);
    let isNew = !para || bullet || para.style !== style || startsLabel;
    if (!isNew) {
      const P = lines[i - 1];
      if (P.pg === L.pg && P.col === L.col && L.y > P.y) {
        const gap = L.y - P.y;
        if (gap > L.z * 1.95) isNew = true;
        else if (L.x - P.x > L.z * 0.8 && para.t !== 'li' && !(para.lab && L.x - para.x0 < L.z * 2.4)) isNew = true;
      } else {
        if (L.x - L.colX > L.z * 0.8 && para.t !== 'li' && !para.lab) isNew = true;
      }
      if (para.t === 'li' && L.x < para.x0 - 3) isNew = true;
    }
    if (isNew) {
      flushPara();
      let x0 = L.x;
      if (bullet) { const t = L.items.filter(it => it.s.trim() && !isGlyphF(it.f)); if (t.length) x0 = t[0].x; }
      para = { t: bullet ? 'li' : 'p', style, html: html.replace(/^[•●▪]\s*/, ''), pg: pgLabel(L.pg), x0, lab: startsLabel, __at: i };
    } else para.html = join(para.html, html);
    i++;
  }
  flushPara();
  blocks.push = _bpush;
  // ---------- 4b. images, at their place in reading order ----------
  const images = [], imgIdx = new Map();
  for (const im of imgAt.sort((a, b) => a.at - b.at)) {
    let ix = imgIdx.get(im.ref);
    if (ix === undefined) { ix = images.length; images.push(im.ref); imgIdx.set(im.ref, ix); }
    let pos = blocks.findIndex(b => b.__at >= im.at);
    if (pos < 0) pos = blocks.length;
    blocks.splice(pos, 0, { t: 'img', i: ix, w: Math.round(im.w), h: Math.round(im.h), pg: pgLabel(im.pg), __at: im.at - 0.5 });
  }
  for (let k = 1; k < blocks.length; k++) {
    const b = blocks[k]; if (b.t !== 'monster') continue;
    const mo = monsters.find(x => x.id === b.ref);
    for (let q = k - 1; q >= 0 && q >= k - 3; q--) { const pb = blocks[q]; if (pb.t === 'img') { if (mo && mo.img == null) mo.img = pb.i; break; } if (pb.t === 'monster' || pb.t === 'p' || pb.t === 'li') break; }
  }
  for (const b of blocks) { delete b.x0; delete b.lab; delete b.__at; }

  // ---------- 5. chapters & ids ----------
  const chapters = [];
  let cur = null;
  const hid = new Set();
  // very long chapter-size text is an intro paragraph, not a title
  for (const b of blocks) if (b.t === 'h' && b.lvl === 0 && (b.text.split(/\s+/).length > 6 || /^[a-z]\s/.test(b.text))) { b.t = 'p'; b.style = 'body'; b.html = '<b>' + esc(b.text) + '</b>'; delete b.lvl; delete b.text; }
  let part = null;
  for (const b of blocks) {
    if (b.t === 'h' && b.lvl === 0 && /^[a-z]/.test(b.text) && b.text.split(/\s+/).length <= 3) { part = titleCase(b.text.replace(/^./, c => c.toUpperCase())); b.part = part; }
    if (b.t === 'h' && b.lvl === 0) { cur = { id: slug(b.text), title: titleCase(b.part ? b.part : b.text), blocks: [], part: b.part ? null : part, isPart: !!b.part }; let k = 2; while (chapters.some(c => c.id === cur.id)) cur.id = slug(b.text) + '-' + k++; chapters.push(cur); continue; }
    if (!cur) { cur = { id: 'front', title: meta.title || 'Front Matter', blocks: [] }; chapters.push(cur); }
    if (b.t === 'h') { let id = slug(b.text), k = 2; while (hid.has(cur.id + '/' + id)) id = slug(b.text) + '-' + k++; hid.add(cur.id + '/' + id); b.id = id; }
    cur.blocks.push(b);
  }
  // context: group heading for monsters/abilities
  const bestiary = meta.kind === 'bestiary' || monsters.length >= 40;
  for (const c of chapters) {
    let path = [];
    for (const b of c.blocks) {
      if (b.t === 'h') { path = path.filter(p => p.lvl < b.lvl); path.push(b); }
      const ctx = path.length ? path[0].text : '';
      const near = path.length ? path[path.length - 1].text : '';
      if (b.t === 'monster') { const mo = monsters.find(x => x.id === b.ref); mo.ch = c.id; const okH = p => p.lvl <= 2 && p.text.split(/\s+/).length <= 5 && !/[!?.,“”"]/.test(p.text); mo.group = titleCase(bestiary && c.id !== 'front' ? c.title : (path.find(okH)?.text || c.title)); }
      if (b.t === 'ability') { const ab = abilities.find(x => x.id === b.ref); ab.ch = c.id; ab.source = titleCase(near || ctx || c.title); }
    }
  }
  return { id: packId, title: meta.title || packId, kind: meta.kind || 'book', chapters, monsters, abilities, images, stats: { pages: pages.length, body: bodyKey, images: images.length } };
}

function titleCase(s) {
  if (!s) return s;
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) return s.toLowerCase().replace(/(^|[\s:(\-–—/])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Of|The|And|A|An|In|On|To|For|At|By)\b/g, (w, x, off) => off ? w.toLowerCase() : w);
  return s;
}
