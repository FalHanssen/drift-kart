

export const TURNTABLE = Object.freeze({
  autoSpinRevPerS: 0.05,
  radPerPx: 0.01,
  zoomPerPinchPx: 0.01,
  zoomPerWheelPx: 0.002,
  wheelLinePx: 33,
  steerTauS: 0.12,
});

const D2R = Math.PI / 180;

export function createTurntableGestures(o = TURNTABLE) {
  const pts = new Map();
  let lastSpread = 0;
  const none = () => ({ turn: 0, zoom: 0 });
  function spread() {
    const [p, q] = pts.values();
    return Math.hypot(p.x - q.x, p.y - q.y);
  }
  return {
    down(id, x, y) {
      pts.set(id, { x, y });
      if (pts.size === 2) lastSpread = spread();
    },

    move(id, x, y) {
      const p = pts.get(id);
      if (!p) return none();
      const dx = x - p.x;
      p.x = x; p.y = y;
      if (pts.size === 1) return { turn: -dx * o.radPerPx, zoom: 0 };
      if (pts.size === 2) {
        const s = spread();
        const zoom = -(s - lastSpread) * o.zoomPerPinchPx;
        lastSpread = s;
        return { turn: 0, zoom };
      }
      return none();
    },
    up(id) {
      pts.delete(id);
      if (pts.size === 2) lastSpread = spread();
    },
    reset() { pts.clear(); lastSpread = 0; },
    get dragging() { return pts.size > 0; },
  };
}

export function wheelZoom(deltaY, deltaMode = 0, o = TURNTABLE) {
  const px = deltaMode === 1 ? deltaY * o.wheelLinePx : deltaY;
  return Number.isFinite(px) ? px * o.zoomPerWheelPx : 0;
}

export function easeSteer(current, target, dt, tauS = TURNTABLE.steerTauS) {
  if (!(dt > 0)) return current;
  return current + (1 - Math.exp(-dt / tauS)) * (target - current);
}

export function createTurntable(canvas, view, o = TURNTABLE) {
  const g = createTurntableGestures(o);
  let active = false;
  let steer = 0;
  let steerTarget = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    g.down(e.pointerId, e.clientX, e.clientY);
    try { canvas.setPointerCapture(e.pointerId); } catch {   }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active) return;
    const d = g.move(e.pointerId, e.clientX, e.clientY);
    if (d.turn) view.drag(d.turn);
    if (d.zoom) view.zoom(d.zoom);
  });
  const end = (e) => g.up(e.pointerId);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('wheel', (e) => { if (active) view.zoom(wheelZoom(e.deltaY, e.deltaMode, o)); }, { passive: true });

  return {

    enter() { active = true; },

    leave() { active = false; g.reset(); },

    frame(dt) {
      if (!active) return;
      steer = easeSteer(steer, steerTarget, dt, o.steerTauS);
      view.setSteerAngle(steer);
      view.tick(dt, g.dragging ? 0 : o.autoSpinRevPerS);
      view.render();
    },
    resize(w, h) { view.resize(w, h); },

    showLock(lockDeg) { steerTarget = lockDeg ? lockDeg * D2R : 0; },
    get active() { return active; },
    get dragging() { return g.dragging; },
  };
}
