# 独立远程 MCP：本地运行与交接

更新：2026-10-10。M04–M06 的会话、业务工具、持久确认和四渠道开链已接入独立入口；M07 进入统一人工验收准备。**本机验证不代表 dev 发布或 ChatGPT/Claude 真连通过。** 验收入口：[M07 清单](../../docs/overseas/remote-mcp-m07-acceptance.zh-CN.md)。

## 1. 当前结构与边界

- 原 `npm start`、`npm run dev`、本地 bin、stdio SDK、账号文件和 APP_SECRET 使用方式保留。
- 远程服务使用独立 SDK 别名、环境变量、PostgreSQL `mcp_auth` schema、Redis 和 AES-GCM 密钥；不加载根 `.env` 或 `~/.localsbnb/credentials.json`。
- 所有用户身份由 OAuth 确定；不同对话使用独立 `sessionId`，同一会话串行执行。切店只允许已单独授权的门店，并使旧预览/渠道流程失效。
- `LOCALSBNB_REMOTE_BUSINESS_ENABLED=0` 默认只开放连接检查；`1` 开放按 scope 过滤后的查询、写入预览/确认及渠道工具。
- 业务工具访问固定 dev/prod Hudson，不接受模型覆盖域名、认证或跨店 campId。写入不自动重试，结果未知时持久记录并要求回查。
- 远程浏览器开链返回 HTTPS URL；手机自行打开，服务端不调用本机浏览器。

## 2. 本机 Docker

先启动 Docker Desktop，Node 使用 22。本轮已在本机启动 PostgreSQL、Redis 和 MCP 容器，仅发布 loopback 端口。

```bash
# 只启动原有本地存储，命令保留
npm run dev:remote:storage
```

专用存储配置为 `deployment/remote/.env.local`，权限 0600、Git 忽略。PostgreSQL 默认 `127.0.0.1:55432`，Redis 默认 `127.0.0.1:56379`；独立数据卷，Compose project 为 `localsbnb-mcp-local`。

首次使用复制 `runtime.env.example` 为 `.env.runtime.local`，权限设为 0600，填写数据库/Redis、独立加密 key、预登记 OAuth 客户端和独立握手服务密钥。本轮已创建本机专用配置，请保留既有密钥，不覆盖、不提交。当前占位 issuer 为 `https://mcp.example`，client 为 `local-acceptance`，回调为 `https://client.example/cb`，仅用于本地验证，**不能用于真实平台登录**。

```bash
docker compose --project-name localsbnb-mcp-local --env-file deployment/remote/.env.local -f deployment/remote/compose.yaml -f deployment/remote/compose.runtime.yaml build mcp

# 显式迁移，不由服务启动隐式执行；只涉及独立 MCP schema
docker compose --project-name localsbnb-mcp-local --env-file deployment/remote/.env.local -f deployment/remote/compose.yaml -f deployment/remote/compose.runtime.yaml run --rm --no-deps mcp node dist/remote/migrate.js

docker compose --project-name localsbnb-mcp-local --env-file deployment/remote/.env.local -f deployment/remote/compose.yaml -f deployment/remote/compose.runtime.yaml up -d mcp

# 当前本机占位 issuer 的 Host 校验
curl -H 'Host: mcp.example' http://127.0.0.1:8787/readyz
```

Docker 内监听 `0.0.0.0:8787`，宿主只映射 `127.0.0.1:8787`。非 root 用户、只读容器文件系统、去除 Linux capabilities。Dockerfile 专属 ignore 只允许源码、编译配置、依赖清单与 SQL 进入构建上下文，排除 `.env`、凭证和工作文档。

远程镜像使用 `deployment/remote/npm-shrinkwrap.json` 冻结依赖；此锁只用于远程构建，根目录原来的锁文件策略不变。依赖变化后重新生成并同步该锁，然后重新执行镜像构建。镜像仅本地构建，未推送 registry。

本轮已永久应用本地 `001-auth-grants.sql` 和 `002-work-items.sql`。集成测试仍在单独事务中执行并回滚，不清空已有数据。

## 3. 不使用容器运行 Node 服务

