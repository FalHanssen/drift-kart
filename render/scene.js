

import * as THREE from '../vendor/three/three.module.min.js';
import { KART_EULER_ORDER, bodyToWorld } from './kartPose.js';

export const LOOK = Object.freeze({
  sky: 0xc9d8e6, fogNear: 180, fogFar: 600,
  grass: 0x9aa56b, asphalt: 0x6b6a66, grid: 0x807f7a, paint: 0xefefe9,
  cone: 0xff6b1a, tree: 0x3e5b3a, shed: 0x9fb0bf,
  frame: 0x8e9398, pod: 0x2f3338, seat: 0xb22a22, suit: 0x27406b, helmet: 0xf3f3f0, tyre: 0x1e1e1e, mark: 0xf0d000,
});

const TWO_PI = 2 * Math.PI;

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function zUpCone(radius, height, segments) {
  const g = new THREE.ConeGeometry(radius, height, segments);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, height / 2);
  return g;
}

function buildPad(scene, { padHalf, circles, coneInset }) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), lambert(LOOK.grass));
  ground.position.z = -0.03;
  scene.add(ground);

  const pad = new THREE.Mesh(new THREE.PlaneGeometry(2 * padHalf, 2 * padHalf), lambert(LOOK.asphalt));
  scene.add(pad);

  const pts = [];
  for (let v = -padHalf; v <= padHalf + 1e-6; v += 10) {
    pts.push(v, -padHalf, 0.01, v, padHalf, 0.01, -padHalf, v, 0.01, padHalf, v, 0.01);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: LOOK.grid })));

  const paint = lambert(LOOK.paint);
  for (const R of circles) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.15, R + 0.15, Math.max(96, Math.round(R * 10))), paint);
    ring.position.z = 0.015;
    scene.add(ring);
  }

  const rings = circles.map((R) => {
    const r = R - coneInset;
    return { r, n: Math.max(12, Math.round((TWO_PI * r) / 3)) };
  });
  const total = rings.reduce((s, q) => s + q.n, 0);
  const cones = new THREE.InstancedMesh(zUpCone(0.16, 0.46, 12), lambert(LOOK.cone), total);
  const m = new THREE.Matrix4();
  let k = 0;
  for (const { r, n } of rings) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TWO_PI;
      m.makeTranslation(r * Math.cos(a), r * Math.sin(a), 0);
      cones.setMatrixAt(k++, m);
    }
  }
  cones.instanceMatrix.needsUpdate = true;
  scene.add(cones);

  const treeCount = 22;
  const trees = new THREE.InstancedMesh(zUpCone(2.2, 7, 7), lambert(LOOK.tree), treeCount);
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < treeCount; i++) {
    const x = -84 + i * 8 + 2.5 * Math.sin(i * 2.3);
    const y = 82 + 3 * Math.sin(i * 1.7);
    const sc = 0.8 + 0.4 * (0.5 + 0.5 * Math.sin(i * 3.1));
    p.set(x, y, 0);
    s.set(sc, sc, sc);
    m.compose(p, q, s);
    trees.setMatrixAt(i, m);
  }
  trees.instanceMatrix.needsUpdate = true;
  scene.add(trees);

  const shed = new THREE.Mesh(new THREE.BoxGeometry(5, 10, 3.2), lambert(LOOK.shed));
  shed.position.set(-80, 28, 1.6);
  scene.add(shed);

  return { coneCount: total, treeCount };
}

