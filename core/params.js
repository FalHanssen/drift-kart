

export const G = 9.81;

export const DEFAULT_PARAMS = Object.freeze({
  name: 'STOCK',
  m: 175.0, h: 0.28, L: 0.92, front_frac: 0.33, Izz: 25.0,
  tf: 1.00, tr: 1.00, kf_kr: 1.0, Rw: 0.14, I_axle: 0.35,
  mu_f: 1.10, slide_ratio_f: 0.85, sp_f: 0.12, drop_k_f: 2.0,
  rear: 'R', mu_r_peak: 1.10, mu_r_slide: 0.80, sp_r: 0.12, drop_k: 2.0,
  mu_pvc: 0.30, s0_pvc: 0.01,
  ls_f: 0.10, ls_r: 0.10, Fz0: 430.0,
  load_transfer: true, lt_long: true, lt_lat: true,
  f_rr: 0.015, ackermann: 0.0, lock_deg: 45.0, T_hb: 400.0, v_eps: 1.0,
});

export const SEEDS = Object.freeze({
  STOCK: Object.freeze({ L: 0.92, front_frac: 0.33, Izz: 25.0 }),
  B: Object.freeze({ L: 1.10, front_frac: 0.52, Izz: 28.0 }),
  A: Object.freeze({ L: 1.25, front_frac: 0.50, Izz: 32.0 }),
});

const PARAM_KEYS = Object.keys(DEFAULT_PARAMS);

export function deriveParams(p) {
  p.a = p.L * (1.0 - p.front_frac);
  p.b = p.L * p.front_frac;
  const kf = p.kf_kr, kr = 1.0;
  p.chi_f = kf * p.tf ** 2 / (kf * p.tf ** 2 + kr * p.tr ** 2);
  p.rearKind = p.rear === 'R' ? 1 : 2;
  return p;
}

export function paramsFrom(dict) {
  const p = {};
  for (const k of PARAM_KEYS) p[k] = (dict && dict[k] !== undefined) ? dict[k] : DEFAULT_PARAMS[k];
  return deriveParams(p);
}

export function makeParams(config = 'STOCK', rear = 'R', over = {}) {
  const base = SEEDS[config] ? { ...SEEDS[config] } : {};
  return paramsFrom({ ...DEFAULT_PARAMS, ...base, ...over, name: config, rear });
}

export const PRESET_DRIFT = Object.freeze({
  id: 'drift',
  label: 'Drift setup',
  model: Object.freeze({
    m: 178.99, front_frac: 0.4654, h: 0.2313, Izz: 35.56, L: 1.25,
    Rw: 0.1395,
    mu_r_peak: 1.1, mu_r_slide: 0.8, mu_f: 1.1,
    rear: 'R', lock_deg: 55.0,
  }),
  drivetrain: Object.freeze({
    frontSprocket: 14, rearSprocket: 45,
    eta: 0.95,
    controllerMode: 'MID',
    phaseFrac: 0.75,
    rpmCap: 2500,
    batteryPowerCap: 7200,
    etaMotorCtrl: 0.90,
    kvPoints: Object.freeze([[1900, 135], [2500, 110], [3165, 90]]),
  }),
});

export const CONTROLLER_MODES = Object.freeze({
  LOW: Object.freeze({ phaseFrac: 0.50, batteryPowerCap: 3600 }),
  MID: Object.freeze({ phaseFrac: 0.75, batteryPowerCap: 7200 }),
  HIGH: Object.freeze({ phaseFrac: 1.00, batteryPowerCap: 14400 }),
});
export const GARAGE_MODES = Object.freeze(['MID', 'HIGH']);

export const DRIVER_REF_KG = 76;
const R76 = { m: 178.988022, ff: 0.465411, h: 0.231292, Izz: 35.555843 };
const R85 = { m: 187.988022, ff: 0.466745, h: 0.237345, Izz: 36.326922 };
const DRV = {
  ffMoment: (R85.m * R85.ff - R76.m * R76.ff) / (R85.m - R76.m),
  z: (R85.m * R85.h - R76.m * R76.h) / (R85.m - R76.m),
  dIzz: (R85.Izz - R76.Izz) / (R85.m - R76.m),
};
export function applyDriverMass(model, driverKg) {
  const dm = driverKg - DRIVER_REF_KG;
  if (dm === 0) return model;
  const m = model.m + dm;
  return { ...model, m, front_frac: (model.m * model.front_frac + dm * DRV.ffMoment) / m,
    h: (model.m * model.h + dm * DRV.z) / m, Izz: model.Izz + dm * DRV.dIzz };
}

