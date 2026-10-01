

import { STORAGE_PREFIX, TRACK_SCHEMA, BUILD_ID } from './shared/versions.js';
import { createInput } from './input/input.js';
import { createDriveSession, TICK_S, isGhostUsable } from './modes/session.js';
import { createGhostPlayer } from './modes/replay.js';
import * as storage from './modes/storage.js';
import * as garageModel from './modes/garage.js';
import { createChaseCamera } from './render/chaseCamera.js';
import { createHelmetCamera } from './render/helmetCamera.js';
import { drawnPose, surfacePose } from './render/kartPose.js';
import { createAudioEngine } from './audio/engine.js';
import { createTitleHomeUi, tryFullscreenLandscape, keepAwake } from './ui/titleHome.js';
import { createOnboardingUi, TESTPAD_STEPS, testpadPrompt, routeAfterPermission, livenessVerdict, routeAfterLiveness,
  calibFailure, calibDoneTarget } from './ui/onboarding.js';
import { createGarageUi } from './ui/garageUi.js';
import { createSettingsUi } from './ui/settingsUi.js';
import { createDriveUi } from './ui/driveUi.js';
import { reportFailure } from './shared/diagnostics.js';
import { applyCanvasVisibility, canvasForState } from './shared/canvasVisibility.js';
import { isLiveRun, hudShownIn, createZoneSync } from './shared/runState.js';
import { inputDebugRequested, createInputDebug, simStateLabel } from './shared/inputDebug.js';
import { debugLogRequested, createDebugLog, describeCalibration } from './shared/debugLog.js';
import { createTurntable } from './ui/garageTurntable.js';
import { loadTrack, loadSectors } from './track/track.js';
import { buildTrackMeshes } from './track/mesh.js';
import { testPadTrack } from './core/track.js';

const CORE_VERSION = 1;
const MAX_TICKS_PER_FRAME = 3;
const MAX_FRAME_S = 0.05;
const TWO_PI = 2 * Math.PI;
const R2D = 180 / Math.PI;
const FRONT_TYRE_R = 0.127;
const PAD = Object.freeze({ half: 60, circles: [10, 20], coneInset: 1.5, start: { x: -15, y: -10, heading: 0, s: 0 } });

const CIRCUITS = [];
let SECTORS = null;
let GARAGE_TABLE = null;

const trackCache = new Map();

let state = 'title';
let rotateUp = false;
let view = null;
let viewKind = null;
let turntable = null;
let turntableLoad = null;
let calib = 'ready';
let calibFailStreak = 0;
let calibReturn = null;
let liveCheck = null;
let pendingFlash = null;
let acc = 0;
let lastFrame = 0;
let slowUntil = 0;
let hudAt = 0;
let spinFront = 0, spinRear = 0;
const drops = [];

let settings = storage.loadSettings();
let garage = { ...garageModel.DEFAULT_GARAGE, ...(storage.loadGarage() || {}) };

if (!settings.setups || typeof settings.setups !== 'object') {
  settings.setups = garageModel.migrateSetups(storage.loadGarage());
  storage.saveSettings(settings);
}

let assist = garageModel.isAssistLevel(settings.assistDefault) ? settings.assistDefault : garageModel.ASSIST_DEFAULT;
let whatIf = !!settings.whatIf;

let selection = { mode: 'drift', circuitKey: 'winton.club', ref: null };
let session = null;
let sessionContext = 'drift';
let replayPlayer = null;
let replayTrack = null;
const kartGround = {};
const ghostGround = {};
let introStep = 0;
let testpadStartedAt = 0;
let pausedFrom = 'drive';
let introPausedAt = 0;

const chase = createChaseCamera();
const helmet = createHelmetCamera();
let cameraMode = settings.camera === 'helmet' ? 'helmet' : 'chase';

const audio = createAudioEngine();

const input = createInput({
  getAssist: () => assist,
  onNudge: ({ id, active }) => { if (id === 'raise') driveUi.nudge(active && isLiveRun(state) ? 'Raise the phone' : null); },
  onReset: () => { if (isLiveRun(state)) resetKart(); },
  onPause: () => {
    if (isLiveRun(state)) pauseRun();
    else if (state === 'pause') resume();
  },
});

