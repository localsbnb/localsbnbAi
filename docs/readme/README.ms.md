# LocalsBnb

**Cakap. Hartanah jawab.**  
Tiada apl LocalsBnb tambahan. Tiada komputer khas. AI yang sudah anda guna **ialah** kaunter.

**Language:** [English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [ภาษาไทย](README.th.md) · [Bahasa Melayu](README.ms.md)

![LocalsBnb — cakap dengan AI untuk hosting](assets/localsbnb-hero.png)

---

## Ini apa?

Rumah anda sudah di **LocalsBnb**, tersambung ke **Airbnb, Booking.com, Agoda dan Trip.com** — untuk hos yang tidak mahu hidup dalam papan pemuka.

Cara lama: buka telefon, buka empat apl, tunggu kalendar berpusing, salin nama, lupa siapa dalam 302.

Cara baharu: buka sembang yang sudah ada, cakap macam panggil pengurus syif.

> “Siapa tiba hari ini?”  
> “Bilik pemandangan laut, Sabtu masih kosong?”  
> “Daftar masuk Anna — tunjuk tempahan dulu.”

**Just say.** LocalsBnb duduk di belakang AI anda, menarik tetamu sebenar, bilik sebenar, nombor sebenar. Fikir itu kerja anda. Klik-klik itu boleh bersara.

![Anda cakap. AI tanya LocalsBnb. LocalsBnb pulangkan tempahan dan bilik sebenar.](assets/localsbnb-flow.png)

---

## Boleh guna di perisian apa?

Kalau perisian itu boleh “tambah alat”, LocalsBnb boleh masuk. **Pasang sekali.** Lepas tu, sembang dalam apl itu boleh urus hartanah.

**Di komputer, yang ramai guna**

| Apl | Siapa biasanya selesa |
|-----|------------------------|
| **Claude** (Claude Desktop) | Paling senang bermula. Cakap biasa. |
| **ChatGPT** | Kalau setiap hari sudah buka ChatGPT. |
| **Cursor** | Kalau sudah kerja dalam Cursor. |
| **Windsurf** | Editor AI yang terima alat, idea sama. |
| **VS Code + GitHub Copilot** | Kalau laptop sudah VS Code. |

**Di sembang yang sudah ada**

Kebanyakan hos luar negara kekal di Claude / ChatGPT / Cursor. OpenClaw dan Hermes bukan pemasangan biasa di luar negara — ia berguna hanya jika anda sudah ada pembantu yang hidup dalam apl sembang.

| Anda cakap di mana | Macam mana LocalsBnb sampai |
|--------------------|-----------------------------|
| **WeChat / WeCom / Feishu / DingTalk** | China: masukkan dua kod yang sama ke OpenClaw atau Hermes, tanya sambil berjalan |
| **WhatsApp / LINE / Telegram / iMessage** | Luar negara: hanya jika OpenClaw atau Hermes sudah jadi pembantu sembang itu. Kod yang sama. Kalau tiada, mula di Claude / ChatGPT / Cursor |

![Kebanyakan orang ambil pintu kiri: Claude / ChatGPT / Cursor. Kanan hanya jika OpenClaw atau Hermes sudah ada dalam WeChat atau WhatsApp.](assets/localsbnb-doors.png)

Pilih apl yang **jari anda buka sendiri pagi-pagi**. Jangan muat turun “apl hotel” yang kelima.

---

## Boleh buat apa, betul-betul?

### Sehari — tanya macam ini

**7:10, masih di katil bandar lain**  
“Papan hari ini — tiba, menginap, berlepas.”  
Satu jawapan. Nama, bilik, tarikh. Teks tukang bersih sebelum kopi.

**8:00, serah tugas kaunter**  
“Siapa keluar sebelum 11? Ada bilik kotor tinggal?”  
Staf baharu tak perlu kelas sistem dua jam. Mereka sudah tahu cara bertanya.

**10:30, tetamu telefon**  
“Keluarga Lin boleh masuk awal? Orang sebelum tu keluar jam berapa?”  
Jawab dalam tiga puluh saat, bukan “tunggu saya buka komputer”.

**12:00, fikir hujung minggu**  
“Harga Airbnb Jumaat sampai Ahad? Agoda?”  
Banding saluran dalam satu nafas. Tiada empat log masuk.

**15:00, tukang bersih di koridor**  
“Sekarang mana yang kosong dan bersih?”  
Tak perlu bagi kata laluan. Anda tengok, anda beritahu.

**18:00, kumpulan pemilik**  
“Minggu ni penghunian, harga purata, hasil?”  
Nombor balik dalam **bahasa dan mata wang kedai** yang sudah ditetapkan di LocalsBnb.

**21:40, minta semalam lagi**  
“Boleh lanjut satu malam?” *(kedai luar negara)*  
AI bentang dulu: **siapa, bilik mana, tarikh mana**. Anda kata ya. Baru jalan.

**22:15, bilik silap**  
“Malam ni pindah dari 201 ke 305.” *(kedai luar negara)*  
Peraturan sama: namakan tempahan. Anda sahkan. Baru tukar.

**Cuti / hujan / konsert sebelah**  
“Minggu ni penuh tak berbanding minggu lepas?”  
Naikkan harga hujung minggu atau tidak — nampak minggu di depan mata, bukan rasa perut.

**Hari pertama staf baharu**  
Jangan belajar menu. Ingat tiga ayat: *siapa tiba hari ini, bilik hari ini, nombor minggu ini.*

### Uruskan penginapan — kedai LocalsBnb luar negara sahaja

Anda boleh minta AI **daftar masuk, daftar keluar, lanjut, atau tukar bilik**.

Ia tak buat senyap-senyap. Sentiasa tunjuk tetamu dan tarikh dulu. Anda kata “itu dia.” Baru ia jalan.

![AI tunjuk tempahan dahulu. Anda sahkan. Baru berlaku.](assets/localsbnb-confirm.png)

**Kalau kedai di China:** soalan “apa yang berlaku” semua boleh. **Daftar masuk, daftar keluar, lanjut dan tukar bilik belum ada di China.** Batal, tukar harga senarai, sync kalendar — masih dalam LocalsBnb.

---

## Macam mana nak mula? (tiga langkah)

### 1. Ambil dua kod dari LocalsBnb

Log masuk LocalsBnb dan salin:

- **APP_SECRET** — kunci anda  
- **APP_ID** — nombor hartanah  

Untuk anda sahaja. Bukan untuk kumpulan kelas.

### 2. Masukkan ke AI yang anda pilih

Buka **Claude, ChatGPT atau Cursor**. Tambah alat / MCP, tampal ini, ganti dua baris:

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

| Anda guna… | Biasanya di sini |
|------------|------------------|
| Cursor | Tetapan → MCP, atau fail `mcp.json` |
| Claude Desktop | Tetapan → alat tersuai / MCP |
| ChatGPT | Tetapan → apl / pembangun (ikut pelan) |
| WeChat / Feishu (China) | Minta orang yang pasang OpenClaw atau Hermes isi kod yang sama |
| WhatsApp / LINE / iMessage | Hanya jika OpenClaw atau Hermes sudah cakap dalam sembang itu — kod yang sama. Jika tidak, guna Claude / ChatGPT / Cursor |

Malas cari menu? Beritahu AI:

> Tolong pasang localsbnb-mcp-server. Ini APP_SECRET dan APP_ID saya.

### 3. Cakap macam hos, bukan macam pengaturcara

- “Siapa tiba hari ini?”  
- “Tunjuk bilik hari ini.”  
- “Harga Airbnb minggu ini.”  
- “Minggu ni macam mana?”  
- “Daftar masuk Maria — tunjuk tempahan dulu.” *(luar negara)*

Jawapan ikut **bahasa hartanah** di LocalsBnb. Anda tak pilih Inggeris atau Jepun sekali lagi di sini.

---

## Perlukan bantuan?

[localsbnb.com](https://localsbnb.com/)
