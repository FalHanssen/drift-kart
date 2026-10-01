

import { TRACK_SCHEMA } from '../shared/versions.js';
import { SURFACES } from '../core/params.js';
import { buildSegmentGrid, gridCell } from './spatialIndex.js';

export const TRACK_FILES = Object.freeze({
  'winton.national': 'winton-national.json',
  'winton.club': 'winton-club.json',
  'wakefield.pre2022': 'wakefield.json',
});

const CELL = 15;
const CENTRE_REACH = 45;
const BARRIER_RANGE = 3.0;
const TWO_PI = Math.PI * 2;

const wrapAng = (a) => { while (a > Math.PI) a -= TWO_PI; while (a <= -Math.PI) a += TWO_PI; return a; };

export async function loadTrack(id, layout, { fetchFn = globalThis.fetch, base = new URL('../data/tracks/', import.meta.url) } = {}) {
  const file = TRACK_FILES[`${id}.${layout}`];
  if (!file) throw new Error(`unknown track ${id}.${layout}`);
  const res = await fetchFn(new URL(file, base));
  if (!res.ok) throw new Error(`track ${id}.${layout}: HTTP ${res.status}`);
  return createTrack(await res.json());
}

export async function loadSectors({ fetchFn = globalThis.fetch, url = new URL('../data/sectors.json', import.meta.url) } = {}) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`sectors: HTTP ${res.status}`);
  return res.json();
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export function projectLatLon(p, lat, lon) {
  return { x: (lon - p.lon0) * p.mPerDegLon, y: (lat - p.lat0) * p.mPerDegLat };
}
export function unprojectXY(p, x, y) {
  return { lat: p.lat0 + y / p.mPerDegLat, lon: p.lon0 + x / p.mPerDegLon };
}

export function validateTrackData(d) {
  const e = [];
  if (!d || typeof d !== 'object') return ['not an object'];
  if (d.schema !== TRACK_SCHEMA) e.push(`schema ${d.schema} does not match ${TRACK_SCHEMA}`);
  for (const k of ['id', 'layout', 'name']) if (typeof d[k] !== 'string' || !d[k]) e.push(`missing ${k}`);
  if (!finite(d.lapLength) || d.lapLength <= 0) e.push('bad lapLength');
  const cl = d.centreline;
  if (!Array.isArray(cl) || cl.length < 4) { e.push('centreline missing or too short'); return e; }
  let prev = -Infinity;
  for (let i = 0; i < cl.length; i++) {
    const p = cl[i];
    for (const k of ['s', 'x', 'y', 'z', 'heading', 'curvature', 'widthL', 'widthR']) {
      if (!p || !finite(p[k])) { e.push(`centreline[${i}].${k} not a finite number`); return e; }
    }
    if (p.s <= prev) { e.push(`centreline[${i}].s not increasing`); return e; }
    if (p.widthL <= 0 || p.widthR <= 0) { e.push(`centreline[${i}] non-positive width`); return e; }
    prev = p.s;
  }
  if (cl[0].s !== 0) e.push('centreline does not start at s 0');
  if (prev >= d.lapLength) e.push('centreline runs past lapLength');
  for (const k of ['surfaces', 'kerbs', 'barriers']) if (!Array.isArray(d[k])) e.push(`missing ${k}`);
  if (!d.startFinish || !finite(d.startFinish.heading)) e.push('missing startFinish');
  for (const r of d.surfaces || []) if (!SURFACES[r.surface] || !finite(r.s0) || !finite(r.s1)) { e.push('bad surface range'); break; }
  for (const b of d.barriers || []) if (!Array.isArray(b.polyline) || b.polyline.length < 2) { e.push('bad barrier'); break; }
  return e;
}