const debugLog = createDebugLog({
  enabled: debugLogRequested(location.search), win: window, doc: document, build: BUILD_ID, initialState: state,
  getStorage: () => window.localStorage,
  getSample: debugSample,
  getLastDown: () => input.debugInfo().lastDown,
  onOpen: () => { if (isLiveRun(state)) pauseRun(); },
  pauseHost: document.querySelector('#scr-pause .row'),
});

const titleHome = createTitleHomeUi(document, {
  start, useTouch, retryMotion, calibrate, keepCalibration,
  selectMode, selectCircuit, selectRef, selectReplay,
  openGarage: () => go('garage'), openSettings: () => go('settings'), drive: beginDrive,
});
const onboarding = createOnboardingUi(document, { testpadReady: () => finishIntro(), useFallbackSteer: (mode) => useFallbackSteer(mode) });
const garageUi = createGarageUi(document, { back: () => { persistGarage(); go('home'); }, change: onGarageChange, setup: onSetupChange, whatIf: onWhatIfToggle,
  lockFocus: (on) => { if (turntable) turntable.showLock(on ? garage.lockDeg : null); } });
const settingsUi = createSettingsUi(document, {
  back: () => go('home'),
  backToSettings: () => go('settings'),
  change: onSettingsChange,
  recalibrate: () => openCalibration('settings'),
  redoIntro: () => { settings.introDone = false; storage.saveSettings(settings); },
  clearAll: () => { storage.clearAll(); settings = storage.loadSettings(); garage = { ...garageModel.DEFAULT_GARAGE }; },
  openWhatThis: () => go('whatthis'),
  openCredits: () => go('credits'),
});
const driveUi = createDriveUi(document, {
  resume, recentre, resetKart,
  setAssist: (level) => { setAssist(level); },
  cycleCamera: () => { cameraMode = cameraMode === 'chase' ? 'helmet' : 'chase'; chase.reset(); helmet.reset(); },
  quit: () => { session = null; go('home'); },
  retry: () => { startSession(); go('drive'); },
  saveReplay: (label) => { if (session) session.saveLastReplay(label); },
  home: () => go('home'),
});

const zoneSync = createZoneSync({ input, zoneRects: () => driveUi.zoneRects(), getState: () => state, getRotateUp: () => rotateUp,
  schedule: (fn) => requestAnimationFrame(() => fn()), onChange: () => { if (debugLog) debugLog.zones(input.debugInfo().rects); } });

const inputDebug = createInputDebug({ doc: document, win: window, enabled: inputDebugRequested(location.search), getData: inputDebugData });

window.addEventListener('error', (e) => driveUi.error(`Something failed: ${e.message || 'unknown error'}. Reload to try again.`));
window.addEventListener('unhandledrejection', (e) => { const r = e.reason; driveUi.error(`Something failed: ${(r && r.message) || r}. Reload to try again.`); });
document.addEventListener('securitypolicyviolation', (e) => driveUi.error(`Blocked by the page security policy (${e.violatedDirective}).`));
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

function fail(label, err) { reportFailure(label, err); if (debugLog) debugLog.failure(label, err); }

function syncCanvasVisibility(next) {
  applyCanvasVisibility(next, { view: document.getElementById('view'), garage: document.getElementById('garage-view') }, view, turntable);
}

function go(next) {
  const prev = state;
  state = next;
  if (debugLog) debugLog.state(prev, next);
  driveUi.setState(next);
  const overlay = next === 'drive' ? null : next;
  showScreen(overlay);
  syncCanvasVisibility(next);
  if (prev === 'garage' && next !== 'garage' && turntable) turntable.leave();
  zoneSync.enter(next);
  driveUi.nudge(isLiveRun(next) && input.mode === 'tilt' && input.state().flat ? 'Raise the phone' : null);
  if (next === 'drive') audio.event('select');
  else if (prev === 'drive' && next !== 'pause') audio.event('back');
  if (prev === 'testpad' && next === 'pause') introPausedAt = performance.now() / 1000;
  if (next === 'calib') { calib = 'ready'; calibFailStreak = 0; onboarding.calibState('ready', 'Hold the phone the way you will drive, then tap Set centre and keep still for a second.', null, input.hasSavedCalibration); }
  if (pendingFlash && hudShownFor(next)) { driveUi.flash(pendingFlash, 'info', 2600); pendingFlash = null; }
  if (next === 'testpad') {

    if (prev === 'pause' && session) testpadStartedAt += performance.now() / 1000 - introPausedAt;
    else startIntro();
  }
  if (next === 'home') renderHome();
  if (next === 'garage') { renderGarage(); enterGarage(); }
  if (next === 'settings') settingsUi.render(settings, storage.storageUsageBytes(), { tilt: input.mode === 'tilt' });
  if (next === 'whatthis') settingsUi.renderWhatThis();
  if (next === 'credits') loadCredits();
  acc = 0;
  checkRotate();
}

