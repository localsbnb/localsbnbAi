# 海外 AI Handshake：ticket 结果回写与 PC 直连 Redis

| 项目 | 说明 |
|------|------|
| 文档名称 | 海外 AI Handshake ticket 结果回写与 PC 直连 Redis 方案 |
| 产品 | LocalsBnb 海外 AI（MCP）+ 海外 PC |
| 版本 | v1.0 |
| 状态 | 待技术负责人审核 |
| 日期 | 2026-10-08 |
| 目标环境 | hudson-dev + `https://overseas-dev.localhome.cn` |
| 关联文档 | [交接](./ai-onboarding-xcode-handoff.zh-CN.md)、[总方案](./ai-onboarding-ops-plan.zh-CN.md) |

请审核人确认文末的 4 项决定。确认前不改业务代码。

---

## 1. 审核结论（建议）

建议采用 **海外 PC 服务端直连同一台 Redis** 保存 Handshake ticket，并由回调把这一次授权写成 `succeeded` 或 `failed`。AI 在用户表示「已授权完成」后，按这张 ticket 查询终态。

不建议本期改由 Hudson 新做存储接口，也不建议继续用账号列表变化判断授权是否成功。MCP 不连接 Redis。

## 2. 术语

| 术语 | 含义 |
|------|------|
| MCP / AI | 对话宿主里的 `localsbnb-mcp-server`。已持有门店 App Secret 与 `campId` |
| 海外 PC | Next.js 站点，仓库 `overseas/localsbnb` |
| ticket | 一次性、25 分钟有效的服务端记录。浏览器 URL 里只有 `ticketId` |
| pollSecret | 创建 ticket 时发给 MCP 的查询密钥。只拿 `ticketId` 不能查询结果 |
| 终态 | `succeeded` 或 `failed`。未回调完成前是 `pending` / `opened` |

## 3. 背景与已验证事实

连接 Airbnb 必须打开浏览器（手机或桌面均可）。MCP 与浏览器不是同一个会话，因此用 ticket 把已登录的门店凭证交给 Handshake 页面。

已上线并验证的部分：

1. MCP 调用 `POST /api/ai/handshake/create`，凭证在请求头 `hudson-access-token`，不进 URL。
2. PC 用该凭证调用 Hudson `POST /camp/get`，门店匹配后创建 ticket。
3. 返回的 `openUrl` 为 `https://overseas-dev.localhome.cn/ai/handshake/{ticketId}`。
4. 打开页面时服务端把 ticket 中的 token 写成 Cookie：`localsbnb_auth_token`、`localsbnb_auth_token_expiry`（15 天）。2026-10-08 已确认浏览器能拿到登录态并到达 Airbnb 授权页。

因此 **MCP 与 PC 页面的 token 已经一致**。本期不再做第二套登录同步。

## 4. 仍存在的问题

ticket 当前写在处理请求的那台机器的临时文件 `os.tmpdir()/localsbnb-ai-handshakes.json`。状态只有 `pending → opened`。类型里声明了 `consumed`，没有写入逻辑，也没有 `succeeded` / `failed`。

授权跳转的 OAuth `state` 只有 `n`（nonce）、`c`（campId）、`src=ai`，没有 `ticketId`。Airbnb 回调页在浏览器里调用 Hudson `/oauth/code-authorize`，换码结果不写回 ticket。

`poll_handshake` 不读这张票的结果。它比较授权前的 Airbnb 账号列表：出现新 `accountId`，或已有账号的 `lastSyncTime` 变化，就回报成功；否则一直 `pending`。

由此有四类错误：

| 场景 | 当前结果 |
|------|----------|
| 用户还在 Airbnb 页面上 | 账号列表没变，只能一直显示等待 |
| 同一个账号再次授权 | 通常没有新 `accountId`，用户说完成后仍是等待 |
| 后台同步改了 `lastSyncTime` | 用户尚未授权完，却可能被判成功 |
| 用户拒绝或换码失败 | 没有失败态，AI 只能说还没有新账号 |
| 创建与打开落在不同 PC 实例 | 另一台读不到临时文件，页面表现为票过期，Cookie 不会写入 |

用户说「我已授权完成」适合作为开始查询的时机。现有工具已经是这个时机。这句话不能代替这一次授权的结果。

## 5. 方案比较

