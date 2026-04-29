# LocalsBnb AI（路客云 MCP 服务）

LocalsBnb AI 将路客云 PMS 的订单、房态房价、经营分析等核心能力统一封装为 MCP，  
让门店与运营团队在现有沟通入口中即可通过自然语言完成“查询 -> 判断 -> 执行”，减少系统切换、提升协同效率。

服务可接入 OpenClaw、Hermes Agent 及任意支持 MCP 的客户端；  
其中 **OpenClaw + 微信** 是当前落地最广、转化效率最高的组合，建议优先作为推广与实施路径。

---

## 我们是什么

LocalsBnb AI 是一层“AI 到路客云 API 的标准连接层”：

- 对上：提供统一 MCP 工具能力
- 对下：调用路客云接口并处理鉴权、错误与权限
- 对业务：让查询与操作可以直接通过自然语言完成

适用对象：门店运营、前台、店长、区域管理、技术实施团队。

---

## 我们可以做什么

### 核心查询能力（当前可直接落地）

- 订单看板：今日预抵 / 在住 / 预离一键汇总，快速识别当日待办
- 订单详情：按订单号直达详情，减少前台和运营反复翻找
- 房态与可售：支持今日快照与多日区间查询，适合排班与排房决策
- 房价数据：支持按日期/自然周查看价格趋势，便于活动与调价判断
- 经营分析：支持查看入住率、营收等核心指标，用于复盘与晨会

### 管理价值（对门店最直接）

- 把“查数据”从后台页面前移到对话入口，响应更快
- 一线同学按自然语言提问即可获得可执行结果，培训成本低
- 统一口径返回订单、房态、经营数据，减少跨角色信息偏差

### 能力边界说明

- 当前版本以查询分析能力为主，已覆盖订单、房态、房价、经营数据主链路
- 写操作能力可按账号权限与部署策略逐步开放

---

## 我们可以怎么用

你可以按组织现状选择入口，能力层一致。

### 路径 A（推荐）: OpenClaw / Hermes Agent + IM

在 OpenClaw 或 Hermes Agent 中接入 LocalsBnb MCP 后，可打通：

- 微信
- 企业微信
- QQ
- 飞书
- 钉钉
- iMessage

典型对话：

- 「查询今天房态」
- 「查询近期房价」
- 「今天预离还有几单？」
- 「查看张三的订单详情」
- 「看下本周入住率和营收」
- 「帮我根据当前经营情况，并结合近期天气、节假日等情况给出调价建议」
- 「拉取近 30 天入住率、房价、渠道占比和订单取消率，结合周末与节假日，给我一版下周调价策略（含涨降幅区间和执行优先级）」  
- 「基于今日预抵/预离/在住结构，识别今晚可能的满房风险与空置风险，并给出房态和价格联动建议」  
- 「结合最近一周经营数据与历史同周表现，输出门店晨会简报：异常指标、可能原因、今日行动项」  
- 「对比近 14 天不同渠道订单质量（ADR、间夜、取消率），给出渠道投放与限房建议」  

### 路径 B：MCP 客户端直连

适合总部运营、区域管理、店长、实施团队进行日常查询与管理：

- OpenClaw
- Hermes Agent
- Cursor
- Claude Desktop
- Claude Code
- 其他 MCP 客户端

---

## 怎么配置

### 1) 前置条件

- 已开通路客云相关 API 权限
- 获取必填凭证：
  - `APP_SECRET`（访问令牌）
  - `APP_ID`（访问ID）

### 2) 通用 MCP 配置

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

### 3) OpenClaw / Hermes Agent（优先推荐）

这是当前最主流、最容易规模化落地的接入方式，建议作为第一实施路径。

1. 在 OpenClaw / Hermes Agent 中注册 LocalsBnb MCP（配置 `APP_SECRET` + `APP_ID`）  
2. 绑定 IM 渠道（微信、企微、QQ、飞书、钉钉、iMessage）  
3. 配置角色权限与可执行边界（谁可查、谁可操作、谁需二次确认）  
4. 配置常用意图路由（如：今日房态、今日订单、订单详情、经营数据）  
5. 以“查询今天房态 / 查询今日订单 / 输出晨会简报”完成联调验收

> 建议先上线查询类能力，再逐步开放写操作，保证上线稳定性与组织接受度。

#### OpenClaw 自然语言一键安装（推荐新手）

如果你已将 MCP 发布到 GitHub 与 npm，可直接通过对话让 OpenClaw 完成安装与配置。

**步骤 1：准备凭证**

- 在路客云 SPMS 获取 `APP_SECRET` 与 `APP_ID`
- 确认当前账号已开通对应查询权限（订单、房态、房价、经营数据）

**步骤 2：在 OpenClaw 或 Hermes Agent 中发送安装指令**

建议使用下面这句（比口语更稳定）：

```text
请帮我安装 localsbnb-mcp-server，并配置 MCP 服务名为 LocalsBnb MCP。
使用环境变量：
APP_SECRET=<你的APP_SECRET>
APP_ID=<你的APP_ID>
安装完成后请先执行“查询今天房态”和“查询今日订单”做连通性验证。
```

**步骤 3：验收**

- 能成功返回“今日房态”
- 能成功返回“今日订单（预抵/在住/预离）”
- 若失败，按错误提示检查 `APP_SECRET` / `APP_ID` 是否正确

> 安全建议：请在私聊或受控环境中发送凭证，不要在公开群聊明文发送。

### 4) 其他 MCP 客户端（补充接入）

#### Cursor

编辑 `~/.cursor/mcp.json`，加入上面的 `mcpServers` 配置并重启 Cursor。

#### Claude Desktop

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

#### Claude Code

```bash
claude mcp add LocalsBnbMCP --scope user \
  -e APP_SECRET="<你的 token>" \
  -e APP_ID="<你的 campId>" \
  -- npx -y localsbnb-mcp-server
```

---

## 常见问题

| 问题 | 处理方式 |
|---|---|
| 连接失败 / 无权限 | 核对 `APP_SECRET`、`APP_ID`，并确认路客云侧已开通权限 |
| 秘钥错误 | 当前秘钥信息错误，请前往登录路客云 SPMS 获取秘钥，或联系路客云客户经理咨询 |
| 找不到 MCP 工具 | 检查 JSON 格式、命令路径并重启客户端 |
| `ERR_REQUIRE_ESM` | 优先使用 `dist/run.sh` 或 `dist/run.cjs` |

---

## 安全建议

- 凭证通过环境变量注入
- 不提交真实 `APP_SECRET` 到仓库
- 关键操作建议保留审核/确认流程

---

## 技术支持

- 技术支持: [https://minsubao.localhome.cn/](https://minsubao.localhome.cn/)

---

**文档版本**: v2.0  
**最后更新**: 2026-04
