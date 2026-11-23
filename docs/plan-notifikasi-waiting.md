# Plan: notifikasi saat agen menunggu

Kerjakan setelah `docs/plan-bentuk-agen.md` selesai. Plan ini tidak mengubah bentuk objek agen dan tidak menambah endpoint.

Tujuan: kalau sebuah agen berpindah ke `state: "waiting"` saat dashboard terbuka, browser memberi tahu pengguna. Status itu sudah berarti agen butuh jawaban atau izin.

## Bukan lingkup

- Suara khusus per sumber, push ke ponsel, email, atau bot Telegram.
- Notifikasi untuk `error`, `idle`, atau pergantian task.
- Service worker, backend antrian, atau tabel notifikasi.
- Mengubah `server.js`, `lib/agent.js`, atau parser log.
- Menghidupkan tombol `card.send` / `card.log`.

## Perilaku

Sumber data tetap snapshot yang sudah masuk lewat `applySnapshot()` di `mockup/main.js` (SSE `/api/stream`, atau hasil pertama `GET /api/agents`).

Beri notifikasi hanya jika semua ini benar:

1. Mode live (`live === true`). Mode demo tidak menembak notifikasi.
2. Bukan snapshot pertama (`firstSnapshot` masih true saat agen pertama kali dipasang). Munculnya agen yang sudah `waiting` saat halaman dibuka tidak menembak notifikasi. Yang dihitung hanya transisi ke `waiting` setelah itu.
3. `a.state` sebelumnya bukan `waiting`, dan state baru adalah `waiting`.
4. Id yang sama tidak dinotifikasi lagi selama ia tetap `waiting`. Setelah pindah ke status lain lalu kembali ke `waiting`, boleh dinotifikasi sekali lagi.

Isi notifikasi: nama agen, sumber, dan `task` (kalau `task` kosong, pakai teks i18n umum). Klik notifikasi memfokuskan tab dan memilih agen itu (`select`).

Minta izin `Notification` lewat satu tombol di top bar, bukan saat halaman dibuka. Kalau izin ditolak atau API tidak ada, tombol menampilkan keadaan mati dan tidak melempar error. Judul tab boleh menambahkan jumlah agen `waiting` (misalnya `(2) Agent HQ`) karena itu tidak butuh izin.

Tidak ada suara di plan ini.

## Di mana kodenya

Satu fungsi di `mockup/main.js`: `notifyWaiting(agent)`. Dipanggil dari cabang `applySnapshot` yang sudah mendeteksi perubahan state, setelah `place()`. Jangan buat modul baru: pemakaiannya hanya di file ini.

Jangan menyalin logika “apakah ini transisi waiting” ke `renderList` atau `renderStats`. Dua fungsi itu tetap hanya menggambar. Chip `waiting` yang sudah berdenyut di panel tetap seperti sekarang.

Teks baru masuk `mockup/i18n.js` untuk `id` dan `en` sekaligus: label tombol, status izin ditolak, dan kalimat notifikasi. Jangan hardcode kalimat di `main.js`.

Tombol di top bar `mockup/index.html`, di samping kontrol yang sudah ada. Gaya mengikuti `button` yang sudah ada. Jangan menambah stylesheet terpisah.

## Yang tidak boleh ditambah

- Endpoint `/api/notify`.
- Antrian di server. SSE sudah mengirim snapshot.
- Wrapper di sekitar `Notification`. Satu fungsi cukup.
- Menyimpan izin di localStorage. Browser sudah menyimpan izin.

## Cek selesai

1. Buka dashboard live. Agen yang sudah `waiting` saat load tidak memunculkan notifikasi.
2. Saat agen itu pindah ke `waiting` dari status lain, satu notifikasi muncul. Snapshot berikutnya yang masih `waiting` tidak menambah notifikasi lagi.
3. Mode demo tidak memunculkan notifikasi.
4. Izin ditolak: tidak ada error di konsol, tombol terlihat nonaktif.
5. `server.js` dan `lib/agent.js` tidak berubah.
