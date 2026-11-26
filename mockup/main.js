// Merangkai scene, HUD, dan simulator data palsu.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildWorld, HUB, DOOR } from './world.js';
import { Agent, AGENTS, STATES, SOURCES, lookFor } from './agents.js';
import { initI18n, lang, setLang, onLangChange, t, applyStatic, stateLabel } from './i18n.js';
import { initProjectMode } from './project.js';
initI18n();

await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);

// ---------- Renderer & kamera ----------
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
// Light mode (default on): 15 fps, no shadows, 1x resolution. Off: 30 fps, shadows, up to 1.5x resolution.
let lite = true;
try {
  lite = localStorage.getItem('agent-hq-lite') !== '0';
} catch {}
renderer.setPixelRatio(lite ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
stage.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.className = 'labels';
stage.appendChild(labels.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400);
const HOME = new THREE.Vector3(13, 0, 4);
camera.position.copy(HOME).add(new THREE.Vector3(30, 27, 30));
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME);
controls.enableDamping = true;
controls.minZoom = 0.55;
controls.maxZoom = 4;
controls.minPolarAngle = 0.5;
controls.maxPolarAngle = 1.15;

let frustum;
let panelOpen = false;
function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const aspect = w / h;
  // pulau butuh ~50 unit lebar di area yang tidak tertutup panel
  const cover = panelCover();
  const usable = Math.max(160, w - cover.x);
  const need = w > 760 ? 60 : 38; // di HP sisi pulau boleh terpotong, bisa digeser
  const viewH = Math.max(24, (need * w) / usable / aspect);
  const viewW = viewH * aspect;
  // geser frustum supaya pulau tidak tertutup panel (kanan di desktop, bawah di HP)
  frustum = { viewW, viewH, sx: cover.x ? (cover.x / 2 / w) * viewW : 0, sy: cover.y ? (cover.y / 2 / h) * viewH : 0 };
  applyFrustum();
  renderer.setSize(w, h);
  labels.setSize(w, h);
}
// offset dibagi zoom supaya pergeserannya tetap sama dalam piksel
function applyFrustum() {
  const { viewW, viewH, sx, sy } = frustum;
  const z = camera.zoom;
  camera.left = -viewW / 2 + sx / z;
  camera.right = viewW / 2 + sx / z;
  camera.top = viewH / 2 - sy / z;
  camera.bottom = -viewH / 2 - sy / z;
  camera.updateProjectionMatrix();
}
// Pixel span of the open side panel, so a wider chat card still leaves the island visible.
function panelCover() {
  if (!panelOpen) return { x: 0, y: 0 };
  const el = document.getElementById(document.body.classList.contains('project-mode') ? 'chatPanel' : 'panel');
  if (!el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return { x: 0, y: 0 };
  if (stage.clientWidth > 760) return { x: Math.max(0, stage.clientWidth - r.left), y: 0 };
  return { x: 0, y: Math.max(0, stage.clientHeight - r.top) };
}
addEventListener('resize', resize);
resize();

// ---------- Cahaya & waktu ----------
const hemi = new THREE.HemisphereLight('#cfe9ff', '#5a7a3a', 0.9);
const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(hemi, sun, sun.target);
scene.fog = null;

const world = buildWorld(scene);

const C = (c) => new THREE.Color(c);
const SKY = { night: C('#1c2147'), dusk: C('#f3a683'), day: C('#a8dcf0') };
function applyTime(h) {
  const day = THREE.MathUtils.clamp(Math.sin(((h - 6) / 12) * Math.PI) * 1.5, 0, 1);
  const sky = day < 0.5 ? SKY.night.clone().lerp(SKY.dusk, day * 2) : SKY.dusk.clone().lerp(SKY.day, (day - 0.5) * 2);
  scene.background = sky;
  document.documentElement.style.setProperty('--sky', '#' + sky.getHexString());
  hemi.intensity = 0.35 + 0.65 * day;
  hemi.color.set(day > 0.3 ? '#cfe9ff' : '#7f8fd6');
  sun.intensity = 0.45 + 1.9 * day;
  sun.color.set(day > 0.6 ? '#fff3dd' : day > 0.2 ? '#ffb27a' : '#9fb4ff');
  const a = THREE.MathUtils.clamp((h - 6) / 12, 0, 1) * Math.PI;
  sun.position.set(-Math.cos(a) * 30 + 5, 18 + Math.sin(a) * 18, 22);
  renderer.toneMappingExposure = 0.9 + 0.2 * day;
  world.setNight(1 - day);
}

// ---------- Label zona ----------
for (const [zoneKey, z] of Object.entries(world.zones)) {
  const items = z.labels || [[z.label, ...z.labelPos]];
  for (const [textKey, x, zz] of items) {
    const el = document.createElement('div');
    el.className = 'zone-label';
    el.dataset.i18n = textKey;
    el.textContent = t(textKey);
    const o = new CSS2DObject(el);
    o.position.set(x, 0.1, zz);
    scene.add(o);
  }
}

// ---------- Agent & simulator ----------
const agents = [];
const byId = {};
let live = false;
function addAgent(def) {
  const a = new Agent(def, scene);
  a.onClick = select;
  agents.push(a);
  byId[def.id] = a;
  return a;
}
function removeAgent(a) {
  if (a.spot) a.spot.by = null;
  a.dispose(scene);
  agents.splice(agents.indexOf(a), 1);
  delete byId[a.def.id];
  if (selected === a) select(null);
}
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const FILES = {
  'web-shop': ['src/cart.tsx', 'src/auth.ts', 'src/pages/checkout.tsx', 'src/api/order.ts'],
  'api-server': ['routes/users.py', 'models/order.py', 'tests/test_auth.py', 'app/main.py'],
  'telegram-bot': ['bot/handlers.py', 'bot/grok_client.py', 'bot/prompts.py'],
  scraper: ['scraper/spider.py', 'scraper/parse.py', 'config.yaml'],
  'mobile-app': ['lib/home_screen.dart', 'lib/api.dart', 'pubspec.yaml'],
  'data-pipeline': ['etl/load.sql', 'etl/transform.py', 'dags/daily.py'],
};
function buildTasks() {
  return {
  coding: (f) => [
    t('task.edit', { f }), t('task.write', { f }), t('task.refactor', { f }), t('task.fix', { f }),
  ],
  running: () => ['npm test', 'pnpm build', 'pytest -q', 'git status', 'docker compose up', 'tsc --noEmit', 'python main.py'],
  reading: (f) => [
    t('task.read', { f }), t('task.searchTodo'), t('task.readDocs'), t('task.grep'), t('task.readme'),
  ],
  waiting: () => [
    t('task.permitRm'), t('task.askDb'), t('task.permitPush'), t('task.needKey'), t('task.permitInstall'),
  ],
  error: () => [t('task.errType'), t('task.err429'), t('task.errTests'), t('task.errTimeout'), t('task.errSyntax')],
  };
}
let TASKS = buildTasks();

function buildIdleTasks() {
  return {
  coffee: t('idle.coffee'),
  fish: t('idle.fish'),
  nap: t('idle.nap'),
  cafe: t('idle.cafe'),
  swim: t('idle.swim'),
  float: t('idle.float'),
  sun: t('idle.sun'),
  soccer: t('idle.soccer'),
  jog: t('idle.jog'),
  hoops: t('idle.hoops'),
  yoga: t('idle.yoga'),
  };
}
let IDLE_TASK = buildIdleTasks();
const WEIGHTS = { coding: 30, running: 18, reading: 18, waiting: 9, idle: 20, error: 5 };

function nextState(cur) {
  const entries = Object.entries(WEIGHTS).filter(([k]) => k !== cur);
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return 'idle';
}

function route(from, to) {
  const Z = world.zones;
  if (from && from.zone === to.zone) return [from.out, to.out, to].filter(Boolean);
  const pts = [];
  const fa = from ? from.area : 'out';
  if (from) {
    if (from.out) pts.push(from.out);
    pts.push(...Z[from.zone].entry);
  }
  // klinik <-> kafe/kolam: jalan langsung, tidak perlu memutar lewat taman
  const direct = from && fa === 'out' && to.area === 'out' && ![from.zone, to.zone].some((z) => z === 'garden' || z === 'sports');
  if (!direct) pts.push(HUB[fa]);
  if (fa !== to.area) pts.push(...(fa === 'in' ? DOOR : [DOOR[1], DOOR[0]]));
  if (!direct) pts.push(HUB[to.area]);
  pts.push(...[...Z[to.zone].entry].reverse());
  if (to.out) pts.push(to.out);
  pts.push(to);
  return pts;
}

let now = 0;
// Tempatkan agent di zona sesuai status. task null + idle = teks santai sesuai tempatnya.
function place(agent, state, task, { teleport = false, prefer = null, tool } = {}) {
  const zoneKeys = STATES[state].zones || [STATES[state].zone];
  const freeIn = (keys) => keys.flatMap((k) => world.zones[k].spots).filter((s) => !s.by);
  let free = freeIn(zoneKeys);
  if (!free.length) free = freeIn(['garden', 'resort']); // zona penuh: tunggu di luar
  if (!free.length) return false;
  const preferred = free.filter((s) => s.action === prefer);
  const spot = pick(preferred.length ? preferred : free);
  const from = agent.spot;
  if (from) from.by = null;
  spot.by = agent.def.id;
  agent.setState(state, task ?? IDLE_TASK[spot.action] ?? stateLabel(state), spot, teleport ? [] : route(from, spot), teleport, tool);
  return true;
}
function refresh(agent) {
  renderList();
  renderStats();
  if (selected === agent) renderCard();
}
// Mode demo: status acak
function assign(agent, state, teleport = false, prefer = null) {
  const task = state === 'idle' ? null : pick(TASKS[state](pick(FILES[agent.def.project])));
  if (!place(agent, state, task, { teleport, prefer })) return;
  agent.nextChange = now + rnd(16, 28);
  pushFeed(agent);
  refresh(agent);
}

// Mode live: samakan dunia dengan daftar agent dari server
let firstSnapshot = true;
function applySnapshot(list) {
  const seen = new Set();
  for (const d of list) {
    if (!STATES[d.state]) continue;
    seen.add(d.id);
    let a = byId[d.id];
    const fresh = !a;
    if (fresh) {
      a = addAgent({ ...lookFor(d.id), id: d.id, name: d.name, source: d.source });
      a.c.root.position.set(3.4, 0, 0.6); // muncul di gerbang
    }
    Object.assign(a.def, { model: d.model, project: d.project });
    a.tokens = d.tokens;
    a.since = d.started;
    a.updated = d.updated;
    if (fresh || a.state !== d.state) {
      place(a, d.state, d.task, { tool: d.tool, teleport: fresh && firstSnapshot });
      a.nextChange = now + rnd(40, 90);
      if (!firstSnapshot) pushFeed(a);
    } else if (d.task && a.task !== d.task) {
      a.setTask(d.task, d.tool);
      pushFeed(a);
    }
  }
  for (const a of [...agents]) if (!seen.has(a.def.id)) removeAgent(a);
  firstSnapshot = false;
  refresh(selected);
}

// ---------- HUD ----------
const $ = (s) => document.querySelector(s);
const listEl = $('#agentList');
const feedEl = $('#feedList');
const statsEl = $('#stats');
const card = $('#card');
let selected = null;
let targetZoom = null;

const hhmm = (d = new Date()) => d.toTimeString().slice(0, 5);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const srcBadge = (s) => `<span class="src-badge ${SOURCES[s] ? s : 'other'}">${SOURCES[s]?.label || esc(s)}</span>`;
const pill = (st) => `<span class="pill" style="--c:${STATES[st].color}">${STATES[st].icon} ${esc(stateLabel(st))}</span>`;

function renderList() {
  if (!agents.length) {
    listEl.innerHTML = `<li class="empty">${t('panel.empty')}<br>${t('panel.emptyHint')}</li>`;
    return;
  }
  listEl.innerHTML = agents
    .map(
      (a) => `<li class="row ${a === selected ? 'sel' : ''} ${a.state === 'waiting' ? 'pulse' : ''}" data-id="${a.def.id}">
      <span class="av" style="--c:${a.def.color}">${esc(a.def.name[0])}</span>
      <div class="meta"><div class="top"><b>${esc(a.def.name)}</b>${srcBadge(a.def.source)}</div>
      <div class="task">${esc(a.task)}</div></div>${pill(a.state)}</li>`
    )
    .join('');
}
listEl.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (row) select(byId[row.dataset.id]);
});