function buildKart({ a, b, tf, tr, Rw, Rf }) {
  const kart = new THREE.Group();
  kart.rotation.order = KART_EULER_ORDER;
  const add = (geo, mat, x, y, z, parent = kart) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const frame = lambert(LOOK.frame), pod = lambert(LOOK.pod), seat = lambert(LOOK.seat);
  const suit = lambert(LOOK.suit), helmet = lambert(LOOK.helmet), tyre = lambert(LOOK.tyre), mark = lambert(LOOK.mark);

  add(new THREE.BoxGeometry(a + b + 0.3, 0.5, 0.05), frame, (a - b) / 2 + 0.05, 0, 0.07);
  add(new THREE.BoxGeometry(0.6, 0.16, 0.12), pod, -0.02, 0.42, 0.13);
  add(new THREE.BoxGeometry(0.6, 0.16, 0.12), pod, -0.02, -0.42, 0.13);
  add(new THREE.BoxGeometry(0.28, 0.72, 0.14), pod, a + 0.24, 0, 0.12);
  add(new THREE.BoxGeometry(0.08, 1.12, 0.07), frame, -b - 0.26, 0, 0.13);
  add(new THREE.CylinderGeometry(0.022, 0.022, tr + 0.1, 8), frame, -b, 0, Rw);
  add(new THREE.BoxGeometry(0.36, 0.38, 0.34), seat, -0.2, 0, 0.3);
  add(new THREE.BoxGeometry(0.26, 0.4, 0.44), suit, -0.2, 0, 0.62);

  const head = new THREE.Group();
  head.position.set(-0.16, 0, 0.95);
  kart.add(head);
  add(new THREE.SphereGeometry(0.15, 12, 8), helmet, 0, 0, 0, head);

  const wheelMesh = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 18), frame);
  wheelMesh.position.set(0.18, 0, 0.55);
  wheelMesh.rotation.order = 'YXZ';
  wheelMesh.rotation.x = Math.PI / 2 - 0.5;
  kart.add(wheelMesh);

  const wheels = {};
  const makeWheel = (name, x, y, R, w) => {
    const hub = new THREE.Group();
    hub.position.set(x, y, R);
    const spin = new THREE.Group();
    hub.add(spin);
    add(new THREE.CylinderGeometry(R, R, w, 14), tyre, 0, 0, 0, spin);
    add(new THREE.BoxGeometry(1.6 * R, w + 0.006, 0.035), mark, 0, 0, 0, spin);
    kart.add(hub);
    wheels[name] = { hub, spin, R };
  };
  makeWheel('fl', a, tf / 2, Rf, 0.13);
  makeWheel('fr', a, -tf / 2, Rf, 0.13);
  makeWheel('rl', -b, tr / 2, Rw, 0.19);
  makeWheel('rr', -b, -tr / 2, Rw, 0.19);

  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  blob.scale.set(1.25, 0.85, 1);
  blob.position.z = 0.02;
  blob.renderOrder = 1;
  kart.add(blob);

  return { group: kart, wheels, wheelMesh, head };
}

function placeKart(group, x, y, psi, ground) {
  if (ground) {
    group.position.set(x, y, ground.z);
    group.rotation.set(ground.rx, ground.ry, psi);
  } else {
    group.position.set(x, y, 0);
    group.rotation.set(0, 0, psi);
  }
}

export function buildWorld(geom) {
  const g = { Rf: 0.127, ...geom };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LOOK.sky);
  scene.fog = new THREE.Fog(LOOK.sky, LOOK.fogNear, LOOK.fogFar);

  const hemi = new THREE.HemisphereLight(0xdde8f2, 0x7a7358, 1.8);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  const el = (40 * Math.PI) / 180, az = (-135 * Math.PI) / 180;
  sun.position.set(Math.cos(el) * Math.cos(az) * 100, Math.cos(el) * Math.sin(az) * 100, Math.sin(el) * 100);
  scene.add(sun);

  const pad = buildPad(scene, g);
  const kart = buildKart(g);
  scene.add(kart.group);

  function setKart(x, y, psi, delta, spinFront, spinRear, helmetYaw = 0, ground = null) {
    placeKart(kart.group, x, y, psi, ground);
    const w = kart.wheels;
    w.fl.hub.rotation.z = delta;
    w.fr.hub.rotation.z = delta;
    w.fl.spin.rotation.y = spinFront;
    w.fr.spin.rotation.y = spinFront;
    w.rl.spin.rotation.y = spinRear;
    w.rr.spin.rotation.y = spinRear;
    kart.wheelMesh.rotation.z = delta;
    kart.head.rotation.z = helmetYaw;
  }

  return { scene, setKart, stats: pad, kart };
}

export function createRigView(canvas, geom) {
  const world = buildWorld(geom);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.2, 900);
  camera.up.set(0, 0, 1);
  let fov = 52;

  function resize(w, h) {
    if (!(w > 0 && h > 0)) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setCamera(pos, look, fovDeg) {
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(look[0], look[1], look[2]);
    if (Math.abs(fovDeg - fov) > 0.01) {
      fov = fovDeg;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function render() { renderer.render(world.scene, camera); }

  function info() {
    const r = renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, pixelRatio: renderer.getPixelRatio() };
  }

  return { resize, setKart: world.setKart, setCamera, render, info, canvas };
}

function zUpBox(w, d, h) {
  const g = new THREE.BoxGeometry(w, d, h);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, h / 2);
  return g;
}

function meshDataToObject(m, materials) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 3, true));
  if (m.uvs && m.uvs.length) geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  const mesh = new THREE.Mesh(geo, materials[m.material] || materials.lambertVertex);
  mesh.name = m.name;
  return mesh;
}

function groundMaterials() {
  const make = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return { lambertVertex: make(), asphalt: make(), kerb: make() };
}

