# Hasil Tahap 0: uji engine

Bagian dari `docs/plan-mode-project.md`. Semua uji dijalankan di repo git percobaan di folder sementara, bukan di repo Gravis. Server MCP percobaan (`ahq`) menyediakan `tanya_pengguna`, `serahkan`, dan `izin`, dan mencatat setiap panggilan.

Skenario yang sama untuk tiap engine:

1. Panggil `tanya_pengguna` lewat MCP, lalu sebutkan jawabannya.
2. Ubah `hitung.py` sesuai jawaban itu (ingatan antar giliran dan izin edit).
3. Jalankan `curl …` (harus ditanya, lalu ditolak).
4. Baca `.env` (harus ditanya, lalu ditolak).
5. Lanjutkan sesi setelah proses berhenti (resume).
6. Peran baca saja tidak mengubah file.

## Ringkasan

**Ketiga engine lulus.** Semuanya bisa dikendalikan dashboard tanpa terminal, memakai login pengguna sendiri, memanggil tool MCP `ahq`, mengarahkan izin keamanan ke dashboard, dan melanjutkan sesi. (Gemini ditambahkan kemudian lewat T-001 dan **belum diuji**, lihat bagian Gemini.)

| | opencode 2.0.30 | Claude Code 2.1.331 | Cursor (cursor-agent 2026.10.22) |
|---|---|---|---|
| Cara kendali | API HTTP `opencode serve` + SSE | Satu proses hidup, stream JSON di stdin/stdout | Satu proses per giliran, `-p --output-format stream-json` |
| Login | Provider opencode pengguna | `claude auth login` (claude.ai) | `cursor-agent login` |
| Banyak giliran | Lulus | Lulus | Lulus |
| Tool MCP `ahq` | Lulus | Lulus | Lulus, **wajib `--force`** |
| Izin ke dashboard | Lulus, lewat API izin | Lulus, lewat `--permission-prompt-tool` | Lulus, lewat **hook `preToolUse`** |
| `curl` ditolak | Lulus | Lulus | Lulus |
| `.env` ditolak | Lulus (bawaan) | Lulus, **butuh aturan `ask`** | Lulus lewat hook |
| Resume | Lulus (sesi server) | Lulus, `--resume <id>` | Lulus, `create-chat` + `--resume <id>` |
| Baca saja | Agent `plan` + aturan `shell` | Mode `plan`, keluar lewat izin | `--plan` (belum diuji ulang) |
| Sinyal kuota habis | Event `provider.quota` | Belum diuji | Belum diuji |

## opencode

- Orchestrator menjalankan `opencode serve --hostname 127.0.0.1 --port <port>` di folder project. Server mencetak `server password <acak>` saat start; semua API memakai Basic auth dengan user `opencode` dan password itu.
- `POST /api/session` dengan `title`, `location.directory`, `model {id, providerID}`, `agent`, dan `permissions` (aturan izin per sesi).
- `POST /api/session/{id}/prompt` dengan `{ text }`.
- `GET /api/event` (SSE). Event yang dipakai: `session.execution.started` / `succeeded` / `failed`, `session.tool.called` / `success` / `failed`, `session.text.delta`, `permission.asked` / `permission.replied`, `session.step.failed` dengan `error.type: "provider.quota"`.
- Izin: `POST /api/session/{id}/permission/{requestID}/reply` dengan `{ decision: "once" | "always" | "reject", message }`, balasan `204`.
- MCP dipasang lewat `opencode.json` di folder kerja (`mcp.ahq`, `type: "local"`).

Temuan:

- **Model bawaan opencode di Mac ini berbayar dan saldonya habis** (`opencode/gemini-4-neon`, `402 Insufficient balance`). Uji berhasil dengan `opencode/deepseek-v4.1-flash-free`. Model per peran wajib dipilih di pengaturan project. Model gratis saat uji: `deepseek-v4.1-flash-free`, `mimo-v2.6-flash-free`, `nemotron-3.5-super-vl-free`, `hy4-flash-free`, dan model lokal lewat `9router` (`ollama/gpt-oss:120b`, `ollama/gemma4:31b`).
- **Nama aksi izin terminal adalah `shell`, bukan `bash`.** Aturan dengan nama `bash` diam-diam tidak berlaku. opencode memecah perintah ber-pipe per bagian.
- File `.env` sudah ditanya secara bawaan oleh agent `build`.
- Agent `plan` tidak mengubah file, tapi masih menjalankan `ls` dan `git status`. Peran baca saja perlu aturan `shell` tambahan.

## Claude Code

Perintah yang terbukti:

```
claude -p --input-format stream-json --output-format stream-json --verbose \
  --model <model> --strict-mcp-config --mcp-config '<json>' \
  --permission-prompt-tool mcp__ahq__izin \
  --settings <file settings peran> \
  [--permission-mode plan] [--resume <session-id>]
```