function renderStats() {
  const count = Object.fromEntries(Object.keys(STATES).map((k) => [k, 0]));
  for (const a of agents) count[a.state]++;
  statsEl.innerHTML = Object.entries(STATES)
    .map(([k, s]) => `<span class="chip ${k === 'waiting' && count[k] ? 'pulse' : ''}" title="${esc(stateLabel(k))}" style="--c:${s.color}">${s.icon} <b>${count[k]}</b></span>`)
    .join('');
  $('#count').textContent = agents.length;
}

function pushFeed(a) {
  const li = document.createElement('li');
  li.innerHTML = `<time>${hhmm()}</time><i style="background:${STATES[a.state].color}"></i><b>${esc(a.def.name)}</b> <span>${esc(a.task)}</span>`;
  feedEl.prepend(li);
  while (feedEl.children.length > 7) feedEl.lastChild.remove();
}

function langTag() {
  return lang() === 'id' ? 'id-ID' : 'en-US';
}
function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? t('dur.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('dur.m', { m });
}
function renderCard() {
  if (!selected) return card.classList.add('hidden');
  const a = selected;
  card.classList.remove('hidden');
  card.querySelector('.body').innerHTML = `
    <div class="card-head"><span class="av big" style="--c:${a.def.color}">${esc(a.def.name[0])}</span>
      <div><h3>${esc(a.def.name)}</h3>${srcBadge(a.def.source)}</div></div>
    <div class="state-line">${pill(a.state)}${a.walking ? `<span class="walking">🚶 ${esc(t("card.walking"))}</span>` : ''}</div>
    <dl>
      <dt>${esc(t("card.task"))}</dt><dd>${esc(a.task)}</dd>
      <dt>${esc(t("card.tool"))}</dt><dd><code>${esc(a.tool)}</code></dd>
      <dt>${esc(t("card.model"))}</dt><dd>${esc(a.def.model)}</dd>
      <dt>${esc(t("card.project"))}</dt><dd>${esc(a.def.project)}</dd>
      <dt>${esc(t("card.tokens"))}</dt><dd>${a.tokens ? a.tokens.toLocaleString(langTag()) : '—'}</dd>
      <dt>${esc(t("card.active"))}</dt><dd>${fmtDur(Date.now() - a.since)}</dd>
    </dl>
    <div class="actions"><button disabled>💬 ${esc(t("card.send"))}</button><button disabled>📜 ${esc(t("card.log"))}</button></div>
    <p class="hint">${live ? t('card.hint') : t('app.demoSub')}</p>`;
}
card.querySelector('.x').addEventListener('click', () => select(null));