```bash
node --env-file=deployment/remote/.env.runtime.local --import tsx scripts/migrate-remote.ts
node --env-file=deployment/remote/.env.runtime.local --import tsx src/remote/runtimeIndex.ts
```

不要与同端口 Docker 服务同时启动。原生进程默认只监听 `127.0.0.1`。已经由环境注入配置时使用 `npm run dev:remote`，编译后使用 `npm run start:remote`；原 stdio 启动命令不变。

`PUBLIC_ORIGIN` 必须是 HTTPS origin。Host 必须匹配配置，代理应保留该 Host；Cookie 为 Secure，普通 `http://localhost` 页面不能作为浏览器授权验收。正式 PostgreSQL 必须校验 TLS，Redis 必须使用 `rediss`。

## 4. 路由与授权

| 路由 | 用途 |
|---|---|
| GET `/healthz` | 进程健康 |
| GET `/readyz` | 校验表结构与 Redis；业务开关开启返回 `mode=business`；存储故障 503 |
| GET `/.well-known/oauth-authorization-server` | OAuth 发现 |
| GET `/.well-known/oauth-protected-resource/mcp` | MCP 资源发现 |
| GET/POST `/authorize` 及其 login/consent 路由 | 登录、MFA、门店选择和授权同意 |
| POST `/token` | 授权码 + PKCE S256、令牌刷新 |
| POST `/revoke` | 撤销 token family 和其持久授权；尚未兑换的相关 ticket 也失效 |
| POST `/mcp` | 每请求认证，Streamable HTTP initialize/list/call |
| POST `/internal/handshake/redeem` | 仅 PC 服务端兑换，独立 Bearer 服务密钥；浏览器 Origin 请求拒绝 |

OAuth 客户端预登记，支持 public `none` 和 confidential `client_secret_basic`。没有 DCR/CIMD 自动注册接口，不要在平台选择自动注册。回调 URI 必须使用平台实际提供的值精确登记，不能猜测。用户登录凭证不是 OAuth client secret。

访问令牌最多 10 分钟，刷新及授权最长 7 天；刷新轮换 token，旧 refresh 重放撤销授权。每次认证复核 PostgreSQL，数据库/Redis 故障不回退共享身份。OAuth 授权撤销不清除已经建立的独立 PC Cookie；PC 退出登录仍由原系统负责。

登录桥接重查当前用户和可用门店，仅读取 `/user/secret/get`。**缺少已有 Secret 的账号返回 `credential_setup_required`，不会调用会重置凭证的 `/user/secret/generate`。** 新账号自动开通还缺 Hudson 幂等获取/创建能力，本轮没有修改 `locals-hudson-provider`。

Redis 限流按 socket 来源计数：登录 10 次/分钟，其余受限请求 120 次/分钟，忽略 `X-Forwarded-For`。当前反代共享来源额度，正式发布前须按可信代理及容量调整；M07 先小规模验收。

## 5. PC 配置与四渠道流程

PC 仓库新增 `/ai/connect/[ticketId]` 与服务端兑换适配器，复用旧 Cookie、门店初始化、Airbnb 回调和各渠道连接页面。原 `/ai/handshake` 不改变。

PC **仅服务端**注入：

```dotenv
MCP_REMOTE_ORIGIN=https://实际MCP域名
MCP_HANDSHAKE_SERVICE_SECRET=与MCP的LOCALSBNB_REMOTE_HANDSHAKE_SECRET一致
```

密钥不能使用 `NEXT_PUBLIC_` 前缀。PC 构建必须为相同 dev/prod 环境；返回环境不匹配即拒绝设置 Cookie。密钥不放 URL/页面 props；跨服务响应包含业务 Token，只在服务端处理。

1. 每个对话先 `open_property_session`，后续工具携带其 sessionId。
2. `start_channel_connection` 支持 Airbnb/Booking/Trip/Agoda，先保存渠道快照，再返回 120 秒 ticket URL。
3. 用户打开后一次性兑换并设置原 PC 登录 Cookie/绑定门店，Airbnb 继续授权和导入；其余渠道进入原连接页面。
4. 用户返回只回复“已完成”，调用 `complete_channel_connection`，比较门店/房型/价格方案映射，账号变化不算完成。
5. 流程最多保持 1 小时；同一会话重新开链保留原始基线，得到新 ticket。链接过期/被预取消费时可重开。显式 prefetch 请求不消费。