const SCREEN_IDS = ['title', 'checking', 'denied', 'calib', 'testpad', 'home', 'garage', 'settings', 'whatthis', 'credits', 'pause', 'results', 'rotate'];

function hudShownFor(stateName) { return hudShownIn(stateName); }
function showScreen(name) {
  for (const id of SCREEN_IDS) { const el = document.getElementById(`scr-${id}`); if (el) el.hidden = id !== name; }
  const hud = document.getElementById('hud');
  hud.hidden = !(name === null || hudShownFor(name));
}

function announce(text) {
  if (hudShownFor(state)) driveUi.flash(text, 'info', 2600);
  else pendingFlash = text;
}

function start() {
  if (state !== 'title') return;
  const permission = input.requestMotionPermission();
  tryFullscreenLandscape(document, navigator);
  keepAwake(document, navigator);
  audio.unlock();
  go('checking');
  permission.then(onPermission, () => onPermission('denied'));
}
function retryMotion() {
  if (state !== 'denied') return;
  const permission = input.requestMotionPermission();
  go('checking');
  permission.then(onPermission, () => onPermission('denied'));
}
function isTouchDevice() { return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window; }

function motionSamples() { const st = input.tilt.stats; return st.accepted + st.rejected; }

function applyRoute(route) {
  if (route.mode) setMode(route.mode);
  calibReturn = null;
  go(route.next);
  if (route.flash) announce(route.flash);
}
function onPermission(result) {
  if (debugLog) debugLog.note('motion', `permission ${result}${state === 'checking' ? '' : ` (arrived in ${state}, ignored)`}`);
  if (state !== 'checking') return;
  const route = routeAfterPermission(result, { introDone: settings.introDone, touch: isTouchDevice() });
  if (route.confirmLive) {

    setMode(route.mode);
    liveCheck = { t0: performance.now() / 1000, n0: motionSamples() };
    return;
  }
  applyRoute(route);
}
function livenessFrame(nowS) {
  const verdict = livenessVerdict(motionSamples() - liveCheck.n0, nowS - liveCheck.t0);
  if (verdict === 'wait') return;
  if (debugLog) debugLog.note('motion', `liveness check ${verdict}: ${motionSamples() - liveCheck.n0} readings in ${(nowS - liveCheck.t0).toFixed(1)} s`);
  liveCheck = null;
  applyRoute(routeAfterLiveness(verdict, { introDone: settings.introDone, touch: isTouchDevice() }));
}
function setMode(mode) {
  if (debugLog && input.mode !== mode) debugLog.note('mode', `${input.mode} > ${mode}`);
  input.setMode(mode);
  driveUi.setMode(mode);
}
function useTouch() { setMode('touchsteer'); calibReturn = null; go(settings.introDone ? 'home' : 'testpad'); }

function openCalibration(returnTo) {
  if (input.mode !== 'tilt') return;
  calibReturn = returnTo;
  go('calib');
}
function leaveCalibration() {
  const to = calibDoneTarget(calibReturn, settings.introDone);
  calibReturn = null;
  calibFailStreak = 0;
  go(to);
}
function calibrate() {
  if (state !== 'calib' || calib !== 'ready' || rotateUp) return;
  input.beginCalibration();
  if (debugLog) debugLog.note('calib', 'capture started');
  calib = 'capturing';
  onboarding.calibState('capturing', 'Keep still...', null, false);
}
function keepCalibration() {
  if (state !== 'calib' || calib !== 'ready') return;
  if (debugLog) debugLog.note('calib', 'kept the saved centre');
  leaveCalibration();
}

