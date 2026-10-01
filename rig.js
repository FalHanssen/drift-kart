

import { createInput } from './input/input.js';
import { createRigSession, SETUPS, PAD, TICK_S } from './ui/rigSession.js';
import { createRigUi, tryFullscreenLandscape, keepAwake } from './ui/rigUi.js';
import { createChaseCamera } from './render/chaseCamera.js';
import { reportFailure } from './shared/diagnostics.js';

const RIG_VERSION = '0.1.0';
const MAX_TICKS_PER_FRAME = 3;
const MAX_FRAME_S = 0.05;
const R2D = 180 / Math.PI;
const TWO_PI = 2 * Math.PI;
const FRONT_TYRE_R = 0.127;
const ASSIST_NAMES = Object.freeze({ off: 'Off', low: 'Low 0.3', med: 'Med 0.6', high: 'High 0.85' });
const CALIB_PROMPT = 'Hold the phone the way you will drive, then tap Set centre and keep still for a second.';

let state = 'title';
let rotateUp = false;
let view = null;
let calib = 'ready';
let acc = 0;
let lastFrame = 0;
let slowUntil = 0;
let hudAt = 0;
let spinFront = 0;
let spinRear = 0;
const drops = [];

const session = createRigSession();
const camera = createChaseCamera();
const ui = createRigUi(document, {
  start, useTouch, retryMotion, calibrate, keepCalibration, resume, recentre, resetKart,
  assist: setAssist, setup: setSetup,
});
const input = createInput({
  getAssist: () => session.assist,
  onNudge: ({ id, active }) => {
    if (id === 'raise') ui.nudge(active && state === 'drive' ? 'Raise the phone' : null);
  },
  onReset: () => { if (state === 'drive') resetKart(); },
  onPause: () => {
    if (state === 'drive') go('pause');
    else if (state === 'pause') go('drive');
  },
});

window.addEventListener('error', (e) => ui.error(`Something failed: ${e.message || 'unknown error'}. Reload to try again.`));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  ui.error(`Something failed: ${(r && r.message) || r}. Reload to try again.`);
});
document.addEventListener('securitypolicyviolation', (e) => ui.error(`Blocked by the page security policy (${e.violatedDirective}).`));
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

function go(next) {
  state = next;
  ui.setState(next);
  ui.show(next === 'drive' ? null : next);
  if (next === 'drive') {
    requestAnimationFrame(refreshZones);
    ui.nudge(input.mode === 'tilt' && input.state().flat ? 'Raise the phone' : null);
  } else {
    input.setTouchZones(null);
    input.clearHeld();
    ui.nudge(null);
  }
  if (next === 'calib') {
    calib = 'ready';
    ui.calibState('ready', CALIB_PROMPT, null, input.hasSavedCalibration);
  }
  acc = 0;
  checkRotate();
}

function start() {
  if (state !== 'title') return;
  const permission = input.requestMotionPermission();
  tryFullscreenLandscape(document, navigator);
  keepAwake(document, navigator);
  go('checking');
  permission.then(onPermission, () => onPermission('denied'));
}

function retryMotion() {
  if (state !== 'denied') return;
  const permission = input.requestMotionPermission();
  go('checking');
  permission.then(onPermission, () => onPermission('denied'));
}

function onPermission(result) {
  if (state !== 'checking') return;
  if (result === 'granted') {
    setMode('tilt');
    go('calib');
  } else if (result === 'denied') {
    go('denied');
  } else {
    const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    setMode(touch ? 'touchsteer' : 'keyboard');
    go('drive');
    ui.flash(touch ? 'No motion sensor: touch steering' : 'No motion sensor: keyboard controls', 'info', 2600);
  }
}

function setMode(mode) {
  input.setMode(mode);
  ui.setMode(mode);
}

function useTouch() {
  setMode('touchsteer');
  go('drive');
}

function resume() { go('drive'); }

function recentre() {
  if (input.mode === 'tilt') go('calib');
}

function resetKart() {
  session.reset();
  camera.reset();
  acc = 0;
  ui.flash('Kart reset', 'info', 800);
  if (state === 'pause') go('drive');
}

function setAssist(level) {
  if (!session.setAssist(level)) return;
  ui.setAssist(session.assist);
  ui.flash(`Assist ${ASSIST_NAMES[session.assist]}`, 'info', 900);
}

function setSetup(id) {
  if (!session.setSetup(id)) return;
  ui.setSetup(session.setup);
  ui.flash(SETUPS[session.setup], 'info', 900);
}

function calibrate() {
  if (state !== 'calib' || calib !== 'ready' || rotateUp) return;
  input.beginCalibration();
  calib = 'capturing';
  ui.calibState('capturing', 'Keep still...', null, false);
}

function keepCalibration() {
  if (state === 'calib' && calib === 'ready') go('drive');
}

