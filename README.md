# 路客云 AI 助手

## 这是什么？

路客云 AI 助手让您可以在 **Cursor**、**Claude Desktop**、**Claude Code** 等 AI 工具中，直接用自然语言操作路客云 SPMS（酒店物业管理系统）。

例如，您可以说：

- 「查询今天的房态」
- 「今天有哪些订单？」
- 「帮我查一下本周的入住率」

AI 会帮您调用路客云，并返回结果。

## 能做什么？

### 订单管理
- 查询订单列表、订单详情
- 办理入住 / 退房

### 房态管理
- 查询房态
- 查询和更新房价
- 批量更新价格

### 数据分析
- 查询经营数据、财务数据
- 收益分析、入住率相关数据

### 渠道管理
- 查看渠道列表、渠道详情
- 关联或解绑渠道

---

## 用户初始化与快速入门

### 一、前置条件

| 项目 | 要求 |
|------|------|
| **Node.js** | ≥ 18.0（运行 `node -v` 检查） |
| **路客云账号** | 已开通路客云 SPMS |
| **访问凭证** | 已获取 **APP_SECRET** 与 **APP_ID**（由路客云管理员配置） |
| **AI 客户端** | 已安装 Cursor、Claude Desktop 或 Claude Code |

### 二、获取访问凭证

| 凭证 | 说明 | 示例格式 |
|------|------|----------|
| **APP_SECRET** | 路客云访问令牌，用于 API 鉴权 | 由路客云后台提供的 token 字符串 |
| **APP_ID** | 营地/物业 ID，标识一家店或经营主体 | 数字字符串，如 `12345` |

请联系路客云管理员或进入路客云后台获取：https://minsubao.localhome.cn/ → 「设置」→「API 密钥管理」或联系技术支持。

> ⚠️ **安全提醒**：请勿将凭证分享给他人或提交到公开代码仓库。

### 三、选择安装方式

**方式 A：npx 直接运行（推荐，免安装）** — 无需下载，首次运行自动拉取。

**方式 B：解压包安装** — 从发布页下载 `lukeyun-pms-mcp-vX.X.X.zip`，解压后在目录下执行 `npm install --production`。

**方式 C：从源码构建** — 克隆项目后执行 `npm install` 和 `npm run build`，配置时指向 `dist/run.sh` 或 `dist/run.cjs`。

### 四、配置 MCP 客户端

#### 配置 Cursor

1. 打开 Cursor → `Cmd/Ctrl + ,` 打开设置 → 搜索「MCP」→ 找到 **MCP Servers** → 编辑 `~/.cursor/mcp.json`
2. 添加配置（**替换凭证为你的实际值**）：

**npx 方式（推荐）**
```json
{
  "mcpServers": {
    "LocalsBnb MCP": {
      "command": "npx",
      "args": ["--yes", "localsbnb-mcp-server"],
      "env": {
        "APP_SECRET": "<你的 token>",
        "APP_ID": "<你的 campId>"
      }
    }
  }
}
```

**解压包 / 源码构建方式**
```json
{
  "mcpServers": {
    "LocalsBnb MCP": {
      "command": "sh",
      "args": ["/你的实际路径/dist/run.sh"],
      "env": {
        "APP_SECRET": "<你的 token>",
        "APP_ID": "<你的 campId>"
      }
    }
  }
}
```

> 若 `run.sh` 报错，可改用：`"command": "node"`，`"args": ["/你的路径/dist/run.cjs"]`

3. 完全重启 Cursor

#### 配置 Claude Desktop

1. 找到配置文件：
   - macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows：`%APPDATA%\Claude\claude_desktop_config.json`
   - Linux：`~/.config/Claude/claude_desktop_config.json`
2. 添加与上文相同的 `mcpServers` 配置块
3. 保存并重启 Claude Desktop

#### 配置 Claude Code

Claude Code 是终端版 Claude，通过 `claude mcp add` 添加 MCP 服务。包已发布到 npm，可直接用 npx 运行：

