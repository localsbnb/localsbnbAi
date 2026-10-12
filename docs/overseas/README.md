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

Remote MCP and mobile platform development plan (Chinese): [远程 MCP 与多平台接入计划（M01–M09）](./remote-mcp-multiplatform-plan.zh-CN.md). First targets: ChatGPT + Claude; includes milestones, authentication, storage, acceptance criteria, and publishing dependencies. M04–M06 business sessions, persistent approvals and four-channel links are implemented and locally verified with PostgreSQL/Redis. The independent Docker service is running locally; M07 real-platform/mobile acceptance, public deployment and new-account Secret provisioning remain pending.

Product plan (Chinese): [无 PC 闭环与运营能力方案](./ai-onboarding-ops-plan.zh-CN.md).

**Handoff for Xcode (Chinese, follow-up on overseas-dev):** [AI Onboarding 交接](./ai-onboarding-xcode-handoff.zh-CN.md).

Start with the [current execution progress](./ai-onboarding-xcode-handoff.zh-CN.md#execution-progress). MCP is committed at `8ca70e3` (1.0.17), PC at `821ef05`. Closeout §0.13: 41 PC tests + dev build, 138 MCP offline tests + type-check passed; real dev ticket/Cookie, bound-camp initialization and API environment isolation passed. S08/S09 acceptance retains its documented scope; real channel accounts and mobile-device tests remain pending. Redis/strict ticket lifecycle stays paused; M implementation has not started.

Do not put `APP_SECRET` or Hudson tokens in git, README, or chat logs.

- [M07 统一验收清单](./remote-mcp-m07-acceptance.zh-CN.md)：当前执行位置、环境准备、逐项测试话术和手机/网页证据矩阵。
