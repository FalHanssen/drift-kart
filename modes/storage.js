

import { STORAGE_PREFIX } from '../shared/versions.js';

export const SCHEMA = 1;
export const REPLAY_SLOTS = 10;

export const DEFAULT_SETTINGS = Object.freeze({
  assistDefault: null,
  steeringRangeDeg: 28,
  smoothingMs: 20,
  haptics: true,
  camera: 'chase',
  audioOn: true,
  introDone: false,
  telemetryOverlay: false,
  whatIf: false,
  setups: null,

});

function store(env) {
  try { return (env || globalThis).localStorage || null; } catch { return null; }
}

function readRaw(key, env) {
  try { const s = store(env); return s ? s.getItem(STORAGE_PREFIX + key) : null; } catch { return null; }
}
function writeRaw(key, value, env) {
  try { const s = store(env); if (!s) return false; s.setItem(STORAGE_PREFIX + key, value); return true; } catch { return false; }
}
function removeRaw(key, env) {
  try { const s = store(env); if (s) s.removeItem(STORAGE_PREFIX + key); } catch {   }
}

function readJSON(key, fallback, env) {
  const raw = readRaw(key, env);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
function writeJSON(key, value, env) {
  try { return writeRaw(key, JSON.stringify(value), env); } catch { return false; }
}

function ownKeys(env) {
  try {
    const s = store(env);
    if (!s) return [];
    const out = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(STORAGE_PREFIX)) out.push(k.slice(STORAGE_PREFIX.length)); }
    return out;
  } catch { return []; }
}

export function clearAll(env) {
  for (const k of ownKeys(env)) removeRaw(k, env);
}

export function loadMeta(coreVersion, env) {
  const now = Date.now();
  const existing = readJSON('meta', null, env);
  if (existing && existing.schema !== SCHEMA) {
    clearAll(env);
    const meta = { schema: SCHEMA, coreVersion, createdAt: now, lastOpened: now };
    writeJSON('meta', meta, env);
    return { meta, resetPerformed: true };
  }
  const meta = existing
    ? { ...existing, lastOpened: now }
    : { schema: SCHEMA, coreVersion, createdAt: now, lastOpened: now };
  writeJSON('meta', meta, env);
  return { meta, resetPerformed: false };
}

export function loadSettings(env) {
  return { ...DEFAULT_SETTINGS, ...readJSON('settings', {}, env) };
}
export function saveSettings(settings, env) {
  return writeJSON('settings', settings, env);
}

export function loadGarage(env) {
  return readJSON('garage', null, env);
}
export function saveGarage(garage, env) {
  return writeJSON('garage', garage, env);
}

export function bestKey(circuit, layout, ref, assist, garageHash) {
  return `${circuit}.${layout}.${ref}.${assist}.${garageHash}`;
}

export function loadBest(key, env) {
  return readJSON(`best.${key}`, null, env);
}
export function saveBest(key, record, env) {
  return writeJSON(`best.${key}`, record, env);
}

export function listBests(circuit, layout, ref, env) {
  const prefix = `best.${circuit}.${layout}.${ref}.`;
  const out = [];
  for (const k of ownKeys(env)) {
    if (!k.startsWith(prefix)) continue;
    const rest = k.slice(prefix.length).split('.');
    if (rest.length < 2) continue;
    const assist = rest[0], garageHash = rest.slice(1).join('.');
    const record = readJSON(k, null, env);
    if (record) out.push({ assist, garageHash, ...record });
  }
  return out;
}

export function loadGhost(key, env) {
  return readJSON(`ghost.${key}`, null, env);
}
export function saveGhost(key, record, env) {
  return writeJSON(`ghost.${key}`, record, env);
}

export function listReplays(env) {
  return readJSON('replay.index', [], env);
}

function writeIndex(index, env) { writeJSON('replay.index', index, env); }

export function saveReplay(record, meta, env) {
  const attempt = (index) => {
    const slot = index.length < REPLAY_SLOTS ? nextFreeSlot(index) : index[0].slot;
    const entry = { slot, label: meta.label || '', circuit: meta.circuit, layout: meta.layout, ref: meta.ref,
      mode: meta.mode, assist: meta.assist, finalScore: meta.finalScore ?? null, finalTime: meta.finalTime ?? null,
      savedAt: Date.now() };
    if (!writeRaw(`replay.${slot}`, safeStringify(record), env)) return null;
    const next = index.filter((e) => e.slot !== slot).concat([entry]);
    if (!writeJSON('replay.index', next, env)) { removeRaw(`replay.${slot}`, env); return null; }
    return slot;
  };
  const index = listReplays(env);
  let slot = attempt(index);
  if (slot === null && index.length > 0) {

    const trimmed = index.slice(1);
    removeRaw(`replay.${index[0].slot}`, env);
    writeIndex(trimmed, env);
    slot = attempt(trimmed);
  }
  return slot === null ? { ok: false, reason: 'quota' } : { ok: true, slot };
}

function nextFreeSlot(index) {
  const used = new Set(index.map((e) => e.slot));
  for (let i = 0; i < REPLAY_SLOTS; i++) if (!used.has(i)) return i;
  return 0;
}

function safeStringify(record) {
  try { return JSON.stringify(record); } catch { return null; }
}

export function loadReplay(slot, env) {
  return readJSON(`replay.${slot}`, null, env);
}

export function deleteReplay(slot, env) {
  removeRaw(`replay.${slot}`, env);
  writeIndex(listReplays(env).filter((e) => e.slot !== slot), env);
}

export function storageUsageBytes(env) {
  try {
    const s = store(env);
    if (!s) return 0;
    let total = 0;
    for (const k of ownKeys(env)) {
      const v = s.getItem(STORAGE_PREFIX + k);
      if (v) total += (STORAGE_PREFIX.length + k.length + v.length) * 2;
    }
    return total;
  } catch { return 0; }
}
