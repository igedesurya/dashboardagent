// Karakter chibi low-poly + animasi + label nama.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { add, mat } from './world.js';

export const STATES = {
  coding:  { label: 'Ngoding',       icon: '💻', color: '#4f8cff', zone: 'desk',    tools: ['edit', 'write', 'patch'] },
  thinking: { label: 'Berpikir',     icon: '💭', color: '#14b8c4', zone: 'desk',    tools: ['—'] },
  running: { label: 'Menjalankan',   icon: '⚙️', color: '#9b6bff', zone: 'server',  tools: ['bash'] },
  reading: { label: 'Membaca',       icon: '📖', color: '#1fa774', zone: 'library', tools: ['read', 'grep', 'glob', 'webfetch'] },
  waiting: { label: 'Menunggu kamu', icon: '✋', color: '#f2a20c', zone: 'meeting', tools: ['permission'] },
  idle:    { label: 'Santai',        icon: '☕', color: '#8a8f98', zone: 'garden',  zones: ['garden', 'resort', 'sports'], tools: ['—'] },
  error:   { label: 'Error',         icon: '🚑', color: '#e5484d', zone: 'clinic',  tools: ['bash'] },
};
const ACTION_ICON = { type: '💻', server: '⚙️', read: '📖', wait: '✋', coffee: '☕', fish: '🎣', nap: '💤', sick: '🤒', cafe: '☕', swim: '🏊', float: '🛟', sun: '😎', soccer: '⚽', jog: '🏃', hoops: '🏀', yoga: '🧘' };
const MOVING = new Set(['swim', 'float', 'soccer', 'jog']);
const WATER_Y = 0.26;

export const AGENTS = [
  { id: 'kiko', name: 'Kiko', source: 'opencode', model: 'claude-sonnet-5-5', project: 'web-shop',      color: '#ff8a5b', hair: '#5a3825', pants: '#3b4a6b', acc: 'cap',        accColor: '#2b59c3' },
  { id: 'bima', name: 'Bima', source: 'opencode', model: 'claude-opus-5-5',   project: 'api-server',    color: '#4c9f70', hair: '#1f1f28', pants: '#4a4e69', acc: 'glasses',    accColor: '#222' },
  { id: 'luna', name: 'Luna', source: 'grok',     model: 'grok-4',            project: 'telegram-bot',  color: '#8e7dff', hair: '#2b2d42', pants: '#5c4d7d', acc: 'bow',        accColor: '#ff5fa2' },
  { id: 'pipo', name: 'Pipo', source: 'grok',     model: 'grok-4-fast',       project: 'scraper',       color: '#f2c14e', hair: '#e07a5f', pants: '#355070', acc: 'antenna',    accColor: '#ff4d6d' },
  { id: 'sari', name: 'Sari', source: 'opencode', model: 'claude-haiku-5-5',  project: 'mobile-app',    color: '#ef6f9a', hair: '#6d4c41', pants: '#3d405b', acc: 'headphones', accColor: '#3a86ff' },
  { id: 'dodo', name: 'Dodo', source: 'grok',     model: 'grok-code',         project: 'data-pipeline', color: '#5bc0eb', hair: '#3e2723', pants: '#2d3142', acc: 'beanie',     accColor: '#ff9f1c' },
];

// Tampilan karakter yang konsisten untuk agent asli, diturunkan dari id-nya
const LOOK = {
  color: ['#ff8a5b', '#4c9f70', '#8e7dff', '#f2c14e', '#ef6f9a', '#5bc0eb', '#e56b6f', '#57cc99', '#f4978e', '#9d8df1', '#ffb703', '#48bfe3'],
  hair: ['#5a3825', '#1f1f28', '#2b2d42', '#e07a5f', '#6d4c41', '#3e2723', '#b08968', '#f2e9e4'],
  pants: ['#3b4a6b', '#4a4e69', '#5c4d7d', '#355070', '#3d405b', '#2d3142'],
  acc: ['cap', 'glasses', 'bow', 'antenna', 'headphones', 'beanie'],
  accColor: ['#2b59c3', '#222222', '#ff5fa2', '#ff4d6d', '#3a86ff', '#ff9f1c', '#2a9d8f'],
};
export function lookFor(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h >>>= 0;
  const out = {};
  for (const [k, arr] of Object.entries(LOOK)) {
    out[k] = arr[h % arr.length];
    h = Math.floor(h / arr.length) + 7;
  }
  return out;
}
export const SOURCES = {
  claude: { label: 'Claude', short: 'C' },
  cursor: { label: 'Cursor', short: 'Cu' },
  opencode: { label: 'opencode', short: 'oc' },
  gemini: { label: 'Gemini', short: 'Ge' },
  grok: { label: 'Grok bot', short: 'G' },
};

