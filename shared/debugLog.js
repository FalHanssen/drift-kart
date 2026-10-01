

import { STORAGE_PREFIX } from './versions.js';
import { inputDebugRequested, describeElement } from './inputDebug.js';

export const LOG_CAP = 5000;
export const LOG_KEY = `${STORAGE_PREFIX}debuglog`;
export const SAMPLE_MS = 100;
export const IDLE_SAMPLE_MS = 1000;
export const MOVE_BIN_MS = 100;
export const FRAME_WINDOW_MS = 1000;
export const PERSIST_MS = 3000;
export const PERSIST_SOON_MS = 1000;
export const PERSIST_BUDGET = 250000;
export const PERSIST_MIN = 8000;
export const UNDO_MS = 10000;

export const CORNER = Object.freeze({ left: 68, top: 12, width: 64, height: 44 });

const PATH_CAP = 60;
const FREE_TEXT = 240;
const LONG_FRAME_MS = 50;
const ERROR_REPEAT_MS = 5000;
const MAX_Z = '2147483647';
const FAST_RUNS = new Set(['running', 'HOLD', 'replay']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function debugLogRequested(search) {
  if (inputDebugRequested(search)) return true;
  try {
    return new URLSearchParams(search || '').getAll('log').some((v) => ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()));
  } catch {
    return false;
  }
}

const fx = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const sx = (v, d) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}` : '-');
const ix = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '-');
const two = (v) => String(v).padStart(2, '0');
const stamp = (t) => String(t).padStart(7);

export function oneLine(s, max = FREE_TEXT) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}~` : t;
}

export function thousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function localStamp(epochMs) {
  const d = new Date(epochMs);
  if (!Number.isFinite(d.getTime())) return '?';
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} UTC${off >= 0 ? '+' : '-'}${two(Math.floor(a / 60))}:${two(a % 60)}`;
}
function clockTime(epochMs) { const d = new Date(epochMs); return Number.isFinite(d.getTime()) ? `${two(d.getHours())}:${two(d.getMinutes())}` : '?'; }
function shortDate(epochMs) { const d = new Date(epochMs); return Number.isFinite(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : '?'; }
export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

function stripOrigin(u) { return String(u || '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, ''); }
function stackWhere(err) {
  const m = err && typeof err.stack === 'string' ? err.stack.match(/([^\s(]+:\d+:\d+)/) : null;
  return m ? ` (${stripOrigin(m[1])})` : '';
}
function errorMessage(err) {
  if (err && typeof err === 'object' && 'message' in err) return String(err.message);
  return String(err);
}

export function formatZones(rects) {
  const names = rects ? Object.keys(rects) : [];
  if (!names.length) return 'zones 0: NONE (every touch misses)';
  return `zones ${names.length}: ${names.map((k) => {
    const r = rects[k];
    return `${k} ${ix(r.left)},${ix(r.top)} ${ix(r.right - r.left)}x${ix(r.bottom - r.top)}`;
  }).join('; ')}`;
}

export function runWord(label) {
  const s = String(label || '?');
  if (s.startsWith('HOLD')) return 'HOLD';
  const m = /^stopped \((.+)\)$/.exec(s);
  if (m) return `stopped:${m[1].replace(/ overlay$/, '').replace(/^page /, '')}`;
  return s.replace(/\s+/g, '-');
}

export function formatSample(s) {
  return `in ${runWord(s.run)} tilt ${sx(s.tiltRaw, 1)}/${sx(s.tiltFilt, 1)}${s.flat ? ' FLAT' : ''} steer ${sx(s.steer, 2)}`
    + ` thr ${fx(s.throttle, 2)} brk ${fx(s.brake, 2)} hb ${s.handbrake ? 1 : 0} src ${s.src || '?'}`
    + ` | ${fx(s.speedKmh, 1)} km/h drift ${fx(s.driftDeg, 1)}`;
}

export function describeCalibration(res) {
  if (!res) return 'result missing';
  const parts = [];
  if (Number.isFinite(res.spreadDeg)) parts.push(`spread ${res.spreadDeg.toFixed(2)} deg`);
  if (Number.isFinite(res.magG)) parts.push(`${res.magG.toFixed(2)} g`);
  if (Number.isFinite(res.samples)) parts.push(`${res.samples} readings`);
  return `${res.ok ? 'ok' : `failed (${res.reason || '?'})`}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

export function verdictText(v) {
  if (v === undefined || v === 'unseen') return 'NOT SEEN by input';
  if (v === null) return 'no zone';
  if (v === 'button') return 'button (input ignores it)';
  return String(v);
}
function boundWord(v) {
  if (v === '?') return '(down not logged)';
  if (v === undefined || v === 'unseen') return '(not seen by input)';
  if (v === null) return '(no zone)';
  return `(${v})`;
}

