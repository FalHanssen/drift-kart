

import { G, DEFAULT_PARAMS, PRESETS, AERO_DEFAULTS, GAME_DEFAULTS, applyDriverMass, DRIVER_REF_KG, GARAGE_MODES, SPROCKET_LIMITS, gearedTopKmh, WS3_FRONT_DERATE_PCT, ASPHALT_RR, paramsFrom, interpTable } from './params.js';
import { NX, makeEnv, rk4Step, makeRk4Scratch, forces } from './model.js';
import { makeDrivetrain, axleTorque, outputRpm, slewThrottle, motorTorqueAvailable } from './drivetrain.js';
import { assistTarget, rateLimit } from './aids.js';
import { testPadTrack } from './track.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v > hi ? hi : (v < lo ? lo : v));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function resolveConfig(config) {
  const c = JSON.parse(JSON.stringify(config || {}));
  const parity = !!c.parityMode;
  const aids = { countersteerAssist: GAME_DEFAULTS.countersteerAssist, steerRateLimit: GAME_DEFAULTS.steerRateLimit,
    assistFadeLo: GAME_DEFAULTS.assistFadeLo, assistFadeHi: GAME_DEFAULTS.assistFadeHi, ...(c.aids || {}) };
  if (aids.steerRateLimit === null || aids.steerRateLimit === 'Infinity') aids.steerRateLimit = Infinity;
  const brakes = { footBrakeTorque: GAME_DEFAULTS.footBrakeTorque, handbrakeCutsDrive: GAME_DEFAULTS.handbrakeCutsDrive, ...(c.brakes || {}) };
  const barriers = { enabled: GAME_DEFAULTS.barriers, restitution: GAME_DEFAULTS.restitution, friction: GAME_DEFAULTS.barrierFriction,
    circles: GAME_DEFAULTS.bodyCircles.map((q) => ({ ...q })), ...(c.barriers || {}) };
  let ws3 = c.ws3Derate === undefined ? GAME_DEFAULTS.ws3Derate : !!c.ws3Derate;
  if (parity) {
    aids.countersteerAssist = 0; aids.steerRateLimit = Infinity; barriers.enabled = false; ws3 = false;
    brakes.handbrakeCutsDrive = false;
  }
  const presetId = c.preset === undefined ? 'drift' : c.preset;
  const preset = PRESETS[presetId];
  if (!preset) throw new RangeError(`unknown preset "${presetId}" (known: ${Object.keys(PRESETS).join(', ')})`);
  const aero = { ...AERO_DEFAULTS, ...(c.aero || {}) };
  if (parity) aero.enabled = false;
  const driverMassKg = c.driverMassKg === undefined ? DRIVER_REF_KG : num(c.driverMassKg, DRIVER_REF_KG);
  if (!(driverMassKg >= 40 && driverMassKg <= 140)) throw new RangeError('driverMassKg must be 40..140');
  const model = { ...applyDriverMass({ ...DEFAULT_PARAMS, ...preset.model }, driverMassKg), ...(c.model || {}) };
  if (brakes.handbrakeTorque !== undefined) model.T_hb = brakes.handbrakeTorque;
  return {
    raw: config || {}, parity, aids, brakes, barriers, ws3, model, preset, aero, driverMassKg,
    drivetrain: { ...(c.drivetrain || {}) },
    dt: num(c.dt, GAME_DEFAULTS.dt), maxFrame: num(c.maxFrame, GAME_DEFAULTS.maxFrame),
    start: c.start || null,
  };
}