function select(a) {
  selected = a;
  for (const x of agents) x.setSelected(x === a);
  targetZoom = a ? 2.1 : 1;
  if (!a) followHome = true;
  renderList();
  renderCard();
}
addEventListener('keydown', (e) => e.key === 'Escape' && select(null));

// Klik & hover di scene
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let downAt = null;
let hovered = null;
function pickAgent(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  for (const h of ray.intersectObjects(agents.map((a) => a.c.root), true)) {
    let o = h.object;
    while (o && !o.userData.agentId) o = o.parent;
    if (o) return byId[o.userData.agentId];
  }
  return null;
}
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6) select(pickAgent(e));
  downAt = null;
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  const a = pickAgent(e);
  if (a !== hovered) {
    hovered?.setHover(false);
    a?.setHover(true);
    hovered = a;
    renderer.domElement.style.cursor = a ? 'pointer' : '';
  }
});

// Mode waktu
const MODE_HOURS = [null, 13, 17.3, 22];
const MODE_KEYS = ['auto', 'day', 'dusk', 'night'];
function modeLabel(i) {
  const key = MODE_KEYS[i];
  return t('hud.clock' + key.charAt(0).toUpperCase() + key.slice(1));
}
let mode = 0;
const timeBtn = $('#timeBtn');
timeBtn.addEventListener('click', () => {
  mode = (mode + 1) % MODE_KEYS.length;
  timeBtn.textContent = '🕑 ' + modeLabel(mode);
  tickClock();
});