const S = 0.85; // skala karakter
const HIP = 0.55 * S;

function makeCharacter(def) {
  const root = new THREE.Group();
  root.userData.agentId = def.id;
  const pose = new THREE.Group();
  pose.scale.setScalar(S);
  root.add(pose);
  const body = new THREE.Group();
  pose.add(body);

  const cMain = mat(def.color);
  const cSkin = mat('#ffd9b8');
  const cDark = mat('#2a2a35');
  const cPants = mat(def.pants);
  const cAcc = mat(def.accColor);

  const legs = [-0.17, 0.17].map((x) => {
    const l = new THREE.Group();
    l.position.set(x, 0.55, 0);
    body.add(l);
    add(l, new THREE.CylinderGeometry(0.12, 0.11, 0.45, 6), cPants, 0, -0.25, 0);
    add(l, new THREE.BoxGeometry(0.2, 0.12, 0.3), cDark, 0, -0.5, 0.05);
    return l;
  });
  add(body, new THREE.CylinderGeometry(0.3, 0.38, 0.62, 8), cMain, 0, 0.84, 0);
  const arms = [-1, 1].map((s) => {
    const a = new THREE.Group();
    a.position.set(0.4 * s, 1.08, 0);
    body.add(a);
    add(a, new THREE.CylinderGeometry(0.09, 0.08, 0.42, 6), cMain, 0, -0.2, 0);
    add(a, new THREE.IcosahedronGeometry(0.1, 0), cSkin, 0, -0.44, 0);
    return a;
  });

  const head = new THREE.Group();
  head.position.set(0, 1.64, 0);
  body.add(head);
  add(head, new THREE.IcosahedronGeometry(0.52, 1), cSkin);
  const eyes = [-0.17, 0.17].map((x) => add(head, new THREE.SphereGeometry(0.065, 8, 6), cDark, x, 0.02, 0.46));
  for (const x of [-0.29, 0.29]) {
    const ch = add(head, new THREE.SphereGeometry(0.075, 8, 6), mat('#ff9fae'), x, -0.12, 0.4);
    ch.scale.set(1.2, 0.6, 0.4);
  }
  add(head, new THREE.BoxGeometry(0.12, 0.03, 0.03), cDark, 0, -0.16, 0.49);
  const hair = add(head, new THREE.SphereGeometry(0.56, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.3), mat(def.hair), 0, 0.02, -0.03);
  hair.rotation.x = -0.35;

  // Aksesori
  let antennaBall = null;
  switch (def.acc) {
    case 'cap': {
      add(head, new THREE.CylinderGeometry(0.47, 0.53, 0.26, 10), cAcc, 0, 0.36, 0);
      const brim = add(head, new THREE.BoxGeometry(0.55, 0.05, 0.42), cAcc, 0, 0.27, 0.42);
      brim.rotation.x = 0.12;
      break;
    }
    case 'glasses':
      for (const x of [-0.17, 0.17]) add(head, new THREE.TorusGeometry(0.11, 0.025, 6, 12), cAcc, x, 0.02, 0.48);
      add(head, new THREE.BoxGeometry(0.12, 0.025, 0.025), cAcc, 0, 0.04, 0.5);
      break;
    case 'bow': {
      for (const s of [-1, 1]) {
        const c = add(head, new THREE.ConeGeometry(0.15, 0.3, 4), cAcc, 0.3 + s * 0.15, 0.45, 0.05);
        c.rotation.z = (s * Math.PI) / 2;
      }
      add(head, new THREE.IcosahedronGeometry(0.07, 0), cAcc, 0.3, 0.45, 0.05);
      break;
    }
    case 'antenna':
      add(head, new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5), cDark, 0, 0.7, 0);
      antennaBall = add(head, new THREE.IcosahedronGeometry(0.09, 1), mat(def.accColor, { emissive: def.accColor, emissiveIntensity: 0.8 }), 0, 0.92, 0);
      break;
    case 'headphones': {
      const band = add(head, new THREE.TorusGeometry(0.56, 0.045, 6, 16, Math.PI), cAcc, 0, 0.02, 0);
      band.rotation.y = 0;
      for (const x of [-0.55, 0.55]) {
        const cup = add(head, new THREE.CylinderGeometry(0.15, 0.15, 0.12, 10), cAcc, x, 0, 0);
        cup.rotation.z = Math.PI / 2;
      }
      break;
    }
    case 'beanie':
      add(head, new THREE.SphereGeometry(0.58, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), cAcc, 0, 0.06, 0);
      add(head, new THREE.CylinderGeometry(0.56, 0.58, 0.12, 10), mat('#ffffff'), 0, 0.12, 0);
      add(head, new THREE.IcosahedronGeometry(0.13, 1), mat('#ffffff'), 0, 0.66, 0);
      break;
  }

  // Properti
  const book = new THREE.Group();
  book.position.set(0, 0.98, 0.45);
  book.rotation.x = -0.6;
  add(book, new THREE.BoxGeometry(0.55, 0.04, 0.38), mat('#c0392b'));
  add(book, new THREE.BoxGeometry(0.5, 0.06, 0.34), mat('#fffaf0'), 0, 0.03, 0);
  body.add(book);

  const cup = new THREE.Group();
  cup.position.set(0, -0.5, 0.08);
  add(cup, new THREE.CylinderGeometry(0.09, 0.07, 0.18, 8), mat('#ffffff'));
  add(cup, new THREE.CylinderGeometry(0.08, 0.08, 0.02, 8), mat('#6f4518'), 0, 0.085, 0);
  arms[1].add(cup);

  const rod = new THREE.Group();
  rod.position.set(0, -0.44, 0);
  rod.rotation.x = 1.87;
  add(rod, new THREE.CylinderGeometry(0.022, 0.035, 2.2, 5), mat('#6b4226'), 0, 1.1, 0);
  const rodTip = new THREE.Object3D();
  rodTip.position.set(0, 2.2, 0);
  rod.add(rodTip);
  arms[1].add(rod);

  // ban renang
  const ring = new THREE.Group();
  ring.position.set(0, 0.84, 0);
  ring.rotation.x = Math.PI / 2;
  for (let i = 0; i < 8; i++) {
    const seg = add(ring, new THREE.TorusGeometry(0.5, 0.17, 6, 4, Math.PI / 4), mat(i % 2 ? '#ffffff' : '#ff4d6d'));
    seg.rotation.z = (i * Math.PI) / 4;
  }
  body.add(ring);

  // kacamata hitam
  const shades = new THREE.Group();
  for (const x of [-0.17, 0.17]) add(shades, new THREE.BoxGeometry(0.22, 0.13, 0.04), mat('#111'), x, 0.03, 0.5);
  add(shades, new THREE.BoxGeometry(0.14, 0.03, 0.03), mat('#111'), 0, 0.06, 0.51);
  head.add(shades);

  // bola basket di tangan
  const bball = new THREE.Group();
  bball.position.set(0, -0.6, 0.12);
  add(bball, new THREE.IcosahedronGeometry(0.2, 1), mat('#f77f00'));
  arms[1].add(bball);

  return { root, pose, body, legs, arms, head, eyes, antennaBall, props: { book, cup, rod, ring, shades, bball }, rodTip };
}

