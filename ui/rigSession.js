

import { createSim } from '../core/sim.js';
import { testPadTrack } from '../core/track.js';

export const TICK_S = 1 / 60;
const RAD2DEG = 180 / Math.PI;
const TWO_PI = 2 * Math.PI;

export const ASSIST_LEVELS = Object.freeze({ off: 0, low: 0.3, med: 0.6, high: 0.85 });
export const ASSIST_DEFAULT = 'low';

export const SETUPS = Object.freeze({ drift: 'Drift setup', track: 'Track setup' });

export const PAD = Object.freeze({
  half: 60,
  circles: Object.freeze([10, 20]),
  coneInset: 1.5,
  start: Object.freeze({ x: -15, y: -10, psi: 0 }),
});

export const HOLD = Object.freeze({
  onDeg: 10, offDeg: 8, offHoldS: 0.5, targetS: 5, spinBetaDeg: 100, spinYawDeg: 150, spinWindowS: 1.5,
});

export function createHoldTimer(o = HOLD) {
  const win = Math.round(o.spinWindowS / TICK_S);
  const hist = new Float64Array(win);
  const h = {
    active: false, t: 0, below: 0, last: 0, best: 0, reached: false, spinning: false,
    n: 0, i: 0, psiU: 0, prevPsi: NaN,
  };
  const events = { spin: false, target: false, end: false };

  function current() {
    if (!h.active) return 0;
    const v = h.t - h.below;
    return v > 0 ? v : 0;
  }

  function update(snap, dt = TICK_S) {
    events.spin = false; events.target = false; events.end = false;

    const psi = snap.pose.psi;
    if (h.prevPsi !== h.prevPsi) h.psiU = psi;
    else { let d = psi - h.prevPsi; d -= TWO_PI * Math.round(d / TWO_PI); h.psiU += d; }
    h.prevPsi = psi;
    const yawDeg = h.n === win ? Math.abs(h.psiU - hist[h.i]) * RAD2DEG : 0;
    hist[h.i] = h.psiU;
    h.i = (h.i + 1) % win;
    if (h.n < win) h.n++;

    const betaDeg = Math.abs(snap.beta) * RAD2DEG;
    if (betaDeg > o.spinBetaDeg || yawDeg > o.spinYawDeg) {
      if (!h.spinning) {
        h.spinning = true;
        events.spin = true;
        const c = current();
        if (c > h.best) h.best = c;
      }
      h.active = false; h.t = 0; h.below = 0; h.last = 0; h.reached = false;
      h.n = 0; h.i = 0;
      return;
    }
    h.spinning = false;

    const ang = snap.drift.angle * RAD2DEG;
    if (!h.active) {
      if (ang >= o.onDeg) { h.active = true; h.t = 0; h.below = 0; h.reached = false; }
      return;
    }
    h.t += dt;
    if (ang < o.offDeg) {
      h.below += dt;
      if (h.below >= o.offHoldS) {
        h.last = Math.max(0, h.t - h.below);
        if (h.last > h.best) h.best = h.last;
        h.active = false;
        events.end = true;
        return;
      }
    } else {
      h.below = 0;
    }
    if (!h.reached && current() >= o.targetS) { h.reached = true; events.target = true; }
  }

  function reset() {
    h.active = false; h.t = 0; h.below = 0; h.last = 0; h.reached = false; h.spinning = false;
    h.n = 0; h.i = 0; h.prevPsi = NaN;
  }

  return {
    update, reset, events,
    get active() { return h.active; },
    get current() { return current(); },
    get last() { return h.last; },
    get best() { return h.best; },
    get reached() { return h.reached; },
    get spinning() { return h.spinning; },
  };
}

export function createRigSession({ assist = ASSIST_DEFAULT, setup = 'drift', track = testPadTrack(), start = PAD.start } = {}) {
  const s = {
    assist: assist in ASSIST_LEVELS ? assist : ASSIST_DEFAULT,
    setup: setup in SETUPS ? setup : 'drift',
  };
  const hold = createHoldTimer();
  let sim = null;
  let snap = null;
  let prev = null;

  function config() {
    return {
      preset: s.setup,
      aids: { countersteerAssist: ASSIST_LEVELS[s.assist] },
      start: { x: start.x, y: start.y, psi: start.psi },
    };
  }

  function rebuild() {
    const resume = sim ? sim.snapshot().resume : null;
    const next = createSim(config(), track);
    if (resume) next.reset(resume);
    sim = next;
    snap = sim.snapshot();
    if (!prev) prev = snap.pose;
  }
  rebuild();

  return {

    tick(inp) {
      prev = snap.pose;
      sim.setInput(inp);
      sim.advance(TICK_S);
      snap = sim.snapshot();
      hold.update(snap, TICK_S);
      return snap;
    },
    setAssist(level) {
      if (!(level in ASSIST_LEVELS)) return false;
      if (level !== s.assist) { s.assist = level; rebuild(); }
      return true;
    },
    setSetup(id) {
      if (!(id in SETUPS)) return false;
      if (id !== s.setup) { s.setup = id; rebuild(); }
      return true;
    },
    reset() {
      sim.reset();
      snap = sim.snapshot();
      prev = snap.pose;
      hold.reset();
    },
    hold,
    get snapshot() { return snap; },
    get prevPose() { return prev; },
    get assist() { return s.assist; },
    get setup() { return s.setup; },
    get coreAssist() { return snap.flags.countersteerAssist; },
    get corePreset() { return snap.preset.id; },
    get params() { return sim.params; },
    get sim() { return sim; },
  };
}
