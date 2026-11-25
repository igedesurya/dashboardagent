# Plan: Mode Project (tim agent per project)

Status: Tahap 0–4 selesai (lihat `docs/tahap0-hasil.md` dan bagian "Status Tahap 1–4" di bawah). Alur tim lengkap. Plan lain di `docs/` tetap ditunda dan tidak tergantung plan ini.

## Tujuan

Dashboard punya dua mode yang dipilih di top bar:

| Mode | Isi | Sifat |
|---|---|---|
| **Semua Editor** | Seperti sekarang: semua sesi Claude, Cursor, opencode, Grok di Mac ini, termasuk sesi yang pengguna tulis sendiri di Claude Code | Hanya membaca. **Tidak diubah oleh plan ini.** |
| **Project** (misalnya Gravis) | Satu tim agent berperan PM, BA, SA, Programmer, QA yang bekerja untuk satu project | Dashboard menjalankan agent di balik layar, pengguna bicara dengan PM lewat chat di dashboard |

Tujuan utamanya tetap visualisasi: pengguna memantau siapa sedang mengerjakan apa, siapa menunggu jawaban, dan tiket ada di tahap mana.

## Prinsip

- Semua berjalan lokal di Mac pengguna. Tidak ada layanan cloud baru, tidak ada yang dipublish. Server hanya listen di `127.0.0.1`.
- Pengguna **tidak mengetik perintah terminal** untuk memakai Mode Project. Memberi tugas, menjawab pertanyaan, dan menyetujui izin, semuanya dari dashboard.
- Engine dijalankan dashboard di balik layar dengan login pengguna sendiri. Tidak membuat API key. Didukung sejak awal: **Claude Code, opencode, dan Cursor**, dan engine dipilih per peran di pengaturan project. Codex menyusul.
- Agent tidak pernah `git push` dan tidak pernah merge ke branch utama. Pengguna yang memutuskan.

## Hubungan dengan sesi Claude Code pengguna

| Pengguna menulis di… | Artinya | Tampil di |
|---|---|---|
| Claude Code (terminal atau aplikasi desktop) | Sesi pribadi pengguna, bukan bagian tim | Mode Semua Editor |
| Chat PM di dashboard | Tugas untuk tim project | Mode Project |

- Sesi PM, BA, SA, Programmer, dan QA adalah sesi Claude Code sungguhan. Transkripnya tersimpan di `~/.claude/projects` seperti sesi lain, jadi juga tampil di mode Semua Editor dan bisa dibuka di Claude Code untuk diperiksa.
- Jangan mengetik di sesi tim dari Claude Code selama dashboard menjalankannya. Dua penulis di satu sesi membuat percakapan bentrok. Dashboard menampilkan peringatan ini di kartu agent.
- Sesi pribadi pengguna tidak otomatis masuk tim.
- **Nanti (bukan tahap awal):** satu tool MCP kecil supaya pengguna bisa mengetik di Claude Code "kirim ke PM Gravis: …" dan tugasnya masuk ke chat PM.

## Peran

| Peran | Tugas | Boleh bertanya ke pengguna | Akses repo |
|---|---|---|---|
| **PM** | Menerima semua permintaan (fitur, bug, change request). Menilai besar pekerjaan, menentukan jumlah Programmer dan QA, mendistribusikan, menahan tiket yang belum disetujui klien, melapor ke pengguna. | Ya | Baca saja |
| **BA** | Riset dan aturan bisnis, perubahan flow bisnis, menulis use case dan skenario uji untuk QA. | Ya, soal bisnis | Baca saja |
| **SA** | Analisa teknis, memecah tugas untuk Programmer, review kode (bersih, rapi, efisien). | Ya, soal teknis | Baca saja |
| **Programmer** (1..n) | Mengubah kode sesuai tugas SA, lalu menjalankan aplikasi dan memastikan tidak ada error. | Tidak, lewat SA | Tulis kode dan jalankan perintah, hanya di branch tiket |
| **QA** (1..n) | Menguji sesuai use case dari BA, melapor lulus atau gagal. | Tidak, lewat PM | Jalankan aplikasi dan test, tidak mengubah kode |

