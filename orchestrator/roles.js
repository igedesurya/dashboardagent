// Two sessions only: one working session, and one QA session opened when that work asks for a separate test.

export const ROLES = {
  worker: { label: 'Pengerjaan', readOnly: false, active: true },
  // QA runs tests and the app but never edits code (noEdit).
  qa: { label: 'QA', readOnly: false, noEdit: true, active: true },
};

export const TOOLS = {
  tanya_pengguna: {
    roles: ['worker'],
    description: 'Ajukan satu pertanyaan ke pengguna. Pertanyaan tampil di dashboard. Setelah memanggil ini, AKHIRI giliranmu: jawabannya datang sebagai pesan berikutnya.',
    inputSchema: { type: 'object', properties: { pertanyaan: { type: 'string' } }, required: ['pertanyaan'] },
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
    description: 'Minta sesi QA terpisah menguji perubahanmu. Panggil HANYA bila perubahan perlu diuji oleh pihak lain. Bug kecil yang sudah kamu uji sendiri tidak perlu QA. Setelah memanggil, AKHIRI giliranmu; hasil QA datang sebagai pesan.',
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
        lulus: { type: 'boolean' },
        hasil: { type: 'string', description: 'Daftar skenario yang diuji beserta hasilnya (lulus/gagal) dan perintah yang dipakai.' },
        temuan: { type: 'string', description: 'Bila gagal: langkah reproduksi, hasil yang diharapkan, hasil sebenarnya.' },
      },
      required: ['lulus', 'hasil'],
    },
  },
  lapor: {
    roles: ['worker'],
    description: 'Kirim laporan resmi ke pengguna. Sebelum memanggil, centang setiap butir Proof di playbook. Isi bukti dengan butir yang sudah dicek.',
    inputSchema: { type: 'object', properties: { isi: { type: 'string' }, bukti: { type: 'string', description: 'Butir Proof yang sudah dicek, satu per baris.' } }, required: ['isi'] },
  },
  izin: {
    roles: ['worker', 'qa'],
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

function roleInstructions(role, project) {
  const folders = project.folders.map((f) => `- ${f}`).join('\n') || '- (belum ada folder)';
  if (role === 'worker') {
    return `# Peranmu: pekerja project "${project.name}"

## Folder project
${folders}
Kerjakan langsung di folder ini, pada branch yang sedang terbuka. Jangan membuat branch baru dan jangan pindah branch.

Kamu satu-satunya sesi yang mengerjakan project ini. Analisa, rencana, penulisan kode, dan menjalankan tes terjadi di percakapan ini. Tidak ada peran lain selain satu sesi QA, dan QA hanya dibuka lewat \`minta_qa\`.

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
- Jangan git push. Jangan buat branch baru dan jangan pindah branch (git checkout -b, git switch -c, git branch nama-baru, dan git checkout nama-branch ditolak). Commit tetap di branch yang sedang terbuka.
- Jangan membaca file rahasia (.env, kunci, kredensial).
- Teks jawaban akhirmu tampil di chat dashboard; tulis singkat, dalam bahasa yang dipakai pengguna.`;
  }
  if (role === 'qa') {
    return `# Peranmu: QA untuk project "${project.name}"

## Folder project
${folders}
Kamu sesi kedua. Sesi pengerjaan sudah mengubah kode di folder ini; kamu hanya menguji dan melaporkan. Kamu tidak melihat percakapan sesi itu, jadi uji berdasarkan pesan tugas.

## Cara kerja
1. Ikuti cara uji yang disebut di pesan. Gunakan perintah yang selesai sendiri; jangan menjalankan server yang tidak pernah berhenti.
2. \`lapor_uji\`: lulus=true hanya bila yang diminta benar-benar berhasil. Bila gagal, isi temuan dengan langkah reproduksi.

## Aturan
- Kamu TIDAK mengubah kode.
- Jangan git push. Jangan buat branch baru dan jangan pindah branch. Perintah itu ditolak.
- Jangan membaca file rahasia (.env, kunci, kredensial).
- Teks jawaban akhirmu tampil di chat dashboard; tulis singkat.`;
  }
  return '';
}

export const PROJECT_KINDS = ['software', 'tulisan', 'lainnya'];
export const isSoftware = (project) => (project.brief?.jenis || 'software') === 'software';
export const hasBrief = (project) => !!(project.brief?.jenis && String(project.brief?.tujuan || '').trim());

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
    lines.push('', '**Project ini BUKAN software.** "Kode" berarti dokumen/naskah di folder project. Tidak ada aplikasi yang dijalankan, tidak ada test otomatis, dan tidak ada paket yang dipasang.');
    if (role === 'qa') lines.push('Tugasmu memeriksa isi dokumen terhadap kriteria dengan MEMBACA, bukan menjalankan program.');
  }
  return lines.join('\n');
}

export function instructions(role, project, opts = {}) {
  const base = roleInstructions(role, project, opts);
  if (!base) return '';
  const nl = base.indexOf('\n');
  return `${base.slice(0, nl)}\n\n${briefBlock(project, role)}\n${base.slice(nl)}`;
}
