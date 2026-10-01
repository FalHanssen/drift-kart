

import { G } from './params.js';
import { forcesDetail, forces, derivPlain, steerAngles, tyre, wheelLoads, NX, PARITY_ENV } from './model.js';

export function solveDense(A, b) {
  const n = b.length;
  const M = A.map((row) => row.slice());
  const x = b.slice();
  for (let c = 0; c < n; c++) {
    let piv = c, best = Math.abs(M[c][c]);
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > best) { best = Math.abs(M[r][c]); piv = r; }
    if (best === 0 || !Number.isFinite(best)) return null;
    if (piv !== c) { [M[c], M[piv]] = [M[piv], M[c]]; [x[c], x[piv]] = [x[piv], x[c]]; }
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k < n; k++) M[r][k] -= f * M[c][k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const norm2 = (v) => Math.sqrt(v.reduce((s, q) => s + q * q, 0));
const maxAbs = (v) => v.reduce((s, q) => Math.max(s, Math.abs(q)), 0);

export function newtonSolve(fun, z0, { xtol = 1e-11, ftol = 1e-6, maxIter = 100 } = {}) {
  let z = z0.slice();
  let f = fun(z);
  if (!f.every(Number.isFinite)) return { z, f, ok: false };
  const n = z.length;
  for (let it = 0; it < maxIter; it++) {
    const J = [];
    for (let i = 0; i < n; i++) J.push(new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const h = 1.49e-8 * Math.max(Math.abs(z[j]), 1e-2);
      const zp = z.slice();
      zp[j] += h;
      const fp = fun(zp);
      for (let i = 0; i < n; i++) J[i][j] = (fp[i] - f[i]) / h;
    }
    const dz = solveDense(J, f.map((q) => -q));
    if (!dz || !dz.every(Number.isFinite)) return { z, f, ok: false };
    const f0 = norm2(f);
    let lam = 1.0, zn, fn;
    for (;;) {
      zn = z.map((q, i) => q + lam * dz[i]);
      fn = fun(zn);
      if (fn.every(Number.isFinite) && norm2(fn) <= (1 - 1e-4 * lam) * f0) break;
      lam *= 0.5;
      if (lam < 1e-6) break;
    }
    if (!fn.every(Number.isFinite)) return { z, f, ok: false };
    const step = norm2(dz.map((q) => lam * q));
    z = zn; f = fn;
    if (step <= xtol * (norm2(z) + xtol) || maxAbs(f) === 0) {
      return { z, f, ok: maxAbs(f) <= ftol };
    }
    if (lam < 1e-6 && maxAbs(f) > ftol) return { z, f, ok: false };
  }
  return { z, f, ok: false };
}

const EPSMCH = 2.220446049250313e-16;
const GIANT = 1.7976931348623157e308;
function enorm(v, n) { let s = 0; for (let i = 0; i < n; i++) s += v[i] * v[i]; return Math.sqrt(s); }
const rIdx = (i, j, n) => i * n - (i * (i - 1)) / 2 + (j - i);

function qrfac(n, a, rdiag, acnorm) {
  for (let j = 0; j < n; j++) {
    let s = 0; for (let i = 0; i < n; i++) s += a[i + j * n] ** 2;
    acnorm[j] = Math.sqrt(s); rdiag[j] = acnorm[j];
  }
  for (let j = 0; j < n; j++) {
    let s = 0; for (let i = j; i < n; i++) s += a[i + j * n] ** 2;
    let ajnorm = Math.sqrt(s);
    if (ajnorm !== 0) {
      if (a[j + j * n] < 0) ajnorm = -ajnorm;
      for (let i = j; i < n; i++) a[i + j * n] /= ajnorm;
      a[j + j * n] += 1.0;
      for (let k = j + 1; k < n; k++) {
        let sum = 0; for (let i = j; i < n; i++) sum += a[i + j * n] * a[i + k * n];
        const temp = sum / a[j + j * n];
        for (let i = j; i < n; i++) a[i + k * n] -= temp * a[i + j * n];
      }
    }
    rdiag[j] = -ajnorm;
  }
}

function qform(n, q, wa) {
  for (let j = 1; j < n; j++) for (let i = 0; i < j; i++) q[i + j * n] = 0;
  for (let l = 0; l < n; l++) {
    const k = n - 1 - l;
    for (let i = k; i < n; i++) { wa[i] = q[i + k * n]; q[i + k * n] = 0; }
    q[k + k * n] = 1.0;
    if (wa[k] !== 0) {
      for (let j = k; j < n; j++) {
        let sum = 0; for (let i = k; i < n; i++) sum += q[i + j * n] * wa[i];
        const temp = sum / wa[k];
        for (let i = k; i < n; i++) q[i + j * n] -= temp * wa[i];
      }
    }
  }
}

function dogleg(n, r, diag, qtb, delta, x, wa1, wa2) {
  for (let k = 1; k <= n; k++) {
    const j = n - k;
    let sum = 0;
    for (let i = j + 1; i < n; i++) sum += r[rIdx(j, i, n)] * x[i];
    let temp = r[rIdx(j, j, n)];
    if (temp === 0) {
      for (let i = 0; i <= j; i++) temp = Math.max(temp, Math.abs(r[rIdx(i, j, n)]));
      temp = EPSMCH * temp;
      if (temp === 0) temp = EPSMCH;
    }
    x[j] = (qtb[j] - sum) / temp;
  }
  for (let j = 0; j < n; j++) { wa1[j] = 0; wa2[j] = diag[j] * x[j]; }
  const qnorm = enorm(wa2, n);
  if (qnorm <= delta) return;
  let l = 0;
  for (let j = 0; j < n; j++) {
    const temp = qtb[j];
    for (let i = j; i < n; i++) { wa1[i] += r[l] * temp; l++; }
    wa1[j] /= diag[j];
  }
  const gnorm = enorm(wa1, n);
  let sgnorm = 0;
  let alpha = delta / qnorm;
  if (gnorm !== 0) {
    for (let j = 0; j < n; j++) wa1[j] = (wa1[j] / gnorm) / diag[j];
    l = 0;
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let i = j; i < n; i++) { sum += r[l] * wa1[i]; l++; }
      wa2[j] = sum;
    }
    const temp = enorm(wa2, n);
    sgnorm = (gnorm / temp) / temp;
    alpha = 0;
    if (sgnorm < delta) {
      const bnorm = enorm(qtb, n);
      let t = (bnorm / gnorm) * (bnorm / qnorm) * (sgnorm / delta);
      t = t - (delta / qnorm) * (sgnorm / delta) ** 2
        + Math.sqrt((t - (delta / qnorm)) ** 2 + (1 - (delta / qnorm) ** 2) * (1 - (sgnorm / delta) ** 2));
      alpha = ((delta / qnorm) * (1 - (sgnorm / delta) ** 2)) / t;
    }
  }
  const temp = (1 - alpha) * Math.min(sgnorm, delta);
  for (let j = 0; j < n; j++) x[j] = temp * wa1[j] + alpha * x[j];
}

