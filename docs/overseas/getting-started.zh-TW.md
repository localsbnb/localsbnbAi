# 安裝 LocalsBnb MCP（海外店）

需要 `APP_SECRET` 與 `APP_ID`。不必設定 `REGION`。啟動時呼叫 `POST /camp/get`，`isBnb === 1` 即自動切換海外介面、時區與語言。

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

語言無法識別時預設英語。寫操作需先預覽，再傳 `confirm=true`。請勿把 token 寫進倉庫。
