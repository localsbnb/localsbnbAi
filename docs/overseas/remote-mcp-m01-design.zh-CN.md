# M01 接入设计与后端复用核查

> 本文保留 M01 架构核查过程。2026-10-10 当前进度已到 M07 统一验收准备；最新实现、已测范围与缺口见 [M 计划](./remote-mcp-multiplatform-plan.zh-CN.md) 和 [M07 清单](./remote-mcp-m07-acceptance.zh-CN.md)。

**早期入口记录（2026-10-10，本轮后续进展见顶部）：** `runtimeIndex.ts` 已接入专用配置、PG 连接池、Redis、OAuth/浏览器同意和受保护 MCP。原入口不变，远程只监听 loopback，不自动加载本地凭证或迁移。真实 PG/Redis 全链路验证通过（Hudson 替身）；246 项离线测试和原两种 stdio 启动验证通过。当前仅授权连接预览工具，尚无业务工具；HTTPS/域名、真实账号与手机验收待完成。下文保留各阶段设计记录。

## 早期实施记录（2026-10-10）

`HudsonLoginBridge` 与 `createBrowserAuthorization` 已完成并接入可注入的 OAuth 路由。身份取自 `/user/own/get`，门店取自 `/camps/get`，同意前重新校验。浏览器事务加密保存，绑定 Cookie/CSRF，拒绝授权不获取 Secret；签发授权码失败撤销本次 grant。

核查发现 `/user/secret/generate` 会替换已有 AI 用户 Token，因此远程流程禁止调用；只取 `/user/secret/get`。缺少 Secret 的新账号需要后续幂等开通接口，避免破坏原本地部署。

18 套件、235 项离线测试通过，编译/lint 和两种本地 stdio 入口握手通过。未修改 Hudson 代码、未真实登录或调用线上写接口。独立服务入口、实际限流、真实账号/存储和手机验收仍未完成；下文为此前各阶段设计记录。

> 2026-10-09；架构方向已确认，域名待分配，现网存储版本/连接和登录桥接契约待联调。不是上线完成记录。

## 已确认

用户确认沿用现有服务器与 Jenkins，并指定评估 `/Users/lijitao/loclas/locals-hudson-provider`。可复用该项目的业务、用户体系及存储基础，不需要复制酒店主数据。

建议分工：

| 项目 | 责任 |
|---|---|
| localsbnbAi（TypeScript） | MCP 协议适配、请求认证、工具调用及平台兼容；保留本地 stdio |
| locals-hudson-provider（Java） | 现有用户/门店权限校验与业务接口；MCP 不直接修改 Hudson 业务表 |
| overseas/localsbnb（Next.js） | 登录授权页面、渠道 Handshake、手机网页交互 |

这是共用现有后端加一个独立运行的 MCP 网关进程，不是重建业务后端。用户已确认没有现成 OAuth 服务，独立 MCP 服务将新增授权模块，复用 LocalsBnb 登录校验与网页体验。数据库/Redis 可由独立服务直接使用，须独立 schema/账号/key 前缀；仍不在授权能力未完成时发行可访问真实业务的令牌。

## 代码证据

- MCP `src/index.ts` 只有 stdio 入口；当前 SDK 依赖为 `@modelcontextprotocol/sdk ^0.5.0`。新增远程入口使用独立 SDK 别名 1.32.1，既有 stdio 依赖保持不变，不能仅增加一个 HTTP 路由就认定协议可用。
- `src/auth/apiKeyManager.ts` 默认从全局环境/本机凭证文件加载；`src/server.ts` 的 `applyHudsonSession` 会写回本机凭证。远程模式必须独立注入身份，禁止调用该本地登录持久化路径。
- `PermissionChecker` 对仅有 Hudson 凭证的调用交给后端授权。远程服务还需要独立验证平台令牌的受众、用户、权限和撤销状态，不能因为 Hudson 凭证有效就跳过平台授权。
- Hudson `AGENTS.override.md` 和 `docs/ai/01-architecture.md` 记录默认 `mysql1` 实为 PostgreSQL/hudson，另有分析 PostgreSQL 和遗留 MySQL；名称不是数据库类型证据。
- Hudson `OverseasRedisConfig` 提供海外 Redis 配置；确认有可复用实现，但未连接实际 Redis/数据库，也未读取或输出配置密钥。
- Hudson `pom.xml` 有 Spring OAuth Authorization Server 依赖，同时排除了多项组件；`SecurityConfig` 只配置密码编码器。对标准授权配置类/端点字符串的限定搜索未找到实现，因此不能凭依赖存在断言已有 OAuth 授权服务。OTA OAuth 客户端与对外提供 OAuth 授权是不同职责。

