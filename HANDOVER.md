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
  - Everything is saved in that browser's IndexedDB, and on the owner's own server when sync is on (see below).
- **Sync across devices** (Utilities → Sync across devices) needs the PHP host. A private sync key keeps app data and imported books the same on every device. See §5a.
- **Other.** Light/dark theme, mobile layout, offline-friendly data cache.

## 2. Licensing — read before adding content

- The built-in content is limited to the **text** of *Draw Steel: Heroes* and *Draw Steel: Monsters*, under the [DRAW STEEL Creator License](https://www.mcdmproductions.com/draw-steel-creator-license).
- **Never commit or host:**
  - MCDM artwork or page images. The license allows text, not art or screenshots, so even Heroes/Monsters art is out.
  - MCDM or DRAW STEEL logos.
  - Content from books the license doesn't cover. *Draw Steel: Encounters* and *The Fall of Blackbottom* were deliberately removed from the built-ins.
- Those books are supported **only through the importer**. The user supplies their own PDF, and the parsed result stays in their browser. The importer itself never uploads anything. A test confirms that importing makes no other requests while sync is off (see §8).
- **Sync (opt-in) is the one exception.** When the user turns it on, their imports are stored on *their own* server under *their* private sync key. They must never become reachable without that key:
  - no public URLs
  - no sharing between keys
  - each person imports their own PDFs
  
  Keep it that way when changing sync.
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
npm run build      # python src/mksite.py && python src/mkrespite.py && python src/mkversion.py
npm run serve      # python serve.py → http://127.0.0.1:8765/
npm run update     # python serve.py --check: one update check now, then exit
```
(The scripts call `python`, because on Windows `python3` is often only the Microsoft Store stub. The build scripts read and write UTF-8 with no newline translation, so a Windows build produces the same files as a Linux one.)
VS Code: **Terminal → Run Build Task** (Ctrl/Cmd+Shift+B) builds. Run the "Serve site (8765)" task to start the server.

**Important rules:**
- `site/index.html`, `site/app.js`, `site/respite.html` and `site/data/*.gz.txt` are **generated**. Edit `src/`, then rebuild.
- `mksite.py` inserts `boot()` at the end of the concatenated JS. Its order is: app.js (minus its trailing `boot();`) + enc.js + neg.js + mtg.js + print.js + sess.js + cards.js, then `boot();`.
- `mksite.py` replaces `__DATAV__` in app.js with an md5 hash of `site/data/*.json`. That hash busts the browser's Cache API copy, so changing any data JSON automatically invalidates caches.
- The site must be served over HTTP. `file://` breaks module imports and fetch.
- `importer/dsparse.mjs` is loaded by the browser from `site/lib/dsparse.mjs`, so copy it there after editing: `cp importer/dsparse.mjs site/lib/`.
- `src/mkversion.py` runs last and writes `site/version.json` (`{build, built}`), where `build` is a hash of every generated file. Commit it together with the rest of `site/`, because the auto-updater relies on it.

### Auto-update
- **PHP hosts (the real server): `site/update.php`**, with its source in `src/update.php`; the build copies it into `site/`. Upload the contents of `site/` to the web root, and make sure PHP can write to that folder.
  - **Needs:** PHP 7.4+, the `zip` extension, and `curl` or `allow_url_fopen`.
  - **Trigger:** the app calls `update.php` with a GET request at most every 5 minutes per browser. The script also has its own **5-minute cooldown shared by all visitors**, plus a lock, stored in `.vanadium-update.json` in the web root.
  - **Update:** it compares `version.json` with the copy on GitHub. If the build differs, it downloads the repo zip from codeload, stages `site/` in `.vanadium-new-*`, moves the files in with `version.json` last, and cleans up.
  - **Deleting old files:** it only deletes files that an earlier run installed and the new build dropped. That list is kept in the same state file, so other files on the host, such as `.htaccess`, are never touched.
  - **Checking it:** open `/update.php` in a browser and it returns JSON: `cooldown`, `uptodate`, `updated` or `error` with a message.
  - **Optional cron:** if the host has cron, `curl -s https://your.site/update.php` every 5 minutes keeps the site current even when nobody visits.
- **`serve.py`** (local Python alternative) serves `site/` with `Cache-Control: no-cache` and correct `.js`/`.mjs` MIME types.
  - At startup, and when `/`, `/index.html` or `/version.json` is requested, it checks `https://raw.githubusercontent.com/Pr1ke/Vanadium/main/site/version.json`.
  - It checks **at most once every 5 minutes**. The time of the last check is saved in `.vanadium-update.json`, which is gitignored, so restarting doesn't reset the wait, and failed checks count toward it too.
  - If the `build` differs, it downloads the repo zip from codeload and stages `site/` in `.vanadium-new-*/`. It then replaces the files one by one (retrying files Windows has locked), writes `version.json` last, and deletes files the new build no longer has. If anything fails, the current files are kept.
  - Only GET requests go to GitHub, and none of them carry user data.
- **Git checkouts:** auto-update is off when `.git` exists, because it would overwrite your own builds; use `git pull` instead. `--update` turns it on anyway and `--no-update` turns it off everywhere.
- **In the app**, `initUpdateCheck()` in app.js records the `version.json` build the page loaded with.
  - It re-fetches the file at most every 5 minutes (`st_updchk`, shared by all tabs), and only while the tab is visible.
  - When the build changes, it shows a "new version — Reload" bar (`#updbar`).
  - This also works on static hosts such as GitHub Pages, where it notices a redeploy.
- **Releasing an update:** run `npm run build` and commit `site/`, including `version.json`, then push to `main`.

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

## 5a. Sync across devices (src/sync.js + src/sync.php)

- **Boot order:** `index.html` loads `sync.js` (a classic script), **not** `app.js`. When sync is on, `sync.js` pulls the latest data into localStorage first, waiting at most 4 s, and then injects `app.js` as a module. Every module therefore reads current data at load time. With sync off, it loads `app.js` immediately.
- **What syncs:**
  - Every localStorage key starting `st_`, except `st_sync_*` (sync bookkeeping) and `st_updchk`.
  - The Respite key `drawsteel-respite-v1`.
  - Imported books.
- **Change tracking:** `sync.js` patches `Storage.prototype.setItem/removeItem`, so a write only marks a key dirty when its value actually changes. Writes go through the patch from any code path. The Respite iframe calls `parent.VSync.patch(window)`; `mkrespite.py` injects that call.
- **Bookkeeping keys:**
  - `st_sync_meta`: the last write time for each key
  - `st_sync_dirty`: keys waiting to be pushed
  - `st_sync_rev`: the server revision this device has seen
  - `st_sync_pdel`: book deletions not yet sent
- **Conflicts:** the last write wins for each key. The server rejects older writes and returns its newer value. When a device connects to an existing key, its data is marked with time 1, so the synced copy wins wherever both devices have the same key. Keys only that device has are uploaded.
- **Timing:**
  - Pushes go out 1.5 s after the last change, and on `pagehide` with `keepalive`.
  - Pulls run when the tab becomes visible (at most every 20 s) and every 2 min while it's visible.
  - Changes pulled while the app is open show a "Reload" bar (`vShowBar('syncbar', …)`).
- **Books:** the pack JSON is gzipped and uploaded in 1 MB chunks, then committed with `pack_done`. Other devices download the books they don't have and call `VSync.appReady` hooks, which `addPack` the book. Removing a book sends `pack_del`, which leaves a tombstone so every device removes it. app.js calls `VSync.packsChanged()` after an import and `VSync.packDeleted(id)` after a removal.
- **Server (`sync.php`):** the API is documented at the top of the file.
  - **HTTPS:** sync only works over HTTPS; localhost is allowed for testing.
  - **Storage:** data lives in `site/.vanadium-data/`, because there's nothing above the web root on the host. It has three protections:
    1. an `.htaccess` file that denies all access
    2. every data file is a `.php` file whose first line exits
    3. each space's folder is `s-<sha256(key)>`
  - **Owner:** the first key created on the server becomes the owner (stored in `config.php`). Others can only create keys if the owner allows it on the Sync page.
  - **Limits:** at most 30 unknown-key attempts per IP per 15 minutes, and 1 GB per key.
  - **Recovery:** if the owner key is lost, delete `.vanadium-data/config.php` over FTP.
- **Updaters:** neither updater touches `.vanadium-*` files. `update.php` only deletes files from its own manifest, and `serve.py` skips them. `serve.py` can't run PHP, so sync is unavailable locally and the Sync page says so.
- **Tests:** `node tests/sync_client.mjs site/sync.js` runs a simulation of several devices against an in-memory JS copy of the `sync.php` API. It covers merging, conflicts, removal, books (multi-chunk), loading data before the app starts, rotating the key and owner permissions. If you change the API, keep that copy in step with `sync.php`. The PHP itself is only tested on the real host.

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
- The repo is at https://github.com/Pr1ke/Vanadium (`origin`, branch `main`).