function useFallbackSteer(mode) {
  if (state !== 'calib' || calib === 'capturing') return;
  setMode(mode);
  leaveCalibration();
  announce(mode === 'keyboard' ? 'Keyboard controls' : 'Touch steering');
}
function calibFrame() {
  const s = input.calibrationSample();
  onboarding.calibView(s);
  if (calib !== 'capturing' || !s.done) return;
  const res = input.commitCalibration();
  if (debugLog) debugLog.note('calib', describeCalibration(res));
  if (res.ok) {
    calib = 'done';
    calibFailStreak = 0;
    onboarding.calibState('done', 'Centre set.', 'good', false);
    setTimeout(() => { if (state === 'calib' && calib === 'done') leaveCalibration(); }, 700);
    return;
  }
  calib = 'ready';
  const f = calibFailure(res, calibFailStreak, { touch: isTouchDevice() });
  calibFailStreak = f.streak;
  onboarding.calibState('ready', f.message, 'bad', input.hasSavedCalibration, f.fallbacks);
}

async function startIntro() {
  introStep = 0;
  testpadStartedAt = performance.now() / 1000;
  replayPlayer = null; replayTrack = null;
  sessionContext = 'drift';
  const config = runConfig(sessionContext);
  session = createDriveSession({ mode: 'free', track: testPadTrack(), sectorData: null, ref: 'intro',
    circuit: 'test', layout: 'pad', trackSchema: TRACK_SCHEMA, config,
    garageHash: runHash(sessionContext), assist, launchPose: PAD.start });
  driveUi.setSetup(garageModel.setupSummary(config));
  await ensurePadView();
  onboarding.showPrompt(testpadPrompt(TESTPAD_STEPS[0], input.mode), false);
}
function finishIntro() {
  settings.introDone = true;
  storage.saveSettings(settings);
  go('home');
}
function introFrame(now) {
  const elapsed = now - testpadStartedAt;
  const step = TESTPAD_STEPS.findIndex((s, i) => elapsed < s.untilS || i === TESTPAD_STEPS.length - 1);
  if (step !== introStep) { introStep = step; onboarding.showPrompt(testpadPrompt(TESTPAD_STEPS[step], input.mode), step === TESTPAD_STEPS.length - 1); }
}

async function loadCircuitIndex() {
  if (CIRCUITS.length) return;
  try {
    const res = await fetch(new URL('./data/tracks/index.json', import.meta.url));
    const idx = await res.json();
    for (const t of idx.tracks) CIRCUITS.push(t);
  } catch {   }
  try { SECTORS = await loadSectors(); } catch { SECTORS = {}; }
  try { const r = await fetch(new URL('./data/garage_table.json', import.meta.url)); GARAGE_TABLE = await r.json(); } catch { GARAGE_TABLE = null; }
}

function circuitOptions() {
  return [...CIRCUITS, { key: 'test.pad', id: 'test', layout: 'pad', label: 'Test pad', lapLength: 0, sectors: 0, publishable: true }];
}

function refOptions() {
  if (selection.circuitKey === 'test.pad') return selection.mode === 'free' ? [{ id: 'pad', label: 'Test pad circle' }] : [];
  if (selection.mode === 'free') return [{ id: 'lap', label: 'Full circuit' }];
  const sectors = (SECTORS && SECTORS[selection.circuitKey]) || [];
  const options = sectors.map((s) => ({ id: s.id, label: s.name }));
  if (selection.mode === 'time') options.push({ id: 'lap', label: 'Full lap' });
  return options;
}

function bestFor(ref) {
  if (!ref || selection.circuitKey === 'test.pad') return null;
  const [id, layout] = selection.circuitKey.split('.');
  return storage.loadBest(storage.bestKey(id, layout, ref, assist, runHash()));
}

function selectedContext() { return garageModel.setupContext(selection.mode, selection.circuitKey); }

function runGarage(context = selectedContext()) { return { ...garageModel.garageFor(garage, context, settings.setups), whatIf }; }
function runConfig(context = selectedContext(), level = assist) { return garageModel.buildConfig(runGarage(context), level); }
function runHash(context = selectedContext(), level = assist) { return garageModel.garageHash(runGarage(context), level); }

