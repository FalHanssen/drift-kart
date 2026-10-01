

export const G0 = 9.81;
export const RAD2DEG = 180 / Math.PI;

export const TILT = Object.freeze({
  deadZoneDeg: 2.0,
  maxTiltDeg: 28,
  tauS: 0.020,
  slewDegPerS: 400,
  flatEnterG: 0.25,
  flatExitG: 0.35,
  flatExitHoldS: 0.3,
  flatDecayS: 0.5,
  rejectG: 0.35,
  calibMinG: 0.35,
  calibSpreadDeg: 3.0,
  calibWindowS: 1.0,
  calibSettleS: 0.2,
  calibMinSamples: 10,
  gapResetS: 0.25,
});

export function signedAngleDeg(rx, ry, px, py) {
  return Math.atan2(rx * py - ry * px, rx * px + ry * py) * RAD2DEG;
}

export function expoFor(assist) {
  return assist === 'off' ? 1.0 : 1.5;
}

export function shapeTilt(thetaDeg, exponent, dz = TILT.deadZoneDeg, tmax = TILT.maxTiltDeg) {
  const a = thetaDeg < 0 ? -thetaDeg : thetaDeg;
  let u = (a - dz) / (tmax - dz);
  if (!(u > 0)) return 0;
  if (u > 1) u = 1;
  const s = exponent === 1 ? u : Math.pow(u, exponent);
  return thetaDeg < 0 ? -s : s;
}

export function unshapeTilt(s, exponent, dz = TILT.deadZoneDeg, tmax = TILT.maxTiltDeg) {
  const a = s < 0 ? -s : s;
  if (!(a > 0)) return 0;
  const u = Math.pow(a > 1 ? 1 : a, 1 / exponent);
  const t = dz + u * (tmax - dz);
  return s < 0 ? -t : t;
}

export function lowPass(prev, x, dt, tau) {
  if (!(tau > 0)) return x;
  if (!(dt > 0)) return prev;
  return prev + (1 - Math.exp(-dt / tau)) * (x - prev);
}

export function slewLimit(prev, target, dt, ratePerS) {
  const step = ratePerS * (dt > 0 ? dt : 0);
  const d = target - prev;
  if (d > step) return prev + step;
  if (d < -step) return prev - step;
  return target;
}

export function defaultReference(px) {
  return px >= 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
}

export function summariseCalibration(samples, o = TILT) {
  const n = samples.length >> 1;
  if (n < o.calibMinSamples) return { ok: false, reason: 'nodata', samples: n };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += samples[2 * i]; sy += samples[2 * i + 1]; }
  const mx = sx / n, my = sy / n;
  const mag = Math.hypot(mx, my);
  if (mag < o.calibMinG * G0) return { ok: false, reason: 'flat', magG: mag / G0, samples: n };
  const rx = mx / mag, ry = my / mag;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = signedAngleDeg(rx, ry, samples[2 * i], samples[2 * i + 1]);
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  const spreadDeg = hi - lo;
  if (!(spreadDeg < o.calibSpreadDeg)) return { ok: false, reason: 'moving', spreadDeg, samples: n };
  return { ok: true, r: { x: rx, y: ry }, spreadDeg, magG: mag / G0, samples: n };
}

export function spreadOf(samples) {
  const n = samples.length >> 1;
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += samples[2 * i]; sy += samples[2 * i + 1]; }
  const m = Math.hypot(sx, sy);
  if (!(m > 0)) return 0;
  const rx = sx / m, ry = sy / m;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = signedAngleDeg(rx, ry, samples[2 * i], samples[2 * i + 1]);
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  return hi - lo;
}

