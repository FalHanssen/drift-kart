

export const TESTPAD_STEPS = Object.freeze([
  { untilS: 10, prompt: 'Full throttle to the box, then brake.' },
  { untilS: 25, prompt: 'Through the cones. Tilt gently.', promptNoTilt: 'Through the cones. Steer gently.' },
  { untilS: 45, prompt: 'Handbrake into the circle. Hold the slide with the throttle.' },
  { untilS: 60, prompt: "Free. Change the assist with the chip if you want." },
]);

export function testpadPrompt(step, mode) {
  return mode !== 'tilt' && step.promptNoTilt ? step.promptNoTilt : step.prompt;
}

export const CALIB_FALLBACK_AFTER = 2;

export const LIVENESS = Object.freeze({ waitS: 1.2, minSamples: 3 });

export function fallbackSteerMode(touch) { return touch ? 'touchsteer' : 'keyboard'; }

export function steerFallbacks(touch) {
  return touch
    ? [{ mode: 'touchsteer', label: 'Use touch steering instead' }]
    : [{ mode: 'keyboard', label: 'Use keyboard instead' }, { mode: 'touchsteer', label: 'Use touch steering instead' }];
}

export function nextAfterSteering(introDone) { return introDone ? 'home' : 'testpad'; }

export function calibDoneTarget(returnTo, introDone) { return returnTo || nextAfterSteering(introDone); }

export function routeAfterPermission(result, { introDone, touch }) {
  if (result === 'granted') return introDone ? { mode: 'tilt', next: 'checking', confirmLive: true } : { mode: 'tilt', next: 'calib' };
  if (result === 'denied') return { mode: null, next: 'denied' };

  return {
    mode: fallbackSteerMode(touch), next: nextAfterSteering(introDone),
    flash: touch ? 'No motion sensor: touch steering' : 'No motion sensor: keyboard controls',
  };
}

export function livenessVerdict(samples, elapsedS, o = LIVENESS) {
  if (samples >= o.minSamples) return 'live';
  return elapsedS >= o.waitS ? 'dead' : 'wait';
}

export function routeAfterLiveness(verdict, { introDone, touch }) {
  if (verdict === 'live') return { mode: 'tilt', next: introDone ? 'home' : 'calib' };
  return {
    mode: fallbackSteerMode(touch), next: nextAfterSteering(introDone),
    flash: touch ? 'No tilt readings: touch steering' : 'No tilt readings: keyboard controls',
  };
}

const DESKTOP_KEYS = 'Use the keyboard (W, A, S, D, Space for the handbrake) or the on-screen touch controls instead.';
export function calibFailure(res, failStreak, { touch }) {
  const reason = res ? res.reason : 'nodata';
  const streak = reason === 'nodata' || !touch ? failStreak + 1 : 0;
  if (streak >= CALIB_FALLBACK_AFTER) {
    let message;
    if (touch) message = 'Still no motion readings, so tilt steering will not work here. Steer by touch instead.';
    else if (reason === 'nodata') message = `Still no motion readings, so tilt steering will not work in this browser. ${DESKTOP_KEYS}`;
    else message = `Tilt steering needs a phone or tablet held up in front of you. ${DESKTOP_KEYS}`;
    return { streak, message, fallbacks: steerFallbacks(touch) };
  }
  if (reason === 'flat') return { streak, message: 'The phone is too flat. Raise it toward upright, then tap Set centre again.', fallbacks: null };
  if (reason === 'moving') return { streak, message: 'Too much movement. Hold still, then tap Set centre again.', fallbacks: null };
  return { streak, message: 'No sensor readings came in. Tap Set centre to try once more.', fallbacks: null };
}

function toggle(node, cls, on) { if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on); }
function setText(node, v) { if (node.__v !== v) { node.__v = v; node.textContent = v; } }

export function createOnboardingUi(doc, handlers) {
  const $ = (id) => doc.getElementById(id);
  const el = {
    calibTitle: $('calib-title'), calibText: $('calib-text'), calibMeter: $('calib-meter'),
    calibBtn: $('calib-btn'), calibKeep: $('calib-keep'),
    calibFallback: $('calib-fallback'), useKeys: $('calib-use-keys'), useTouch: $('calib-use-touch'),
    calibProgress: $('calib-progress'), calibFill: $('calib-fill'), levelBubble: $('level-bubble'), levelValue: $('level-value'),
    testpadPrompt: $('testpad-prompt'), testpadReady: $('testpad-ready-btn'),
  };
  const fallbackBtn = { keyboard: el.useKeys, touchsteer: el.useTouch };
  el.testpadReady.addEventListener('click', () => { handlers.testpadReady(); el.testpadReady.blur(); });
  for (const mode of Object.keys(fallbackBtn)) {
    fallbackBtn[mode].addEventListener('click', () => { handlers.useFallbackSteer(mode); fallbackBtn[mode].blur(); });
  }

  return {

    calibState(stateName, message, kind, canKeep, fallbacks = null) {
      const noSensor = !!(fallbacks && fallbacks.length);
      el.calibBtn.disabled = stateName !== 'ready';
      el.calibBtn.textContent = stateName === 'capturing' ? 'Keep still...' : (noSensor ? 'Try tilt again' : 'Set centre');
      el.calibBtn.className = noSensor ? 'btn-secondary' : 'btn-primary';
      el.calibKeep.hidden = noSensor || !(canKeep && stateName === 'ready');
      setText(el.calibTitle, noSensor ? 'Tilt steering is not working' : 'Set the centre');
      el.calibMeter.hidden = noSensor;
      setText(el.calibText, message);
      toggle(el.calibText, 'calib-result', !!kind);
      toggle(el.calibText, 'good', kind === 'good');
      toggle(el.calibText, 'bad', kind === 'bad');
      el.calibFallback.hidden = !noSensor;
      for (const mode of Object.keys(fallbackBtn)) {
        const i = noSensor ? fallbacks.findIndex((f) => f.mode === mode) : -1;
        const btn = fallbackBtn[mode];
        btn.hidden = i < 0;
        if (i >= 0) { setText(btn, fallbacks[i].label); btn.className = i === 0 ? 'btn-primary' : 'btn-secondary'; }
      }
    },
    calibView({ level, progress, active }) {
      const c = level > 30 ? 30 : (level < -30 ? -30 : level);
      el.levelBubble.style.transform = `translateX(${((c / 30) * 128).toFixed(1)}px)`;
      toggle(el.levelBubble, 'off', Math.abs(level) > 3);
      setText(el.levelValue, String(Math.round(level)));
      el.calibProgress.hidden = !active;
      el.calibFill.style.transform = `scaleX(${(active ? progress : 0).toFixed(3)})`;
    },
    showPrompt(text, showReady) {
      setText(el.testpadPrompt, text);
      el.testpadReady.hidden = !showReady;
    },
  };
}
