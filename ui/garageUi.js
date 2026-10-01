

function provenanceChip(doc, label) {
  const span = doc.createElement('span');
  span.className = 'provenance';
  span.textContent = label;
  return span;
}

function fmt(n, d = 1) { return Number.isFinite(n) ? n.toFixed(d) : '-'; }

export function createGarageUi(doc, handlers) {
  const $ = (id) => doc.getElementById(id);
  const el = { items: $('garage-items'), readouts: $('garage-readouts'), back: $('garage-back') };
  el.back.addEventListener('click', () => { handlers.back(); el.back.blur(); });

  function stepper(doc2, value, onChange, { min, max, step = 1, suffix = '' } = {}) {
    const wrap = doc2.createElement('div');
    wrap.className = 'row2';
    const minus = doc2.createElement('button'); minus.type = 'button'; minus.className = 'step-btn'; minus.textContent = '-';
    const val = doc2.createElement('span'); val.className = 'step-val'; val.textContent = `${value}${suffix}`;
    const plus = doc2.createElement('button'); plus.type = 'button'; plus.className = 'step-btn'; plus.textContent = '+';
    minus.addEventListener('click', () => onChange(Math.max(min, value - step)));
    plus.addEventListener('click', () => onChange(Math.min(max, value + step)));
    wrap.append(minus, val, plus);
    return wrap;
  }

  function select(doc2, options, currentId, onChange) {
    const sel = doc2.createElement('select');
    for (const o of options) {
      const opt = doc2.createElement('option');
      opt.value = o.id; opt.textContent = o.label;
      if (o.id === currentId) opt.selected = true;
      if (o.disabled) opt.disabled = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function itemBox(doc2, title, provenance, effectText) {
    const box = doc2.createElement('div');
    box.className = 'garage-item';
    const head = doc2.createElement('div'); head.className = 'garage-item-head';
    const b = doc2.createElement('b'); b.textContent = title;
    head.append(b, provenanceChip(doc2, provenance));
    box.appendChild(head);
    const p = doc2.createElement('p'); p.textContent = effectText; box.appendChild(p);
    return box;
  }

  const CONTEXT_TEXT = {
    circuit: 'For Time Trial and Free Run on the circuits; Drift Trial and the test pad keep their own setup.',
    drift: 'For Drift Trial and the test pad; Time Trial and Free Run on the circuits keep their own setup.',
  };

  return {

    render(readouts, garage, garageModel, view = {}) {

      el.items.innerHTML = '';
      const contextText = CONTEXT_TEXT[view.context] ? ` ${CONTEXT_TEXT[view.context]}` : '';
      const setupBox = itemBox(doc, 'Setup', 'Builder spec', `${readouts.preset}.${contextText} Picking a setup resets the sprocket and controller mode to that setup's defaults.`);
      const setupSel = select(doc, garageModel.presetOptions(), garage.preset, (id) => handlers.setup(id));
      setupBox.appendChild(setupSel);
      el.items.appendChild(setupBox);

      const range = garageModel.sprocketRange();
      const sprocketBox = itemBox(doc, 'Rear sprocket', 'Derived',
        `${readouts.achievedExact ? '' : 'Indicative only (setup differs from the measured table). '}Bigger sprocket: breaks loose easier, drifts tighter, tops out lower.`);
      sprocketBox.appendChild(stepper(doc, garage.rearSprocket, (v) => handlers.change({ rearSprocket: garageModel.clampSprocket(v, 'rear') }), { min: range.rear[0], max: range.rear[1] }));
      el.items.appendChild(sprocketBox);

      const modes = garageModel.controllerModeOptions();
      const modeBox = itemBox(doc, 'Controller mode', 'Assumed', 'HIGH: harder launch, more break-loose margin, no more drift speed (rpm-bound).');
      modeBox.appendChild(select(doc, modes.filter((m) => m.offered || m.id === garage.controllerMode).map((m) => ({ id: m.id, label: m.id, disabled: !m.offered })), garage.controllerMode, (v) => handlers.change({ controllerMode: v })));
      const low = modes.find((m) => m.id === 'LOW');
      if (low) { const reason = doc.createElement('div'); reason.className = 'reason'; reason.textContent = `LOW not offered: ${low.reasonIfNotOffered}`; modeBox.appendChild(reason); }
      el.items.appendChild(modeBox);

      const kvBox = itemBox(doc, 'Motor rpm and torque pairing', 'Unknown, central estimate', 'The one big unknown. Higher rpm: faster drift ceiling, softer launch.');
      kvBox.appendChild(select(doc, garageModel.KV_OPTIONS.map((k) => ({ id: String(k.rpmCap), label: `${k.label} (${k.rpmCap} rpm)` })), String(garage.rpmCap), (v) => handlers.change({ rpmCap: Number(v) })));
      el.items.appendChild(kvBox);

      const lockBox = itemBox(doc, 'Steering lock', 'Derived from WS3', 'Lock sets the drift angle you can hold.');
      const lockSel = select(doc, garageModel.LOCK_OPTIONS.map((l) => ({ id: String(l.lockDeg), label: l.label })), String(garage.lockDeg), (v) => handlers.change({ lockDeg: Number(v) }));
      if (handlers.lockFocus) {
        lockSel.addEventListener('focus', () => handlers.lockFocus(true));
        lockSel.addEventListener('blur', () => handlers.lockFocus(false));
      }
      lockBox.appendChild(lockSel);
      el.items.appendChild(lockBox);

      const muBox = itemBox(doc, 'Rear tyre grip', 'Assumed', 'Grippier: harder to break loose, faster once sliding, snappier catch.');
      muBox.appendChild(select(doc, garageModel.MU_OPTIONS.map((m) => ({ id: String(m.muPeak), label: `${m.label} (${m.muPeak})` })), String(garage.muPeak), (v) => {
        const picked = garageModel.MU_OPTIONS.find((m) => String(m.muPeak) === v);
        handlers.change({ muPeak: picked.muPeak, muSlide: picked.muSlide });
      }));
      el.items.appendChild(muBox);

      const massBox = itemBox(doc, 'Driver mass', 'Builder spec', `${readouts.driverMassKg} kg (measured).`);
      massBox.appendChild(stepper(doc, garage.driverMassKg, (v) => handlers.change({ driverMassKg: v }), { min: 60, max: 100, suffix: ' kg' }));
      el.items.appendChild(massBox);

      const hbBox = itemBox(doc, 'Handbrake cuts drive', 'Derived', 'The real kart cuts the motor while the handbrake is pulled. Off is what v1 models by default.');
      const sw = doc.createElement('button'); sw.type = 'button'; sw.className = 'switch'; sw.setAttribute('aria-pressed', String(garage.handbrakeCutsDrive));
      sw.addEventListener('click', () => handlers.change({ handbrakeCutsDrive: !garage.handbrakeCutsDrive }));
      hbBox.appendChild(sw);
      el.items.appendChild(hbBox);

      el.readouts.innerHTML = '';
      const rows = [
        ['Top speed', `${fmt(readouts.achievedTopKmh)} km/h`],
        ['Limiter', readouts.limiter || '-'],
        ['0 to 30 km/h', readouts.t0to30s ? `${fmt(readouts.t0to30s)} s` : '-'],
        ['Mass', `${fmt(readouts.massKg)} kg`],
        ['Front load', `${fmt(readouts.frontPct)} %`],
        ['Setup hash', readouts.hash],
      ];
      for (const [label, value] of rows) {
        const row = doc.createElement('div'); row.className = 'ro-row';
        const l = doc.createElement('span'); l.textContent = label;
        const v = doc.createElement('span'); v.textContent = value;
        if (!readouts.achievedExact && (label === 'Top speed' || label === 'Limiter' || label === '0 to 30 km/h')) v.className = 'ro-indicative';
        row.append(l, v);
        el.readouts.appendChild(row);
      }
      if (!readouts.achievedExact) { const note = doc.createElement('div'); note.className = 'ro-indicative'; note.style.marginTop = '6px'; note.textContent = 'Indicative only: this setup differs from the table\'s measured conditions.'; el.readouts.appendChild(note); }
    },
  };
}