export function createRing(cap = LOG_CAP) {
  let buf = new Array(cap);
  let head = 0;
  let size = 0;
  let dropped = 0;
  function push(e) {
    if (size < cap) { buf[(head + size) % cap] = e; size++; return; }
    buf[head] = e;
    head = (head + 1) % cap;
    dropped++;
  }
  function clear() { buf = new Array(cap); head = 0; size = 0; dropped = 0; }
  return {
    get cap() { return cap; },
    get size() { return size; },
    get dropped() { return dropped; },
    push,
    clear,
    toArray() { const out = new Array(size); for (let i = 0; i < size; i++) out[i] = buf[(head + i) % cap]; return out; },

    load(entries, droppedBefore = 0) { clear(); for (const e of entries) push(e); dropped += droppedBefore; },
  };
}

function freshCounters() {
  return { downs: 0, zone: {}, noZone: 0, button: 0, moves: 0, moveLines: 0, ups: 0, cancels: 0, errors: 0,
    visits: {}, path: [], pathDropped: 0, maxPointers: 0, touchEvents: 0, maxTouches: 0 };
}

function mergeCounters(a, b) {
  const out = freshCounters();
  for (const k of ['downs', 'noZone', 'button', 'moves', 'moveLines', 'ups', 'cancels', 'errors', 'touchEvents']) out[k] = a[k] + b[k];
  out.maxPointers = Math.max(a.maxPointers, b.maxPointers);
  out.maxTouches = Math.max(a.maxTouches, b.maxTouches);
  for (const src of [a.zone, b.zone]) for (const k of Object.keys(src)) out.zone[k] = (out.zone[k] || 0) + src[k];
  for (const src of [a.visits, b.visits]) for (const k of Object.keys(src)) out.visits[k] = (out.visits[k] || 0) + src[k];
  const bPath = b.path.slice();
  if (bPath.length && a.path.length && bPath[0] === a.path[a.path.length - 1]) { bPath.shift(); out.visits[a.path[a.path.length - 1]]--; }
  out.path = a.path.concat(bPath);
  out.pathDropped = a.pathDropped + b.pathDropped;
  while (out.path.length > PATH_CAP) { out.path.shift(); out.pathDropped++; }
  return out;
}

