# WorkBuddy connector

Add a remote Streamable HTTP MCP connection using:

```text
https://agent-prod.localhome.cn/workbuddy/mcp
```

Select China domestic (路客云) or Overseas (LocalsBnb), sign in on the authorization page, choose a property and review the requested permissions. Do not paste passwords, tokens or App Secrets into chat. The account must have an existing property App Secret.

`mcp.json` contains the remote connection configuration. It contains no account credentials. For self-hosting, configure your own origin and set `LOCALSBNB_WORKBUDDY_SOURCE=localsbnb`. A GET request to the MCP endpoint returns 405; unauthenticated POST returns 401 and an OAuth challenge.

See the repository README for local stdio and remote deployment options.
