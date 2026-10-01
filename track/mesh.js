

const PALETTES = {
  winton: {
    asphalt: [107, 106, 102], line: [236, 234, 226], vergeIn: [176, 164, 96], vergeOut: [196, 180, 112],
    terrain: [200, 184, 118], terrainFar: [186, 172, 108], gravel: [222, 205, 165], sealed: [168, 168, 164],
    wall: [188, 188, 182], kerbRed: [196, 40, 36], kerbWhite: [238, 238, 232], hills: 0.5,
  },
  wakefield: {
    asphalt: [107, 106, 102], line: [236, 234, 226], vergeIn: [104, 124, 70], vergeOut: [116, 136, 78],
    terrain: [122, 140, 84], terrainFar: [108, 126, 76], gravel: [214, 200, 160], sealed: [168, 168, 164],
    wall: [188, 188, 182], kerbRed: [196, 40, 36], kerbWhite: [238, 238, 232], hills: 3.0,
  },
};

const LINE_W = 0.15;
const VERGE_W = 12;
const KERB_BLOCK = 1.0;
const WALL_H = 1.0;
const TERRAIN_R = 1200;
const TERRAIN_CELL = 25;
const Z_VERGE = -0.03, Z_RUNOFF = -0.02, Z_KERB = 0.02, Z_TERRAIN_CLEAR = 0.25;

class Builder {
  constructor(name, material, withUv) {
    this.name = name; this.material = material; this.withUv = withUv;
    this.p = []; this.n = []; this.c = []; this.uv = []; this.idx = [];
  }
  v(x, y, z, nx, ny, nz, col, u = 0, w = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]);
    if (this.withUv) this.uv.push(u, w);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  done() {
    const count = this.p.length / 3;
    const Idx = count < 65536 ? Uint16Array : Uint32Array;
    return {
      name: this.name,
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      colors: new Uint8Array(this.c),
      uvs: this.withUv ? new Float32Array(this.uv) : null,
      indices: new Idx(this.idx),
      material: this.material,
    };
  }
}

function prep(d) {
  const cl = d.centreline;
  const n = cl.length;
  const L = d.lapLength;
  const DS = new Float64Array(n), G = new Float64Array(n);
  for (let i = 0; i < n; i++) DS[i] = i === n - 1 ? L - cl[i].s : cl[i + 1].s - cl[i].s;
  const segG = new Float64Array(n);
  for (let i = 0; i < n; i++) segG[i] = (cl[(i + 1) % n].z - cl[i].z) / DS[i];
  for (let i = 0; i < n; i++) G[i] = 0.5 * (segG[i] + segG[(i - 1 + n) % n]);
  const spacing = d.sampleSpacing || 5;

  const KH = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let dh = cl[(i + 1) % n].heading - cl[i].heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh <= -Math.PI) dh += 2 * Math.PI;
    KH[i] = Math.max(Math.abs(cl[i].curvature), Math.abs(dh / DS[i]));
  }
  const KW = new Float64Array(n);
  const w = Math.max(1, Math.round(20 / spacing));
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let q = -w; q <= w; q++) m = Math.max(m, KH[(i + q + n) % n]);
    KW[i] = cl[i].curvature >= 0 ? m : -m;
  }
  const wrapAng = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };

  function at(s) {
    s = ((s % L) + L) % L;
    let i = Math.min(n - 1, Math.floor(s / spacing));
    while (i > 0 && cl[i].s > s) i--;
    while (i < n - 1 && cl[i + 1].s <= s) i++;
    const j = (i + 1) % n;
    const t = (s - cl[i].s) / DS[i];
    const h = cl[i].heading + t * wrapAng(cl[j].heading - cl[i].heading);
    return {
      x: cl[i].x + t * (cl[j].x - cl[i].x), y: cl[i].y + t * (cl[j].y - cl[i].y), z: cl[i].z + t * (cl[j].z - cl[i].z),
      h, k: KW[i] + t * (KW[j] - KW[i]), g: G[i] + t * (G[j] - G[i]),
      wL: cl[i].widthL + t * (cl[j].widthL - cl[i].widthL), wR: cl[i].widthR + t * (cl[j].widthR - cl[i].widthR),
    };
  }
  return { cl, n, L, G, at };
}

