

import { createTiltFilter, expoFor } from './tilt.js';
import { encodeInput, decodeInput, rampSteer, rampPedal, throttleTauFor, smoothThrottle } from './shaping.js';

export const TICK_S = 1 / 60;
export const RESET_HOLD_S = 0.6;

const ZONES = ['reset', 'pause', 'handbrake', 'brake', 'throttle', 'steerLeft', 'steerRight'];
const ANALOGUE = new Set(['throttle', 'brake']);
const KEYS = Object.freeze({
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  handbrake: ['Space'],
});
const GAME_KEYS = new Set(['KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight', 'KeyW', 'ArrowUp', 'KeyS', 'ArrowDown',
  'Space', 'KeyR', 'Escape', 'KeyP']);
const MODES = new Set(['tilt', 'touchsteer', 'keyboard', 'gamepad']);

function defaultClock() { return performance.now() / 1000; }

export function createInput(opts = {}) {
  const {
    getAssist = () => 'low',
    onNudge = () => {},
    onReset = () => {},
    onPause = () => {},
    storagePrefix = 'kart.v1.',
    env = globalThis,
    clock = defaultClock,
    motionWaitS = 2.0,
  } = opts;

  const tilt = createTiltFilter();
  const calibKey = storagePrefix + 'calib.r';
  let mode = 'keyboard';
  let motion = 'idle';
  let listening = false;
  let waiter = null;
  let flatShown = false;
  let savedCalibration = false;

  const zones = Object.create(null);
  const pointers = new Map();
  const held = Object.create(null);
  let lastDown = null;
  const strip = { throttle: 0, brake: 0 };
  let resetT0 = -1;
  let resetFired = false;
  const keys = new Set();
  const ramp = { steerKey: 0, steerTouch: 0, thrKey: 0, brkKey: 0, thrStrip: 0 };
  const bytes = new Uint8Array(4);
  let last = { steer: 0, throttle: 0, brake: 0, handbrake: 0, source: mode, bytes: new Uint8Array([128, 0, 0, 0]) };

  function storage() {
    try { return env.localStorage || null; } catch { return null; }
  }
  try {
    const raw = storage() ? storage().getItem(calibKey) : null;
    if (raw) {
      const v = JSON.parse(raw);
      if (v && tilt.setReference({ x: +v.x, y: +v.y })) savedCalibration = true;
    }
  } catch {   }
  function saveReference(r) {
    try {
      const s = storage();
      if (s) s.setItem(calibKey, JSON.stringify({ x: r.x, y: r.y, t: Date.now() }));
    } catch {   }
  }

  function onMotion(e) {
    const a = e ? e.accelerationIncludingGravity : null;
    if (!a || a.x == null || a.y == null) {
      if (waiter) {
        waiter.nulls++;
        if (waiter.nulls >= 3 && clock() - waiter.t0 > 0.5) settle('unavailable');
      }
      return;
    }
    tilt.feed(+a.x, +a.y, a.z == null ? NaN : +a.z, clock());
    if (waiter && tilt.hasData) settle('granted');
    const flat = tilt.flat;
    if (flat !== flatShown) {
      flatShown = flat;
      if (mode === 'tilt') onNudge({ id: 'raise', active: flat });
    }
  }

  function settle(result) {
    const w = waiter;
    if (!w) return;
    waiter = null;
    clearTimeout(w.timer);
    motion = result === 'granted' ? 'live' : result;
    if (result !== 'granted') stopListening();
    w.resolve(result);
  }

  function listen() {
    if (!listening) { env.addEventListener('devicemotion', onMotion); listening = true; }
    if (tilt.hasData) { motion = 'live'; return Promise.resolve('granted'); }
    if (waiter) return waiter.promise;
    motion = 'waiting';
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    waiter = { resolve, promise, t0: clock(), nulls: 0, timer: 0 };
    waiter.timer = setTimeout(() => settle('unavailable'), motionWaitS * 1000);
    return promise;
  }

  function stopListening() {
    if (listening) { env.removeEventListener('devicemotion', onMotion); listening = false; }
  }

  function deny() { motion = 'denied'; return 'denied'; }

  function requestMotionPermission() {
    const DME = env.DeviceMotionEvent;
    if (!DME) { motion = 'unavailable'; return Promise.resolve('unavailable'); }
    if (typeof DME.requestPermission === 'function') {
      let p;
      try {
        p = DME.requestPermission();
      } catch {
        return Promise.resolve(deny());
      }
      return Promise.resolve(p).then((res) => (res === 'granted' ? listen() : deny()), () => deny());
    }
    return listen();
  }

  function setTouchZones(z) {
    for (const k of ZONES) delete zones[k];
    if (!z) return;
    for (const k of ZONES) {
      const r = z[k];
      if (r && r.right > r.left && r.bottom > r.top) zones[k] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
  }

  function hit(x, y) {
    for (const k of ZONES) {
      const r = zones[k];
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return k;
    }
    return null;
  }

  function stripValue(k, y) {
    const r = zones[k];
    if (!r) return 0;
    const v = (r.bottom - y) / (r.bottom - r.top);
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  function onPointerDown(e) {
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('button')) {
      lastDown = { x: e.clientX, y: e.clientY, zone: 'button', id: e.pointerId };
      return;
    }
    const k = hit(e.clientX, e.clientY);
    lastDown = { x: e.clientX, y: e.clientY, zone: k, id: e.pointerId };
    if (!k) return;
    pointers.set(e.pointerId, k);
    held[k] = (held[k] || 0) + 1;
    if (ANALOGUE.has(k)) strip[k] = stripValue(k, e.clientY);
    if (k === 'reset') { resetT0 = clock(); resetFired = false; }
  }

  function onPointerMove(e) {
    const k = pointers.get(e.pointerId);
    if (k && ANALOGUE.has(k)) strip[k] = stripValue(k, e.clientY);
  }

  function onPointerEnd(e) {
    const k = pointers.get(e.pointerId);
    if (!k) return;
    pointers.delete(e.pointerId);
    held[k] = Math.max(0, (held[k] || 0) - 1);
    if (held[k]) return;
    if (ANALOGUE.has(k)) strip[k] = 0;
    if (k === 'reset') resetT0 = -1;
    if (k === 'pause' && e.type === 'pointerup' && hit(e.clientX, e.clientY) === 'pause') onPause();
  }

  function anyKey(list) {
    for (let i = 0; i < list.length; i++) if (keys.has(list[i])) return true;
    return false;
  }

  function onKeyDown(e) {
    if (!GAME_KEYS.has(e.code)) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'KeyR') onReset();
      else if (e.code === 'Escape' || e.code === 'KeyP') onPause();
    }
    keys.add(e.code);
  }

  function onKeyUp(e) { keys.delete(e.code); }

  function clearHeld() {
    keys.clear();
    pointers.clear();
    for (const k of Object.keys(held)) held[k] = 0;
    strip.throttle = 0;
    strip.brake = 0;
    resetT0 = -1;
  }

  env.addEventListener('pointerdown', onPointerDown);
  env.addEventListener('pointermove', onPointerMove);
  env.addEventListener('pointerup', onPointerEnd);
  env.addEventListener('pointercancel', onPointerEnd);
  env.addEventListener('keydown', onKeyDown);
  env.addEventListener('keyup', onKeyUp);
  env.addEventListener('blur', clearHeld);
  const doc = env.document;
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) clearHeld(); });
  }

  function sample() {
    const assist = getAssist();
    const e = expoFor(assist);
    tilt.setExponent(e);
    const dt = TICK_S;

    const keyTarget = (anyKey(KEYS.right) ? 1 : 0) - (anyKey(KEYS.left) ? 1 : 0);
    ramp.steerKey = rampSteer(ramp.steerKey, keyTarget, dt);
    const touchTarget = (held.steerRight ? 1 : 0) - (held.steerLeft ? 1 : 0);
    ramp.steerTouch = rampSteer(ramp.steerTouch, touchTarget, dt);
    ramp.thrKey = rampPedal(ramp.thrKey, anyKey(KEYS.throttle), dt);
    ramp.brkKey = rampPedal(ramp.brkKey, anyKey(KEYS.brake), dt);
    ramp.thrStrip = smoothThrottle(ramp.thrStrip, strip.throttle, dt, throttleTauFor(assist));

    let right;
    if (mode === 'tilt') right = tilt.steer(e);
    else if (mode === 'touchsteer' && keyTarget === 0 && ramp.steerKey === 0) right = ramp.steerTouch;
    else right = ramp.steerKey;

    encodeInput({
      steer: -right,
      throttle: Math.max(ramp.thrStrip, ramp.thrKey),
      brake: Math.max(strip.brake, ramp.brkKey),
      handbrake: held.handbrake || anyKey(KEYS.handbrake) ? 1 : 0,
    }, bytes);
    const q = decodeInput(bytes);
    q.source = mode;
    q.bytes = Uint8Array.from(bytes);
    last = q;

    if (resetT0 >= 0 && !resetFired && clock() - resetT0 >= RESET_HOLD_S) {
      resetFired = true;
      onReset();
    }
    return q;
  }

  function beginCalibration() { tilt.beginCalibration(clock()); }

  function calibrationSample() {
    const s = tilt.calibrationStatus(clock());
    return { level: tilt.levelDeg(), spread: s.spreadDeg, progress: s.progress, done: s.done, active: s.active,
      magG: tilt.magG, flat: tilt.flat };
  }

  function commitCalibration() {
    const res = tilt.finishCalibration();
    if (res.ok) { saveReference(res.r); savedCalibration = true; }
    return res;
  }

  function resetProgress() {
    if (resetT0 < 0) return 0;
    const p = (clock() - resetT0) / RESET_HOLD_S;
    return p > 1 ? 1 : p;
  }

  return {
    requestMotionPermission,
    setTouchZones,
    beginCalibration,
    calibrationSample,
    commitCalibration,
    cancelCalibration() { tilt.cancelCalibration(); },
    sample,
    resetProgress,
    clearHeld,
    setMode(m) {
      if (!MODES.has(m)) return false;
      mode = m;
      last.source = m;
      if (m === 'tilt' && tilt.flat) { flatShown = true; onNudge({ id: 'raise', active: true }); }
      return true;
    },
    state() {
      return { mode, motion, throttleStrip: strip.throttle, throttle: last.throttle, brake: last.brake,
        handbrake: last.handbrake, steer: last.steer, steerLeft: !!held.steerLeft, steerRight: !!held.steerRight,
        flat: tilt.flat, calibrated: !!tilt.reference, savedCalibration };
    },

    debugInfo() {
      const rects = {};
      for (const k of ZONES) if (zones[k]) rects[k] = { ...zones[k] };
      return { zones: ZONES.filter((k) => zones[k]), rects, lastDown: lastDown ? { ...lastDown } : null, pointersHeld: pointers.size };
    },
    get mode() { return mode; },
    get motion() { return motion; },
    get hasSavedCalibration() { return savedCalibration; },
    tilt,
  };
}
