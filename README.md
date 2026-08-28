# Literature Flow for Zotero

Literature Flow is a small Zotero XPI created for one focused workflow. It does not contain dashboards, chat, image generation, library review, note export, or generic provider management.

## Included workflow

- New local PDFs automatically enter L1 when `autoNewL1` is enabled.
- A Zotero item rating stored in `Extra` as `rate: 2` to `rate: 4` runs the missing levels in order until L2 is complete.
- `rate: 5` runs the missing levels in order until L3 is complete.
- Re-rating a completed L2 item from 2–4 to 5 triggers L3.
- L1/L2 and L3 can use separate OpenAI-compatible endpoints and models.
- MinerU is used when an API key is configured; otherwise the plugin uses Zotero's built-in full-text index.
- The plugin only adds `AI:L1`, `AI:L2`, `AI:L3`, and `Literature Flow`; it never creates topic tags from model output.

## Installation

Download the XPI from the GitHub Releases page and install it using Zotero's **Tools → Plugins → Install Plugin From File**.

## Source and license

The complete source archive is published with each GitHub Release. This project is AGPL-3.0-or-later and credits the upstream [zotero-AI-Butler](https://github.com/steven-jianhao-li/zotero-AI-Butler).