

import { formatClock, formatDate, setupLine } from './format.js';

function toggle(node, cls, on) { if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on); }
function setText(node, v) { if (node && node.__v !== v) { node.__v = v; node.textContent = v; } }

export function createTitleHomeUi(doc, handlers) {
  const $ = (id) => doc.getElementById(id);
  const el = {
    start: $('start-btn'), touch: $('touch-btn'), retry: $('retry-btn'),
    calibBtn: $('calib-btn'), calibKeep: $('calib-keep'),
    modeList: $('mode-list'), circuitList: $('circuit-list'), refList: $('ref-list'), replayList: $('replay-list'),
    refHeading: $('ref-heading'),
    garageBtn: $('garage-btn'), settingsBtn: $('settings-btn'), driveBtn: $('drive-btn'), driveSetup: $('drive-setup'),
  };

  const bind = (node, fn) => node && node.addEventListener('click', (e) => { fn(e); node.blur(); });
  bind(el.start, () => handlers.start());
  bind(el.touch, () => handlers.useTouch());
  bind(el.retry, () => handlers.retryMotion());
  bind(el.calibBtn, () => handlers.calibrate());
  bind(el.calibKeep, () => handlers.keepCalibration());
  bind(el.garageBtn, () => handlers.openGarage());
  bind(el.settingsBtn, () => handlers.openSettings());
  bind(el.driveBtn, () => handlers.drive());

  el.modeList.addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) handlers.selectMode(b.dataset.mode); });

  return {
    ready(version) {
      for (const n of doc.querySelectorAll('.version')) n.textContent = `Build ${version}`;
      el.start.disabled = false;
      el.start.textContent = 'Tap to start';
      doc.documentElement.classList.add('booted');
    },

    renderModes(current) {
      for (const b of el.modeList.querySelectorAll('button')) { const on = b.dataset.mode === current; b.setAttribute('aria-checked', String(on)); }
      el.refHeading.textContent = current === 'drift' || current === 'time' ? 'Sector' : (current === 'free' ? 'Lap' : 'Replays');
      el.refList.hidden = current === 'replays';
      el.replayList.hidden = current !== 'replays';
      el.driveBtn.hidden = current === 'replays';
    },

    renderSetup(summary) {
      if (!el.driveSetup) return;
      el.driveSetup.hidden = !summary;
      setText(el.driveSetup, setupLine(summary));
    },

    renderCircuits(list, currentKey) {
      el.circuitList.innerHTML = '';
      for (const c of list) {
        const b = doc.createElement('button');
        b.type = 'button'; b.role = 'radio'; b.dataset.key = c.key;
        b.setAttribute('aria-checked', String(c.key === currentKey));
        b.innerHTML = '';
        b.textContent = c.label;
        if (c.lapLength) { const small = doc.createElement('small'); small.textContent = `${(c.lapLength / 1000).toFixed(2)} km`; b.appendChild(small); }
        b.addEventListener('click', () => handlers.selectCircuit(c.key));
        el.circuitList.appendChild(b);
      }
    },

    renderRefs(list, currentRef, bestForFn) {
      el.refList.innerHTML = '';
      for (const r of list) {
        const b = doc.createElement('button');
        b.type = 'button'; b.role = 'radio'; b.dataset.ref = r.id;
        b.setAttribute('aria-checked', String(r.id === currentRef));
        b.textContent = r.label;
        const best = bestForFn ? bestForFn(r.id) : null;
        if (best) {
          const small = doc.createElement('small');
          small.textContent = best.isTime ? `Best ${formatClock(best.value)}` : `Best ${Math.round(best.value)} pts`;
          b.appendChild(small);
        }
        b.addEventListener('click', () => handlers.selectRef(r.id));
        el.refList.appendChild(b);
      }
    },

    renderReplays(list) {
      el.replayList.innerHTML = '';
      if (!list.length) { const p = doc.createElement('p'); p.className = 'note'; p.textContent = 'No replays saved yet.'; el.replayList.appendChild(p); return; }
      for (const r of [...list].reverse()) {
        const b = doc.createElement('button');
        b.type = 'button';
        const scoreText = r.finalTime !== null && r.finalTime !== undefined ? formatClock(r.finalTime) : (r.finalScore !== null ? `${Math.round(r.finalScore)} pts` : '');
        b.textContent = `${r.label || r.ref} - ${scoreText}`;
        const small = doc.createElement('small');
        small.textContent = `${r.circuit} ${r.layout}, ${formatDate(new Date(r.savedAt))}`;
        b.appendChild(small);
        b.addEventListener('click', () => handlers.selectReplay(r.slot));
        el.replayList.appendChild(b);
      }
    },
  };
}

export function tryFullscreenLandscape(doc, nav) {
  if (!/Android/i.test((nav && nav.userAgent) || '')) return;
  const lock = () => {
    try { const o = globalThis.screen && globalThis.screen.orientation; if (o && typeof o.lock === 'function') o.lock('landscape').catch(() => {}); } catch {   }
  };
  try {
    const de = doc.documentElement;
    const p = typeof de.requestFullscreen === 'function' ? de.requestFullscreen({ navigationUI: 'hide' }) : null;
    if (p && typeof p.then === 'function') p.then(lock, () => {}); else lock();
  } catch {   }
}

export function keepAwake(doc, nav) {
  if (!nav || !nav.wakeLock) return;
  const request = () => { if (doc.visibilityState !== 'visible') return; try { nav.wakeLock.request('screen').catch(() => {}); } catch {   } };
  doc.addEventListener('visibilitychange', request);
  request();
}
