# LocalsBnb MCP — Overseas

Product story and install (six languages): start at the [root README](../../README.md).

Same npm package as China. On startup the server calls `POST /camp/get`. If `data.isBnb === 1`, it switches to overseas Hudson APIs, property timezone, currency, and one of six locales.

| Locale | Getting started | Tools & sample prompts |
|--------|-----------------|------------------------|
| English | [getting-started.en.md](./getting-started.en.md) | [tools.en.md](./tools.en.md) |
| 简体中文 | [getting-started.zh-CN.md](./getting-started.zh-CN.md) | [tools.zh-CN.md](./tools.zh-CN.md) |
| 繁體中文 | [getting-started.zh-TW.md](./getting-started.zh-TW.md) | [tools.zh-TW.md](./tools.zh-TW.md) |
| 日本語 | [getting-started.ja.md](./getting-started.ja.md) | [tools.ja.md](./tools.ja.md) |
| ภาษาไทย | [getting-started.th.md](./getting-started.th.md) | [tools.th.md](./tools.th.md) |
| Bahasa Melayu | [getting-started.ms.md](./getting-started.ms.md) | [tools.ms.md](./tools.ms.md) |

Do not put `APP_SECRET` or Hudson tokens in git, README, or chat logs.
