

import { kvTorque, PRESET_DRIFT, GAME_DEFAULTS, SPROCKET_LIMITS as SL, CONTROLLER_MODES } from './params.js';

const TWO_PI = 2 * Math.PI;

export function makeDrivetrain(over = {}, base = PRESET_DRIFT.drivetrain) {
  const d = { ...base, rpmTaperFrac: GAME_DEFAULTS.rpmTaperFrac, throttleSlew: GAME_DEFAULTS.throttleSlew, torqueOverrideNm: null, ...over };

  if (over.controllerMode !== undefined) {
    const cm = CONTROLLER_MODES[over.controllerMode];
    if (!cm) throw new RangeError(`controllerMode must be one of ${Object.keys(CONTROLLER_MODES).join(', ')}`);
    if (over.phaseFrac === undefined) d.phaseFrac = cm.phaseFrac;
    if (over.batteryPowerCap === undefined) d.batteryPowerCap = cm.batteryPowerCap;
  }
  if (!Number.isInteger(d.rearSprocket) || d.rearSprocket < SL.rearMin || d.rearSprocket > SL.rearMax) {
    throw new RangeError(`rearSprocket must be an integer ${SL.rearMin}..${SL.rearMax}, got ${d.rearSprocket}`);
  }
  if (!Number.isInteger(d.frontSprocket) || d.frontSprocket < SL.frontMin || d.frontSprocket > SL.frontMax) {
    throw new RangeError(`frontSprocket must be an integer ${SL.frontMin}..${SL.frontMax}, got ${d.frontSprocket}`);
  }
  d.ratio = d.rearSprocket / d.frontSprocket;
  d.Tfull = kvTorque(d.kvPoints, d.rpmCap);

  if (d.torqueOverrideNm !== null && !(d.torqueOverrideNm > 0)) throw new RangeError('torqueOverrideNm must be null or > 0');
  d.Tpk = d.torqueOverrideNm !== null ? d.torqueOverrideNm : d.phaseFrac * d.Tfull;
  d.Pmech = d.batteryPowerCap * d.etaMotorCtrl;
  d.omegaCap = d.rpmCap * TWO_PI / 60;
  d.taper = d.rpmTaperFrac * d.omegaCap;
  return d;
}

export function motorTorqueAvailable(d, w) {
  const om = Math.abs(w * d.ratio);
  let T = d.Tpk;
  if (om * T > d.Pmech) T = d.Pmech / om;
  const f = (d.omegaCap - om) / d.taper;
  if (f < 1) T *= f > 0 ? f : 0;
  return T;
}

export function axleTorque(d, throttle, w) {
  if (throttle <= 0) return 0.0;
  return throttle * motorTorqueAvailable(d, w) * d.ratio * d.eta;
}

export function outputRpm(d, w) { return w * d.ratio * 60 / TWO_PI; }

export function slewThrottle(d, current, command, dt) {
  if (!(d.throttleSlew < Infinity)) return command;
  const step = d.throttleSlew * dt;
  const e = command - current;
  return current + (e > step ? step : (e < -step ? -step : e));
}
