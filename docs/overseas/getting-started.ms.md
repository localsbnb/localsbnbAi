# Pasang LocalsBnb MCP (kedai luar negara)

Hanya `APP_SECRET` dan `APP_ID`. Tidak perlu `REGION`. Semasa mula, pelayan memanggil `POST /camp/get`. Jika `isBnb === 1`, ia bertukar ke API, zon waktu dan bahasa luar negara.

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

Bahasa lalai ialah Inggeris. Tindakan tulis perlu pratonton dahulu, kemudian `confirm=true`. Jangan simpan token dalam git.
