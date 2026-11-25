// Dunia diorama low-poly: kantor (4 ruangan) + taman + klinik.
import * as THREE from 'three';

const cache = new Map();
export function mat(color, extra) {
  if (extra) return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });
  let m = cache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 });
    cache.set(color, m);
  }
  return m;
}
const asMat = (c) => (c && c.isMaterial ? c : mat(c));

export function add(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, asMat(material));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
// box/cyl: y = alas objek
export const box = (p, w, h, d, c, x, y, z) => add(p, new THREE.BoxGeometry(w, h, d), c, x, y + h / 2, z);
export const cyl = (p, rt, rb, h, seg, c, x, y, z) => add(p, new THREE.CylinderGeometry(rt, rb, h, seg), c, x, y + h / 2, z);
export const ball = (p, r, c, x, y, z, detail = 0) => add(p, new THREE.IcosahedronGeometry(r, detail), c, x, y, z);

// Titik jalan antar area
export const HUB = { in: { x: -8, z: 0 }, out: { x: 6, z: 0 } };
export const DOOR = [{ x: -0.8, z: 0 }, { x: 1.8, z: 0 }];

function textPlane(text, w, h, bg, fg) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * 128);
  cv.height = Math.round(h * 128);
  const x = cv.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = fg;
  x.font = `700 ${Math.floor(cv.height * 0.58)}px Fredoka, system-ui, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, cv.width / 2, cv.height / 2 + 4);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t }));
}

function codeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#18202e';
  x.fillRect(0, 0, 128, 256);
  const cols = ['#7ee787', '#79c0ff', '#ff7b72', '#d2a8ff', '#ffa657', '#e6edf3'];
  for (let y = 6; y < 256; y += 11) {
    let px = 6 + Math.floor(Math.random() * 3) * 10;
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n && px < 115; i++) {
      const w = 8 + Math.random() * 30;
      x.fillStyle = cols[Math.floor(Math.random() * cols.length)];
      x.fillRect(px, y, w, 5);
      px += w + 5;
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 0.5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(scene) {
  const g = new THREE.Group();
  scene.add(g);

  const zones = {
    desk:    { label: 'zoneName.desk',  icon: '💻', area: 'in',  entry: [{ x: -13.5, z: -1 }], spots: [], labelPos: [-13.5, -9.3] },
    meeting: { label: 'zoneName.meeting', icon: '✋', area: 'in',  entry: [{ x: -7.2, z: -7.8 }, { x: -7.2, z: -2 }], spots: [], labelPos: [-4.5, -3.2] },
    server:  { label: 'zoneName.server',  icon: '⚙️', area: 'in',  entry: [], spots: [], labelPos: [-13.5, 1.2] },
    library: { label: 'zoneName.library', icon: '📖', area: 'in',  entry: [{ x: -1.2, z: 8.6 }, { x: -1.2, z: 1 }], spots: [], labelPos: [-4.5, 1.3] },
    garden:  { label: 'zoneName.garden',  icon: '🌳', area: 'out', entry: [], spots: [], labelPos: [10, 11] },
    clinic:  { label: 'zoneName.clinic',  icon: '🚑', area: 'out', entry: [], spots: [], labelPos: [18.3, -8.6] },
    resort:  { label: 'zoneName.resort',  icon: '🏖️', area: 'out', entry: [{ x: 23.5, z: 0 }], spots: [],
               labels: [['spot.cafe', 29.5, -3.9], ['spot.pool', 29.5, 11.6]] },
    sports:  { label: 'zoneName.sports',  icon: '⚽', area: 'out', entry: [{ x: 5.5, z: 16.2 }, { x: 5.5, z: 12 }], spots: [],
               labels: [['spot.soccer', 13.5, 31.6], ['spot.basket', 28, 25.6], ['spot.yoga', 28, 30.6]] },
  };
  const spot = (zone, s) => {
    Object.assign(s, { zone, area: zones[zone].area, by: null, active: false });
    zones[zone].spots.push(s);
    return s;
  };

  const leds = [];
  const lamps = [];
  const clouds = [];

  // ---------- Pulau ----------
  // Daratan luas tanpa tepi: memenuhi layar ke segala arah
  const land = box(g, 900, 1, 900, '#7cc35f', 7.75, -1, 0);
  land.castShadow = false;

  // ---------- Gedung ----------
  box(g, 18, 0.04, 20, '#ecd3a8', -9, 0, 0);
  box(g, 8, 0.02, 8.2, '#d7e3f4', -13.5, 0.04, -5.4); // ruang kerja
  box(g, 7.6, 0.02, 7.2, '#f6d6c8', -4.6, 0.04, -5.8); // rapat
  box(g, 8.4, 0.02, 9.2, '#5b6272', -13.5, 0.04, 5.2); // server
  box(g, 7.8, 0.02, 7, '#d9b48c', -4.6, 0.04, 5.9); // perpustakaan

  const wall = (x, z, w, d, h) => {
    box(g, w, h, d, '#f4e8d6', x, 0, z);
    box(g, w + 0.06, 0.08, d + 0.06, '#b89a76', x, h, z);
  };
  wall(-9, -10, 18.3, 0.3, 1.4); // utara
  wall(-18, 0, 0.3, 20, 1.4); // barat
  wall(-9, 10, 18.3, 0.3, 0.45); // selatan (rendah, sisi kamera)
  wall(0, -5.75, 0.3, 8.5, 0.45); // timur + pintu
  wall(0, 5.75, 0.3, 8.5, 0.45);
  wall(-9, -6.25, 0.25, 7.5, 1.0); // sekat
  wall(-9, 6.25, 0.25, 7.5, 1.0);
  wall(-16, 0, 4, 0.25, 1.0);

  const plant = (x, z, s = 1) => {
    cyl(g, 0.28 * s, 0.22 * s, 0.45 * s, 8, '#c8693a', x, 0, z);
    ball(g, 0.45 * s, '#4fa553', x, 0.75 * s, z, 0);
    ball(g, 0.32 * s, '#67c06b', x + 0.15 * s, 1.05 * s, z + 0.1 * s, 0);
  };

  // --- Ruang kerja ---
  const codeTex = codeTexture();
  const screenOn = new THREE.MeshBasicMaterial({ map: codeTex });
  const screenOff = new THREE.MeshBasicMaterial({ color: '#22262f' });
  for (const [x, z] of [[-15.5, -7.6], [-11.5, -7.6], [-15.5, -3.6], [-11.5, -3.6]]) {
    box(g, 2.4, 0.12, 1.1, '#c8955c', x, 0.85, z);
    for (const sx of [-1.1, 1.1]) for (const sz of [-0.45, 0.45]) box(g, 0.1, 0.85, 0.1, '#8a5a35', x + sx, 0, z + sz);
    box(g, 0.12, 0.25, 0.12, '#2d2f3a', x, 0.97, z - 0.3);
    box(g, 1.05, 0.62, 0.07, '#2d2f3a', x, 1.2, z - 0.3);
    const screen = add(g, new THREE.PlaneGeometry(0.92, 0.5), screenOff, x, 1.51, z - 0.26);
    screen.castShadow = false;
    box(g, 0.8, 0.04, 0.26, '#eceff4', x, 0.97, z + 0.15);
    cyl(g, 0.08, 0.07, 0.16, 8, '#ef8354', x + 0.85, 0.97, z + 0.1);
    box(g, 0.35, 0.02, 0.45, '#ffffff', x - 0.8, 0.97, z + 0.05);
    // kursi
    cyl(g, 0.05, 0.05, 0.42, 6, '#555b66', x, 0, z + 1.05);
    box(g, 0.7, 0.08, 0.7, '#3d5a80', x, 0.42, z + 1.05);
    box(g, 0.7, 0.65, 0.08, '#3d5a80', x, 0.5, z + 1.42);
    spot('desk', { x, z: z + 1.0, rot: Math.PI, action: 'type', sit: true, seatY: 0.5, out: { x: -13.5, z: z + 1.0 }, screen, screenOn, screenOff });
  }
  plant(-17.2, -9.2);
  plant(-9.8, -9.2, 0.8);

  // --- Ruang rapat ---
  box(g, 4, 0.1, 1.4, '#d9a066', -4.5, 0.78, -5);
  for (const sx of [-1.8, 1.8]) box(g, 0.12, 0.78, 0.12, '#8a5a35', -4.5 + sx, 0, -5);
  box(g, 0.55, 0.03, 0.4, '#3a3f4b', -4.5, 0.88, -5.1); // laptop
  box(g, 0.25, 0.01, 0.25, '#ffd166', -5.6, 0.88, -4.9);
  box(g, 0.25, 0.01, 0.25, '#8ecae6', -3.4, 0.88, -5.2);
  box(g, 3.4, 1.6, 0.08, '#fafafa', -4.5, 0.55, -9.78);
  box(g, 3.5, 0.08, 0.12, '#9aa5b1', -4.5, 0.55, -9.74);
  for (let i = 0; i < 5; i++) box(g, 0.4 + Math.random() * 1.2, 0.07, 0.02, ['#e63946', '#457b9d', '#2a9d8f'][i % 3], -5.3 + Math.random() * 1.2, 0.9 + i * 0.22, -9.72);
  for (const x of [-5.8, -4.5, -3.2]) {
    box(g, 0.7, 0.08, 0.7, '#e07a5f', x, 0.42, -6.6);
    box(g, 0.7, 0.65, 0.08, '#e07a5f', x, 0.5, -6.97);
    cyl(g, 0.05, 0.05, 0.42, 6, '#555b66', x, 0, -6.6);
    spot('meeting', { x, z: -6.55, rot: 0, action: 'wait', sit: true, seatY: 0.5, out: { x, z: -7.8 } });
  }
  plant(-1, -9.2, 0.9);

  // --- Ruang server ---
  for (const z of [2.4, 4.4, 6.4, 8.4]) {
    box(g, 1.1, 2.4, 1.5, '#2f3440', -17.15, 0, z);
    for (let r = 0; r < 7; r++) {
      box(g, 0.02, 0.04, 1.3, '#1e222b', -16.59, 0.25 + r * 0.3, z);
      for (let c = 0; c < 2; c++) {
        const col = ['#39ff88', '#4fc3ff', '#ffb347'][Math.floor(Math.random() * 3)];
        const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.5 });
        const led = add(g, new THREE.BoxGeometry(0.04, 0.07, 0.12), m, -16.57, 0.4 + r * 0.3, z - 0.35 + c * 0.7);
        led.castShadow = false;
        leds.push(m);
      }
    }
    spot('server', { x: -15.5, z, rot: -Math.PI / 2, action: 'server' });
  }
  box(g, 1.6, 1.3, 0.9, '#cfd6e0', -11, 0, 9.2); // pendingin
  for (let i = 0; i < 3; i++) box(g, 1.3, 0.06, 0.02, '#8a94a6', -11, 0.35 + i * 0.3, 8.74);
  // kabel di lantai
  box(g, 5, 0.03, 0.1, '#e9c46a', -14, 0.04, 9.5);

  // --- Perpustakaan ---
  for (const sx of [-7, -3.6]) {
    box(g, 2.8, 2.2, 0.6, '#5c3a1e', sx, 0, 2.6);
    for (let row = 0; row < 4; row++) {
      box(g, 2.8, 0.06, 0.62, '#8b5a2b', sx, row * 0.52 + 0.06, 2.62);
      let bx = sx - 1.3;
      while (bx < sx + 1.2) {
        const w = 0.14 + Math.random() * 0.12;
        const h = 0.3 + Math.random() * 0.14;
        box(g, w, h, 0.3, ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#e9c46a', '#8338ec', '#fb6f92'][Math.floor(Math.random() * 7)], bx + w / 2, row * 0.52 + 0.12, 2.82);
        bx += w + 0.03;
      }
    }
  }
  const armColors = ['#6d597a', '#b56576', '#355070'];
  [-7, -4.8, -2.6].forEach((x, i) => {
    const c = armColors[i];
    box(g, 1.0, 0.45, 0.9, c, x, 0, 7.05);
    box(g, 1.0, 1.0, 0.25, c, x, 0, 6.5);
    for (const s of [-0.5, 0.5]) box(g, 0.2, 0.65, 0.9, c, x + s, 0, 7.05);
    spot('library', { x, z: 7.1, rot: 0, action: 'read', sit: true, seatY: 0.45, out: { x, z: 8.6 } });
  });
  cyl(g, 0.04, 0.04, 1.8, 6, '#444', -8.3, 0, 8.2);
  cyl(g, 0.2, 0.32, 0.35, 8, '#ffe8a3', -8.3, 1.7, 8.2);
  plant(-0.9, 9.2, 0.9);

  // ---------- Luar ----------
  box(g, 1.2, 0.02, 2.2, '#c0504d', 0.9, 0, 0); // keset
  for (let i = 0; i < 5; i++) cyl(g, 0.45, 0.45, 0.04, 7, '#d9d4c7', 2.4 + i * 1.1, 0, (i % 2) * 0.3 - 0.15);
  // papan nama
  box(g, 0.12, 1.4, 0.12, '#8b5a2b', 2.4, 0, -2.4);
  box(g, 0.12, 1.4, 0.12, '#8b5a2b', 4.2, 0, -2.4);
  box(g, 2.2, 0.75, 0.1, '#8b5a2b', 3.3, 1.1, -2.42);
  const sign = textPlane('AGENT HQ', 2, 0.6, '#fff4dc', '#5a3a1e');
  sign.position.set(3.3, 1.475, -2.36);
  g.add(sign);

  // Kedai kopi
  box(g, 4, 1.1, 1.3, '#e07a5f', 7.5, 0, -9.6);
  box(g, 4.2, 0.1, 1.5, '#f4f1de', 7.5, 1.1, -9.6);
  box(g, 4, 2.4, 0.3, '#3d405b', 7.5, 0, -10.6);
  for (let i = 0; i < 6; i++) {
    const s = box(g, 0.68, 0.08, 1.9, i % 2 ? '#ffffff' : '#e63946', 5.83 + i * 0.67, 2.35, -9.8);
    s.rotation.x = 0.28;
  }
  box(g, 0.6, 0.6, 0.5, '#adb5bd', 6.3, 1.2, -9.8);
  for (let i = 0; i < 3; i++) cyl(g, 0.08, 0.07, 0.16, 8, '#ffffff', 8.2 + i * 0.3, 1.2, -9.4);
  const kopi = textPlane('KOPI', 1.6, 0.5, '#3d405b', '#ffd166');
  kopi.position.set(7.5, 2.1, -10.44);
  g.add(kopi);
  cyl(g, 0.06, 0.08, 1.0, 6, '#555b66', 7.5, 0, -7.7);
  cyl(g, 0.45, 0.45, 0.06, 10, '#f4f1de', 7.5, 1.0, -7.7);
  spot('garden', { x: 6.1, z: -7.4, rot: 0.6, action: 'coffee' });
  spot('garden', { x: 8.9, z: -7.4, rot: -0.6, action: 'coffee' });
  spot('garden', { x: 7.5, z: -6.6, rot: 0, action: 'coffee' });

  // Kolam pancing
  const waterMat = new THREE.MeshStandardMaterial({ color: '#4cb6e8', roughness: 0.25, metalness: 0.1, flatShading: true });
  const water = cyl(g, 3, 3, 0.1, 14, waterMat, 14.2, -0.05, 6.2);
  water.scale.x = 1.25;
  water.castShadow = false;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = ball(g, 0.3 + Math.random() * 0.12, '#a8a29e', 14.2 + Math.cos(a) * 3.85, 0.05, 6.2 + Math.sin(a) * 3.1, 0);
    r.scale.y = 0.6;
  }
  for (const [x, z] of [[15.2, 5.4], [16.4, 7.2], [13.4, 7.6]]) {
    const p = cyl(g, 0.35, 0.35, 0.03, 7, '#5fa84f', x, 0.05, z);
    p.castShadow = false;
  }
  ball(g, 0.12, '#ff6b9d', 15.3, 0.15, 5.4);
  for (const [x, z, rot] of [[9.6, 5.2, Math.PI / 2], [9.6, 7.4, Math.PI / 2], [13, 2.3, 0.31]]) {
    cyl(g, 0.25, 0.22, 0.4, 8, '#a0522d', x, 0, z);
    spot('garden', { x, z, rot, action: 'fish', sit: true, seatY: 0.4 });
  }

  // Bangku taman
  const bench = (bx, bz) => {
    box(g, 2.6, 0.1, 0.8, '#c2773a', bx, 0.45, bz);
    box(g, 2.6, 0.55, 0.1, '#8b4513', bx, 0.55, bz - 0.38);
    for (const s of [-1.1, 1.1]) box(g, 0.12, 0.45, 0.7, '#5c3a1e', bx + s, 0, bz);
    spot('garden', { x: bx + 0.6, z: bz, rot: Math.PI / 2, action: 'nap', lie: true, lieY: 0.85 });
  };
  bench(15, -1.6);
  bench(19.5, 1.8);

  // Klinik
  box(g, 5, 2.2, 3, '#fdfdfd', 18.5, 0, -11);
  box(g, 5.4, 0.3, 3.4, '#e76f51', 18.5, 2.2, -11);
  box(g, 0.9, 0.3, 0.05, '#e63946', 19.3, 1.3, -9.47);
  box(g, 0.3, 0.9, 0.05, '#e63946', 19.3, 1.0, -9.47);
  box(g, 0.9, 1.5, 0.05, '#8ecae6', 17.2, 0, -9.47);
  for (const bx of [16.5, 20]) {
    const bz = -6.6;
    box(g, 1.2, 0.45, 2.3, '#cfd8dc', bx, 0, bz);
    box(g, 1.1, 0.14, 2.1, '#ffffff', bx, 0.45, bz);
    box(g, 0.85, 0.12, 0.45, '#bde0fe', bx, 0.59, bz - 0.75);
    box(g, 1.12, 0.05, 1.1, '#90caf9', bx, 0.59, bz + 0.45);
    cyl(g, 0.03, 0.03, 1.8, 5, '#9aa5b1', bx + 0.8, 0, bz - 0.8);
    box(g, 0.2, 0.3, 0.08, '#e3f2fd', bx + 0.8, 1.5, bz - 0.8);
    spot('clinic', { x: bx, z: bz + 0.63, rot: 0, action: 'sick', lie: true, lieY: 0.9 });
  }

  // Lampu taman
  for (const [x, z] of [[3.4, -2.6], [3.4, 2.6], [11, -4], [19, -3.8]]) {
    cyl(g, 0.07, 0.09, 2.6, 6, '#3d405b', x, 0, z);
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffcf70', emissiveIntensity: 0 });
    const b = ball(g, 0.22, bulbMat, x, 2.75, z, 1);
    b.castShadow = false;
    const light = new THREE.PointLight('#ffcf70', 0, 9, 1.6);
    light.position.set(x, 2.7, z);
    g.add(light);
    lamps.push({ light, bulbMat });
  }
  const indoor = new THREE.PointLight('#ffd9a0', 0, 22, 1.2);
  indoor.position.set(-9, 4, 0);
  g.add(indoor);
  lamps.push({ light: indoor, bulbMat: null, power: 30 });

  // Pohon, semak, bunga
  const tree = (x, z, s = 1, pine = false) => {
    cyl(g, 0.16 * s, 0.24 * s, 1.1 * s, 6, '#8b5a2b', x, 0, z);
    if (pine) {
      add(g, new THREE.ConeGeometry(1.0 * s, 1.6 * s, 7), '#2f8f4e', x, 1.8 * s, z);
      add(g, new THREE.ConeGeometry(0.75 * s, 1.3 * s, 7), '#3aa35b', x, 2.6 * s, z);
    } else {
      ball(g, 0.95 * s, '#4caf50', x, 1.75 * s, z, 0);
      ball(g, 0.7 * s, '#66bb6a', x + 0.35 * s, 2.35 * s, z + 0.15 * s, 0);
    }
  };
  tree(3.2, -12.4, 1.1);
  tree(12.4, -12.6, 0.9, true);
  tree(21.4, 6.5, 1);
  tree(21.4, 11.6, 1.1, true);
  tree(3.4, 12.2, 1);
  tree(8.6, 12.6, 0.8, true);
  tree(15.8, 12.4, 1.05);
  tree(21.7, -3.3, 0.85, true);
  tree(12, -7.5, 0.75);
  for (const [x, z, s] of [[5, 4.5, 0.6], [2.6, 8, 0.5], [18.5, 9.8, 0.55], [10.8, -11.8, 0.6], [21.3, -12, 0.5]]) {
    const b = ball(g, s, '#5aa846', x, s * 0.6, z, 0);
    b.scale.y = 0.8;
  }
  const flowerCols = ['#ff6b9d', '#ffd166', '#ffffff', '#c77dff', '#ff9f1c'];
  for (const [cx, cz] of [[4.6, 7.2], [6.4, 10.2], [11.6, 10.6], [18.2, 8.6], [3.4, -6.2], [10.2, -5.2], [20.6, -3.4], [13.5, -10.5]]) {
    for (let i = 0; i < 6; i++) {
      const x = cx + (Math.random() - 0.5) * 1.4;
      const z = cz + (Math.random() - 0.5) * 1.4;
      const st = box(g, 0.03, 0.25, 0.03, '#3a7d3a', x, 0, z);
      st.castShadow = false;
      ball(g, 0.1, flowerCols[(i + Math.floor(cx)) % flowerCols.length], x, 0.28, z);
    }
  }
  // pagar depan
  for (let x = 1; x <= 35; x += 0.8) if (x < 4.4 || x > 6.6) box(g, 0.12, 0.6, 0.12, '#f4e3c3', x, 0, 13.6);
  box(g, 3.6, 0.08, 0.06, '#e6d0a8', 2.6, 0.38, 13.6);
  box(g, 28.2, 0.08, 0.06, '#e6d0a8', 20.9, 0.38, 13.6);
  for (let i = 0; i < 4; i++) cyl(g, 0.42, 0.42, 0.04, 7, '#d9d4c7', 5.5 + (i % 2) * 0.3, 0, 12.6 + i * 1.15);

  // ---------- Kompleks olahraga ----------
  const FIELD = { x: 13.5, z: 24 };
  const ellipse = (rx, rz, h, color) => {
    const m = cyl(g, 1, 1, h, 36, color, FIELD.x, 0, FIELD.z);
    m.scale.set(rx, 1, rz);
    m.castShadow = false;
    return m;
  };
  ellipse(9.9, 7, 0.03, '#d9704a'); // lintasan lari
  ellipse(9.25, 6.35, 0.035, '#f7efe5');
  ellipse(9.15, 6.25, 0.04, '#d9704a');
  ellipse(8.6, 5.7, 0.045, '#79c466');
  box(g, 11, 0.06, 7, '#4caf50', FIELD.x, 0, FIELD.z);
  for (let i = 0; i < 5; i++) box(g, 1.1, 0.065, 7, '#5dbb63', FIELD.x - 4.4 + i * 2.2, 0, FIELD.z).castShadow = false;
  const line = (w, d, x, z) => (box(g, w, 0.07, d, '#ffffff', x, 0, z).castShadow = false);
  line(11, 0.08, FIELD.x, FIELD.z - 3.5);
  line(11, 0.08, FIELD.x, FIELD.z + 3.5);
  line(0.08, 7, FIELD.x - 5.5, FIELD.z);
  line(0.08, 7, FIELD.x + 5.5, FIELD.z);
  line(0.08, 7, FIELD.x, FIELD.z);
  cyl(g, 1.1, 1.1, 0.068, 20, '#ffffff', FIELD.x, 0, FIELD.z).castShadow = false;
  cyl(g, 1.02, 1.02, 0.072, 20, '#4caf50', FIELD.x, 0, FIELD.z).castShadow = false;
  for (const s of [-1, 1]) {
    const gx = FIELD.x + s * 5.6;
    line(1.4, 0.08, gx - s * 0.7, FIELD.z - 1.6);
    line(1.4, 0.08, gx - s * 0.7, FIELD.z + 1.6);
    line(0.08, 3.2, gx - s * 1.4, FIELD.z);
    for (const dz of [-1.1, 1.1]) cyl(g, 0.05, 0.05, 1.1, 6, '#ffffff', gx, 0, FIELD.z + dz);
    box(g, 0.08, 0.08, 2.3, '#ffffff', gx, 1.06, FIELD.z);
    box(g, 0.5, 1.05, 2.2, mat('#ffffff', { transparent: true, opacity: 0.35 }), gx + s * 0.28, 0, FIELD.z).castShadow = false;
  }
  const soccerBall = ball(g, 0.17, '#ffffff', FIELD.x, 0.24, FIELD.z, 1);
  [[3.6, 2.2, 0.55], [2.4, 1.5, -0.7], [4.4, 2.7, 0.4]].forEach(([rx, rz, speed], i) => {
    spot('sports', { x: FIELD.x + rx, z: FIELD.z, rot: 0, action: 'soccer', cx: FIELD.x, cz: FIELD.z, rx, rz, speed, lap0: i * 2.1 });
  });
  spot('sports', { x: FIELD.x + 9.2, z: FIELD.z, rot: 0, action: 'jog', cx: FIELD.x, cz: FIELD.z, rx: 9.2, rz: 6.3, speed: 0.28 });
  spot('sports', { x: FIELD.x + 9.6, z: FIELD.z, rot: 0, action: 'jog', cx: FIELD.x, cz: FIELD.z, rx: 9.6, rz: 6.7, speed: 0.22, lap0: 3 });
  // papan skor & bangku penonton
  box(g, 0.12, 1.6, 0.12, '#3d405b', FIELD.x - 1.2, 0, 16.4);
  box(g, 0.12, 1.6, 0.12, '#3d405b', FIELD.x + 1.2, 0, 16.4);
  box(g, 3, 1, 0.14, '#2d3142', FIELD.x, 1.3, 16.4);
  const score = textPlane('HQ 2 : 1 AI', 2.8, 0.8, '#2d3142', '#ffd166');
  score.position.set(FIELD.x, 1.8, 16.48);
  g.add(score);
  for (const bx of [8.5, 18.5]) {
    box(g, 3.4, 0.35, 0.6, '#c2773a', bx, 0, 16.6);
    box(g, 3.4, 0.7, 0.6, '#a8632e', bx, 0, 16.0);
  }
  // Basket (setengah lapangan)
  box(g, 7, 0.06, 7, '#e39a5b', 28, 0, 21.5);
  line(7, 0.08, 28, 18);
  line(7, 0.08, 28, 25);
  line(0.08, 7, 24.5, 21.5);
  line(0.08, 7, 31.5, 21.5);
  box(g, 2.4, 0.07, 2.6, '#c9763d', 30.3, 0, 21.5).castShadow = false;
  cyl(g, 0.09, 0.11, 2.9, 6, '#3d405b', 31.9, 0, 21.5);
  box(g, 0.5, 0.08, 0.08, '#3d405b', 31.65, 2.7, 21.5);
  box(g, 0.08, 1.0, 1.5, '#ffffff', 31.4, 2.3, 21.5);
  box(g, 0.02, 0.4, 0.5, '#e63946', 31.35, 2.45, 21.5);
  const rim = add(g, new THREE.TorusGeometry(0.26, 0.03, 6, 14), '#ff6b35', 31.05, 2.5, 21.5);
  rim.rotation.x = Math.PI / 2;
  cyl(g, 0.26, 0.16, 0.35, 8, mat('#ffffff', { transparent: true, opacity: 0.45, wireframe: true }), 31.05, 2.14, 21.5).castShadow = false;
  spot('sports', { x: 28.4, z: 20.6, rot: 1.25, action: 'hoops' });
  spot('sports', { x: 27.6, z: 22.9, rot: 1.9, action: 'hoops', lap0: 1.3 });
  // Yoga
  box(g, 6, 0.05, 3.6, '#e8dcc6', 28, 0, 28.5);
  [['#8ecae6', 26.6], ['#ffafcc', 28], ['#b5e48c', 29.4]].forEach(([c, x], i) => {
    box(g, 0.9, 0.04, 2, c, x, 0.05, 28.5);
    if (i !== 1) spot('sports', { x, z: 28.5, rot: 0, action: 'yoga', lap0: i });
  });
  cyl(g, 0.12, 0.1, 0.3, 8, '#48bfe3', 28, 0.09, 28.2); // botol minum
  // lampu sorot
  for (const [x, z] of [[4.2, 17.6], [22.8, 30.4]]) {
    cyl(g, 0.1, 0.14, 4.2, 6, '#3d405b', x, 0, z);
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff1b8', emissiveIntensity: 0 });
    box(g, 0.9, 0.35, 0.3, bulbMat, x, 4.2, z).castShadow = false;
    const light = new THREE.PointLight('#fff1c9', 0, 26, 1.1);
    light.position.set(x, 4.3, z);
    g.add(light);
    lamps.push({ light, bulbMat, power: 60 });
  }

  // ---------- Alam di sekeliling (di luar area utama) ----------
  {
    const inCore = (x, z) => (x > -21 && x < 38 && z > -15.5 && z < 15.5) || (x > 1.5 && x < 34 && z > 14 && z < 33.5);
    const rand = (a, b) => a + Math.random() * (b - a);
    const scatter = (n, fn) => {
      for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
        const x = rand(-75, 90);
        const z = rand(-70, 70);
        if (inCore(x, z)) continue;
        fn(x, z);
        i++;
      }
    };
    // petak rumput beda warna supaya tanah tidak polos
    scatter(70, (x, z) => {
      const p = cyl(g, rand(2.5, 6), rand(2.5, 6), 0.02, 7, Math.random() < 0.5 ? '#86cc68' : '#72b955', x, 0, z);
      p.castShadow = false;
    });
    // Outer nature is decoration only: fewer pieces, and no shadows (shadows are the costliest part to draw).
    const before = g.children.length;
    scatter(110, (x, z) => tree(x, z, rand(0.8, 1.5), Math.random() < 0.45));
    for (const m of g.children.slice(before)) m.castShadow = false;
    scatter(45, (x, z) => {
      const r = rand(0.4, 0.8);
      const b = ball(g, r, '#5aa846', x, r * 0.6, z, 0);
      b.scale.y = 0.8;
      b.castShadow = false;
    });
    scatter(25, (x, z) => {
      const r = rand(0.3, 0.9);
      const rock = ball(g, r, '#a8a29e', x, r * 0.35, z, 0);
      rock.scale.y = 0.6;
      rock.castShadow = false;
    });
    scatter(30, (cx, cz) => {
      for (let i = 0; i < 4; i++) {
        const b = ball(g, 0.1, flowerCols[i % flowerCols.length], cx + rand(-0.7, 0.7), 0.22, cz + rand(-0.7, 0.7));
        b.castShadow = false;
      }
    });
    // jalan setapak dari gerbang ke selatan
    for (let i = 0; i < 40; i++) {
      const st = cyl(g, 0.5, 0.5, 0.04, 7, '#d9d4c7', 0.6 + Math.sin(i * 0.5) * 0.8, 0, 14.8 + i * 1.3);
      st.castShadow = false;
    }
  }

  // ---------- Kafe & kolam renang ----------
  for (const x of [20.4, 21.8, 23.2]) cyl(g, 0.45, 0.45, 0.04, 7, '#d9d4c7', x, 0, (x % 2) * 0.2 - 0.1);
  const palm = (x, z, s = 1) => {
    let px = x;
    let y = 0;
    for (let i = 0; i < 5; i++) {
      cyl(g, 0.13 * s, 0.17 * s, 0.56 * s, 6, i % 2 ? '#b07d4f' : '#a47148', px, y, z);
      px += 0.09 * s;
      y += 0.53 * s;
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leaf = add(g, new THREE.BoxGeometry(1.5 * s, 0.06, 0.42 * s), i % 2 ? '#43aa8b' : '#52b788', px + Math.cos(a) * 0.65 * s, y + 0.05, z + Math.sin(a) * 0.65 * s);
      leaf.rotation.set(0, -a, -0.38);
    }
    ball(g, 0.13 * s, '#7f5539', px + 0.12, y - 0.12, z + 0.05);
    ball(g, 0.13 * s, '#7f5539', px - 0.08, y - 0.14, z - 0.1);
  };

  // Kafe
  box(g, 11, 0.06, 5.4, '#ead7bb', 29.5, 0, -6.9);
  box(g, 6.4, 2.5, 3, '#fff1e0', 29.5, 0, -11);
  box(g, 6.8, 0.25, 3.4, '#6d4c41', 29.5, 2.5, -11);
  box(g, 5.6, 1.05, 0.7, '#8d6e63', 29.5, 0, -9.25);
  box(g, 5.8, 0.08, 0.85, '#f5ebe0', 29.5, 1.05, -9.25);
  box(g, 0.7, 0.55, 0.5, '#455a64', 27.4, 1.13, -9.35);
  box(g, 0.5, 0.4, 0.4, '#ffb4a2', 31.4, 1.13, -9.35); // etalase kue
  for (let i = 0; i < 3; i++) cyl(g, 0.08, 0.07, 0.16, 8, '#ffffff', 28.6 + i * 0.35, 1.13, -9.1);
  for (let i = 0; i < 8; i++) {
    const s = box(g, 0.82, 0.08, 1.4, i % 2 ? '#fff8e7' : '#2a9d8f', 26.65 + i * 0.815, 2.25, -9.2);
    s.rotation.x = 0.3;
  }
  const kafe = textPlane('KAFE', 2, 0.55, '#6d4c41', '#fff1e0');
  kafe.position.set(29.5, 3.05, -9.55);
  g.add(kafe);
  const umbCols = ['#ef476f', '#ffd166', '#06d6a0'];
  [26, 29.5, 33].forEach((tx, i) => {
    const tz = -6.4;
    cyl(g, 0.06, 0.09, 0.75, 6, '#555b66', tx, 0, tz);
    cyl(g, 0.55, 0.55, 0.06, 10, '#ffffff', tx, 0.75, tz);
    cyl(g, 0.03, 0.03, 2.1, 5, '#8d6e63', tx, 0.8, tz);
    add(g, new THREE.ConeGeometry(0.75, 0.4, 8), umbCols[i], tx, 3.05, tz);
    cyl(g, 0.07, 0.06, 0.14, 8, '#ffffff', tx + 0.15, 0.81, tz + 0.1);
    for (const s of [-1, 1]) {
      const cx = tx + s * 0.95;
      box(g, 0.6, 0.08, 0.6, '#d4a373', cx, 0.42, tz);
      box(g, 0.08, 0.6, 0.6, '#b5835a', cx + s * 0.3, 0.5, tz);
      cyl(g, 0.04, 0.04, 0.42, 5, '#555b66', cx, 0, tz);
      spot('resort', { x: cx, z: tz, rot: s < 0 ? Math.PI / 2 : -Math.PI / 2, action: 'cafe', sit: true, seatY: 0.5 });
    }
  });
  // lampu gantung kafe
  const fairyMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffcf70', emissiveIntensity: 0 });
  for (const x of [24.3, 34.7]) cyl(g, 0.05, 0.06, 2.7, 6, '#3d405b', x, 0, -4.3);
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    const b = ball(g, 0.08, fairyMat, 24.3 + u * 10.4, 2.6 - Math.sin(u * Math.PI) * 0.45, -4.3);
    b.castShadow = false;
  }
  lamps.push({ light: null, bulbMat: fairyMat });
  palm(23.8, -11.8, 1);
  palm(35, -12.6, 0.9);

  // Kolam renang
  box(g, 11, 0.12, 9.6, '#f1e9da', 29.5, 0, 5.7);
  box(g, 7.6, 0.24, 5.0, '#ffffff', 29.5, 0, 4.2);
  const poolMat = new THREE.MeshStandardMaterial({ color: '#36c5f0', roughness: 0.15, metalness: 0.1, emissive: '#0a6a8a', emissiveIntensity: 0.25, flatShading: true });
  const pool = box(g, 7, 0.04, 4.4, poolMat, 29.5, 0.22, 4.2);
  pool.castShadow = false;
  for (let i = 0; i < 14; i++) ball(g, 0.06, i % 2 ? '#ffffff' : '#ff595e', 26.2 + i * 0.5, 0.28, 4.0);
  for (const dx of [-0.2, 0.2]) box(g, 0.05, 0.7, 0.05, '#c0c6cc', 32.7 + dx, 0.24, 6.5);
  box(g, 0.6, 0.5, 0.6, '#adb5bd', 25.4, 0.12, 2.9);
  box(g, 1.7, 0.1, 0.55, '#ffd166', 26.3, 0.62, 2.9);
  const poolLight = new THREE.PointLight('#5fd4ff', 0, 8, 1.4);
  poolLight.position.set(29.5, 1, 4.2);
  g.add(poolLight);
  lamps.push({ light: poolLight, bulbMat: null, power: 10 });
  spot('resort', { x: 27.9, z: 5.2, rot: 0.3, action: 'float', out: { x: 27.9, z: 7.2 } });
  spot('resort', { x: 31.2, z: 5.1, rot: -0.4, action: 'float', out: { x: 31.2, z: 7.2 } });
  spot('resort', { x: 29.5, z: 2.9, rot: Math.PI / 2, action: 'swim', out: { x: 29.5, z: 7.2 } });
  const towel = ['#ff9f1c', '#8ecae6', '#ff70a6'];
  [27, 29.5, 32].forEach((x, i) => {
    box(g, 0.9, 0.35, 2.2, '#ffffff', x, 0.12, 9.45);
    box(g, 0.85, 0.06, 1.5, towel[i], x, 0.47, 9.75);
    const back = box(g, 0.85, 0.08, 0.8, towel[i], x, 0.62, 8.62);
    back.rotation.x = -0.45;
    spot('resort', { x, z: 9.95, rot: 0, action: 'sun', lie: true, lieY: 0.93, out: { x, z: 7.6 } });
  });
  for (const x of [28.25, 30.75]) {
    cyl(g, 0.03, 0.03, 2.2, 5, '#8d6e63', x, 0.12, 9.0);
    add(g, new THREE.ConeGeometry(0.85, 0.4, 8), x < 29 ? '#ffffff' : '#ef476f', x, 2.4, 9.0);
  }
  ball(g, 0.25, '#ff595e', 34, 0.37, 7.8, 1);
  palm(24.6, 1.6, 1.05);
  palm(34.6, 1.4, 0.95);
  palm(34.5, 11.2, 1);
  palm(24.3, 11.4, 0.9);

  // Awan (dimatikan: di kamera isometrik terlihat seperti batu di tanah)
  for (let i = 0; i < 0; i++) {
    const c = new THREE.Group();
    const m = mat('#ffffff');
    for (let j = 0; j < 3; j++) add(c, new THREE.IcosahedronGeometry(0.9 + Math.random() * 0.6, 0), m, j * 1.1 - 1.1, Math.random() * 0.4, Math.random() * 0.6);
    c.position.set(-25 + i * 12, 11 + Math.random() * 3, -14 + Math.random() * 18);
    c.userData.speed = 0.3 + Math.random() * 0.4;
    c.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    g.add(c);
    clouds.push(c);
  }

  function tick(t, dt) {
    codeTex.offset.y -= dt * 0.06;
    for (const m of leds) if (Math.random() < dt * 3) m.emissiveIntensity = Math.random() < 0.3 ? 0.1 : 1.6;
    for (const s of zones.desk.spots) s.screen.material = s.active ? s.screenOn : s.screenOff;
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 30) c.position.x = -30;
    }
    water.position.y = 0.01 + Math.sin(t * 1.5) * 0.01;
    // bola ikut bergerak kalau ada yang main
    if (zones.sports.spots.some((s) => s.action === 'soccer' && s.active)) {
      soccerBall.position.set(FIELD.x + Math.sin(t * 0.9) * 4.2, 0.24 + Math.abs(Math.sin(t * 3.1)) * 0.35, FIELD.z + Math.sin(t * 1.37) * 2.4);
      soccerBall.rotation.x += dt * 6;
    } else soccerBall.position.set(FIELD.x, 0.24, FIELD.z);
  }

  function setNight(night) {
    for (const l of lamps) {
      if (l.light) l.light.intensity = night * (l.power || 12);
      if (l.bulbMat) l.bulbMat.emissiveIntensity = night * 2.2;
    }
  }

  return { zones, tick, setNight };
}
