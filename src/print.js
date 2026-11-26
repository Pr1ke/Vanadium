
// ================= PRINTING: shared PDF writer, montage & negotiation sheets, markdown =================
// ---------- pdf-lib, WinAnsi text and file delivery (moved from enc.js: used by every PDF) ----------
let PDFLib = null;
async function loadPdfLib() { if (!PDFLib) PDFLib = await import('./lib/pdf-lib.esm.min.js'); return PDFLib; }
const WINANSI_OK = /[ -~ -ÿ’‘“”–—•…×€™]/;
async function deliverFile(filename, blob) {
  let dl = null;
  try { dl = window.claude && window.claude.use ? await Promise.race([window.claude.use('downloads'), new Promise(r => setTimeout(() => r(null), 4000))]) : null; } catch (e) { dl = null; }
  if (dl) {
    try { const r = await dl.save({ filename, data: blob }); toast(r.status === 'delivered' ? 'Sent' : 'PDF saved'); return; }
    catch (e) { if (e && e.code === 'declined') { toast('Download cancelled'); return; } if (e && e.code === 'rate_limited') { toast('A save prompt is already open'); return; } }
  }
  // outside claude.ai: plain browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('PDF ready');
  window.__lastPdf = blob;
}

const PSAN = s => [...String(s ?? '').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/−/g, '-').replace(/[   ]/g, ' ').replace(/[★☆]/g, '*').replace(/[✓✔]/g, 'v')].map(c => WINANSI_OK.test(c) ? c : (c === '\n' ? ' ' : '?')).join('');
const decEnt = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
async function makeWriter(title, o = {}) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = o.doc || await PDFDocument.create();
  if (!o.doc) { doc.setTitle(PSAN(title)); doc.setCreator('Vanadium'); }
  const w = { doc, rgb, title, W: 595.28, H: 841.89, MG: 36, page: null, y: 0, pages: 0, footer: o.footer !== false };
  w.CW = w.W - 2 * w.MG;
  w.F = await doc.embedFont(StandardFonts.Helvetica); w.FB = await doc.embedFont(StandardFonts.HelveticaBold);
  w.FI = await doc.embedFont(StandardFonts.HelveticaOblique); w.FBI = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  w.TI = await doc.embedFont(StandardFonts.TimesRomanItalic);
  w.TR = await doc.embedFont(StandardFonts.TimesRoman); w.TB = await doc.embedFont(StandardFonts.TimesRomanBold); w.TBI = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  w.ink = rgb(0.1, 0.1, 0.1); w.grey = rgb(0.45, 0.45, 0.45); w.light = rgb(0.92, 0.92, 0.92); w.dark = rgb(0.17, 0.16, 0.15); w.cream = rgb(0.97, 0.95, 0.92); w.accent = rgb(0.85, 0.42, 0.2);
  w.tw = (s, size, font = w.F) => font.widthOfTextAtSize(PSAN(s), size);
  w.T = (s, x, y, size = 9, font = w.F, color = w.ink) => w.page.drawText(PSAN(s), { x, y, size, font, color });
  w.newPage = () => { w.page = doc.addPage([w.W, w.H]); w.y = w.H - w.MG; w.pages++; if (w.footer) w.T(`${w.title} · Vanadium · ${SYS.pdfNotice}`, w.MG, 18, 6.5, w.F, w.grey); };
  w.ensure = h => { if (!w.page || w.y - h < w.MG + 14) w.newPage(); };
  w.box = (x, y, bw, bh, o = {}) => w.page.drawRectangle({ x, y, width: bw, height: bh, borderColor: o.border || w.ink, borderWidth: o.bw ?? 0.7, ...(o.fill ? { color: o.fill } : {}) });
  w.fill = (x, y, bw, bh, color) => w.page.drawRectangle({ x, y, width: bw, height: bh, color });
  w.cb = (x, y, s = 8, filled) => w.page.drawRectangle({ x, y, width: s, height: s, borderColor: w.ink, borderWidth: 0.7, ...(filled ? { color: w.ink } : {}) });
  w.circ = (x, y, r, o = {}) => w.page.drawCircle({ x, y, size: r, borderColor: o.border || w.ink, borderWidth: o.bw ?? 0.8, ...(o.fill ? { color: o.fill } : {}) });
  w.line = (x1, y1, x2, y2, t = 0.5, color = w.grey) => w.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color });
  // html (b/i/strong/em/code/a) -> tokens
  w.tokens = (html, base = {}) => {
    const out = []; let b = base.b ? 1 : 0, i = base.i ? 1 : 0, space = false;
    const re = /<(\/?)(b|i|strong|em)\b[^>]*>|<br\s*\/?>|<[^>]+>|([^<]+)/g; let m;
    while ((m = re.exec(String(html || '')))) {
      if (m[2]) { const d = m[1] ? -1 : 1; if (m[2] === 'b' || m[2] === 'strong') b = Math.max(0, b + d); else i = Math.max(0, i + d); continue; }
      if (/^<br/i.test(m[0])) { out.push({ br: true }); space = false; continue; }
      if (!m[3]) continue;
      for (const part of decEnt(m[3]).split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { space = true; continue; }
        const FS = base.times ? { r: w.TR, b: w.TB, i: w.TI, bi: w.TBI } : { r: w.F, b: w.FB, i: base.serif ? w.TI : w.FI, bi: w.FBI };
        out.push({ t: part, f: b && i ? FS.bi : b ? FS.b : i ? FS.i : FS.r, sp: space && out.length > 0 }); space = false;
      }
    }
    return out;
  };
  w.layout = (html, o = {}) => {
    const size = o.size || 9.5, width = o.width || w.CW; const toks = w.tokens(html, o);
    const lines = []; let cur = [], cw = 0;
    for (const t of toks) {
      if (t.br) { lines.push(cur); cur = []; cw = 0; continue; }
      const tw = t.f.widthOfTextAtSize(PSAN(t.t), size), sw = t.sp && cur.length ? w.F.widthOfTextAtSize(' ', size) : 0;
      if (cw + sw + tw > width && cur.length) { lines.push(cur); cur = [{ ...t, sp: false, w: tw }]; cw = tw; }
      else { cur.push({ ...t, sp: !!(t.sp && cur.length), w: tw }); cw += sw + tw; }
    }
    if (cur.length) lines.push(cur);
    return lines;
  };
  w.flow = (html, o = {}) => { // draws wrapped text at w.y with page breaks; returns lines drawn
    const size = o.size || 9.5, lead = size * (o.lead || 1.35), x0 = o.x ?? w.MG; const lines = w.layout(html, o);
    for (const ln of lines) {
      w.ensure(lead + 2);
      let x = x0; const yy = w.y - size;
      for (const t of ln) { if (t.sp) x += w.F.widthOfTextAtSize(' ', size); w.page.drawText(PSAN(t.t), { x, y: yy, size, font: t.f, color: o.color || w.ink }); x += t.w; }
      w.y -= lead;
    }
    return lines.length;
  };
  w.height = (html, o = {}) => w.layout(html, o).length * (o.size || 9.5) * (o.lead || 1.35);
  w.header = (title, sub, right) => {
    w.ensure(70); const top = w.y + w.MG - 2;
    w.fill(0, top - 60, w.W, 60, w.dark);
    let ts = 20; while (w.tw(title, ts, w.FB) > w.CW - (right ? w.tw(right, 10, w.FB) + 20 : 0) && ts > 11) ts -= 1;
    w.T(title, w.MG, top - 32, ts, w.FB, w.rgb(1, 1, 1));
    if (sub) w.T(sub, w.MG, top - 48, 8.5, w.F, w.rgb(0.85, 0.85, 0.85));
    if (right) w.T(right, w.W - w.MG - w.tw(right, 10, w.FB), top - 32, 10, w.FB, w.rgb(0.95, 0.6, 0.35));
    w.y = top - 76;
  };
  w.h = (text, lvl = 2, note) => {
    const size = lvl <= 1 ? 15 : lvl === 2 ? 12 : lvl === 3 ? 10.5 : 9.5;
    w.ensure(size + 26); w.y -= lvl <= 2 ? 6 : 3;
    w.T(lvl <= 2 ? String(text).toUpperCase() : text, w.MG, w.y - size, size, w.FB, lvl <= 2 ? w.ink : w.ink);
    if (note) w.T(note, w.MG + w.tw(lvl <= 2 ? String(text).toUpperCase() : text, size, w.FB) + 8, w.y - size, 7.5, w.F, w.grey);
    w.y -= size + (lvl <= 2 ? 4 : 3);
    if (lvl <= 2) { w.line(w.MG, w.y, w.MG + w.CW, w.y, 0.8, w.accent); w.y -= 6; }
  };
  w.para = (html, o = {}) => { w.flow(html, o); w.y -= o.after ?? 4; };
  w.quote = (html) => { const h = w.height(html, { size: 10, width: w.CW - 16, serif: true, i: true }) + 8; w.ensure(Math.min(h, 120)); const top = w.y; w.y -= 4; w.flow(html, { size: 10, width: w.CW - 16, x: w.MG + 12, i: true, serif: true }); const bot = w.y - 2; if (top - bot < 600) { w.fill(w.MG, bot, 3, top - bot, w.rgb(0.79, 0.64, 0.29)); } w.y -= 6; };
  w.bullet = (html, o = {}) => { const ind = o.indent || 0, mark = o.mark || '•'; w.ensure(14); w.T(mark, w.MG + ind + 2, w.y - (o.size || 9.5), o.size || 9.5, w.FB); w.flow(html, { size: o.size || 9.5, width: w.CW - ind - 14, x: w.MG + ind + 14 }); w.y -= 2; };
  w.checkItem = (html, checked, o = {}) => { w.ensure(14); w.cb(w.MG + 2, w.y - 9, 8, checked); w.flow(html, { size: o.size || 9.5, width: w.CW - 16, x: w.MG + 16 }); w.y -= 3; };
  w.writeLines = (n, gap = 18, x = w.MG, width = w.CW) => { for (let k = 0; k < n; k++) { w.ensure(gap); w.y -= gap; w.line(x, w.y, x + width, w.y, 0.4, w.rgb(0.78, 0.78, 0.78)); } w.y -= 4; };
  w.table = (head, rows, widths, o = {}) => {
    const size = o.size || 8.5, pad = 4; const tot = widths.reduce((a, b) => a + b, 0); const ws = widths.map(x => x / tot * w.CW);
    const rowH = r => Math.max(...r.map((c, k) => w.height(c, { size, width: ws[k] - 2 * pad }))) + 2 * pad;
    const drawRow = (r, hdr) => { const h = Math.max(o.minH || 0, rowH(r)); w.ensure(h); let x = w.MG; r.forEach((c, k) => { w.box(x, w.y - h, ws[k], h, { bw: 0.5, border: w.grey, ...(hdr ? { fill: w.light } : {}) }); const sy = w.y; w.y -= pad - 1; w.flow(hdr ? `<b>${c}</b>` : c, { size, width: ws[k] - 2 * pad, x: x + pad }); w.y = sy; x += ws[k]; }); w.y -= h; };
    if (head) drawRow(head, true);
    for (const r of rows) drawRow(r);
    w.y -= 8;
  };
  w.bytes = () => doc.save();
  return w;
}
async function mergePdfs(parts, title) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create(); out.setTitle(PSAN(title)); out.setCreator('Vanadium');
  for (const bytes of parts) { const src = await PDFDocument.load(bytes); const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach(p => out.addPage(p)); }
  return out.save();
}
const pdfFileName = (s, suffix) => (s || 'vanadium').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + (suffix ? '-' + suffix : '') + '.pdf';
async function runPdfJob(btn, label, fn) {
  const old = btn ? btn.innerHTML : ''; if (btn) { btn.disabled = true; btn.textContent = 'Building PDF…'; }
  try { await fn(); } catch (e) { console.error(e); toast('PDF export failed: ' + esc(e.message || e)); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = old || label; } }
}

