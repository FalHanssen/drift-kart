

import { REPLAY_SCHEMA } from '../shared/versions.js';
import { createSim } from '../core/sim.js';
import { encodeInput, decodeInput } from '../input/shaping.js';

const TICK_S = 1 / 60;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined, b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return out;
}

export function base64ToBytes(str) {
  const clean = str.replace(/[^A-Za-z0-9+/]/g, '');
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const padChars = clean.length % 4 === 0 ? (str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0) : 0;
  const outLen = Math.floor((clean.length * 3) / 4) - padChars;
  const out = new Uint8Array(Math.max(0, outLen));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup[clean.charCodeAt(i)] || 0;
    const c1 = i + 1 < clean.length ? lookup[clean.charCodeAt(i + 1)] || 0 : 0;
    const c2 = i + 2 < clean.length ? lookup[clean.charCodeAt(i + 2)] || 0 : 0;
    const c3 = i + 3 < clean.length ? lookup[clean.charCodeAt(i + 3)] || 0 : 0;
    if (o < out.length) out[o++] = (c0 << 2) | (c1 >> 4);
    if (o < out.length) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (o < out.length) out[o++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

export function packEvents(events, endTick) {
  const n = endTick + 1;
  const out = new Uint8Array(n * 4);
  let ei = 0;
  let last = [0, 0, 0, 0, 0];
  const b4 = new Uint8Array(4);
  for (let tick = 0; tick < n; tick++) {
    while (ei < events.length && events[ei][0] <= tick) { last = events[ei]; ei++; }
    encodeInput({ steer: last[1], throttle: last[2], brake: last[3], handbrake: last[4] }, b4);
    out[tick * 4] = b4[0]; out[tick * 4 + 1] = b4[1]; out[tick * 4 + 2] = b4[2]; out[tick * 4 + 3] = b4[3];
  }
  return out;
}

export function unpackEvents(bytes) {
  const n = bytes.length >> 2;
  const events = new Array(n);
  for (let tick = 0; tick < n; tick++) {
    const o = tick * 4;
    const d = decodeInput([bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]]);
    events[tick] = [tick, d.steer, d.throttle, d.brake, d.handbrake];
  }
  return events;
}

export function buildReplayLog(coreLog, meta) {
  return {
    gameSchema: REPLAY_SCHEMA,
    core: coreLog,
    circuit: meta.circuit, layout: meta.layout, trackSchema: meta.trackSchema,
    ref: meta.ref, garageHash: meta.garageHash, assist: meta.assist, mode: meta.mode,
    finalScore: meta.finalScore ?? null, finalTime: meta.finalTime ?? null,
    whatIf: !!meta.whatIf, label: meta.label ? String(meta.label).slice(0, 24) : '',
  };
}

export function toStorageRecord(log) {
  const bytes = packEvents(log.core.events, log.core.endTick);
  return {
    gameSchema: log.gameSchema, circuit: log.circuit, layout: log.layout, trackSchema: log.trackSchema,
    ref: log.ref, garageHash: log.garageHash, assist: log.assist, mode: log.mode,
    finalScore: log.finalScore, finalTime: log.finalTime, whatIf: log.whatIf, label: log.label,
    core: { version: log.core.version, config: log.core.config, initial: log.core.initial, endTick: log.core.endTick, eventsB64: bytesToBase64(bytes) },
  };
}

export function fromStorageRecord(rec) {
  if (!rec || !rec.core || typeof rec.core.eventsB64 !== 'string') return null;
  const events = unpackEvents(base64ToBytes(rec.core.eventsB64));
  return {
    gameSchema: rec.gameSchema, circuit: rec.circuit, layout: rec.layout, trackSchema: rec.trackSchema,
    ref: rec.ref, garageHash: rec.garageHash, assist: rec.assist, mode: rec.mode,
    finalScore: rec.finalScore, finalTime: rec.finalTime, whatIf: rec.whatIf, label: rec.label,
    core: { version: rec.core.version, config: rec.core.config, initial: rec.core.initial, events, endTick: rec.core.endTick },
  };
}

export function isReplayCurrent(log, { coreVersion, trackSchema, circuit, layout }) {
  if (!log) return false;
  return log.core.version === coreVersion && log.gameSchema === REPLAY_SCHEMA && log.trackSchema === trackSchema
    && log.circuit === circuit && log.layout === layout;
}

export function isGhostForSetup(log, { garageHash, assist }) {
  return !!log && log.garageHash === garageHash && log.assist === assist && !log.whatIf;
}

export function createGhostPlayer(log, track) {
  const core = log.core;
  const sim = createSim(core.config, track);
  sim.reset(core.initial);
  let ei = 0;
  let last = [0, 0, 0, 0, 0];
  let snap = sim.snapshot();
  let done = core.endTick <= 0;

  const distAt = [0];
  const timeAt = [0];
  let lapCount = 0;
  let lastS = track.progress ? track.progress(snap.pose.x, snap.pose.y).s : 0;

  function tick() {
    if (done) return snap;
    const t = sim.tick;
    while (ei < core.events.length && core.events[ei][0] <= t) { last = core.events[ei]; ei++; }
    sim.setInput({ steer: last[1], throttle: last[2], brake: last[3], handbrake: last[4] });
    sim.advance(TICK_S);
    snap = sim.snapshot();
    if (track.progress) {
      const s = track.progress(snap.pose.x, snap.pose.y).s;
      if (s < lastS - track.lapLength / 2) lapCount++;
      lastS = s;
      const cum = lapCount * track.lapLength + s;
      if (cum > distAt[distAt.length - 1]) { distAt.push(cum); timeAt.push(sim.tick * TICK_S); }
    }
    if (sim.tick >= core.endTick) done = true;
    return snap;
  }

  function timeAtDistance(cumDist) {
    if (distAt.length < 2) return null;
    if (cumDist > distAt[distAt.length - 1]) return null;
    let lo = 0, hi = distAt.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (distAt[mid] <= cumDist) lo = mid; else hi = mid;
    }
    const d0 = distAt[lo], d1 = distAt[hi], t0 = timeAt[lo], t1 = timeAt[hi];
    const f = d1 > d0 ? (cumDist - d0) / (d1 - d0) : 0;
    return t0 + f * (t1 - t0);
  }

  return {
    tick, timeAtDistance,
    get snapshot() { return snap; },
    get done() { return done; },
    get config() { return core.config; },
  };
}