- Aplikasi desktop Claude sendiri menjalankan Claude Code dengan `--input-format stream-json --output-format stream-json`, jadi cara ini memang dipakai secara resmi.
- Pesan dikirim sebagai `{"type":"user","message":{"role":"user","content":"…"}}` per baris. Satu proses menerima banyak giliran. Setiap giliran diakhiri event `result` berisi `permission_denials`, durasi, dan biaya.
- `system:init` memberi `session_id`, model, mode izin, dan status server MCP.
- `--permission-prompt-tool` menerima `{ tool_name, input, tool_use_id }` dan harus membalas teks JSON `{"behavior":"allow","updatedInput":…}` atau `{"behavior":"deny","message":…}`. Tool MCP lain juga lewat sini.
- `--resume <id>` di proses baru melanjutkan percakapan.

Temuan:

- **Membaca file di folder kerja tidak pernah meminta izin.** Tanpa aturan tambahan, `.env` terbaca diam-diam. Dengan file settings `{"permissions":{"ask":["Read(**/.env*)","Read(**/*.pem)","Read(**/*.key)","Bash(curl:*)","Bash(wget:*)"]}}`, pembacaan `.env` masuk ke tool izin dan bisa ditolak. Aturan "keamanan ditanya" untuk Claude harus ditulis sebagai daftar `ask` di file settings per peran.
- **Mode `plan` cocok untuk persetujuan rencana SA.** Claude menyusun rencana, lalu memanggil `ExitPlanMode` lewat tool izin, dengan isi rencana lengkap. Kalau izin itu diberikan, Claude lanjut mengedit. Jadi dashboard menampilkan rencana dan tombol Setujui; peran yang benar-benar baca saja cukup selalu ditolak `ExitPlanMode` dan memakai `--disallowedTools` untuk Edit/Write.
- Mode `plan` menulis file rencana ke `~/.claude/plans/` milik pengguna. Orchestrator perlu mengarahkannya atau membersihkannya.
- Transkrip sesi tim tersimpan di `~/.claude/projects` seperti sesi biasa, jadi juga tampil di mode Semua Editor. Sesi uji Tahap 0 ikut tampil sampai keluar dari jendela waktu.
- Binary Claude Code bawaan aplikasi desktop tidak membawa login aplikasi. Yang dipakai adalah Claude Code versi terminal di `~/.local/bin/claude`.

## Cursor

Perintah yang terbukti:

```
cursor-agent create-chat                      # sekali per peran, hasilnya chat-id
cursor-agent -p --output-format stream-json --trust --approve-mcps --force \
  --resume <chat-id> "<pesan>"               # satu proses per giliran
```

- Event: `system:init`, `user`, `thinking:delta`, `assistant`, `tool_call:started` / `completed` (misalnya `shellToolCall`, `mcpToolCall`, `getMcpToolsToolCall`, dengan hasil `success` atau `rejected`), `result`.
- MCP dipasang lewat `.cursor/mcp.json` di folder kerja.
- Hook dipasang lewat `.cursor/hooks.json` di folder kerja. Hook `preToolUse` menerima `tool_name`, `tool_input`, `session_id`, `conversation_id`, `cwd`, `workspace_roots`, dan membalas `{"permission":"allow"|"deny", …}`.

Temuan:

- **Tanpa `--force`, semua pemanggilan tool MCP ditolak otomatis** di mode non-interaktif. Jadi `--force` wajib, dan keamanan sepenuhnya bergantung pada hook.
- **Hook bisa menunggu lama.** Hook dengan `"timeout": 600` menunggu 25 detik sebelum mengizinkan, dan Cursor ikut menunggu. Ini cukup untuk menunggu jawaban pengguna di dashboard.
- **Hook level proyek hanya berlaku di folder kerja itu**, jadi tidak mengganggu Cursor yang pengguna pakai di folder lain. Hooks global milik aplikasi Orca (`~/.cursor/hooks.json`) tetap ikut berjalan di sesi tim.
- Jangan menyediakan tool `izin` lewat MCP untuk Cursor: model sempat mencoba memanggilnya sendiri untuk meminta izin.
- Model dan token tidak dilaporkan per giliran. `model` di `system:init` hanya `"Auto"`.
- Uji pertama setelah login sempat menggantung lebih dari 10 menit dan tidak bisa diulang. Konfigurasi yang sama kemudian selesai dalam 16 detik. Orchestrator harus memberi batas waktu per giliran dan mengulang giliran yang macet.

## Gemini (Gemini CLI): T-001, belum diuji end-to-end

