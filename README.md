# Vanadium

A fast, searchable Draw Steel reference and Director's toolkit: rules, heroes, monsters, an encounter builder with PDF export, negotiation and montage runners, respite, sessions and printable cards.

It supports more than one game system from one codebase. A switch in the top bar changes between **Draw Steel** and **5e (SRD 5.2)**, a fifth-edition rules reference with spells, monsters, magic items, classes and more. Each system keeps its own data.

## Layout

- `site/` – the deployable static site (open `site/index.html` through any static web server).
- `src/` – app sources. `python3 src/mksite.py` builds `site/index.html` and `site/app.js`, and `python3 src/mkrespite.py` builds `site/respite.html`.
- `importer/` – the PDF layout parser (`dsparse.mjs`, also shipped as `site/lib/dsparse.mjs`) and the offline helper scripts.
- `tests/` – Playwright smoke tests. Serve `site/` on port 8765 first.

## Content and licensing

The built-in content covers only the rules text of *Draw Steel: Heroes* and *Draw Steel: Monsters*, as the DRAW STEEL Creator License allows. It includes no MCDM artwork, logos or page images.

You can import other books, such as adventures or *Draw Steel: Encounters*, from your own PDFs on the Import page. The PDF is parsed in your browser. Its text and pictures are saved only in that browser's IndexedDB and are never uploaded.

Vanadium is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC. DRAW STEEL © 2024 MCDM Productions, LLC.

**5e (SRD 5.2):** this work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. The data comes from the MIT-licensed 5e-bits 5e-database project (see `src/systems/srd5/srd/`). Vanadium is not affiliated with or endorsed by Wizards of the Coast.

Icons: game-icons.net (CC BY 3.0) and Material Design Icons (Apache 2.0).
