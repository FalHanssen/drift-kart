

export const LIVE_RUN_STATES = Object.freeze(['drive', 'testpad']);

export function isLiveRun(state) {
  return LIVE_RUN_STATES.includes(state);
}

export function hudShownIn(state) {
  return isLiveRun(state) || state === 'pause';
}

export function zonesLive(state, rotateUp = false) {
  return !rotateUp && isLiveRun(state);
}

export function createZoneSync({ input, zoneRects, getState, getRotateUp = () => false, schedule = (fn) => fn(), onChange = () => {} }) {
  function refresh() {
    if (!zonesLive(getState(), getRotateUp())) return;
    input.setTouchZones(zoneRects());
    onChange();
  }
  function clear() {
    input.setTouchZones(null);
    input.clearHeld();
    onChange();
  }
  return {
    refresh,
    clear,
    enter(next) {
      if (zonesLive(next)) schedule(refresh);
      else clear();
    },
  };
}