// ---------- Jendela waktu (berapa lama agent tetap ditampilkan) ----------
const WINDOW_OPTION_LABELS = {
  id: { 60: '1 jam', 360: '6 jam', 1440: '24 jam', 4320: '3 hari', 10080: '7 hari', 43200: '30 hari' },
  en: { 60: '1 hour', 360: '6 hours', 1440: '24 hours', 4320: '3 days', 10080: '7 days', 43200: '30 days' },
};
function updateWindowOptions() {
  if (!windowSelect) return;
  const labels = WINDOW_OPTION_LABELS[lang()] || WINDOW_OPTION_LABELS.id;
  for (const opt of windowSelect.options) {
    const v = +opt.value;
    if (labels[v]) opt.textContent = labels[v];
    else if (!opt.dataset.custom) opt.textContent = t('window.minutes', { n: v });
  }
}
const windowSelect = $('#windowSelect');
const windowBox = windowSelect?.closest('.winbox');
const WINDOW_LS_KEY = 'agent-hq-window-min';
async function applyWindowMin(min, { persist = true } = {}) {
  if (!windowSelect) return;
  min = String(min);
  // kalau nilainya tidak ada di daftar, tambahkan option
  if (![...windowSelect.options].some((o) => o.value === min)) {
    const opt = document.createElement('option');
    opt.value = min; opt.textContent = t('window.minutes', { n: min }); opt.dataset.custom = '1';
    windowSelect.appendChild(opt);
  }
  windowSelect.value = min;
  if (windowBox) windowBox.classList.add('busy');
  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ windowMin: +min }),
    });
    if (r.ok) {
      const j = await r.json();
      windowSelect.value = String(j.windowMin);
      if (persist) localStorage.setItem(WINDOW_LS_KEY, String(j.windowMin));
    }
  } catch {}
  if (windowBox) windowBox.classList.remove('busy');
}
windowSelect?.addEventListener('change', () => applyWindowMin(windowSelect.value));
// Pulihkan preferensi tersimpan (atau nilai dari server) saat halaman dibuka.
(async () => {
  const saved = localStorage.getItem(WINDOW_LS_KEY);
  try {
    const r = await fetch('/api/settings');
    const j = r.ok ? await r.json() : null;
    const initial = saved || (j && j.windowMin);
    if (initial) await applyWindowMin(initial, { persist: !!saved });
  } catch {}
})();
function tickClock() {
  const d = new Date();
  $('#clock').textContent = hhmm(d);
  applyTime(MODE_HOURS[mode] ?? d.getHours() + d.getMinutes() / 60);
}
setInterval(() => {
  tickClock();
  if (!live) for (const a of agents) if (!['idle', 'error'].includes(a.state)) a.tokens += Math.floor(rnd(40, 400));
  if (selected) renderCard();
}, 1000);
tickClock();

