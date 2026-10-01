

import { formatClock, formatDelta, assistLabel, setupChipText } from './format.js';

const RING = 132;
const ASSIST_CYCLE = ['off', 'low', 'med', 'high'];

function toggle(node, cls, on) { if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on); }
function setText(node, v) { if (node.__v !== v) { node.__v = v; node.textContent = v; } }

export function createDriveUi(doc, handlers) {
  const $ = (id) => doc.getElementById(id);
  const el = {
    app: $('app'), canvas: $('view'),
    resume: $('resume-btn'), pauseRecentre: $('pause-recentre'), pauseReset: $('pause-reset'), pauseKeys: $('pause-keys'), pauseQuit: $('pause-quit'),
    pauseAssistSeg: $('pause-assist-seg'),
    modeChip: $('mode-chip'), setupChip: $('setup-chip'), assistChip: $('assist-chip'), ghostChip: $('ghost-chip'), whatifChip: $('whatif-chip'), slowChip: $('slow-chip'), desktopChip: $('desktop-chip'),
    timer: $('timer'), scoreBox: $('score-box'), scoreValue: $('score-value'), segmentValue: $('segment-value'),
    deltaChip: $('delta-chip'), offTrackFlag: $('offtrack-flag'),
    needle: $('arc-needle'), driftValue: $('drift-value'), speedValue: $('speed-value'), motorFill: $('motor-fill'),
    thrRaw: $('thr-raw'), thrFill: $('thr-fill'), brkFill: $('brk-fill'), resetRing: $('reset-ring'),
    nudge: $('nudge'), flash: $('flash'), error: $('error'), rotate: $('scr-rotate'),
    updateBanner: $('update-banner'), updateReload: $('update-reload-btn'),
    resultsHeading: $('results-heading'), resultsMain: $('results-main'), resultsBest: $('results-best'), resultsWhatif: $('results-whatif'),
    resultsRetry: $('results-retry'), resultsSave: $('results-save'), resultsHome: $('results-home'), resultsAssist: $('results-assist'), resultsHash: $('results-hash'),
    zones: {
      throttle: $('z-throttle'), brake: $('z-brake'), handbrake: $('z-handbrake'), reset: $('z-reset'), pause: $('z-pause'),
      steerLeft: $('z-left'), steerRight: $('z-right'),
    },
  };

  const bind = (node, fn) => node.addEventListener('click', (e) => { fn(e); node.blur(); });
  bind(el.resume, handlers.resume);
  bind(el.pauseRecentre, handlers.recentre);
  bind(el.pauseReset, handlers.resetKart);
  bind(el.pauseQuit, handlers.quit);
  bind(el.resultsRetry, handlers.retry);
  bind(el.resultsHome, handlers.home);
  bind(el.resultsSave, () => handlers.saveReplay(''));
  bind(el.speedValue.parentElement, handlers.cycleCamera);
  bind(el.assistChip, () => { const cur = el.assistChip.dataset.level || 'low'; const next = ASSIST_CYCLE[(ASSIST_CYCLE.indexOf(cur) + 1) % ASSIST_CYCLE.length]; handlers.setAssist(next); });
  el.pauseAssistSeg.addEventListener('click', (e) => { const b = e.target.closest('button[data-assist]'); if (b) handlers.setAssist(b.dataset.assist); });
  if (el.updateReload) el.updateReload.addEventListener('click', () => { if (el.__onReload) el.__onReload(); });

  let flashTimer = 0;

  return {
    canvas: el.canvas,

    setState(name) { el.app.dataset.state = name; },

    setMode(mode) {
      toggle(el.app, 'touchsteer', mode === 'touchsteer');
      el.zones.steerLeft.hidden = mode !== 'touchsteer';
      el.zones.steerRight.hidden = mode !== 'touchsteer';
      el.pauseKeys.hidden = mode !== 'keyboard';
      el.pauseRecentre.hidden = mode !== 'tilt';
      el.desktopChip.hidden = mode !== 'keyboard' && mode !== 'gamepad';
      if (el.desktopChip.hidden === false) setText(el.desktopChip, mode === 'gamepad' ? 'GAMEPAD' : 'KEYBOARD');
    },

    setAssist(level) {
      el.assistChip.dataset.level = level;
      setText(el.assistChip, `ASSIST ${assistLabel(level).toUpperCase()}`);
      for (const b of el.pauseAssistSeg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.assist === level));
    },

    setSetup(summary) {
      if (!el.setupChip) return;
      el.setupChip.hidden = !summary;
      if (!summary) return;
      setText(el.setupChip, setupChipText(summary));
      el.setupChip.setAttribute('aria-label', `${summary.label}, geared top speed ${Math.round(summary.gearedTopKmh)} km/h`);
    },

    rotate(on) { el.rotate.hidden = !on; },

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

    hud({ speedKmh, driftDeg, betaDeg, mode, slow, scoreSegment, scoreTotal, offTrack, deltaS, hasGhost, motorFrac, elapsedTicks }) {
      setText(el.speedValue, String(Math.round(speedKmh)));
      setText(el.driftValue, String(Math.round(driftDeg > 0 ? driftDeg : 0)));
      const nb = betaDeg > 90 ? 90 : (betaDeg < -90 ? -90 : betaDeg);
      el.needle.setAttribute('transform', `rotate(${nb.toFixed(1)} 60 60)`);
      toggle(el.needle, 'spin', Math.abs(betaDeg) > 100);
      el.slowChip.hidden = !slow;
      if (motorFrac !== undefined) { el.motorFill.style.width = `${Math.min(100, motorFrac * 100).toFixed(0)}%`; toggle(el.motorFill, 'cap', motorFrac >= 0.98); }

      setText(el.modeChip, mode === 'drift' ? 'DRIFT' : mode === 'time' ? 'TT' : mode === 'replay' ? 'REPLAY' : 'FREE');
      const showScore = mode === 'drift';
      el.scoreBox.hidden = !showScore;
      el.timer.hidden = showScore;
      if (showScore) { setText(el.scoreValue, String(Math.round(scoreTotal))); setText(el.segmentValue, `+${Math.round(scoreSegment)}`); }
      else if (elapsedTicks !== undefined) setText(el.timer, formatClock(elapsedTicks / 60));

      el.offTrackFlag.hidden = !offTrack;
      el.ghostChip.hidden = !hasGhost;
      el.deltaChip.hidden = !(hasGhost && deltaS !== null && deltaS !== undefined);
      if (!el.deltaChip.hidden) {
        setText(el.deltaChip, formatDelta(deltaS));
        toggle(el.deltaChip, 'good', deltaS < 0);
        toggle(el.deltaChip, 'bad', deltaS > 0);
      }
    },

    nudge(text) { el.nudge.hidden = !text; if (text) setText(el.nudge, text); },
    flash(text, kind = 'info', ms = 1200) {
      setText(el.flash, text);
      el.flash.className = `flash ${kind}`;
      el.flash.hidden = false;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { el.flash.hidden = true; }, ms);
    },
    error(text) { el.error.hidden = false; el.error.textContent = String(text).slice(0, 220); },

    showUpdateBanner(onReload) { el.__onReload = onReload; el.updateBanner.hidden = false; },

    results(r, { grade }) {
      el.whatifChip.hidden = !r.whatIf;
      el.resultsWhatif.hidden = !r.whatIf;
      el.resultsHeading.textContent = r.mode === 'drift' ? 'Drift result' : (r.mode === 'time' ? 'Time trial' : 'Result');
      el.resultsMain.innerHTML = '';
      if (r.mode === 'drift') {
        const g = doc.createElement('span'); g.className = `grade ${grade || 'D'}`; g.textContent = grade || 'D';
        const score = doc.createElement('div'); score.textContent = `${Math.round(r.finalScore || 0)} points`;
        el.resultsMain.append(g, score);
      } else if (r.mode === 'time') {
        const t = doc.createElement('div');
        t.className = r.invalid ? 'struck' : '';
        t.textContent = formatClock(r.finalTime || 0);
        el.resultsMain.appendChild(t);
        if (r.invalid) { const note = doc.createElement('div'); note.className = 'note'; note.textContent = 'OFF TRACK: not written as a best.'; el.resultsMain.appendChild(note); }
      }
      if (r.mixed) { const note = doc.createElement('div'); note.className = 'note'; note.textContent = 'Assist changed during the run: not written as a best, no replay. Retry to set one.'; el.resultsMain.appendChild(note); }
      el.resultsBest.textContent = r.isNewBest ? 'New best for this setup.' : '';
      setText(el.resultsAssist, assistLabel(r.assist).toUpperCase());
      setText(el.resultsHash, r.garageHash || '');
      el.resultsSave.disabled = !r.replayLog;
    },
  };
}