## 6. 持久化、恢复与边界

`work_items` 的 payload 加密，身份/会话摘要隔离，使用版本号 CAS。会话 24 小时；渠道基线 1 小时；待确认预览 10 分钟；写入结果保留至少 24 小时；running/unknown 不按过期预览清理。

写预览绑定工具、门店、参数、资源快照、币种和时区。确认前重新查询当前资源；参数或快照变化即拒绝旧预览。入住/退房远程模式一次仅允许一个订单明细。

写入前持久标记 running，再调用 Hudson。传输中断或未明确确认成功记 unknown；进程在请求期间退出也保持 running，状态查询按 unknown 提示。不能据此自动重试。`get_operation_status` 可查看结果，不是重新提交入口。同一会话未解决 unknown 时拒绝新预览；另开会话不是解决未知业务结果的方法。

会话锁崩溃后不会自动解锁重新提交；需先人工核对关联资源，再新建会话继续。原子确认防止 MCP 重复发起同一预览，不能替代 Hudson 的业务幂等键，也不保证外部系统端到端 exactly-once。M07 必须验结果未知场景。

## 7. 回归与停止

```bash
npm run type-check
npm test -- --runInBand --watchman=false --testPathIgnorePatterns overseas.live.test.ts overseas.smoke.test.ts
npm run test:local:compat
npm run test:remote:storage
npm run test:remote:runtime
npm run test:remote:runtime:business
npm run test:remote:business
```

存储/HTTP 测试使用本地 PG/Redis、模拟 Hudson，不产生真实订单/渠道导入。实时 live/smoke 未纳入本轮；旧 Token 无效记录不算已解决。

停止 MCP 保留存储：

```bash
docker compose --project-name localsbnb-mcp-local --env-file deployment/remote/.env.local -f deployment/remote/compose.yaml -f deployment/remote/compose.runtime.yaml stop mcp
```

停止全部时使用同样命令 `stop`。保留数据卷与两个私有 env 文件。回退可将业务开关设为 0，或停止 MCP 容器；不会停止原 stdio，也不会重置本地 APP_SECRET。不得删除密钥后重新生成来“恢复”既有加密数据。

## 8. Jenkins 构建与推送（2026-10-12）

仓库根目录新增 `Jenkinsfile`，参考海外 PC 流水线，执行检出、构建和推送。使用 `deployment/remote/Dockerfile`，构建上下文为仓库根目录。

- 镜像仓库：`registry.cn-shenzhen.aliyuncs.com/locals-wing/localsbnbai`。
- 标签沿用分支名：`dev` → `:dev`，`main` → `:main`，`feature/example` → `:feature-example`。不额外推送 `latest`。
- 分支只决定镜像标签，**不会自动切换 Hudson 环境**。dev/prod、域名、数据库、Redis、OAuth 客户端和密钥仍由部署环境注入。
- 使用凭证 ID `aliyun-acr-cred`（Username with password），需有此仓库的推送权限。登录配置只在推送步骤临时保存并清理，不改 Jenkins 节点的共享 Docker 登录配置。

Jenkins 配置步骤：

1. 节点安装 Docker CLI，并能访问 Docker daemon、基础镜像、npm registry 和阿里云镜像仓库。
2. 在作业可访问的凭证范围内配置 `aliyun-acr-cred`。
3. 创建多分支 Pipeline，或使用普通 Pipeline from SCM；选择本仓库和目标分支，Script Path 填 `Jenkinsfile`。
4. 确保本轮新增的 Jenkinsfile、远程源码、Dockerfile、`npm-shrinkwrap.json` 和 SQL 迁移已提交到构建分支；私有 `.env` 文件不提交。
5. 运行后检查“构建镜像”和“推送镜像”阶段，确认目标分支标签已更新。

本流水线负责构建/推送，尚未加入远程 SSH、容器更新或数据库迁移阶段。镜像推送成功不代表远程服务已更新；服务器需拉取对应镜像，注入专用配置，执行显式迁移并更新容器，再检查 `/readyz`。目前未触发 Jenkins，也未执行镜像推送。