// ---------- Bahasa (ID / EN) ----------
const langBtn = $('#langBtn');
function renderLangBtn() {
  if (!langBtn) return;
  const isId = lang() === 'id';
  langBtn.textContent = isId ? '\u{1F1EE}\u{1F1E9} ID' : '\u{1F1EC}\u{1F1E7} EN';
  langBtn.title = isId ? 'Ganti ke English' : 'Switch to Bahasa Indonesia';
}
langBtn?.addEventListener('click', () => setLang(lang() === 'id' ? 'en' : 'id'));
onLangChange(() => {
  TASKS = buildTasks();
  IDLE_TASK = buildIdleTasks();
  applyStatic();
  updateWindowOptions();
  renderLangBtn();
  timeBtn.textContent = '\u{1F551} ' + modeLabel(mode);
  renderList();
  renderStats();
  if (selected) renderCard();
});
renderLangBtn();
applyStatic();
updateWindowOptions();

// Panel agent (laci) & layar penuh
const panelBtn = $('#panelBtn');
function setPanel(open) {
  panelOpen = open;
  document.body.classList.toggle('panel-open', open);
  resize();
}
panelBtn.addEventListener('click', () => setPanel(!panelOpen));
$('#fsBtn').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()));
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'a') setPanel(!panelOpen);
  if (e.key === 'h') document.body.classList.toggle('hud-off');
});