function r1updt(n, s, u, v, w) {
  const m = n;
  let jj = rIdx(n - 1, n - 1, n);
  let l = jj;
  for (let i = n - 1; i < m; i++) { w[i] = s[l]; l++; }
  for (let nmj = 1; nmj <= n - 1; nmj++) {
    const j = n - 1 - nmj;
    jj -= (m - j);
    w[j] = 0;
    if (v[j] !== 0) {
      let cs, sn, tau;
      if (Math.abs(v[n - 1]) < Math.abs(v[j])) {
        const cotan = v[n - 1] / v[j];
        sn = 0.5 / Math.sqrt(0.25 + 0.25 * cotan ** 2); cs = sn * cotan; tau = 1;
        if (Math.abs(cs) * GIANT > 1) tau = 1 / cs;
      } else {
        const tn = v[j] / v[n - 1];
        cs = 0.5 / Math.sqrt(0.25 + 0.25 * tn ** 2); sn = cs * tn; tau = sn;
      }
      v[n - 1] = sn * v[j] + cs * v[n - 1];
      v[j] = tau;
      l = jj;
      for (let i = j; i < m; i++) {
        const temp = cs * s[l] - sn * w[i];
        w[i] = sn * s[l] + cs * w[i];
        s[l] = temp; l++;
      }
    }
  }
  for (let i = 0; i < m; i++) w[i] += v[n - 1] * u[i];
  let sing = false;
  for (let j = 0; j < n - 1; j++) {
    if (w[j] !== 0) {
      let cs, sn, tau;
      if (Math.abs(s[jj]) < Math.abs(w[j])) {
        const cotan = s[jj] / w[j];
        sn = 0.5 / Math.sqrt(0.25 + 0.25 * cotan ** 2); cs = sn * cotan; tau = 1;
        if (Math.abs(cs) * GIANT > 1) tau = 1 / cs;
      } else {
        const tn = w[j] / s[jj];
        cs = 0.5 / Math.sqrt(0.25 + 0.25 * tn ** 2); sn = cs * tn; tau = sn;
      }
      l = jj;
      for (let i = j; i < m; i++) {
        const temp = cs * s[l] + sn * w[i];
        w[i] = -sn * s[l] + cs * w[i];
        s[l] = temp; l++;
      }
      w[j] = tau;
    }
    if (s[jj] === 0) sing = true;
    jj += (m - j);
  }
  l = jj;
  for (let i = n - 1; i < m; i++) { s[l] = w[i]; l++; }
  if (s[jj] === 0) sing = true;
  return sing;
}

