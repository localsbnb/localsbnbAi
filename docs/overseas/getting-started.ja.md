# LocalsBnb MCP の導入（海外店舗）

必要なのは `APP_SECRET` と `APP_ID` だけです。`REGION` は不要です。起動時に `POST /camp/get` を呼び、`isBnb === 1` なら海外 API・タイムゾーン・言語に切り替わります。

```json
{
  "mcpServers": {
    "LocalsBnb MCP": {
      "command": "npx",
      "args": ["--yes", "localsbnb-mcp-server"],
      "env": {
        "APP_SECRET": "<APP_SECRET>",
        "APP_ID": "<APP_ID>"
      }
    }
  }
}
```

言語が不明な場合は英語です。更新系は先に内容確認し、`confirm=true` のときだけ実行します。トークンをリポジトリに書かないでください。
