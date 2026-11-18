    // ---- stat block reference (card style) ----
    const seen = []; for (const g of live) for (const e of g.entries) if (MON[e.gid] && !seen.includes(e.gid)) seen.push(e.gid);
    const TR = await doc.embedFont(StandardFonts.TimesRoman), TB = await doc.embedFont(StandardFonts.TimesRomanBold), TI = await doc.embedFont(StandardFonts.TimesRomanItalic), TBI = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
    const black = rgb(0.08, 0.07, 0.07), rule = rgb(0.55, 0.55, 0.55), red = rgb(0.71, 0.13, 0.16);
    const san = s => [...String(s).replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/−/g, '-').replace(/ /g, ' ')].map(c => WINANSI_OK.test(c) ? c : '?').join('');
    const dec = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    // html -> runs [{t, b, i, chip}]
    const runsOf = (html) => {
      const out = []; let b = 0, i = 0;
      const re = /<span class="(pot|chr)">(.*?)<\/span>|<(\/?)(b|i|strong|em)>|<[^>]+>|([^<]+)/g; let m;
      while ((m = re.exec(html || ''))) {
        if (m[1]) out.push({ t: dec(m[2]).replace(/\s+/g, ''), chip: m[1] });
        else if (m[4]) { const on = m[3] ? -1 : 1; if (m[4] === 'b' || m[4] === 'strong') b = Math.max(0, b + on); else i = Math.max(0, i + on); }
        else if (m[5]) out.push({ t: dec(m[5]), b: b > 0, i: i > 0 });
      }
      return out;
    };
    const fontOf = r => r.b && r.i ? TBI : r.b ? TB : r.i ? TI : TR;
    const chipW = (t, sz) => FB.widthOfTextAtSize(san(t), sz * 0.78) + 4;
    // wrap runs into lines of atoms
    const wrapRuns = (runs, width, sz) => {
      const atoms = [];
      for (const r of runs) {
        if (r.chip) { atoms.push({ ...r, w: chipW(r.t, sz), sp: 0 }); continue; }
        const parts = san(r.t).split(/(\s+)/);
        for (const p of parts) { if (!p) continue; if (/^\s+$/.test(p)) { if (atoms.length) atoms[atoms.length - 1].sp = 1; continue; } atoms.push({ ...r, t: p, w: fontOf(r).widthOfTextAtSize(p, sz), sp: 0 }); }
      }
      const lines = []; let cur = [], w = 0; const spw = TR.widthOfTextAtSize(' ', sz);
      for (const a of atoms) {
        const add = (cur.length && cur[cur.length - 1].sp ? spw : 0) + a.w;
        if (cur.length && w + add > width) { lines.push(cur); cur = [a]; w = a.w; } else { cur.push(a); w += add; }
      }
      if (cur.length) lines.push(cur);
      return lines;
    };
    const drawLine = (atoms, x, yy, sz, color = black) => {
      let cx = x; const spw = TR.widthOfTextAtSize(' ', sz);
      atoms.forEach((a, k) => {
        if (a.chip === 'pot') { page.drawRectangle({ x: cx, y: yy - sz * 0.2, width: a.w, height: sz * 0.98, color: black }); page.drawText(san(a.t), { x: cx + 2, y: yy + sz * 0.02, size: sz * 0.78, font: FB, color: rgb(1, 1, 1) }); }
        else if (a.chip === 'chr') { page.drawRectangle({ x: cx, y: yy - sz * 0.2, width: a.w, height: sz * 0.98, borderColor: black, borderWidth: 0.6 }); page.drawText(san(a.t), { x: cx + 2, y: yy + sz * 0.02, size: sz * 0.78, font: FB, color: black }); }
        else page.drawText(a.t, { x: cx, y: yy, size: sz, font: fontOf(a), color });
        cx += a.w + (a.sp ? spw : 0);
      });
    };
    // icons (drawn in a 9x9 box with top-left at x,yTop)
    const icon = (kind, x, yTop, s = 9) => {
      const o = { x, y: yTop, scale: s / 24 };
      if (kind === 'trig') { page.drawRectangle({ x, y: yTop - s, width: s, height: s, color: black }); page.drawText('!', { x: x + s * 0.36, y: yTop - s * 0.86, size: s * 0.9, font: FB, color: rgb(1, 1, 1) }); return; }
      if (kind === 'trait' || kind === 'vil') { page.drawSvgPath('M12 2l3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z', { ...o, color: kind === 'vil' ? red : black }); return; }
      if (kind === 'area') { page.drawSvgPath('M12 3a9 9 0 1 0 0.01 0z', { ...o, borderColor: black, borderWidth: 2.2 }); page.drawSvgPath('M12 8a4 4 0 1 0 0.01 0z', { ...o, color: black }); return; }
      if (kind === 'ranged') { page.drawSvgPath('M4 20 L20 4 M13 4 H20 V11', { ...o, borderColor: black, borderWidth: 2.4 }); page.drawSvgPath('M3 3h18v18H3z', { ...o, borderColor: black, borderWidth: 1.6 }); return; }
      if (kind === 'both') { page.drawSvgPath('M3 3h18v18H3z', { ...o, borderColor: black, borderWidth: 1.6 }); page.drawSvgPath('M6 18 L18 6 M6 6 L10 10', { ...o, borderColor: black, borderWidth: 2.2 }); return; }
      // melee
      page.drawSvgPath('M3 3h18v18H3z', { ...o, borderColor: black, borderWidth: 1.6 }); page.drawSvgPath('M6 18 L17 7 M14 6 L18 10', { ...o, borderColor: black, borderWidth: 2.2 });
    };
    const distIcon = (x, yTop, s = 8) => page.drawSvgPath('M3 21 V3 L21 21 Z M3 15 L9 21 M3 9 L15 21', { x, y: yTop, scale: s / 24, borderColor: black, borderWidth: 2.4 });
    const tgtIcon = (x, yTop, s = 8) => { const o = { x, y: yTop, scale: s / 24 }; page.drawSvgPath('M12 2a10 10 0 1 0 0.01 0z', { ...o, borderColor: black, borderWidth: 2.4 }); page.drawSvgPath('M12 7a5 5 0 1 0 0.01 0z', { ...o, borderColor: black, borderWidth: 2.4 }); page.drawSvgPath('M12 10.5a1.5 1.5 0 1 0 0.01 0z', { ...o, color: black }); };
    const tierBadge = (n, x, yy, sz) => {
      const w = 21, h = sz * 1.05;
      page.drawRectangle({ x, y: yy - sz * 0.22, width: w, height: h, borderColor: black, borderWidth: 0.7 });
      const lab = ['', '11', '12-16', '17+'][n]; const ls = sz * 0.68;
      let tx = x + (w - FB.widthOfTextAtSize(lab, ls) - (n === 1 ? 5 : 0)) / 2;
      if (n === 1) { // draw ≤
        const gx = tx, gy = yy + sz * 0.05; page.drawLine({ start: { x: gx + 3.2, y: gy + 4.2 }, end: { x: gx, y: gy + 2.6 }, thickness: 0.6, color: black }); page.drawLine({ start: { x: gx, y: gy + 2.6 }, end: { x: gx + 3.2, y: gy + 1 }, thickness: 0.6, color: black }); page.drawLine({ start: { x: gx, y: gy }, end: { x: gx + 3.2, y: gy }, thickness: 0.6, color: black }); tx += 5;
      }
      page.drawText(lab, { x: tx, y: yy + sz * 0.02, size: ls, font: FB, color: black });
      return w;
    };
    const chevronRule = (x, yy, w) => {
      const c = x + w / 2;
      page.drawLine({ start: { x, y: yy }, end: { x: c - 6, y: yy }, thickness: 0.6, color: rule });
      page.drawLine({ start: { x: c - 6, y: yy }, end: { x: c, y: yy - 4 }, thickness: 0.6, color: rule });
      page.drawLine({ start: { x: c, y: yy - 4 }, end: { x: c + 6, y: yy }, thickness: 0.6, color: rule });
      page.drawLine({ start: { x: c + 6, y: yy }, end: { x: x + w, y: yy }, thickness: 0.6, color: rule });
    };
    // column flow
    const GAP = 18, BW = (CW - GAP) / 2; let col = 0, colTop;
    newPage(); T('STAT BLOCK REFERENCE', MG, y - 4, 12, FB, grey); y -= 20; colTop = y;
    const bx = () => MG + col * (BW + GAP);
    const fits = h => y - h >= MG + 16;
    const place = h => { if (fits(h)) return; if (col === 0) { col = 1; y = colTop; } else { newPage(); col = 0; y = H - MG; colTop = y; } };
    // generic "unit": measure with dry run, then place and draw
    const unit = (fn) => { const y0 = y; let dry = true; const ctx = { dry }; const save = y; y = 10000; fn(true); const h = 10000 - y; y = save; place(h); fn(false); return h; };
    const SZ = 8.6, LH = SZ * 1.28, PAD = 6;
    const textBlock = (html, indent, dry, sz = SZ) => {
      const lines = wrapRuns(runsOf(html), BW - indent - PAD * 2, sz);
      for (const ln of lines) { if (!dry) drawLine(ln, bx() + PAD + indent, y - sz, sz); y -= sz * 1.28; }
    };
    const twoCol = (left, right, dry, fl = TR, fr = TR, sz = SZ, iconL, iconR) => {
      if (!dry) {
        let lx = bx() + PAD; if (iconL) { iconL(lx, y - 1.2); lx += 11; }
        if (left) page.drawText(san(left), { x: lx, y: y - sz, size: sz, font: fl, color: black });
        if (right) { const rw = fr.widthOfTextAtSize(san(right), sz); const rx = bx() + BW - PAD - rw; page.drawText(san(right), { x: rx, y: y - sz, size: sz, font: fr, color: black }); if (iconR) iconR(rx - 11, y - 1.2); }
      }
      y -= sz * 1.3;
    };
    const fitText = (s, w, f, sz) => { s = san(s); if (f.widthOfTextAtSize(s, sz) <= w) return s; while (s.length > 3 && f.widthOfTextAtSize(s + '…', sz) > w) s = s.slice(0, -1); return s + '…'; };
    for (const gid of seen) {
      const m = MON[gid]; const st = m.stats || {};
      // header + stats + defences + characteristics as one unit
      unit(dry => {
        const top = y, hh = 34;
        if (!dry) {
          const strips = 14; for (let s = 0; s < strips; s++) { const t = s / (strips - 1); page.drawRectangle({ x: bx(), y: top - (s + 1) * hh / strips, width: BW, height: hh / strips + 0.3, color: rgb(0.93 + 0.06 * t, 0.55 + 0.4 * t, 0.55 + 0.4 * t) }); }
          page.drawText(fitText(m.name, BW * 0.58, TB, 13), { x: bx() + PAD, y: top - 14, size: 13, font: TB, color: black });
          const lv = `Level ${m.level} ${m.role}`; const ls = TB.widthOfTextAtSize(san(lv), 9) > BW * 0.42 ? 7.5 : 9;
          page.drawText(san(lv), { x: bx() + BW - PAD - TB.widthOfTextAtSize(san(lv), ls), y: top - 13, size: ls, font: TB, color: black });
          page.drawText(fitText((m.keywords || []).join(', ') || '—', BW * 0.6, TR, 8.5), { x: bx() + PAD, y: top - 26, size: 8.5, font: TR, color: black });
          const ev = m.ev ? 'EV ' + m.ev : ''; if (ev) { const es = TR.widthOfTextAtSize(san(ev), 8.5) > BW * 0.38 ? 7 : 8.5; page.drawText(san(ev), { x: bx() + BW - PAD - TR.widthOfTextAtSize(san(ev), es), y: top - 26, size: es, font: TR, color: black }); }
          chevronRule(bx(), top - hh, BW);
        }
        y = top - hh - 6;
        const keys = ['Size', 'Speed', 'Stamina', 'Stability', 'Free Strike'].filter(k => k in st);
        if (keys.length) {
          if (!dry) { const cw = BW / keys.length; keys.forEach((k, i) => { const cx = bx() + cw * i + cw / 2; const v = san(st[k] || '—'); page.drawText(v, { x: cx - TR.widthOfTextAtSize(v, 13) / 2, y: y - 13, size: 13, font: TR, color: black }); page.drawText(k, { x: cx - TB.widthOfTextAtSize(k, 8) / 2, y: y - 23, size: 8, font: TB, color: black }); }); }
          y -= 30;
        }
        const lbl = (lab, val, x, right) => { const a = san(lab + ': '), b2 = san(val || '—'); const w = TB.widthOfTextAtSize(a, SZ) + TR.widthOfTextAtSize(b2, SZ); const sx = right ? bx() + BW - PAD - w : x; page.drawText(a, { x: sx, y: y - SZ, size: SZ, font: TB, color: black }); page.drawText(b2, { x: sx + TB.widthOfTextAtSize(a, SZ), y: y - SZ, size: SZ, font: TR, color: black }); };
        if (m.immunity || m.weakness) { if (!dry) { lbl('Immunity', m.immunity, bx() + PAD); lbl('Weakness', m.weakness, 0, true); } y -= LH; }
        if (m.movement) { if (!dry) lbl('Movement', m.movement, bx() + PAD); y -= LH; }
        for (const x2 of m.extra || []) textBlock(`<b>${esc(x2.k)}:</b> ${esc(x2.v)}`, 0, dry);
        if (Object.keys(m.chars || {}).length) {
          y -= 2; const bh = 13;
          if (!dry) {
            page.drawRectangle({ x: bx() + 2, y: y - bh, width: BW - 4, height: bh, borderColor: black, borderWidth: 0.7 });
            const cw = (BW - 4) / 5;
            ['Might', 'Agility', 'Reason', 'Intuition', 'Presence'].forEach((c, i) => {
              let cx = bx() + 2 + cw * i + 4; const yy = y - bh + 3.6;
              const L = c[0], rest = c.slice(1); const lw = FB.widthOfTextAtSize(L, 7) + 3;
              page.drawRectangle({ x: cx, y: yy - 1.6, width: lw, height: 8.6, color: black }); page.drawText(L, { x: cx + 1.5, y: yy, size: 7, font: FB, color: rgb(1, 1, 1) }); cx += lw;
              page.drawText(rest, { x: cx, y: yy, size: 7.6, font: TR, color: black }); cx += TR.widthOfTextAtSize(rest, 7.6) + 2.5;
              page.drawText(san(m.chars[c] ?? '—'), { x: cx, y: yy, size: 7.6, font: TR, color: black });
            });
          }
          y -= bh + 4;
        }
        if (m.desc) textBlock(`<i>${m.desc.replace(/<\/?i>/g, '')}</i>`, 0, dry, 8);
      });
      // abilities
      for (const a of m.items || []) {
        unit(dry => {
          if (!dry) chevronRule(bx(), y, BW);
          y -= 8;
          const k = abKind(a); const kind = k === 'melee' && /Ranged/.test((a.keywords || []).join(' ')) ? 'both' : k;
          // header line
          if (!dry) {
            icon(kind, bx() + PAD, y - 0.5);
            let x = bx() + PAD + 13; const nm = san(a.name);
            page.drawText(nm, { x, y: y - 8.6, size: 9.6, font: TB, color: black }); x += TB.widthOfTextAtSize(nm, 9.6) + 4;
            if (a.roll) page.drawText(san(a.roll), { x, y: y - 8.6, size: 8.8, font: TR, color: black });
            if (a.cost) { const c = san(a.cost); page.drawText(c, { x: bx() + BW - PAD - TB.widthOfTextAtSize(c, 9), y: y - 8.6, size: 9, font: TB, color: /villain/i.test(c) ? red : black }); }
          }
          y -= 12;
          if ((a.keywords || []).length || a.action) twoCol((a.keywords || []).join(', ') || '—', a.action, dry);
          if (a.distance || a.target) {
            const d = strip(a.distance), t = strip(a.target);
            const tw2 = TR.widthOfTextAtSize(san(t), SZ), dw = TR.widthOfTextAtSize(san(d), SZ);
            if (dw + tw2 + 40 > BW - PAD * 2) { twoCol(d, '', dry, TR, TR, SZ, (x, yy) => distIcon(x, yy)); twoCol('', fitText(t, BW - 30, TR, SZ), dry, TR, TR, SZ, null, (x, yy) => tgtIcon(x, yy)); }
            else twoCol(d, t, dry, TR, TR, SZ, (x, yy) => distIcon(x, yy), (x, yy) => tgtIcon(x, yy));
          }
          y -= 2;
          for (const r of a.rows || []) {
            if (r.k === 'roll') continue;
            if (r.k === 'tier') {
              const lines = wrapRuns(runsOf(r.html), BW - PAD * 2 - 26, SZ);
              lines.forEach((ln, li) => { if (!dry) { if (li === 0) tierBadge(r.n, bx() + PAD, y - SZ, SZ); drawLine(ln, bx() + PAD + 26, y - SZ, SZ); } y -= LH; });
            } else { y -= 1.5; textBlock(r.html, 0, dry); }
          }
          y -= 4;
        });
      }
      unit(dry => { if (!dry) page.drawLine({ start: { x: bx(), y }, end: { x: bx() + BW, y }, thickness: 0.8, color: rule }); y -= 18; });
    }
