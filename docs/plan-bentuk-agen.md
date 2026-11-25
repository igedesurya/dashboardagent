# Plan: bentuk agen yang stabil

Dokumen ini adalah satu-satunya lingkup pekerjaan. Agent yang mengerjakan ini tidak menambah fitur, tidak memecah scanner, dan tidak mengubah tampilan.

Tujuan: setiap sumber di server menghasilkan objek JSON lewat **satu fungsi**. Yang disatukan hanya payload `GET /api/agents` dan SSE. Objek karakter di browser (`Agent` di `mockup/agents.js`) tetap terpisah: ia menyimpan scene (`path`, `spot`, mesh) dan memakai `since`, bukan `started`. Jangan menyamakan keduanya di pekerjaan ini.

## Bukan lingkup

Jangan kerjakan ini di perubahan yang sama:

- Notifikasi, riwayat, filter, atau ringkasan token.
- Memindahkan `scanClaude`, `scanCursor`, `scanOpencode`, `scanGrokApp` ke file sendiri.
- Memecah `mockup/main.js`, `world.js`, `agents.js`, atau `i18n.js`.
- Mengganti Three.js, menambah dependency npm, atau menambah framework test.
- Mengubah `id`, urutan snapshot, atau nama field JSON.
- Menulis ulang komentar Indonesia yang tidak ikut tersentuh.
- Wrapper API (`{ agents: [...] }`), event bus, registry plugin, class per sumber, atau service yang hanya meneruskan panggilan.

Kalau sebuah abstraksi hanya punya satu pemakai, jangan buat.

## Kontrak objek

Satu objek agen punya tepat field ini. Tidak ada field tambahan di JSON publik.

| Field | Tipe | Aturan |
|---|---|---|
| `id` | string | Wajib. Format tetap: `claude:<file tanpa .jsonl>`, `cursor:<nama sesi>`, `opencode:<id sqlite>`, `grok:<id roster>`, bot: `<source>:<nama>`. Jangan diubah; warna karakter di UI di-hash dari `id`. |
| `source` | string | Wajib. `claude`, `cursor`, `opencode`, `grok`, atau sumber bot (`^[a-z0-9_-]{1,16}$`, default `grok`). |
| `name` | string | Opsional saat scan. `collect()` yang mengisi nama chibi lewat `nameFor` hanya jika `name` masih kosong. Grok dan bot sudah punya `name`; jangan ditimpa. `agentRecord` tidak memberi default untuk `name`: kalau input tidak punya `name`, field itu tidak ada di hasil, supaya `name ||= nameFor(...)` tetap jalan. |
| `state` | string | Wajib. Salah satu: `coding`, `running`, `reading`, `waiting`, `thinking`, `idle`, `error`. Nilai lain ditolak. |
| `task` | string atau null | Teks singkat. `idle` tanpa tugas memakai `null`, bukan `""`. |
| `tool` | string | Nama tool. Tidak diketahui: `"—"`. Jangan `null`. |
| `model` | string | Tidak diketahui: `"—"`. Jangan `null`. |
| `project` | string | Nama tampilan. Tidak diketahui: `"—"`. |
| `tokens` | number atau null | Tidak diketahui: `null`. Jangan `0` sebagai pengganti data kosong. |
| `started` | number | Epoch ms. Wajib. |
| `updated` | number | Epoch ms. Wajib. |

`GET /api/agents` dan `GET /api/stream` tetap array JSON objek ini, di-stringify seperti sekarang. Urutan tetap: hasil scan diurutkan `started` naik, nama diisi, lalu bot yang masih di dalam jendela waktu ditambahkan di akhir.

## Satu fungsi pembuat

File baru: `lib/agent.js`. Hanya ini yang diekspor:

- `AGENT_STATES` — `Set` tujuh status di tabel: `coding`, `running`, `reading`, `waiting`, `thinking`, `idle`, `error`. `offline` tidak masuk set ini. `botEvent` memakai set ini. Hapus `BOT_STATES` yang duplikat.
- `agentRecord(input)` — satu-satunya tempat objek agen dibuat.

`agentRecord` melakukan:

1. Menyalin hanya field kontrak. Field lain di `input` dibuang.
2. Mengisi default `tool` / `model` / `project` ke `"—"`, `task` kosong menjadi `null`, `tokens` non-angka menjadi `null`.
3. `state` di luar `AGENT_STATES` mengembalikan `null`, tidak melempar. Alasannya: lemparan di dalam `scanOpencode` ditangkap `catch` milik fungsi itu, yang menutup database dan membuat semua sesi opencode hilang di putaran itu. Lemparan yang lolos sampai `tick()` membuat seluruh putaran gagal dan snapshot lama dipertahankan. Satu baris yang buruk tidak boleh menyebabkan salah satunya. Pemanggil menulis `const rec = agentRecord(...); if (rec) out.push(rec);`.
4. Mengembalikan objek polos. Bukan class.

`agentRecord` tidak membaca file, tidak menamai chibi, tidak menerapkan jendela waktu, dan tidak memetakan tool ke status.

