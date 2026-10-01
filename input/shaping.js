

import { lowPass, slewLimit } from './tilt.js';

function clamp(v, lo, hi) {
  if (v > hi) return hi;
  if (v < lo) return lo;
  return v === v ? v : 0;
}

export function encodeInput(inp, out = new Uint8Array(4)) {
  out[0] = 128 + Math.round(clamp(+inp.steer, -1, 1) * 127);
  out[1] = Math.round(clamp(+inp.throttle, 0, 1) * 255);
  out[2] = Math.round(clamp(+inp.brake, 0, 1) * 255);
  out[3] = inp.handbrake >= 0.5 ? 1 : 0;
  return out;
}

export function decodeInput(b) {
  return {
    steer: (b[0] - 128) / 127,
    throttle: b[1] / 255,
    brake: b[2] / 255,
    handbrake: b[3] & 1,
  };
}

export function quantiseInput(inp) {
  return decodeInput(encodeInput(inp));
}

export const KEY_RATES = Object.freeze({ steerOutPerS: 3.0, steerBackPerS: 5.0, pedalRampS: 0.35, pedalReleaseS: 0.1 });

export function rampSteer(current, target, dt, r = KEY_RATES) {
  const back = target === 0 || (current !== 0 && Math.sign(current) !== Math.sign(target));
  if (back && target !== 0) {

    const toZero = slewLimit(current, 0, dt, r.steerBackPerS);
    if (toZero !== 0) return toZero;
    const used = Math.abs(current) / r.steerBackPerS;
    return slewLimit(0, target, Math.max(0, dt - used), r.steerOutPerS);
  }
  return slewLimit(current, target, dt, back ? r.steerBackPerS : r.steerOutPerS);
}

export function rampPedal(current, pressed, dt, r = KEY_RATES) {
  return pressed
    ? slewLimit(current, 1, dt, 1 / r.pedalRampS)
    : slewLimit(current, 0, dt, 1 / r.pedalReleaseS);
}

export function throttleTauFor(assist) {
  if (assist === 'med') return 0.080;
  if (assist === 'high') return 0.150;
  return 0;
}

export function smoothThrottle(current, target, dt, tau) {
  return lowPass(current, target, dt, tau);
}
