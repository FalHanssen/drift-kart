

import { isLiveRun } from './runState.js';

export function inputDebugRequested(search) {
  try {
    const params = new URLSearchParams(search || '');
    return params.getAll('debug').some((v) => v.split(',').map((s) => s.trim().toLowerCase()).includes('input'));
  } catch {
    return false;
  }
}

export function describeElement(el) {
  if (!el || typeof el !== 'object' || !el.tagName) return 'none';
  let s = String(el.tagName).toLowerCase();
  if (el.id) {
    s += `#${el.id}`;
  } else {
    const raw = typeof el.className === 'string' ? el.className
      : (el.className && typeof el.className.baseVal === 'string' ? el.className.baseVal : '');
    const cls = raw.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += `.${cls.join('.')}`;
    const parent = el.parentElement;
    const owner = parent && typeof parent.closest === 'function' ? parent.closest('[id]') : null;
    if (owner && owner.id) s += ` in #${owner.id}`;
  }
  return s.length > 60 ? `${s.slice(0, 59)}~` : s;
}

export function simStateLabel({ state, rotateUp = false, hidden = false, replay = false, hasSession = false, prelaunch = false, finished = false }) {
  if (state === 'pause') return 'paused';
  if (!isLiveRun(state)) return `stopped (${state})`;
  if (rotateUp) return 'stopped (rotate overlay)';
  if (hidden) return 'stopped (page hidden)';
  if (replay) return 'replay';
  if (!hasSession) return 'no session';
  if (finished) return 'finished';
  if (prelaunch) return 'HOLD (waiting for first input)';
  return 'running';
}

const num = (v, digits) => (Number.isFinite(v) ? v.toFixed(digits) : '-');
const signed = (v, digits) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}` : '-');

function zoneVerdict(touch, hit) {
  if (!hit || hit.x !== touch.x || hit.y !== touch.y) return 'NOT SEEN by input';
  if (hit.zone === null) return 'no zone';
  if (hit.zone === 'button') return 'button (input ignores it)';
  return hit.zone;
}

export function formatInputDebug(d) {
  const zones = Array.isArray(d.zones) ? d.zones : [];
  const lines = [
    `build ${d.build || '?'}  state ${d.state}`,
    `sim ${d.sim}  mode ${d.mode}  motion ${d.motion}`,
    `tilt raw ${signed(d.tiltRaw, 1)} filt ${signed(d.tiltFilt, 1)} deg  ${num(d.magG, 2)} g  flat ${d.flat ? 'YES' : 'no'}  cal ${d.calibrated ? 'yes' : 'no'}  n ${Number.isFinite(d.samples) ? d.samples : '-'}`,
    `to sim: steer ${signed(d.steer, 2)} thr ${num(d.throttle, 2)} brk ${num(d.brake, 2)} hb ${d.handbrake ? 1 : 0}`,
    `zones ${zones.length}: ${zones.length ? zones.join(' ') : 'NONE (every touch misses)'}`,
  ];
  const t = d.touch;
  if (!t) lines.push('touch: none yet');
  else lines.push(`touch ${Math.round(t.x)},${Math.round(t.y)} ${t.type} > ${zoneVerdict(t, d.hit)} | ${t.under}${t.target !== t.under ? ` (target ${t.target})` : ''}`);
  return lines.join('\n');
}

function styleAll(el, props) {
  for (const key in props) el.style[key] = props[key];
}

export function createInputDebug({ doc, win, enabled, getData, intervalMs = 100 }) {
  if (!enabled || !doc || !win) return { enabled: false, element: null, update() {} };
  const box = doc.createElement('pre');
  styleAll(box, {
    position: 'fixed', left: 'calc(8px + env(safe-area-inset-left, 0px))', top: 'calc(64px + env(safe-area-inset-top, 0px))',
    maxWidth: '44vw', margin: '0', padding: '4px 6px', borderRadius: '6px', background: 'rgba(0, 0, 0, 0.72)', color: '#fff',
    font: '10px/1.3 ui-monospace, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    pointerEvents: 'none', zIndex: '2147483000',
  });
  box.setAttribute('aria-hidden', 'true');
  (doc.body || doc.documentElement).appendChild(box);

  let touch = null;
  win.addEventListener('pointerdown', (e) => {
    const x = e.clientX, y = e.clientY;
    let under = null;
    try { under = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null; } catch { under = null; }
    touch = { x, y, type: e.pointerType || 'pointer', under: describeElement(under), target: describeElement(e.target) };
  }, { capture: true, passive: true });

  let last = -Infinity;
  return {
    enabled: true,
    element: box,
    update(now) {
      if (now - last < intervalMs) return;
      last = now;
      let text;
      try { text = formatInputDebug({ ...getData(), touch }); } catch (err) { text = `input readout failed: ${(err && err.message) || err}`; }
      if (box.textContent !== text) box.textContent = text;
    },
  };
}
