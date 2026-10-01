

import { G, ASPHALT_RR } from './params.js';

export const NX = 7;

export function muRubber(s, mu_p, mu_s, sp, k) {
  const x = s / sp;
  const xk = k === 2.0 ? x * x : x ** k;
  return mu_s * Math.tanh(3.0 * x) + (mu_p - mu_s) * xk * Math.exp(1.0 - xk);
}

export function muPvc(s, mu, s0) {
  return mu * Math.tanh(s / s0);
}

export function lsFactor(Fz, k, Fz0) {
  if (k === 0.0 || Fz <= 0.0) return 1.0;
  const f = 1.0 - k * Math.log2(Math.max(Fz, 1.0) / Fz0);
  return Math.min(1.4, Math.max(0.6, f));
}

export function tyre(vx, vy, vrot, Fz, kind, p, scale, out) {
  if (Fz <= 0.0) {
    out[0] = 0.0; out[1] = 0.0; out[2] = 0.0; out[3] = 0.0; out[4] = 0.0;
    return out;
  }
  const svx = vx - vrot;
  const svy = vy;

  const vref = Math.max(Math.sqrt(vx * vx + vy * vy), Math.abs(vrot), p.v_eps);
  const s = Math.sqrt(svx * svx + svy * svy) / vref;
  let mu, cap;
  if (kind === 0) {
    const lf = lsFactor(Fz, p.ls_f, p.Fz0);
    mu = lf * muRubber(s, p.mu_f, p.mu_f * p.slide_ratio_f, p.sp_f, p.drop_k_f);
    cap = lf * p.mu_f;
  } else if (kind === 1) {
    const lf = lsFactor(Fz, p.ls_r, p.Fz0);
    mu = lf * muRubber(s, p.mu_r_peak, p.mu_r_slide, p.sp_r, p.drop_k);
    cap = lf * p.mu_r_peak;
  } else {
    mu = muPvc(s, p.mu_pvc, p.s0_pvc);
    cap = p.mu_pvc;
  }
  if (scale !== 1.0) { mu *= scale; cap *= scale; }
  if (s < 1e-12) {
    out[0] = 0.0; out[1] = 0.0; out[2] = s; out[3] = 0.0; out[4] = cap;
    return out;
  }
  const k = mu * Fz / (s * vref);
  out[0] = -k * svx; out[1] = -k * svy; out[2] = s; out[3] = mu; out[4] = cap;
  return out;
}

export function kindCode(letter) { return letter === 'F' ? 0 : (letter === 'R' ? 1 : 2); }

const _A = new Float64Array(9);
const _rhs = new Float64Array(3);