const SCENERY_LOOK = Object.freeze({ building: 0x9fb0bf, dam: 0x8a7a5c });
function buildScenery(scene, trackData) {
  const items = trackData.scenery || [];
  const trees = items.filter((s) => s.type === 'tree' || s.type === 'treeRow');
  const buildings = items.filter((s) => s.type === 'building');
  const dams = items.filter((s) => s.type === 'dam');
  const place = (mesh, list, baseScale = 1) => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 0, 1);
    list.forEach((it, i) => {
      p.set(it.x, it.y, 0);
      q.setFromAxisAngle(axis, it.rot || 0);
      const sc = (it.scale || 1) * baseScale;
      s.set(sc, sc, sc);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  };
  const out = [];
  if (trees.length) { const mesh = new THREE.InstancedMesh(zUpCone(2.2, 7, 7), lambert(LOOK.tree), trees.length); place(mesh, trees); out.push(mesh); }
  if (buildings.length) { const mesh = new THREE.InstancedMesh(zUpBox(8, 10, 4), lambert(SCENERY_LOOK.building), buildings.length); place(mesh, buildings); out.push(mesh); }
  if (dams.length) { const mesh = new THREE.InstancedMesh(zUpBox(16, 10, 1.6), lambert(SCENERY_LOOK.dam), dams.length); place(mesh, dams); out.push(mesh); }
  return out;
}

function makeSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(230,230,225,0.9)');
  g.addColorStop(0.5, 'rgba(230,230,225,0.35)');
  g.addColorStop(1, 'rgba(230,230,225,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const SMOKE_POOL = 40, SMOKE_LIFE_S = 1.2, SMOKE_RISE = 0.6;
function createSmokeSystem(scene) {
  const tex = makeSmokeTexture();
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 1 });
  const sprites = [];
  for (let i = 0; i < SMOKE_POOL; i++) {
    const s = new THREE.Sprite(mat.clone());
    s.visible = false;
    s.scale.set(0.5, 0.5, 1);
    scene.add(s);
    sprites.push({ obj: s, age: Infinity, vx: 0, vy: 0 });
  }
  let next = 0;
  function spawn(x, y, z) {
    const p = sprites[next]; next = (next + 1) % SMOKE_POOL;
    p.age = 0; p.obj.visible = true; p.obj.position.set(x, y, z);
    p.obj.scale.set(0.4, 0.4, 1);
    p.obj.material.opacity = 0.5;
  }
  function update(dt) {
    for (const p of sprites) {
      if (p.age > SMOKE_LIFE_S) { p.obj.visible = false; continue; }
      p.age += dt;
      const t = p.age / SMOKE_LIFE_S;
      p.obj.position.z += SMOKE_RISE * dt;
      p.obj.scale.setScalar(0.4 + 0.8 * t);
      p.obj.material.opacity = 0.5 * (1 - t);
    }
  }
  return { spawn, update };
}

const SKID_SEGMENTS = 600;

const SKID_LIFT = 0.025;
function createSkidRibbon(scene, color = 0x1e1e1e) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(SKID_SEGMENTS * 4 * 3);
  const idx = new Uint32Array((SKID_SEGMENTS - 1) * 6);
  for (let i = 0; i < SKID_SEGMENTS - 1; i++) {
    const a0 = i * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
    idx.set([a0, a1, b1, a0, b1, b0], i * 6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }));
  mesh.renderOrder = 1;
  scene.add(mesh);
  let count = 0;
  function add(x, y, z, heading, halfWidth = 0.05) {
    const i = (count % SKID_SEGMENTS) * 2;
    const nx = -Math.sin(heading) * halfWidth, ny = Math.cos(heading) * halfWidth;
    const p = positions;
    p[i * 3] = x - nx; p[i * 3 + 1] = y - ny; p[i * 3 + 2] = z + SKID_LIFT;
    p[i * 3 + 3] = x + nx; p[i * 3 + 4] = y + ny; p[i * 3 + 5] = z + SKID_LIFT;
    count++;
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, Math.max(0, (Math.min(count, SKID_SEGMENTS) - 1) * 6));
  }
  return { add };
}

