

import { garageOptions, garageReadouts, resolveConfig } from '../core/sim.js';
import { CONTROLLER_MODES, GARAGE_MODES, SPROCKET_LIMITS, DRIVER_REF_KG, PRESETS, paramsFrom } from '../core/params.js';

const OPTIONS = garageOptions();

export const ASSIST_LEVELS = Object.freeze({ off: 0, low: 0.3, med: 0.6, high: 0.85 });
export const ASSIST_DEFAULT = 'low';

export function isAssistLevel(level) {
  return typeof level === 'string' && Object.prototype.hasOwnProperty.call(ASSIST_LEVELS, level);
}

function assistValue(level) {
  if (!isAssistLevel(level)) throw new RangeError(`assist level must be one of ${Object.keys(ASSIST_LEVELS).join(', ')} (got ${String(level)})`);
  return ASSIST_LEVELS[level];
}

export const DEFAULT_GARAGE = Object.freeze({
  preset: 'drift',
  rearSprocket: PRESETS.drift.drivetrain.rearSprocket,
  frontSprocket: PRESETS.drift.drivetrain.frontSprocket,
  controllerMode: PRESETS.drift.drivetrain.controllerMode,
  rpmCap: PRESETS.drift.drivetrain.rpmCap,
  lockDeg: 55,
  muPeak: 1.1, muSlide: 0.8,
  driverMassKg: DRIVER_REF_KG,
  handbrakeCutsDrive: false,
  whatIf: false,
});

export const KV_OPTIONS = Object.freeze([
  { rpmCap: 1900, label: 'Low KV', torqueNm: 135 },
  { rpmCap: 2500, label: 'Central', torqueNm: 110 },
  { rpmCap: 3165, label: 'High KV', torqueNm: 90 },
]);

export const MU_OPTIONS = Object.freeze([
  { muPeak: 0.9, muSlide: 0.65, label: 'Low' },
  { muPeak: 1.1, muSlide: 0.8, label: 'Central' },
  { muPeak: 1.4, muSlide: 1.0, label: 'High' },
]);

export const LOCK_OPTIONS = Object.freeze([
  { lockDeg: 55, label: '55 (build spec, castor 6, KPI 4)' },
  { lockDeg: 34, label: '34 (stock spindles, castor 9, KPI 10)' },
]);

export function applySetup(garage, presetId) {
  const p = PRESETS[presetId];
  if (!p) return garage;
  return { ...garage, preset: presetId, rearSprocket: p.drivetrain.rearSprocket, frontSprocket: p.drivetrain.frontSprocket,
    controllerMode: p.drivetrain.controllerMode, rpmCap: p.drivetrain.rpmCap };
}

export function clampSprocket(n, which) {
  const lo = which === 'rear' ? SPROCKET_LIMITS.rearMin : SPROCKET_LIMITS.frontMin;
  const hi = which === 'rear' ? SPROCKET_LIMITS.rearMax : SPROCKET_LIMITS.frontMax;
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (which === 'rear' ? DEFAULT_GARAGE.rearSprocket : DEFAULT_GARAGE.frontSprocket);
}

export function whatIfConfig(garage) {
  const phaseFrac = CONTROLLER_MODES[garage.controllerMode] ? CONTROLLER_MODES[garage.controllerMode].phaseFrac : 1;
  return { rpmCap: 3165, torqueOverrideNm: phaseFrac * 110 };
}

export function buildConfig(garage, assist) {
  return { ...kartConfig(garage), aids: { countersteerAssist: assistValue(assist) } };
}

function kartConfig(garage) {
  const drivetrain = {
    controllerMode: garage.controllerMode,
    frontSprocket: garage.frontSprocket,
    rearSprocket: garage.rearSprocket,
    rpmCap: garage.whatIf ? whatIfConfig(garage).rpmCap : garage.rpmCap,
    torqueOverrideNm: garage.whatIf ? whatIfConfig(garage).torqueOverrideNm : null,
  };
  const cfg = {
    preset: garage.preset,
    driverMassKg: garage.driverMassKg,
    drivetrain,
    brakes: { handbrakeCutsDrive: garage.handbrakeCutsDrive },
  };
  if (garage.lockDeg !== DEFAULT_GARAGE.lockDeg || garage.muPeak !== DEFAULT_GARAGE.muPeak || garage.muSlide !== DEFAULT_GARAGE.muSlide) {
    cfg.model = { lock_deg: garage.lockDeg, mu_r_peak: garage.muPeak, mu_r_slide: garage.muSlide };
  }
  return cfg;
}