Hanya PM, BA, dan SA yang bicara langsung dengan pengguna. Semua pertanyaan tampil di chat dashboard dengan lencana peran penanya. Dokumen tiket (analisa BA, rencana SA, use case) disimpan lewat tool orchestrator, bukan ditulis ke repo, sehingga peran baca-saja tetap tidak menyentuh repo.

## Alur tiket

Pengguna hanya bicara dengan PM. Setiap permintaan menjadi satu **tiket**.

```
pengguna ─▶ PM ─┬─▶ [Tunggu klien]  (fitur / change request belum disetujui klien: tetap di PM)
                ├─▶ BA  (ada urusan bisnis / perubahan flow)  ─┐
                └─▶ SA  (teknis, termasuk bug)  ◀──────────────┘
                     │
                     ▼
               Programmer ─▶ review SA ──(belum bersih)──▶ kembali ke Programmer
                     │            │
                     │       (lolos)
                     ▼            ▼
               Run aplikasi oleh Programmer ──(error)──▶ kembali ke Programmer
                     │
                     ▼
               QA, memakai use case dari BA ──(gagal)──▶ SA ─▶ Programmer
                     │
                  (lulus)
                     ▼
                    PM ─▶ laporan ke pengguna ─▶ Selesai
```

Status tiket:

| Status | Pemegang | Zona di dunia 3D |
|---|---|---|
| `baru` | PM | Ruang kerja PM |
| `tanya_pengguna` | PM, BA, atau SA | Ruang rapat (menunggu kamu) |
| `tunggu_klien` | PM | Ruang kerja PM, tiket ditandai jeda |
| `analisa_bisnis` | BA | Perpustakaan |
| `analisa_teknis` | SA | Perpustakaan |
| `pengerjaan` | Programmer | Meja kerja |
| `review_kode` | SA | Meja SA |
| `run_aplikasi` | Programmer | Ruang server |
| `testing` | QA | Ruang server |
| `laporan` | PM | Ruang rapat |
| `selesai` | — | Agent kembali santai |
| `gagal` | pemegang terakhir | Klinik |

PM yang menentukan jumlah Programmer dan QA per tiket, dibatasi maksimum di konfigurasi project.

## Arsitektur

```
Browser (dashboard)
  │  mode Semua Editor ──▶ server.js di Docker (seperti sekarang, baca saja)
  │  mode Project ───────▶ orchestrator di Mac, 127.0.0.1:5180
  │                            │  menyimpan tiket, menjalankan sesi, mengirim event (SSE)
  │                            ├─▶ sesi Claude Code "PM"          ┐
  │                            ├─▶ sesi Claude Code "SA"          │ satu proses per peran,
  │                            └─▶ sesi Claude Code "Programmer 1"┘ hidup terus selama tiket aktif
  │                                     │
  │                                     └─ memanggil tool MCP orchestrator (serahkan, tanya_pengguna, izin, …)
```

### Orchestrator

- Proses Node baru tanpa dependency npm, berjalan langsung di Mac (bukan di Docker), di `127.0.0.1:5180`.
- Alasan tidak di Docker: Claude Code dan login-nya ada di Mac, dan agent harus bekerja di repo asli. Container yang sekarang tetap baca saja dan tidak berubah.
- Pengguna tidak menyalakannya lewat terminal. Orchestrator dipasang sekali sebagai layanan `launchd`, sehingga menyala otomatis saat login ke Mac. Dashboard menampilkan statusnya; kalau mati, tombol Mode Project menjelaskan cara memasangnya.
- Browser berbicara langsung ke orchestrator (CORS hanya untuk origin dashboard).

### Menjalankan Claude Code

