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

Product plan (Chinese): [无 PC 闭环与运营能力方案](./ai-onboarding-ops-plan.zh-CN.md).

**Handoff for Xcode (Chinese, follow-up on overseas-dev):** [AI Onboarding 交接](./ai-onboarding-xcode-handoff.zh-CN.md).

Start with the [current execution progress](./ai-onboarding-xcode-handoff.zh-CN.md#execution-progress): S05/S06 complete; **S08/S09 human acceptance passed (2026-10-09)** — S08 without real channel accounts; S09 includes real writes and clean-state tools. AI-opened browser pages must work on phone (handoff §0.12; DevTools 375 done; real-device + overseas-dev publish pending). S07 paused; S10 Airbnb real-account testing deferred. Next: commit MCP workspace and publish overseas PC mobile changes.

Do not put `APP_SECRET` or Hudson tokens in git, README, or chat logs.
