# Plan: riwayat singkat per agen

Kerjakan setelah `docs/plan-bentuk-agen.md` selesai. Riwayat mengamati perubahan `state` dan `task` yang sudah lewat `agentRecord()`. Jangan membaca ulang file log untuk menyusun riwayat.

Tujuan: kartu agen menampilkan beberapa perubahan terakhir yang terjadi **selama server ini hidup**. Tombol `card.log` yang sekarang `disabled` menjadi pembuka daftar itu.

## Bukan lingkup

- Memutar ulang file `.jsonl` atau database opencode menjadi timeline lama.
- Menyimpan riwayat ke disk. Restart server mengosongkan riwayat. Jangan menulis ke folder Claude, Cursor, opencode, atau Grok.
- Mengirim riwayat di dalam `GET /api/agents` atau SSE. Snapshot itu tetap array agen tanpa field baru.
- Grafik, ekspor, atau pencarian di dalam riwayat.
- Modul `HistoryService` terpisah dari penyimpan yang disebut di bawah. Satu tempat simpan, satu endpoint baca.

## Apa yang dicatat

Di `tick()` di `server.js`, bandingkan snapshot baru dengan snapshot sebelumnya (objek di memori, bukan string JSON). Untuk tiap `id`:

- Catat satu baris bila `state` atau `task` berubah.
- Abaikan bila keduanya sama.
- Abaikan kemunculan pertama sebuah `id` pada proses ini (bukan “perubahan”).
- Saat `id` hilang dari snapshot, jangan membuat baris “offline”. Hapus juga buffer id itu supaya memori tidak tumbuh.

Satu baris hanya: `t` (epoch ms), `state`, `task`. Tidak menyalin `model`, `tokens`, atau isi tool. Maksimal 20 baris per `id`. Baris ke-21 membuang yang paling lama.

Simpan di satu `Map` di `server.js`, di samping `bots`. Jangan masukkan buffer ini ke objek yang dikembalikan `agentRecord()`.

## Endpoint

`GET /api/agents/history?id=<id>`

- `id` wajib, persis nilai `id` agen. Tolak kalau kosong atau mengandung karakter aneh di luar yang sudah dipakai id (`huruf, angka, :, _, -`). Balas `400`.
- Ditemukan: `200` dan `{ id, events }` dengan `events` urut dari yang terlama ke yang terbaru. Kosong berarti `[]`, bukan `404`.
- Jangan menambah rute dengan path dinamis selain query `id`. Server sekarang mencocokkan `pathname` persis; query menjaga pencocokan itu tetap sederhana.

Panggil pencatatan di dalam `tick()` setelah `collect()` berhasil, sebelum string SSE dikirim. Kalau `collect()` melempar, jangan mengubah buffer.

## UI

Di `mockup/main.js`, tombol `card.log` aktif hanya saat `live`. Klik mengambil riwayat id yang sedang dipilih dan menggambarnya di dalam kartu, di bawah `dl` yang sudah ada. Maksimal tampilan 20 baris: jam (`hhmm` dari `t`), label status (`stateLabel`), dan `task`.

Jangan mengambil riwayat di setiap frame atau setiap snapshot. Hanya saat kartu dibuka dan saat tombol diklik lagi. Tidak ada polling baru.

Mode demo: tombol tetap nonaktif. Demo tidak punya riwayat server.

Teks kosong (“belum ada perubahan sejak server jalan”) masuk `i18n.js` untuk `id` dan `en`.

Gaya daftar memakai markup yang sudah ada di kartu. Jangan menambah panel baru.

## Yang tidak boleh ditambah

- Field `history` pada objek agen.
- Parser kedua yang membaca log hanya untuk timeline.
- Database, file JSON, atau cache di `parsed` untuk riwayat. `parsed` tetap cache isi file sumber.
- Menggabungkan pekerjaan ini dengan notifikasi atau filter.

## Cek selesai

1. `GET /api/agents` dan event SSE tidak berisi `events` atau field baru.
2. Dua tick dengan `state` dan `task` yang sama tidak menambah baris.
3. Perubahan `task` menambah satu baris. Baris ke-21 menghapus yang pertama.
4. Id yang hilang dari snapshot ikut terhapus dari `Map`.
5. Restart proses: `events` untuk id itu `[]`.
6. Kartu live menampilkan daftar. Demo tidak memanggil endpoint.
7. Folder data agen tidak mendapat file baru.
