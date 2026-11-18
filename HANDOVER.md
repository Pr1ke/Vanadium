# Vanadium — Handover

This is everything you need to keep developing Vanadium in VS Code (or with another AI assistant) without the original chat.

## 1. What it is

Vanadium is a fast, searchable **Draw Steel** reference site plus a Director's toolkit. It works like 5etools does for D&D. Earlier names were "Steeltools" (you'll still see it in some code, such as the IndexedDB name and comments) and then Vanadium.

Features:
- **Rules reference.** Heroes book reader, abilities, classes, ancestries, cultures, careers, kits, perks, complications, conditions, skills, treasures, titles, gods and glossary. Global search, pins (★), and links between entries.
- **Bestiary.** Monsters from *Draw Steel: Monsters* and any imported PDF, with filters and stat blocks.
- **Encounter Builder.**
  - Calculates encounter strength (EV) and covers retainers and victories.
  - Assigns coloured "stones", each colour used at most once, to tell creature groups apart.
  - Exports a PDF:
    - stat blocks coloured to match their stones
    - a note on scaling for fewer heroes
    - a player handout with a damage tracker that has big write-in boxes
- **Negotiation Tracker and Montage Tests.** Step-by-step runners, PDF export, and "delves and dastards" content when a book providing it is imported.
- **Respite & Downtime.** `site/respite.html`, embedded in the app. Its theme stays in sync with the main app.
- **Sessions.** One folder per game night. Markdown notes, read-aloud text and linked encounters, montages and negotiations, plus a "print this session" export (merged PDF).
- **Cards.**
  - Treasure, quest, follower and retainer cards in four styles.
  - Customisation: colours, watermark, icon on the back, custom text.
  - Icon libraries with search: game-icons.net and Material Design Icons.
  - Can create quests from an adventure's text.
  - PDF export.
- **PDF importer.**
  - The user drops in their own Draw Steel PDF (an adventure, bestiary or supplement). It is parsed in the browser into chapters, headings, tables, read-aloud text, monster stat blocks and abilities.
  - Pictures and maps go back where they appeared, monster art sits on its stat block, and a lightbox opens on click.
  - Everything is saved **only in that browser's IndexedDB**.
- **Other.** Light/dark theme, mobile layout, offline-friendly data cache.

## 2. Licensing — read before adding content