export const SPROCKET_LIMITS = Object.freeze({ rearMin: 14, rearMax: 60, frontMin: 11, frontMax: 20 });

export function gearedTopKmh(front, rear, rpmCap, Rw) {
  return rpmCap * 2 * Math.PI / 60 / (rear / front) * Rw * 3.6;
}

export function gearForTopSpeed(targetKmh, rpmCap, Rw, L = SPROCKET_LIMITS) {
  let best = null;
  for (let f = L.frontMin; f <= L.frontMax; f++) {
    for (let r = L.rearMin; r <= L.rearMax; r++) {
      const kmh = gearedTopKmh(f, r, rpmCap, Rw);
      const err = Math.abs(kmh - targetKmh);
      if (!best || err < best.err - 0.05 || (Math.abs(err - best.err) <= 0.05 && Math.abs(f - 14) < Math.abs(best.front - 14))) {
        best = { front: f, rear: r, kmh, err };
      }
    }
  }
  return { front: best.front, rear: best.rear, kmh: best.kmh };
}

export function kvTorque(kvPoints, rpmCap) {
  const k = kvPoints;
  if (rpmCap <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (rpmCap <= k[i][0]) {
      const f = (rpmCap - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      return k[i - 1][1] + f * (k[i][1] - k[i - 1][1]);
    }
  }
  return k[k.length - 1][1];
}

const TRACK_GEAR = gearForTopSpeed(120, 2500, PRESET_DRIFT.model.Rw);
export const PRESET_TRACK = Object.freeze({
  id: 'track',
  label: 'Track setup',
  model: PRESET_DRIFT.model,
  drivetrain: Object.freeze({
    ...PRESET_DRIFT.drivetrain,
    frontSprocket: TRACK_GEAR.front, rearSprocket: TRACK_GEAR.rear,
    controllerMode: 'HIGH',
    phaseFrac: 1.0,
    batteryPowerCap: 14400,
    rpmCap: 2500,
  }),
  gearedTopKmh: TRACK_GEAR.kmh,
});

export const PRESETS = Object.freeze({ drift: PRESET_DRIFT, track: PRESET_TRACK });

export const AERO_DEFAULTS = Object.freeze({ enabled: true, rho: 1.2, CdA: 0.55 });

export const SURFACES = Object.freeze({
  asphalt: Object.freeze({ id: 0, muScale: 1.0, rollingResistance: 0.015 }),
  kerb: Object.freeze({ id: 1, muScale: 0.9, rollingResistance: 0.03 }),
  grass: Object.freeze({ id: 2, muScale: 0.55, rollingResistance: 0.06 }),
  gravel: Object.freeze({ id: 3, muScale: 0.5, rollingResistance: 0.25 }),
});
export const ASPHALT_RR = SURFACES.asphalt.rollingResistance;

export const WS3_FRONT_DERATE_PCT = Object.freeze([[0, 0.0], [30, -1.8232], [45, -2.7532], [55, -2.2115]]);

export function interpTable(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const f = (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
      return tab[i - 1][1] + f * (tab[i][1] - tab[i - 1][1]);
    }
  }
  return tab[tab.length - 1][1];
}

export const GAME_DEFAULTS = Object.freeze({
  dt: 5e-4,
  maxFrame: 0.05,
  footBrakeTorque: 400.0,
  handbrakeCutsDrive: false,
  throttleSlew: Infinity,
  rpmTaperFrac: 0.005,

  steerRateLimit: 6.0,
  countersteerAssist: 0.0,
  assistFadeLo: 1.0,
  assistFadeHi: 3.0,
  ws3Derate: true,
  barriers: true,
  restitution: 0.2,
  barrierFriction: 0.4,

  bodyCircles: Object.freeze([
    Object.freeze({ at: 'front', dx: 0.10, y: 0.0, r: 0.60 }),
    Object.freeze({ at: 'cg', dx: 0.0, y: 0.0, r: 0.60 }),
    Object.freeze({ at: 'rear', dx: -0.05, y: 0.0, r: 0.65 }),
  ]),
});
