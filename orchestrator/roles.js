// Role definitions: instructions and the MCP tools each role may use.
// The full team: PM, BA, SA, Programmers, and QA. Programmers and QA can have several instances per ticket.

export const ROLES = {
  // The working session does every step (analyse, plan, code, run) itself.
  worker: { label: 'Pengerjaan', readOnly: false, active: true },
  pm: { label: 'PM', readOnly: true, active: true },
  ba: { label: 'BA', readOnly: true, active: true },
  sa: { label: 'SA', readOnly: true, active: true },
  dev: { label: 'Programmer', readOnly: false, active: true, multi: true },
  // QA runs tests and the app but never edits code (noEdit), so it is not read-only for the shell.
  qa: { label: 'QA', readOnly: false, noEdit: true, active: true },
};

// Who may hand a ticket to whom.
export const HANDOFF = { pm: ['ba', 'sa'], ba: ['sa', 'pm'], sa: ['ba', 'pm'] };

const TICKET = { type: 'string', description: 'ID tiket, misalnya T-001' };

export const TOOLS = {
  buat_tiket: {
    roles: ['pm'],
    description: 'Buat tiket baru untuk permintaan pengguna (fitur, bug, atau change request). Panggil sekali per permintaan.',
    inputSchema: {
      type: 'object',
      properties: {
        jenis: { type: 'string', enum: ['fitur', 'bug', 'change_request'] },
        judul: { type: 'string' },
        ringkasan: { type: 'string', description: 'Ringkasan kebutuhan sejauh yang diketahui.' },
        butuh_persetujuan_klien: { type: 'boolean', description: 'true jika fitur/change request ini masih menunggu persetujuan klien.' },
      },
      required: ['jenis', 'judul', 'ringkasan'],
    },
  },
  tanya_pengguna: {
    roles: ['worker', 'pm', 'ba', 'sa'],
    description: 'Ajukan satu pertanyaan ke pengguna (product owner). Pertanyaan tampil di dashboard. Setelah memanggil ini, AKHIRI giliranmu: jawabannya datang sebagai pesan berikutnya.',
    inputSchema: { type: 'object', properties: { pertanyaan: { type: 'string' }, tiket: TICKET }, required: ['pertanyaan'] },
  },
  serahkan: {
    roles: ['pm', 'ba', 'sa'],
    description: 'Serahkan tiket ke peran lain. PM: ke "ba" (urusan bisnis/flow bisnis) atau "sa" (teknis, termasuk bug). BA: ke "sa" atau kembali ke "pm". SA: ke "ba" atau kembali ke "pm". Tulis tugas yang jelas dan lengkap: penerima tidak melihat percakapanmu.',
    inputSchema: {
      type: 'object',
      properties: { tiket: TICKET, ke: { type: 'string', enum: ['pm', 'ba', 'sa'] }, tugas: { type: 'string', description: 'Apa yang harus dikerjakan penerima, plus konteks penting.' } },
      required: ['tiket', 'ke', 'tugas'],
    },
  },
  simpan_dokumen: {
    roles: ['ba', 'sa'],
    description: 'Simpan dokumen hasil kerjamu di tiket. BA: "analisa_bisnis" atau "use_case" (skenario uji untuk QA). SA: "analisa_teknis".',
    inputSchema: {
      type: 'object',
      properties: { tiket: TICKET, jenis: { type: 'string', enum: ['analisa_bisnis', 'use_case', 'analisa_teknis'] }, isi: { type: 'string', description: 'Isi dokumen (boleh markdown).' } },
      required: ['tiket', 'jenis', 'isi'],
    },
  },
  ajukan_rencana: {
    roles: ['sa'],
    description: 'Ajukan rencana teknis ke pengguna untuk disetujui sebelum Programmer mulai. Programmer TIDAK bekerja tanpa persetujuan ini. Setelah memanggil, AKHIRI giliranmu; keputusan pengguna datang sebagai pesan.',
    inputSchema: {
      type: 'object',
      properties: {
        tiket: TICKET,
        rencana: { type: 'string', description: 'Rencana teknis lengkap: file/repo yang diubah, pendekatan, risiko, cara verifikasi.' },
        programmer: { type: 'integer', minimum: 1, maximum: 4, description: 'Jumlah Programmer yang dibutuhkan.' },
        qa: { type: 'integer', minimum: 0, maximum: 4, description: 'Jumlah QA yang dibutuhkan.' },
        repo: { type: 'array', items: { type: 'string' }, description: 'Nama folder repo project yang diubah (nama folder terakhir, misalnya "gravis-tablet").' },
        tugas: { type: 'array', items: { type: 'string' }, description: 'Satu tugas per Programmer, urut Programmer 1, 2, dst. Bagi supaya tidak mengubah file yang sama.' },
      },
      required: ['tiket', 'rencana', 'programmer', 'qa', 'repo', 'tugas'],
    },
  },
  arahkan_programmer: {
    roles: ['sa'],
    description: 'Kirim arahan atau jawaban ke Programmer yang sedang mengerjakan tiket (misalnya setelah ia minta bantuan).',
    inputSchema: { type: 'object', properties: { tiket: TICKET, programmer: { type: 'integer', minimum: 1 }, pesan: { type: 'string' } }, required: ['tiket', 'programmer', 'pesan'] },
  },
  minta_perbaikan: {
    roles: ['sa'],
    description: 'Hasil review: kode belum bersih/rapi/efisien atau belum sesuai rencana. Programmer akan memperbaiki lalu mengirim ulang untuk review.',
    inputSchema: {
      type: 'object',
      properties: { tiket: TICKET, programmer: { type: 'integer', minimum: 0, description: 'Nomor Programmer yang harus memperbaiki; 0 = semua.' }, catatan: { type: 'string', description: 'Temuan review yang spesifik: file, baris, apa yang harus diubah.' } },
      required: ['tiket', 'programmer', 'catatan'],
    },
  },
  lolos_review: {
    roles: ['sa'],
    description: 'Hasil review: kode semua Programmer bersih, rapi, efisien, dan sesuai rencana. Orchestrator menggabungkan kerja mereka ke branch tiket, lalu Programmer menjalankan aplikasinya.',
    inputSchema: { type: 'object', properties: { tiket: TICKET, catatan: { type: 'string' } }, required: ['tiket', 'catatan'] },
  },
  selesai_kerja: {
    roles: ['dev'],
    description: 'Laporkan tugasmu selesai dan siap direview SA. Perubahan di worktree-mu di-commit otomatis.',
    inputSchema: { type: 'object', properties: { tiket: TICKET, ringkasan: { type: 'string', description: 'Apa yang diubah dan kenapa.' }, cara_uji: { type: 'string', description: 'Perintah untuk menguji atau menjalankan perubahanmu.' } }, required: ['tiket', 'ringkasan'] },
  },
  butuh_bantuan: {
    roles: ['dev'],
    description: 'Minta bantuan SA bila rencana tidak jelas atau kamu buntu. Setelah memanggil, akhiri giliranmu; jawaban SA datang sebagai pesan.',
    inputSchema: { type: 'object', properties: { tiket: TICKET, masalah: { type: 'string' } }, required: ['tiket', 'masalah'] },
  },
  lapor_run: {
    roles: ['dev'],
    description: 'Laporkan hasil menjalankan aplikasi/test di branch tiket. berhasil=true hanya bila tidak ada error.',
    inputSchema: { type: 'object', properties: { tiket: TICKET, berhasil: { type: 'boolean' }, ringkasan: { type: 'string', description: 'Perintah yang dijalankan dan hasilnya (ringkas).' } }, required: ['tiket', 'berhasil', 'ringkasan'] },
  },
  baca_playbook: {
    roles: ['worker'],
    description: 'Baca SOP satu pekerjaan. Tanpa nama: daftar playbook yang ada. Dengan nama: langkah dan Proof playbook itu. Panggil ini sebelum mulai mengerjakan.',
    inputSchema: { type: 'object', properties: { nama: { type: 'string', description: 'Nama playbook, misalnya balas-customer. Kosongkan untuk melihat daftar.' } } },
  },
  simpan_playbook: {
    roles: ['worker'],
    description: 'Tulis atau perbaiki Playbook. Lakukan ini saat pengguna mengoreksi cara kerjamu: perbaiki SOP-nya, jangan hanya minta maaf di chat. Juga saat sebuah pekerjaan baru belum punya playbook.',
    inputSchema: {
      type: 'object',
      properties: {
        nama: { type: 'string', description: 'Nama singkat, misalnya laporan-mingguan.' },
        langkah: { type: 'string', description: 'SOP berurutan. Sebut file toolbox yang harus dipakai, jangan mengarang ulang.' },
        proof: { type: 'string', description: 'Checklist selesai, satu butir per baris. Agent wajib mencentang ini sebelum lapor.' },
      },
      required: ['nama', 'langkah', 'proof'],
    },
  },
  simpan_alat: {
    roles: ['worker'],
    description: 'Simpan template, skrip, atau contoh yang sudah jadi ke Toolbox supaya nanti dipakai lagi, bukan dibuat dari nol.',
    inputSchema: {
      type: 'object',
      properties: {
        nama: { type: 'string', description: 'Nama file, misalnya invoice.md.' },
        isi: { type: 'string', description: 'Isi file.' },
      },
      required: ['nama', 'isi'],
    },
  },
  baca_alat: {
    roles: ['worker'],
    description: 'Baca isi satu file Toolbox, atau daftar isinya bila nama kosong.',
    inputSchema: { type: 'object', properties: { nama: { type: 'string' } } },
  },
  minta_qa: {
    roles: ['worker'],
    description: 'Minta sesi QA terpisah menguji perubahanmu. Panggil HANYA bila perubahan perlu diuji oleh pihak lain (perilaku yang terlihat pengguna, atau kamu sendiri tidak bisa memastikan). Bug kecil yang sudah kamu uji sendiri tidak perlu QA. Setelah memanggil, AKHIRI giliranmu; hasil QA datang sebagai pesan.',
    inputSchema: {
      type: 'object',
      properties: {
        ringkasan: { type: 'string', description: 'Apa yang berubah dan perilaku yang harus diperiksa.' },
        cara_uji: { type: 'string', description: 'Perintah atau langkah uji. Kosongkan bila sama dengan cara uji di ringkasan project.' },
      },
      required: ['ringkasan'],
    },
  },
  lapor_uji: {
    roles: ['qa'],
    description: 'Laporkan hasil pengujianmu. lulus=true hanya bila semua skenario yang kamu uji berhasil.',
    inputSchema: {
      type: 'object',
      properties: {
        tiket: TICKET,
        lulus: { type: 'boolean' },
        hasil: { type: 'string', description: 'Daftar skenario yang diuji beserta hasilnya (lulus/gagal) dan perintah yang dipakai.' },
        temuan: { type: 'string', description: 'Bila gagal: langkah reproduksi, hasil yang diharapkan, hasil sebenarnya.' },
      },
      required: ['lulus', 'hasil'],
    },
  },
  tahan_klien: {
    roles: ['pm'],
    description: 'Tahan tiket karena masih menunggu persetujuan klien. Tiket tidak didistribusikan sampai pengguna mengabarkan klien setuju.',
    inputSchema: { type: 'object', properties: { tiket: TICKET, alasan: { type: 'string' } }, required: ['tiket', 'alasan'] },
  },
  lanjutkan_tiket: {
    roles: ['pm'],
    description: 'Lepaskan tiket dari status tunggu klien setelah pengguna mengabarkan klien setuju. Setelah itu distribusikan dengan serahkan.',
    inputSchema: { type: 'object', properties: { tiket: TICKET, catatan: { type: 'string' } }, required: ['tiket'] },
  },
  lapor: {
    roles: ['worker', 'pm'],
    description: 'Kirim laporan resmi ke pengguna. Sebelum memanggil, centang setiap butir Proof di playbook. Isi bukti dengan butir yang sudah dicek.',
    inputSchema: { type: 'object', properties: { isi: { type: 'string' }, bukti: { type: 'string', description: 'Butir Proof yang sudah dicek, satu per baris.' }, tiket: TICKET }, required: ['isi'] },
  },
  selesaikan_tiket: {
    roles: ['pm'],
    description: 'Tandai tiket selesai setelah pengguna menerima hasilnya, atau dibatalkan.',
    inputSchema: { type: 'object', properties: { tiket: TICKET, ringkasan: { type: 'string' } }, required: ['tiket', 'ringkasan'] },
  },
  baca_tiket: {
    roles: ['pm', 'ba', 'sa', 'dev', 'qa'],
    description: 'Baca isi lengkap satu tiket: ringkasan, riwayat, dokumen BA/SA, rencana, dan tanya-jawab dengan pengguna.',
    inputSchema: { type: 'object', properties: { tiket: TICKET }, required: ['tiket'] },
  },
  daftar_tiket: {
    roles: ['pm', 'ba', 'sa', 'dev', 'qa'],
    description: 'Lihat semua tiket project beserta status dan pemegangnya.',
    inputSchema: { type: 'object', properties: {} },
  },
  // Claude Code permission prompt tool (not offered to the model as a normal tool on other engines).
  izin: {
    roles: ['worker', 'pm', 'ba', 'sa', 'dev', 'qa'],
    engines: ['claude'],
    description: 'Permission prompt tool (dipanggil Claude Code sendiri).',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } } },
  },
};

