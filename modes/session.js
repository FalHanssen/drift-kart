

import { createDriftScorer, createTimer, SCORE } from './scoring.js';
import { buildReplayLog, toStorageRecord, createGhostPlayer, isGhostForSetup } from './replay.js';
import * as storage from './storage.js';
import { createSim } from '../core/sim.js';
import { testPadTrack } from '../core/track.js';

export const TICK_S = 1 / 60;
const RAD2DEG = 180 / Math.PI;
const LAUNCH_KMH = 30;
const TOUCH_EPS = 0.02;
const FAR_OFF_M = 25;

function wheelsOk(snap) {
  let n = 0;
  for (const w of snap.wheels) if (w.surface === 'asphalt' || w.surface === 'kerb') n++;
  return n;
}

function touched(sample) {
  return Math.abs(sample.steer) > TOUCH_EPS || sample.throttle > TOUCH_EPS || sample.brake > TOUCH_EPS || sample.handbrake >= 1;
}

function inOrientedBox(px, py, zone) {
  const dx = px - zone.x, dy = py - zone.y;
  const c = Math.cos(zone.heading), s = Math.sin(zone.heading);
  const along = dx * c + dy * s, across = -dx * s + dy * c;
  return Math.abs(along) <= zone.len / 2 && Math.abs(across) <= zone.wid / 2;
}

