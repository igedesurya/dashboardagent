# Plan: filter proyek, sumber, dan status

Plan ini murni di browser dan tidak memakai `agentRecord`, jadi tidak perlu menunggu `docs/plan-bentuk-agen.md`. Boleh sejajar dengan plan notifikasi. Jangan digabung dengan plan riwayat.

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
- karakternya disembunyikan di scene, termasuk label, tali pancing, dan pelampung (lihat di bawah);
- tidak bisa dipilih, termasuk lewat klik di scene. Kalau yang sedang dipilih tersembunyi, panggil `select(null)`.

### Yang perlu disembunyikan di three.js r160

`root.visible = false` saja tidak cukup. Sudah dicek di source three@0.160.0:

- `CSS2DRenderer` hanya melihat `visible` milik objek label sendiri, bukan induknya. Set juga `a.label.visible = false`, kalau tidak, nama dan gelembung tetap tampil.
- `Raycaster` tidak memeriksa `visible`. `pickAgent()` harus melewati agen yang tidak lolos filter, kalau tidak, agen tersembunyi tetap bisa diklik.
- `a.line` dan `a.bobber` (pancing) dipasang langsung ke scene, bukan ke root. `Agent.update()` menyalakannya lagi tiap frame saat aksi `fish`. Beri `Agent` satu flag (misalnya `hidden`) yang dicek di `update()` sebelum menyalakan keduanya.

Semua ini di satu tempat: method kecil `setHidden(v)` di `Agent` yang mengatur root, label, dan flag pancing. Jangan menyebar `visible = ...` di `main.js`.

Agen yang lolos tetap di posisi dan statusnya. Jangan memanggil `place()` hanya karena filter berubah.

`#count` ada di tombol 👥 di top bar, bukan di judul panel. Tanpa filter aktif, ia tetap menampilkan total. Dengan filter aktif, ia menampilkan `lolos/total` (misalnya `3/14`), supaya terlihat ada agen yang disembunyikan. Chip status di top bar tetap total.

Daftar kosong karena filter (masih ada agen, tapi tidak ada yang lolos) memakai kalimat i18n yang berbeda dari `panel.empty` (memang tidak ada agen).

## Di mana kodenya

Satu objek `filter` dan satu fungsi `matchFilter(agent)` di `mockup/main.js`. `renderList` memakai fungsi itu. Menyembunyikan mesh dilakukan di fungsi yang sama yang sudah meng-update tampilan setelah snapshot (`refresh` / akhir `applySnapshot`), bukan di dalam renderer Three.js.

Jangan buat file `filter.js`. Aturan filternya tiga perbandingan.

UI: tiga `<select>` di bagian atas `#panel` di `index.html`, di bawah judul panel. Panel tertutup secara bawaan; filter tetap berlaku walau panel ditutup, dan `#count` memberi tanda bahwa filter aktif. Gaya boleh memakai `.winbox select` yang sudah ada. Opsi diisi dari `main.js` setiap kali `renderList` jalan.

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
6. Agen tersembunyi tidak menyisakan label, gelembung, atau tali pancing, dan klik di posisinya tidak memilih apa pun.
7. Dengan filter aktif, tombol 👥 menampilkan `lolos/total`.
8. Response `/api/agents` tidak berubah.
9. Layar sempit (lebar di bawah 760px): ketiga select tetap bisa dipakai di panel bawah.
