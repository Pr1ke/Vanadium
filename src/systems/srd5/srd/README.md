# SRD 5.2 source data

These JSON files are the 2024 (SRD 5.2) English data from the 5e-bits **5e-database** project:
https://github.com/5e-bits/5e-database/tree/a6212beb4b278917c2cff41c2b04c4ef4f3e0d6f/src/2024/en
(pinned to commit `a6212beb4b278917c2cff41c2b04c4ef4f3e0d6f`). The project's code is MIT licensed (see LICENSE-5e-database.md).

The game content is from the **System Reference Document 5.2 ("SRD 5.2")** by Wizards of the
Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative
Commons Attribution 4.0 International License, available at
https://creativecommons.org/licenses/by/4.0/legalcode.

`src/systems/srd5/mkdata.py` turns these files into `site/data/srd5.json` and
`site/data/srd5-monsters.json`. Do not add content that is not in the SRD 5.2, and do not use
Wizards of the Coast trademarks (e.g. "Dungeons & Dragons", "D&D") in the app. To update, download
the same files from a newer commit and rebuild.
