# 安装 LocalsBnb MCP（海外店）

## 需要的凭证

- `APP_SECRET`：Hudson 访问令牌
- `APP_ID`：门店 campId

**不用**配置 `REGION`。启动时自动识别海外店。

## Cursor / Claude Desktop

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

## 启动时做什么

1. 用 `APP_ID` 调 `POST /camp/get`
2. `isBnb !== 1` → 走国内现网工具（逻辑不变）
3. `isBnb === 1` → 再拉语言/时区/货币/日期格式，注册海外 Adapter，并开放入住、退房、续住、换房

语言无法识别时默认 **英语**。Hudson 暂无韩语，韩国店用英语。

## 建议先问

「今天预抵」「今天房态」「本周入住率」。

写操作会先预览，需再次传入 `confirm=true` 才会执行。

## 安全

令牌只放本机环境变量。曾经在聊天里出现过的 token 建议作废换新。