Setiap peran adalah satu proses Claude Code yang tetap hidup, dikendalikan lewat stream JSON. Perintah ini dijalankan orchestrator, bukan pengguna:

```
claude -p --input-format stream-json --output-format stream-json --verbose \
  --mcp-config <config orchestrator> \
  --permission-prompt-tool mcp__ahq__izin \
  --append-system-prompt <instruksi peran> \
  [--resume <session-id>]
```

- Pesan untuk peran itu (tugas dari PM, jawaban pengguna) dikirim sebagai baris JSON ke stdin. Keluaran (teks, tool yang dipakai, selesai) dibaca dari stdout dan diubah menjadi event untuk dunia 3D.
- `--resume` dipakai supaya percakapan tiap peran tetap berlanjut setelah orchestrator restart.
- Folder kerja: PM, BA, SA, QA di folder project; Programmer di worktree tiketnya.
- Batas akses per peran diatur dengan flag izin Claude Code (misalnya `--permission-mode plan` atau `--disallowedTools` untuk peran baca saja). Flag pastinya diverifikasi di Tahap 0.

### Menjalankan opencode

opencode punya server HTTP bawaan (`opencode serve`, API v2), jadi tidak perlu membaca keluaran terminal:

- Orchestrator menyalakan satu `opencode serve --hostname 127.0.0.1` dan berbicara lewat API-nya: membuat sesi per peran, mengirim pesan, menerima event (SSE).
- Permintaan izin opencode datang sebagai event dan dijawab lewat API, jadi aturan "keamanan ditanya" bisa diterapkan langsung.
- Server MCP `ahq` dipasang lewat konfigurasi MCP opencode; peran baca saja memakai agent `plan` bawaan opencode.
- Model mengikuti provider yang sudah diatur pengguna di opencode.

### Menjalankan Cursor

Cursor dijalankan lewat `cursor-agent` dalam mode non-interaktif. Satu giliran adalah satu proses:

```
cursor-agent -p --output-format stream-json --resume <chat-id> --model … --approve-mcps "<pesan>"
```

- Chat per peran dibuat sekali dengan `cursor-agent create-chat`, lalu dilanjutkan dengan `--resume`.
- Peran baca saja memakai `--plan`.
- Mode non-interaktif Cursor tidak punya cara mengarahkan dialog izin ke program lain. Aturan "keamanan ditanya" diterapkan lewat **hooks Cursor** (`beforeShellExecution`, `preToolUse`): hook memanggil orchestrator dan menunggu jawaban pengguna dari dashboard sebelum mengizinkan atau menolak. Hook ini hanya aktif untuk sesi yang dijalankan orchestrator, tidak untuk Cursor yang dipakai pengguna sendiri.
- MCP `ahq` dipasang lewat konfigurasi MCP Cursor di folder kerja sesi.

### Kesamaan ketiga engine

Setiap engine dibungkus satu adapter dengan bentuk yang sama: `mulai(peran)`, `kirim(pesan)`, event `teks` / `tool` / `izin` / `selesai` / `error`, dan `hentikan()`. Alur tiket, tool MCP, aturan izin, batas 2 agent, dan visualisasi tidak tahu engine apa yang dipakai.

### Protokol antar peran: tool MCP

Orchestrator menyediakan server MCP `ahq` yang dipasang ke setiap sesi. Agent tidak saling memanggil langsung; mereka memakai tool ini, dan orchestrator yang menegakkan aturan, misalnya Programmer tidak mendapat `tanya_pengguna`.