function r1mpyq(m, n, a, lda, v, w) {
  for (let nmj = 1; nmj <= n - 1; nmj++) {
    const j = n - 1 - nmj;
    let cs, sn;
    if (Math.abs(v[j]) > 1) { cs = 1 / v[j]; sn = Math.sqrt(1 - cs ** 2); } else { sn = v[j]; cs = Math.sqrt(1 - sn ** 2); }
    for (let i = 0; i < m; i++) {
      const temp = cs * a[i + j * lda] - sn * a[i + (n - 1) * lda];
      a[i + (n - 1) * lda] = sn * a[i + j * lda] + cs * a[i + (n - 1) * lda];
      a[i + j * lda] = temp;
    }
  }
  for (let j = 0; j < n - 1; j++) {
    let cs, sn;
    if (Math.abs(w[j]) > 1) { cs = 1 / w[j]; sn = Math.sqrt(1 - cs ** 2); } else { sn = w[j]; cs = Math.sqrt(1 - sn ** 2); }
    for (let i = 0; i < m; i++) {
      const temp = cs * a[i + j * lda] + sn * a[i + (n - 1) * lda];
      a[i + (n - 1) * lda] = -sn * a[i + j * lda] + cs * a[i + (n - 1) * lda];
      a[i + j * lda] = temp;
    }
  }
}