| 方案 | 做法 | 评价 |
|------|------|------|
| PC 直连 Redis（建议） | 所有 PC 实例用服务端 `REDIS_URL` 读写同一批 ticket | PC 可独立完成落库、TTL 和并发更新。Hudson 不用发版 |
| Hudson 存储接口 | Hudson 新增创建、打开、完成、查询接口，PC/MCP 只调用 | 存储归后端，但接口目前不存在，S07 要等 Hudson 排期和 dev 可用 |
| 暂时单实例文件 | 继续写本机临时文件 | 只能覆盖单进程。不能作为多实例通过 |

## 6. 目标流程

```text
AI start_handshake
  → PC 创建 ticket（Redis，pending）并返回 openUrl + pollSecret
  → 系统浏览器打开 /ai/handshake/{ticketId}
  → PC 原子更新为 opened，写 Cookie，跳转 Airbnb（state 含 ticketId、campId、src=ai）
  → 用户在 Airbnb 授权或拒绝
  → 回调页换码结束后调用 PC 完成接口
  → Redis 中该票变为 succeeded 或 failed
  → 用户回到对话并表示已完成
  → AI poll_handshake 用 ticketId + pollSecret 查询
  → succeeded 才进入房源预览；failed 则说明原因并停止
```

用户未表示完成时，AI 不把「还没有新账号」说成失败。用户表示完成后，以 ticket 终态为准，不再以账号列表变化为准。

## 7. ticket 规则

状态只允许：

```text
pending → opened → succeeded
                 → failed
pending 或 opened 超过 TTL → 读取时视为 expired（key 由 Redis 删除）
```

| 规则 | 说明 |
|------|------|
| TTL | 25 分钟，与现网 create 返回的约 1500 秒一致 |
| 打开 | 仅 `pending` 可变为 `opened` 并下发 Cookie。再次打开不再下发 Cookie、不再跳转授权 |
| 完成 | 仅 `opened` 可变为 `succeeded` 或 `failed`，且只能一次 |
| 门店 | 完成与查询中的 `campId` 必须与票内一致，否则拒绝 |
| 查询 | 必须同时提供 `ticketId` 与 `pollSecret`。响应不返回 token |
| 成功载荷 | `accountId`。没有 `accountId` 不得写成 `succeeded` |
| 失败载荷 | 稳定错误码与可诊断说明，不包含 token、Cookie、OAuth code |

`pollSecret` 只保存在 MCP 本机的 handshake 记录里，不放进浏览器 URL。

## 8. Redis 设计

| 项 | 约定 |
|----|------|
| 连接 | 运行环境变量 `REDIS_URL`。禁止使用 `NEXT_PUBLIC_` 前缀，因此不需要打进前端构建参数 |
| Key | `ai:handshake:{ticketId}` |
| Value | JSON：`ticketId`、`pollSecretHash`、`type`、`campId`、`token`、`status`、`accountId`、`errorCode`、`errorMsg`、`createdAt`、`expiresAt` |
| 过期 | `SET` 时带 TTL。过期后 key 不存在，查询返回 `expired` |
| 并发 | 打开与完成用 Lua 脚本按当前状态条件更新。两个实例同时完成时只有一个成功 |
| 未配置 | 部署环境缺少 `REDIS_URL` 时，创建与打开直接失败，不再退回临时文件 |

浏览器和 MCP 都不连接 Redis。MCP 只调用 PC 的 HTTPS 接口，由 PC 读写 Redis。

本地单测注入内存存储。多实例是否通过，只认发布后「实例 A 创建、实例 B 打开并查询」的结果。

## 9. PC 与 MCP 改动

### 9.1 海外 PC

| 位置 | 改动 |
|------|------|
| `lib/ai/handshakeStore.ts` | 文件读写改为 Redis。保留 create / open，新增 complete / getStatus |
| 新依赖 | `ioredis` |
| `pages/api/ai/handshake/create.ts` | 创建成功时把 `pollSecret` 返回给 MCP，不写入 `openUrl` |
| 新接口 `POST /api/ai/handshake/status` | 入参 `ticketId`、`pollSecret`。返回状态；`succeeded` 时带 `accountId` |
| 新接口 `POST /api/ai/handshake/complete` | 入参 `ticketId`、`campId`、`status`、`accountId` 或错误信息。仅回调页所在源站可调用，并校验门店 |
| `lib/airbnb/oauth.ts` | `state` 增加 `ticketId`。原有 `n`、`c`、`src` 保持 |
| `pages/ai/handshake/[ticketId].tsx` | 把 `ticketId` 带入授权 URL。非 `pending` 时展示终态或过期，不写 Cookie |
| `pages/channel/airbnb/callback.tsx` | `src=ai` 时，Hudson 换码结束后调用 complete。成功写 `succeeded`，拒绝或换码失败写 `failed` |
| 部署 | 容器运行环境增加 `REDIS_URL` 后重启。现有 `docker-compose.yml` 未声明该变量 |