export function createTiltFilter(options = {}) {
  const o = { ...TILT, ...options };
  const st = {
    ref: null,
    exponent: 1.5,
    has: false,
    tLast: 0,
    px: 0, py: 0,
    magG: 0,
    thetaRaw: 0,
    thetaF: 0,
    thetaS: 0,
    flat: false,
    flatSince: 0,
    flatTheta: 0,
    recoverSince: -1,
    rejected: 0,
    accepted: 0,
    cal: null,
  };

  function reference(px) { return st.ref || defaultReference(px); }

  function flatSteer(e) {
    const f = 1 - (st.tLast - st.flatSince) / o.flatDecayS;
    return shapeTilt(st.flatTheta, e, o.deadZoneDeg, o.maxTiltDeg) * (f > 0 ? f : 0);
  }

  function feed(ax, ay, az, t) {
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(t)) return false;
    const zz = Number.isFinite(az) ? az : 0;
    const gap = st.has ? t - st.tLast : Infinity;
    const reseed = !(gap < o.gapResetS);
    const dt = !reseed && gap > 0 ? gap : 0;
    st.tLast = t;

    if (Number.isFinite(az) && Math.abs(Math.hypot(ax, ay, zz) - G0) > o.rejectG * G0) {
      st.rejected++;
      if (st.has && !st.flat) st.thetaS = slewLimit(st.thetaS, st.thetaF, dt, o.slewDegPerS);
      return true;
    }
    st.accepted++;
    st.px = ax; st.py = ay;
    st.magG = Math.hypot(ax, ay) / G0;

    const c = st.cal;
    if (c && !c.done && t >= c.tStart) {
      c.samples.push(ax, ay);
      if (t >= c.tEnd) c.done = true;
    }

    const r = reference(ax);
    const theta = signedAngleDeg(r.x, r.y, ax, ay);
    st.thetaRaw = theta;

    if (!st.has) {
      st.has = true;
      st.thetaF = theta; st.thetaS = theta;
      if (st.magG < o.flatEnterG) { st.flat = true; st.flatSince = t; st.flatTheta = 0; st.recoverSince = -1; }
      return true;
    }

    if (st.flat) {
      if (st.magG >= o.flatExitG) {
        if (st.recoverSince < 0) st.recoverSince = t;
        if (t - st.recoverSince >= o.flatExitHoldS) {

          const s = flatSteer(st.exponent);
          st.flat = false;
          st.thetaS = unshapeTilt(s, st.exponent, o.deadZoneDeg, o.maxTiltDeg);
          st.thetaF = theta;
          st.recoverSince = -1;
        }
      } else {
        st.recoverSince = -1;
      }
      return true;
    }

    if (st.magG < o.flatEnterG) {
      st.flat = true; st.flatSince = t; st.flatTheta = st.thetaS; st.recoverSince = -1;
      return true;
    }

    if (reseed) { st.thetaF = theta; st.thetaS = theta; return true; }
    st.thetaF = lowPass(st.thetaF, theta, dt, o.tauS);
    st.thetaS = slewLimit(st.thetaS, st.thetaF, dt, o.slewDegPerS);
    return true;
  }

  function steer(e = st.exponent) {
    if (!st.has) return 0;
    if (st.flat) return flatSteer(e);
    return shapeTilt(st.thetaS, e, o.deadZoneDeg, o.maxTiltDeg);
  }

  function setReference(r) {
    const m = r ? Math.hypot(r.x, r.y) : 0;
    if (!(m > 0.5 && m < 1.5)) return false;
    st.ref = { x: r.x / m, y: r.y / m };
    if (st.has) {
      const th = signedAngleDeg(st.ref.x, st.ref.y, st.px, st.py);
      st.thetaRaw = th; st.thetaF = th; st.thetaS = th;
    }
    return true;
  }

  function levelDeg() {
    if (!st.has) return 0;
    const r = reference(st.px);
    return signedAngleDeg(r.x, r.y, st.px, st.py);
  }

  function beginCalibration(t) {
    st.cal = { t0: t, tStart: t + o.calibSettleS, tEnd: t + o.calibSettleS + o.calibWindowS, samples: [], done: false };
  }

  function calibrationStatus(t) {
    const c = st.cal;
    if (!c) return { active: false, progress: 0, done: false, spreadDeg: 0, samples: 0 };
    const span = c.tEnd - c.t0;
    const p = span > 0 ? (t - c.t0) / span : 1;
    return { active: true, progress: p < 0 ? 0 : (p > 1 ? 1 : p), done: c.done || t >= c.tEnd + 0.25,
      spreadDeg: spreadOf(c.samples), samples: c.samples.length >> 1 };
  }

  function finishCalibration() {
    const c = st.cal;
    st.cal = null;
    if (!c) return { ok: false, reason: 'nodata', samples: 0 };
    const res = summariseCalibration(c.samples, o);
    if (res.ok) setReference(res.r);
    return res;
  }

  function cancelCalibration() { st.cal = null; }

  return {
    feed, steer, setReference, levelDeg, beginCalibration, calibrationStatus, finishCalibration, cancelCalibration,
    setExponent(e) { st.exponent = e; },
    get reference() { return st.ref ? { x: st.ref.x, y: st.ref.y } : null; },
    get hasData() { return st.has; },
    get flat() { return st.flat; },
    get magG() { return st.magG; },
    get thetaDeg() { return st.flat ? st.flatTheta : st.thetaS; },
    get rawThetaDeg() { return st.thetaRaw; },
    get stats() { return { accepted: st.accepted, rejected: st.rejected }; },
    options: o,
  };
}
