# Install LocalsBnb MCP (Overseas)

## What you need

- `APP_SECRET` — Hudson access token
- `APP_ID` — camp / property ID

No `REGION` flag. The server detects overseas stores automatically.

## Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "LocalsBnb MCP": {
      "command": "npx",
      "args": ["--yes", "localsbnb-mcp-server"],
      "env": {
        "APP_SECRET": "<your APP_SECRET>",
        "APP_ID": "<your APP_ID>"
      }
    }
  }
}
```

## What happens on start

1. `POST /camp/get` with your `APP_ID`
2. If `isBnb !== 1` → China tools (unchanged)
3. If `isBnb === 1` → load language / timezone / currency / date format, then register overseas adapters and write tools (check-in, check-out, extend, assign room)

Missing language falls back to **English**. Korea currently has no `ko` locale in Hudson; English is used.

## First checks

Ask: “today’s arrivals”, “today’s rooms”, “this week occupancy”.

Write actions always preview first. Call again with `confirm=true` to execute.

## Security

Keep tokens in local env only. Rotate any token that has appeared in chat.