function ghostFor(level, hash) {
  if (selection.mode !== 'time' || selection.circuitKey === 'test.pad' || !selection.ref) return null;
  const [id, layout] = selection.circuitKey.split('.');
  const g = storage.loadGhost(storage.bestKey(id, layout, selection.ref, level, hash));
  return g && isGhostUsable(g, { garageHash: hash, assist: level }) ? g : null;
}

function renderHome() {
  loadCircuitIndex().then(() => {
    titleHome.renderCircuits(circuitOptions(), selection.circuitKey);
    titleHome.renderModes(selection.mode);

    titleHome.renderSetup(selection.mode === 'replays' ? null : garageModel.setupSummary(runConfig()));
    if (selection.mode === 'replays') titleHome.renderReplays(storage.listReplays());
    else titleHome.renderRefs(refOptions(), selection.ref, bestFor);
  });
}
function selectMode(mode) { selection.mode = mode; if (selection.ref && !refOptions().some((r) => r.id === selection.ref)) selection.ref = null; renderHome(); }
function selectCircuit(key) { selection.circuitKey = key; selection.ref = null; renderHome(); }
function selectRef(ref) { selection.ref = ref; renderHome(); }
function selectReplay(slot) { playReplaySlot(slot); }

function persistGarage() { garage.hash = runHash(); storage.saveGarage(garage); }

function renderGarage() {
  const g = runGarage();
  garageUi.render(garageModel.computeReadouts(g, GARAGE_TABLE, assist), g, garageModel, { context: selectedContext() });
}

function rememberSetup(context, g) {
  settings.setups = garageModel.rememberSetup(settings.setups, context, g);
  storage.saveSettings(settings);
}

function onGarageChange(patch) {
  const context = selectedContext();
  const touchesSetup = garageModel.SETUP_FIELDS.some((k) => k in patch);
  if (touchesSetup) rememberSetup(context, { ...runGarage(context), ...patch });
  garage = { ...garage, ...patch };
  renderGarage();
  persistGarage();
  if (turntable) turntable.showLock('lockDeg' in patch ? garage.lockDeg : null);
}
function onSetupChange(presetId) {
  const context = selectedContext();
  rememberSetup(context, garageModel.applySetup(runGarage(context), presetId));
  renderGarage();
  persistGarage();
  if (turntable) turntable.showLock(null);
}

function loadTurntable() {
  if (!turntableLoad) {
    const canvas = document.getElementById('garage-view');
    turntableLoad = import('./render/scene.js').then(({ createGarageView }) => {
      turntable = createTurntable(canvas, createGarageView(canvas, garageModel.kartGeometry(runGarage())));
      return turntable;
    }).catch((err) => {
      canvas.dataset.failed = '1';
      fail('Garage turntable could not start', err);
      return null;
    });
  }
  return turntableLoad;
}
async function enterGarage() {
  const fresh = !turntable;
  const tt = await loadTurntable();
  if (!tt || state !== 'garage') return;
  if (fresh) { const c = document.getElementById('garage-view'); tt.resize(c.clientWidth, c.clientHeight); }
  tt.showLock(null);
  tt.enter();
}
function onWhatIfToggle(on) { whatIf = on; settings.whatIf = on; storage.saveSettings(settings); garage = { ...garage, whatIf: on }; }

function onSettingsChange(patch) {
  settings = { ...settings, ...patch };
  storage.saveSettings(settings);
  if (garageModel.isAssistLevel(patch.assistDefault)) { assist = patch.assistDefault; driveUi.setAssist(assist); }
  if (patch.camera) cameraMode = patch.camera;
  if (patch.haptics !== undefined) {   }
  if (patch.whatIf !== undefined) onWhatIfToggle(patch.whatIf);
}

async function loadCredits() {
  try {
    const res = await fetch(new URL('./NOTICE', import.meta.url));
    const text = await res.text();
    document.getElementById('notice-text').textContent = text;
  } catch {
    document.getElementById('notice-text').textContent = 'Notices could not be loaded.';
  }
}

async function trackFor(key) {
  if (trackCache.has(key)) return trackCache.get(key);
  const [id, layout] = key.split('.');
  const trackData = CIRCUITS.find((c) => c.key === key);
  const track = await loadTrack(id, layout);
  const meshes = buildTrackMeshes(track.data);
  const entry = { data: track.data, track, meshes, label: trackData ? trackData.label : key };
  trackCache.set(key, entry);
  return entry;
}

