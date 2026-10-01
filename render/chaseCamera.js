

export const CHASE = Object.freeze({
  back: 3.2,
  up: 1.35,
  lookUp: 0.55,
  lookAhead: 1.5,
  betaGain: 0.55,
  betaClampDeg: 90,
  posTau: 0.12,
  yawTau: 0.18,
  fovRestDeg: 52,
  fovFastDeg: 58,
  fovAtKmh: 40,
  minClear: 0.4,
});

const TWO_PI = 2 * Math.PI;

function wrapPi(a) { return a - TWO_PI * Math.round(a / TWO_PI); }

export function smoothDamp(x, v, target, tau, dt, out) {
  if (!(dt > 0)) { out[0] = x; out[1] = v; return out; }
  const omega = 2 / tau;
  const k = omega * dt;
  const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
  const change = x - target;
  const temp = (v + omega * change) * dt;
  out[0] = target + (change + temp) * e;
  out[1] = (v - omega * temp) * e;
  return out;
}

export function createChaseCamera(o = CHASE) {
  const clampB = o.betaClampDeg * Math.PI / 180;
  const s = { init: false, yaw: 0, yawV: 0, p: [0, 0, 0], v: [0, 0, 0] };
  const tmp = [0, 0];
  const out = { pos: [0, 0, 0], look: [0, 0, 0], fovDeg: o.fovRestDeg, yaw: 0 };

  function update(x, y, z, psi, beta, speed, dt) {
    const b = beta > clampB ? clampB : (beta < -clampB ? -clampB : beta);
    let target = psi + o.betaGain * b;
    if (!s.init) {
      s.yaw = target; s.yawV = 0;
    } else {
      target = s.yaw + wrapPi(target - s.yaw);
      smoothDamp(s.yaw, s.yawV, target, o.yawTau, dt, tmp);
      s.yaw = tmp[0]; s.yawV = tmp[1];
    }
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const tx = x - o.back * c, ty = y - o.back * sn, tz = z + o.up;
    if (!s.init) {
      s.p[0] = tx; s.p[1] = ty; s.p[2] = tz;
      s.v[0] = 0; s.v[1] = 0; s.v[2] = 0;
      s.init = true;
    } else {
      smoothDamp(s.p[0], s.v[0], tx, o.posTau, dt, tmp); s.p[0] = tmp[0]; s.v[0] = tmp[1];
      smoothDamp(s.p[1], s.v[1], ty, o.posTau, dt, tmp); s.p[1] = tmp[0]; s.v[1] = tmp[1];
      smoothDamp(s.p[2], s.v[2], tz, o.posTau, dt, tmp); s.p[2] = tmp[0]; s.v[2] = tmp[1];
    }
    if (s.p[2] < z + o.minClear) s.p[2] = z + o.minClear;
    out.pos[0] = s.p[0]; out.pos[1] = s.p[1]; out.pos[2] = s.p[2];
    out.look[0] = x + o.lookAhead * c; out.look[1] = y + o.lookAhead * sn; out.look[2] = z + o.lookUp;
    const f = (speed * 3.6) / o.fovAtKmh;
    out.fovDeg = o.fovRestDeg + (o.fovFastDeg - o.fovRestDeg) * (f < 0 ? 0 : (f > 1 ? 1 : f));
    out.yaw = s.yaw;
    return out;
  }

  return { update, reset() { s.init = false; } };
}