// Sumber data: server live kalau ada, kalau tidak (atau ?demo) pakai simulator
const modeEl = $('#mode');
function startDemo() {
  modeEl.textContent = t('app.demo');
  AGENTS.forEach(addAgent);
  [
    ['coding'], ['running'], ['idle', 'swim'], ['waiting'], ['idle', 'cafe'], ['idle', 'float'],
  ].forEach(([s, prefer], i) => assign(agents[i], s, true, prefer));
  agents.forEach((a, i) => (a.nextChange = 4 + i * 2.5));
}
// Semua Editor: read-only view of every local editor session (or the demo when no server).
let editorsES = null;
let editorsWanted = false;
async function connectEditors() {
  editorsWanted = true;
  try {
    if (new URLSearchParams(location.search).has('demo')) throw 0;
    const r = await fetch('/api/agents');
    if (!r.ok) throw 0;
    const list = await r.json();
    if (!editorsWanted) return; // switched to Project mode while loading
    live = true;
    applySnapshot(list);
    modeEl.innerHTML = '<i class="live"></i>' + t('app.live');
    editorsES = new EventSource('/api/stream');
    editorsES.onmessage = (e) => {
      modeEl.innerHTML = '<i class="live"></i>' + t('app.live');
      applySnapshot(JSON.parse(e.data));
    };
    editorsES.onerror = () => (modeEl.textContent = t('app.disconnected'));
  } catch {
    if (editorsWanted) startDemo();
  }
}
function disconnectEditors() {
  editorsWanted = false;
  editorsES?.close();
  editorsES = null;
}
// Remove every character; the next snapshot places agents directly without walking from the gate.
function resetWorld() {
  for (const a of [...agents]) removeAgent(a);
  feedEl.innerHTML = '';
  firstSnapshot = true;
}
initProjectMode({
  applySnapshot: (list) => {
    live = true;
    applySnapshot(list);
  },
  resetWorld,
  connectEditors: () => connectEditors(),
  disconnectEditors,
  setPanel,
  resize,
  setModeText: (html) => (modeEl.innerHTML = html),
});
await connectEditors();

// ---------- Loop ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
let followHome = false;
// Walking characters step aside instead of passing through each other.
// Seated or working characters keep their reserved spot; only walkers move.
const PERSONAL = 0.9;
function separate(dt) {
  for (const a of agents) {
    if (!a.walking) continue;
    const p = a.c.root.position;
    const head = a.c.root.rotation.y;
    for (const b of agents) {
      if (b === a) continue;
      const q = b.c.root.position;
      let dx = p.x - q.x;
      let dz = p.z - q.z;
      const d = Math.hypot(dx, dz);
      if (d >= PERSONAL) continue;
      if (d < 1e-3) {
        dx = Math.cos(head);
        dz = -Math.sin(head);
      } else {
        dx /= d;
        dz /= d;
      }
      // Push apart, plus a small step to the walker's right so two walkers pass instead of stalling.
      const push = (PERSONAL - Math.max(d, 1e-3)) * Math.min(1, dt * 8);
      p.x += dx * push + Math.cos(head) * push * 0.5;
      p.z += dz * push - Math.sin(head) * push * 0.5;
    }
  }
}