function setAssist(level) {
  if (!garageModel.isAssistLevel(level)) return;
  const prev = assist;
  assist = level;
  driveUi.setAssist(assist);
  let mixed = false;
  if (session && level !== prev) {
    const hash = runHash(sessionContext, level);
    mixed = session.setAssist({ assist: level, config: runConfig(sessionContext, level), garageHash: hash, ghostLog: ghostFor(level, hash) }).mixed;
  }
  if (debugLog && level !== prev) debugLog.note('assist', `${prev} > ${level}${mixed ? ' (run now mixed: no best)' : ''}`);
  if (mixed) driveUi.flash(`Assist ${level.toUpperCase()}: this run no longer counts as a best`, 'info', 2400);
  else driveUi.flash(`Assist ${level.toUpperCase()}`, 'info', 900);
}

async function beginDrive() {
  if (selection.mode === 'replays') return;
  if (selection.mode !== 'free' && !selection.ref) { driveUi.flash('Pick a sector first', 'bad', 1200); return; }
  await startSession();
  go('drive');
}

async function startSession() {
  replayPlayer = null; replayTrack = null;
  sessionContext = selectedContext();
  const config = runConfig(sessionContext);
  const hash = runHash(sessionContext);
  driveUi.setSetup(garageModel.setupSummary(config));
  if (selection.circuitKey === 'test.pad') {
    session = createDriveSession({ mode: selection.mode === 'free' ? 'free' : 'drift', track: testPadTrack(), sectorData: null,
      ref: 'pad', circuit: 'test', layout: 'pad', trackSchema: TRACK_SCHEMA, config, garageHash: hash, assist, whatIf, launchPose: PAD.start });
    await ensurePadView();
    return;
  }
  const { data, track, meshes } = await trackFor(selection.circuitKey);
  const sector = selection.mode !== 'free' && selection.ref !== 'lap' ? (SECTORS[selection.circuitKey] || []).find((s) => s.id === selection.ref) : null;
  const ghostLog = ghostFor(assist, hash);
  session = createDriveSession({ mode: selection.mode, track, sectorData: sector, ref: selection.ref || 'lap',
    circuit: data.id, layout: data.layout, trackSchema: TRACK_SCHEMA, config, garageHash: hash, assist, whatIf, ghostLog });
  await ensureCircuitView(data, meshes, track);
}

async function ensurePadView() {
  try {
    const { createRigView } = await import('./render/scene.js');
    const p = session.params;
    view = createRigView(document.getElementById('view'), { a: p.a, b: p.b, tf: p.tf, tr: p.tr, Rw: p.Rw, padHalf: PAD.half, circles: PAD.circles, coneInset: PAD.coneInset });
    view.resize(document.getElementById('view').clientWidth, document.getElementById('view').clientHeight);
    viewKind = 'pad-view';
  } catch (err) {
    fail('Renderer creation failed', err);
    driveUi.error(`The 3D view could not start (${(err && err.message) || err}). Reload to try again.`);
  }
}
async function ensureCircuitView(trackData, meshes, track) {
  try {
    const { createGameView } = await import('./render/scene.js');
    const p = session.params;
    view = createGameView(document.getElementById('view'), trackData, meshes, { a: p.a, b: p.b, tf: p.tf, tr: p.tr, Rw: p.Rw });
    view.resize(document.getElementById('view').clientWidth, document.getElementById('view').clientHeight);
    viewKind = 'circuit-view';
    view._track = track;
  } catch (err) {
    fail('Renderer creation failed', err);
    driveUi.error(`The 3D view could not start (${(err && err.message) || err}). Reload to try again.`);
  }
}

function resetKart() { if (debugLog) debugLog.note('kart', 'reset'); if (session) session.reset(); acc = 0; driveUi.flash('Kart reset', 'info', 800); if (state === 'pause') resume(); }

function pauseRun() { if (!isLiveRun(state)) return; pausedFrom = state; go('pause'); }
function resume() { go(isLiveRun(pausedFrom) ? pausedFrom : 'drive'); }
function recentre() { openCalibration('pause'); }