export function createSim(config = {}, track = testPadTrack()) {
  const cfg = resolveConfig(config);
  const p = paramsFrom(cfg.model);
  const d = makeDrivetrain(cfg.drivetrain, cfg.preset.drivetrain);
  const dt = cfg.dt;
  const lockRad = p.lock_deg * DEG;
  const A = cfg.aids;
  const B = cfg.brakes;
  const BR = cfg.barriers;

  const WX = new Float64Array([p.a, p.a, -p.b, -p.b]);
  const WY = new Float64Array([p.tf / 2, -p.tf / 2, p.tr / 2, -p.tr / 2]);
  const CX = new Float64Array(BR.circles.map((q) => (q.at === 'front' ? p.a : q.at === 'rear' ? -p.b : 0) + (q.dx || 0)));
  const CY = new Float64Array(BR.circles.map((q) => q.y || 0));
  const CR = new Float64Array(BR.circles.map((q) => q.r));

  const st = new Float64Array(NX);
  const prev = new Float64Array(NX);
  const acc = new Float64Array(2);
  const env = makeEnv();
  env.kDrag = cfg.aero.enabled ? 0.5 * cfg.aero.rho * cfg.aero.CdA / p.m : 0.0;
  const S = makeRk4Scratch();
  const u = new Float64Array(4);
  const slopeW = new Float64Array(4);
  const surf = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
  const cgNormal = new Float64Array([0, 0, 1]);

  const sc = new Float64Array(6);
  let tick = 0, diverged = false, contact = 0;
  const input = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
  let log = null;

  function sampleTrack() {
    const X = st[4], Y = st[5], c = Math.cos(st[6]), s = Math.sin(st[6]);
    const q = track.query(X, Y);
    sc[0] = q.z;
    cgNormal[0] = q.normal[0]; cgNormal[1] = q.normal[1]; cgNormal[2] = q.normal[2];
    for (let i = 0; i < 4; i++) {
      const w = track.query(X + WX[i] * c - WY[i] * s, Y + WX[i] * s + WY[i] * c);
      slopeW[i] = -(w.normal[0] * c + w.normal[1] * s) / w.normal[2]; surf[i] = w.surface;
      env.muScale[i] = w.muScale;
      env.rrExtra[i] = w.rollingResistance - ASPHALT_RR;
    }

    const nx = cgNormal[0], ny = cgNormal[1], nz = cgNormal[2];
    const kap = (0.5 * (slopeW[0] + slopeW[1]) - 0.5 * (slopeW[2] + slopeW[3])) / (p.a + p.b);
    const gN = G * nz + st[0] * st[0] * kap;
    env.gN = gN > 0 ? gN : 0;
    const ex = -(nx * c + ny * s) / nz, ey = -(-nx * s + ny * c) / nz;
    env.gx = -G * ex / Math.sqrt(1 + ex * ex);
    env.gy = -G * ey / Math.sqrt(1 + ey * ey);
  }

  function barrierResponse() {
    contact = 0;
    const c = Math.cos(st[6]), s = Math.sin(st[6]);
    for (let k = 0; k < CR.length; k++) {
      const ox = CX[k] * c - CY[k] * s, oy = CX[k] * s + CY[k] * c;
      const q = track.query(st[4] + ox, st[5] + oy);
      const b = q.barrier;
      if (!b) continue;
      const pen = CR[k] - b.dist;
      if (!(pen > 0)) continue;
      contact++;
      const nx = b.nx, ny = b.ny;
      const rcx = ox - nx * CR[k], rcy = oy - ny * CR[k];
      const cc = Math.cos(st[6]), ss = Math.sin(st[6]);
      let vwx = st[0] * cc - st[1] * ss, vwy = st[0] * ss + st[1] * cc, om = st[2];
      const vcx = vwx - om * rcy, vcy = vwy + om * rcx;
      const vn = vcx * nx + vcy * ny;
      if (vn < 0) {
        const rn = rcx * ny - rcy * nx;
        const jn = -(1 + BR.restitution) * vn / (1 / p.m + rn * rn / p.Izz);
        const tx = -ny, ty = nx;
        const vt = vcx * tx + vcy * ty;
        const rt = rcx * ty - rcy * tx;
        let jt = -vt / (1 / p.m + rt * rt / p.Izz);
        const jmax = BR.friction * jn;
        if (jt > jmax) jt = jmax; else if (jt < -jmax) jt = -jmax;
        const Jx = jn * nx + jt * tx, Jy = jn * ny + jt * ty;
        vwx += Jx / p.m; vwy += Jy / p.m;
        om += (rcx * Jy - rcy * Jx) / p.Izz;
        st[0] = vwx * cc + vwy * ss; st[1] = -vwx * ss + vwy * cc; st[2] = om;
      }
      st[4] += nx * pen; st[5] += ny * pen;
    }
  }

  function substep() {
    sampleTrack();
    const vx = st[0], vy = st[1], r = st[2];
    const deltaCmd = input.steer * lockRad;
    const target = A.countersteerAssist > 0
      ? assistTarget(deltaCmd, A.countersteerAssist, vx, vy, r, p.a, Math.hypot(vx, vy), A.assistFadeLo, A.assistFadeHi, lockRad)
      : deltaCmd;
    sc[2] = rateLimit(sc[2], target, A.steerRateLimit, dt);
    env.frontScale = cfg.ws3 ? 1 + interpTable(WS3_FRONT_DERATE_PCT, Math.abs(sc[2]) / DEG) / 100 : 1.0;
    sc[3] = slewThrottle(d, sc[3], input.throttle, dt);
    const T = (B.handbrakeCutsDrive && input.handbrake > 0) ? 0.0 : axleTorque(d, sc[3], st[3]);
    sc[5] = T;
    u[0] = sc[2]; u[1] = T; u[2] = input.handbrake; u[3] = input.brake;
    env.brakeTorque = B.footBrakeTorque;
    for (let i = 0; i < NX; i++) prev[i] = st[i];
    const V = Math.hypot(vx, vy);
    rk4Step(p, st, u, u, u, dt, acc, env, S);
    if (BR.enabled) barrierResponse();
    let ok = true;
    for (let i = 0; i < NX; i++) if (!Number.isFinite(st[i])) ok = false;
    if (!ok) {
      for (let i = 0; i < NX; i++) st[i] = prev[i];
      st[0] = 0; st[1] = 0; st[2] = 0; st[3] = 0; acc[0] = 0; acc[1] = 0;
      diverged = true;
    }
    sc[4] += V * dt;
    tick++;
  }

  function setInput(inp = {}) {
    if (inp.steer !== undefined) input.steer = clamp(num(inp.steer), -1, 1);
    if (inp.throttle !== undefined) input.throttle = clamp(num(inp.throttle), 0, 1);
    if (inp.brake !== undefined) input.brake = clamp(num(inp.brake), 0, 1);
    if (inp.handbrake !== undefined) input.handbrake = clamp(num(inp.handbrake), 0, 1);
    if (log) {
      const ev = [tick, input.steer, input.throttle, input.brake, input.handbrake];
      const last = log.events[log.events.length - 1];
      if (last && last[0] === tick) log.events[log.events.length - 1] = ev; else log.events.push(ev);
    }
  }

  function advance(frameDt) {
    sc[1] = Math.min(sc[1] + num(frameDt), cfg.maxFrame);
    while (sc[1] >= dt) { substep(); sc[1] -= dt; }
  }

  function stepTicks(n) { for (let k = 0; k < n; k++) substep(); }

  function resumeState() {
    return { tick, accum: sc[1], st: Array.from(st), acc: Array.from(acc), deltaAct: sc[2], throttleAct: sc[3],
      odometer: sc[4], lastT: sc[5], input: { ...input } };
  }

  function reset(s) {
    diverged = false; contact = 0;
    if (s && Array.isArray(s.st)) {
      for (let i = 0; i < NX; i++) st[i] = s.st[i];
      acc[0] = s.acc[0]; acc[1] = s.acc[1];
      tick = s.tick; sc[1] = s.accum; sc[2] = s.deltaAct; sc[3] = s.throttleAct; sc[4] = s.odometer; sc[5] = s.lastT || 0;
      if (s.input) Object.assign(input, s.input);
      return;
    }
    const q = s || cfg.start || {};
    st[0] = num(q.vx); st[1] = num(q.vy); st[2] = num(q.r);
    st[3] = q.w !== undefined ? num(q.w) : st[0] / p.Rw;
    st[4] = num(q.x); st[5] = num(q.y); st[6] = num(q.psi);
    acc[0] = 0; acc[1] = 0;
    tick = 0; sc[1] = 0; sc[4] = 0; sc[3] = 0; sc[5] = 0;
    sc[2] = q.delta !== undefined ? num(q.delta) : 0;
    input.steer = 0; input.throttle = 0; input.brake = 0; input.handbrake = 0;
  }

  const res = new Float64Array(7);
  const det = new Float64Array(36);
  function snapshot() {
    sampleTrack();
    forces(p, st, sc[2], acc[0], acc[1], env, res, det);
    const vx = st[0], vy = st[1], r = st[2], w = st[3];
    const V = Math.hypot(vx, vy);
    const wheels = [];
    for (let i = 0; i < 4; i++) {
      const o = i * 9;
      wheels.push({ Fz: det[o], s: det[o + 3], mu: det[o + 4], util: det[o + 6], Fx: det[o + 7], Fy: det[o + 8],
        Fxw: det[o + 1], Fyw: det[o + 2], mucap: det[o + 5], surface: surf[i] });
    }
    const capF = det[5] * det[0] + det[14] * det[9];
    const frontUtil = capF > 0 ? (Math.hypot(det[1], det[2]) + Math.hypot(det[10], det[11])) / capF : 0;

    const beta = V > 0.5 ? Math.atan2(vy, vx) : 0;
    const sgn = r >= 0 ? 1 : -1;
    const ax = acc[0], ay = acc[1];
    const vxd = ax + r * vy + env.gx, vyd = ay - r * vx + env.gy;
    const betaDot = V > 0.5 ? (vx * vyd - vy * vxd) / (V * V) : 0;
    const c = Math.cos(st[6]), s = Math.sin(st[6]);
    const nx = cgNormal[0], ny = cgNormal[1], nz = cgNormal[2];
    const lastT = sc[5], Tout = d.ratio > 0 ? lastT / (d.ratio * d.eta) : 0;
    return {
      t: tick * dt, tick,
      pose: { x: st[4], y: st[5], z: sc[0], psi: st[6],
        pitch: Math.atan(-(nx * c + ny * s) / nz), roll: Math.atan(-(-nx * s + ny * c) / nz) },
      state: { vx, vy, r, w },
      speed: V, beta,
      drift: { angle: V > 0.5 ? -beta * sgn : 0, rate: V > 0.5 ? -betaDot * sgn : 0 },
      wheels, nlift: res[6],
      frontUtil,
      gg: { ax: ax / G, ay: ay / G },
      steer: { cmd: input.steer, delta: sc[2], lockDeg: p.lock_deg },
      input: { ...input },
      drivetrain: { throttle: sc[3], torqueAxle: lastT, torqueOut: Tout, powerW: lastT * w,
        rpm: outputRpm(d, w), rpmCap: d.rpmCap, availableOut: motorTorqueAvailable(d, w) },
      rpm: outputRpm(d, w), gear: 1,
      lap: null, odometer: sc[4],
      contact, diverged,
      preset: { id: cfg.preset.id, label: cfg.preset.label, controllerMode: d.controllerMode, driverMassKg: cfg.driverMassKg,
        torqueOverrideNm: d.torqueOverrideNm },
      aero: { enabled: cfg.aero.enabled, CdA: cfg.aero.CdA, dragN: env.kDrag * p.m * V * V },
      flags: { parityMode: cfg.parity, aero: cfg.aero.enabled, countersteerAssist: A.countersteerAssist, steerRateLimit: A.steerRateLimit,
        barriers: BR.enabled, ws3Derate: cfg.ws3, handbrakeCutsDrive: B.handbrakeCutsDrive },
      resume: resumeState(),
    };
  }

  function recordInputs() {
    log = { version: 1, config: JSON.parse(JSON.stringify(cfg.raw)), initial: resumeState(), events: [] };
    log.events.push([tick, input.steer, input.throttle, input.brake, input.handbrake]);
    return log;
  }

  function stopRecording() {
    const out = log;
    if (out) out.endTick = tick;
    log = null;
    return out;
  }

  reset(null);

  return {
    setInput, advance, stepTicks, snapshot, reset, recordInputs, stopRecording,
    get tick() { return tick; },
    params: p, drivetrain: d, config: cfg, track, dt,

    _state: st,
  };
}