Pemetaan tool tetap `toolState()` dan `describe()` di `server.js`. Jangan disalin ke `lib/agent.js`. Keduanya sudah satu untuk semua sumber file.

## Siapa memanggil `agentRecord`

Setiap objek yang sekarang di-`push` atau di-`bots.set` wajib lewat `agentRecord` tepat sekali:

- `scanClaude`, `scanCursor`, `scanOpencode` (cabang v1 dan v2), `scanGrokApp`
- `botEvent` saat menyimpan bot

`IDLE` dan `THINK()` tetap helper status `{ state, task, tool }`. Mereka bukan agen. Spread ke `agentRecord({ id, source, ...claudeState(), ... })`.

`collect()` tetap satu-satunya penggabung:

1. Scanner mengembalikan array lewat `out` seperti sekarang.
2. Sort `started`.
3. `name ||= nameFor(...)` tetap di sini, setelah sort, dengan `taken` yang sudah berisi nama bot dan nama Grok.
4. Bot kedaluwarsa (`updated` di luar `WINDOW`) dihapus di sini, bukan di dalam `agentRecord`.

Jangan tambah fungsi `normalizeAgent`, `toDto`, `mapAgent`, atau sejenisnya di samping `agentRecord`.

## File yang boleh berubah

| File | Perubahan |
|---|---|
| `lib/agent.js` | Baru. Kontrak + `agentRecord`. |
| `server.js` | Import `agentRecord` dan `AGENT_STATES`. Ganti pembuatan objek. Hapus `BOT_STATES`. |
| `package.json` | Tidak diubah. Entry tetap `server.js`. Paket npm sudah ikut membawa `lib/` karena tidak ada daftar `files`. |
| `Dockerfile` | Tambah `COPY lib ./lib` setelah `COPY server.js ./`. Tanpa ini, image hasil build ulang gagal start (`ERR_MODULE_NOT_FOUND`) dan container terus restart. |
| `.dockerignore` | Tambah `!lib/` di samping `!server.js` dan `!mockup/`. |
| `mockup/*` | Tidak diubah. `applySnapshot` sudah menyalin field server ke objek scene (`started` menjadi `since`, identitas visual di `def`). Penyatuan itu bukan bagian plan ini. |
| `integrations/agent_hq.py` | Tidak diubah. Payload POST tetap sama. |
| `README.md` | Tidak diubah. API publik tidak berubah. |

## Perilaku yang harus tetap

- Jendela waktu, ambang idle (15 detik, 2 menit, 30 menit, dan seterusnya), dan aturan Claude “coding menggantung jadi waiting” tinggal di fungsi `*State` masing-masing.
- Cache parse (`cached`, `parsed`) tinggal di `server.js`.
- SQLite opencode, path env, dan bind `127.0.0.1` tidak berubah.
- `POST /api/events`: status tidak valid tetap `400` dengan pesan yang sama. `offline` tetap menghapus id. Field yang tidak dikirim tetap memakai nilai `prev` untuk `model`, `project`, `tokens`, `started`.
- Gagal scan satu sumber tidak menjatuhkan sumber lain (`try/catch` yang ada jangan dilepas).
- Komentar baru dalam bahasa Inggris. Jangan menambah komentar yang hanya mengulang nama fungsi.

## Urutan kerja

1. Tambah `lib/agent.js` dengan `AGENT_STATES` dan `agentRecord`.
2. Di `server.js`, ganti lima tempat pembuatan objek. Jangan pindahkan isi scanner.
3. Hapus `BOT_STATES`. Pakai `AGENT_STATES`.
4. Tambah `lib/` ke `Dockerfile` dan `.dockerignore`.
5. Jalankan cek di bawah. Kalau perilaku JSON berubah, perbaiki `agentRecord`, jangan menambah mapper kedua.

## Cek selesai

Tidak ada test runner. Cukup skrip Node kecil yang dijalankan lalu dihapus, atau `node --check`.

1. `node --check server.js` dan `node --check lib/agent.js`.
2. `agentRecord` tanpa `tool` / `model` / `tokens` menghasilkan `"—"`, `"—"`, dan `null`. Tanpa `name`, hasilnya tidak punya key `name`.
3. `agentRecord` tanpa `state` yang sah mengembalikan `null`, termasuk `state: "offline"`. `offline` hanya perintah hapus di `botEvent`, sebelum `agentRecord` dipanggil.
4. Server jalan, `GET /api/agents` adalah array. Setiap elemen punya tepat 11 key kontrak.
5. Satu sesi yang sama mempertahankan `id` yang sama setelah reload.
6. `POST /api/events` dengan `status: "coding"` menambah satu objek. `status: "offline"` menghapusnya. `status: "nope"` tetap `400`.
7. Diff tidak menyentuh `mockup/`, `integrations/`, compose file, atau README. Di Docker hanya `Dockerfile` dan `.dockerignore` yang berubah, untuk menyalin `lib/`.
8. `docker compose up -d --build`, lalu container `healthy` dan `GET /api/agents` dari host lolos cek 4.

Selesai bila kelima scanner dan bot memakai `agentRecord`, tidak ada pembuat objek kedua, dan response API tetap array field di atas.
