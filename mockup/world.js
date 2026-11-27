// Dunia diorama low-poly: kantor IT elite (4 ruangan modern) + kampus teknologi + taman & fasilitas.
import * as THREE from 'three';

const cache = new Map();
export function mat(color, extra) {
  if (extra) return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...extra });
  let m = cache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 });
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

function textPlane(text, w, h, bg, fg, accent) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * 128);
  cv.height = Math.round(h * 128);
  const x = cv.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, cv.width, cv.height);
  if (accent) {
    x.fillStyle = accent;
    x.fillRect(0, 0, cv.width, Math.max(4, cv.height * 0.08));
  }
  x.fillStyle = fg;
  x.font = `700 ${Math.floor(cv.height * 0.52)}px Fredoka, system-ui, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, cv.width / 2, cv.height / 2 + 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }));
}

function codeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 160;
  cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#0d1117';
  x.fillRect(0, 0, 160, 256);
  // Sidebar explorer & gutter
  x.fillStyle = '#161b22';
  x.fillRect(0, 0, 22, 256);
  x.fillStyle = '#30363d';
  x.fillRect(22, 0, 2, 256);
  const cols = ['#7ee787', '#79c0ff', '#ff7b72', '#d2a8ff', '#ffa657', '#a5d6ff'];
  for (let y = 8; y < 256; y += 10) {
    x.fillStyle = '#484f58';
    x.fillRect(6, y, 10, 4);
    let px = 30 + Math.floor(Math.random() * 3) * 10;
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n && px < 148; i++) {
      const w = 8 + Math.random() * 28;
      x.fillStyle = cols[Math.floor(Math.random() * cols.length)];
      x.fillRect(px, y, w, 4);
      px += w + 4;
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 0.55);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function telemetryTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#0b101b';
  x.fillRect(0, 0, 512, 256);

  // Header bar
  x.fillStyle = '#141c2f';
  x.fillRect(0, 0, 512, 30);
  x.fillStyle = '#38bdf8';
  x.fillRect(14, 10, 80, 10);
  x.fillStyle = '#34d399';
  x.fillRect(420, 9, 76, 12);

  // Panels
  const panel = (px, py, pw, ph) => {
    x.fillStyle = '#111827';
    x.fillRect(px, py, pw, ph);
    x.strokeStyle = '#1f2937';
    x.lineWidth = 2;
    x.strokeRect(px, py, pw, ph);
  };
  panel(14, 42, 236, 120);
  panel(262, 42, 236, 120);
  panel(14, 174, 484, 68);

  // Wave graph (left panel)
  x.strokeStyle = '#38bdf8';
  x.lineWidth = 3;
  x.beginPath();
  for (let i = 0; i <= 20; i++) {
    const gx = 24 + i * 10.8;
    const gy = 115 - Math.sin(i * 0.65) * 28 - (i % 3) * 6;
    if (i === 0) x.moveTo(gx, gy);
    else x.lineTo(gx, gy);
  }
  x.stroke();

  // Bar metrics (right panel)
  const barCols = ['#34d399', '#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#38bdf8'];
  for (let i = 0; i < 6; i++) {
    const bh = 28 + ((i * 23) % 68);
    x.fillStyle = barCols[i];
    x.fillRect(284 + i * 34, 150 - bh, 20, bh);
  }

  // Cluster nodes (bottom panel)
  for (let i = 0; i < 12; i++) {
    x.fillStyle = i === 8 ? '#fbbf24' : '#34d399';
    x.fillRect(28 + i * 38, 194, 26, 28);
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function serverFloorTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#1e2532';
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#2d3748';
  x.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke();
  }
  x.fillStyle = '#263042';
  for (let gx = 8; gx < 256; gx += 64) {
    for (let gy = 8; gy < 256; gy += 64) {
      x.fillRect(gx, gy, 48, 48);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
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
  const accentStrips = [];
  const clouds = [];

  // Shared architectural materials
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#93c5fd',
    transparent: true,
    opacity: 0.28,
    roughness: 0.12,
    metalness: 0.25,
  });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.35, metalness: 0.65, flatShading: true });
  const alumMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.3, metalness: 0.7, flatShading: true });

  // ---------- Pulau / Tech Campus Grounds ----------
  const land = box(g, 900, 1, 900, '#6bb85b', 7.75, -1, 0);
  land.castShadow = false;

  // ---------- Gedung HQ (Modern Glass & Steel Tech Campus) ----------
  // Architectural concrete plinth (y: 0..0.04) & atrium floor (y: 0.04..0.07)
  box(g, 18.6, 0.04, 20.6, '#334155', -9, 0, 0).castShadow = false;
  box(g, 18, 0.03, 20, '#cbd5e1', -9, 0.04, 0).castShadow = false;

  // Zone floors (y: 0.07..0.10, separated cleanly from atrium floor to prevent z-fighting)
  box(g, 8.2, 0.03, 8.4, '#e2e8f0', -13.5, 0.07, -5.4).castShadow = false; // Engineering Pod
  box(g, 7.6, 0.03, 7.4, '#334155', -4.6, 0.07, -5.8).castShadow = false; // War Room
  const srvFloorMat = new THREE.MeshStandardMaterial({ map: serverFloorTexture(), roughness: 0.55, metalness: 0.2 });
  const srvFloor = box(g, 8.4, 0.03, 9.2, srvFloorMat, -13.5, 0.07, 5.2);
  srvFloor.castShadow = false;
  box(g, 7.8, 0.03, 7.2, '#b08968', -4.6, 0.07, 5.9).castShadow = false; // R&D Lounge
  // Sleek central corridor runner (in the open corridor gap between north and south rooms)
  box(g, 17.6, 0.03, 1.4, '#475569', -9, 0.07, -0.1).castShadow = false;

  // Architectural Walls (Dark Slate + Brushed Aluminum Coping + Glass Partitions)
  const wall = (x, z, w, d, h) => {
    box(g, w, h, d, '#1e293b', x, 0, z);
    box(g, w + 0.06, 0.07, d + 0.06, alumMat, x, h, z);
  };
  wall(-9, -10, 18.3, 0.3, 1.55); // utara
  wall(-18, 0, 0.3, 20, 1.55); // barat
  wall(-9, 10, 18.3, 0.3, 0.42); // selatan (rendah, sisi kamera)
  // East glass curtain facade with steel mullions
  wall(0, -5.75, 0.22, 8.5, 0.42);
  wall(0, 5.75, 0.22, 8.5, 0.42);
  for (const z of [-5.75, 5.75]) {
    const gl = box(g, 0.08, 0.95, 8.2, glassMat, 0, 0.42, z);
    gl.castShadow = false;
    for (const mz of [-3.2, 0, 3.2]) box(g, 0.14, 1.0, 0.12, metalMat, 0, 0.42, z + mz);
  }
  // Interior partitions (solid base + glass upper)
  wall(-9, -6.25, 0.22, 7.5, 0.65);
  box(g, 0.08, 0.55, 7.3, glassMat, -9, 0.65, -6.25).castShadow = false;
  wall(-9, 6.25, 0.22, 7.5, 0.65);
  box(g, 0.08, 0.55, 7.3, glassMat, -9, 0.65, 6.25).castShadow = false;
  wall(-16, 0, 4, 0.22, 0.95);

  // Glowing cyan architectural LED strip along north & west roof edge
  const cyanStripMat = new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#38bdf8', emissiveIntensity: 0.6 });
  box(g, 18.2, 0.05, 0.06, cyanStripMat, -9, 1.62, -9.85).castShadow = false;
  box(g, 0.06, 0.05, 20, cyanStripMat, -17.85, 1.62, 0).castShadow = false;
  accentStrips.push(cyanStripMat);

  // Glass entrance canopy & security bollards at DOOR (x = 0, z = 0)
  box(g, 1.8, 0.07, 3.2, glassMat, 0.9, 1.85, 0).castShadow = false;
  box(g, 1.85, 0.06, 0.12, metalMat, 0.9, 1.85, -1.55);
  box(g, 1.85, 0.06, 0.12, metalMat, 0.9, 1.85, 1.55);
  for (const bz of [-1.25, 1.25]) {
    box(g, 0.14, 0.9, 0.14, metalMat, 0.3, 0, bz);
    const reader = new THREE.MeshStandardMaterial({ color: '#34d399', emissive: '#34d399', emissiveIntensity: 0.9 });
    box(g, 0.08, 0.12, 0.08, reader, 0.3, 0.9, bz).castShadow = false;
    accentStrips.push(reader);
  }

  // Modern architectural planter (dark slate box instead of terracotta)
  const plant = (x, z, s = 1) => {
    box(g, 0.58 * s, 0.48 * s, 0.58 * s, '#334155', x, 0, z);
    box(g, 0.5 * s, 0.04 * s, 0.5 * s, '#4a3728', x, 0.47 * s, z);
    ball(g, 0.42 * s, '#34a853', x, 0.8 * s, z, 0);
    ball(g, 0.3 * s, '#52c46c', x + 0.14 * s, 1.08 * s, z + 0.08 * s, 0);
  };

  // --- Ruang Kerja / Elite Engineering Pod ---
  const codeTex = codeTexture();
  const screenOn = new THREE.MeshBasicMaterial({ map: codeTex });
  const screenOff = new THREE.MeshBasicMaterial({ color: '#111827' });
  for (const [x, z] of [[-15.5, -7.6], [-11.5, -7.6], [-15.5, -3.6], [-11.5, -3.6]]) {
    // Sleek dark-walnut & matte-black standing desk
    box(g, 2.55, 0.09, 1.15, '#1e293b', x, 0.86, z);
    box(g, 2.5, 0.03, 1.1, '#475569', x, 0.95, z);
    for (const sx of [-1.1, 1.1]) {
      box(g, 0.09, 0.86, 0.12, metalMat, x + sx, 0, z);
      box(g, 0.12, 0.05, 0.75, metalMat, x + sx, 0, z);
    }
    // Desk mat + mechanical keyboard + mouse
    box(g, 1.45, 0.015, 0.55, '#0f172a', x, 0.98, z + 0.15).castShadow = false;
    box(g, 0.72, 0.035, 0.24, '#e2e8f0', x - 0.1, 0.995, z + 0.16);
    box(g, 0.12, 0.03, 0.18, '#38bdf8', x + 0.45, 0.995, z + 0.18);
    // Mac Studio / Workstation cube + matte tumbler
    box(g, 0.32, 0.16, 0.32, alumMat, x - 0.95, 0.98, z - 0.25);
    cyl(g, 0.075, 0.065, 0.19, 8, '#1e293b', x + 0.95, 0.98, z + 0.12);
    // Dual-monitor arm + Ultrawide main monitor + side vertical code monitor
    box(g, 0.12, 0.28, 0.1, alumMat, x, 0.98, z - 0.36);
    box(g, 1.32, 0.66, 0.06, '#0f172a', x - 0.14, 1.22, z - 0.34);
    const screen = add(g, new THREE.PlaneGeometry(1.22, 0.56), screenOff, x - 0.14, 1.55, z - 0.3);
    screen.castShadow = false;
    // Secondary vertical monitor angled slightly
    const sideFrame = box(g, 0.46, 0.74, 0.06, '#0f172a', x + 0.78, 1.2, z - 0.24);
    sideFrame.rotation.y = -0.32;
    const sideScreen = add(g, new THREE.PlaneGeometry(0.38, 0.64), screenOff, x + 0.77, 1.57, z - 0.2);
    sideScreen.rotation.y = -0.32;
    sideScreen.castShadow = false;

    // Ergonomic executive mesh chair with headrest & armrests
    cyl(g, 0.05, 0.05, 0.42, 6, metalMat, x, 0, z + 1.05);
    box(g, 0.48, 0.04, 0.48, metalMat, x, 0.02, z + 1.05);
    box(g, 0.72, 0.08, 0.7, '#1e293b', x, 0.42, z + 1.05);
    box(g, 0.66, 0.68, 0.08, '#334155', x, 0.5, z + 1.42);
    box(g, 0.38, 0.18, 0.08, '#38bdf8', x, 1.2, z + 1.42);
    for (const ax of [-0.36, 0.36]) box(g, 0.07, 0.22, 0.35, metalMat, x + ax, 0.48, z + 1.05);

    spot('desk', {
      x, z: z + 1.0, rot: Math.PI, action: 'type', sit: true, seatY: 0.5,
      out: { x: -13.5, z: z + 1.0 }, screen, sideScreen, screenOn, screenOff,
    });
  }
  plant(-17.2, -9.2);
  plant(-9.8, -9.2, 0.85);

  // --- Ruang Rapat / Executive War Room ---
  const telTex = telemetryTexture();
  const telMat = new THREE.MeshBasicMaterial({ map: telTex });

  // Sleek dark-oak & steel conference table with central power dock
  box(g, 4.3, 0.09, 1.65, '#4a3728', -4.5, 0.78, -5);
  box(g, 1.8, 0.02, 0.24, alumMat, -4.5, 0.87, -5); // central dock strip
  for (const sx of [-1.75, 1.75]) box(g, 0.14, 0.78, 0.9, metalMat, -4.5 + sx, 0, -5);
  box(g, 0.55, 0.03, 0.4, '#1e293b', -5.4, 0.87, -5.2); // laptop 1
  box(g, 0.55, 0.03, 0.4, '#1e293b', -3.6, 0.87, -5.2); // laptop 2
  cyl(g, 0.18, 0.2, 0.05, 8, '#0f172a', -4.5, 0.89, -5); // conference speakerphone puck

  // Giant 4K Wall-Mounted Telemetry / Command Display
  box(g, 4.1, 1.85, 0.09, '#0f172a', -4.5, 0.48, -9.78);
  const warScreen = add(g, new THREE.PlaneGeometry(3.85, 1.65), telMat, -4.5, 1.4, -9.72);
  warScreen.castShadow = false;
  // Soundbar / camera bar below display
  box(g, 1.4, 0.12, 0.12, '#334155', -4.5, 0.34, -9.72);

  // 3 Executive conference chairs
  for (const x of [-5.8, -4.5, -3.2]) {
    box(g, 0.7, 0.08, 0.7, '#1e293b', x, 0.42, -6.6);
    box(g, 0.68, 0.68, 0.08, '#e07a5f', x, 0.5, -6.97);
    cyl(g, 0.05, 0.05, 0.42, 6, metalMat, x, 0, -6.6);
    spot('meeting', { x, z: -6.55, rot: 0, action: 'wait', sit: true, seatY: 0.5, out: { x, z: -7.8 } });
  }
  plant(-1, -9.2, 0.9);

  // --- Ruang Server / Tier-4 Data Center & NOC ---
  // Overhead cable tray running across racks
  box(g, 0.65, 0.06, 7.4, metalMat, -16.9, 2.52, 5.4);
  box(g, 0.1, 0.04, 7.2, '#38bdf8', -16.75, 2.58, 5.4).castShadow = false;
  box(g, 0.1, 0.04, 7.2, '#fbbf24', -17.05, 2.58, 5.4).castShadow = false;

  for (const z of [2.4, 4.4, 6.4, 8.4]) {
    // Obsidian server rack with glass front door & cyan status bar
    box(g, 1.15, 2.45, 1.55, '#0f172a', -17.15, 0, z);
    box(g, 0.04, 2.3, 1.4, glassMat, -16.54, 0.08, z).castShadow = false;
    const barMat = new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#38bdf8', emissiveIntensity: 1.0 });
    box(g, 0.04, 2.2, 0.04, barMat, -16.52, 0.12, z - 0.72).castShadow = false;
    leds.push(barMat);

    for (let r = 0; r < 7; r++) {
      box(g, 0.02, 0.04, 1.3, '#1e293b', -16.57, 0.25 + r * 0.3, z);
      for (let c = 0; c < 2; c++) {
        const col = ['#34d399', '#38bdf8', '#fbbf24'][Math.floor(Math.random() * 3)];
        const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.5 });
        const led = add(g, new THREE.BoxGeometry(0.04, 0.07, 0.12), m, -16.55, 0.4 + r * 0.3, z - 0.35 + c * 0.7);
        led.castShadow = false;
        leds.push(m);
      }
    }
    spot('server', { x: -15.5, z, rot: -Math.PI / 2, action: 'server' });
  }
  // Precision CRAC Cooling Unit & NOC Monitor
  box(g, 1.8, 1.45, 0.95, '#e2e8f0', -11, 0, 9.2);
  for (let i = 0; i < 3; i++) box(g, 1.4, 0.08, 0.03, '#64748b', -11, 0.35 + i * 0.32, 8.71);
  // NOC wall monitor on partition
  box(g, 1.8, 1.0, 0.07, '#0f172a', -11.4, 1.2, 0.14);
  const nocScreen = add(g, new THREE.PlaneGeometry(1.65, 0.85), telMat, -11.4, 1.7, 0.19);
  nocScreen.castShadow = false;
  // Recessed floor fiber-optic conduit
  box(g, 5.2, 0.02, 0.14, '#38bdf8', -14, 0.1, 9.45).castShadow = false;

  // --- Perpustakaan / R&D Tech Lounge ---
  // Modern dark-steel & warm-oak modular bookshelves
  for (const sx of [-7, -3.6]) {
    box(g, 2.8, 2.25, 0.12, '#1e293b', sx, 0, 2.35);
    for (const px of [-1.35, 0, 1.35]) box(g, 0.08, 2.25, 0.62, metalMat, sx + px, 0, 2.6);
    for (let row = 0; row < 4; row++) {
      box(g, 2.8, 0.06, 0.62, '#a67c52', sx, row * 0.54 + 0.06, 2.62);
      let bx = sx - 1.25;
      while (bx < sx + 1.18) {
        const w = 0.14 + Math.random() * 0.12;
        const h = 0.3 + Math.random() * 0.14;
        box(g, w, h, 0.3, ['#38bdf8', '#34d399', '#f4a261', '#e63946', '#a78bfa', '#e9c46a', '#64748b'][Math.floor(Math.random() * 7)], bx + w / 2, row * 0.54 + 0.12, 2.8);
        bx += w + 0.03;
      }
    }
  }
  // Modern woven lounge rug under reading pods
  box(g, 6.8, 0.02, 3.2, '#334155', -4.8, 0.1, 7.1).castShadow = false;
  const armColors = ['#475569', '#3b5998', '#2a6f68'];
  [-7, -4.8, -2.6].forEach((x, i) => {
    const c = armColors[i];
    box(g, 1.0, 0.45, 0.9, c, x, 0, 7.05);
    box(g, 1.0, 1.02, 0.24, c, x, 0, 6.5);
    for (const s of [-0.5, 0.5]) box(g, 0.18, 0.64, 0.9, c, x + s, 0, 7.05);
    spot('library', { x, z: 7.1, rot: 0, action: 'read', sit: true, seatY: 0.45, out: { x, z: 8.6 } });
  });
  // Sleek side table with glowing tablet + architectural arc floor lamp
  cyl(g, 0.35, 0.35, 0.05, 10, '#1e293b', -5.9, 0.45, 7.4);
  cyl(g, 0.04, 0.04, 0.45, 6, metalMat, -5.9, 0, 7.4);
  box(g, 0.28, 0.02, 0.2, '#38bdf8', -5.9, 0.5, 7.4).castShadow = false;
  cyl(g, 0.04, 0.04, 1.9, 6, metalMat, -8.3, 0, 8.2);
  const lampShadeMat = new THREE.MeshStandardMaterial({ color: '#fef08a', emissive: '#fde047', emissiveIntensity: 0.4 });
  cyl(g, 0.22, 0.34, 0.32, 8, lampShadeMat, -8.3, 1.75, 8.2);
  lamps.push({ light: null, bulbMat: lampShadeMat });
  plant(-0.9, 9.2, 0.9);

  // ---------- Luar / Elite Tech Campus ----------
  // Travertine / granite entrance plaza & walkway
  box(g, 1.3, 0.02, 2.4, '#334155', 0.9, 0, 0).castShadow = false;
  for (let i = 0; i < 5; i++) box(g, 0.95, 0.03, 1.3, '#cbd5e1', 2.4 + i * 1.15, 0, 0).castShadow = false;

  // Sleek Architectural AGENT HQ Monolith Sign
  box(g, 2.5, 1.75, 0.24, '#1e293b', 3.3, 0, -2.5);
  box(g, 2.54, 0.06, 0.26, cyanStripMat, 3.3, 1.75, -2.5).castShadow = false;
  const sign = textPlane('AGENT HQ', 2.2, 0.65, '#0f172a', '#f8fafc', '#38bdf8');
  sign.position.set(3.3, 1.15, -2.37);
  g.add(sign);

  // Artisan Espresso Bar (Modern matte-black & cedar pergola)
  box(g, 4.2, 1.1, 1.3, '#1e293b', 7.5, 0, -9.6);
  box(g, 4.4, 0.09, 1.5, '#f8fafc', 7.5, 1.1, -9.6);
  box(g, 4.2, 2.5, 0.3, '#0f172a', 7.5, 0, -10.6);
  // Cedar slat canopy
  for (let i = 0; i < 6; i++) {
    const s = box(g, 0.66, 0.07, 1.9, i % 2 ? '#b07d4f' : '#334155', 5.83 + i * 0.67, 2.38, -9.8);
    s.rotation.x = 0.18;
  }
  box(g, 0.7, 0.6, 0.5, alumMat, 6.3, 1.19, -9.8); // Chrome espresso machine
  for (let i = 0; i < 3; i++) cyl(g, 0.08, 0.07, 0.16, 8, '#f8fafc', 8.2 + i * 0.3, 1.19, -9.4);
  const kopi = textPlane('ESPRESSO', 1.9, 0.5, '#0f172a', '#38bdf8', '#f59e0b');
  kopi.position.set(7.5, 2.1, -10.44);
  g.add(kopi);
  cyl(g, 0.06, 0.08, 1.0, 6, metalMat, 7.5, 0, -7.7);
  cyl(g, 0.48, 0.48, 0.06, 10, '#f8fafc', 7.5, 1.0, -7.7);
  spot('garden', { x: 6.1, z: -7.4, rot: 0.6, action: 'coffee' });
  spot('garden', { x: 8.9, z: -7.4, rot: -0.6, action: 'coffee' });
  spot('garden', { x: 7.5, z: -6.6, rot: 0, action: 'coffee' });

  // Kolam pancing (Zen Tech Campus Koi Pond)
  const waterMat = new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.18, metalness: 0.15, flatShading: true });
  const water = cyl(g, 3, 3, 0.1, 14, waterMat, 14.2, -0.05, 6.2);
  water.scale.x = 1.25;
  water.castShadow = false;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = ball(g, 0.3 + Math.random() * 0.12, '#64748b', 14.2 + Math.cos(a) * 3.85, 0.05, 6.2 + Math.sin(a) * 3.1, 0);
    r.scale.y = 0.6;
  }
  for (const [x, z] of [[15.2, 5.4], [16.4, 7.2], [13.4, 7.6]]) {
    const p = cyl(g, 0.35, 0.35, 0.03, 7, '#4ade80', x, 0.05, z);
    p.castShadow = false;
  }
  ball(g, 0.12, '#fb7185', 15.3, 0.15, 5.4);
  for (const [x, z, rot] of [[9.6, 5.2, Math.PI / 2], [9.6, 7.4, Math.PI / 2], [13, 2.3, 0.31]]) {
    cyl(g, 0.25, 0.22, 0.4, 8, '#475569', x, 0, z);
    spot('garden', { x, z, rot, action: 'fish', sit: true, seatY: 0.4 });
  }

  // Modern architectural park benches (wood + steel)
  const bench = (bx, bz) => {
    box(g, 2.6, 0.09, 0.8, '#b07d4f', bx, 0.45, bz);
    box(g, 2.6, 0.52, 0.09, '#94633a', bx, 0.54, bz - 0.38);
    for (const s of [-1.1, 1.1]) box(g, 0.1, 0.45, 0.72, metalMat, bx + s, 0, bz);
    spot('garden', { x: bx + 0.6, z: bz, rot: Math.PI / 2, action: 'nap', lie: true, lieY: 0.85 });
  };
  bench(15, -1.6);
  bench(19.5, 1.8);

  // Klinik / Wellness & Med-Bay Pod
  box(g, 5.2, 2.25, 3, '#f8fafc', 18.5, 0, -11);
  box(g, 5.5, 0.25, 3.3, '#0f172a', 18.5, 2.25, -11);
  box(g, 5.52, 0.06, 0.08, cyanStripMat, 18.5, 2.25, -9.35).castShadow = false;
  const medCrossMat = new THREE.MeshStandardMaterial({ color: '#f43f5e', emissive: '#f43f5e', emissiveIntensity: 0.6 });
  box(g, 0.9, 0.28, 0.05, medCrossMat, 19.3, 1.3, -9.47).castShadow = false;
  box(g, 0.28, 0.9, 0.05, medCrossMat, 19.3, 1.0, -9.47).castShadow = false;
  box(g, 1.1, 1.55, 0.06, glassMat, 17.2, 0, -9.47).castShadow = false;
  for (const bx of [16.5, 20]) {
    const bz = -6.6;
    box(g, 1.2, 0.45, 2.3, '#cbd5e1', bx, 0, bz);
    box(g, 1.1, 0.14, 2.1, '#ffffff', bx, 0.45, bz);
    box(g, 0.85, 0.12, 0.45, '#bae6fd', bx, 0.59, bz - 0.75);
    box(g, 1.12, 0.05, 1.1, '#38bdf8', bx, 0.59, bz + 0.45);
    cyl(g, 0.03, 0.03, 1.8, 5, alumMat, bx + 0.8, 0, bz - 0.8);
    box(g, 0.24, 0.32, 0.08, '#0f172a', bx + 0.8, 1.5, bz - 0.8);
    spot('clinic', { x: bx, z: bz + 0.63, rot: 0, action: 'sick', lie: true, lieY: 0.9 });
  }

  // Modern Campus Pole Lights
  for (const [x, z] of [[3.4, -2.6], [3.4, 2.6], [11, -4], [19, -3.8]]) {
    cyl(g, 0.06, 0.08, 2.7, 6, '#1e293b', x, 0, z);
    box(g, 0.45, 0.08, 0.22, '#1e293b', x, 2.7, z);
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#fef3c7', emissive: '#fde68a', emissiveIntensity: 0 });
    const b = box(g, 0.36, 0.05, 0.16, bulbMat, x, 2.66, z);
    b.castShadow = false;
    const light = new THREE.PointLight('#fde68a', 0, 10, 1.6);
    light.position.set(x, 2.6, z);
    g.add(light);
    lamps.push({ light, bulbMat });
  }
  const indoor = new THREE.PointLight('#e0f2fe', 0, 24, 1.15);
  indoor.position.set(-9, 4, 0);
  g.add(indoor);
  lamps.push({ light: indoor, bulbMat: null, power: 34 });

  // Pohon, semak, bunga
  const tree = (x, z, s = 1, pine = false) => {
    cyl(g, 0.16 * s, 0.24 * s, 1.1 * s, 6, '#7c5338', x, 0, z);
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
  // Sleek steel-and-glass campus perimeter rail
  for (let x = 1; x <= 35; x += 1.6) if (x < 4.4 || x > 6.6) box(g, 0.1, 0.62, 0.1, metalMat, x, 0, 13.6);
  box(g, 3.6, 0.06, 0.08, alumMat, 2.6, 0.52, 13.6);
  box(g, 28.2, 0.06, 0.08, alumMat, 20.9, 0.52, 13.6);
  for (let i = 0; i < 4; i++) box(g, 0.9, 0.03, 0.85, '#cbd5e1', 5.5 + (i % 2) * 0.25, 0, 12.6 + i * 1.15).castShadow = false;

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

  // Digital LED Scoreboard & modern bleachers
  box(g, 0.12, 1.6, 0.12, metalMat, FIELD.x - 1.2, 0, 16.4);
  box(g, 0.12, 1.6, 0.12, metalMat, FIELD.x + 1.2, 0, 16.4);
  box(g, 3.1, 1.05, 0.16, '#0f172a', FIELD.x, 1.3, 16.4);
  const score = textPlane('HQ 2 : 1 AI', 2.85, 0.85, '#0b101b', '#38bdf8', '#34d399');
  score.position.set(FIELD.x, 1.82, 16.49);
  g.add(score);
  for (const bx of [8.5, 18.5]) {
    box(g, 3.4, 0.35, 0.6, '#475569', bx, 0, 16.6);
    box(g, 3.4, 0.7, 0.6, '#334155', bx, 0, 16.0);
  }
  // Basket (setengah lapangan)
  box(g, 7, 0.06, 7, '#e39a5b', 28, 0, 21.5);
  line(7, 0.08, 28, 18);
  line(7, 0.08, 28, 25);
  line(0.08, 7, 24.5, 21.5);
  line(0.08, 7, 31.5, 21.5);
  box(g, 2.4, 0.07, 2.6, '#c9763d', 30.3, 0, 21.5).castShadow = false;
  cyl(g, 0.09, 0.11, 2.9, 6, metalMat, 31.9, 0, 21.5);
  box(g, 0.5, 0.08, 0.08, metalMat, 31.65, 2.7, 21.5);
  box(g, 0.08, 1.0, 1.5, glassMat, 31.4, 2.3, 21.5);
  box(g, 0.02, 0.4, 0.5, '#38bdf8', 31.35, 2.45, 21.5);
  const rim = add(g, new THREE.TorusGeometry(0.26, 0.03, 6, 14), '#ff6b35', 31.05, 2.5, 21.5);
  rim.rotation.x = Math.PI / 2;
  cyl(g, 0.26, 0.16, 0.35, 8, mat('#ffffff', { transparent: true, opacity: 0.45, wireframe: true }), 31.05, 2.14, 21.5).castShadow = false;
  spot('sports', { x: 28.4, z: 20.6, rot: 1.25, action: 'hoops' });
  spot('sports', { x: 27.6, z: 22.9, rot: 1.9, action: 'hoops', lap0: 1.3 });
  // Yoga deck
  box(g, 6, 0.05, 3.6, '#cbd5e1', 28, 0, 28.5);
  [['#38bdf8', 26.6], ['#a78bfa', 28], ['#34d399', 29.4]].forEach(([c, x], i) => {
    box(g, 0.9, 0.04, 2, c, x, 0.05, 28.5);
    if (i !== 1) spot('sports', { x, z: 28.5, rot: 0, action: 'yoga', lap0: i });
  });
  cyl(g, 0.12, 0.1, 0.3, 8, '#38bdf8', 28, 0.09, 28.2);
  // LED Stadium Floodlights
  for (const [x, z] of [[4.2, 17.6], [22.8, 30.4]]) {
    cyl(g, 0.1, 0.14, 4.2, 6, metalMat, x, 0, z);
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#e0f2fe', emissive: '#bae6fd', emissiveIntensity: 0 });
    box(g, 0.9, 0.35, 0.3, bulbMat, x, 4.2, z).castShadow = false;
    const light = new THREE.PointLight('#e0f2fe', 0, 26, 1.1);
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
    scatter(70, (x, z) => {
      const p = cyl(g, rand(2.5, 6), rand(2.5, 6), 0.02, 7, Math.random() < 0.5 ? '#79c466' : '#65ad53', x, 0, z);
      p.castShadow = false;
    });
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
      const rock = ball(g, r, '#94a3b8', x, r * 0.35, z, 0);
      rock.scale.y = 0.6;
      rock.castShadow = false;
    });
    scatter(30, (cx, cz) => {
      for (let i = 0; i < 4; i++) {
        const b = ball(g, 0.1, flowerCols[i % flowerCols.length], cx + rand(-0.7, 0.7), 0.22, cz + rand(-0.7, 0.7));
        b.castShadow = false;
      }
    });
    for (let i = 0; i < 40; i++) {
      const st = box(g, 0.95, 0.03, 0.95, '#cbd5e1', 0.6 + Math.sin(i * 0.5) * 0.8, 0, 14.8 + i * 1.3);
      st.castShadow = false;
    }
  }

  // ---------- Executive Courtyard Cafe & Infinity Pool ----------
  for (const x of [20.4, 21.8, 23.2]) box(g, 0.9, 0.03, 0.9, '#cbd5e1', x, 0, (x % 2) * 0.15 - 0.08).castShadow = false;
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

  // Modern Cafe Pavilion
  box(g, 11, 0.06, 5.4, '#cbd5e1', 29.5, 0, -6.9).castShadow = false;
  box(g, 6.4, 2.5, 3, '#1e293b', 29.5, 0, -11);
  box(g, 6.8, 0.22, 3.4, '#0f172a', 29.5, 2.5, -11);
  box(g, 5.6, 1.05, 0.7, '#475569', 29.5, 0, -9.25);
  box(g, 5.8, 0.08, 0.85, '#f8fafc', 29.5, 1.05, -9.25);
  box(g, 0.7, 0.55, 0.5, alumMat, 27.4, 1.13, -9.35);
  box(g, 0.5, 0.4, 0.4, glassMat, 31.4, 1.13, -9.35);
  for (let i = 0; i < 3; i++) cyl(g, 0.08, 0.07, 0.16, 8, '#f8fafc', 28.6 + i * 0.35, 1.13, -9.1);
  for (let i = 0; i < 8; i++) {
    const s = box(g, 0.8, 0.07, 1.4, i % 2 ? '#b07d4f' : '#334155', 26.65 + i * 0.815, 2.25, -9.2);
    s.rotation.x = 0.2;
  }
  const kafe = textPlane('TECH CAFE', 2.2, 0.55, '#0f172a', '#f8fafc', '#38bdf8');
  kafe.position.set(29.5, 3.02, -9.55);
  g.add(kafe);
  const umbCols = ['#334155', '#0f766e', '#1e40af'];
  [26, 29.5, 33].forEach((tx, i) => {
    const tz = -6.4;
    cyl(g, 0.06, 0.09, 0.75, 6, metalMat, tx, 0, tz);
    cyl(g, 0.55, 0.55, 0.06, 10, '#f8fafc', tx, 0.75, tz);
    cyl(g, 0.03, 0.03, 2.1, 5, alumMat, tx, 0.8, tz);
    add(g, new THREE.ConeGeometry(0.78, 0.38, 8), umbCols[i], tx, 3.05, tz);
    cyl(g, 0.07, 0.06, 0.14, 8, '#f8fafc', tx + 0.15, 0.81, tz + 0.1);
    for (const s of [-1, 1]) {
      const cx = tx + s * 0.95;
      box(g, 0.6, 0.08, 0.6, '#b07d4f', cx, 0.42, tz);
      box(g, 0.08, 0.6, 0.6, '#8d6e63', cx + s * 0.3, 0.5, tz);
      cyl(g, 0.04, 0.04, 0.42, 5, metalMat, cx, 0, tz);
      spot('resort', { x: cx, z: tz, rot: s < 0 ? Math.PI / 2 : -Math.PI / 2, action: 'cafe', sit: true, seatY: 0.5 });
    }
  });
  // Warm architectural string lights
  const fairyMat = new THREE.MeshStandardMaterial({ color: '#fef3c7', emissive: '#fde047', emissiveIntensity: 0 });
  for (const x of [24.3, 34.7]) cyl(g, 0.05, 0.06, 2.7, 6, metalMat, x, 0, -4.3);
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    const b = ball(g, 0.075, fairyMat, 24.3 + u * 10.4, 2.6 - Math.sin(u * Math.PI) * 0.45, -4.3);
    b.castShadow = false;
  }
  lamps.push({ light: null, bulbMat: fairyMat });
  palm(23.8, -11.8, 1);
  palm(35, -12.6, 0.9);

  // Infinity Lap Pool
  box(g, 11, 0.12, 9.6, '#334155', 29.5, 0, 5.7).castShadow = false;
  box(g, 7.6, 0.24, 5.0, '#e2e8f0', 29.5, 0, 4.2);
  const poolMat = new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.12, metalness: 0.15, emissive: '#0284c7', emissiveIntensity: 0.28, flatShading: true });
  const pool = box(g, 7, 0.04, 4.4, poolMat, 29.5, 0.22, 4.2);
  pool.castShadow = false;
  for (let i = 0; i < 14; i++) ball(g, 0.06, i % 2 ? '#ffffff' : '#38bdf8', 26.2 + i * 0.5, 0.28, 4.0);
  for (const dx of [-0.2, 0.2]) box(g, 0.05, 0.7, 0.05, alumMat, 32.7 + dx, 0.24, 6.5);
  box(g, 0.6, 0.5, 0.6, metalMat, 25.4, 0.12, 2.9);
  box(g, 1.7, 0.1, 0.55, '#b07d4f', 26.3, 0.62, 2.9);
  const poolLight = new THREE.PointLight('#38bdf8', 0, 9, 1.4);
  poolLight.position.set(29.5, 1, 4.2);
  g.add(poolLight);
  lamps.push({ light: poolLight, bulbMat: null, power: 12 });
  spot('resort', { x: 27.9, z: 5.2, rot: 0.3, action: 'float', out: { x: 27.9, z: 7.2 } });
  spot('resort', { x: 31.2, z: 5.1, rot: -0.4, action: 'float', out: { x: 31.2, z: 7.2 } });
  spot('resort', { x: 29.5, z: 2.9, rot: Math.PI / 2, action: 'swim', out: { x: 29.5, z: 7.2 } });
  const towel = ['#38bdf8', '#f8fafc', '#34d399'];
  [27, 29.5, 32].forEach((x, i) => {
    box(g, 0.9, 0.35, 2.2, '#1e293b', x, 0.12, 9.45);
    box(g, 0.85, 0.06, 1.5, towel[i], x, 0.47, 9.75);
    const back = box(g, 0.85, 0.08, 0.8, towel[i], x, 0.62, 8.62);
    back.rotation.x = -0.45;
    spot('resort', { x, z: 9.95, rot: 0, action: 'sun', lie: true, lieY: 0.93, out: { x, z: 7.6 } });
  });
  for (const x of [28.25, 30.75]) {
    cyl(g, 0.03, 0.03, 2.2, 5, alumMat, x, 0.12, 9.0);
    add(g, new THREE.ConeGeometry(0.85, 0.38, 8), x < 29 ? '#f8fafc' : '#334155', x, 2.4, 9.0);
  }
  ball(g, 0.25, '#38bdf8', 34, 0.37, 7.8, 1);
  palm(24.6, 1.6, 1.05);
  palm(34.6, 1.4, 0.95);
  palm(34.5, 11.2, 1);
  palm(24.3, 11.4, 0.9);

  function tick(t, dt) {
    codeTex.offset.y -= dt * 0.06;
    for (const m of leds) if (Math.random() < dt * 3) m.emissiveIntensity = Math.random() < 0.3 ? 0.15 : 1.6;
    for (const s of zones.desk.spots) {
      const matNow = s.active ? s.screenOn : s.screenOff;
      s.screen.material = matNow;
      if (s.sideScreen) s.sideScreen.material = matNow;
    }
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 30) c.position.x = -30;
    }
    water.position.y = 0.01 + Math.sin(t * 1.5) * 0.01;
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
    for (const m of accentStrips) {
      m.emissiveIntensity = 0.45 + night * 1.3;
    }
  }

  return { zones, tick, setNight };
}