export function createDriveSession(opts) {
  const {
    mode,
    track, sectorData = null,
    ref, circuit, layout, trackSchema,
    config, garageHash, assist, whatIf = false,
    ghostLog = null, env,
    launchPose: launchPoseOverride = null,
  } = opts;

  const isSector = sectorData !== null;
  const launchPose = launchPoseOverride || (isSector ? track.poseAt(sectorData.launchS) : track.poseAt(0));
  const lineS = isSector ? sectorData.endS : (track.startFinish ? track.startFinish.s : 0);

  function freshStart() {
    const vx = (mode === 'free') ? 0 : LAUNCH_KMH / 3.6;
    return { x: launchPose.x, y: launchPose.y, psi: launchPose.heading, vx, vy: 0, r: 0 };
  }

  let sim = createSim(config, track);
  let assistLevel = assist, hashNow = garageHash, ghostLogNow = ghostLog;
  let mixed = false;
  let prevSnap, snap, prelaunch, recording, finished, results;
  let scorer, startTimer, endTimer, ghost;
  let lastS, contactRunSpeed, coastTicks;
  let elapsedFreeTicks = 0;

  const lapsDone = 0;
  let lapStartTicks = 0;
  const lapTimes = [];
  const COAST_TICKS = 120;

  function restartAttempt() {
    sim.reset(freshStart());
    prevSnap = sim.snapshot();
    snap = prevSnap;
    prelaunch = mode !== 'free';
    recording = false;
    mixed = false;
    finished = false;
    results = null;
    contactRunSpeed = 0;
    coastTicks = 0;
    lastS = launchPose.s ?? 0;
    scorer = mode === 'drift' ? createDriftScorer() : null;
    startTimer = isSector ? createTimer() : null;
    endTimer = createTimer();
    elapsedFreeTicks = 0;
    ghost = (mode === 'time' && ghostLogNow) ? createGhostPlayer(ghostLogNow, track) : null;
  }

  function setAssist(next) {
    if (!next || next.assist === assistLevel) return { changed: false, mixed };
    const nextSim = createSim(next.config, track);
    const fresh = prelaunch;
    const resume = sim.snapshot().resume;
    if (recording) { sim.stopRecording(); recording = false; }
    sim = nextSim;
    assistLevel = next.assist;
    hashNow = next.garageHash;
    ghostLogNow = next.ghostLog || null;
    if (fresh) {
      restartAttempt();
    } else {
      sim.reset(resume);
      snap = sim.snapshot();
      if (mode !== 'free' && !finished) mixed = true;
    }
    return { changed: true, mixed };
  }
  restartAttempt();

  function beginRecording() {
    if (mode === 'free') return;
    sim.recordInputs();
    recording = true;
  }

  function applyScoringAndTiming(dt) {
    const ok = wheelsOk(snap);
    const b = sim.params.b;
    const rax = snap.pose.x - b * Math.cos(snap.pose.psi), ray = snap.pose.y - b * Math.sin(snap.pose.psi);

    if (snap.contact > 0) {
      if (prevSnap.contact === 0) contactRunSpeed = prevSnap.speed;
    }
    const impulseNs = snap.contact > 0 ? Math.max(0, sim.params.m * (contactRunSpeed - snap.speed)) : 0;

    if (scorer) {
      const inClip = isSector && sectorData.corners.some((c) => inOrientedBox(rax, ray, c.clip));
      scorer.tick({
        angleDeg: snap.drift.angle * RAD2DEG, betaDeg: snap.beta * RAD2DEG, speedKmh: snap.speed * 3.6,
        wheelsOk: ok, inClipZone: inClip, headingDeg: snap.pose.psi * RAD2DEG, barrierImpulseNs: impulseNs,
      }, dt);
    }

    const prog = track.progress ? track.progress(snap.pose.x, snap.pose.y, lastS) : null;
    let crossEnd = null;
    if (prog) {
      crossEnd = track.crossedLine(lastS, prog.s, lineS);
      if (startTimer && !startTimer.finished) startTimer.tick(track.crossedLine(lastS, prog.s, sectorData.startS), ok, dt);
      if (mode !== 'free') endTimer.tick(crossEnd, ok, dt);
      if (mode === 'free' && crossEnd !== null) {
        const lapS = (lapStartTicks >= 0) ? (endTimer.ticks - lapStartTicks) * dt + crossEnd * dt : 0;
        lapTimes.push(lapS);
        lapStartTicks = endTimer.ticks;
      }
      if (Math.abs(prog.o) > FAR_OFF_M) { restartAttempt(); return null; }
      lastS = prog.s;
    }
    return crossEnd;
  }

  function finishAttempt() {
    if (finished) return;
    finished = true;
    let finalScore = null, finalTime = null, grade = null, invalid = false;
    if (scorer) { scorer.finish(); finalScore = scorer.total; grade = scorer.grade(sectorData.targetT); }
    if (mode === 'time') {
      invalid = endTimer.invalid;
      finalTime = isSector ? (endTimer.finishTimeS - (startTimer.finishTimeS ?? 0)) : endTimer.finishTimeS;
    }
    let coreLog = null, replayLog = null, isNewBest = false;
    if (recording) {
      coreLog = sim.stopRecording();
      replayLog = buildReplayLog(coreLog, {
        circuit, layout, trackSchema, ref, garageHash: hashNow, assist: assistLevel, mode,
        finalScore, finalTime, whatIf,
      });
    }
    if (!whatIf && !invalid && !mixed && (mode === 'drift' || mode === 'time')) {
      const key = storage.bestKey(circuit, layout, ref, assistLevel, hashNow);
      const prev = storage.loadBest(key, env);
      const value = mode === 'drift' ? finalScore : finalTime;
      const better = !prev || (mode === 'drift' ? value > prev.value : value < prev.value);
      if (better && value !== null) {
        storage.saveBest(key, { value, isTime: mode === 'time', date: new Date().toISOString().slice(0, 10), ghostKey: key }, env);
        if (replayLog) storage.saveGhost(key, toStorageRecord(replayLog), env);
        isNewBest = true;
      }
    }
    results = { mode, finalScore, finalTime, grade, invalid, isNewBest, whatIf, garageHash: hashNow,
      assist: mixed ? 'mixed' : assistLevel, mixed, replayLog };
  }

  function tick(sample) {
    if (finished) {
      coastTicks++;
      return;
    }
    if (prelaunch) {
      if (!touched(sample)) return;
      prelaunch = false;
      beginRecording();
    }
    if (mode === 'free') elapsedFreeTicks++;
    prevSnap = snap;
    sim.setInput(sample);
    sim.advance(TICK_S);
    snap = sim.snapshot();
    if (ghost && !ghost.done) ghost.tick();

    const crossed = applyScoringAndTiming(TICK_S);
    if (mode !== 'free' && crossed !== null) finishAttempt();
  }

  function saveLastReplay(label) {
    if (!results || !results.replayLog) return { ok: false, reason: 'no-replay' };
    const log = { ...results.replayLog, label: label ? String(label).slice(0, 24) : '' };
    return storage.saveReplay(toStorageRecord(log), {
      label: log.label, circuit, layout, ref, mode, assist: log.assist, finalScore: results.finalScore, finalTime: results.finalTime,
    }, env);
  }

  return {
    tick, reset: restartAttempt, saveLastReplay, setAssist,
    get mode() { return mode; },
    get track() { return track; },
    get assist() { return assistLevel; },
    get mixed() { return mixed; },
    get snapshot() { return snap; },
    get prevPose() { return prevSnap.pose; },
    get params() { return sim.params; },
    get prelaunch() { return prelaunch; },
    get finished() { return finished; },
    get readyForResults() { return finished && coastTicks >= COAST_TICKS; },
    get results() { return results; },
    get scorerSegment() { return scorer ? scorer.segment : 0; },
    get scorerTotal() { return scorer ? scorer.total : 0; },
    get scorerSpinning() { return scorer ? scorer.spinning : false; },
    get offTrackInvalid() { return endTimer.invalid; },
    get elapsedTicks() { return mode === 'free' ? elapsedFreeTicks : endTimer.ticks; },
    get lapTimes() { return lapTimes; },
    get ghostSnapshot() { return ghost ? ghost.snapshot : null; },
    get ghostDone() { return ghost ? ghost.done : true; },
    ghostDeltaS() {
      if (!ghost || !track.progress) return null;
      const p = track.progress(snap.pose.x, snap.pose.y);
      const cum = lapsDone * track.lapLength + p.s;
      const ghostT = ghost.timeAtDistance(cum);
      return ghostT === null ? null : (endTimer.ticks * TICK_S) - ghostT;
    },
  };
}

export function isGhostUsable(ghostLog, { garageHash, assist }) {
  return isGhostForSetup(ghostLog, { garageHash, assist });
}

export function freeRunTestPad() {
  return testPadTrack();
}
