# ติดตั้ง LocalsBnb MCP (สาขาต่างประเทศ)

ใช้ `APP_SECRET` และ `APP_ID` เท่านั้น ไม่ต้องตั้ง `REGION` ตอนเริ่มระบบจะเรียก `POST /camp/get` ถ้า `isBnb === 1` จะสลับไปใช้ API / โซนเวลา / ภาษาของสาขาต่างประเทศ

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

ถ้าไม่รู้ภาษา จะใช้ภาษาอังกฤษ การแก้ไขข้อมูลต้องพรีวิวก่อน แล้วส่ง `confirm=true` ห้ามใส่ token ลง git