export function hybrd(fun, x0, { xtol = 1.49012e-8, maxfev = 0, epsfcn = EPSMCH, factor = 100 } = {}) {
  const n = x0.length;
  if (!maxfev) maxfev = 200 * (n + 1);
  const x = Float64Array.from(x0);
  let fvec = Float64Array.from(fun(Array.from(x)));
  let nfev = 1;
  let fnorm = enorm(fvec, n);
  let iter = 1, ncsuc = 0, ncfail = 0, nslow1 = 0, nslow2 = 0, info = 0;
  let delta = 0, xnorm = 0;
  const diag = new Float64Array(n), qtf = new Float64Array(n), r = new Float64Array((n * (n + 1)) / 2);
  const fjac = new Float64Array(n * n);
  const wa1 = new Float64Array(n), wa2 = new Float64Array(n), wa3 = new Float64Array(n);
  let wa4 = new Float64Array(n);
  const eps = Math.sqrt(Math.max(epsfcn, EPSMCH));
  if (!fvec.every(Number.isFinite)) return { z: Array.from(x), f: Array.from(fvec), info: 0 };
  outer:
  for (;;) {
    let jeval = true;
    for (let j = 0; j < n; j++) {
      const temp = x[j];
      let h = eps * Math.abs(temp);
      if (h === 0) h = eps;
      x[j] = temp + h;
      const fp = fun(Array.from(x));
      x[j] = temp;
      for (let i = 0; i < n; i++) fjac[i + j * n] = (fp[i] - fvec[i]) / h;
    }
    nfev += n;
    qrfac(n, fjac, wa1, wa2);
    if (iter === 1) {
      for (let j = 0; j < n; j++) { diag[j] = wa2[j] === 0 ? 1.0 : wa2[j]; wa3[j] = diag[j] * x[j]; }
      xnorm = enorm(wa3, n);
      delta = factor * xnorm;
      if (delta === 0) delta = factor;
    }
    for (let i = 0; i < n; i++) qtf[i] = fvec[i];
    for (let j = 0; j < n; j++) {
      if (fjac[j + j * n] !== 0) {
        let sum = 0; for (let i = j; i < n; i++) sum += fjac[i + j * n] * qtf[i];
        const temp = -sum / fjac[j + j * n];
        for (let i = j; i < n; i++) qtf[i] += fjac[i + j * n] * temp;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < j; i++) r[rIdx(i, j, n)] = fjac[i + j * n];
      r[rIdx(j, j, n)] = wa1[j];
    }
    qform(n, fjac, wa1);
    for (let j = 0; j < n; j++) diag[j] = Math.max(diag[j], wa2[j]);
    for (;;) {
      dogleg(n, r, diag, qtf, delta, wa1, wa2, wa3);
      for (let j = 0; j < n; j++) { wa1[j] = -wa1[j]; wa2[j] = x[j] + wa1[j]; wa3[j] = diag[j] * wa1[j]; }
      const pnorm = enorm(wa3, n);
      if (iter === 1) delta = Math.min(delta, pnorm);
      wa4 = Float64Array.from(fun(Array.from(wa2)));
      nfev += 1;
      const fnorm1 = wa4.every(Number.isFinite) ? enorm(wa4, n) : Infinity;
      let actred = -1;
      if (fnorm1 < fnorm) actred = 1 - (fnorm1 / fnorm) ** 2;
      let l = 0;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = i; j < n; j++) { sum += r[l] * wa1[j]; l++; }
        wa3[i] = qtf[i] + sum;
      }
      const temp = enorm(wa3, n);
      let prered = 0;
      if (temp < fnorm) prered = 1 - (temp / fnorm) ** 2;
      let ratio = 0;
      if (prered > 0) ratio = actred / prered;
      if (ratio < 0.1) { ncsuc = 0; ncfail += 1; delta = 0.5 * delta; } else {
        ncfail = 0; ncsuc += 1;
        if (ratio >= 0.5 || ncsuc > 1) delta = Math.max(delta, pnorm / 0.5);
        if (Math.abs(ratio - 1) <= 0.1) delta = pnorm / 0.5;
      }
      if (ratio >= 1e-4) {
        for (let j = 0; j < n; j++) { x[j] = wa2[j]; wa2[j] = diag[j] * x[j]; }
        fvec = Float64Array.from(wa4);
        xnorm = enorm(wa2, n);
        fnorm = fnorm1;
        iter += 1;
      }
      nslow1 += 1;
      if (actred >= 0.001) nslow1 = 0;
      if (jeval) nslow2 += 1;
      if (actred >= 0.1) nslow2 = 0;
      if (delta <= xtol * xnorm || fnorm === 0) info = 1;
      if (info !== 0) break outer;
      if (nfev >= maxfev) info = 2;
      if (0.1 * Math.max(0.1 * delta, pnorm) <= EPSMCH * xnorm) info = 3;
      if (nslow2 === 5) info = 4;
      if (nslow1 === 10) info = 5;
      if (info !== 0) break outer;
      if (ncfail === 2) continue outer;
      if (!wa4.every(Number.isFinite)) { info = 5; break outer; }
      for (let j = 0; j < n; j++) {
        let sum = 0; for (let i = 0; i < n; i++) sum += fjac[i + j * n] * wa4[i];
        wa2[j] = (sum - wa3[j]) / pnorm;
        wa1[j] = diag[j] * ((diag[j] * wa1[j]) / pnorm);
        if (ratio >= 1e-4) qtf[j] = sum;
      }
      r1updt(n, r, wa1, wa2, wa3);
      r1mpyq(n, n, fjac, n, wa2, wa3);
      r1mpyq(1, n, qtf, 1, wa2, wa3);
      jeval = false;
    }
  }
  return { z: Array.from(x), f: Array.from(fvec), info };
}