async function playReplaySlot(slot) {
  const rec = storage.loadReplay(slot);
  if (!rec) return;
  const { fromStorageRecord } = await import('./modes/replay.js');
  const log = fromStorageRecord(rec);
  const { data, track, meshes } = log.circuit === 'test' ? { data: null, track: testPadTrack(), meshes: null } : await trackFor(`${log.circuit}.${log.layout}`);
  replayPlayer = createGhostPlayer(log, track);
  replayTrack = track;
  driveUi.setSetup(garageModel.setupSummary(log.core.config));
  session = null;
  if (data) await ensureCircuitView(data, meshes, { params: replayPlayer.config }); else await ensurePadView();
  go('drive');
}

function refreshZones() { zoneSync.refresh(); }
function checkRotate() {
  const on = state !== 'title' && window.innerHeight > window.innerWidth;
  if (on === rotateUp) return;
  rotateUp = on;
  if (debugLog) debugLog.note('rotate', on ? 'overlay on: portrait, sim stopped' : 'overlay off');
  driveUi.rotate(on);
  acc = 0;
  if (on) {
    zoneSync.clear();
    if (state === 'calib' && calib === 'capturing') { input.cancelCalibration(); if (debugLog) debugLog.note('calib', 'capture dropped: the phone turned'); calib = 'ready'; onboarding.calibState('ready', 'The phone turned, so that capture was dropped. Hold it in landscape, then tap Set centre.', 'bad', input.hasSavedCalibration); }
  } else requestAnimationFrame(refreshZones);
}
function onResize() {
  if (view) view.resize(document.getElementById('view').clientWidth, document.getElementById('view').clientHeight);
  if (turntable && state === 'garage') { const c = document.getElementById('garage-view'); turntable.resize(c.clientWidth, c.clientHeight); }
  checkRotate();
  requestAnimationFrame(refreshZones);
}
function onVisibility() { if (document.hidden && isLiveRun(state)) pauseRun(); }

function noteDrop(now) { drops.push(now); while (drops.length && now - drops[0] > 2000) drops.shift(); if (drops.length >= 3) slowUntil = now + 2000; }

function tickOnce() {
  if (replayPlayer) { if (!replayPlayer.done) replayPlayer.tick(); return; }
  if (!session) return;
  session.tick(input.sample());
  if (session.finished && session.readyForResults && state === 'drive') showResults();
}

function showResults() {
  const r = session.results;
  driveUi.results(r, { grade: r.grade });
  audio.event(r.grade && r.grade !== 'D' ? 'sectorLine' : 'back');
  go('results');
}

function draw(alpha, dt, now) {
  if (!view || canvasForState(state) !== 'view') return;

  let snap, surface;
  if (replayPlayer) {
    snap = replayPlayer.snapshot; surface = replayTrack;
    surfacePose(surface, snap.pose.x, snap.pose.y, snap.pose.psi, kartGround);
  } else if (session) {
    snap = session.snapshot; surface = session.track;
    drawnPose(surface, session.prevPose, snap.pose, alpha, kartGround);
  } else return;
  const x = kartGround.x, y = kartGround.y, z = kartGround.z, psi = kartGround.psi;
  const delta = snap.steer.delta, vx = snap.state.vx, w = snap.state.w, beta = snap.beta, speed = snap.speed;

  spinRear = (spinRear + w * dt) % TWO_PI;
  spinFront = (spinFront + (vx / FRONT_TYRE_R) * dt) % TWO_PI;
  const helmetYaw = 0.35 * beta;
  view.setKart(x, y, psi, delta, spinFront, spinRear, helmetYaw, kartGround);
  const cam = cameraMode === 'helmet' ? helmet.update(x, y, z, psi, beta, dt) : chase.update(x, y, z, psi, beta, speed, dt);
  view.setCamera(cam.pos, cam.look, cam.fovDeg);
  if (view.updateEffects) {
    const rearSlip = Math.max(snap.wheels[2].s, snap.wheels[3].s) * Math.max(1, speed);
    view.updateEffects(dt, kartGround, rearSlip, snap.wheels[2].surface !== 'gravel');
  }
  if (session && view.setGhost) {
    const g = session.ghostSnapshot;
    if (g) surfacePose(surface, g.pose.x, g.pose.y, g.pose.psi, ghostGround);
    view.setGhost(!!g, g ? g.pose.x : 0, g ? g.pose.y : 0, g ? g.pose.psi : 0, g ? ghostGround : null);
  }
  view.render();

  if (hudShownIn(state)) {
    driveUi.controls(input.state(), input.resetProgress());
    if (now - hudAt >= 50) {
      hudAt = now;
      if (snap) audio.update(snap);
      if (replayPlayer) {
        driveUi.hud({ speedKmh: speed * 3.6, driftDeg: snap.drift.angle * R2D, betaDeg: beta * R2D, mode: 'replay', slow: false });
      } else if (session) {
        driveUi.hud({
          speedKmh: speed * 3.6, driftDeg: snap.drift.angle * R2D, betaDeg: beta * R2D, slow: now < slowUntil,
          mode: session.results ? session.results.mode : session.mode, scoreSegment: session.scorerSegment, scoreTotal: session.scorerTotal,
          offTrack: session.offTrackInvalid, deltaS: session.ghostDeltaS ? session.ghostDeltaS() : null, hasGhost: !!session.ghostSnapshot,
          motorFrac: snap.drivetrain && snap.drivetrain.rpmCap ? Math.abs(snap.drivetrain.rpm) / snap.drivetrain.rpmCap : 0,
          elapsedTicks: session.elapsedTicks,
        });
      }
    }
  }
}