| Tool | Dipakai oleh | Fungsi |
|---|---|---|
| `tanya_pengguna(pertanyaan)` | PM, BA, SA | Muncul di chat dashboard; tiket ke `tanya_pengguna`; jawaban dikirim balik ke sesi |
| `serahkan(ke, tugas)` | PM, SA, Programmer, QA | Pindahkan tiket ke peran lain sesuai alur |
| `bagi(programmer, qa, tugas[])` | PM, SA | Tentukan jumlah orang dan pecah tugas |
| `tahan_klien(alasan)` | PM | Tiket ke `tunggu_klien`, tidak didistribusikan |
| `simpan_dokumen(jenis, isi)` | BA, SA | Analisa, rencana, use case, disimpan di tiket |
| `lapor(hasil)` | PM | Laporan akhir ke pengguna |
| `selesai(hasil)` / `gagal(alasan)` | semua | Akhiri giliran |
| `izin(...)` | Claude Code sendiri | Permintaan izin tool diarahkan ke dashboard sebagai "Menunggu kamu" dengan tombol Izinkan / Tolak |

### Penyimpanan

Di luar repo dan di luar folder data editor: `~/.agent-hq/projects/<id>/`

- `project.json`: nama, daftar folder project, instruksi tiap peran, maksimum Programmer dan QA.
- `tickets/<id>.json`: status, riwayat, pertanyaan dan jawaban, dokumen, use case.
- `sessions.json`: session-id Claude Code per peran, untuk `--resume`.

### Branch dan worktree

Branch dibuat **otomatis oleh orchestrator**, bukan oleh Programmer dan bukan oleh pengguna:

1. Saat rencana SA disetujui, orchestrator membuat branch `ahq/<tiket>` dari branch yang sedang aktif, di setiap repo yang disentuh tiket.
2. Setiap Programmer mendapat branch sendiri, misalnya `ahq/T12-p1` dan `ahq/T12-p2`, di **worktree** sendiri. Worktree adalah salinan kerja kedua dari repo yang sama, di folder terpisah (`~/.agent-hq/worktrees/…`). Folder kerja pengguna dan branch yang sedang pengguna pakai tidak tersentuh.
3. Setelah review SA lolos, orchestrator menggabungkan branch Programmer ke `ahq/<tiket>` secara lokal.
4. Setelah QA lulus dan PM melapor, pengguna sendiri yang memutuskan merge `ahq/<tiket>` ke branch utama. Dashboard menampilkan tombol untuk membuka diff-nya.
5. Worktree dihapus setelah tiket selesai; branch-nya tetap ada sampai pengguna menghapusnya.

### Keamanan repo

- Tidak ada `push`, tidak ada merge otomatis.
- Izin mengikuti aturan **keamanan ditanya, pengerjaan tidak** (lihat Keputusan 3).

## Tampilan

- Saklar mode di top bar: **Semua Editor** | **Project: Gravis ▾**.
- Di mode Project, dunia 3D hanya berisi tim project itu. Nama karakter adalah peran ("PM", "SA", "Programmer 1") dengan lencana engine.
- Panel **Chat PM**: pengguna menulis ke PM. Pertanyaan dari PM, BA, dan SA serta permintaan izin muncul di sini dengan lencana peran.
- Panel **Tiket**: papan dengan kolom status. Klik tiket untuk melihat riwayat dan dokumennya.
- Pengaturan project di dashboard: membuat project, menambah dan menghapus folder terkait, mengubah instruksi peran. Pengguna tidak mengedit `project.json` dengan tangan.
- Agent berjalan antar zona sesuai status tiket, memakai animasi yang sudah ada.

## Tahapan

0. **Siapkan dan uji ketiga engine.**
   - Pasang Claude Code versi terminal (sekarang hanya ada versi bawaan aplikasi desktop) dan login sekali.
   - Uji: proses stream-json yang tetap hidup menerima beberapa pesan berturut-turut, `--resume` melanjutkan percakapan, `--permission-prompt-tool` memanggil tool MCP buatan sendiri, server MCP `ahq` terpasang lewat `--mcp-config`, dan flag pembatas akses untuk peran baca saja.
   - opencode: `opencode serve` di 127.0.0.1, buat sesi, kirim pesan, terima event, jawab izin lewat API, pasang MCP `ahq`, agent `plan` untuk baca saja.
   - Cursor: `create-chat` lalu `-p --resume` beberapa giliran, keluaran stream-json, `--plan`, MCP `ahq`, dan hooks yang menunggu jawaban dari orchestrator tanpa mengganggu Cursor milik pengguna.
   - Hasil: tabel perintah dan API final untuk ketiga engine.