const lerpAngle = (a, b, t) => {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
};

export class Agent {
  constructor(def, scene) {
    this.def = def;
    this.c = makeCharacter(def);
    scene.add(this.c.root);
    this.ph = Math.random() * 10;
    this.path = [];
    this.spot = null;
    this.state = 'idle';
    this.task = '';
    this.tool = '—';
    this.tokens = Math.floor(20000 + Math.random() * 180000);
    this.since = Date.now() - Math.floor(Math.random() * 3.5 * 3600 * 1000);
    this.freshUntil = 0;

    // Label nama + gelembung
    const el = document.createElement('div');
    el.className = 'char-label';
    el.style.setProperty('--c', def.color);
    el.innerHTML = `<div class="inner"><div class="bubble"><span class="ic"></span><span class="tx"></span></div>
      <div class="tag"><i class="dot"></i><span class="nm"></span><span class="src"></span></div></div>`;
    const src = SOURCES[def.source] ? def.source : 'other';
    el.querySelector('.nm').textContent = def.name;
    el.querySelector('.src').textContent = SOURCES[src]?.short || 'bot';
    el.querySelector('.src').classList.add(src);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onClick?.(this);
    });
    this.el = el;
    this.inner = el.firstElementChild;
    // Screen-space lift that keeps this label off its neighbours (set by main.js).
    this.off = { x: 0, y: 0 };
    this.offTarget = { x: 0, y: 0 };
    this.label = new CSS2DObject(el);
    this.label.position.set(0, 2.25, 0);
    this.c.root.add(this.label);

    // Tali pancing
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 })
    );
    this.bobber = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), mat('#ff3b30'));
    this.line.visible = this.bobber.visible = false;
    scene.add(this.line, this.bobber);
    this._v = new THREE.Vector3();
  }

  _icon() {
    const st = STATES[this.state];
    const home = (st.zones || [st.zone]).includes(this.spot.zone) && this.state !== 'thinking';
    return (home && ACTION_ICON[this.spot.action]) || st.icon;
  }
  setTask(task, tool) {
    this.task = task;
    if (tool) this.tool = tool;
    this.freshUntil = performance.now() + 5000;
    this.el.querySelector('.tx').textContent = task.length > 30 ? task.slice(0, 29) + '…' : task;
  }
  dispose(scene) {
    if (this.spot) this.spot.active = false;
    this.c.root.remove(this.label);
    this.el.remove();
    scene.remove(this.c.root, this.line, this.bobber);
  }
  setState(state, task, spot, path, teleport, tool) {
    if (this.spot && this.spot !== spot) this.spot.active = false;
    this.arr = null;
    this.state = state;
    this.task = task;
    this.tool = tool || STATES[state].tools[Math.floor(Math.random() * STATES[state].tools.length)];
    this.spot = spot;
    this.freshUntil = performance.now() + 5000;
    if (teleport) {
      this.path = [];
      this.c.root.position.set(spot.x, 0, spot.z);
      this.c.root.rotation.y = spot.rot;
      spot.active = true;
    } else {
      this.path = path.map((p) => ({ x: p.x, z: p.z }));
    }
    const icon = STATES[state].icon;
    this.el.querySelector('.ic').textContent = this.path.length ? '🚶' : this._icon() || icon;
    this.el.querySelector('.tx').textContent = task.length > 30 ? task.slice(0, 29) + '…' : task;
    this.el.querySelector('.dot').style.background = STATES[state].color;
    this.el.classList.toggle('alert', state === 'waiting' || state === 'error');
  }

  // Screen-space offset that keeps this label clear of its neighbours (chosen by main.js).
  setLabelOffset(dx, dy) {
    this.offTarget.x = dx;
    this.offTarget.y = dy;
  }
  _applyOffset(dt) {
    const o = this.off;
    const g = this.offTarget;
    if (Math.abs(g.x - o.x) < 0.3 && Math.abs(g.y - o.y) < 0.3) {
      if (o.x === g.x && o.y === g.y) return;
      o.x = g.x;
      o.y = g.y;
    } else {
      const k = Math.min(1, dt * 10);
      o.x += (g.x - o.x) * k;
      o.y += (g.y - o.y) * k;
    }
    const st = this.el.style;
    st.setProperty('--dx', `${o.x.toFixed(1)}px`);
    st.setProperty('--dy', `${o.y.toFixed(1)}px`);
    // Leader line from the label back to the character.
    st.setProperty('--ll', `${Math.hypot(o.x, o.y).toFixed(1)}px`);
    st.setProperty('--la', `${Math.atan2(o.x, o.y).toFixed(3)}rad`);
    this.el.classList.toggle('lifted', Math.hypot(o.x, o.y) > 6);
  }

  setSelected(v) { this.el.classList.toggle('selected', v); }
  setHover(v) { this.el.classList.toggle('hover', v); }
  get walking() { return this.path.length > 0; }

  update(t, dt) {
    const { root, pose, body, legs, arms, head, eyes, antennaBall, props, rodTip } = this.c;
    const tt = t + this.ph;

    // reset pose
    pose.position.set(0, 0, 0);
    pose.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    body.scale.set(1, 1 + Math.sin(tt * 2.2) * 0.015, 1);
    for (const l of legs) l.rotation.set(0, 0, 0);
    for (const a of arms) a.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    for (const p of Object.values(props)) p.visible = false;
    this.line.visible = this.bobber.visible = false;
    const blink = tt % 3.7 < 0.12 ? 0.15 : 1;
    for (const e of eyes) e.scale.y = blink;
    if (antennaBall) antennaBall.position.y = 0.92 + Math.sin(tt * 4) * 0.03;
    this.el.classList.toggle('fresh', performance.now() < this.freshUntil);
    this._applyOffset(dt);

    if (this.path.length) {
      const tgt = this.path[0];
      const p = root.position;
      const dx = tgt.x - p.x;
      const dz = tgt.z - p.z;
      const dist = Math.hypot(dx, dz);
      const step = 4.2 * dt;
      if (dist > 0.01) root.rotation.y = lerpAngle(root.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 12));
      if (dist <= step) {
        p.x = tgt.x;
        p.z = tgt.z;
        this.path.shift();
        if (!this.path.length) {
          this.spot.active = true;
          this.el.querySelector('.ic').textContent = this._icon();
        }
      } else {
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
      }
      const s = Math.sin(tt * 12);
      legs[0].rotation.x = s * 0.7;
      legs[1].rotation.x = -s * 0.7;
      arms[0].rotation.x = -s * 0.6;
      arms[1].rotation.x = s * 0.6;
      body.position.y = Math.abs(s) * 0.08;
      return;
    }

    const spot = this.spot;
    if (!spot) return;
    this.arr ??= tt; // saat tiba di tempat
    const lap = tt - this.arr + (spot.lap0 || 0);
    if (!MOVING.has(spot.action)) root.rotation.y = lerpAngle(root.rotation.y, spot.rot, Math.min(1, dt * 8));
    if (spot.sit) {
      legs[0].rotation.x = legs[1].rotation.x = -Math.PI / 2;
      pose.position.y = spot.seatY - HIP;
    }
    if (spot.lie) {
      pose.rotation.x = -Math.PI / 2;
      pose.position.y = spot.lieY;
    }

    switch (spot.action) {
      case 'type': {
        arms[0].rotation.x = -1.3 + Math.sin(tt * 20) * 0.12;
        arms[1].rotation.x = -1.3 + Math.sin(tt * 20 + Math.PI) * 0.12;
        head.rotation.x = 0.12 + Math.sin(tt * 0.9) * 0.04;
        if (this.state === 'thinking') {
          // tangan di dagu, kepala miring-miring
          arms[0].rotation.x = -0.9;
          arms[1].rotation.set(-2.3, 0, -0.5);
          head.rotation.x = -0.1;
          head.rotation.z = Math.sin(tt * 1.1) * 0.18;
        }
        break;
      }
      case 'server': {
        arms[1].rotation.x = -1.55 + Math.sin(tt * 9) * 0.15;
        arms[0].rotation.x = -1.1 + Math.sin(tt * 7 + 1) * 0.1;
        head.rotation.x = -0.15;
        head.rotation.y = Math.sin(tt * 0.7) * 0.25;
        body.rotation.y = Math.sin(tt * 0.7) * 0.1;
        break;
      }
      case 'read': {
        props.book.visible = true;
        arms[0].rotation.set(-1.0, 0, 0.35);
        arms[1].rotation.set(-1.0, 0, -0.35);
        head.rotation.x = 0.28 + Math.sin(tt * 0.8) * 0.05;
        head.rotation.z = Math.sin(tt * 0.5) * 0.06;
        break;
      }
      case 'wait': {
        arms[1].rotation.x = -2.8;
        arms[1].rotation.z = Math.sin(tt * 7) * 0.35;
        head.rotation.y = Math.sin(tt * 1.3) * 0.45;
        body.position.y = Math.abs(Math.sin(tt * 3.5)) * 0.04;
        break;
      }
      case 'soccer':
      case 'jog': {
        // lari mengitari elips; mulai dari titik tiba supaya tidak melompat
        const a = (tt - this.arr) * spot.speed;
        root.position.x = spot.cx + Math.cos(a) * spot.rx;
        root.position.z = spot.cz + Math.sin(a) * spot.rz;
        const sgn = Math.sign(spot.speed);
        root.rotation.y = lerpAngle(root.rotation.y, Math.atan2(-Math.sin(a) * spot.rx * sgn, Math.cos(a) * spot.rz * sgn), Math.min(1, dt * 8));
        const s = Math.sin(tt * 13);
        legs[0].rotation.x = s * 0.9;
        legs[1].rotation.x = -s * 0.9;
        arms[0].rotation.x = -s * 0.8;
        arms[1].rotation.x = s * 0.8;
        body.position.y = Math.abs(s) * 0.1;
        body.rotation.x = 0.15;
        break;
      }
      case 'hoops': {
        props.bball.visible = true;
        const ph = (lap * 0.45) % 1;
        if (ph < 0.3) {
          // lompat dan tembak
          const j = Math.sin((ph / 0.3) * Math.PI);
          body.position.y = j * 0.55;
          arms[0].rotation.x = arms[1].rotation.x = -1.2 - 1.7 * j;
          head.rotation.x = -0.25 * j;
        } else {
          // dribel
          arms[1].rotation.x = -0.5 + Math.sin(tt * 9) * 0.35;
          body.rotation.x = 0.12;
          legs[0].rotation.x = 0.15;
          legs[1].rotation.x = -0.15;
        }
        break;
      }
      case 'yoga': {
        const b = Math.sin(lap * 0.7);
        arms[0].rotation.set(0, 0, -2.6);
        arms[1].rotation.set(0, 0, 2.6);
        body.rotation.z = b * 0.32;
        head.rotation.z = b * 0.15;
        for (const e of eyes) e.scale.y = 0.15;
        break;
      }
      case 'swim': {
        // gaya bebas bolak-balik di lintasan
        const u = Math.sin(tt * 0.35);
        root.position.x = spot.x + u * 2.4;
        root.position.z = spot.z;
        const dir = Math.cos(tt * 0.35) >= 0 ? Math.PI / 2 : -Math.PI / 2;
        root.rotation.y = lerpAngle(root.rotation.y, dir, Math.min(1, dt * 4));
        pose.rotation.x = Math.PI / 2;
        pose.position.y = WATER_Y - 0.08 + Math.sin(tt * 6) * 0.03;
        arms[0].rotation.x = -tt * 6;
        arms[1].rotation.x = -tt * 6 + Math.PI;
        legs[0].rotation.x = Math.sin(tt * 14) * 0.35;
        legs[1].rotation.x = -Math.sin(tt * 14) * 0.35;
        head.rotation.z = Math.sin(tt * 3) * 0.3;
        break;
      }
      case 'float': {
        props.ring.visible = true;
        root.rotation.y = spot.rot + Math.sin(tt * 0.3) * 1.2;
        pose.position.y = WATER_Y - 0.62 + Math.sin(tt * 1.6) * 0.04;
        arms[0].rotation.set(-0.3, 0, -1.1 + Math.sin(tt * 2) * 0.2);
        arms[1].rotation.set(-0.3, 0, 1.1 - Math.sin(tt * 2) * 0.2);
        head.rotation.x = -0.2;
        break;
      }
      case 'sun': {
        props.shades.visible = true;
        arms[0].rotation.set(-2.9, 0, 0.5);
        arms[1].rotation.set(-2.9, 0, -0.5);
        body.scale.set(1, 1, 1 + Math.sin(tt * 1.1) * 0.03);
        legs[1].rotation.x = -0.4;
        break;
      }
      case 'cafe':
      case 'coffee': {
        props.cup.visible = true;
        const ph = (tt * 0.35) % 1;
        const sip = ph < 0.3 ? Math.sin((ph / 0.3) * Math.PI) : 0;
        arms[1].rotation.x = -0.7 - 1.5 * sip;
        arms[1].rotation.z = -0.3 * sip;
        head.rotation.x = -0.25 * sip;
        body.rotation.z = Math.sin(tt * 1.2) * 0.04;
        break;
      }
      case 'fish': {
        props.rod.visible = true;
        const tug = Math.pow(Math.max(0, Math.sin(tt * 0.7)), 20);
        arms[0].rotation.set(-0.9 - 0.4 * tug, 0, 0.25);
        arms[1].rotation.set(-0.9 - 0.4 * tug, 0, -0.1);
        root.updateMatrixWorld(true);
        rodTip.getWorldPosition(this._v);
        const by = 0.07 + Math.sin(tt * 3) * 0.02 - tug * 0.08;
        this.bobber.position.set(this._v.x, by, this._v.z);
        const pos = this.line.geometry.attributes.position;
        pos.setXYZ(0, this._v.x, this._v.y, this._v.z);
        pos.setXYZ(1, this._v.x, by, this._v.z);
        pos.needsUpdate = true;
        this.line.visible = this.bobber.visible = true;
        break;
      }
      case 'nap': {
        body.scale.set(1, 1, 1 + Math.sin(tt * 1.2) * 0.04);
        arms[0].rotation.z = 0.2;
        arms[1].rotation.z = -0.2;
        for (const e of eyes) e.scale.y = 0.15;
        break;
      }
      case 'sick': {
        pose.position.x = Math.sin(tt * 38) * 0.02;
        for (const e of eyes) e.scale.y = 0.4;
        head.rotation.y = Math.sin(tt * 2) * 0.2;
        break;
      }
    }
  }
}