function simLabel() {
  return simStateLabel({ state, rotateUp, hidden: document.hidden, replay: !!replayPlayer, hasSession: !!session,
    prelaunch: !!(session && session.prelaunch), finished: !!(session && session.finished) });
}

function debugSample() {
  if (!hudShownIn(state)) return null;
  const st = input.state();
  const tilt = input.tilt;
  const snap = replayPlayer ? replayPlayer.snapshot : (session ? session.snapshot : null);
  return {
    run: simLabel(), src: st.mode, tiltRaw: tilt.rawThetaDeg, tiltFilt: tilt.thetaDeg, flat: st.flat,
    steer: st.steer, throttle: st.throttle, brake: st.brake, handbrake: st.handbrake,
    speedKmh: snap ? snap.speed * 3.6 : NaN, driftDeg: snap && snap.drift ? snap.drift.angle * R2D : NaN,
  };
}

function inputDebugData() {
  const st = input.state();
  const dbg = input.debugInfo();
  const tilt = input.tilt;
  return {
    build: BUILD_ID, state, mode: st.mode, motion: st.motion,
    sim: simLabel(),
    tiltRaw: tilt.rawThetaDeg, tiltFilt: tilt.thetaDeg, flat: st.flat, magG: tilt.magG, calibrated: st.calibrated,
    samples: tilt.stats.accepted + tilt.stats.rejected,
    steer: st.steer, throttle: st.throttle, brake: st.brake, handbrake: st.handbrake,
    zones: dbg.zones, hit: dbg.lastDown,
  };
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = lastFrame ? (now - lastFrame) / 1000 : 0;
  const frameMs = dt * 1000;
  lastFrame = now;
  if (!(dt > 0)) dt = 0;
  const running = isLiveRun(state) && !rotateUp && !document.hidden;
  if (dt > MAX_FRAME_S) { if (running) noteDrop(now); dt = MAX_FRAME_S; }
  if (running) {
    acc += dt;
    let n = 0;
    while (acc >= TICK_S && n < MAX_TICKS_PER_FRAME) { tickOnce(); acc -= TICK_S; n++; }
    if (acc >= TICK_S) { acc = 0; noteDrop(now); }
  }
  if (state === 'calib') calibFrame();
  if (state === 'checking' && liveCheck) livenessFrame(now / 1000);
  if (state === 'garage' && turntable && !rotateUp) turntable.frame(dt);
  if (state === 'testpad') introFrame(now / 1000);
  draw(running ? acc / TICK_S : 1, running ? dt : 0, now);
  inputDebug.update(now);
  if (debugLog) debugLog.tick(now, frameMs, running);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          if (debugLog) debugLog.note('build', 'a new version is downloaded, waiting for Reload');
          driveUi.showUpdateBanner(() => { sw.postMessage('SKIP_WAITING'); });
        }
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

async function boot() {
  driveUi.setAssist(assist);
  driveUi.setMode(input.mode);
  titleHome.ready(BUILD_ID);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  registerServiceWorker();
  requestAnimationFrame(frame);
}

boot();