1. **Saklar mode + PM saja.** Orchestrator dengan `launchd`, pengaturan project dengan pilihan folder dari dashboard, chat PM, karakter PM di dunia 3D, tool `tanya_pengguna`, `tahan_klien`, `lapor`, dan `izin`.
2. **BA dan SA.** `serahkan`, `simpan_dokumen`, pertanyaan bisnis dan teknis ke pengguna, papan tiket.
3. **Programmer.** Persetujuan rencana SA oleh pengguna, branch per tiket, review SA, run aplikasi, putaran perbaikan.
4. **QA dan banyak orang.** Use case dari BA, testing, laporan ke PM, beberapa Programmer dan QA paralel lewat worktree.
5. **Nanti.** Codex lewat adapter yang sama; tool "kirim ke PM" dari Claude Code; hooks HTTP untuk status yang lebih akurat di mode Semua Editor.

## Catatan login

Mode Project memakai Claude Code milik pengguna dengan login pengguna sendiri, untuk alat pribadi yang tidak dipublish. Dokumentasi Agent SDK memakai API key dan melarang *produk pihak ketiga* menawarkan login claude.ai kepada penggunanya. Kasus alat pribadi seperti ini tidak disebut eksplisit di dokumentasi.

## Keputusan

### 1. Folder project — diputuskan

Satu project bisa berisi beberapa folder, dan pengguna memilih sendiri folder mana yang terkait dari dashboard. Untuk Gravis awalnya `~/Medquest/Gravis/gravis-tablet`, `gravis-agent`, dan `gravis-admin`; folder lain bisa ditambah kapan saja.

- SA menentukan folder mana yang disentuh tiap tiket.
- Branch `ahq/<tiket>` dan worktree dibuat per folder yang disentuh. Folder yang bukan repo git hanya boleh dibaca.
- Semua sesi peran mendapat akses baca ke seluruh folder project (`--add-dir`); akses tulis hanya ke worktree tiket milik Programmer.

### 2. Persetujuan rencana SA — diputuskan

Wajib. Setelah SA selesai menyusun rencana teknis, tiket berhenti di `tanya_pengguna` dengan rencana SA dan tombol **Setujui** / **Minta revisi**. Programmer tidak dijalankan sebelum disetujui. Tidak bisa dimatikan di tahap awal.

### 3. Izin: keamanan ditanya, pengerjaan tidak — diputuskan

Aturannya: apa pun yang menyangkut keamanan selalu ditanyakan ke pengguna lewat `izin`. Pekerjaan biasa di dalam worktree tiket langsung jalan.

| Langsung jalan (pengerjaan) | Selalu ditanya (keamanan) |
|---|---|
| Membaca file di folder project | Membaca atau mengubah file rahasia: `.env*`, kunci, sertifikat, kredensial |
| Mengubah file di dalam worktree tiket | Mengubah atau menghapus file di luar worktree tiket |
| Build, test, lint, menjalankan aplikasi lokal | Memasang atau menghapus paket / dependency |
| Perintah git lokal di branch tiket (status, diff, commit) | `git push`, operasi remote, mengubah branch lain |
| | Perintah jaringan ke luar Mac (curl, wget, deploy) |
| | `sudo`, mengubah pengaturan sistem, menghentikan proses lain |
| | Menyentuh database atau layanan sungguhan (bukan lokal) |

Daftar ini diterapkan orchestrator di tool `izin`. Yang tidak jelas masuk golongan **ditanya**. Pengguna bisa menyetujui sekali atau "selalu untuk project ini".

### 4. Batas kuota — diputuskan

Langganan Claude punya batas pemakaian per beberapa jam. Kalau banyak agent bekerja bersamaan, batas itu cepat habis, dan setelah habis **semua** sesi Claude ikut berhenti sampai pulih, termasuk sesi Claude Code pribadi pengguna.