export function replay(log, track = testPadTrack(), { until = log.endTick } = {}) {
  const sim = createSim(log.config, track);
  sim.reset(log.initial);
  let e = 0;
  const ev = log.events;
  while (sim.tick < until) {
    while (e < ev.length && ev[e][0] <= sim.tick) {
      sim.setInput({ steer: ev[e][1], throttle: ev[e][2], brake: ev[e][3], handbrake: ev[e][4] });
      e++;
    }
    sim.stepTicks(1);
  }
  return sim;
}

export function garageOptions() {
  return { presets: Object.values(PRESETS).map((q) => ({ id: q.id, label: q.label })), controllerModes: GARAGE_MODES.slice(),
    frontSprocket: [SPROCKET_LIMITS.frontMin, SPROCKET_LIMITS.frontMax], rearSprocket: [SPROCKET_LIMITS.rearMin, SPROCKET_LIMITS.rearMax] };
}

export function garageReadouts(config = {}, table = null) {
  const cfg = resolveConfig(config);
  const p = paramsFrom(cfg.model);
  const d = makeDrivetrain(cfg.drivetrain, cfg.preset.drivetrain);
  const out = {
    preset: cfg.preset.label, controllerMode: d.controllerMode, frontSprocket: d.frontSprocket, rearSprocket: d.rearSprocket,
    ratio: d.ratio, gearedTopKmh: gearedTopKmh(d.frontSprocket, d.rearSprocket, d.rpmCap, p.Rw),
    peakOutputTorqueNm: d.Tpk, peakAxleTorqueNm: d.Tpk * d.ratio * d.eta, batteryPowerCapW: d.batteryPowerCap,
    massKg: p.m, frontPct: 100 * p.front_frac, driverMassKg: cfg.driverMassKg, torqueOverride: d.torqueOverrideNm !== null,
    achievedTopKmh: null, limiter: null, t0to30s: null, achievedExact: false,
  };
  if (table && Array.isArray(table.rows)) {
    const row = table.rows.find((r) => r.mode === d.controllerMode && r.front === d.frontSprocket && r.rear === d.rearSprocket);
    if (row) {
      out.achievedTopKmh = row.achievedTopKmh; out.limiter = row.limiter; out.t0to30s = row.t0to30s;
      const tc = table.meta && table.meta.conditions;
      out.achievedExact = !!tc && cfg.driverMassKg === tc.driverMassKg && d.torqueOverrideNm === null && cfg.aero.enabled === tc.aero
        && config.model === undefined && d.rpmCap === tc.rpmCap && d.phaseFrac === row.phaseFrac && d.batteryPowerCap === row.batteryPowerCap;
    }
  }
  return out;
}