本期回调仍由浏览器调用 Hudson `/oauth/code-authorize`，不把换码改到 PC 服务端。complete 只负责记下这次结果。

### 9.2 MCP

| 位置 | 改动 |
|------|------|
| `src/tools/auth/handshake.ts` | 保存 `pollSecret`。`poll_handshake` 改为调用 PC status 接口 |
| 成功条件 | 仅当该 `ticketId` 为 `succeeded` |
| 失败条件 | 该票为 `failed` 或 `expired` |
| 继续等待 | 该票为 `pending` 或 `opened` |
| 移除 | 不再用新 `accountId` 或 `lastSyncTime` 变化判定这次授权成功 |

`start_handshake` 仍只负责建票和打开浏览器。用户表示完成后才查询。房源导入仍是先预览，用户确认后才 `confirm=true`。

## 10. 安全

- token、OAuth code、Cookie 值不进入 URL、日志、文档和聊天。
- Redis 中保存的是服务端 token。`REDIS_URL` 只出现在运行环境，不入库。
- status 接口不返回 token。complete 不接受来自浏览器以外的任意来源；至少校验票内 `campId` 与本次会话门店一致。
- `pollSecret` 在 Redis 中只存哈希。
- 现有 Cookie 仍为 15 天。本期不改 Cookie 时长。

## 11. 实施顺序

1. 技术负责人确认本方案，并指定 overseas-dev 的 Redis。连接信息由部署环境注入，不通过聊天传递密码。
2. PC 完成 Redis 存储、状态接口、`state` 绑定和回调回写，并补单测。
3. MCP 把 `poll_handshake` 改为查询 ticket 终态，并补回归。
4. 本地通过后发布 PC。发布记录写「本地通过、待发布」直到线上复测完成。
5. 线上用两个实例验证创建、打开、完成、查询。没有真实 Airbnb 账号时，用模拟 complete 验证状态机；真实授权闭环仍属后续验收。

## 12. 验收标准

| 编号 | 标准 |
|------|------|
| AC-1 | 创建的票可在另一台 PC 实例打开，并写入与创建时相同的登录 Cookie |
| AC-2 | 同一链接第二次打开不再写 Cookie、不再跳转 Airbnb |
| AC-3 | 并发完成同一张票时只有一个请求成功 |
| AC-4 | 超过 25 分钟后打开和查询都是 `expired` |
| AC-5 | 其他门店不能完成或查询这张票 |
| AC-6 | 模拟换码成功后，`poll_handshake` 返回 `succeeded` 与对应 `accountId` |
| AC-7 | 模拟拒绝或换码失败后，`poll_handshake` 返回 `failed` 与错误码 |
| AC-8 | 用户未完成时状态保持 `opened`，AI 继续等待 |
| AC-9 | 账号列表或 `lastSyncTime` 单独变化时，不会把这张票判为成功 |
| AC-10 | 未配置 `REDIS_URL` 的部署不会静默写回临时文件 |

## 13. 不在本期

- 真实 Airbnb 账号上的授权、回调、导入闭环。
- Hudson 新增 ticket 存储接口。
- 把 OAuth 换码从浏览器改为 PC 服务端接管。
- Google 登录，以及 Booking / Trip / Agoda 连接。
- 改价、开关房、手工录单。
- 修改 Cookie 的 15 天有效期。
- 发布新的 npm 包版本。当前 MCP 工作区仍基于 `main / f9e040c`，尚未提交。

## 14. 风险

| 风险 | 处理 |
|------|------|
| overseas-dev 尚无可用 Redis | 方案不能开始编码。不临时退回单机文件充作多实例方案 |
| Redis 故障 | 创建与打开失败，已有登录态不受影响；不在请求路径上猜测另一台机器的本地文件 |
| 回调页未调用 complete | 票停在 `opened`。AI 继续等待，不会误报成功 |
| 模拟验收被当成真实授权已通过 | 文档和交接里分开记录。真实账号到位后再做端到端验收 |

## 15. 请审核人确认

1. 是否同意本期使用 PC 直连 Redis，而不是 Hudson 存储接口或单实例文件。
2. overseas-dev 的 Redis 由谁提供，以及 `REDIS_URL` 写入哪套运行环境。
3. 是否同意换码仍留在浏览器回调页，只把成功或失败写回 ticket。
4. 是否同意 `poll_handshake` 只认 ticket 终态，不再认账号列表变化。