export function fsolveOk(sol, tol = 1e-6) { return sol.info === 1 && maxAbs(sol.f) <= tol; }

export function kinematicState(V, beta, R) {
  const vx = V * Math.cos(beta), vy = V * Math.sin(beta);
  const r = V / R;
  return [vx, vy, r, -r * vy, r * vx];
}

export function analyticDriftGuess(p, R, betaMag) {
  const wf = p.front_frac, wr = 1.0 - p.front_frac;
  const mu_r = p.rear === 'R' ? p.mu_r_slide : p.mu_pvc;
  const sb = Math.sin(betaMag), cb = Math.cos(betaMag);
  const th = Math.atan(Math.tan(betaMag) - p.a / (R * cb));
  const dmag = Math.max(th - 3.0 * Math.PI / 180, 0.0);
  const ac = mu_r * G * wr / Math.sqrt((sb - wf * cb * Math.tan(dmag)) ** 2 + (wr * cb) ** 2);
  const V = Math.sqrt(ac * R);
  const vx = V * cb;
  const vyr = V * sb + p.b * V / R;
  const tanphi = (sb - wf * cb * Math.tan(dmag)) / (wr * cb);
  const w = (vx + vyr * Math.max(tanphi, 0.02)) / p.Rw;
  return [V, -dmag, w];
}

const _st = new Float64Array(NX);
const _res = new Float64Array(7);
function forcesAt(p, x4, delta, ax, ay, env = PARITY_ENV) {
  for (let i = 0; i < 4; i++) _st[i] = x4[i];
  forces(p, _st, delta, ax, ay, env, _res, null);
  return _res;
}

export function driftRes(z, p, R, beta) {
  const [V, delta, w] = z;
  if (V <= 0.1) return [1e3, 1e3, 1e3];
  const [vx, vy, r, ax, ay] = kinematicState(V, beta, R);
  const res = forcesAt(p, [vx, vy, r, w], delta, ax, ay);
  return [res[0] / p.m - ax, res[1] / p.m - ay, res[2] / p.Izz];
}

export function frontReserve(p, x, deltaEq, ax, ay, spanDeg = 30.0, n = 241) {
  const loads = new Float64Array(4);
  wheelLoads(p, ax, ay, G, loads);
  const [vx, vy, r] = x;
  const ang = new Float64Array(2), ty = new Float64Array(5);
  const Mf = (delta) => {
    steerAngles(p, delta, ang);
    let M = 0.0;
    for (let i = 0; i < 2; i++) {
      const yy = i === 0 ? p.tf / 2 : -p.tf / 2;
      const Fz = loads[i];
      const vxi = vx - r * yy, vyi = vy + r * p.a;
      const c = Math.cos(ang[i]), s_ = Math.sin(ang[i]);
      const vxw = c * vxi + s_ * vyi, vyw = -s_ * vxi + c * vyi;
      tyre(vxw, vyw, vxw, Fz, 0, p, 1.0, ty);
      let fxw = ty[0];
      const fyw = ty[1];
      fxw -= p.f_rr * Fz * Math.tanh(vxw / 0.1);
      const Fx = c * fxw - s_ * fyw, Fy = s_ * fxw + c * fyw;
      M += p.a * Fy - yy * Fx;
    }
    return M;
  };
  const sgn = r >= 0 ? 1.0 : -1.0;
  const lo = deltaEq - spanDeg * Math.PI / 180, hi = deltaEq + spanDeg * Math.PI / 180;
  let k = 0, Mmax = -Infinity, dk = lo;
  for (let i = 0; i < n; i++) {
    const d = lo + (hi - lo) * i / (n - 1);
    const v = sgn * Mf(d);
    if (v > Mmax) { Mmax = v; k = i; dk = d; }
  }
  const Meq = sgn * Mf(deltaEq);
  const past = (sgn * (deltaEq - dk)) > 0.25 * Math.PI / 180;
  return { eta: Mmax > 0 ? Meq / Mmax : NaN, past, dmaxDeg: dk * 180 / Math.PI, Meq, Mmax };
}