function calibFrame() {
  const s = input.calibrationSample();
  ui.calibView(s);
  if (calib !== 'capturing' || !s.done) return;
  const res = input.commitCalibration();
  if (res.ok) {
    calib = 'done';
    ui.calibState('done', 'Centre set.', 'good', false);
    setTimeout(() => { if (state === 'calib' && calib === 'done') go('drive'); }, 700);
    return;
  }
  calib = 'ready';
  const why = res.reason === 'flat'
    ? 'The phone is too flat. Raise it toward upright, then tap Set centre again.'
    : res.reason === 'moving'
      ? 'Too much movement. Hold still, then tap Set centre again.'
      : 'No sensor readings came in. Tap Set centre again; if it repeats, reload the page.';
  ui.calibState('ready', why, 'bad', input.hasSavedCalibration);
}

function refreshZones() {
  if (state === 'drive' && !rotateUp) input.setTouchZones(ui.zoneRects());
}

function checkRotate() {
  const on = state !== 'title' && window.innerHeight > window.innerWidth;
  if (on === rotateUp) return;
  rotateUp = on;
  ui.rotate(on);
  acc = 0;
  if (on) {
    input.setTouchZones(null);
    input.clearHeld();
    if (state === 'calib' && calib === 'capturing') {
      input.cancelCalibration();
      calib = 'ready';
      ui.calibState('ready', 'The phone turned, so that capture was dropped. Hold it in landscape, then tap Set centre.', 'bad', input.hasSavedCalibration);
    }
  } else {
    requestAnimationFrame(refreshZones);
  }
}

function onResize() {
  if (view) view.resize(ui.canvas.clientWidth, ui.canvas.clientHeight);
  checkRotate();
  requestAnimationFrame(refreshZones);
}

function onVisibility() {
  if (document.hidden && state === 'drive') go('pause');
}

function noteDrop(now) {
  drops.push(now);
  while (drops.length && now - drops[0] > 2000) drops.shift();
  if (drops.length >= 3) slowUntil = now + 2000;
}

function tickOnce() {
  session.tick(input.sample());
  const ev = session.hold.events;
  if (ev.spin) ui.flash('Spin', 'bad', 1000);
  else if (ev.target) ui.flash('5 s held', 'good', 1600);
}

function draw(alpha, dt, now) {
  const s = session.snapshot;
  const p0 = session.prevPose, p1 = s.pose;
  const x = p0.x + (p1.x - p0.x) * alpha;
  const y = p0.y + (p1.y - p0.y) * alpha;
  let d = p1.psi - p0.psi;
  d -= TWO_PI * Math.round(d / TWO_PI);
  const psi = p0.psi + d * alpha;
  if (view && !rotateUp) {
    spinRear = (spinRear + s.state.w * dt) % TWO_PI;
    spinFront = (spinFront + (s.state.vx / FRONT_TYRE_R) * dt) % TWO_PI;
    view.setKart(x, y, psi, s.steer.delta, spinFront, spinRear);
    const c = camera.update(x, y, p1.z, psi, s.beta, s.speed, dt);
    view.setCamera(c.pos, c.look, c.fovDeg);
    view.render();
  }
  if (state === 'drive' || state === 'pause' || state === 'calib') {
    ui.controls(input.state(), input.resetProgress());
    if (now - hudAt >= 66) {
      hudAt = now;
      ui.hud({ speedKmh: s.speed * 3.6, driftDeg: s.drift.angle * R2D, betaDeg: s.beta * R2D, hold: session.hold, slow: now < slowUntil });
      ui.debug({ mode: input.mode, steer: s.steer.cmd, throttle: s.input.throttle, speedKmh: s.speed * 3.6,
        coreAssist: session.coreAssist, corePreset: session.corePreset });
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = lastFrame ? (now - lastFrame) / 1000 : 0;
  lastFrame = now;
  if (!(dt > 0)) dt = 0;
  const running = state === 'drive' && !rotateUp && !document.hidden;
  if (dt > MAX_FRAME_S) {
    if (running) noteDrop(now);
    dt = MAX_FRAME_S;
  }
  if (running) {
    acc += dt;
    let n = 0;
    while (acc >= TICK_S && n < MAX_TICKS_PER_FRAME) { tickOnce(); acc -= TICK_S; n++; }
    if (acc >= TICK_S) { acc = 0; noteDrop(now); }
  }
  if (state === 'calib') calibFrame();
  draw(running ? acc / TICK_S : 1, running ? dt : 0, now);
}

async function boot() {
  ui.setAssist(session.assist);
  ui.setSetup(session.setup);
  ui.setMode(input.mode);
  try {
    const { createRigView } = await import('./render/scene.js');
    const p = session.params;
    view = createRigView(ui.canvas, {
      a: p.a, b: p.b, tf: p.tf, tr: p.tr, Rw: p.Rw, padHalf: PAD.half, circles: PAD.circles, coneInset: PAD.coneInset,
    });
    view.resize(ui.canvas.clientWidth, ui.canvas.clientHeight);
    ui.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      ui.error('The 3D view was lost. Reload the page to get it back.');
    });
  } catch (err) {
    reportFailure('Renderer creation failed', err);
    ui.error(`The 3D view could not start (${(err && err.message) || err}). Reload to try again.`);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  ui.ready(RIG_VERSION);
  requestAnimationFrame(frame);
}

boot();