Keputusan: **maksimal 2 agent bekerja bersamaan di seluruh dashboard**, bukan per project.

- Yang dihitung hanya agent yang sedang memproses giliran. Agent yang menunggu jawaban pengguna, menunggu persetujuan, atau tiketnya ditahan untuk klien tidak memakan jatah.
- Giliran lain antre. Antrean dilayani berurutan menurut waktu masuk; pertanyaan dan laporan PM didahulukan supaya pengguna tidak lama menunggu.
- PM yang memutuskan "2 Programmer" tetap boleh: keduanya mendapat tugas dan worktree sendiri, tapi berjalan bergantian kalau jatahnya sedang dipakai peran lain.
- Kalau batas langganan tercapai, semua giliran dijeda dengan status jelas di dashboard dan dilanjutkan otomatis setelah pulih. Selama jeda, semua agent beristirahat: di dunia 3D mereka pindah ke taman, kafe, dan kolam.
- Batas 2 agent berlaku untuk semua engine sekaligus (Claude, opencode, Cursor), supaya aturannya sederhana.
- Di dunia 3D, agent yang antre duduk santai dengan gelembung "antre".

## Status Tahap 1

Selesai dan diuji ujung ke ujung dengan ketiga engine (Claude Code, opencode, Cursor) di repo percobaan.

- Kode: `orchestrator/` (server, aturan izin, server MCP `ahq`, hook Cursor, adapter per engine) dan `mockup/project.js` (saklar mode, pengaturan project, chat PM, tiket).
- Data: `~/.agent-hq/` (project, chat, tiket, sesi per peran, folder kerja per peran). Tidak ada file yang ditulis ke folder project.
- Tool PM yang aktif: `buat_tiket`, `tanya_pengguna`, `tahan_klien`, `lanjutkan_tiket`, `lapor`, `selesaikan_tiket`, `daftar_tiket`.
- Status tiket yang dipakai: `baru`, `tanya_pengguna`, `tunggu_klien`, `siap` (siap didistribusikan, menunggu Tahap 2), `selesai`.
- Jeda kuota dihitung per engine: kalau kuota Claude habis, agent Claude istirahat 15 menit lalu mencoba lagi; agent engine lain tetap jalan.
- Pertanyaan bersifat tidak-menahan: `tanya_pengguna` langsung kembali, PM mengakhiri giliran, dan jawaban dikirim sebagai pesan berikutnya ke sesi yang sama.

Catatan:
- Ada server Vite proyek lain di `[::1]:5173`. Browser yang membuka `localhost:5173` bisa mendarat di sana; buka dashboard lewat `http://127.0.0.1:5173`.
- Orchestrator dipasang sebagai layanan login macOS dengan `orchestrator/install-launchd.sh` (sekali saja); `install-launchd.sh uninstall` untuk menghapus.

## Status Tahap 2

Selesai dan diuji ujung ke ujung dengan opencode (`9router/model-loop-gpt-oss`) di repo percobaan.

- Peran aktif: PM, BA, SA. Engine dan model bisa diatur per peran (termasuk Programmer dan QA, yang baru bekerja di Tahap 3 dan 4). Peran yang belum diatur memakai pengaturan PM.
- Tool baru: `serahkan` (PM → BA/SA, BA → SA/PM, SA → BA/PM), `simpan_dokumen` (analisa bisnis, use case, analisa teknis), `ajukan_rencana` (SA), `baca_tiket` (semua).
- Status tiket baru: `analisa_bisnis`, `analisa_teknis`, `menunggu_persetujuan`, `siap_dikerjakan`. Tiket punya `holder` (pemegang), `docs`, dan `plan`.
- Rencana SA tampil sebagai kartu dengan tombol Setujui dan Minta revisi (wajib catatan). Revisi dikirim kembali ke SA; persetujuan membuat tiket menunggu Programmer.
- Aturan tambahan dari pengujian:
  - BA wajib menyimpan analisa bisnis sebelum menyerahkan tiket (use case dibutuhkan QA).
  - Kalau BA/SA mengakhiri giliran sambil masih memegang tiket tanpa bertanya, menyimpan, atau menyerahkan, orchestrator mengingatkan sekali per langkah tiket.
  - Pemecah perintah shell menghormati tanda kutip; membaca path yang tidak ada tidak lagi ditanyakan.
