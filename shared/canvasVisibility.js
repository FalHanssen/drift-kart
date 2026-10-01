

import { hudShownIn } from './runState.js';

export function canvasForState(state) {
  if (hudShownIn(state)) return 'view';
  if (state === 'garage') return 'garage-view';
  return null;
}

export function applyCanvasVisibility(state, els, viewHandle, garageHandle = null) {
  const want = canvasForState(state);
  els.view.hidden = want !== 'view';
  els.garage.hidden = want !== 'garage-view';
  if (want === 'view' && viewHandle) viewHandle.resize(els.view.clientWidth, els.view.clientHeight);
  if (want === 'garage-view' && garageHandle) garageHandle.resize(els.garage.clientWidth, els.garage.clientHeight);
  return want;
}
