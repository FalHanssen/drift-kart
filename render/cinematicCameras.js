

const TWO_PI = Math.PI * 2;
const wrapAng = (a) => { while (a > Math.PI) a -= TWO_PI; while (a <= -Math.PI) a += TWO_PI; return a; };
const fwdLen = (a, b, L) => { const d = (b - a) % L; return d < 0 ? d + L : d; };

export const CAM = Object.freeze({
  curvatureThresh: 1 / 40,
  mergeDist: 60,
  cornerOutM: 8,
  cornerUpM: 2.5,
  straightSpacingM: 150,
  straightOutM: 6,
  straightUpM: 1.8,
  triggerAheadM: 40,
});

function sampleAt(cl, lapLength, spacing, s) {
  const n = cl.length;
  s = ((s % lapLength) + lapLength) % lapLength;
  let i = Math.min(n - 1, Math.floor(s / spacing));
  while (i > 0 && cl[i].s > s) i--;
  while (i < n - 1 && cl[i + 1].s <= s) i++;
  const j = (i + 1) % n;
  const ds = i === n - 1 ? lapLength - cl[i].s : cl[j].s - cl[i].s;
  const t = ds > 0 ? (s - cl[i].s) / ds : 0;
  const h = cl[i].heading + t * wrapAng(cl[j].heading - cl[i].heading);
  return {
    x: cl[i].x + t * (cl[j].x - cl[i].x), y: cl[i].y + t * (cl[j].y - cl[i].y), z: cl[i].z + t * (cl[j].z - cl[i].z),
    heading: h, widthL: cl[i].widthL + t * (cl[j].widthL - cl[i].widthL), widthR: cl[i].widthR + t * (cl[j].widthR - cl[i].widthR),
  };
}

export function detectCornerComplexes(centreline, lapLength, o = CAM) {
  const n = centreline.length;
  const over = centreline.map((p) => Math.abs(p.curvature) > o.curvatureThresh);
  if (!over.some(Boolean)) return [];

  let start = over.findIndex((v) => !v);
  if (start < 0) start = 0;
  const runs = [];
  let i = 0;
  while (i < n) {
    const idx = (start + i) % n;
    if (!over[idx]) { i++; continue; }
    let len = 0;
    let apexI = idx, apexK = Math.abs(centreline[idx].curvature);
    while (len < n && over[(start + i + len) % n]) {
      const k = (start + i + len) % n;
      if (Math.abs(centreline[k].curvature) > apexK) { apexK = Math.abs(centreline[k].curvature); apexI = k; }
      len++;
    }
    runs.push({ apexS: centreline[apexI].s, hand: centreline[apexI].curvature >= 0 ? 'left' : 'right' });
    i += len;
  }

  runs.sort((a, b) => a.apexS - b.apexS);
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && Math.min(fwdLen(last.apexS, r.apexS, lapLength), fwdLen(r.apexS, last.apexS, lapLength)) < o.mergeDist) continue;
    merged.push(r);
  }
  return merged;
}

export function computeCinematicCameras(trackData, o = CAM) {
  const cl = trackData.centreline;
  const L = trackData.lapLength;
  const spacing = trackData.sampleSpacing || 5;
  const corners = detectCornerComplexes(cl, L, o);
  const cams = [];

  for (const c of corners) {
    const f = sampleAt(cl, L, spacing, c.apexS);
    const outside = c.hand === 'left' ? -1 : 1;
    const edge = outside < 0 ? f.widthR : f.widthL;
    const lateral = outside * (edge + o.cornerOutM);
    const x = f.x - lateral * Math.sin(f.heading);
    const y = f.y + lateral * Math.cos(f.heading);
    cams.push({ kind: 'corner', s: c.apexS, x, y, z: f.z + o.cornerUpM, aim: { x: f.x, y: f.y, z: f.z + 0.5 },
      triggerS: (c.apexS - o.triggerAheadM % L + L) % L });
  }

  const nearAnyCorner = (s) => corners.some((c) => Math.min(fwdLen(c.apexS, s, L), fwdLen(s, c.apexS, L)) < o.mergeDist);
  let idx = 0;
  for (let s = 0; s < L; s += o.straightSpacingM) {
    if (nearAnyCorner(s)) continue;
    const f = sampleAt(cl, L, spacing, s);
    const side = idx % 2 === 0 ? 1 : -1;
    idx++;
    const edge = side > 0 ? f.widthL : f.widthR;
    const lateral = side * (edge + o.straightOutM);
    const x = f.x - lateral * Math.sin(f.heading);
    const y = f.y + lateral * Math.cos(f.heading);
    cams.push({ kind: 'straight', s, x, y, z: f.z + o.straightUpM, aim: { x: f.x, y: f.y, z: f.z + 0.5 },
      triggerS: (s - o.triggerAheadM % L + L) % L });
  }

  cams.sort((a, b) => a.s - b.s);
  return cams;
}

export function cameraForS(cams, s, lapLength) {
  if (!cams.length) return null;
  let best = cams[cams.length - 1];
  let bestDist = Infinity;
  for (const c of cams) {
    const d = fwdLen(c.triggerS, s, lapLength);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}