function clampO(o, k) {
  if (k > 1e-6 && o > 0) return Math.min(o, 0.7 / k);
  if (k < -1e-6 && o < 0) return Math.max(o, -0.7 / -k);
  return o;
}

function groundNormal(g, h) {
  const tx = Math.cos(h), ty = Math.sin(h);
  const inv = 1 / Math.sqrt(1 + g * g);
  return [-g * tx * inv, -g * ty * inv, inv];
}

function place(f, o, dz = 0) {
  const oc = clampO(o, f.k);
  return [f.x - oc * Math.sin(f.h), f.y + oc * Math.cos(f.h), f.z + dz];
}

function strip(b, rows, cols, closed, dz, vFn) {
  const base = [];
  for (let r = 0; r < rows.length; r++) {
    const f = rows[r];
    const nrm = groundNormal(f.g, f.h);
    const ids = [];
    for (const c of cols) {
      const [x, y, z] = place(f, c.o(f), dz);
      ids.push(b.v(x, y, z, nrm[0], nrm[1], nrm[2], c.col, c.u ? c.u(f) : 0, vFn ? vFn(f) : 0));
    }
    base.push(ids);
  }
  const last = closed ? rows.length : rows.length - 1;
  for (let r = 0; r < last; r++) {
    const A = base[r], B = base[(r + 1) % rows.length];
    for (let c = 0; c + 1 < cols.length; c++) {
      if (cols[c].skip) continue;

      b.quad(A[c + 1], B[c + 1], B[c], A[c]);
    }
  }
}

function buildRibbon(T, pal) {
  const b = new Builder('ribbon', 'asphalt', true);
  const rows = [];
  for (let i = 0; i < T.n; i++) { const f = T.at(T.cl[i].s); f.s = T.cl[i].s; rows.push(f); }
  const u = (o) => (f) => o(f) / 4;
  const oL = (f) => f.wL, oL2 = (f) => f.wL - LINE_W, oR2 = (f) => -(f.wR - LINE_W), oR = (f) => -f.wR;
  strip(b, rows, [
    { o: oL, col: pal.line, u: u(oL) }, { o: oL2, col: pal.line, u: u(oL2), skip: true },
    { o: oL2, col: pal.asphalt, u: u(oL2) }, { o: oR2, col: pal.asphalt, u: u(oR2), skip: true },
    { o: oR2, col: pal.line, u: u(oR2) }, { o: oR, col: pal.line, u: u(oR) },
  ], true, 0, (f) => f.s / 4);
  return b.done();
}

function buildVerge(T, pal) {
  const b = new Builder('verge', 'lambertVertex', false);
  const rows = [];
  for (let i = 0; i < T.n; i++) rows.push(T.at(T.cl[i].s));
  strip(b, rows, [{ o: (f) => f.wL + VERGE_W, col: pal.vergeOut }, { o: (f) => f.wL, col: pal.vergeIn }], true, Z_VERGE);
  strip(b, rows, [{ o: (f) => -f.wR, col: pal.vergeIn }, { o: (f) => -(f.wR + VERGE_W), col: pal.vergeOut }], true, Z_VERGE);
  return b.done();
}

const fwdLen = (a, b, L) => { const d = (b - a) % L; return d < 0 ? d + L : d; };

function buildKerbs(T, d, pal) {
  const b = new Builder('kerbs', 'kerb', true);
  const kw = Number.isFinite(d.kerbWidth) ? d.kerbWidth : 1.0;
  for (const k of d.kerbs) {
    const left = (k.edge || k.side) === 'left';
    const len = fwdLen(k.s0, k.s1, T.L);
    const m = Math.max(1, Math.round(len / KERB_BLOCK));
    for (let q = 0; q < m; q++) {
      const f0 = T.at(k.s0 + (len * q) / m), f1 = T.at(k.s0 + (len * (q + 1)) / m);
      const col = q % 2 === 0 ? pal.kerbRed : pal.kerbWhite;
      const oo0 = left ? f0.wL : -f0.wR, oi0 = left ? f0.wL - kw : -(f0.wR - kw);
      const oo1 = left ? f1.wL : -f1.wR, oi1 = left ? f1.wL - kw : -(f1.wR - kw);
      const n0 = groundNormal(f0.g, f0.h), n1 = groundNormal(f1.g, f1.h);

      const [aL, aR] = left ? [oo0, oi0] : [oi0, oo0];
      const [bL, bR] = left ? [oo1, oi1] : [oi1, oo1];
      const pAL = place(f0, aL, Z_KERB), pAR = place(f0, aR, Z_KERB), pBL = place(f1, bL, Z_KERB), pBR = place(f1, bR, Z_KERB);
      const iAL = b.v(...pAL, ...n0, col, 0, 0), iAR = b.v(...pAR, ...n0, col, 1, 0);
      const iBL = b.v(...pBL, ...n1, col, 0, 1), iBR = b.v(...pBR, ...n1, col, 1, 1);
      b.quad(iAR, iBR, iBL, iAL);
    }
  }
  return b.done();
}

