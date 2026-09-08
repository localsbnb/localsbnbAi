# LocalsBnb

**Say it. Your property answers.**  
No LocalsBnb app. No extra computer. The AI you already use **is** the front desk.

**Language:** [English](README.md) · [简体中文](docs/readme/README.zh-CN.md) · [繁體中文](docs/readme/README.zh-TW.md) · [日本語](docs/readme/README.ja.md) · [ภาษาไทย](docs/readme/README.th.md) · [Bahasa Melayu](docs/readme/README.ms.md)

![Say it. Your property answers.](docs/readme/assets/localsbnb-hero.png)

---

## What is this?

Your listings already live on **LocalsBnb**, connected to **Airbnb, Booking.com, Agoda, and Trip.com** — built for hosts who will not live inside another dashboard.

The old way: unlock the phone, open four apps, wait for calendars, copy a name into a notebook, forget who is in 302.

The new way: open the chat you already have, and talk like you talk to a duty manager.

> “Who’s arriving today?”  
> “Is the sea-view room free Saturday?”  
> “Check Anna in — wait, show me the booking first.”

**Just say.** LocalsBnb sits behind your favorite AI and pulls the live store: real guests, real rooms, real money. You stay human. The clicking goes away.

![You speak. Your AI asks LocalsBnb. LocalsBnb answers with your real bookings and rooms.](docs/readme/assets/localsbnb-flow.png)

---

## Where can I use it?

If the software can add a “tool” or “MCP”, LocalsBnb can live there. You install **once**. After that, any chat in that app can run your property.

**Use it on the computer**

| App | Who usually likes it |
|-----|----------------------|
| **Claude** (Claude Desktop) | The easiest start. Talk in plain language. |
| **ChatGPT** | If you already live in ChatGPT every day. |
| **Cursor** | If you already write or work in Cursor. |
| **Windsurf** | Same idea: an AI editor that accepts tools. |
| **VS Code + GitHub Copilot** | If your laptop is already VS Code. |

**Use it where you already chat**

Most overseas hosts stay in Claude / ChatGPT / Cursor. OpenClaw and Hermes are not the usual overseas install — they matter when you already use an assistant that lives inside a chat app.

| Where you talk | How LocalsBnb gets there |
|----------------|--------------------------|
| **WeChat / WeCom / Feishu / DingTalk** | China: add the same two codes to OpenClaw or Hermes, then ask while you walk. |
| **WhatsApp / LINE / Telegram / iMessage** | Overseas: only if you already run OpenClaw or Hermes as that chat’s assistant. Same two codes. If you do not have that setup, start in Claude / ChatGPT / Cursor. |

![Most hosts stay in Claude, ChatGPT, or Cursor. OpenClaw or Hermes only if that assistant already lives in WeChat or WhatsApp.](docs/readme/assets/localsbnb-doors.png)

Pick the app you already open in the morning. Do not download a fifth “hotel app”.

---

## What can it actually do?

### A day in the life — just ask

**7:10, still in bed, another city**  
“What’s the board for today — arrivals, staying, leaving?”  
One answer. Names, rooms, dates. You text the cleaner before coffee.

**8:00, front desk handover**  
“Who is checking out before 11? Any dirty rooms left?”  
The new hire does not need a two-hour system class. They already know how to ask a question.

**10:30, guest on the phone**  
“Can the Lin family check in early? What time does the last person leave that room?”  
You answer in thirty seconds, not after ‘let me open the computer’.

**12:00, thinking about the weekend**  
“What’s our Airbnb price Friday to Sunday? What about Agoda?”  
Compare channels in one breath. No four logins.

**15:00, housekeeper in the corridor**  
“Which rooms are empty and clean right now?”  
She does not need your password. You look, you tell her.

**18:00, owner group chat**  
“How did we do this week? Occupancy, average price, revenue.”  
The number comes back in **your store’s language and currency** — the ones you already set in LocalsBnb.

**21:40, last-minute request**  
“They want one more night. Can we extend?” *(overseas store)*  
The AI shows **who, which room, which dates**. You say yes. Then it happens. Not before.

**22:15, wrong room**  
“Move tonight’s guest from 201 to 305.” *(overseas store)*  
Same rule: it names the booking. You confirm. Then the room changes.

**Holiday / rain / a concert next door**  
“How full are we this week versus last week?”  
You decide whether to raise the weekend or leave it — with the week in front of you, not a gut feel.

**First day of a new staff member**  
They do not learn menus. They learn three sentences: *today’s arrivals, today’s rooms, this week’s numbers.*

### Handle the stay — overseas LocalsBnb stores only

You can ask the AI to **check in, check out, extend, or change a room**.

It will never do it quietly. You always see the guest and the dates first. You say “that’s the one.” Only then it goes through.

![The AI shows the booking first. You confirm. Then it happens.](docs/readme/assets/localsbnb-confirm.png)

**If your store is in China:** you can ask all the “what’s going on” questions. **Check-in, check-out, extend, and room change are not available in China yet.** Cancel, change the listed price, or sync a calendar — still do that in LocalsBnb.

---

## How do I start? (three steps)

### 1. Take two codes from LocalsBnb

Log in to LocalsBnb and copy:

- **APP_SECRET** — your key  
- **APP_ID** — your property  

Yours only. Not for the class WeChat group.

### 2. Drop them into the AI you picked

Open **Claude, ChatGPT, or Cursor**. Add a tool / MCP, paste this, replace the two lines:

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

| You use… | Where it usually goes |
|----------|------------------------|
| Cursor | Settings → MCP, or the `mcp.json` file |
| Claude Desktop | Settings → custom tools / MCP |
| ChatGPT | Settings → apps / developer tools (when your plan allows it) |
| WeChat / Feishu (China) | Ask the person who set up OpenClaw or Hermes to add the same two codes |
| WhatsApp / LINE / iMessage | Only if OpenClaw or Hermes already talks in that chat — same two codes. Otherwise use Claude / ChatGPT / Cursor |

Hate config? Tell the AI itself:

> Help me install localsbnb-mcp-server. Here is my APP_SECRET and APP_ID.

### 3. Talk like a host, not like a programmer

- “Who arrives today?”  
- “Show today’s rooms.”  
- “Airbnb prices this week.”  
- “How is this week going?”  
- “Check Maria in — show me the booking first.” *(overseas)*

Answers follow the **language of the property** in LocalsBnb. You do not pick English or Japanese again here.

---

## Need a hand?

[localsbnb.com](https://localsbnb.com/)