- The built-in content is limited to the **text** of *Draw Steel: Heroes* and *Draw Steel: Monsters*, under the [DRAW STEEL Creator License](https://www.mcdmproductions.com/draw-steel-creator-license).
- **Never commit or host:**
  - MCDM artwork or page images. The license allows text, not art or screenshots, so even Heroes/Monsters art is out.
  - MCDM or DRAW STEEL logos.
  - Content from books the license doesn't cover. *Draw Steel: Encounters* and *The Fall of Blackbottom* were deliberately removed from the built-ins.
- Those books are supported **only through the importer**. The user supplies their own PDF, and the parsed result stays in their browser. The importer must never upload anything; the code only makes GET requests for the app's own static files. A test confirms that importing makes no other requests (see §8).
- The required notice must stay visible on the site, and is also in README:
  > Vanadium is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC. DRAW STEEL © 2024 MCDM Productions, LLC.
- Icon credits must stay too: game-icons.net (CC BY 3.0) and Material Design Icons (Apache 2.0).
- `.gitignore` excludes `*.pdf`. Keep source PDFs out of the repo.

## 3. Repository layout

```
site/                  ← the deployable static site (this is what gets hosted)
  index.html           ← GENERATED (CSS + body markup)
  app.js               ← GENERATED (all JS concatenated)
  respite.html         ← GENERATED (respite tool, restyled)
  lib/                 ← pdf.js 6.2.108 legacy (pdf.min.mjs + worker), pdf-lib (ESM build), dsparse.mjs (copy of importer/dsparse.mjs)
  data/
    heroes.json        ← Heroes book + typed entities (abilities, classes, …)
    monsters.json      ← Monsters book pack (chapters, monsters, abilities) — no images
    *.gz.txt           ← GENERATED base64(gzip(json)) twins the app actually fetches
    icons-gi.gz.txt    ← game-icons.net set; icons-mdi.gz.txt ← Material Design Icons set
src/                   ← sources you edit
  app.html             ← only its <head> CSS is used by the build
  extra.css, vanadium.css   ← extra + theme styles (vanadium.css = current design, light-first, html[data-theme=dark])
  body.html            ← page markup
  app.js               ← core: data loading, routing, search, book reader, stat blocks, importer UI, library, pins, home
  enc.js               ← encounter builder, stones, scaling, encounter PDF + damage tracker
  neg.js               ← negotiation tracker
  mtg.js               ← montage tests, book-encounter picker, matchMonster; exposes window.__mt for tests
  print.js             ← PDF writer helpers (makeWriter, Times/Helvetica sets), montage/negotiation/markdown PDFs, mergePdfs
  sess.js              ← sessions
  cards.js             ← cards, icon libraries/search, customiser, card PDF
  sb.js                ← old stat-block PDF fragment (reference only, not in the build)
  mksite.py            ← BUILD: index.html + app.js + data/*.gz.txt
  mkrespite.py, respite-base.html, respite-vanadium.css ← BUILD for respite.html
  parse.py, build.py, pg.py, assemble.py ← one-off pipeline that produced heroes.json from `pdftohtml -xml` output
importer/
  dsparse.mjs          ← THE PDF parser (browser + node). Edit here, then copy to site/lib/
  run.mjs, runimg.mjs, reparse.mjs, dump.mjs, stats.mjs, t.mjs, conv.py ← node/python helpers for offline parsing & debugging
tests/                 ← Playwright (Python) scripts
.vscode/               ← build/serve tasks, recommended extensions
package.json           ← npm scripts + pdfjs-dist for the node importer scripts
```

## 4. Build and run

You need Python 3.10+. Node 18+ is only needed for the importer scripts. The tests need `pip install playwright` and `playwright install chromium`; `conv.py` needs Pillow.

```bash
npm run build      # or: python3 src/mksite.py && python3 src/mkrespite.py
npm run serve      # python3 -m http.server 8765 --directory site → http://127.0.0.1:8765/
```
VS Code: **Terminal → Run Build Task** (Ctrl/Cmd+Shift+B) builds. Run the "Serve site (8765)" task to start the server.

**Important rules:**
- `site/index.html`, `site/app.js`, `site/respite.html` and `site/data/*.gz.txt` are **generated**. Edit `src/`, then rebuild.
- `mksite.py` inserts `boot()` at the end of the concatenated JS. Its order is: app.js (minus its trailing `boot();`) + enc.js + neg.js + mtg.js + print.js + sess.js + cards.js, then `boot();`.
- `mksite.py` replaces `__DATAV__` in app.js with an md5 hash of `site/data/*.json`. That hash busts the browser's Cache API copy, so changing any data JSON automatically invalidates caches.
- The site must be served over HTTP. `file://` breaks module imports and fetch.
- `importer/dsparse.mjs` is loaded by the browser from `site/lib/dsparse.mjs`, so copy it there after editing: `cp importer/dsparse.mjs site/lib/`.

## 5. Architecture notes

- **No framework, no bundler.** Plain ES2020 in one global script. Pages are rendered with template strings into `#main`. `$()` is querySelector, `esc()` is HTML-escape.
- **Routing is by hash** (`#type--id`, `#book--<pack>--<chapter>`, `#monsters--<id>`, `#encounter`, `#montage--<id>`, `#negotiation--<id>`, `#cards`, `#sessions`, `#import`, `#library`, `#respite`…). `route()` is in app.js and `go(h)` navigates. Entity types are in `TYPES` (abilities, classes, ancestries, cultures, careers, kits, perks, complications, conditions, skills, treasures, titles, gods, glossary, monsters).
- **Data loading:** `getJSON(u)` tries `u.gz.txt` first (base64 → `DecompressionStream('gzip')`), falls back to the `.json`, and caches in the Cache API under the `DATA_V` key. `BUILTIN` (top of app.js) lists the built-in packs; it now holds only `monsters`, and `heroes.json` is loaded separately as the core data `D`.
- **Packs:** every book is a "pack": `{id, title, kind: core|bestiary|adventure|supplement, chapters:[{id,title,blocks}], monsters, abilities, images?, builtin?}`.
  - Blocks look like `{t:'h'|'p'|'li'|'table'|'box'|'read'|'monster'|'img', …, pg}`.
  - A monster looks like `{name, level, role, keywords, ev, stats, chars, immunity, weakness, movement, extra, items, pg, org, id, ch, group, img?}`.
  - `addPack`/`removePack` maintain the `PACKS` and `PK` maps, plus the merged monster index `MONS`/`MON`.
- **Imported packs** live in IndexedDB database `steeltools`, store `packs` (keyPath `id`, ids look like `imp-<slug>-<rand>`), with an in-memory fallback. Their images are stored inline as `data:image/webp` URLs in `pack.images[]`. Blocks reference them as `{t:'img', i}` and monsters as `m.img`.
- **User state** is in localStorage, `st_` prefix: `cards`, `chars`, `enc`, `encs`, `mtg`, `mtgsess`, `negs`, `negsess`, `pins`, `sessions`, `stones`, `stoneson`, `theme2`.
- **PDF output** uses pdf-lib's StandardFonts, Helvetica and Times sets, chosen with `base.times`. The standard fonts are WinAnsi only, so text goes through a sanitiser that replaces ≤ ≥ − etc. Icons are drawn with `drawSvgPath`.
- **Respite** is a separate page (`respite.html`) shown in an iframe. `applyTheme()` calls the iframe's `__stTheme` to keep themes in sync.

## 6. The PDF parser (importer/dsparse.mjs)

- `extractPages(doc, onProgress, {images:{OPS, encode}})` uses pdf.js text content plus the operator list.
  - It tracks the transform matrix (save/restore/transform/form XObjects) to place images.
  - It skips tiny images (<40 pt or <64 px) and near-full-page backgrounds (>80% of the page), and dedupes by `g_` object name or a size+hash key.
- `parsePack(pages, meta)` works on the layout:
  - Lines → columns → blocks → chapters. Headings are found by font size and weight.
  - Monster stat blocks are found by "Level N"/"LEVEL N" headers (case-sensitive on purpose: lowercase "level" in prose caused false headers).
  - It handles Stamina in the header, `|`-separated stat rows, "flush" Word-made layouts (ability text aligned with the glyph), and tier lines (`!@#` glyphs).
  - Monster groups: a bestiary uses the chapter title, otherwise a short nearby heading.
  - Images repeated 3+ times (page furniture) are dropped. Image blocks are spliced in by line position (`__at`). A monster gets the art from an image block within its previous 3 blocks.
- Known-good imports: *Draw Steel: Monsters*, *Draw Steel: Encounters*, *The Fall of Blackbottom* (43 images, about 14 s), *Crack the Sun Act 1 Monsters* (39 monsters, no images in that PDF).
- Offline debugging: `npm i`, then `node importer/run.mjs book.pdf out.json "Title" adventure my-id`. It caches the extracted pages in `out.json.pages.json`; after that, `node importer/reparse.mjs out.json.pages.json out.json "Title" adventure my-id` re-runs only the parse. `node importer/dump.mjs out.json outline` prints the structure.

## 7. Hosting

- It's a fully static site, so host `site/` anywhere: GitHub Pages (from `/site` via an Action, or by moving it to `/docs`), Netlify, Cloudflare Pages, etc.
- It was previously published as a private Claude artifact (https://claude.ai/artifact/BP3QZkwQfsyMnkqj9DmgMd). That host rejected `.gz` and `.bin` files, which is why the data ships as base64 `.gz.txt`. On a normal host you could serve real gzip instead, but the current approach works everywhere.
- **Before making a host public, double-check that `site/` holds no images or unlicensed books.**

## 8. Tests

- Serve `site/` on port 8765 first, then `python3 tests/<name>.py`. Scripts print `errs []` when there are no page errors.
- Many tests point at the original sandbox paths (`/mnt/user-data/uploads/*.pdf`, `/home/claude/shots/`). Change those to your local PDF and output paths.
- Still valid:
  - `t20` cards styles
  - `t22` import + view of Crack the Sun
  - `t23` smoke test of every page; also checks for no non-GET requests and no `data/img` references
  - `t24 <pdf>` import of a picture-heavy PDF; checks IndexedDB storage, that it survives a reload, that the book shows its images, and that no uploads happen
- `t10`, `t16`, `t17`, `t18`, `t19` and `t21` assumed the old built-in Encounters/Blackbottom books. Import those PDFs in the test first, or rewrite them.
- `t2`–`t15`, `shot.py` and `interact.py` are older and partly reference a pre-split single HTML file (`steeltools.html`). Treat them as examples.

## 9. Known issues and ideas

- The menu links "Encounters Book" by the fixed id `book--encounters`. An imported Encounters PDF gets an `imp-…` id, so that link stays hidden; the book is reachable from the Library. You could match imported packs by title or kind.
- With no imported books, the Montage and Negotiation pages list only user-made entries. The built-in examples came from the Encounters book.
- The Heroes book data was built by a one-off `pdftohtml` pipeline (`src/parse.py`, `src/build.py`). Rebuilding it needs `pdftohtml -xml` from poppler.
- The IndexedDB name is still `steeltools`. Don't rename it without a migration, or users lose their imports.
- Big imports with images can take tens of MB of IndexedDB space; browsers may ask the user for permission.
- Pushing from the Claude session failed because the Claude GitHub App isn't installed on `Pr1ke/vanadium`. This repo already has a local commit and `origin` set, so a plain `git push -u origin main` from your machine works.