function buildRunoff(T, d, pal) {
  const b = new Builder('runoff', 'lambertVertex', false);
  for (const r of d.surfaces) {
    const col = r.surface === 'gravel' ? pal.gravel : pal.sealed;
    const depth = Number.isFinite(r.depth) ? r.depth : 20;
    const len = fwdLen(r.s0, r.s1, T.L);
    const m = Math.max(1, Math.round(len / 5));
    const rows = [];
    for (let q = 0; q <= m; q++) rows.push(T.at(r.s0 + (len * q) / m));
    const sides = r.side === 'left' ? ['left'] : r.side === 'right' ? ['right'] : ['left', 'right'];
    for (const sd of sides) {
      if (sd === 'left') strip(b, rows, [{ o: (f) => f.wL + depth, col }, { o: (f) => f.wL + 0.3, col }], false, Z_RUNOFF);
      else strip(b, rows, [{ o: (f) => -(f.wR + 0.3), col }, { o: (f) => -(f.wR + depth), col }], false, Z_RUNOFF);
    }
  }
  return b.done();
}

function buildBarriers(T, d, pal) {
  const b = new Builder('barriers', 'lambertVertex', false);
  for (const w of d.barriers) {
    const zBase = Number.isFinite(w.s) ? T.at(w.s).z : 0;
    const flip = w.drivable === 'right';
    for (let q = 0; q + 1 < w.polyline.length; q++) {
      const [x0, y0] = w.polyline[q], [x1, y1] = w.polyline[q + 1];
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      let nx = -dy / len, ny = dx / len;
      if (flip) { nx = -nx; ny = -ny; }
      const z0 = zBase - 0.2, z1 = zBase + WALL_H;

      const a = b.v(x0, y0, z0, nx, ny, 0, pal.wall), c = b.v(x1, y1, z0, nx, ny, 0, pal.wall);
      const e = b.v(x1, y1, z1, nx, ny, 0, pal.wall), g = b.v(x0, y0, z1, nx, ny, 0, pal.wall);
      if (flip) b.quad(a, c, e, g); else b.quad(c, a, g, e);

      const a2 = b.v(x0, y0, z0, -nx, -ny, 0, pal.wall), c2 = b.v(x1, y1, z0, -nx, -ny, 0, pal.wall);
      const e2 = b.v(x1, y1, z1, -nx, -ny, 0, pal.wall), g2 = b.v(x0, y0, z1, -nx, -ny, 0, pal.wall);
      if (flip) b.quad(c2, a2, g2, e2); else b.quad(a2, c2, e2, g2);
    }
  }
  return b.done();
}

function valueNoise(x, y, cell) {
  const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1; };
  const fx = x / cell, fy = y / cell;
  const i = Math.floor(fx), j = Math.floor(fy);
  const tx = fx - i, ty = fy - j;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), e = hash(i + 1, j + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
}