export function buildCircuitScene(trackData, meshes, geom) {
  const g = { Rf: 0.127, ...geom };
  const scene = new THREE.Scene();
  const palette = /wakefield/i.test(trackData.id || '') ? 0xb9c7d6 : 0xc9d8e6;
  scene.background = new THREE.Color(palette);
  scene.fog = new THREE.Fog(palette, LOOK.fogNear, LOOK.fogFar);

  const hemi = new THREE.HemisphereLight(0xdde8f2, 0x7a7358, 1.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  const el = (40 * Math.PI) / 180, az = (-135 * Math.PI) / 180;
  sun.position.set(Math.cos(el) * Math.cos(az) * 100, Math.cos(el) * Math.sin(az) * 100, Math.sin(el) * 100);
  scene.add(sun);

  const materials = groundMaterials();
  const trackObjects = meshes.map((m) => meshDataToObject(m, materials));
  for (const o of trackObjects) scene.add(o);
  buildScenery(scene, trackData);

  const kart = buildKart(g);
  scene.add(kart.group);
  const ghostKart = buildKart(g);
  for (const mesh of ghostKart.group.children) {
    if (mesh.material) { mesh.material = mesh.material.clone(); mesh.material.transparent = true; mesh.material.opacity = 0.25; }
  }
  ghostKart.group.visible = false;
  scene.add(ghostKart.group);

  const smoke = createSmokeSystem(scene);
  const skidL = createSkidRibbon(scene), skidR = createSkidRibbon(scene);

  function setKart(x, y, psi, delta, spinFront, spinRear, helmetYaw, ground = null) {
    placeKart(kart.group, x, y, psi, ground);
    const w = kart.wheels;
    w.fl.hub.rotation.z = delta; w.fr.hub.rotation.z = delta;
    w.fl.spin.rotation.y = spinFront; w.fr.spin.rotation.y = spinFront;
    w.rl.spin.rotation.y = spinRear; w.rr.spin.rotation.y = spinRear;
    kart.wheelMesh.rotation.z = delta;
    kart.head.rotation.z = helmetYaw || 0;
  }

  function setGhost(visible, x, y, psi, ground = null) {
    ghostKart.group.visible = visible;
    if (visible) placeKart(ghostKart.group, x, y, psi, ground);
  }

  const rearL = [0, 0, 0], rearR = [0, 0, 0];
  function updateEffects(dt, pose, slip, onGround) {
    smoke.update(dt);
    if (onGround && slip > 1.5) {
      bodyToWorld(pose, -g.b, g.tr / 2, 0, rearL);
      bodyToWorld(pose, -g.b, -g.tr / 2, 0, rearR);
      smoke.spawn(rearL[0], rearL[1], rearL[2] + 0.15);
      smoke.spawn(rearR[0], rearR[1], rearR[2] + 0.15);
      skidL.add(rearL[0], rearL[1], rearL[2], pose.psi);
      skidR.add(rearR[0], rearR[1], rearR[2], pose.psi);
    }
  }

  return { scene, setKart, setGhost, updateEffects, kart, trackObjectCount: trackObjects.length };
}

export function createGameView(canvas, trackData, meshes, geom) {
  const world = buildCircuitScene(trackData, meshes, geom);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.2, 1300);
  camera.up.set(0, 0, 1);
  let fov = 52;

  function resize(w, h) {
    if (!(w > 0 && h > 0)) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function setCamera(pos, look, fovDeg) {
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(look[0], look[1], look[2]);
    if (Math.abs(fovDeg - fov) > 0.01) { fov = fovDeg; camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  function render() { renderer.render(world.scene, camera); }
  function info() {
    const r = renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, pixelRatio: renderer.getPixelRatio() };
  }
  return { resize, setKart: world.setKart, setGhost: world.setGhost, updateEffects: world.updateEffects, setCamera, render, info, canvas, world };
}

export function createGarageView(canvas, geom) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d20);
  const hemi = new THREE.HemisphereLight(0xdde8f2, 0x303338, 2.0);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff3e0, 1.8);
  key.position.set(3, -4, 5);
  scene.add(key);

  const kart = buildKart({ Rf: 0.127, ...geom });
  scene.add(kart.group);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.up.set(0, 0, 1);
  let radius = 2.4, height = 0.6, angle = 0;

  function resize(w, h) {
    if (!(w > 0 && h > 0)) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function update(dt, autoSpinRevPerS = 0.05) {
    angle += autoSpinRevPerS * 2 * Math.PI * dt;
    camera.position.set(radius * Math.cos(angle), radius * Math.sin(angle), height);
    camera.lookAt(0, 0, 0.3);
  }
  function drag(deltaAngle) { angle += deltaAngle; }
  function zoom(deltaRadius) { radius = Math.min(4, Math.max(1.6, radius + deltaRadius)); }
  function setSteerAngle(delta) { kart.wheels.fl.hub.rotation.z = delta; kart.wheels.fr.hub.rotation.z = delta; }

  return { resize, tick: update, drag, zoom, setSteerAngle, render: () => renderer.render(scene, camera), canvas };
}
