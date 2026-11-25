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

**Ketiga engine lulus.** Semuanya bisa dikendalikan dashboard tanpa terminal, memakai login pengguna sendiri, memanggil tool MCP `ahq`, mengarahkan izin keamanan ke dashboard, dan melanjutkan sesi. (Gemini ditambahkan lewat T-001 dan divalidasi terhadap CLI asli di T-002 — lihat bagian Gemini.)

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

## Gemini (Gemini CLI): T-001 + validasi nyata T-002 (v0.71.1)

Engine ke-4, ditambahkan lewat tiket T-001 dan **divalidasi terhadap Gemini CLI asli** (`/opt/homebrew/bin/gemini` v0.71.1) di T-002.

Cara kendali (satu proses per giliran, pola Cursor):

```
GEMINI_CLI_TRUST_WORKSPACE=true gemini -p "<pesan>" --output-format stream-json --approval-mode yolo \
  [-m <model>] [--resume <session-uuid>] [--include-directories <folder>]
```

Hasil uji nyata:

- Event stream-json cocok dengan parser: `init{session_id,model}`, `message{role,content,delta}`, `tool_use{tool_name,tool_id,parameters}`, `tool_result{…,error.type}`, `result{status,stats,error.message}`.
- **Trust env wajib:** tanpa trust Gemini menolak jalan ("not running in a trusted directory"). Env `GEMINI_CLI_TRUST_WORKSPACE=true` membuat Gemini jalan **dan** memuat hook `BeforeTool`. **`--skip-trust` berbahaya**: Gemini jalan tetapi hook proyek **tidak dimuat**. Adapter menolak jalan bila `.gemini/settings.json` workspace tidak punya `hooks.BeforeTool`.
- **`--approval-mode plan` tidak dipakai** untuk peran baca-saja: tool MCP `ahq` tidak tersedia di plan, dan `exit_plan_mode` disetujui otomatis di headless sehingga agent lalu bisa mengedit. Penjaga baca-saja = hook + `decide()` saja.
- MCP `ahq` dari `.gemini/settings.json` OK dengan yolo; nama tool `mcp_ahq_<tool>`; Gemini menambah argumen `wait_for_previous`.
- **Resume `--resume <session-uuid>` berhasil** (ingat isi giliran sebelumnya), walau `--help` hanya menyebut "latest"/indeks.
- Tool bawaan: `update_topic` → kind meta (tanpa kartu izin); `invoke_agent` tetap ditanyakan (sub-agent belum terbukti lewat hook).
- Model: dinamis dari `gemini models -o json` (`auto`, `gemini-3.1-pro-preview-customtools`, `gemini-3-flash-preview`, `gemini-3.8-flash`, `gemini-3.5-flash-lite`, …). Alias lama `pro`/`flash`/`flash-lite` dan `gemini-2.5-*` dihapus dari fallback; override `AHQ_GEMINI_MODELS` tetap.
- Kuota: `result.status=error` dengan pesan seperti "You have exhausted your daily quota on this model." / "exceeded your current quota"; regex QUOTA cocok.

Kekurangan dan risiko:

1. **Hook fail-open di Gemini**: error hook selain exit 0/2 hanya jadi peringatan dan tool tetap jalan. Hook kita harus fail closed (exit 2 bila orchestrator tak terjangkau).
2. **Hook yang menunggu jawaban pengguna** butuh timeout besar (bawaan 60 detik). Kita set 86400000 ms.
3. **`--approval-mode yolo` + trust env**: hook jadi penjaga utama. Tanpa trust / dengan `--skip-trust`, hook tidak dimuat. Mitigasi: wajibkan trust env + cek `hooks.BeforeTool` sebelum spawn.
4. **Satu proses per giliran**: start lebih lambat dari Claude, sama seperti Cursor.
5. Format stream-json bisa berubah di versi CLI berikutnya; adapter mengabaikan event tak dikenal.
6. Kuota harian akun bisa habis per model; deteksi kuota menjeda agent gemini.
7. Nama tool Gemini berbeda (`run_shell_command`, `replace`, `dir_path`, `mcp_ahq_<tool>`), jadi `normalize()` di `policy.js` punya cabang khusus.

## Login yang sudah dilakukan

| Engine | Status |
|---|---|
| opencode | Siap (provider yang sudah diatur pengguna) |
| Claude Code | Dipasang lewat pemasang resmi (`~/.local/bin/claude`, 2.1.331) dan login claude.ai |
| Cursor | `cursor-agent login` berhasil |
| Gemini | Siap: Gemini CLI v0.71.1 terpasang dan divalidasi (T-002); login akun Google pengguna |

## Dampak ke plan

- Pengaturan project wajib menyimpan **model per peran**, terutama untuk opencode.
- Aturan "keamanan ditanya" diterjemahkan berbeda per engine:
  - opencode: aturan `permissions` per sesi dengan aksi `shell`, `read`, `edit`.
  - Claude: daftar `ask` di file `--settings` per peran, plus `--permission-prompt-tool`.
  - Cursor: `--force` plus hook `preToolUse` yang menunggu jawaban dashboard.
  - Gemini: `GEMINI_CLI_TRUST_WORKSPACE=true` + `--approval-mode yolo` plus hook `BeforeTool` yang fail closed (plan mode tidak dipakai).
- Persetujuan rencana SA di Claude memakai mode `plan` dan `ExitPlanMode`.
- Event `provider.quota` dari opencode menjadi pemicu jeda "semua istirahat". Sinyal kuota Claude dan Cursor belum diketahui.
- Orchestrator memberi batas waktu per giliran untuk semua engine dan mengulang yang macet.