function buildTerrain(T, d, pal) {
  const b = new Builder('terrain', 'lambertVertex', false);
  const cl = T.cl;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, zMean = 0;
  for (const p of cl) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); zMean += p.z; }
  zMean /= cl.length;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const N = Math.ceil(TERRAIN_R / TERRAIN_CELL);
  const side = 2 * N + 1;
  const id = new Int32Array(side * side).fill(-1);
  const hz = new Float64Array(side * side);

  const B = 60;
  const buckets = new Map();
  const bkey = (bi, bj) => (bi + 10000) * 20000 + (bj + 10000);
  cl.forEach((p, i) => { const key = bkey(Math.floor(p.x / B), Math.floor(p.y / B)); if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(i); });
  const nearInfo = (x, y) => {
    const bi = Math.floor(x / B), bj = Math.floor(y / B);
    let dMin = Infinity, zMin = Infinity, wsum = 0, zsum = 0;
    for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) {
      const lst = buckets.get(bkey(bi + di, bj + dj));
      if (!lst) continue;
      for (const i of lst) {
        const dd = Math.hypot(cl[i].x - x, cl[i].y - y);
        if (dd < dMin) dMin = dd;
        if (dd < 45) zMin = Math.min(zMin, cl[i].z);
        if (dd < 180) { const w = 1 / (dd * dd + 100); wsum += w; zsum += w * cl[i].z; }
      }
    }
    return { dMin, zMin, zIdw: wsum > 0 ? zsum / wsum : null };
  };
  const rgb = (a, c, t) => [Math.round(a[0] + (c[0] - a[0]) * t), Math.round(a[1] + (c[1] - a[1]) * t), Math.round(a[2] + (c[2] - a[2]) * t)];
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const x = cx + (i - N) * TERRAIN_CELL, y = cy + (j - N) * TERRAIN_CELL;
      if (Math.hypot(x - cx, y - cy) > TERRAIN_R + TERRAIN_CELL * 1.5) continue;
      const q = nearInfo(x, y);
      const far = Math.min(1, Math.max(0, (q.dMin - 60) / 240));
      let z = q.zIdw === null ? zMean : q.zIdw * (1 - far) + zMean * far;
      z += pal.hills * far * valueNoise(x + 1000, y - 2000, 220);
      if (q.zMin < Infinity) z = Math.min(z, q.zMin - Z_TERRAIN_CLEAR);
      hz[j * side + i] = z;
      const col = rgb(pal.terrain, pal.terrainFar, Math.min(1, q.dMin / 600));
      id[j * side + i] = b.v(x, y, z, 0, 0, 1, col);
    }
  }
  const acc = new Float64Array(b.p.length);
  const faces = [];
  for (let j = 0; j + 1 < side; j++) {
    for (let i = 0; i + 1 < side; i++) {
      const a = id[j * side + i], c = id[j * side + i + 1], e = id[(j + 1) * side + i + 1], g = id[(j + 1) * side + i];
      if (a < 0 || c < 0 || e < 0 || g < 0) continue;
      faces.push([a, c, e], [a, e, g]);
    }
  }
  for (const [a, c, e] of faces) {
    b.tri(a, c, e);
    const ax = b.p[3 * a], ay = b.p[3 * a + 1], az = b.p[3 * a + 2];
    const ux = b.p[3 * c] - ax, uy = b.p[3 * c + 1] - ay, uz = b.p[3 * c + 2] - az;
    const vx = b.p[3 * e] - ax, vy = b.p[3 * e + 1] - ay, vz = b.p[3 * e + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, c, e]) { acc[3 * k] += nx; acc[3 * k + 1] += ny; acc[3 * k + 2] += nz; }
  }
  for (let k = 0; k < acc.length / 3; k++) {
    const l = Math.hypot(acc[3 * k], acc[3 * k + 1], acc[3 * k + 2]) || 1;
    b.n[3 * k] = acc[3 * k] / l; b.n[3 * k + 1] = acc[3 * k + 1] / l; b.n[3 * k + 2] = acc[3 * k + 2] / l;
  }
  return b.done();
}

export function buildTrackMeshes(trackData) {
  const T = prep(trackData);
  const pal = PALETTES[trackData.palette] || PALETTES.winton;
  return [
    buildRibbon(T, pal),
    buildVerge(T, pal),
    buildKerbs(T, trackData, pal),
    buildTerrain(T, trackData, pal),
    buildRunoff(T, trackData, pal),
    buildBarriers(T, trackData, pal),
  ];
}

export function meshStats(meshes) {
  let tris = 0, verts = 0;
  for (const m of meshes) { tris += m.indices.length / 3; verts += m.positions.length / 3; }
  return { meshes: meshes.length, triangles: tris, vertices: verts };
}