export function createRecorder({ cap = LOG_CAP, build = '?', clock = () => 0, initialState = null, meta = {} } = {}) {
  const ring = createRing(cap);
  const info = { startedEpoch: 0, page: '?', viewport: '?', dpr: 1, touchPoints: 0, standalone: false, ua: '?', ...meta };
  let counters = freshCounters();
  let version = 0;
  const pointers = new Map();
  let lastError = null;
  let zonesSig = null;
  let currentState = initialState;
  let lastSampleAt = -Infinity;
  const fw = { start: -1, n: 0, long: 0, times: new Float64Array(1024) };
  let saveMs = 0;
  let undo = null;

  const now = () => Math.round(clock());

  function lineOf(e) {
    if (e.line) return e.line;
    const body = e.kind === 'down'
      ? `down p${e.id} ${e.type} ${ix(e.x)},${ix(e.y)} > ${verdictText(e.verdict)} | ${e.under}${e.target !== e.under ? ` (target ${e.target})` : ''}`
      : e.body;
    const line = `${stamp(e.t)} ${body}${e.repeat ? ` [x${e.repeat + 1}, last at ${e.tLast}]` : ''}`;
    if (e.kind !== 'down' || e.verdict !== undefined) e.line = line;
    return line;
  }

  function pushRaw(e) { ring.push(e); version++; }

  function flushBins() {
    const bins = [];
    for (const [id, p] of pointers) if (p.bin) { bins.push([id, p]); }
    if (!bins.length) return;
    bins.sort((a, b) => a[1].bin.t - b[1].bin.t);
    for (const [id, p] of bins) {
      const b = p.bin;
      p.bin = null;
      counters.moveLines++;
      pushRaw({ t: b.t, body: `move p${id} ${ix(b.x)},${ix(b.y)}${b.n > 1 ? ` x${b.n}` : ''} ${boundWord(p.zone)}` });
    }
  }
  function push(e) { flushBins(); pushRaw(e); return e; }

  function visit(s) {
    counters.visits[s] = (counters.visits[s] || 0) + 1;
    counters.path.push(s);
    if (counters.path.length > PATH_CAP) { counters.path.shift(); counters.pathDropped++; }
  }

  function stats() {
    const c = counters;
    const hits = Object.keys(c.zone).reduce((n, k) => n + c.zone[k], 0);
    const unseen = Math.max(0, c.downs - hits - c.noZone - c.button);
    return { lines: ring.size, dropped: ring.dropped, durationMs: clock(), touches: c.downs, hits, noZone: c.noZone, unseen,
      missed: c.noZone + unseen, buttons: c.button, errors: c.errors };
  }

  function summaryLines() {
    const c = counters;
    const s = stats();
    const perZone = Object.keys(c.zone).map((k) => `${k} ${c.zone[k]}`).join(', ');
    const visits = Object.keys(c.visits).filter((k) => c.visits[k] > 0).map((k) => (c.visits[k] > 1 ? `${k} x${c.visits[k]}` : k)).join(', ');
    return [
      `touches ${s.touches}: ${s.hits} hit a zone${perZone ? ` (${perZone})` : ''}; ${s.missed} unmatched (${s.noZone} no zone, ${s.unseen} not seen by input); ${s.buttons} on buttons (input leaves those to the button)`,
      `finger moves ${c.moves} (in ${c.moveLines} ${c.moveLines === 1 ? 'line' : 'lines'}, one per finger per ${MOVE_BIN_MS} ms); lifts ${c.ups} up, ${c.cancels} cancelled by the browser; most fingers down at once ${c.maxPointers} (browser touch events ${c.touchEvents}, most at once ${c.maxTouches})`,
      `errors ${c.errors}`,
      `states visited: ${visits || 'none'}`,
      `state path: ${c.pathDropped ? `(${c.pathDropped} earlier) > ` : ''}${c.path.join(' > ') || 'none'}`,
    ];
  }

  function headerLines(mode, nowEpoch, notKept) {
    return [
      'Drift kart debug log',
      `build ${build}`,
      `started ${localStamp(info.startedEpoch)}; ${mode} ${localStamp(nowEpoch)} (${fx(clock() / 1000, 1)} s after the page started loading)`,
      `page ${info.page}  viewport at start ${info.viewport}  dpr ${info.dpr}  touch points ${info.touchPoints}  home screen app ${info.standalone ? 'yes' : 'no'}`,
      `browser ${info.ua}`,
      'read me: times are ms since the page started loading. "in" lines sample input and kart 10 times a second during a run: tilt raw/filtered deg, steer as the sim gets it (+ = left), thr and brk 0 to 1, hb handbrake, src steering source, then speed km/h and drift angle deg. "down" lines show the zone the input layer matched and the element under the finger.',
      'SUMMARY',
      ...summaryLines(),
      `lines ${ring.size} of ${ring.cap} max; ${ring.dropped} older lines dropped (the counts above still include them)${notKept ? `; ${notKept} older lines not kept in this saved copy` : ''}`,
      'LOG',
    ];
  }

  const rec = {
    get version() { return version; },
    get size() { return ring.size; },
    get dropped() { return ring.dropped; },
    get currentState() { return currentState; },
    get canUndo() { return !!undo; },
    entries() { flushBins(); return ring.toArray().map(lineOf); },
    stats,
    summaryLines,

    note(kind, text) { return push({ t: now(), body: `${kind} ${oneLine(text)}` }); },

    state(prev, next) {
      currentState = next;
      visit(next);
      return push({ t: now(), body: prev == null ? `state ${next} (page start)` : `state ${prev} > ${next}` });
    },

    down(d) {
      counters.downs++;
      pointers.set(d.id, { zone: undefined, bin: null });
      if (pointers.size > counters.maxPointers) counters.maxPointers = pointers.size;
      return push({ t: now(), kind: 'down', id: d.id, type: d.type || 'pointer', x: d.x, y: d.y,
        under: d.under || 'none', target: d.target || 'none', verdict: undefined });
    },
    resolve(entry, verdict) {
      if (!entry || entry.kind !== 'down' || entry.verdict !== undefined) return;
      const v = verdict === undefined ? 'unseen' : verdict;
      entry.verdict = v;
      entry.line = null;
      if (v === null) counters.noZone++;
      else if (v === 'button') counters.button++;
      else if (v !== 'unseen') counters.zone[v] = (counters.zone[v] || 0) + 1;
      const p = pointers.get(entry.id);
      if (p) p.zone = v;
      version++;
    },

    move(id, x, y) {
      const p = pointers.get(id);
      if (!p) return false;
      counters.moves++;
      const t = now();
      if (p.bin && t - p.bin.t0 >= MOVE_BIN_MS) flushBins();
      if (!p.bin) p.bin = { t0: t, t, x, y, n: 1 };
      else { p.bin.t = t; p.bin.x = x; p.bin.y = y; p.bin.n++; }
      version++;
      return true;
    },
    end(kind, id, x, y) {
      const p = pointers.get(id);
      if (kind === 'cancel') counters.cancels++; else counters.ups++;
      const e = push({ t: now(), body: `${kind} p${id} ${ix(x)},${ix(y)} ${boundWord(p ? p.zone : '?')}` });
      pointers.delete(id);
      return e;
    },
    touches(n) {
      counters.touchEvents++;
      if (n > counters.maxTouches) counters.maxTouches = n;
    },

    zones(rects) {
      const sig = formatZones(rects);
      if (sig === zonesSig) return null;
      zonesSig = sig;
      return push({ t: now(), body: sig });
    },

    sample(s) {
      const t = now();
      if (!FAST_RUNS.has(runWord(s.run)) && t - lastSampleAt < IDLE_SAMPLE_MS) return null;
      lastSampleAt = t;
      return push({ t, body: formatSample(s) });
    },

    frameTick(tNow, frameMs, running) {
      if (!running) { fw.start = -1; fw.n = 0; fw.long = 0; return null; }
      if (fw.start < 0) { fw.start = tNow; fw.n = 0; fw.long = 0; return null; }
      if (Number.isFinite(frameMs) && frameMs > 0) {
        if (fw.n < fw.times.length) fw.times[fw.n++] = frameMs;
        if (frameMs > LONG_FRAME_MS) fw.long++;
      }
      if (tNow - fw.start < FRAME_WINDOW_MS || !fw.n) return null;
      const sorted = Array.from(fw.times.subarray(0, fw.n)).sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const body = `frames ${fw.n} med ${median.toFixed(1)} max ${sorted[sorted.length - 1].toFixed(1)} ms`
        + `${fw.long ? ` over ${LONG_FRAME_MS} ms ${fw.long}` : ''}${saveMs ? ` (log save ${saveMs.toFixed(1)} ms)` : ''}`;
      saveMs = 0;
      fw.start = tNow; fw.n = 0; fw.long = 0;
      return push({ t: now(), body });
    },
    noteSave(ms) { if (Number.isFinite(ms)) saveMs += ms; },

    error(text) {
      const body = `ERROR ${oneLine(text)}`;
      const t = now();
      counters.errors++;
      if (lastError && lastError.body === body && t - lastError.tLast <= ERROR_REPEAT_MS) {
        lastError.repeat++;
        lastError.tLast = t;
        lastError.line = null;
        version++;
        return lastError;
      }
      lastError = push({ t, body, repeat: 0, tLast: t });
      return lastError;
    },

    text(nowEpoch = Date.now()) {
      flushBins();
      return [...headerLines('exported', nowEpoch, 0), ...ring.toArray().map(lineOf)].join('\n');
    },

    persistRecord(budget = PERSIST_BUDGET, nowEpoch = Date.now()) {
      flushBins();
      const lines = ring.toArray().map(lineOf);
      let room = budget - headerLines('saved', nowEpoch, lines.length).join('\n').length - 1;
      let i = lines.length;
      while (i > 0 && room >= lines[i - 1].length + 1) { room -= lines[i - 1].length + 1; i--; }
      const text = [...headerLines('saved', nowEpoch, i), ...lines.slice(i)].join('\n');
      return { v: 1, build, started: info.startedEpoch, saved: nowEpoch, lines: lines.length - i, text };
    },

    clear() {
      flushBins();
      const removed = ring.size;
      undo = { entries: ring.toArray(), dropped: ring.dropped, counters, lastError, zonesSig };
      ring.clear();
      counters = freshCounters();
      if (currentState != null) visit(currentState);
      lastError = null;
      push({ t: now(), body: `note log cleared (${removed} lines); recording carries on` });
      return removed;
    },
    undoClear() {
      if (!undo) return false;
      flushBins();
      const since = ring.toArray();
      ring.load(undo.entries.concat(since), undo.dropped);
      counters = mergeCounters(undo.counters, counters);
      undo = null;
      push({ t: now(), body: 'note clear undone' });
      return true;
    },
    dropUndo() { undo = null; },
  };

  if (initialState != null) rec.state(null, initialState);
  return rec;
}