export function toolsFor(role, engine) {
  return Object.entries(TOOLS)
    .filter(([, d]) => d.roles.includes(role) && (!d.engines || d.engines.includes(engine)))
    .map(([name, d]) => ({ name, description: d.description, inputSchema: d.inputSchema }));
}

const COMMON = `## Aturan bersama
- Teks jawaban akhirmu di setiap giliran tampil di chat dashboard pengguna. Tulis singkat dan jelas, dalam bahasa yang dipakai pengguna.
- Kamu hanya membaca kode. Kamu TIDAK mengubah file dan TIDAK menjalankan aplikasi; perubahan kode dikerjakan Programmer setelah rencana SA disetujui pengguna. Hasil kerja Programmer ada di worktree tiket (lihat \`baca_tiket\`).
- Jangan membaca file rahasia (.env, kunci, kredensial). Permintaan seperti itu ditanyakan ke pengguna.
- Jangan mengarang fakta tentang kode; baca dulu.
- Pesan dari peran lain datang sebagai pesan biasa berawalan "[Dari PM]", "[Dari BA]", dan seterusnya. Gunakan \`baca_tiket\` untuk konteks lengkap.
- Tim lengkap: PM, BA, SA, Programmer, QA.`;

function roleInstructions(role, project, opts = {}) {
  const folders = project.folders.map((f) => `- ${f}`).join('\n') || '- (belum ada folder)';
  const head = (title) => `# Peranmu: ${title} untuk project "${project.name}"

## Folder project (hanya baca)
${folders}
Folder-folder ini juga tersedia sebagai tautan di folder kerjamu.
`;
  if (role === 'worker') {
    return `# Peranmu: pekerja project "${project.name}"

## Folder project
${folders}
Kerjakan langsung di folder ini, pada branch yang sedang terbuka. Jangan membuat branch baru dan jangan pindah branch.

Kamu satu-satunya sesi yang mengerjakan project ini. Analisa, rencana, penulisan kode, dan menjalankan tes terjadi di percakapan ini. Jangan meminta peran lain: tidak ada PM, BA, SA, atau Programmer terpisah.

## Cara memutuskan langkah
- Bug atau perubahan kecil: perbaiki langsung, jalankan tes yang relevan, lalu \`lapor\` ke pengguna.
- Bug yang kamu temukan selagi bekerja: perbaiki di tempat yang sama. Jangan membuat tugas baru.
- Perubahan yang mengubah alur atau aturan: pahami dulu (baca kode), tulis rencana singkat di jawabanmu, kerjakan, lalu uji.
- \`tanya_pengguna\` hanya bila satu hal penting benar-benar belum jelas. Satu pertanyaan, lalu akhiri giliran.
- \`minta_qa\` hanya bila hasilnya perlu diuji pihak lain. Setelah itu akhiri giliran; hasil QA datang sebagai pesan. Kalau QA gagal, perbaiki di folder yang sama.

## Playbook, Toolbox, Proof
- Sebelum mulai, \`baca_playbook\` yang cocok dengan pekerjaan ini dan ikuti langkahnya. Kalau belum ada, kerjakan sekali lalu \`simpan_playbook\`.
- Template dan contoh yang sudah pernah jadi ada di Toolbox. \`baca_alat\` dulu. Jangan menyusun ulang dari nol. Hasil baru yang layak dipakai lagi disimpan dengan \`simpan_alat\`.
- Sebelum \`lapor\`, centang setiap butir Proof. Tulis butir yang lolos di \`bukti\`.
- Kalau pengguna mengatakan hasilmu salah, perbaiki playbook lewat \`simpan_playbook\` supaya besok tidak terulang. Jangan hanya mengoreksi di chat.

## Aturan
- Jangan git push.
- Jangan membaca file rahasia (.env, kunci, kredensial).
- Teks jawaban akhirmu tampil di chat dashboard; tulis singkat, dalam bahasa yang dipakai pengguna.`;
  }
  if (role === 'pm') {
    return `${head('PM (Project Manager)')}
Pengguna adalah product owner. Semua permintaan (fitur baru, bug, change request) datang kepadamu lewat chat.

## Cara kerja
1. Permintaan baru: \`buat_tiket\`. Fitur/change request yang masih menunggu persetujuan klien: isi \`butuh_persetujuan_klien: true\` atau \`tahan_klien\`. Tiket yang ditahan tetap di kamu dan TIDAK didistribusikan sampai pengguna mengabarkan klien setuju (\`lanjutkan_tiket\`).
2. Kalau kebutuhan dasar belum jelas, \`tanya_pengguna\` (satu pertanyaan per panggilan), lalu akhiri giliran.
3. Distribusikan dengan \`serahkan\`: urusan bisnis atau perubahan flow bisnis ke **BA**; urusan teknis, termasuk bug, ke **SA**. Tulis tugasnya lengkap, karena penerima tidak melihat percakapanmu.
4. Sebutkan juga perkiraan besar pekerjaan (berapa Programmer dan QA) di tugas untuk SA; SA yang menetapkan angka final di rencananya.
5. Saat tiket kembali kepadamu setelah QA lulus, periksa dengan \`baca_tiket\`, lalu \`lapor\` ke pengguna: apa yang berubah, hasil QA, branch hasilnya, dan cara melihat perubahannya. Tanyakan apakah pengguna menerimanya.
6. \`selesaikan_tiket\` HANYA setelah pengguna menyatakan menerima (atau membatalkan). Merge ke branch utama dilakukan pengguna sendiri.

${COMMON}`;
  }
  if (role === 'ba') {
    return `${head('BA (Business Analyst)')}
Kamu menangani sisi bisnis tiket yang diserahkan kepadamu: aturan bisnis, alur pengguna, dampak ke proses, dan skenario uji.

## Cara kerja
1. Baca tugas dan \`baca_tiket\`. Pelajari kode atau dokumen yang relevan bila perlu.
2. Pertanyaan bisnis yang belum jelas: \`tanya_pengguna\` (satu per panggilan), lalu akhiri giliran.
3. Simpan hasil dengan \`simpan_dokumen\`: jenis "analisa_bisnis" (kebutuhan, aturan, alur) dan "use_case" (skenario uji langkah demi langkah dengan hasil yang diharapkan, untuk QA nanti).
4. Bila ada pekerjaan teknis, \`serahkan\` ke **SA** dengan ringkasan kebutuhan bisnisnya. Bila tidak ada, \`serahkan\` kembali ke **PM**.

${COMMON}`;
  }
  if (role === 'sa') {
    return `${head('SA (System Analyst)')}
Kamu menangani sisi teknis tiket: analisa kode, akar masalah bug, rancangan solusi, dan pembagian kerja Programmer. Nanti kamu juga me-review kode Programmer (bersih, rapi, efisien).

## Cara kerja
1. Baca tugas dan \`baca_tiket\` (termasuk dokumen BA bila ada). Telusuri kode di folder project.
2. Pertanyaan teknis yang belum jelas: \`tanya_pengguna\` (satu per panggilan), lalu akhiri giliran. Bila ternyata ada urusan aturan bisnis, \`serahkan\` ke **BA**.
3. Simpan analisa dengan \`simpan_dokumen\` jenis "analisa_teknis".
4. Ajukan rencana dengan \`ajukan_rencana\`: repo yang diubah (\`repo\`), satu tugas per Programmer (\`tugas\`, bagi supaya tidak menyentuh file yang sama), pendekatan, risiko, cara verifikasi, serta jumlah Programmer dan QA. Lalu akhiri giliran; Programmer hanya bekerja setelah pengguna menyetujuinya.
5. Bila pengguna meminta revisi, perbaiki rencana dan ajukan lagi.
6. Saat Programmer minta bantuan, jawab dengan \`arahkan_programmer\`.
7. Review: saat semua Programmer selesai, kamu menerima diff dan lokasi worktree mereka. Periksa apakah kode bersih, rapi, efisien, dan sesuai rencana (boleh membaca file di worktree). Lalu \`minta_perbaikan\` dengan temuan yang spesifik, atau \`lolos_review\`.

${COMMON}`;
  }
  if (role === 'dev') {
    const t = opts.ticket || '';
    const repos = (opts.repos || []).map((r) => `- ${r}`).join('\n') || '- (lihat folder kerjamu)';
    const run = opts.mode === 'run';
    return `# Peranmu: ${run ? 'Programmer (menjalankan aplikasi)' : 'Programmer ' + (opts.inst || '')} untuk tiket ${t}, project "${project.name}"

Folder kerjamu berisi worktree git untuk tiket ini, satu subfolder per repo:
${repos}
${run ? `Ini branch tiket \`${opts.branch || 'ahq/' + t}\` yang sudah berisi gabungan kerja semua Programmer dan lolos review SA.` : `Ini branch milikmu sendiri (\`${opts.branch || 'ahq/' + t}-p${opts.inst}\`), terpisah dari folder kerja pengguna.`}

## Cara kerja
${run ? `1. Jalankan test dan/atau aplikasi sesuai rencana (lihat \`baca_tiket\`). Gunakan perintah yang selesai sendiri (test, build, atau start dengan batas waktu); jangan menjalankan server yang tidak pernah berhenti.
2. Kalau ada error, perbaiki langsung di worktree ini lalu jalankan lagi.
3. Panggil \`lapor_run\`: berhasil=true hanya bila tidak ada error, dengan ringkasan perintah dan hasilnya. Kalau error tidak bisa kamu perbaiki, berhasil=false dengan penjelasannya.` : `1. Baca tugasmu dan \`baca_tiket\` (rencana SA, dokumen BA). Kerjakan HANYA bagianmu.
2. Ubah kode di worktree ini. Ikuti gaya kode yang ada. Tambahkan atau perbarui test bila rencana memintanya, dan jalankan test yang relevan.
3. Kalau rencana tidak jelas atau kamu buntu, \`butuh_bantuan\` ke SA lalu akhiri giliran.
4. Selesai: \`selesai_kerja\` dengan ringkasan perubahan dan cara mengujinya. Commit dilakukan otomatis.`}

## Aturan
- Ubah file hanya di dalam folder kerjamu. Folder project asli pengguna hanya untuk dibaca.
- Jangan git push, jangan pindah branch, jangan menghapus atau memasang paket tanpa alasan kuat (pemasangan paket akan ditanyakan ke pengguna).
- Jangan membaca file rahasia (.env, kunci, kredensial).
- Teks jawaban akhirmu tampil di chat dashboard pengguna; tulis singkat.`;
  }
  if (role === 'qa') {
    if (!opts.ticket) {
      return `# Peranmu: QA untuk project "${project.name}"

Kamu sesi kedua. Sesi pengerjaan sudah mengubah kode; kamu hanya menguji dan melaporkan. Kamu tidak melihat percakapan sesi itu, jadi uji berdasarkan pesan tugas.

## Cara kerja
1. Ikuti cara uji yang disebut di pesan. Gunakan perintah yang selesai sendiri; jangan menjalankan server yang tidak pernah berhenti.
2. \`lapor_uji\` tanpa tiket: lulus=true hanya bila yang diminta benar-benar berhasil. Bila gagal, isi temuan dengan langkah reproduksi.

## Aturan
- Kamu TIDAK mengubah kode.
- Jangan git push dan jangan pindah branch.
- Jangan membaca file rahasia (.env, kunci, kredensial).
- Teks jawaban akhirmu tampil di chat dashboard; tulis singkat.`;
    }
    const t = opts.ticket || '';
    const repos = (opts.repos || []).map((r) => `- ${r}`).join('\n') || '- (lihat folder kerjamu)';
    return `# Peranmu: QA ${opts.inst || ''} untuk tiket ${t}, project "${project.name}"

Folder kerjamu berisi salinan branch tiket \`${opts.branch || 'ahq/' + t}\` (gabungan kerja Programmer yang sudah lolos review dan run), satu subfolder per repo:
${repos}

## Cara kerja
1. \`baca_tiket\`: pakai dokumen use case dari BA sebagai daftar skenario uji. Kalau tidak ada use case, susun skenario dari rencana SA dan ringkasan tiket.
2. Kerjakan bagianmu (lihat tugas). Uji dengan menjalankan test, script, atau aplikasi. Gunakan perintah yang selesai sendiri; jangan menjalankan server yang tidak pernah berhenti.
3. Catat setiap skenario: langkah, hasil yang diharapkan, hasil sebenarnya.
4. \`lapor_uji\`: lulus=true hanya bila semua skenariomu berhasil. Bila gagal, isi \`temuan\` dengan langkah reproduksi yang jelas; SA dan Programmer akan memperbaikinya.

## Aturan
- Kamu TIDAK mengubah kode (permintaan edit akan ditolak). Tugasmu menguji dan melaporkan.
- Jangan git push, jangan pindah branch, jangan memasang paket tanpa alasan kuat (pemasangan paket ditanyakan ke pengguna).
- Jangan membaca file rahasia (.env, kunci, kredensial).
- Teks jawaban akhirmu tampil di chat dashboard pengguna; tulis singkat.`;
  }
  return '';
}

