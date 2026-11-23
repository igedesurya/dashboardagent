# Plan: filter proyek, sumber, dan status

Boleh dikerjakan setelah `docs/plan-bentuk-agen.md` selesai. Boleh sejajar dengan plan notifikasi. Jangan digabung dengan plan riwayat.

Tujuan: pengguna menyembunyikan agen yang tidak ingin dilihat, tanpa mengubah data dari server.

Filter murni di browser. `GET /api/agents` tetap mengembalikan semua agen dalam jendela waktu.

## Bukan lingkup

- Filter di server, query `?source=`, atau snapshot SSE yang sudah dipotong.
- Kotak cari teks bebas.
- Menyimpan filter per proyek di disk server.
- Mengubah hitungan chip status di top bar. Chip tetap menghitung **semua** agen yang diterima, supaya angka tidak tergantung filter.
- Menghapus agen dari `byId` hanya karena tidak lolos filter. Mereka harus bisa muncul lagi tanpa menunggu snapshot baru.

## Perilaku

Tiga filter, semuanya opsional, digabung dengan AND:

| Filter | Nilai | Sumber pilihan |
|---|---|---|
| Status | satu nilai `STATES`, atau semua | kunci `STATES` di `agents.js` |
| Sumber | satu `source`, atau semua | sumber yang sedang ada di daftar agen, plus label dari `SOURCES` |
| Proyek | satu `project`, atau semua | `def.project` yang sedang ada |

Pilihan “semua” adalah default. Mengganti daftar agen tidak boleh mereset filter, kecuali nilai yang dipilih sudah tidak ada. Kalau tidak ada lagi, kembalikan filter itu ke “semua”.

Agen yang tidak lolos:

- tidak digambar di `#agentList`;
- karakternya disembunyikan di scene (`visible = false` pada root), termasuk label;
- tidak bisa dipilih. Kalau yang sedang dipilih tersembunyi, panggil `select(null)`.

Agen yang lolos tetap di posisi dan statusnya. Jangan memanggil `place()` hanya karena filter berubah.

`#count` di judul panel menampilkan jumlah yang lolos filter, bukan jumlah total. Chip top bar tetap total.

Daftar kosong karena filter (masih ada agen, tapi tidak ada yang lolos) memakai kalimat i18n yang berbeda dari `panel.empty` (memang tidak ada agen).

## Di mana kodenya

Satu objek `filter` dan satu fungsi `matchFilter(agent)` di `mockup/main.js`. `renderList` memakai fungsi itu. Menyembunyikan mesh dilakukan di fungsi yang sama yang sudah meng-update tampilan setelah snapshot (`refresh` / akhir `applySnapshot`), bukan di dalam renderer Three.js.

Jangan buat file `filter.js`. Aturan filternya tiga perbandingan.

UI: tiga `<select>` di bagian atas `#panel` di `index.html`, di bawah judul panel. Gaya boleh memakai `.winbox select` yang sudah ada. Opsi diisi dari `main.js` setiap kali `renderList` jalan.

Simpan pilihan di `localStorage` dengan satu kunci, misalnya `agent-hq-filter`, berisi `{ state, source, project }`. Nilai “semua” disimpan sebagai string kosong. Pola simpan yang sama seperti pilihan jendela waktu yang sudah ada di `main.js`; jangan membuat helper storage umum hanya untuk ini.

Teks opsi “Semua” dan pesan daftar kosong masuk `i18n.js` (`id` dan `en`). Label status memakai `stateLabel`. Label sumber memakai `SOURCES[].label`.

## Yang tidak boleh ditambah

- Parameter filter pada `/api/agents` atau `/api/settings`.
- Menduplikasi daftar agen menjadi “daftar tampilan” kedua yang menyimpan salinan field. Filter membaca `agents` yang sudah ada.
- Mengubah `sort` snapshot di server.

## Cek selesai

1. Tanpa filter, daftar dan pulau sama seperti sebelum perubahan.
2. Filter `waiting` hanya menampilkan agen waiting di panel dan di pulau. Chip waiting di top bar tetap menghitung semua yang waiting, termasuk yang tersembunyi oleh filter lain.
3. Filter sumber `cursor` dan proyek tertentu sekaligus hanya menampilkan irisan keduanya.
4. Reload halaman mengembalikan filter yang terakhir dipilih.
5. Agen tersembunyi yang kemudian lolos (filter diubah) muncul lagi tanpa pindah zona.
6. Response `/api/agents` tidak berubah.
7. Layar sempit (lebar di bawah 760px): ketiga select tetap bisa dipakai di panel bawah.
