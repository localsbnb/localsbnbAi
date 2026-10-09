# 安装 LocalsBnb MCP（海外店）

## 两种用法

**已有门店凭证（直配，原方案不变）：** 在 mcp.json 配置 `APP_SECRET` + `APP_ID`。`APP_SECRET` 即 PC「API keys」里的持久密钥（`/user/secret/generate`），请求头 `hudson-access-token` **不加** `Bearer`。

**新用户（P0）：** 可以不配这两项。MCP 以 bootstrap 模式启动，只暴露注册/登录工具。登录/注册返回的短期 JWT 请求时会加 `Bearer`；拿到门店后调用 `/user/secret/get`（没有则 `/user/secret/generate`），把长期 App Secret 写到本机 `~/.localsbnb/credentials.json`（权限 600），下次启动自动复用，行为与直配 `APP_SECRET` 相同。**不要把 token 发到聊天里。**

`hudson-access-token` 规则摘要：

| 来源 | 是否加 `Bearer` |
|------|----------------|
| `sign-in` / `sign-up` 返回的登录 JWT | 要 |
| `/user/secret/generate`（或 get）/ 直配 `APP_SECRET` | 不要 |

Google 登录尚未支持。Airbnb 授权（P1）走 Handshake 网页，见下文。

**不用**配置 `REGION`。启动时若已有 campId，会自动识别海外店。

## Cursor / Claude Desktop

已有凭证：

```json
{
  "mcpServers": {
    "LocalsBnb MCP": {
      "command": "npx",
      "args": ["--yes", "localsbnb-mcp-server"],
      "env": {
        "APP_SECRET": "<你的 APP_SECRET>",
        "APP_ID": "<你的 APP_ID>"
      }
    }
  }
}
```

新用户（无凭证）：

```json
{
  "mcpServers": {
    "LocalsBnb MCP": {
      "command": "npx",
      "args": ["--yes", "localsbnb-mcp-server"]
    }
  }
}
```

对模型说：「帮我注册 LocalsBnb」或「用邮箱登录 LocalsBnb」。生产环境登录可能要第二次提供邮箱 MFA 验证码。

可选环境变量：

- `LOCALSBNB_CREDENTIALS_PATH`：自定义凭证文件路径
- `LOCALSBNB_LOGIN_MFA=0` / `1`：强制关/开登录 MFA（默认：连 hudson-prod 时开启）
- `LOCALSBNB_SITE_URL`：Handshake 站点。**完整 Airbnb OAuth 用** `https://overseas-dev.localhome.cn`（已发版）。仅测开链/种 cookie 时才用 `http://localhost:3000`
- `LOCALSBNB_OPEN_BROWSER=0`：禁止 `start_handshake` 自动打开系统浏览器
- `LUKEYUN_API_BASE_URL`：Hudson 地址（本地常用 `https://hudson-dev.localhome.cn`）

## P1 Airbnb Handshake（overseas-dev 已发版）

**状态（2026-10-09）：** S05/S06 开链已通过；S08/S09 人工验收已通过（S08 暂无真实渠道账号；S09 含真实写入与脏净房）。AI 唤起的浏览器页须支持手机（交接第 0.12 节）。S07 暂停；S10 Airbnb 真连暂缓。本地开发请指向 `dist/run.cjs`，Cursor 推荐服务名 **`Locals Overseas`**。详见[交接文档](./ai-onboarding-xcode-handoff.zh-CN.md)。

**后续：** 提交 MCP 工作区；发布海外 PC 移动端改动到 overseas-dev；有渠道/Airbnb 测试账号后补真连。

Cookie 不能跨域：Handshake 页和 Airbnb `redirect_uri` **必须同一主机**。Airbnb 已登记回调为 `https://overseas-dev.localhome.cn/channel/airbnb/callback`，**完整授权不要用 localhost**。

**推荐（完整 OAuth）：**

```json
{
  "mcpServers": {
    "LocalsBnb MCP": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "env": {
        "NODE_ENV": "development",
        "LUKEYUN_API_BASE_URL": "https://hudson-dev.localhome.cn",
        "LOCALSBNB_SITE_URL": "https://overseas-dev.localhome.cn"
      }
    }
  }
}
```

指向 `dist/run.cjs` 时先 `npm run build` 再重启 MCP。无凭证时先对话注册/登录。门店 `isBnb===1` 时才会出现 Handshake 工具。

| 工具 | 对模型说 |
|------|----------|
| `start_handshake` | 连接 Airbnb（先尝试打开浏览器，失败再给链接） |
| `poll_handshake` | 我已完成 Airbnb 授权 |
| `list_channel_accounts` | 已绑定的 Airbnb 账号 |
| `import_airbnb_listings` | 导入 Airbnb 房源（先预览，再 `confirm=true`） |

完成后回到对话发送「我已完成 Airbnb 授权」，模型应 `poll_handshake`，再 `import_airbnb_listings` 预览（不要在同一轮 `confirm=true`）。

跟进清单（Xcode）：[ai-onboarding-xcode-handoff.zh-CN.md](./ai-onboarding-xcode-handoff.zh-CN.md)。

**仅本地测开链：** 海外 PC `next dev` 占 3000，且 `LOCALSBNB_SITE_URL=http://localhost:3000`。该路径跳转 Airbnb 后回调不会回到 localhost。

## 启动时做什么

无凭证：只注册 `sign_up_check`、`send_signup_email_code`、`complete_sign_up`、`sign_in`。

有凭证：

1. 用 `APP_ID` 或本地文件中的 campId 调 `POST /camp/get`
2. `isBnb !== 1` → 走国内现网工具（逻辑不变）
3. `isBnb === 1` → 再拉语言/时区/货币/日期格式，注册海外 Adapter，并开放入住、退房、续住、换房

语言无法识别时默认 **英语**。Hudson 暂无韩语，韩国店用英语。

## 建议先问

「帮我注册」或「今天预抵」「今天房态」「本周入住率」。

写操作会先预览，需再次传入 `confirm=true` 才会执行。

## 安全

令牌只放本机环境变量或 `~/.localsbnb/credentials.json`。曾经在聊天里出现过的 token 建议作废换新。