后端本地规则以 `AGENTS.override.md` 为入口。本轮后端仅只读核查，没有修改 Java、数据库或部署配置，也没有运行后端测试。

## 第一部分代码落地

`src/remote/config.ts` 新增纯配置校验器，尚未接入启动入口：

- 强制显式选择 dev/prod，不继承现有默认 production 行为。
- MCP 公网 origin 必须是无凭证、路径、查询和片段的 HTTPS origin。
- 当前允许的 Hudson/网页组合与已知 dev/prod 站点对应；新增 UAT、别名或路径部署需要单独配置设计及回归。
- 拒绝把 APP_SECRET、APP_ID 等本地配置带入远程服务，避免成为多用户共享身份。
- 校验监听端口；错误信息只输出配置键，不输出输入值。
- 该函数不读取本机文件，不导入 dotenv，不启动端口，不调用业务接口。后续入口必须主动调用才形成启动保护；后续本机模拟入口已提供 `/mcp`，尚未提供生产业务入口。

`tests/remote.config.test.ts` 27 项通过，覆盖环境混用、凭证误带、URL 泄露和错误端口；源码类型检查与新增文件 lint 通过。未替换既有 stdio SDK，未覆盖现有 dist。

## 尚待确定的接口边界

1. MCP dev 对外域名及代理路由：使用独立子域名还是已有域名反代；校验器目前按根路径 `/mcp` 草案。
2. OAuth：已确认没有现成服务，由独立 MCP 服务新增授权模块，PC 提供授权同意界面。PKCE、发现元数据、客户端注册策略、续期和撤销需要完整契约。
3. 状态访问：MCP 授权记录使用独立 PostgreSQL schema，短期授权码使用 Redis；生产密钥管理和 Hudson 登录桥接契约待确认。
4. 流程定位：业务流程 ID 不依赖宿主提供聊天 ID，不把 MCP transport session 当作身份。多条待办有歧义时必须明确选取，不可把另一个流程的“已完成”自动应用。
5. 外部协议端点返回标准 OAuth/MCP JSON 和 HTTP 状态，不应统一包进业务 `RestResponse`；业务适配接口仍遵循 Hudson 项目约定。

## 下一动作

- dev 域名待分配；当前按用户选择先进行本地 Docker 开发。
- 授权模块归属已确定；继续实现并核验服务端登录桥接接口。
- M02 继续实现独立 HTTP 入口、经过验证的身份注入与模拟工具联调，先关闭真实业务访问；随后对接 M03/M04。
- M05/M06 再推进持久化与渠道消费；本次未提前恢复旧 S07 的线上存储改造。

公开协议参考：[MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/client)。协议层会演进，实际支持版本与两平台协商结果应在 M02 单独锁定和记录，业务状态不依赖特定版本的 transport session。

## 用户确认与本轮推进

用户已确认：独立服务可以直接接入数据库/Redis；使用与 Hudson 一致的组件；没有 OAuth 授权服务；域名尚未分配。

- PostgreSQL/Redis 类型确定。现网版本未查证，不把 Java 驱动版本或配置字段当作数据库服务端版本。
- 新增独立 SDK 别名 `mcp-remote-sdk`（官方 1.32.1）；保留 stdio SDK 0.5.x 与原入口。
- M02 loopback 原型：`npm run dev:remote:mock`，有 `/mcp` 与健康检查，只有模拟连接检查工具；SDK initialize/list/call、并发请求、Host/Origin、请求大小与 JSON 错误测试通过。并发测试不等于真实多用户身份隔离验收。
- 本地 Docker 已启动，PostgreSQL 16.15 / Redis 7.2.16 均健康；端口仅绑定 127.0.0.1:55432 / 56379。
- M03 授权码核心：S256、预登记 HTTPS 回调精确匹配、resource/client/scope 绑定、120 秒有效期、摘要 key、原子消费。17 项单元测试通过；真实 Redis Lua 验证 12 路并发仅一次兑换成功，并通过重放拒绝和真实 TTL 检查。
- 新增 PostgreSQL 授权记录存储与 AES-256-GCM 加密；真实数据库验证客户端/resource 隔离、篡改拒绝、撤销和过期，迁移及测试数据事务回滚。

