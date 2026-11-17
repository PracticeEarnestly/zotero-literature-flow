# Notices

Literature Flow is an independent Zotero plugin, licensed AGPL-3.0-or-later.
The Git history preserves the source published in v0.2.1. Version 0.3.0 replaces
its execution path with a persistent single-worker queue and isolated Note format.

The frozen L1–L3 prompts originate from the user's P520 AI Butler 5.1.0.3
configuration, exported without credentials on 2026-10-22. Its request format,
validation section names and prompt suffixes were checked against the existing
AI Butler coordinator overlay. Upstream AI Butler by Steven Jianhao Li is
AGPL-3.0-or-later: https://github.com/steven-jianhao-li/zotero-AI-Butler

Runtime code does not import AI Butler modules. No third-party JavaScript library
is bundled in the 0.3.0 XPI. Node.js is used for tests only; Python's standard
library builds the XPI. Neither is required inside Zotero.

Version 0.4.0 vendors markdown-it 14.1.0 under its MIT license, included at
addon/content/lib/markdown-it.LICENSE. The official npm tarball integrity and
source URL are recorded in addon/content/lib/README.md. HTML input is disabled.
Markdown export uses Zotero's built-in Note Markdown translator.
