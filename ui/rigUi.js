

const HOLD_TARGET_S = 5;
const RING = 132;

function toggle(node, cls, on) {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

function setText(node, v) {
  if (node.__v !== v) { node.__v = v; node.textContent = v; }
}

export function createRigUi(doc, handlers) {
  const $ = (id) => doc.getElementById(id);
  const el = {
    app: $('app'), hud: $('hud'), canvas: $('view'),
    screens: { title: $('scr-title'), checking: $('scr-checking'), denied: $('scr-denied'), calib: $('scr-calib'), pause: $('scr-pause') },
    rotate: $('scr-rotate'),
    start: $('start-btn'), touch: $('touch-btn'), retry: $('retry-btn'),
    calibBtn: $('calib-btn'), calibKeep: $('calib-keep'), calibText: $('calib-text'),
    calibProgress: $('calib-progress'), calibFill: $('calib-fill'), levelBubble: $('level-bubble'), levelValue: $('level-value'),
    resume: $('resume-btn'), pauseRecentre: $('pause-recentre'), pauseReset: $('pause-reset'), pauseKeys: $('pause-keys'),
    recentre: $('recentre-btn'), assistSeg: $('assist-seg'), setupSeg: $('setup-seg'),
    holdBox: $('hold'), holdState: $('hold-state'), holdValue: $('hold-value'), holdFill: $('hold-fill'), holdBest: $('hold-best'),
    modeChip: $('mode-chip'), slowChip: $('slow-chip'),
    needle: $('arc-needle'), driftValue: $('drift-value'), speedValue: $('speed-value'),
    thrRaw: $('thr-raw'), thrFill: $('thr-fill'), brkFill: $('brk-fill'), resetRing: $('reset-ring'),
    nudge: $('nudge'), flash: $('flash'), error: $('error'),
    zones: {
      throttle: $('z-throttle'), brake: $('z-brake'), handbrake: $('z-handbrake'), reset: $('z-reset'),
      pause: $('z-pause'), steerLeft: $('z-left'), steerRight: $('z-right'),
    },
  };

  const bind = (node, fn) => node.addEventListener('click', (e) => { fn(e); node.blur(); });
  bind(el.start, () => handlers.start());
  bind(el.touch, () => handlers.useTouch());
  bind(el.retry, () => handlers.retryMotion());
  bind(el.calibBtn, () => handlers.calibrate());
  bind(el.calibKeep, () => handlers.keepCalibration());
  bind(el.resume, () => handlers.resume());
  bind(el.pauseRecentre, () => handlers.recentre());
  bind(el.pauseReset, () => handlers.resetKart());
  bind(el.recentre, () => handlers.recentre());
  el.assistSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-assist]');
    if (b) { handlers.assist(b.dataset.assist); b.blur(); }
  });
  el.setupSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-setup]');
    if (b) { handlers.setup(b.dataset.setup); b.blur(); }
  });

  let flashTimer = 0;

  return {
    canvas: el.canvas,

    ready(version) {
      for (const n of doc.querySelectorAll('.version')) n.textContent = `Rig ${version}`;
      el.start.disabled = false;
      el.start.textContent = 'Tap to start';
      doc.documentElement.classList.add('booted');
    },

    show(name) {
      for (const [k, node] of Object.entries(el.screens)) node.hidden = k !== name;
      el.hud.hidden = !(name === null || name === 'pause' || name === 'calib');
    },

    rotate(on) { el.rotate.hidden = !on; },

    setMode(mode) {
      toggle(el.hud, 'touchsteer', mode === 'touchsteer');
      el.zones.steerLeft.hidden = mode !== 'touchsteer';
      el.zones.steerRight.hidden = mode !== 'touchsteer';
      setText(el.modeChip, mode === 'tilt' ? 'Tilt' : mode === 'touchsteer' ? 'Touch steer' : 'Keyboard');
      el.pauseKeys.hidden = mode !== 'keyboard';
      el.recentre.hidden = mode !== 'tilt';
      el.pauseRecentre.hidden = mode !== 'tilt';
    },

    setAssist(level) {
      for (const b of el.assistSeg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.assist === level));
    },

    setSetup(id) {
      for (const b of el.setupSeg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.setup === id));
    },

    zoneRects() {
      const out = {};
      for (const [k, node] of Object.entries(el.zones)) {
        if (node.hidden) continue;
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out[k] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
      return out;
    },

    controls(st, resetProgress) {
      el.thrRaw.style.transform = `scaleY(${st.throttleStrip.toFixed(3)})`;
      el.thrFill.style.transform = `scaleY(${st.throttle.toFixed(3)})`;
      el.brkFill.style.transform = `scaleY(${st.brake.toFixed(3)})`;
      toggle(el.zones.handbrake, 'on', st.handbrake > 0);
      toggle(el.zones.steerLeft, 'on', st.steerLeft);
      toggle(el.zones.steerRight, 'on', st.steerRight);
      el.resetRing.setAttribute('stroke-dasharray', `${(resetProgress * RING).toFixed(1)} ${RING}`);
    },

    hud({ speedKmh, driftDeg, betaDeg, hold, slow }) {
      setText(el.speedValue, String(Math.round(speedKmh)));
      setText(el.driftValue, String(Math.round(driftDeg > 0 ? driftDeg : 0)));
      const nb = betaDeg > 90 ? 90 : (betaDeg < -90 ? -90 : betaDeg);
      el.needle.setAttribute('transform', `rotate(${nb.toFixed(1)} 60 60)`);
      toggle(el.needle, 'spin', Math.abs(betaDeg) > 100);
      const v = hold.active ? hold.current : hold.last;
      setText(el.holdValue, v.toFixed(1));
      setText(el.holdState, hold.active || hold.last === 0 ? 'Drift hold' : 'Last hold');
      el.holdFill.style.transform = `scaleX(${Math.min(1, v / HOLD_TARGET_S).toFixed(3)})`;
      setText(el.holdBest, hold.best.toFixed(1));
      toggle(el.holdBox, 'idle', !hold.active);
      toggle(el.holdBox, 'reached', v >= HOLD_TARGET_S);
      el.slowChip.hidden = !slow;
    },

    calibView({ level, progress, active }) {
      const c = level > 30 ? 30 : (level < -30 ? -30 : level);
      el.levelBubble.style.transform = `translateX(${((c / 30) * 128).toFixed(1)}px)`;
      toggle(el.levelBubble, 'off', Math.abs(level) > 3);
      setText(el.levelValue, String(Math.round(level)));
      el.calibProgress.hidden = !active;
      el.calibFill.style.transform = `scaleX(${(active ? progress : 0).toFixed(3)})`;
    },

    calibState(stateName, message, kind, canKeep) {
      el.calibBtn.disabled = stateName !== 'ready';
      el.calibBtn.textContent = stateName === 'capturing' ? 'Keep still...' : 'Set centre';
      el.calibKeep.hidden = !(canKeep && stateName === 'ready');
      setText(el.calibText, message);
      toggle(el.calibText, 'calib-result', !!kind);
      toggle(el.calibText, 'good', kind === 'good');
      toggle(el.calibText, 'bad', kind === 'bad');
    },

    nudge(text) {
      el.nudge.hidden = !text;
      if (text) setText(el.nudge, text);
    },

    flash(text, kind = 'info', ms = 1200) {
      setText(el.flash, text);
      el.flash.className = `flash ${kind}`;
      el.flash.hidden = false;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { el.flash.hidden = true; }, ms);
    },

    error(text) {
      el.error.hidden = false;
      el.error.textContent = String(text).slice(0, 220);
    },

    setState(name) { el.app.dataset.state = name; },

    debug(d) {
      const ds = el.app.dataset;
      ds.mode = d.mode;
      ds.steer = d.steer.toFixed(4);
      ds.throttle = d.throttle.toFixed(4);
      ds.speedKmh = d.speedKmh.toFixed(2);
      ds.coreAssist = String(d.coreAssist);
      ds.corePreset = d.corePreset;
    },
  };
}

export function tryFullscreenLandscape(doc, nav) {
  if (!/Android/i.test((nav && nav.userAgent) || '')) return;
  const lock = () => {
    try {
      const o = globalThis.screen && globalThis.screen.orientation;
      if (o && typeof o.lock === 'function') o.lock('landscape').catch(() => {});
    } catch {   }
  };
  try {
    const de = doc.documentElement;
    const p = typeof de.requestFullscreen === 'function' ? de.requestFullscreen({ navigationUI: 'hide' }) : null;
    if (p && typeof p.then === 'function') p.then(lock, () => {});
    else lock();
  } catch {   }
}

export function keepAwake(doc, nav) {
  if (!nav || !nav.wakeLock) return;
  const request = () => {
    if (doc.visibilityState !== 'visible') return;
    try { nav.wakeLock.request('screen').catch(() => {}); } catch {   }
  };
  doc.addEventListener('visibilitychange', request);
  request();
}