export function kartGeometry(garage) {
  const p = paramsFrom(resolveConfig(kartConfig(garage)).model);
  return { a: p.a, b: p.b, tf: p.tf, tr: p.tr, Rw: p.Rw };
}

export function garageHash(garage, assist) {
  const parts = [garage.preset, garage.rearSprocket, garage.frontSprocket, garage.controllerMode, garage.rpmCap,
    garage.lockDeg, garage.muPeak, garage.muSlide, garage.driverMassKg, garage.handbrakeCutsDrive, garage.whatIf,
    `assist:${assist}=${assistValue(assist)}`];
  const s = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function computeReadouts(garage, table, assist) {
  return { ...garageReadouts(kartConfig(garage), table), hash: garageHash(garage, assist), whatIf: garage.whatIf };
}

export function setupSummary(config) {
  const r = garageReadouts(config);
  return { label: r.preset, gearedTopKmh: r.gearedTopKmh };
}

export const SETUP_FIELDS = Object.freeze(['preset', 'frontSprocket', 'rearSprocket', 'controllerMode', 'rpmCap']);
export const CONTEXT_PRESET = Object.freeze({ circuit: 'track', drift: 'drift' });

export function setupContext(mode, circuitKey) {
  if (mode === 'drift' || !circuitKey || circuitKey === 'test.pad') return 'drift';
  return 'circuit';
}

function pickSetup(g) {
  const out = {};
  for (const k of SETUP_FIELDS) out[k] = g[k];
  return out;
}

function validSetup(r) {
  return !!r && typeof r === 'object'
    && Object.prototype.hasOwnProperty.call(PRESETS, r.preset)
    && GARAGE_MODES.includes(r.controllerMode)
    && KV_OPTIONS.some((k) => k.rpmCap === r.rpmCap)
    && Number.isInteger(r.frontSprocket) && clampSprocket(r.frontSprocket, 'front') === r.frontSprocket
    && Number.isInteger(r.rearSprocket) && clampSprocket(r.rearSprocket, 'rear') === r.rearSprocket;
}

export function setupFor(context, remembered) {
  const r = remembered && typeof remembered === 'object' ? remembered[context] : null;
  if (validSetup(r)) return pickSetup(r);
  return pickSetup(applySetup(DEFAULT_GARAGE, CONTEXT_PRESET[context] || 'drift'));
}

export function garageFor(garage, context, remembered) {
  return { ...garage, ...setupFor(context, remembered) };
}

export function rememberSetup(remembered, context, garage) {
  const base = remembered && typeof remembered === 'object' ? remembered : {};
  return { ...base, [context]: pickSetup(garage) };
}

export function migrateSetups(savedGarage) {
  if (!savedGarage || typeof savedGarage !== 'object' || !validSetup(savedGarage)) return {};
  const context = savedGarage.preset === 'track' ? 'circuit' : 'drift';
  return { [context]: pickSetup(savedGarage) };
}

export function controllerModeOptions() {
  return Object.keys(CONTROLLER_MODES).map((id) => ({
    id, offered: GARAGE_MODES.includes(id),
    reasonIfNotOffered: id === 'LOW' ? '3.6 kW cannot hold a drift' : '',
    phaseFrac: CONTROLLER_MODES[id].phaseFrac, batteryPowerCap: CONTROLLER_MODES[id].batteryPowerCap,
  }));
}

export function presetOptions() { return OPTIONS.presets; }
export function sprocketRange() { return { front: OPTIONS.frontSprocket, rear: OPTIONS.rearSprocket }; }