export function summariseEquilibrium(p, R, beta, V, delta, w) {
  const [vx, vy, r, ax, ay] = kinematicState(V, beta, R);
  const x = [vx, vy, r, w];
  const d = forcesDetail(p, x, delta, ax, ay);
  const wh = d.wheels;
  const T = p.Rw * (d.FxR[0] + d.FxR[1]);
  const fF = [0, 1].map((i) => Math.hypot(wh[i].Fxw, wh[i].Fyw));
  const capF = [0, 1].map((i) => wh[i].mucap * wh[i].Fz);
  const etaF = (fF[0] + fF[1]) / Math.max(capF[0] + capF[1], 1e-9);
  const etaFw = Math.max(wh[0].util, wh[1].util);
  const frontPastPeak = Math.max(wh[0].s, wh[1].s) > p.sp_f;
  const fr = frontReserve(p, x, delta, ax, ay);
  const fz = wh[0].Fz + wh[1].Fz;
  const sfw = fz > 0 ? (wh[0].Fz * wh[0].s + wh[1].Fz * wh[1].s) / fz : 9.9;
  const past = (sfw > p.sp_f) || fr.past;
  const FrX = d.FxR[0] + d.FxR[1];
  const FrY = wh[2].Fyw + wh[3].Fyw;
  const Fr = Math.hypot(FrX, FrY);
  const Nr = wh[2].Fz + wh[3].Fz;
  return {
    R, beta_deg: -beta * 180 / Math.PI, V, V_kmh: V * 3.6, delta_deg: -delta * 180 / Math.PI, w,
    T_axle: T, P_kW: T * w / 1000.0, ay_g: ay / G, ax_g: ax / G, ac_g: V * V / R / G,
    eta_f: etaF, eta_f_wheel: etaFw, eta_f_steer: fr.eta, front_past_peak: past,
    inner_front_past_peak: frontPastPeak, Mf_eq: fr.Meq, Mf_max: fr.Mmax,
    countersteer_at_front_max: -fr.dmaxDeg, s_front_loadweighted: sfw,
    rear_lat_share: Fr > 0 ? FrY / Fr : NaN, rear_mu_eff: Nr > 0 ? Fr / Nr : NaN,
    slip_ratio: (w * p.Rw - vx) / vx, FzFL: wh[0].Fz, FzFR: wh[1].Fz, FzRL: wh[2].Fz, FzRR: wh[3].Fz,
    nlift: d.nlift, vx, vy, r, delta,
  };
}

export function driftEquilibrium(p, R, betaDeg, guess = null) {
  const beta = -betaDeg * Math.PI / 180;
  const [V0, d0, w0] = analyticDriftGuess(p, R, betaDeg * Math.PI / 180);
  const starts = [];
  if (guess) starts.push(guess.slice());
  for (const dd of [0.0, 2.0, -2.0, 4.0]) {
    for (const wf of [1.0, 1.3, 0.85, 1.8]) starts.push([V0, d0 - dd * Math.PI / 180, w0 * wf]);
  }
  let fallback = null;
  for (const z0 of starts) {
    const sol = hybrd((z) => driftRes(z, p, R, beta), z0, { xtol: 1e-11 });
    if (!fsolveOk(sol) || sol.z[0] <= 0.2) continue;
    const [V, delta, w] = sol.z;
    if (delta > 0.5 || w * p.Rw < 0) continue;
    const e = summariseEquilibrium(p, R, beta, V, delta, w);
    if (!e.front_past_peak) { e.feasible = true; return e; }
    if (!fallback) fallback = e;
  }
  if (fallback) { fallback.feasible = false; return fallback; }
  return null;
}

export function driftFamily(p, R, betas) {
  const out = [];
  let guess = null;
  for (const bd of betas) {
    let e = driftEquilibrium(p, R, bd, guess);
    if (e === null && guess !== null) e = driftEquilibrium(p, R, bd, null);
    if (e && e.feasible) guess = [e.V, e.delta, e.w];
    out.push(e);
  }
  return out;
}

