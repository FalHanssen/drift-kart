

import { smoothDamp } from './chaseCamera.js';

export const HELMET = Object.freeze({
  eyeUp: 0.95,
  eyeFwd: 0.25,
  betaGain: 0.35,
  betaClampDeg: 90,
  yawTau: 0.08,
  pitchDeg: -4,
  fovDeg: 62,
  lookDist: 6,
});

const TWO_PI = 2 * Math.PI;
function wrapPi(a) { return a - TWO_PI * Math.round(a / TWO_PI); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

export function createHelmetCamera(o = HELMET) {
  const clampB = (o.betaClampDeg * Math.PI) / 180;
  const pitch = (o.pitchDeg * Math.PI) / 180;
  const s = { init: false, yaw: 0, yawV: 0 };
  const tmp = [0, 0];
  const out = { pos: [0, 0, 0], look: [0, 0, 0], fovDeg: o.fovDeg, yaw: 0 };

  function update(x, y, z, psi, beta, dt) {
    const b = clamp(beta, -clampB, clampB);
    let target = psi + o.betaGain * b;
    if (!s.init) {
      s.yaw = target; s.yawV = 0; s.init = true;
    } else {
      target = s.yaw + wrapPi(target - s.yaw);
      smoothDamp(s.yaw, s.yawV, target, o.yawTau, dt, tmp);
      s.yaw = tmp[0]; s.yawV = tmp[1];
    }
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    out.pos[0] = x + o.eyeFwd * c; out.pos[1] = y + o.eyeFwd * sn; out.pos[2] = z + o.eyeUp;
    const flat = o.lookDist * Math.cos(pitch);
    out.look[0] = out.pos[0] + flat * c; out.look[1] = out.pos[1] + flat * sn; out.look[2] = out.pos[2] + o.lookDist * Math.sin(pitch);
    out.fovDeg = o.fovDeg;
    out.yaw = s.yaw;
    return out;
  }

  return { update, reset() { s.init = false; } };
}