// Labels that would cover each other on screen are stacked upward with a thin leader line.
const labelPos = new THREE.Vector3();
function declutterLabels() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const items = [];
  for (const a of agents) {
    if (a.el.style.display === 'none') continue;
    a.label.getWorldPosition(labelPos).project(camera);
    if (labelPos.z > 1) continue;
    items.push({ a, x: ((labelPos.x + 1) / 2) * w, y: ((1 - labelPos.y) / 2) * h, wd: a.inner.offsetWidth, ht: a.inner.offsetHeight });
  }
  // Nearest to the camera (lowest on screen) keeps its place; the rest take the closest free slot,
  // trying a little above first, then to the sides.
  items.sort((p, q) => q.y - p.y);
  const placed = [];
  const GAP = 4;
  const hits = (x, top, bottom, wd) => placed.some((o) => Math.abs(o.x - x) < (o.wd + wd) / 2 + GAP && top < o.bottom + GAP && bottom > o.top - GAP);
  for (const it of items) {
    const step = it.ht + GAP;
    const side = it.wd / 2 + GAP;
    let best = { dx: 0, dy: 0 };
    let found = false;
    const cands = [];
    for (let lv = 0; lv <= 6; lv++) for (const sx of [0, -1, 1, -2, 2]) cands.push({ dx: sx * side, dy: lv * step, cost: lv * step + Math.abs(sx) * side * 0.9 });
    // Keeping the current slot is cheaper, so labels do not flip back and forth as characters move.
    const prev = it.a.offTarget;
    for (const c of cands) if (Math.abs(c.dx - prev.x) < 1 && Math.abs(c.dy - prev.y) < 1) c.cost -= step * 0.6;
    cands.sort((p, q) => p.cost - q.cost);
    for (const c of cands) {
      const bottom = it.y - c.dy;
      if (!hits(it.x + c.dx, bottom - it.ht, bottom, it.wd)) {
        best = c;
        found = true;
        break;
      }
    }
    if (!found) best = { dx: 0, dy: 0 };
    const bottom = it.y - best.dy;
    placed.push({ x: it.x + best.dx, wd: it.wd, top: bottom - it.ht, bottom });
    it.a.setLabelOffset(best.dx, best.dy);
  }
}

let lastDraw = 0;
function frame(ts = 0) {
  requestAnimationFrame(frame);
  // Draw at most 15 (light) or 30 fps; a hidden tab draws nothing.
  if (document.hidden || ts - lastDraw < 1000 / (lite ? 15 : 30) - 1) return;
  lastDraw = ts;
  const dt = Math.min(clock.getDelta(), 0.1);
  now = clock.elapsedTime;
  for (const a of agents) {
    if (now >= a.nextChange) {
      if (!live) assign(a, nextState(a.state));
      else {
        // agent santai pindah tempat sesekali supaya dunia tetap hidup
        if (a.state === 'idle' && !a.walking && a !== selected) place(a, 'idle', null);
        a.nextChange = now + rnd(40, 90);
      }
    }
    const was = a.walking;
    a.update(now, dt);
    if (was && !a.walking && a === selected) renderCard();
  }
  separate(dt);
  world.tick(now, dt);

  if (selected || followHome) {
    if (selected) tmp.set(selected.c.root.position.x, 0.8, selected.c.root.position.z);
    else tmp.copy(HOME);
    const d = tmp.sub(controls.target).multiplyScalar(Math.min(1, dt * 3));
    controls.target.add(d);
    camera.position.add(d);
    if (!selected && controls.target.distanceTo(HOME) < 0.05) followHome = false;
  }
  if (targetZoom) {
    camera.zoom += (targetZoom - camera.zoom) * Math.min(1, dt * 3);
    if (Math.abs(camera.zoom - targetZoom) < 0.01) targetZoom = null;
  }
  controls.update();
  applyFrustum();
  renderer.render(scene, camera);
  labels.render(scene, camera);
  declutterLabels();
}
function applyLite() {
  renderer.setPixelRatio(lite ? 1 : Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = !lite;
  sun.castShadow = !lite;
  scene.traverse((o) => o.material && (o.material.needsUpdate = true));
  resize();
  const b = document.getElementById('liteBtn');
  if (b) {
    b.classList.toggle('on', lite);
    b.title = t(lite ? 'hud.liteOn' : 'hud.liteOff');
  }
}
document.getElementById('liteBtn')?.addEventListener('click', () => {
  lite = !lite;
  try {
    localStorage.setItem('agent-hq-lite', lite ? '1' : '0');
  } catch {}
  applyLite();
});
applyLite();
controls.addEventListener('start', () => (targetZoom = null));
frame();
