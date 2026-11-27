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
- **Sessions.** One folder per game night. Markdown notes, read-aloud text and linked encounters, montages and negotiations, plus a "print this session" export (merged PDF). Inside a session, folders (nestable) group items, e.g. a folder "This town" with its lore pages and encounters. Works the same in every system.
- **Cards.**
  - Treasure, quest, follower and retainer cards in four styles.
  - Customisation: colours, watermark, icon on the back, custom text.
  - Icon libraries with search: game-icons.net and Material Design Icons.
  - Can create quests from an adventure's text.
  - PDF export.
  - Optional **QR code on each back** (needs sync). Players scan it and get that card as a JPG. See §5a, "Card pictures".
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
- **5e (SRD 5.2) content** is limited to the System Reference Document 5.2, which is CC BY 4.0. Wizards of the Coast's attribution must stay visible: it is in the 5e footer (`notice`), on 5e PDFs (`pdfNotice`), in the reference book's "About" chapter and in the README.
  - **No trademarks:** never use Wizards of the Coast trademarks in the app, such as "Dungeons & Dragons", "D&D", or product and setting names. The system is called "5e (SRD 5.2)". `tests/srd5_test.py` checks for these.
  - **No other books:** never add non-SRD content (other books' text). Those go through the importer, like the Draw Steel books.
  - **No art:** never use monster art; the data's `image` fields are ignored.
- **Imported 5e books (your own JSON files)** follow the same rules as PDF imports:
  - **Local only:** they are read in the browser and stored only in IndexedDB, plus the owner's private sync.
  - **Never commit them:** never commit, bundle or host them. `dndbeyond/` (the owner's files) is in `.gitignore`.
  - **Test data:** tests use only the invented fixture in `tests/fixtures/5etools/`. `tests/s5import_test.py --folder DIR` checks a real folder locally without writing anything to the repo.
  - **Nothing fetched:** the importer fetches nothing; pictures referenced by the files are skipped.
  - **Card pictures are public:** QR card pictures made from imported spells or items become public pictures, the same trade-off as before.
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
  app.js               ← CORE (system-neutral): data loading, packs, routing, list pages, book reader, library,
                          importer UI, pins, search, sync page, updates. Talks to the game system only via SYS.* (§5b)
  print.js             ← PDF writer (makeWriter, Times/Helvetica sets), pdf-lib loader, deliverFile, markdown PDFs, mergePdfs
  sess.js              ← sessions: folders, markdown pages, overview, whole-session PDF. Other item types come from the system
  cards.js             ← card generator: quest cards, styles, icons, customiser, card PDF, QR pictures. Other card kinds come from the system
  sync.js, *.php       ← sync client, sync/update/card servers (system-neutral)
  systems/drawsteel/   ← THE DRAW STEEL SYSTEM MODULE (§5b)

    drawsteel.js       ← data setup, ability/stat-block rendering, list columns/filters, class pages, menu,
                          home, power roller, hooks, and the registerSystem({...}) call
    enc.js             ← encounter builder, stones, scaling, encounter PDF + damage tracker
    neg.js             ← negotiation tracker
    mtg.js             ← montage tests, book-encounter picker, matchMonster; exposes window.__mt for tests
    ds-print.js        ← montage and negotiation PDF sheets
    ds-sessions.js     ← session items: encounters, montages, negotiations; the party (heroes, level, Victories)
    ds-cards.js        ← card kinds: treasures, followers & retainers; quest rewards; rewards found in adventure text
    register.js        ← the registerSystem({...}) call (loaded last)
    respite-base.html, respite-vanadium.css ← the Respite tool (built by mkrespite.py)
  systems/srd5/        ← THE 5e (SRD 5.2) SYSTEM MODULE
    srd/               ← pinned 2024 data from 5e-bits/5e-database (MIT; content CC BY 4.0), see srd/README.md
    mkdata.py          ← BUILD: srd/ → site/data/srd5.json (rules, reference book) + srd5-monsters.json (monsters book)
    extract_initiative.py ← one-off: monster Initiative from the official SRD 5.2 PDF text → srd/initiative.json (the dataset lacks it)
    srd5.js            ← stat blocks, spell cards, list columns/filters, menu, home, browse, search hooks
    s5-tools.js        ← dice roller, encounter builder (SRD 5.2 XP budgets), initiative tracker, session items, encounter PDF
    s5-import.js       ← importer for JSON files in the 5etools data format (bestiary-, adventure-, book-, spells- + sources.json, class-)
    s5-cards.js        ← 5e card kinds: magic items (by rarity), spells (by class/level), 5e quest rewards
    srd5.css           ← 5e stat block / spell card styles (SYSTEM_CSS in mksite.py)
    register.js        ← the registerSystem({...}) call (loaded last)
  sb.js                ← old stat-block PDF fragment (reference only, not in the build)
  mksite.py            ← BUILD: index.html + app.js + data/*.gz.txt (SYSTEM_FILES lists each system's files)
  mkrespite.py         ← BUILD for respite.html
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
- `mksite.py` concatenates one global script, in this order:
  1. core `src/app.js`, minus its trailing `boot();`
  2. each system's files from `SYSTEM_FILES` (for Draw Steel: `drawsteel.js`, `enc.js`, `neg.js`, `mtg.js`, `ds-print.js`), which call `registerSystem`
  3. the core modules `print.js`, `sess.js` and `cards.js`
  4. `boot();`
  
  Order only matters for code that runs at load time.
- `mksite.py` replaces `__DATAV__` in app.js with an md5 hash of `site/data/*.json`. That hash busts the browser's Cache API copy, so changing any data JSON automatically invalidates caches.
- The site must be served over HTTP. `file://` breaks module imports and fetch.
- `importer/dsparse.mjs` is loaded by the browser from `site/lib/dsparse.mjs`, so copy it there after editing: `cp importer/dsparse.mjs site/lib/`.
- `src/mkversion.py` runs last and writes `site/version.json` (`{build, built}`), where `build` is a hash of every generated file. Commit it together with the rest of `site/`, because the auto-updater relies on it.

### Auto-update
- **PHP hosts (the real server): `site/update.php`**, with its source in `src/update.php`; the build copies it into `site/`. Upload the contents of `site/` to the web root, and make sure PHP can write to that folder.
  - **Needs:** PHP 7.4+, the `zip` extension, and `curl` or `allow_url_fopen`.
  - **Two live copies, by folder:** the branch comes from the name of the folder `update.php` is installed in (`BRANCHES` in `src/update.php`), never from the request, so a visitor can't switch it. `vanadium/` follows `main`; `vanadiumBeta/` (any letter case) follows `beta`; any other folder follows `main`. Every JSON reply includes `branch`. Each folder has its own cooldown, update state and sync data (`.vanadium-*`).
  - **Beta workflow:** work happens on feature branches (e.g. `systems`), which are merged into `beta` to try them live, then into `main` to release. Both branches need a build committed (`site/`), because the updater installs `site/` from the branch zip.
  - **Same domain:** if both folders are on one domain, the browser shares saved data (localStorage) between them, including the sync key, because storage is per domain, not per folder.
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
- **Imported packs** live in IndexedDB database `steeltools`, store `packs` (keyPath `id`, ids look like `imp-<slug>-<rand>`), with an in-memory fallback. Their images are stored inline as `data:image/webp` URLs in `pack.images[]`. Blocks reference them as `{t:'img', i}` and monsters as `m.img`. Each import is tagged with `system` (the active system when it was imported); untagged ones are the legacy system's. Only the active system's books are loaded (`packBelongs`).
- **User state** is in localStorage, **per game system**:
  - **Draw Steel** (the legacy system, `LEGACY_SYSTEM` in `mksite.py`) uses the original `st_` prefix: `cards`, `chars`, `enc`, `encs`, `mtg`, `mtgsess`, `negs`, `negsess`, `pins`, `sessions`, `stones`, `stoneson`. This is why no data had to be migrated.
  - **Other systems** use `st_<system>_<key>`, for example `st_dnd5e_cards`.
  - **Shared settings** go through `gstore` (`st_theme2`, `st_updchk`).
  - **The active system** is `vanadium_system`. It is per device and deliberately not synced; switching calls `switchSystem(id)` and reloads.
  - **Rules:** never change `LEGACY_SYSTEM`, and never give a system the id `sync`, because `st_sync_*` is sync's own bookkeeping. Sync covers every `st_` key, so new systems are synced automatically.
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
- **Card pictures (QR codes on card backs):**
  - **Export:** with "QR code on back" checked, `exportCardsPdf()` in cards.js first builds a PDF of the fronts only, using `buildCardsPdf({frontsOnly, collect})`. It renders those pages with pdf.js at about 250 dpi and crops out each face as a JPG.
  - **Ids:** each face's id is `sha256(salt + face content)`, cut to 22 characters. The salt is a private value for the key, returned by `state`, and it's kept when the key is replaced. The same card always gets the same id and URL, so only new or changed faces are uploaded (checked with `card_has`, then sent with `card_put`). It then builds the real PDF with `buildCardsPdf({qr: urls})`, which draws a vector QR code (version ~5, about 0.55 mm squares on poker cards) at the bottom of each back.
  - **Serving:** images are stored at `.vanadium-data/cards/<id>.php` with the guard prefix. **`card.php?id=`** serves them publicly as `image/jpeg`.
  - **Traffic:** `card.php` counts views and bytes per day in `cards/stats.php`, keeping 90 days. The Sync page shows the owner the last 30 days, plus a "Delete all card pictures" button (`card_clear`). Card pictures count toward the key's 1 GB.
  - **QR library:** `site/lib/qrcode.js` is qrcode-generator 1.4.4 (MIT). The build copies it from `node_modules`, and it's lazy-loaded by `loadQr()`.
  - **Licensing:** card pictures are public to anyone holding the QR code, and that includes quest cards made from imported adventure text. That was the owner's call.
- **Updaters:** neither updater touches `.vanadium-*` files. `update.php` only deletes files from its own manifest, and `serve.py` skips them. `serve.py` can't run PHP, so sync is unavailable locally and the Sync page says so.
- **Tests:** `node tests/sync_client.mjs site/sync.js` runs a simulation of several devices against an in-memory JS copy of the `sync.php` API. It covers merging, conflicts, removal, books (multi-chunk), loading data before the app starts, rotating the key and owner permissions. If you change the API, keep that copy in step with `sync.php`. The PHP itself is only tested on the real host.

## 5b. Game systems (multi-system support, branch `systems`)

Goal: one codebase for several rule systems (Draw Steel now, D&D 5e from the SRD later).
- **Core:** `src/app.js` and the other core files are system-neutral.
- **Systems:** each game lives in `src/systems/<id>/` and registers itself with `registerSystem({...})`.
- **Access:** the core reaches the active system only through the global `SYS`. The full hook contract is documented next to `registerSystem` at the top of `app.js`, and `drawsteel.js` is the reference implementation.

**Roadmap:**
1. **Step 1 (done):** Draw Steel moved behind the interface with no visible change; see the verification below.
2. **Step 1b (done):** sessions and cards are now general engines with system "kinds" (`SYS.session`, `SYS.cards`). The roller panel (`SYS.roller`), the footer licence (`SYS.notice`) and the Sync page wording (`SYS.syncWhat`) also come from the system. `check_core.py` covers all five core files.
   - **Still Draw Steel-shaped, but generic enough for now:** the card store keeps a `followers` list, and the Encounters-book menu link uses a fixed id. Both get revisited when 5e arrives.
3. **Step 2 (done):** the system switch and per-system data.
   - **The switch** is `#syssel` in the top bar. It appears only when the build has more than one system, and uses `short` names on phones.
   - **The build** lists its systems in `SYSTEM_FILES` and injects `SYSTEM_IDS` and `LEGACY_SYSTEM` into app.js.
   - **Loading:** every system's code is in app.js, which is small, but only the active system's data file and books are loaded.
   - **Data** is separated per system as described in §5 (localStorage prefixes, tagged imports).
   - **Tests:** `tests/systems_test.py` runs 24 checks. It uses a throw-away build with `tests/fixtures/sample-system`, which is also the smallest example of a system.
4. **Step 3 (done): the 5e (SRD 5.2) module.**
   - **Data:** `mkdata.py` runs first in `npm run build`. It fixes source glitches: words split by PDF line breaks, stray `**`, components stuck in 9 spells' range.
   - **Lists:** spells, monsters (2024-style stat blocks), magic items, classes (feature table with spell slots, features, the subclass), species, backgrounds, feats, conditions and equipment. Each has filters.
   - **Books:** the "SRD 5.2 Reference" core book is assembled from the data (abilities and skills, conditions, weapons, armor, damage, magic, alignment and languages, poisons). The monsters also form a book with one chapter per letter.
   - **Hooks:** conditions are auto-linked with hover previews; search, pins (monster XP totals), previews and the mobile Browse sheet all work for 5e.
   - **Not yet:** the SRD's running rules text (Playing the Game, Rules Glossary) isn't in the dataset. The 5e system has no dice roller, encounter builder or initiative yet (step 4), and the importer doesn't recognise 5e stat blocks yet (step 5).
   - **Tests:** `tests/srd5_test.py` runs 31 checks.
5. **Step 4 (done): 5e tools** (`s5-tools.js`).
   - **Dice (`SYS.roller`):** quick dice, typed expressions such as `2d6+3`, and d20 rolls with advantage or disadvantage. In stat blocks and spells, attack bonuses, damage dice, initiative, ability checks and saves are clickable (`s5Dicify`, `data-dice`).
   - **Encounter builder (`#encounter`):** a party with per-character levels and the SRD 5.2 "XP Budget per Character" table (Low, Moderate, High). The table was checked against the official SRD PDF; mixed levels add up per character, since the SRD only covers single-level parties. Over High shows "Beyond High". It has saved encounters, "+ Encounter" on monster pages, and a PDF sheet with budgets, creatures and stat blocks.
   - **Initiative tracker (`#initiative`):** monsters roll d20 plus their SRD Initiative. 340 of 341 come from the PDF; the Knight falls back to its Dex modifier. It tracks turns and rounds, HP damage and healing, and conditions, and keeps its state per system (`st_srd5_init`).
   - **Sessions:** 5e sessions can hold encounters (`S5_SESSION`), with the party as characters and level.
   - **Tests:** `tests/srd5_test.py` now runs 47 checks, including the SRD's own worked example.
6. **Step 5 (done): 5e cards and the 5e importer.**
   - **Format:** the importer reads JSON files in the 5etools data format (the format of the owner's files) instead of PDFs; Draw Steel keeps its PDF importer.
   - **Core support:**
     - `SYS.importer.run(files, progress)` returns `{packs, notes}`. The core then shows a preview with editable titles and stores each pack like any import (`importPageFiles`). Files can be picked, dropped, or a whole folder chosen.
     - Packs can carry `entities` (`{spells:[…], classes:[…]}`). These join the lists (`PENT`, merged and sorted by name in `itemsOf`) and are removed with the pack.
     - Pack ids are `imp-5et-<source>-<kind>`, so importing the same files again replaces the earlier import.
   - **What it converts:**
     - **Bestiaries:** monsters become the 5e stat block format. That covers 2014-style attacks, 2024 save effects, spellcasting blocks, lair XP, and XP and PB from the SRD tables by CR. `_copy` variants are resolved against the monsters in the same import (`replaceTxt`, `appendArr`, `replaceArr`, …); variants whose base isn't in the files are skipped and listed in the notes.
     - **Adventures and books:** these become chapters with read-aloud boxes (`s5read`), sidebars (`s5inset`), lists, tables and stat blocks in place (`s5mref`, found by name and source).
     - **Spells and classes:** spells (with classes from `sources.json`) and classes (feature table, features, subclasses) join the lists. The list Source column shows PHB, XPHB, SRD 5.2 and so on.
     - **`{@tags}`:** these become links (`data-s5find`, resolved when clicked), dice buttons and condition links.
   - **Tested on the owner's 182 files:** 144 books, about 2,500 monsters, 1,038 spells and 43 classes, read in about 2.5 seconds. Every imported book opens without JS errors. 19 `_copy` variants are skipped because their base bestiary isn't in the folder.
   - **Cards (`S5_CARDS`):**
     - Magic item cards are coloured by rarity, with search and "add all of a rarity".
     - Spell cards are coloured by school, with search and "add all of a class and level". Imported spells work too.
     - Quest rewards are XP, Gold, Magic Item and Other.
   - **Pictures (references only):**
     - The importer keeps picture paths: `{t:'s5img', path}` blocks for adventure, book, class and spell pictures (`image` and `gallery` entries), monster `token` paths (the 5etools naming pattern `bestiary/tokens/<SOURCE>/<Name>.webp`, only when the monster's own entry has `hasToken`), and `art` paths for monsters and classes from `fluff-*` files in the same import. It stores no image data and fetches nothing.
     - The owner hosts the picture folder and enters its address on the Imports page (`st_srd5_imgbase`, synced). Each picture is shown from that address plus its path. Nothing loads until the address is set, including full URLs in the files. Pictures missing on the server are hidden (`s5img-missing`).
     - `site/img/` and `site/vanadium-img/` are git-ignored, and `serve.py`'s updater never deletes them. The owner's folder has 3,795 references: 1,585 book pictures, the rest tokens.
   - **Imports page (`#imports`):** imported books are listed on one page, grouped, with a filter, instead of a home tile or menu item per book.
   - **Support files:** `index.json`, `sources.json`, `foundry.json` and `fluff-*` are never imported as books. Two files that would get the same pack id get distinct ids.
   - **Tests:** `tests/s5import_test.py` runs 37 checks on the fixture, including pictures (addresses, off until set, missing hidden, no other hosts).
- **Session folders (core, `src/sess.js`, both systems):**
  - A folder is an item in `S.docs` with `type: 'folder'` (and `collapsed` when closed). Any item's `parent` is the id of the folder it is in; no `parent` (or a folder that no longer exists) means top level. `S.docs` stays one ordered list, so old sessions and synced data need no migration.
  - Helpers: `sessParent`, `sessChildren`, `sessTree` (depth-first `[doc, depth]` in list order), `sessCount`. ↑/↓ swap an item with its neighbour in the same folder.
  - New items go into the folder you are in (the folder's page, or an item inside it). Every item's page has a "Move to" menu (`#d-move`); a folder can't move into itself or its sub-folders.
  - Removing a folder never deletes its contents: they move up one level. A folder's PDF merges everything inside it; the session export prints items in tree order, with folder names as headings in the contents.
  - System item kinds (`SYS.session.kinds`) need nothing new: `sessAdd` sets `parent` in the `add` callback they already call.
  - **Tests:** `tests/sessions_test.py` runs 21 checks per system (Draw Steel and 5e).

**Adding a system:**
1. Create `src/systems/<id>/<id>.js` that calls `registerSystem` with at least `id`, `name`, `data`, `init`, `corePack`, `lists`, `menu`, `home`, `browse`, `renderMonster` and `pdfNotice`.
2. List its files in `SYSTEM_FILES` in `mksite.py`, with the file holding the `registerSystem` call last.
3. Run `python tests/check_core.py` to make sure the core still doesn't reference system code directly.

**Verifying refactors:**
- **`tests/snapshot.py`** crawls the whole app with fixed test data and records:
  - the HTML of 131 pages
  - the menu
  - searches
  - the result of a roll
  - a hover preview
  - "+ Encounter"
  - the import preview of a generated PDF (`tests/make_fixture_pdf.mjs`)
  - the mobile Browse sheet and peek
  - the cards and encounter PDF exports
  - JS errors
- **`--diff`** compares two snapshots.
- **`--root`** snapshots another checkout. For example, use `git worktree add ../main-wt main` for a "before" snapshot.
- **Exported PDFs** are compared by their text (`tests/pdftext.mjs`), so licence lines, party lines and labels count too.
- **Result:** steps 1 and 1b are IDENTICAL to `main` across 136 pages, every interaction listed above, the session item pickers and PDFs, the merged session export, the card tabs and editors, the roller panel and the footer. The `?v=` asset version is the one difference, and the diff normalises it.

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

- **Current, self-contained tests** (no server needed):
  - `python tests/snapshot.py out.json`, then `--diff a.json b.json`: a whole-app before/after comparison (§5b).
  - `python tests/check_core.py`: checks the core is system-neutral.
  - `node tests/sync_client.mjs site/sync.js`: the sync client simulation.
  - `python tests/systems_test.py`: the system switch and per-system data, using the sample system fixture (needs a build).
  - `python tests/srd5_test.py`: the 5e system: content, links, search, books, pins, attribution in the footer and PDFs, no trademarks (needs a build).
  - `python tests/s5import_test.py [--folder DIR]`: the 5e JSON importer and 5e cards, on the invented fixture; with `--folder`, it also imports a real folder locally.
  - `python tests/sessions_test.py`: folders in sessions, in both systems: adding into a folder, nesting, moving, reordering, folding, folder PDF, export contents, removing a folder (needs a build).
  - **`python tests/snapshot.py out.json --system srd5`** crawls another system, which is useful for catching JS errors.
  - **`serve.py --site DIR`** serves another folder (used by tests; it never auto-updates).
- **Older scripts:** serve `site/` on port 8765 first, then `python tests/<name>.py`. Scripts print `errs []` when there are no page errors.
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