export function gripRes(z, p, R, V) {
  const [beta, delta, w] = z;
  const [vx, vy, r, ax, ay] = kinematicState(V, beta, R);
  const res = forcesAt(p, [vx, vy, r, w], delta, ax, ay);
  return [res[0] / p.m - ax, res[1] / p.m - ay, res[2] / p.Izz];
}

export function gripEquilibrium(p, R, ayG, guess = null) {
  const V = Math.sqrt(ayG * G * R);
  const starts = guess ? [guess.slice()] : [];
  for (const bdeg of [1.0, -1.0, 3.0, -3.0, 6.0]) {
    for (const ddeg of [2.0, 6.0, 10.0]) {
      for (const wf of [1.0, 1.03, 0.97]) starts.push([bdeg * Math.PI / 180, p.L / R + ddeg * Math.PI / 180, V / p.Rw * wf]);
    }
  }
  let sol = null;
  for (const g0 of starts) {
    const s = hybrd((z) => gripRes(z, p, R, V), g0, { xtol: 1e-11 });
    if (s.info === 1 && maxAbs(s.f) < 1e-6 && Math.abs(s.z[1]) < 40 * Math.PI / 180 && Math.abs(s.z[0]) < 45 * Math.PI / 180 && s.z[2] > 0) {
      sol = s.z;
      break;
    }
  }
  if (!sol) return null;
  const [beta, delta] = sol;
  const [vx, vy, r, ax, ay] = kinematicState(V, beta, R);
  const d = forcesDetail(p, [vx, vy, r, sol[2]], delta, ax, ay);
  const wh = d.wheels;
  const ys = [p.tf / 2, -p.tf / 2, p.tr / 2, -p.tr / 2];
  const Mpush = -(ys[2] * wh[2].Fx + ys[3] * wh[3].Fx);
  const fF = [0, 1].map((i) => Math.hypot(wh[i].Fxw, wh[i].Fyw));
  const capF = [0, 1].map((i) => wh[i].mucap * wh[i].Fz);
  return {
    R, ay_g: ayG, V, beta_deg: beta * 180 / Math.PI, delta_deg: delta * 180 / Math.PI, M_push: Mpush,
    eta_f: (fF[0] + fF[1]) / (capF[0] + capF[1]), sF_max: Math.max(wh[0].s, wh[1].s),
    sR_max: Math.max(wh[2].s, wh[3].s), front_yaw_cap: p.a * (capF[0] + capF[1]), sol: sol.slice(),
  };
}

export function jacobian(p, xEq, uEq) {
  const n = 4;
  const A = [];
  for (let i = 0; i < n; i++) A.push(new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1.0, Math.abs(xEq[j]));
    const xp = xEq.slice(), xm = xEq.slice();
    xp[j] += h; xm[j] -= h;
    const fp = derivPlain(p, xp, uEq, [0, 0], 12).xd;
    const fm = derivPlain(p, xm, uEq, [0, 0], 12).xd;
    for (let i = 0; i < n; i++) A[i][j] = (fp[i] - fm[i]) / (2 * h);
  }
  return A;
}

export function q2EtaFrontState(ac, beta, delta, mu_f) {
  return ac * Math.cos(beta) / (mu_f * G * Math.cos(delta));
}
export function q2AcClosure(mu_r, wf, beta, delta) {
  const wr = 1.0 - wf;
  return mu_r * G * wr / Math.sqrt((Math.sin(beta) - wf * Math.cos(beta) * Math.tan(delta)) ** 2 + (wr * Math.cos(beta)) ** 2);
}
export function q2EtaFrontClosed(mu_r, mu_f, wf, beta, delta) {
  const wr = 1.0 - wf;
  const share = wr * Math.cos(beta) / Math.sqrt((Math.sin(beta) - wf * Math.cos(beta) * Math.tan(delta)) ** 2 + (wr * Math.cos(beta)) ** 2);
  return [mu_r / mu_f * share / Math.cos(delta), share];
}
export function q2EtaFrontLongTransfer(ac, beta, delta, mu_f, h, b) {
  return ac * Math.cos(beta) / (mu_f * Math.cos(delta) * (G - ac * Math.sin(beta) * h / b));
}
