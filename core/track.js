

import { SURFACES } from './params.js';

function makeResult() {
  return { z: 0, normal: [0, 0, 1], surface: 'asphalt', muScale: 1, rollingResistance: 0.015, barrier: null, _b: { dist: 0, nx: 0, ny: 0 } };
}

function setSurface(res, key) {
  const s = SURFACES[key];
  res.surface = key; res.muScale = s.muScale; res.rollingResistance = s.rollingResistance;
}

export function testPadTrack({ patches = [], wallX = null } = {}) {
  const res = makeResult();
  return {
    name: 'test pad',
    query(x, y) {
      res.z = 0; res.normal[0] = 0; res.normal[1] = 0; res.normal[2] = 1;
      setSurface(res, 'asphalt');
      for (let i = 0; i < patches.length; i++) {
        const q = patches[i];
        if (x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1) { setSurface(res, q.surface); break; }
      }
      res.barrier = null;
      if (wallX !== null && wallX - x < 3.0) {
        res._b.dist = wallX - x; res._b.nx = -1; res._b.ny = 0;
        res.barrier = res._b;
      }
      return res;
    },
  };
}

export function stubOvalTrack({ straight = 100, radius = 30, width = 10, kerb = 1, grass = 4, wallOffset = 8, hill = 3 } = {}) {
  const res = makeResult();
  const hs = straight / 2;
  const Lx = hs + radius + width / 2 + wallOffset + 10;
  const k = Math.PI / Lx;
  const half = width / 2;
  return {
    name: 'stub oval',
    straight, radius, width,
    lapLength: 2 * straight + 2 * Math.PI * radius,

    centreline(s) {
      const L = 2 * straight + 2 * Math.PI * radius;
      s = ((s % L) + L) % L;
      if (s < straight) return { x: -hs + s, y: -radius, psi: 0 };
      s -= straight;
      if (s < Math.PI * radius) { const th = -Math.PI / 2 + s / radius; return { x: hs + radius * Math.cos(th), y: radius * Math.sin(th), psi: th + Math.PI / 2 }; }
      s -= Math.PI * radius;
      if (s < straight) return { x: hs - s, y: radius, psi: Math.PI };
      s -= straight;
      const th = Math.PI / 2 + s / radius;
      return { x: -hs + radius * Math.cos(th), y: radius * Math.sin(th), psi: th + Math.PI / 2 };
    },
    query(x, y) {

      let o, ox, oy;
      if (Math.abs(x) <= hs) {
        const sy = y >= 0 ? 1 : -1;
        o = Math.abs(y) - radius; ox = 0; oy = sy;
      } else {
        const cx = x > 0 ? hs : -hs;
        const dx = x - cx, dy = y;
        const rho = Math.hypot(dx, dy);
        o = rho - radius;
        if (rho > 1e-9) { ox = dx / rho; oy = dy / rho; } else { ox = x > 0 ? 1 : -1; oy = 0; }
      }

      const cz = Math.cos(k * x);
      res.z = hill * cz;
      const dzdx = -hill * k * Math.sin(k * x);
      const inv = 1 / Math.sqrt(1 + dzdx * dzdx);
      res.normal[0] = -dzdx * inv; res.normal[1] = 0; res.normal[2] = inv;
      const ao = Math.abs(o);
      if (ao <= half - kerb) setSurface(res, 'asphalt');
      else if (ao <= half) setSurface(res, 'kerb');
      else if (ao <= half + grass) setSurface(res, 'grass');
      else setSurface(res, 'gravel');

      const wo = half + wallOffset;
      const dOut = wo - o;
      const dIn = o + wo;
      res.barrier = null;
      if (dOut <= dIn && dOut < 3.0) { res._b.dist = dOut; res._b.nx = -ox; res._b.ny = -oy; res.barrier = res._b; }
      else if (dIn < dOut && dIn < 3.0) { res._b.dist = dIn; res._b.nx = ox; res._b.ny = oy; res.barrier = res._b; }
      return res;
    },
  };
}