export function createTrack(data) {
  const problems = validateTrackData(data);
  if (problems.length) throw new Error(`track rejected: ${problems.join('; ')}`);
  const cl = data.centreline;
  const n = cl.length;
  const L = data.lapLength;
  const S = new Float64Array(n), X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  const H = new Float64Array(n), WL = new Float64Array(n), WR = new Float64Array(n);
  for (let i = 0; i < n; i++) { const p = cl[i]; S[i] = p.s; X[i] = p.x; Y[i] = p.y; Z[i] = p.z; H[i] = p.heading; WL[i] = p.widthL; WR[i] = p.widthR; }

  const ax = new Float64Array(n), ay = new Float64Array(n), bx = new Float64Array(n), by = new Float64Array(n);
  const TX = new Float64Array(n), TY = new Float64Array(n), LEN = new Float64Array(n), INV2 = new Float64Array(n);
  const SEGG = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ax[i] = X[i]; ay[i] = Y[i]; bx[i] = X[j]; by[i] = Y[j];
    const dx = X[j] - X[i], dy = Y[j] - Y[i];
    const len = Math.hypot(dx, dy) || 1e-9;
    LEN[i] = len; TX[i] = dx / len; TY[i] = dy / len; INV2[i] = 1 / (len * len);
    const ds = i === n - 1 ? L - S[i] : S[j] - S[i];
    SEGG[i] = (Z[j] - Z[i]) / ds;
  }

  const G = new Float64Array(n);
  for (let i = 0; i < n; i++) G[i] = 0.5 * (SEGG[i] + SEGG[(i - 1 + n) % n]);

  const HX = new Float64Array(n), HY = new Float64Array(n);
  for (let i = 0; i < n; i++) { HX[i] = Math.cos(H[i]); HY[i] = Math.sin(H[i]); }
  const DS = new Float64Array(n);
  for (let i = 0; i < n; i++) DS[i] = i === n - 1 ? L - S[i] : S[i + 1] - S[i];
  const maxHalf = Math.max(...WL, ...WR);
  const grid = buildSegmentGrid(ax, ay, bx, by, n, { cell: CELL, reach: maxHalf + CENTRE_REACH, pad: 5 });

  const kerbWidth = finite(data.kerbWidth) ? data.kerbWidth : 1.0;
  const segOf = (s) => Math.min(n - 1, Math.max(0, Math.floor(((s % L) + L) % L / (data.sampleSpacing || 5))));
  const kerbL = Array.from({ length: n }, () => []), kerbR = Array.from({ length: n }, () => []);
  const offL = Array.from({ length: n }, () => []), offR = Array.from({ length: n }, () => []);
  const spanFwd = (a, b) => { const d = (b - a) % L; return d < 0 ? d + L : d; };
  const addRange = (lists, r) => {
    const len = spanFwd(r.s0, r.s1);
    const i0 = segOf(r.s0);
    const steps = Math.ceil(len / (data.sampleSpacing || 5)) + 1;
    for (let q = 0; q <= steps && q < n; q++) lists[(i0 + q) % n].push(r);
  };
  for (const k of data.kerbs) {
    const edge = k.edge || k.side;
    const r = { s0: k.s0, s1: k.s1, len: spanFwd(k.s0, k.s1) };
    if (edge === 'left') addRange(kerbL, r); else if (edge === 'right') addRange(kerbR, r);
  }
  for (const f of data.surfaces) {
    const r = { s0: f.s0, s1: f.s1, len: spanFwd(f.s0, f.s1), key: f.surface, depth: finite(f.depth) ? f.depth : Infinity };
    if (f.side === 'left') addRange(offL, r); else if (f.side === 'right') addRange(offR, r);
    else { addRange(offL, r); addRange(offR, r); }
  }
  const inRange = (r, s) => spanFwd(r.s0, s) <= r.len;

  const bar = [];
  for (const b of data.barriers) {
    const flip = b.drivable === 'right';
    for (let q = 0; q + 1 < b.polyline.length; q++) {
      const [x0, y0] = b.polyline[q], [x1, y1] = b.polyline[q + 1];
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      let nx = -dy / len, ny = dx / len;
      if (flip) { nx = -nx; ny = -ny; }
      bar.push({ x0, y0, x1, y1, nx, ny, len });
    }
  }
  const nb = bar.length;
  const BX0 = new Float64Array(nb), BY0 = new Float64Array(nb), BX1 = new Float64Array(nb), BY1 = new Float64Array(nb);
  const BNX = new Float64Array(nb), BNY = new Float64Array(nb), BINV2 = new Float64Array(nb);
  bar.forEach((b, i) => { BX0[i] = b.x0; BY0[i] = b.y0; BX1[i] = b.x1; BY1[i] = b.y1; BNX[i] = b.nx; BNY[i] = b.ny; BINV2[i] = 1 / (b.len * b.len); });
  const bgrid = buildSegmentGrid(BX0, BY0, BX1, BY1, nb, { cell: CELL, reach: BARRIER_RANGE + 0.5 });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minY = Math.min(minY, Y[i]); maxY = Math.max(maxY, Y[i]); }

  const near = { i: 0, t: 0, d2: 0, o: 0, s: 0 };
  let sBest = -1, sT = 0, sD2 = Infinity, hBest = -1, hT = 0, hD2 = Infinity;
  function scanSeg(i, x, y, hintS) {
    const px = x - ax[i], py = y - ay[i];
    const ex = bx[i] - ax[i], ey = by[i] - ay[i];
    let t = (px * ex + py * ey) * INV2[i];
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const cx = ax[i] + t * ex - x, cy = ay[i] + t * ey - y;
    const d2 = cx * cx + cy * cy;
    if (d2 < sD2) { sD2 = d2; sBest = i; sT = t; }
    if (hintS === hintS && hintS !== undefined) {
      let dd = Math.abs(S[i] + t * DS[i] - hintS) % L;
      if (dd > L / 2) dd = L - dd;
      if (dd < 60 && d2 < hD2) { hD2 = d2; hBest = i; hT = t; }
    }
  }
  function nearestInto(x, y, hintS) {
    const h = typeof hintS === 'number' && Number.isFinite(hintS) ? hintS : undefined;
    sBest = -1; sD2 = Infinity; hBest = -1; hD2 = Infinity;
    const c = gridCell(grid, x, y);
    if (c >= 0) for (let k = grid.start[c]; k < grid.start[c + 1]; k++) scanSeg(grid.items[k], x, y, h);
    const r = grid.reach;
    if (sBest < 0 || sD2 >= r * r) {
      sBest = -1; sD2 = Infinity; hBest = -1; hD2 = Infinity;
      for (let i = 0; i < n; i++) scanSeg(i, x, y, h);
    }
    let i = sBest, t = sT, d2 = sD2;
    if (h !== undefined && hBest >= 0 && Math.sqrt(hD2) < Math.sqrt(sD2) + 8) { i = hBest; t = hT; d2 = hD2; }
    const d = Math.sqrt(d2);
    const cross = TX[i] * (y - ay[i]) - TY[i] * (x - ax[i]);
    near.i = i; near.t = t; near.d2 = d2;
    near.o = cross >= 0 ? d : -d;
    near.s = S[i] + t * DS[i];
    if (near.s >= L) near.s -= L;
    return near;
  }

  const res = { z: 0, normal: [0, 0, 1], surface: 'asphalt', muScale: 1, rollingResistance: 0.015, barrier: null };
  const bres = { dist: 0, nx: 0, ny: 0 };
  const setSurface = (key) => { const q = SURFACES[key]; res.surface = key; res.muScale = q.muScale; res.rollingResistance = q.rollingResistance; };

  function surfaceAt(i, t, s, o) {
    const j = (i + 1) % n;
    const left = o >= 0;
    const edge = left ? WL[i] + t * (WL[j] - WL[i]) : WR[i] + t * (WR[j] - WR[i]);
    const ao = o >= 0 ? o : -o;
    if (ao <= edge) {
      if (ao > edge - kerbWidth) {
        const lst = left ? kerbL[i] : kerbR[i];
        for (let k = 0; k < lst.length; k++) if (inRange(lst[k], s)) return 'kerb';
      }
      return 'asphalt';
    }
    const lst = left ? offL[i] : offR[i];
    for (let k = 0; k < lst.length; k++) { const r = lst[k]; if (ao - edge <= r.depth && inRange(r, s)) return r.key; }
    return 'grass';
  }

  function barrierAt(x, y) {
    const c = gridCell(bgrid, x, y);
    if (c < 0) return null;
    let bestAbs = Infinity, found = false;
    for (let k = bgrid.start[c]; k < bgrid.start[c + 1]; k++) {
      const i = bgrid.items[k];
      const ex = BX1[i] - BX0[i], ey = BY1[i] - BY0[i];
      const px = x - BX0[i], py = y - BY0[i];
      let t = (px * ex + py * ey) * BINV2[i];
      let signed;
      if (t > 0 && t < 1) signed = px * BNX[i] + py * BNY[i];
      else {
        t = t <= 0 ? 0 : 1;
        const qx = x - (BX0[i] + t * ex), qy = y - (BY0[i] + t * ey);
        const d = Math.hypot(qx, qy);
        signed = (qx * BNX[i] + qy * BNY[i]) >= 0 ? d : -d;
      }
      const a = signed >= 0 ? signed : -signed;
      if (a < BARRIER_RANGE && a < bestAbs) { bestAbs = a; found = true; bres.dist = signed; bres.nx = BNX[i]; bres.ny = BNY[i]; }
    }
    return found ? bres : null;
  }

  const track = {
    id: data.id,
    layout: data.layout,
    key: `${data.id}.${data.layout}`,
    name: data.name,
    layoutName: data.layoutName,
    label: data.label || `${data.name} ${data.layoutName || ''}`.trim(),
    lapLength: L,
    data,
    bounds: { minX, minY, maxX, maxY },
    startFinish: data.startFinish,
    index: { cells: grid.nx * grid.ny, maxPerCell: grid.maxPerCell, barrierSegments: nb },

    query(x, y) {
      const q = nearestInto(x, y);
      const i = q.i, t = q.t, j = (i + 1) % n;
      res.z = Z[i] + t * (Z[j] - Z[i]);

      const g = G[i] + t * (G[j] - G[i]);
      let hx = HX[i] + t * (HX[j] - HX[i]), hy = HY[i] + t * (HY[j] - HY[i]);
      const hl = Math.sqrt(hx * hx + hy * hy) || 1;
      hx /= hl; hy /= hl;
      const inv = 1 / Math.sqrt(1 + g * g);
      res.normal[0] = -g * hx * inv; res.normal[1] = -g * hy * inv; res.normal[2] = inv;
      setSurface(surfaceAt(i, t, q.s, q.o));
      res.barrier = nb ? barrierAt(x, y) : null;
      return res;
    },

    progress(x, y, hintS) {
      const q = nearestInto(x, y, hintS);
      const j = (q.i + 1) % n;
      const edge = q.o >= 0 ? WL[q.i] + q.t * (WL[j] - WL[q.i]) : WR[q.i] + q.t * (WR[j] - WR[q.i]);
      return { s: q.s, o: q.o, onTrack: Math.abs(q.o) <= edge };
    },

    poseAt(s, lateralOffset = 0) {
      s = ((s % L) + L) % L;
      let i = Math.min(n - 1, Math.floor(s / (data.sampleSpacing || 5)));
      while (i > 0 && S[i] > s) i--;
      while (i < n - 1 && S[i + 1] <= s) i++;
      const j = (i + 1) % n;
      const t = (s - S[i]) / DS[i];
      const h = wrapAng(H[i] + t * wrapAng(H[j] - H[i]));
      const x = X[i] + t * (X[j] - X[i]) - lateralOffset * Math.sin(h);
      const y = Y[i] + t * (Y[j] - Y[i]) + lateralOffset * Math.cos(h);
      return { x, y, z: Z[i] + t * (Z[j] - Z[i]), heading: h };
    },

    nearestCentreline(x, y) {
      const q = nearestInto(x, y);
      const p = track.poseAt(q.s, 0);
      return { s: q.s, x: p.x, y: p.y, heading: p.heading };
    },

    crossedLine(prevS, currS, lineS) {
      let d = (currS - prevS) % L;
      if (d < 0) d += L;
      if (d === 0 || d > L / 2) return null;
      let a = (lineS - prevS) % L;
      if (a < 0) a += L;
      if (a === 0 || a > d) return null;
      return a / d;
    },
  };
  return track;
}