### OAuth 实施边界

先使用预登记的 Web 客户端回调，后续再按平台要求增加客户端注册机制。服务负责签发面向 MCP 的令牌，Hudson JWT/App Secret 不直接充当平台访问令牌。

授权同意必须来自已经服务端验证的登录身份：待实现的网页/后端桥接校验登录、权限及 CSRF，建立 approved grant，之后才可调用授权码核心。当前 `ApprovedGrant` 是内部数据类型，不是身份验证实现，不能接受浏览器直接填 userId、grantId 或 campId。

兑换授权码前需客户端认证；消费后、发行令牌前需复核 grant 未撤销。失败时要求重新授权，不恢复已消费码。刷新令牌轮换、撤销、重放检测与访问令牌校验核心已实现并通过本地真实存储测试；发现元数据与令牌 HTTP 路由组件已完成；登录页、授权同意及独立部署入口未完成；`/readyz` 继续 503。

下一步：本机 Docker 与真实存储测试已完成，继续连接服务端登录校验、授权同意及 OAuth 路由。域名未分配期间只推进本机受限测试，不宣称 ChatGPT/Claude 真连可用。

2026-10-09 验证：14 套件、198 项本地测试通过；新增模块 lint 与 TypeScript 编译通过，输出 `/tmp/localsbnb-mcp-m03-build`，未覆盖现有 dist。独立存储集成测试已连接本机 PostgreSQL/Redis 并通过。默认完整 Jest 命令同时运行两套旧真实接口测试，其中 9 项因 Token 无效失败；完整回归不能标记为全通过。未执行真实渠道授权或导入，未部署 dev。


### 后续推进：令牌与本地兼容性

2026-10-09 新增 `OAuthTokenService` 和 Redis family 原子更新适配器；访问令牌最多 10 分钟，刷新 family 最多 7 天，绑定客户端/resource/scope/授权记录；刷新重用撤销 family，每次调用复核数据库授权。尚未接入 HTTP，更未发行业务访问令牌。

本轮 15 套件、209 项离线回归通过，类型检查、新增代码 lint 通过；真实 PostgreSQL/Redis 验证包含令牌轮换、12 路并发与重放撤销、主动撤销、数据库授权撤销。SQL 测试全部回滚。

用户要求保留本地部署方式：原入口、启动/构建命令、安装脚本、SDK 和本地凭证路径均保持原实现。`test:local:compat` 通过实际 stdio 握手验证 `index.js` 与 `run.cjs`；测试构建移除 remote 目录后仍可启动，原 dist 未覆盖。本轮不重跑依赖真实账号的 live/smoke；其上轮失败仍待有效账号验收。

下一步继续完成登录/同意桥接和 HTTP OAuth 接入，不将令牌核心完成等同 M03 全部完成。


### 后续推进：HTTP 路由组件

已实现固定 issuer 的发现元数据、`/token` 授权码兑换/刷新、`/revoke`，预登记客户端认证、表单大小限制、参数及 Host/Origin 校验、标准错误和禁用缓存。路由工厂必须注入限流策略，但实际部署限流尚未配置。`/authorize` 与 `/readyz` 仍 503；不改变原模拟入口，不宣称公网 OAuth 可用。

本轮 16 套件、220 项离线测试通过，其中新增 11 项 loopback HTTP 测试；完整临时编译和新增模块 lint 通过。本地 `index.js`、`run.cjs` 实际 stdio 握手复测通过。未访问线上、未提交、未部署。

下一步：实现可信登录/授权同意与 `/authorize`，随后组装独立服务入口并串联真实存储；验证 CSRF、会话绑定、用户门店权限和拒绝授权流程。