// ---------- markdown ----------
function mdInline(s) {
  let t = esc(s);
  const codes = []; t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<b>$1</b>').replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<i>$2</i>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, u) => /^(https?:|#|mailto:)/.test(u) ? `<a href="${u}"${/^#/.test(u) ? '' : ' target="_blank" rel="noopener"'}>${a}</a>` : a);
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return t;
}
function mdBlocks(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n'); const B = []; let para = null, quote = null;
  const flush = () => { if (para) { B.push({ t: 'p', html: mdInline(para.join(' ')) }); para = null; } if (quote) { B.push({ t: 'quote', html: mdInline(quote.join(' ')) }); quote = null; } };
  for (let i = 0; i < L.length; i++) {
    const ln = L[i]; let m;
    if (/^```/.test(ln)) { flush(); const code = []; for (i++; i < L.length && !/^```/.test(L[i]); i++) code.push(L[i]); B.push({ t: 'code', text: code.join('\n') }); continue; }
    if (!ln.trim()) { flush(); continue; }
    if (/^\s*[-*+]\s*$/.test(ln)) { flush(); B.push({ t: 'li', html: '', ind: 0 }); continue; }
    if (/^\s*\d+[.)]\s*$/.test(ln)) { flush(); B.push({ t: 'ol', n: parseInt(ln), html: '', ind: 0 }); continue; }
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { flush(); B.push({ t: 'h', lvl: m[1].length, html: mdInline(m[2]), text: m[2] }); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) { flush(); B.push({ t: 'hr' }); continue; }
    if ((m = ln.match(/^>\s?(.*)$/))) { if (para) flush(); (quote = quote || []).push(m[1]); continue; }
    if ((m = ln.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/))) { flush(); B.push({ t: 'check', done: m[2] !== ' ', html: mdInline(m[3]), ind: m[1].length >= 2 ? 1 : 0 }); continue; }
    if ((m = ln.match(/^(\s*)[-*+]\s+(.*)$/))) { flush(); B.push({ t: 'li', html: mdInline(m[2]), ind: m[1].length >= 2 ? 1 : 0 }); continue; }
    if ((m = ln.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) { flush(); B.push({ t: 'ol', n: +m[2], html: mdInline(m[3]), ind: m[1].length >= 2 ? 1 : 0 }); continue; }
    if (/^\s*\|/.test(ln)) { flush(); const rows = []; for (; i < L.length && /^\s*\|/.test(L[i]); i++) { if (/^\s*\|?\s*:?-{2,}/.test(L[i])) continue; rows.push(L[i].trim().replace(/^\||\|$/g, '').split('|').map(c => mdInline(c.trim()))); } i--; B.push({ t: 'table', head: rows[0] || [], rows: rows.slice(1) }); continue; }
    if (quote) flush();
    (para = para || []).push(ln.trim());
  }
  flush();
  return B;
}
function mdHtml(src) {
  const B = mdBlocks(src); let h = '', list = null;
  const close = () => { if (list) { h += `</${list}>`; list = null; } };
  for (const b of B) {
    const lt = b.t === 'li' || b.t === 'check' ? 'ul' : b.t === 'ol' ? 'ol' : null;
    if (lt !== list) { close(); if (lt) { h += `<${lt}>`; list = lt; } }
    if (b.t === 'h') h += `<h${Math.min(6, b.lvl + 1)}>${b.html}</h${Math.min(6, b.lvl + 1)}>`;
    else if (b.t === 'p') h += `<p>${b.html}</p>`;
    else if (b.t === 'quote') h += `<blockquote class="mdq">${b.html}</blockquote>`;
    else if (b.t === 'li' || b.t === 'ol') h += `<li${b.ind ? ' class="ind"' : ''}>${b.html}</li>`;
    else if (b.t === 'check') h += `<li class="chk${b.ind ? ' ind' : ''}"><span class="cbx ${b.done ? 'on' : ''}"></span>${b.html}</li>`;
    else if (b.t === 'hr') h += '<hr>';
    else if (b.t === 'code') h += `<pre>${esc(b.text)}</pre>`;
    else if (b.t === 'table') h += `<div class="tblw"><table class="dt"><thead><tr>${b.head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  close();
  return h;
}
async function buildMarkdownPdf(title, src, sub) {
  const w = await makeWriter(title);
  w.newPage(); w.header(title, sub || 'Session notes');
  for (const b of mdBlocks(src)) {
    if (b.t === 'h') w.h(strip(b.html), Math.max(1, b.lvl));
    else if (b.t === 'p') w.para(b.html, { size: 10 });
    else if (b.t === 'quote') w.quote(b.html);
    else if (b.t === 'li') w.bullet(b.html, { indent: b.ind * 14, size: 10 });
    else if (b.t === 'ol') w.bullet(b.html, { indent: b.ind * 14, mark: b.n + '.', size: 10 });
    else if (b.t === 'check') { w.ensure(14); w.cb(w.MG + 2 + b.ind * 14, w.y - 9.5, 8.5, b.done); w.flow(b.html, { size: 10, width: w.CW - 18 - b.ind * 14, x: w.MG + 16 + b.ind * 14 }); w.y -= 3; }
    else if (b.t === 'hr') { w.ensure(14); w.y -= 6; w.line(w.MG, w.y, w.MG + w.CW, w.y, 0.6); w.y -= 8; }
    else if (b.t === 'code') { b.text.split('\n').forEach(l => w.para(esc(l) || ' ', { size: 8.5, after: 0 })); w.y -= 4; }
    else if (b.t === 'table') w.table(b.head, b.rows, b.head.map(() => 1), { size: 8.5 });
  }
  return w.bytes();
}
