# Install LocalsBnb MCP (Overseas)

## Two ways to start

**Existing credentials (direct config, unchanged):** set `APP_SECRET` + `APP_ID` in mcp.json. `APP_SECRET` is the long-lived key from PC API keys (`/user/secret/generate`). Send it in `hudson-access-token` **without** a `Bearer` prefix.

**New host (P0):** omit both. Bootstrap mode exposes register/sign-in only. The short-lived login JWT from sign-in/sign-up uses `Bearer` on the wire; then MCP calls `/user/secret/get` (or `/user/secret/generate`) and stores the App Secret in `~/.localsbnb/credentials.json` (mode 600)—same wire format as direct `APP_SECRET`. **Never paste the token into chat.**

`hudson-access-token` rules:

| Source | Add `Bearer`? |
|--------|----------------|
| Login JWT from `sign-in` / `sign-up` | Yes |
| `/user/secret/generate` (or get) / env `APP_SECRET` | No |

Google sign-in is not in P0. Airbnb OAuth (P1) uses Handshake; full OAuth requires `LOCALSBNB_SITE_URL=https://overseas-dev.localhome.cn` (PC Handshake is published there).

**Status (2026-10-09):** S05/S06 handshake open-link passed; S08/S09 human acceptance passed (S08 without real channel accounts; S09 includes real writes and clean-state). AI-opened pages must work on phone browsers (handoff §0.12). S07 paused; S10 Airbnb real-account E2E deferred. Prefer Cursor MCP name **`Locals Overseas`** pointing at local `dist/run.cjs`. See the [handoff notes (Chinese)](./ai-onboarding-xcode-handoff.zh-CN.md).

**Next:** commit the MCP workspace; publish overseas PC mobile changes to overseas-dev; resume channel/Airbnb real-account tests when accounts are available.

## Cursor / Claude Desktop

Existing credentials:

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

New host (no credentials):

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

Say: “register a LocalsBnb account” or “sign in with email”. Production login may ask for an email MFA code on a second `sign_in` call.

Optional env:

- `LOCALSBNB_CREDENTIALS_PATH` — override the credentials file
- `LOCALSBNB_LOGIN_MFA=0` / `1` — force MFA off/on (default: on when talking to hudson-prod)
- `LOCALSBNB_SITE_URL` — Handshake origin. Use `https://overseas-dev.localhome.cn` for full Airbnb OAuth (published). Use `http://localhost:3000` only to test opening the handshake page.
- `LOCALSBNB_OPEN_BROWSER=0` — do not spawn the system browser from `start_handshake`

## What happens on start

No credentials: only `sign_up_check`, `send_signup_email_code`, `complete_sign_up`, `sign_in`.

With credentials:

1. `POST /camp/get` with your campId
2. If `isBnb !== 1` → China tools (unchanged)
3. If `isBnb === 1` → load language / timezone / currency / date format, then register overseas adapters and write tools (check-in, check-out, extend, assign room)

Missing language falls back to **English**. Korea currently has no `ko` locale in Hudson; English is used.

## First checks

Ask to register, or “today’s arrivals”, “today’s rooms”, “this week occupancy”.

Write actions always preview first. Call again with `confirm=true` to execute.

## Security

Keep tokens in local env or `~/.localsbnb/credentials.json`. Rotate any token that has appeared in chat.
