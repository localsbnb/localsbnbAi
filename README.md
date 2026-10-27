# LocalsBnb / 路客云 MCP

Connect an AI assistant to an authorized property to query rooms, rates, reservations and operating data. Property changes use a preview, explicit confirmation and a result check.

[简体中文](docs/readme/README.zh-CN.md)

## Connection modes

| Mode | Runs on | Connection |
| --- | --- | --- |
| Local | Your computer | Node.js MCP process over stdio |
| Remote | Hosted service | HTTPS Streamable HTTP with OAuth |

The code supports China domestic properties (路客云) and overseas properties (LocalsBnb) through separate API adapters. Available operations depend on the property, granted scopes and backend permissions.

## Remote connection

For WorkBuddy, add a remote MCP connection with this URL:

```text
https://agent-prod.localhome.cn/workbuddy/mcp
```

For a ChatGPT custom app that supports remote MCP, use:

```text
https://agent-prod.localhome.cn/mcp
```

Sign in on the authorization page, choose your property and review the permissions. Do not enter passwords, verification codes, access tokens or App Secrets into chat. A property without an existing App Secret requires administrator setup. Remote connection availability depends on the host application's MCP and OAuth support; these URLs do not imply a public marketplace listing.

The [WorkBuddy configuration](workbuddy/mcp.json) contains no account credentials. A browser GET to the MCP URL returns 405; a client must use POST. An unauthenticated WorkBuddy POST returns 401 with OAuth discovery information.

## Local installation from source

Use Node.js 22 and npm.

```sh
npm install
npm run type-check
npm run build
```

Configure a client that supports local stdio MCP. Replace the example absolute path with your checkout path:

```json
{
  "mcpServers": {
    "localsbnb": {
      "command": "node",
      "args": ["/absolute/path/localsbnbAi/dist/index.js"],
      "env": {
        "LUKEYUN_API_BASE_URL": "https://hudson-prod.localhome.cn",
        "LOCALSBNB_SITE_URL": "https://localsbnb.com"
      }
    }
  }
}
```

Local clients can use the local sign-in flow or provide their existing `APP_SECRET` and `APP_ID` through protected client environment settings. Never commit these values or share them in chat. The published npm package may differ from this GitHub snapshot; building this checkout uses the source shown here.

## Capabilities

- Read room status, prices, arrivals, in-house guests, departures, order details and operating reports.
- Preview and confirm check-in, normal checkout, stay extensions, room assignment, manual reservations, room blocking and clean/dirty flags where supported.
- Domestic adapters also support eligible unpaid manual-order cancellation, batch channel prices and central calendar prices.
- Open channel authorization pages and check the resulting account, property and listing associations. Channel credentials are entered on the channel's own pages.

Domestic cancellation is limited to unpaid, unoccupied manual short-stay orders without deposits or refund records. Early check-in, early checkout that requires repricing, and unsupported payment/refund workflows use the PC application. Domestic price changes cover at most 30 selected dates and batch changes accept at most 20 targets.

All mutations require a current preview and confirmation. If a result is `unknown`, query the operation and affected resources before further action; do not automatically retry the write.

## Self-hosting the remote service

The remote entry is `dist/remote/runtimeIndex.js`. A generic Dockerfile, storage Compose examples, placeholder environment file and SQL migrations are under [`deployment/remote`](deployment/remote). They contain no company deployment settings.

Configure an explicit environment, public HTTPS origin, PostgreSQL, Redis, independent encryption keys and OAuth clients. Enable WorkBuddy with `LOCALSBNB_WORKBUDDY_SOURCE=localsbnb`. Enable business tools only after storage and service credentials are configured. Local stdio credentials must not be injected into the shared remote service.

Review migrations before applying them. New databases use migrations 001 and 002; migration 003 upgrades older column conventions and must not be blindly applied to an already-current schema. Existing encrypted records require the old decryption keys to remain available across upgrades and rotations. Configure the PC-side channel handshake service separately if using overseas channel onboarding.

`/healthz` checks liveness; `/readyz` checks enabled runtime dependencies. A ready response does not prove a user's authorization, backend permissions or business results.

## Support

[localsbnb.com](https://localsbnb.com/)