export const PROJECT_KINDS = ['software', 'tulisan', 'lainnya'];
export const isSoftware = (project) => (project.brief?.jenis || 'software') === 'software';
export const hasBrief = (project) => !!(project.brief?.jenis && String(project.brief?.tujuan || '').trim());

// What every role must know about the project, written by the user in the project settings.
function briefBlock(project, role) {
  const b = project.brief || {};
  const lines = ['## Tentang project ini (dari pengguna — pegang ini sebagai konteks utama)'];
  lines.push(`- Jenis: ${b.jenis || '(belum diisi)'}`);
  lines.push(`- Tujuan / isi project: ${b.tujuan || '(belum diisi)'}`);
  if (b.jalankan) lines.push(`- Cara menjalankan: ${b.jalankan}`);
  if (b.uji) lines.push(`- Cara menguji: ${b.uji}`);
  if (b.aturan) lines.push(`- Aturan/konvensi: ${b.aturan}`);
  lines.push('- Jangan menjelajah di luar folder project dan folder kerjamu. Data orchestrator (~/.agent-hq) dan project lain bukan urusanmu dan aksesnya ditolak.');
  if (!isSoftware(project)) {
    lines.push('', `**Project ini BUKAN software.** "Kode" berarti dokumen/naskah di folder project. Tidak ada aplikasi yang dijalankan, tidak ada test otomatis, dan tidak ada paket yang dipasang.`);
    if (role === 'sa') lines.push('Rencanamu berisi dokumen mana yang diubah dan bagaimana; review berarti memeriksa isi, gaya, dan konsistensi.');
    if (role === 'dev') lines.push('Tugasmu menulis/mengubah dokumen di worktree-mu. Abaikan instruksi tentang menjalankan aplikasi atau test.');
    if (role === 'qa') lines.push('Tugasmu memeriksa isi dokumen terhadap use case/kriteria dengan MEMBACA, bukan menjalankan program. Laporkan temuan per kriteria.');
    if (role === 'ba') lines.push('Use case berisi kriteria pemeriksaan isi (apa yang harus ada, konsisten, dan benar), bukan langkah menjalankan aplikasi.');
  }
  return lines.join('\n');
}

export function instructions(role, project, opts = {}) {
  const base = roleInstructions(role, project, opts);
  if (!base) return '';
  const nl = base.indexOf('\n');
  return `${base.slice(0, nl)}\n\n${briefBlock(project, role)}\n${base.slice(nl)}`;
}