**方式 1：命令行添加（推荐）**

在终端执行（**替换凭证为你的实际值**）。注意：**服务器名必须写在 `-e` 参数之前**：

```bash
claude mcp add LocalsBnbMCP --scope user \
  -e APP_SECRET="<你的 token>" \
  -e APP_ID="<你的 campId>" \
  -- npx -y localsbnb-mcp-server
```

- 使用 `-e KEY=value` 传递环境变量（勿用 `--env`）
- `--scope user`：所有项目可用；改为 `--scope local` 仅当前项目

**方式 2：手动编辑配置文件**

在项目根目录创建或编辑 `.mcp.json`：

```json
{
  "mcpServers": {
    "LocalsBnb MCP": {
      "command": "npx",
      "args": ["-y", "localsbnb-mcp-server"],
      "env": {
        "APP_SECRET": "<你的 token>",
        "APP_ID": "<你的 campId>"
      }
    }
  }
}
```

也可将 MCP 配置写入用户级 `~/.claude.json` 的 `mcpServers` 字段。

**验证**：在 Claude Code 中输入 `/mcp` 查看是否已加载，或直接说「查询今天的房态」测试。

### 五、验证配置

- **Cursor**：`Cmd/Ctrl + Shift + P` → 输入「MCP」，查看是否出现 `LocalsBnb MCP` 相关工具
- **Claude Desktop**：新开对话，输入 `@LocalsBnb MCP` 或「查询今天的房态」
- **Claude Code**：输入 `/mcp` 查看工具，或直接说「查询今天的房态」

若能返回房态、订单等数据，说明配置成功。

### 六、可用工具一览

| 工具名 | 说明 | 示例指令 |
|--------|------|----------|
| `query_today_orders` | 今日订单（预抵/在住/预离） | 「今天有哪些订单？」 |
| `get_order_details_v2` | 订单详情 | 「查一下订单 12345 的详情」 |
| `query_today_room_status` | 今日房态 | 「今天房态怎么样？」 |
| `query_room_status_new` | 房型日历价（新接口） | 「查一下未来 7 天的房态和价格」 |
| `query_room_prices` | 近期房价 | 「本周房价是多少？」 |
| `query_operational_data_v2` | 运营数据 | 「今天的经营情况如何？」 |

### 七、配置项速查

| 环境变量 | 必填 | 说明 |
|----------|------|------|
| `APP_SECRET` | 是 | 路客云访问令牌 |
| `APP_ID` | 是 | 营地 ID |
| `LOG_LEVEL` | 否 | `info` / `debug`，调试用 |

### 八、常见问题

| 问题 | 解决 |
|------|------|
| 连接失败 / 无权限 | 确认 `APP_SECRET`、`APP_ID` 正确，且已开通 MCP/API 权限 |
| 找不到工具 | 检查 JSON 格式、路径是否正确，完全重启客户端 |
| ERR_REQUIRE_ESM | 使用 `dist/run.sh` 或 `dist/run.cjs` |
| npx 缓存异常（Windows） | 执行 `npx clear-npx-cache` 后重试 |

---

## 使用场景示例

| 您可以说 | AI 会帮您 |
|---------|----------|
| 今天有几间房是空房？ | 查询并展示今日房态 |
| 本周入住率怎么样？ | 统计并展示入住率数据 |
| 帮我查一下订单号为 XXX 的详情 | 返回该订单的完整信息 |
| 明天 101 房的价格是多少？ | 查询并展示该房型价格 |

## 部署方式

- **云端使用**：由路客云托管，您只需完成配置即可使用
- **本地部署**：如需在企业内网使用，可联系技术支持获取本地部署方案

## 安全说明

- 使用 HTTPS 加密传输
- 密钥加密存储
- 支持按接口进行权限控制

## 需要帮助？

- **技术支持**：https://minsubao.localhome.cn/

---

**文档版本**：v1.0  
**最后更新**：2026年