export function readSaved(storage) {
  try {
    const raw = storage ? storage.getItem(LOG_KEY) : null;
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || v.v !== 1 || typeof v.text !== 'string') return null;
    return { build: String(v.build || '?'), started: Number(v.started) || 0, saved: Number(v.saved) || 0, lines: Number(v.lines) || 0, text: v.text };
  } catch {
    return null;
  }
}

function styleAll(el, props) {
  for (const key in props) el.style[key] = props[key];
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BUTTON_BASE = {
  margin: '0', boxSizing: 'border-box', border: '0', borderRadius: '12px', minHeight: '44px', padding: '0 18px',
  touchAction: 'manipulation', cursor: 'pointer', appearance: 'none', webkitAppearance: 'none',
};
const PRIMARY = { ...BUTTON_BASE, background: '#ffd400', color: '#111', font: `800 17px ${FONT}`, padding: '0 26px' };
const SECONDARY = { ...BUTTON_BASE, background: 'rgba(255, 255, 255, 0.14)', color: '#fff', font: `700 16px ${FONT}` };
const RESULT_COLOURS = { good: '#3ddc84', bad: '#ffb300', info: 'rgba(255, 255, 255, 0.85)' };

function pressable(btn) {
  const down = () => { btn.style.transform = 'scale(0.96)'; btn.style.filter = 'brightness(0.85)'; };
  const up = () => { btn.style.transform = ''; btn.style.filter = ''; };
  btn.addEventListener('pointerdown', down);
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(type, up);
}

export function createDebugLog(opts = {}) {
  const { enabled, win, doc } = opts;
  if (!enabled || !win || !doc) return null;
  const {
    build = '?',
    getStorage = () => null,
    getSample = () => null,
    getLastDown = () => null,
    onOpen = () => {},
    pauseHost = null,
    initialState = null,
    clock = () => (win.performance && typeof win.performance.now === 'function' ? win.performance.now() : Date.now()),
    now = () => Date.now(),
    defer = (fn) => { if (typeof win.setTimeout === 'function') win.setTimeout(fn, 0); else fn(); },
  } = opts;
  const idle = opts.idle || (typeof win.requestIdleCallback === 'function' ? (fn) => win.requestIdleCallback(fn, { timeout: 1000 }) : defer);
  const nav = win.navigator || {};

  let storage = null;
  try { storage = getStorage() || null; } catch { storage = null; }
  const previous = readSaved(storage);

  let standalone = false;
  try { standalone = nav.standalone === true || (typeof win.matchMedia === 'function' && !!win.matchMedia('(display-mode: standalone)').matches); } catch { standalone = false; }
  const timeOrigin = win.performance && Number.isFinite(win.performance.timeOrigin) ? win.performance.timeOrigin : now() - clock();
  const rec = createRecorder({ build, clock, initialState, meta: {
    startedEpoch: Math.round(timeOrigin),
    page: (win.location && win.location.search) || '(no query)',
    viewport: `${win.innerWidth}x${win.innerHeight}`,
    dpr: win.devicePixelRatio || 1,
    touchPoints: nav.maxTouchPoints || 0,
    standalone,
    ua: oneLine(nav.userAgent || '?', 300),
  } });

  let hookFailed = false;
  const guard = (fn) => (e) => {
    try { fn(e); } catch (err) {
      if (hookFailed) return;
      hookFailed = true;
      try { rec.note('note', `debug log hook failed: ${errorMessage(err)}`); } catch {   }
    }
  };
  const on = (target, type, fn, options) => target.addEventListener(type, guard(fn), options);
  const CAP = { capture: true, passive: true };

  let savedVersion = -1;
  let lastSaveAt = clock();
  let soon = false;
  let queued = false;
  let saveFailNoted = false;
  function persist() {
    queued = false;
    if (!storage) return false;
    const t0 = clock();
    let budget = PERSIST_BUDGET;
    let ok = false;
    while (!ok && budget >= PERSIST_MIN) {
      try { storage.setItem(LOG_KEY, JSON.stringify(rec.persistRecord(budget, now()))); ok = true; } catch { budget = Math.floor(budget / 2); }
    }
    if (!ok && !saveFailNoted) {
      saveFailNoted = true;
      rec.note('note', 'this log could not be saved in the browser (storage full or blocked): export it before reloading');
    }
    savedVersion = rec.version;
    lastSaveAt = clock();
    soon = false;
    rec.noteSave(clock() - t0);
    return ok;
  }

  function viewSig() {
    const vv = win.visualViewport;
    const so = win.screen && win.screen.orientation;
    const orient = so && so.type ? `${so.type} ${so.angle}` : (win.orientation !== undefined ? `angle ${win.orientation}` : 'orientation unknown');
    const v = vv ? ` visual ${fx(vv.width, 0)}x${fx(vv.height, 0)}+${fx(vv.offsetLeft, 0)},${fx(vv.offsetTop, 0)} zoom ${fx(vv.scale, 2)}` : '';
    return `${win.innerWidth}x${win.innerHeight}${v} ${orient}`;
  }
  rec.note('boot', `build ${build}; ${previous ? `previous session log found (${previous.lines} lines, saved ${clockTime(previous.saved)} on ${shortDate(previous.saved)})` : 'no previous session log'}${storage ? '' : '; no storage: this log lasts until the page closes'}`);
  let lastViewSig = viewSig();
  rec.note('view', lastViewSig);

  const ignored = new Set();
  let pending = null;
  let corner = null;
  let cornerWord = null;
  let pauseBtn = null;
  let panel = null;
  const isOwn = (t) => !!t && ((corner && corner.contains(t)) || (pauseBtn && pauseBtn.contains(t)) || (panel && panel.root.contains(t)));
  on(win, 'pointerdown', (e) => {
    if (isOwn(e.target)) { ignored.add(e.pointerId); pending = null; return; }
    let under = null;
    try { under = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(e.clientX, e.clientY) : null; } catch { under = null; }
    pending = rec.down({ id: e.pointerId, type: e.pointerType || 'pointer', x: e.clientX, y: e.clientY, under: describeElement(under), target: describeElement(e.target) });
  }, CAP);
  on(win, 'pointerdown', (e) => {
    const entry = pending;
    pending = null;
    if (!entry || entry.id !== e.pointerId) return;
    const ld = getLastDown();
    const seen = !!ld && ld.x === e.clientX && ld.y === e.clientY && (ld.id === undefined || ld.id === e.pointerId);
    rec.resolve(entry, seen ? ld.zone : 'unseen');
  }, { passive: true });
  on(win, 'pointermove', (e) => { if (!ignored.has(e.pointerId)) rec.move(e.pointerId, e.clientX, e.clientY); }, CAP);
  const onEnd = (kind) => (e) => { if (!ignored.delete(e.pointerId)) rec.end(kind, e.pointerId, e.clientX, e.clientY); };
  on(win, 'pointerup', onEnd('up'), CAP);
  on(win, 'pointercancel', onEnd('cancel'), CAP);
  on(win, 'touchstart', (e) => rec.touches(e.touches ? e.touches.length : 0), CAP);

  function afterError() {
    soon = true;
    if (corner) { corner.style.borderColor = '#ffb300'; cornerWord.textContent = 'Log !'; }
    defer(raise);
  }
  on(win, 'error', (e) => {
    const t = e && e.target;
    if (t && t !== win && t.tagName) rec.error(`resource failed to load: ${describeElement(t)} ${stripOrigin(t.src || t.href || '')}`);
    else rec.error(`script: ${(e && (e.message || (e.error && e.error.message))) || 'unknown error'}${e && e.filename ? ` (${stripOrigin(e.filename)}:${e.lineno}:${e.colno})` : stackWhere(e && e.error)}`);
    afterError();
  }, { capture: true });
  on(win, 'unhandledrejection', (e) => {
    const r = e ? e.reason : undefined;
    rec.error(`unhandled rejection: ${errorMessage(r)}${stackWhere(r)}`);
    afterError();
  });
  on(win, 'webglcontextlost', (e) => { rec.error(`WebGL context lost on ${describeElement(e.target)}`); afterError(); }, CAP);
  on(win, 'webglcontextrestored', (e) => rec.note('webgl', `context restored on ${describeElement(e.target)}`), CAP);
  on(doc, 'securitypolicyviolation', (e) => { rec.error(`blocked by the page security policy: ${e.violatedDirective} ${stripOrigin(e.blockedURI || '')}`); afterError(); });

  const viewEvent = (label, always) => () => {
    const sig = viewSig();
    if (!always && sig === lastViewSig) return;
    lastViewSig = sig;
    rec.note(label, sig);
  };
  on(win, 'resize', viewEvent('resize', false));
  on(win, 'orientationchange', viewEvent('orientationchange', true));
  const so = win.screen && win.screen.orientation;
  if (so && typeof so.addEventListener === 'function') on(so, 'change', viewEvent('orientation', true));
  const vv = win.visualViewport;
  if (vv && typeof vv.addEventListener === 'function') { on(vv, 'resize', viewEvent('viewport', false)); on(vv, 'scroll', viewEvent('viewport', false)); }
  on(doc, 'visibilitychange', () => { rec.note('visibility', doc.hidden ? 'hidden' : 'visible'); if (doc.hidden) persist(); });
  on(win, 'pagehide', (e) => { rec.note('page', `hide${e && e.persisted ? ' (kept in memory)' : ''}`); persist(); });
  on(win, 'pageshow', (e) => { if (e && e.persisted) rec.note('page', 'shown again from memory'); });
  on(win, 'blur', () => rec.note('focus', 'window lost focus (held controls are released)'));
  on(win, 'focus', () => rec.note('focus', 'window focused'));

  corner = doc.createElement('button');
  corner.type = 'button';
  corner.setAttribute('aria-label', 'Debug log, recording. Open it to copy or share.');
  const dot = doc.createElement('span');
  styleAll(dot, { display: 'block', width: '8px', height: '8px', borderRadius: '50%', background: '#ff4d4d', flex: '0 0 auto' });
  dot.setAttribute('aria-hidden', 'true');
  cornerWord = doc.createElement('span');
  cornerWord.textContent = 'Log';
  corner.appendChild(dot);
  corner.appendChild(cornerWord);
  styleAll(corner, {
    position: 'fixed', left: `calc(${CORNER.left}px + env(safe-area-inset-left, 0px))`, top: `calc(${CORNER.top}px + env(safe-area-inset-top, 0px))`,
    width: `${CORNER.width}px`, height: `${CORNER.height}px`, margin: '0', padding: '0', boxSizing: 'border-box',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    borderRadius: '22px', border: '2px solid rgba(255, 255, 255, 0.75)', background: 'rgba(0, 0, 0, 0.6)', color: '#fff',
    font: `700 13px ${FONT}`, touchAction: 'manipulation', pointerEvents: 'auto', cursor: 'pointer',
    appearance: 'none', webkitAppearance: 'none', zIndex: MAX_Z,
  });
  pressable(corner);
  corner.addEventListener('click', () => openPanel(corner));
  (doc.body || doc.documentElement).appendChild(corner);

  if (pauseHost && typeof pauseHost.appendChild === 'function') {
    pauseBtn = doc.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'btn-secondary';
    pauseBtn.textContent = 'Debug log';
    pauseBtn.addEventListener('click', () => openPanel(pauseBtn));
    pauseHost.appendChild(pauseBtn);
  }

  function raise() {
    const body = doc.body;
    if (!body) return;
    if (corner.parentNode === body) body.appendChild(corner);
    if (panel && isOpen && panel.root.parentNode === body) body.appendChild(panel.root);
  }

  let isOpen = false;
  let opener = null;
  let viewing = 'this';
  let undoTimer = 0;

  function button(label, style) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    styleAll(b, style);
    pressable(b);
    return b;
  }

  function buildPanel() {
    const root = doc.createElement('div');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Debug log');
    styleAll(root, {
      position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', display: 'none', flexDirection: 'column', gap: '8px',
      padding: 'calc(10px + env(safe-area-inset-top, 0px)) calc(12px + env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) calc(12px + env(safe-area-inset-left, 0px))',
      boxSizing: 'border-box', background: '#16181b', color: '#fff', font: `15px/1.35 ${FONT}`, zIndex: MAX_Z,
      touchAction: 'manipulation', pointerEvents: 'auto',
    });

    root.addEventListener('contextmenu', (e) => e.stopPropagation());

    const head = doc.createElement('div');
    styleAll(head, { display: 'flex', alignItems: 'center', gap: '12px', flex: '0 0 auto' });
    const title = doc.createElement('h2');
    title.textContent = 'Debug log';
    styleAll(title, { margin: '0', font: `800 19px ${FONT}`, flex: '0 0 auto' });
    const infoLine = doc.createElement('p');
    styleAll(infoLine, { margin: '0', flex: '1 1 auto', minWidth: '0', fontSize: '13px', lineHeight: '1.3', opacity: '0.85' });
    const close = button('Close', SECONDARY);
    close.addEventListener('click', () => closePanel());
    head.appendChild(title);
    head.appendChild(infoLine);
    head.appendChild(close);

    const ta = doc.createElement('textarea');
    ta.readOnly = true;
    ta.setAttribute('inputmode', 'none');
    ta.setAttribute('aria-label', 'Log text');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.spellcheck = false;
    styleAll(ta, {
      flex: '1 1 auto', minHeight: '60px', width: '100%', margin: '0', padding: '6px 8px', boxSizing: 'border-box',
      borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.22)', background: '#0b0c0e', color: '#e9e9e9',
      font: '11px/1.35 ui-monospace, Menlo, monospace', resize: 'none', overflow: 'auto', overscrollBehavior: 'contain',
      touchAction: 'pan-y', userSelect: 'text', webkitUserSelect: 'text', webkitTouchCallout: 'default',
    });

    const actions = doc.createElement('div');
    styleAll(actions, { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', flex: '0 0 auto' });
    const copy = button('Copy', PRIMARY);
    const share = button('Share', SECONDARY);
    const clear = button('Clear', SECONDARY);
    const prev = button('Previous session log', SECONDARY);
    const resultLine = doc.createElement('p');
    resultLine.setAttribute('role', 'status');
    resultLine.setAttribute('aria-live', 'polite');
    styleAll(resultLine, { margin: '0', flex: '1 1 200px', minWidth: '0', fontSize: '14px', fontWeight: '700', lineHeight: '1.3' });
    if (typeof nav.share !== 'function') { share.disabled = true; share.textContent = 'Share (not in this browser)'; share.style.opacity = '0.45'; }
    if (!previous) { prev.disabled = true; prev.textContent = 'No previous session log'; prev.style.opacity = '0.45'; }
    copy.addEventListener('click', () => { copyNow(); });
    share.addEventListener('click', () => { shareNow(); });
    clear.addEventListener('click', () => clearOrUndo());
    prev.addEventListener('click', () => { viewing = viewing === 'this' ? 'previous' : 'this'; render(); setResult('', 'info'); });
    for (const b of [copy, share, clear, prev]) actions.appendChild(b);
    actions.appendChild(resultLine);

    root.appendChild(head);
    root.appendChild(ta);
    root.appendChild(actions);
    (doc.body || doc.documentElement).appendChild(root);
    return { root, info: infoLine, ta, copy, share, clear, prev, result: resultLine, close };
  }

  function currentText() { return viewing === 'previous' && previous ? previous.text : rec.text(now()); }
  function infoText() {
    if (viewing === 'previous' && previous) {
      return `Previous session (build ${previous.build}): started ${clockTime(previous.started)} on ${shortDate(previous.started)}, saved ${clockTime(previous.saved)}, ${thousands(previous.lines)} lines.`;
    }
    const s = rec.stats();
    const unsaved = !storage ? ' Not kept after a reload in this browser: copy it first.'
      : (saveFailNoted ? ' Saving failed (storage full or blocked): copy it before reloading.' : '');
    return `This session: ${thousands(s.lines)} lines over ${duration(s.durationMs)}. Touches: ${s.hits} hit a zone, ${s.missed} missed. Errors: ${s.errors}.${s.dropped ? ` Oldest ${thousands(s.dropped)} lines dropped.` : ''}${unsaved}`;
  }

  function render() {
    const text = currentText();
    panel.ta.value = text;
    panel.ta.scrollTop = 0;
    panel.info.textContent = infoText();
    panel.clear.style.display = viewing === 'this' ? '' : 'none';
    if (previous) panel.prev.textContent = viewing === 'this' ? 'Previous session log' : 'This session log';
    return text;
  }
  function setResult(text, kind) {
    panel.result.textContent = text;
    panel.result.style.color = RESULT_COLOURS[kind] || RESULT_COLOURS.info;
  }
  const copiedText = () => `Copied the log (${thousands(viewing === 'previous' && previous ? previous.lines : rec.size)} lines plus the summary). Paste it into the chat.`;

  function fallbackCopy() {
    let ok = false;
    try {
      const ta = panel.ta;
      ta.style.fontSize = '16px';
      ta.readOnly = false;
      try { ta.focus({ preventScroll: true }); } catch { ta.focus(); }
      ta.setSelectionRange(0, ta.value.length);
      if (typeof ta.select === 'function') ta.select();
      ta.readOnly = true;
      ok = typeof doc.execCommand === 'function' && !!doc.execCommand('copy');
    } catch { ok = false; }
    if (ok) setResult(copiedText(), 'good');
    else setResult('Copy was blocked by the browser. The whole log is selected below: press and hold it, then tap Copy. Or use Share.', 'bad');
    return ok;
  }
  function copyNow() {
    const text = render();
    const clip = nav.clipboard;
    if (!clip || typeof clip.writeText !== 'function') return Promise.resolve(fallbackCopy());
    let p;
    try { p = clip.writeText(text); } catch (err) { p = Promise.reject(err); }
    return Promise.resolve(p).then(
      () => { setResult(copiedText(), 'good'); return true; },
      () => fallbackCopy(),
    );
  }
  function shareNow() {
    const text = render();
    if (typeof nav.share !== 'function') { setResult('Share is not available in this browser. Use Copy.', 'bad'); return Promise.resolve(false); }
    let p;
    try { p = nav.share({ title: 'Drift kart debug log', text }); } catch (err) { p = Promise.reject(err); }
    return Promise.resolve(p).then(
      () => { setResult('Shared.', 'good'); return true; },
      (err) => {
        if (err && err.name === 'AbortError') setResult('Share cancelled. Nothing was sent.', 'info');
        else setResult(`Share failed (${(err && err.name) || 'error'}). Use Copy instead.`, 'bad');
        return false;
      },
    );
  }
  function disarmUndo() {
    if (undoTimer) { const ct = typeof win.clearTimeout === 'function' ? win.clearTimeout : null; if (ct) ct(undoTimer); undoTimer = 0; }
    rec.dropUndo();
    if (panel) panel.clear.textContent = 'Clear';
  }
  function clearOrUndo() {
    if (rec.canUndo) {
      if (undoTimer && typeof win.clearTimeout === 'function') win.clearTimeout(undoTimer);
      undoTimer = 0;
      rec.undoClear();
      panel.clear.textContent = 'Clear';
      render();
      setResult('Clear undone. Nothing was lost.', 'good');
      return;
    }
    const removed = rec.clear();
    panel.clear.textContent = 'Undo clear';
    if (typeof win.setTimeout === 'function') undoTimer = win.setTimeout(disarmUndo, UNDO_MS);
    render();
    setResult(`Cleared ${thousands(removed)} lines. Recording carries on. Undo clear is here for ${UNDO_MS / 1000} s.`, 'info');
  }

  function keyGuard(e) {
    if (e.key === 'Escape' || e.code === 'Escape') { if (typeof e.preventDefault === 'function') e.preventDefault(); closePanel(); }
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }

  function openPanel(from) {
    opener = from || null;
    try { onOpen(); } catch (err) { rec.note('note', `pausing for the log failed: ${errorMessage(err)}`); }
    if (!panel) panel = buildPanel();
    const body = doc.body;
    if (body && panel.root.parentNode === body) body.appendChild(panel.root);
    viewing = 'this';
    panel.root.style.display = 'flex';
    if (!isOpen) win.addEventListener('keydown', keyGuard, true);
    isOpen = true;
    render();
    setResult(rec.canUndo ? 'Undo clear is still available.' : '', 'info');
    try { panel.copy.focus(); } catch {   }
  }
  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    panel.root.style.display = 'none';
    panel.ta.style.fontSize = '11px';
    win.removeEventListener('keydown', keyGuard, true);
    if (opener && typeof opener.focus === 'function') { try { opener.focus(); } catch {   } }
  }

  let lastPoll = -Infinity;
  function onFrame(tNow, frameMs, running) {
    rec.frameTick(tNow, frameMs, running);
    if (tNow - lastPoll >= SAMPLE_MS) {
      lastPoll = tNow;
      let s = null;
      try { s = getSample(); } catch (err) { rec.error(`sample failed: ${errorMessage(err)}`); }
      if (s) rec.sample(s);
    }
    if (!queued && storage && rec.version !== savedVersion && tNow - lastSaveAt >= (soon ? PERSIST_SOON_MS : PERSIST_MS)) {
      queued = true;
      idle(persist);
    }
  }

  return {
    enabled: true,
    recorder: rec,
    previous,
    get open() { return isOpen; },
    get corner() { return corner; },
    get pauseButton() { return pauseBtn; },
    get panel() { return panel; },

    tick(tNow, frameMs, running) {
      try { onFrame(tNow, frameMs, running); } catch (err) {
        if (!hookFailed) { hookFailed = true; rec.note('note', `debug log frame hook failed: ${errorMessage(err)}`); }
      }
    },
    state(prev, next) { rec.state(prev, next); },
    note(kind, text) { rec.note(kind, text); },
    zones(rects) { rec.zones(rects); },
    failure(label, err) { rec.error(`${label}: ${errorMessage(err)}${stackWhere(err)}`); afterError(); },
    persist,
    openPanel,
    closePanel,
    copy: () => (panel ? copyNow() : Promise.resolve(false)),
    share: () => (panel ? shareNow() : Promise.resolve(false)),
    clearOrUndo: () => { if (panel) clearOrUndo(); },
    showPrevious: () => { if (panel && previous) { viewing = 'previous'; render(); } },
    text: () => currentText(),
  };
}