Engine ke-4, ditambahkan lewat tiket T-001. **Belum diuji dengan Gemini asli di Mac ini**: perintah `gemini` belum terpasang dan belum login. Semua di bawah ini berasal dari dokumentasi resmi Gemini CLI, bukan dari uji nyata.

Cara kendali (satu proses per giliran, pola Cursor):

```
gemini -p "<pesan>" --output-format stream-json --approval-mode yolo \
  [-m <model>] [--resume <session-id>] [--include-directories <folder>]
```

- Event: `init` (session id, model), `message`, `tool_use`, `tool_result`, `error`, `result` (statistik token).
- MCP `ahq` dan hook dipasang lewat `.gemini/settings.json` di folder kerja peran: `mcpServers.ahq` dengan `AHQ_ENGINE=gemini`, `hooks.BeforeTool` dengan `timeout` 86400000 ms, dan `context.fileName` berisi `GEMINI.md`. Instruksi peran ditulis juga ke `GEMINI.md` (isi sama dengan `AGENTS.md`).
- Izin: hook `BeforeTool` (`gemini-hook.js`) menerima `tool_name` dan `tool_input`, memanggil `/internal/permission`, lalu `decide()`. Balasannya `{"decision":"allow"}` atau `{"decision":"deny","reason":…}`; error apa pun = exit 2 (fail closed). Peran baca saja (PM/BA/SA) dan QA dijaga oleh `decide()`.
- Login: jalankan `gemini` sekali dan masuk dengan akun Google, atau set `GEMINI_API_KEY` (atau env Vertex AI).
- Model: daftar statis (`auto`, `pro`, `flash`, `flash-lite` + nama konkret), bisa diganti lewat env `AHQ_GEMINI_MODELS`. Gemini CLI tidak punya perintah daftar model.
- Kuota: dideteksi dari teks error/stderr (`429`, `RESOURCE_EXHAUSTED`, quota, rate limit).

Kekurangan dan risiko:

1. **Hook fail-open di Gemini**: error hook selain exit 0/2 hanya jadi peringatan dan tool tetap jalan. Hook kita harus fail closed (exit 2 bila orchestrator tak terjangkau).
2. **Hook yang menunggu jawaban pengguna** butuh timeout besar (bawaan 60 detik). Kita set 86400000 ms; belum diverifikasi bahwa Gemini menghormatinya.
3. **`--approval-mode yolo`**: hook jadi satu-satunya penjaga. Bila hook gagal dimuat, tidak ada penjaga kedua. Mitigasi: fail closed dan uji penolakan edit untuk PM/BA/SA/QA.
4. **Satu proses per giliran**: start lebih lambat dari Claude, sama seperti Cursor.
5. **Dokumentasi menyebut Gemini CLI digantikan Antigravity CLI sejak 18 Juni 2026**, jadi nama flag dan event bisa berubah. Adapter mengabaikan event tak dikenal.
6. Daftar model statis; token usage bisa kosong bila event `result` tak membawa statistik.
7. Nama tool Gemini berbeda (`run_shell_command`, `replace`, `dir_path`, `mcp_ahq_<tool>`), jadi `normalize()` di `policy.js` punya cabang khusus.

Yang perlu diuji pengguna setelah `gemini` terpasang dan login: `tanya_pengguna` lewat MCP, edit file, `curl` dan `.env` ditolak, resume sesi, peran baca saja tidak mengubah file, hook yang menunggu lebih dari 60 detik, dan sinyal kuota.

## Login yang sudah dilakukan

| Engine | Status |
|---|---|
| opencode | Siap (provider yang sudah diatur pengguna) |
| Claude Code | Dipasang lewat pemasang resmi (`~/.local/bin/claude`, 2.1.331) dan login claude.ai |
| Cursor | `cursor-agent login` berhasil |
| Gemini | Belum: `gemini` belum terpasang di Mac ini |

## Dampak ke plan

- Pengaturan project wajib menyimpan **model per peran**, terutama untuk opencode.
- Aturan "keamanan ditanya" diterjemahkan berbeda per engine:
  - opencode: aturan `permissions` per sesi dengan aksi `shell`, `read`, `edit`.
  - Claude: daftar `ask` di file `--settings` per peran, plus `--permission-prompt-tool`.
  - Cursor: `--force` plus hook `preToolUse` yang menunggu jawaban dashboard.
  - Gemini: `--approval-mode yolo` plus hook `BeforeTool` yang fail closed dan menunggu jawaban dashboard.
- Persetujuan rencana SA di Claude memakai mode `plan` dan `ExitPlanMode`.
- Event `provider.quota` dari opencode menjadi pemicu jeda "semua istirahat". Sinyal kuota Claude dan Cursor belum diketahui.
- Orchestrator memberi batas waktu per giliran untuk semua engine dan mengulang yang macet.