- Belum: Programmer dan QA (Tahap 3–4). Tiket berhenti di "Siap dikerjakan Programmer".

## Status Tahap 3

- Persetujuan rencana SA langsung memulai pengerjaan. `ajukan_rencana` sekarang juga berisi `repo` (folder yang diubah) dan `tugas` (satu per Programmer).
- Git (`orchestrator/git.js`, semuanya lokal, tanpa fetch/push):
  - branch tiket `ahq/<tiket>` dari HEAD folder pengguna saat rencana disetujui, di worktree `~/.agent-hq/worktrees/<project>/<tiket>/tiket/<repo>`;
  - satu branch dan worktree per Programmer: `ahq/<tiket>-p<n>` di `…/<tiket>/p<n>/<repo>`;
  - folder kerja dan branch pengguna tidak disentuh; hanya metadata worktree di `.git` yang bertambah.
- Programmer (`dev`, bisa beberapa per tiket): `selesai_kerja` (commit otomatis), `butuh_bantuan` (ke SA), `lapor_run` (tahap run).
- SA: `arahkan_programmer`, `minta_perbaikan` (per Programmer atau semua), `lolos_review` (orchestrator menggabungkan branch Programmer ke `ahq/<tiket>`; konflik dikembalikan ke Programmer yang bersangkutan).
- Setelah digabung, satu Programmer menjalankan test/aplikasi di worktree branch tiket sampai tidak ada error, lalu tiket berstatus `siap_qa`. Run gagal dikembalikan ke SA.
- Status tiket baru: `dikerjakan`, `review_kode`, `perbaikan`, `run_aplikasi`, `siap_qa`.
- Keamanan Programmer: edit dan perintah terminal yang menyentuh folder project asli langsung ditolak dengan petunjuk path worktree yang benar; edit di luar worktree tetap ditanyakan.
- Tidak dilanjutkan otomatis setelah orchestrator restart: tiket yang terhenti punya tombol "Lanjutkan pengerjaan" di tab Tiket.

## Status Tahap 4

- QA aktif (`qa`, bisa beberapa per tiket sesuai rencana SA). QA menjalankan test/aplikasi tapi tidak boleh mengubah kode (`noEdit`).
- Setelah run aplikasi berhasil, setiap QA mendapat salinan terpisah (worktree terlepas/detached di `…/<tiket>/qa<n>/<repo>`) yang diset ulang ke commit terbaru `ahq/<tiket>` di setiap putaran.
- QA memakai use case BA; tanpa use case, QA menyusun skenario dari rencana SA. Tool: `lapor_uji` (lulus/gagal, hasil, temuan).
- Ada yang gagal → status `review_kode`, temuan dikirim ke SA → `minta_perbaikan` → review → run → QA ulang.
- Semua lulus → status `laporan`, PM melapor ke pengguna (perubahan, hasil QA, branch, perintah `git diff`) dan menutup tiket dengan `selesaikan_tiket` setelah pengguna menerima.
- `selesaikan_tiket` menghapus semua worktree tiket; branch `ahq/<tiket>` tetap ada untuk di-merge pengguna.
- Rencana SA tanpa QA (`qa: 0`) langsung ke laporan PM.
- Uji simulasi (`AHQ_DRY_RUN=1`, langkah agent dikirim lewat rute MCP yang sama, git asli): 21 cek lulus, termasuk konflik penggabungan, QA gagal lalu lulus, larangan edit QA, dan pembersihan worktree.
