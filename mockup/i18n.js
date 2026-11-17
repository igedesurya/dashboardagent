// i18n — dua bahasa: Indonesia (id) dan Inggris (en).
// Bahasa default mengikuti bahasa browser; pilihan user disimpan di localStorage.

export const LANGS = [
  { code: 'id', label: 'ID', name: 'Indonesia' },
  { code: 'en', label: 'EN', name: 'English' },
];

const DICT = {
  id: {
    // umum
    'app.title': 'Agent HQ',
    'app.loading': 'memuat…',
    'app.live': 'live',
    'app.demo': 'demo · data palsu',
    'app.disconnected': 'terputus, mencoba lagi…',
    'app.demoSub': 'Mode demo: data palsu.',

    // status agent
    'state.coding': 'Ngoding',
    'state.thinking': 'Berpikir',
    'state.running': 'Menjalankan',
    'state.reading': 'Membaca',
    'state.waiting': 'Menunggu kamu',
    'state.idle': 'Santai',
    'state.error': 'Error',

    // panel & HUD
    'panel.title': 'Agent',
    'panel.empty': 'Belum ada agent aktif.',
    'panel.emptyHint': 'Jalankan Claude Code, Cursor, atau opencode — mereka akan muncul di gerbang.',
    'hud.activity': 'Aktivitas',
    'hud.clockAuto': 'Otomatis',
    'hud.clockDay': 'Siang',
    'hud.clockDusk': 'Senja',
    'hud.clockNight': 'Malam',
    'hud.tooltip.agents': 'Daftar agent (A)',
    'hud.tooltip.fullscreen': 'Layar penuh',
    'hud.tooltip.window': 'Rentang waktu agent yang ditampilkan',
    'hud.windowLabel': 'Rentang waktu',

    // rentang waktu
    'window.minutes': '{n} mnt',

    // legenda zona
    'zone.desk': 'Ruang kerja = ngoding / berpikir',
    'zone.server': 'Server = jalanin command',
    'zone.library': 'Perpustakaan = baca/cari',
    'zone.meeting': 'Rapat = nunggu kamu',
    'zone.leisure': 'Taman / Kafe & Kolam / Lapangan = santai',
    'zone.clinic': 'Klinik = error',

    // kartu detail
    'card.close': 'Tutup',
    'card.send': 'Kirim pesan',
    'card.log': 'Lihat log',
    'card.hint': 'Kirim pesan & log belum tersedia (dashboard hanya membaca).',
    'card.task': 'Tugas',
    'card.tool': 'Tool terakhir',
    'card.model': 'Model',
    'card.project': 'Proyek',
    'card.tokens': 'Token',
    'card.active': 'Aktif',
    'card.walking': 'sedang berjalan…',
    'card.legend': 'Legenda',

    // durasi
    'dur.hm': '{h} j {m} m',
    'dur.m': '{m} m',

    // aktivitas demo
    'task.edit': 'mengedit {f}',
    'task.write': 'menulis {f}',
    'task.refactor': 'refactor {f}',
    'task.fix': 'memperbaiki bug di {f}',
    'task.read': 'membaca {f}',
    'task.searchTodo': 'mencari "TODO" di repo',
    'task.readDocs': 'membaca dokumentasi API',
    'task.grep': 'grep "handleSubmit"',
    'task.readme': 'membaca README.md',
    'task.permitRm': 'minta izin: rm -rf dist/',
    'task.askDb': 'tanya: Postgres atau SQLite?',
    'task.permitPush': 'minta izin: git push origin main',
    'task.needKey': 'butuh API key baru',
    'task.permitInstall': 'minta izin: npm install zod',
    'task.errType': 'TypeError: cannot read "id"',
    'task.err429': '429 Too Many Requests',
    'task.errTests': '3 dari 42 test gagal',
    'task.errTimeout': 'Koneksi timeout ke API',
    'task.errSyntax': 'SyntaxError di baris 88',
    'idle.coffee': 'ngopi sambil nunggu tugas',
    'idle.fish': 'memancing, tugas selesai ✓',
    'idle.nap': 'tidur siang… zzz',
    'idle.cafe': 'nongkrong di kafe ☕',
    'idle.swim': 'berenang bolak-balik 🏊',
    'idle.float': 'mengapung pakai ban 🛟',
    'idle.sun': 'berjemur di pinggir kolam 😎',
    'idle.soccer': 'main bola ⚽',
    'idle.jog': 'lari keliling lapangan 🏃',
    'idle.hoops': 'latihan basket 🏀',
    'idle.yoga': 'yoga, tarik napas… 🧘',
  },
  en: {
    'app.title': 'Agent HQ',
    'app.loading': 'loading…',
    'app.live': 'live',
    'app.demo': 'demo · fake data',
    'app.disconnected': 'disconnected, retrying…',
    'app.demoSub': 'Demo mode: fake data.',

    'state.coding': 'Coding',
    'state.thinking': 'Thinking',
    'state.running': 'Running',
    'state.reading': 'Reading',
    'state.waiting': 'Waiting for you',
    'state.idle': 'Chilling',
    'state.error': 'Error',

    'panel.title': 'Agents',
    'panel.empty': 'No active agents yet.',
    'panel.emptyHint': 'Run Claude Code, Cursor, or opencode — they will show up at the gate.',
    'hud.activity': 'Activity',
    'hud.clockAuto': 'Auto',
    'hud.clockDay': 'Day',
    'hud.clockDusk': 'Dusk',
    'hud.clockNight': 'Night',
    'hud.tooltip.agents': 'Agent list (A)',
    'hud.tooltip.fullscreen': 'Fullscreen',
    'hud.tooltip.window': 'How far back to show agents',
    'hud.windowLabel': 'Time range',

    'window.minutes': '{n} min',

    'zone.desk': 'Workspace = coding / thinking',
    'zone.server': 'Server = running commands',
    'zone.library': 'Library = reading/searching',
    'zone.meeting': 'Meeting room = waiting for you',
    'zone.leisure': 'Garden / Cafe & Pool / Field = relaxing',
    'zone.clinic': 'Clinic = error',

    'card.close': 'Close',
    'card.send': 'Send message',
    'card.log': 'View log',
    'card.hint': 'Sending messages & logs are not available (read-only dashboard).',
    'card.task': 'Task',
    'card.tool': 'Last tool',
    'card.model': 'Model',
    'card.project': 'Project',
    'card.tokens': 'Tokens',
    'card.active': 'Active',
    'card.walking': 'walking…',
    'card.legend': 'Legend',

    'dur.hm': '{h}h {m}m',
    'dur.m': '{m}m',

    'task.edit': 'editing {f}',
    'task.write': 'writing {f}',
    'task.refactor': 'refactoring {f}',
    'task.fix': 'fixing a bug in {f}',
    'task.read': 'reading {f}',
    'task.searchTodo': 'searching "TODO" in the repo',
    'task.readDocs': 'reading the API docs',
    'task.grep': 'grep "handleSubmit"',
    'task.readme': 'reading README.md',
    'task.permitRm': 'asking permission: rm -rf dist/',
    'task.askDb': 'asking: Postgres or SQLite?',
    'task.permitPush': 'asking permission: git push origin main',
    'task.needKey': 'needs a new API key',
    'task.permitInstall': 'asking permission: npm install zod',
    'task.errType': 'TypeError: cannot read "id"',
    'task.err429': '429 Too Many Requests',
    'task.errTests': '3 of 42 tests failed',
    'task.errTimeout': 'Connection timed out to API',
    'task.errSyntax': 'SyntaxError on line 88',
    'idle.coffee': 'grabbing coffee, waiting for work',
    'idle.fish': 'fishing, all tasks done ✓',
    'idle.nap': 'napping… zzz',
    'idle.cafe': 'hanging out at the cafe ☕',
    'idle.swim': 'swimming laps 🏊',
    'idle.float': 'floating on a ring 🛟',
    'idle.sun': 'sunbathing by the pool 😎',
    'idle.soccer': 'playing soccer ⚽',
    'idle.jog': 'jogging around the field 🏃',
    'idle.hoops': 'practicing basketball 🏀',
    'idle.yoga': 'doing yoga, breathing… 🧘',
  },
};

let current = 'id';
const listeners = new Set();

export function detectLang() {
  const saved = localStorage.getItem('agent-hq-lang');
  if (saved && DICT[saved]) return saved;
  const nav = (navigator.language || 'id').toLowerCase();
  return nav.startsWith('id') ? 'id' : 'en';
}

export function lang() {
  return current;
}

export function setLang(code) {
  current = DICT[code] ? code : 'id';
  localStorage.setItem('agent-hq-lang', current);
  document.documentElement.lang = current;
  applyStatic();
  for (const fn of listeners) fn(current);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Terjemahkan kunci; `vars` mengisi placeholder {nama}. */
export function t(key, vars) {
  const s = DICT[current]?.[key] ?? DICT.id[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}

/** Label status agent sesuai bahasa aktif. */
export function stateLabel(state) {
  return t(`state.${state}`);
}

/** Terapkan terjemahan ke elemen statis yang ditandai data-i18n. */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
}

export function initI18n() {
  setLang(detectLang());
}