function solve3(A, b) {
  for (let c = 0; c < 3; c++) {
    let piv = c, best = Math.abs(A[c * 3 + c]);
    for (let r = c + 1; r < 3; r++) {
      const v = Math.abs(A[r * 3 + c]);
      if (v > best) { best = v; piv = r; }
    }
    if (piv !== c) {
      for (let k = 0; k < 3; k++) { const t = A[c * 3 + k]; A[c * 3 + k] = A[piv * 3 + k]; A[piv * 3 + k] = t; }
      const t = b[c]; b[c] = b[piv]; b[piv] = t;
    }
    for (let r = c + 1; r < 3; r++) {
      const f = A[r * 3 + c] / A[c * 3 + c];
      for (let k = c; k < 3; k++) A[r * 3 + k] -= f * A[c * 3 + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = 2; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 3; k++) s -= A[r * 3 + k] * b[k];
    b[r] = s / A[r * 3 + r];
  }
  return b;
}

export function wheelLoads(p, ax, ay, gN, out) {
  const m = p.m, h = p.h, L = p.L;
  if (!p.load_transfer) { ax = 0.0; ay = 0.0; }
  if (!p.lt_long) ax = 0.0;
  if (!p.lt_lat) ay = 0.0;
  const Nf = m * gN * p.b / L - m * ax * h / L;
  const Nr = m * gN * p.a / L + m * ax * h / L;
  const chi = p.chi_f;
  const dF = chi * m * ay * h / p.tf;
  const dR = (1.0 - chi) * m * ay * h / p.tr;
  out[0] = Nf / 2 - dF; out[1] = Nf / 2 + dF; out[2] = Nr / 2 - dR; out[3] = Nr / 2 + dR;
  let j = 0, mn = out[0];
  for (let i = 1; i < 4; i++) if (out[i] < mn) { mn = out[i]; j = i; }
  if (mn >= 0.0) return 0;

  let c = 0;
  for (let i = 0; i < 4; i++) {
    if (i === j) continue;
    const xi = i < 2 ? p.a : -p.b;
    const yi = i === 0 ? p.tf / 2 : (i === 1 ? -p.tf / 2 : (i === 2 ? p.tr / 2 : -p.tr / 2));
    _A[c] = 1.0; _A[3 + c] = xi; _A[6 + c] = yi;
    c++;
  }
  _rhs[0] = m * gN; _rhs[1] = -m * ax * h; _rhs[2] = -m * ay * h;
  solve3(_A, _rhs);
  c = 0;
  for (let i = 0; i < 4; i++) {
    if (i === j) { out[i] = 0.0; continue; }
    out[i] = _rhs[c++];
  }
  let nl = 1;
  if (Math.min(out[0], out[1], out[2], out[3]) < 0.0) {
    nl = 2;
    for (let i = 0; i < 4; i++) out[i] = Math.max(0.0, out[i]);
  }
  return nl;
}

export function steerAngles(p, delta, out) {
  if (p.ackermann === 0.0 || Math.abs(delta) < 1e-9) { out[0] = delta; out[1] = delta; return out; }
  const sgn = delta > 0 ? 1.0 : -1.0;
  const Rt = p.L / Math.tan(Math.abs(delta));
  let inner = Math.atan(p.L / Math.max(Rt - p.tf / 2, 1e-3));
  let outer = Math.atan(p.L / (Rt + p.tf / 2));
  const ad = Math.abs(delta);
  inner = ad + p.ackermann * (inner - ad);
  outer = ad + p.ackermann * (outer - ad);
  if (sgn > 0) { out[0] = sgn * inner; out[1] = sgn * outer; } else { out[0] = sgn * outer; out[1] = sgn * inner; }
  return out;
}

export function makeEnv() {
  return {
    gN: G,
    gx: 0.0, gy: 0.0,
    muScale: new Float64Array([1, 1, 1, 1]),
    rrExtra: new Float64Array([0, 0, 0, 0]),
    frontScale: 1.0,
    brakeTorque: 0.0,
    kDrag: 0.0,
  };
}
export const PARITY_ENV = Object.freeze(makeEnv());

export function surfaceRrExtra(rr) { return rr - ASPHALT_RR; }

const _loads = new Float64Array(4);
const _ang = new Float64Array(2);
const _ty = new Float64Array(5);

const _trig = new Float64Array([1, 0, 1, 0, 0, 0, NaN, NaN]);

export function forces(p, st, delta, ax, ay, env, res, det) {
  const vx = st[0], vy = st[1], r = st[2], w = st[3];
  const nlift = wheelLoads(p, ax, ay, env.gN, _loads);
  if (delta !== _trig[4] || p.ackermann !== _trig[5] || p.L !== _trig[6] || p.tf !== _trig[7]) {
    steerAngles(p, delta, _ang);
    _trig[0] = Math.cos(_ang[0]); _trig[1] = Math.sin(_ang[0]);
    _trig[2] = Math.cos(_ang[1]); _trig[3] = Math.sin(_ang[1]);
    _trig[4] = delta; _trig[5] = p.ackermann; _trig[6] = p.L; _trig[7] = p.tf;
  }
  const a = p.a, b = p.b, htf = p.tf / 2, htr = p.tr / 2;
  let Fx_t = 0.0, Fy_t = 0.0, Mz = 0.0, Trr = 0.0;
  const rearKind = p.rearKind;
  for (let i = 0; i < 4; i++) {
    const Fz = _loads[i];
    const xi = i < 2 ? a : -b;
    const yi = i === 0 ? htf : (i === 1 ? -htf : (i === 2 ? htr : -htr));
    const vxi = vx - r * yi;
    const vyi = vy + r * xi;

    const c = i < 2 ? _trig[2 * i] : 1.0, s_ = i < 2 ? _trig[2 * i + 1] : 0.0;
    const vxw = c * vxi + s_ * vyi;
    const vyw = -s_ * vxi + c * vyi;
    let fxw, fyw;
    if (i < 2) {
      tyre(vxw, vyw, vxw, Fz, 0, p, env.muScale[i] * env.frontScale, _ty);
      fxw = _ty[0]; fyw = _ty[1];
      const rrx = env.rrExtra[i];
      const frr = rrx === 0.0 ? p.f_rr : p.f_rr + rrx;
      fxw -= frr * Fz * Math.tanh(vxw / 0.1);
    } else {
      tyre(vxw, vyw, w * p.Rw, Fz, rearKind, p, env.muScale[i], _ty);
      fxw = _ty[0]; fyw = _ty[1];
      res[i + 1] = fxw;
      const rrx = env.rrExtra[i];
      if (rrx > 0.0 && Fz > 0.0) Trr -= rrx * Fz * p.Rw * Math.tanh(w * p.Rw / 0.1);
    }
    const Fx = c * fxw - s_ * fyw;
    const Fy = s_ * fxw + c * fyw;
    Fx_t += Fx;
    Fy_t += Fy;
    Mz += xi * Fy - yi * Fx;
    if (det) {
      const o = i * 9;
      det[o] = Fz; det[o + 1] = fxw; det[o + 2] = fyw; det[o + 3] = _ty[2]; det[o + 4] = _ty[3];
      det[o + 5] = _ty[4];
      det[o + 6] = (Fz > 0 && _ty[4] > 0) ? Math.hypot(fxw, fyw) / (_ty[4] * Fz) : 0.0;
      det[o + 7] = Fx; det[o + 8] = Fy;
    }
  }
  res[0] = Fx_t; res[1] = Fy_t; res[2] = Mz; res[5] = Trr; res[6] = nlift;
  return res;
}

const _res = new Float64Array(7);
export function deriv(p, st, u, acc, iters, env, xd) {
  let ax = acc[0], ay = acc[1];
  const res = _res;
  for (let k = 0; k < iters; k++) {
    forces(p, st, u[0], ax, ay, env, res, null);
    ax = res[0] / p.m; ay = res[1] / p.m;
  }
  const vx = st[0], vy = st[1], r = st[2], w = st[3];
  xd[0] = ax + r * vy + env.gx;
  xd[1] = ay - r * vx + env.gy;
  if (env.kDrag !== 0.0) {
    const kv = env.kDrag * Math.sqrt(vx * vx + vy * vy);
    xd[0] -= kv * vx;
    xd[1] -= kv * vy;
  }
  xd[2] = res[2] / p.Izz;
  const hb = u[2];
  const Tb = -(hb * p.T_hb + u[3] * env.brakeTorque) * Math.tanh(w / 0.5);
  xd[3] = (u[1] + Tb + res[5] - p.Rw * (res[3] + res[4])) / p.I_axle;
  const cp = Math.cos(st[6]), sp = Math.sin(st[6]);
  xd[4] = vx * cp - vy * sp;
  xd[5] = vx * sp + vy * cp;
  xd[6] = r;
  acc[0] = ax; acc[1] = ay;
  return xd;
}

export function makeRk4Scratch() {
  return {
    k1: new Float64Array(NX), k2: new Float64Array(NX), k3: new Float64Array(NX), k4: new Float64Array(NX),
    tmp: new Float64Array(NX), acc2: new Float64Array(2),
  };
}

export function rk4Step(p, st, u1, u2, u4, dt, acc, env, S) {
  const { k1, k2, k3, k4, tmp, acc2 } = S;
  deriv(p, st, u1, acc, 3, env, k1);
  const hd = 0.5 * dt;
  for (let i = 0; i < NX; i++) tmp[i] = st[i] + hd * k1[i];
  acc2[0] = acc[0]; acc2[1] = acc[1];
  deriv(p, tmp, u2, acc2, 2, env, k2);
  for (let i = 0; i < NX; i++) tmp[i] = st[i] + hd * k2[i];
  acc2[0] = acc[0]; acc2[1] = acc[1];
  deriv(p, tmp, u2, acc2, 2, env, k3);
  for (let i = 0; i < NX; i++) tmp[i] = st[i] + dt * k3[i];
  acc2[0] = acc[0]; acc2[1] = acc[1];
  deriv(p, tmp, u4, acc2, 2, env, k4);
  const d6 = dt / 6.0;
  for (let i = 0; i < NX; i++) st[i] = st[i] + d6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return st;
}

export function simulateRef(p, x0, ufun, tEnd, dt = 5e-4, recordEvery = 10, env = PARITY_ENV) {
  const n = Math.round(tEnd / dt);
  const st = new Float64Array(NX);
  for (let i = 0; i < 4; i++) st[i] = x0[i];
  const acc = new Float64Array(2);
  const S = makeRk4Scratch();
  const u1 = new Float64Array(4), u2 = new Float64Array(4), u4 = new Float64Array(4);
  const out = { t: [], x: [], xd: [] };
  const setU = (dst, v) => { dst[0] = v[0]; dst[1] = v[1]; dst[2] = v.length > 2 ? v[2] : 0.0; dst[3] = 0.0; };
  for (let k = 0; k <= n; k++) {
    const t = k * dt;
    const x4 = [st[0], st[1], st[2], st[3]];
    setU(u1, ufun(t, x4));
    if (k === n) {
      if (k % recordEvery === 0) {
        deriv(p, st, u1, acc, 3, env, S.k1);
        out.t.push(t); out.x.push(x4); out.xd.push(Array.from(S.k1.subarray(0, 4)));
      }
      break;
    }
    setU(u2, ufun(t + 0.5 * dt, x4));
    setU(u4, ufun(t + dt, x4));
    if (k % recordEvery === 0) {

      const accc = new Float64Array(acc);
      const k1 = new Float64Array(NX);
      deriv(p, st, u1, accc, 3, env, k1);
      out.t.push(t); out.x.push(x4); out.xd.push(Array.from(k1.subarray(0, 4)));
    }
    rk4Step(p, st, u1, u2, u4, dt, acc, env, S);
    if (!(Number.isFinite(st[0]) && Number.isFinite(st[1]) && Number.isFinite(st[2]) && Number.isFinite(st[3]))) break;
  }
  return out;
}

export function detailAt(p, x4, u3, env = PARITY_ENV) {
  const st = new Float64Array(NX);
  for (let i = 0; i < 4; i++) st[i] = x4[i];
  const acc = new Float64Array(2);
  const xd = new Float64Array(NX);
  const u = new Float64Array([u3[0], u3[1], u3[2] || 0, 0]);
  deriv(p, st, u, acc, 8, env, xd);
  return forcesDetail(p, x4, u3[0], acc[0], acc[1], env);
}

export function forcesDetail(p, x4, delta, ax, ay, env = PARITY_ENV) {
  const st = new Float64Array(NX);
  for (let i = 0; i < 4; i++) st[i] = x4[i];
  const res = new Float64Array(7);
  const det = new Float64Array(36);
  forces(p, st, delta, ax, ay, env, res, det);
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const o = i * 9;
    wheels.push({ Fz: det[o], Fxw: det[o + 1], Fyw: det[o + 2], s: det[o + 3], mu: det[o + 4], mucap: det[o + 5],
      util: det[o + 6], Fx: det[o + 7], Fy: det[o + 8] });
  }
  return { Fx: res[0], Fy: res[1], Mz: res[2], FxR: [res[3], res[4]], nlift: res[6], wheels,
    loads: wheels.map((q) => q.Fz) };
}

export function derivPlain(p, x4, u3, acc0, iters, env = PARITY_ENV) {
  const st = new Float64Array(NX);
  for (let i = 0; i < 4; i++) st[i] = x4[i];
  const acc = new Float64Array([acc0[0], acc0[1]]);
  const xd = new Float64Array(NX);
  const u = new Float64Array([u3[0], u3[1], u3.length > 2 ? u3[2] : 0.0, 0.0]);
  deriv(p, st, u, acc, iters, env, xd);
  return { xd: [xd[0], xd[1], xd[2], xd[3]], acc: [acc[0], acc[1]] };
}
