

const WHAT_THIS_IS = Object.freeze([
  ['Modelled', 'Rigid frame, Pacejka-style tyres, load transfer, the electric drivetrain with its rpm and power caps, grade from the track, surfaces, barriers as a non-physical response.'],
  ['F-flex', 'Frame stiffness is not modelled.'],
  ['F-jack', 'Castor jacking is not modelled: the sim will feel lighter at the wheel than the real kart at 40 to 55 deg of countersteer.'],
  ['F-lltd', 'Compliant rear-biased load-transfer split is not modelled.'],
  ['F-cgy', 'Lateral CG offset (+38.9 mm) is not modelled unless flagged otherwise.'],
  ['F-rpm', 'Field weakening and battery sag at the rpm cap are not modelled: lift-off catches the slide within a second; hold the countersteer and it snaps about 14 deg past straight.'],
  ['F-ack', 'Ackermann beyond the parallel default is not modelled.'],
  ['F-brakecut', 'The handbrake drive cut exists as a switch, default off.'],
  ['F-regen', 'Regenerative braking is not modelled.'],
  ['F-tyre', 'Tyre pressure is not modelled.'],
  ['F-strength', 'Structural strength is not modelled.'],
  ['Assist ladder', 'Off: raw, what the model says. Low 0.3: a hint of self-centring, like real castor. Medium 0.6: the front wheels find the slide, you place it (plus an 80 ms throttle ramp). High 0.85: hold the slide with the throttle, the wheel mostly does itself (150 ms ramp). All non-physical, labelled.'],
  ['Provenance', 'WS2 dynamics model, ws9 gearing analysis, the rubber-one-setup synthesis.'],
  ['Andre, on the brief', '"I want it to handle well mid drift so it is easy to hold."'],
]);

function row(doc, label, control, sub) {
  const r = doc.createElement('div'); r.className = 'settings-row';
  const left = doc.createElement('div');
  const b = doc.createElement('b'); b.textContent = label; left.appendChild(b);
  if (sub) { const s = doc.createElement('span'); s.className = 'settings-sub'; s.textContent = sub; left.appendChild(s); }
  r.append(left, control);
  return r;
}
function select(doc, options, current, onChange) {
  const sel = doc.createElement('select');
  for (const o of options) { const opt = doc.createElement('option'); opt.value = o.id; opt.textContent = o.label; if (o.id === current) opt.selected = true; sel.appendChild(opt); }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
function toggleBtn(doc, on, onChange) {
  const b = doc.createElement('button'); b.type = 'button'; b.className = 'switch'; b.setAttribute('aria-pressed', String(on));
  b.addEventListener('click', () => onChange(!on));
  return b;
}
function groupTitle(doc, text) { const h = doc.createElement('div'); h.className = 'settings-group-title'; h.textContent = text; return h; }

export function createSettingsUi(doc, handlers) {
  const $ = (id) => doc.getElementById(id);
  const el = { list: $('settings-list'), back: $('settings-back'), whatThisBody: $('whatthis-body'), whatThisBack: $('whatthis-back'), creditsBack: $('credits-back') };
  el.back.addEventListener('click', () => { handlers.back(); el.back.blur(); });
  el.whatThisBack.addEventListener('click', () => handlers.backToSettings());
  el.creditsBack.addEventListener('click', () => handlers.backToSettings());

  function clearAllFlow() {
    if (!doc.defaultView.confirm('Clear all saved settings, bests, ghosts and replays? This cannot be undone.')) return;
    if (!doc.defaultView.confirm('Really clear everything? There is no undo.')) return;
    handlers.clearAll();
  }

  return {

    render(settings, usageBytes, opts = {}) {
      const tilt = opts.tilt !== false;
      el.list.innerHTML = '';
      el.list.appendChild(groupTitle(doc, 'Driving'));
      el.list.appendChild(row(doc, 'Assist default', select(doc, [{ id: 'off', label: 'Off' }, { id: 'low', label: 'Low' }, { id: 'med', label: 'Med' }, { id: 'high', label: 'High' }],
        settings.assistDefault || 'low', (v) => handlers.change({ assistDefault: v }))));
      el.list.appendChild(row(doc, 'Steering range', select(doc, [20, 24, 28, 32, 36, 40].map((d) => ({ id: String(d), label: `${d} deg` })), String(settings.steeringRangeDeg),
        (v) => handlers.change({ steeringRangeDeg: Number(v) })), '10 deg of tilt is about 20 deg at the road wheel'));
      el.list.appendChild(row(doc, 'Steering smoothing', select(doc, [{ id: '10', label: 'Sharp (10 ms)' }, { id: '20', label: 'Normal (20 ms)' }, { id: '35', label: 'Calm (35 ms)' }],
        String(settings.smoothingMs), (v) => handlers.change({ smoothingMs: Number(v) }))));
      el.list.appendChild(row(doc, 'Haptics', toggleBtn(doc, settings.haptics, (v) => handlers.change({ haptics: v })),
        'ontouchstart' in doc.defaultView ? undefined : 'Not available in iOS browsers'));
      el.list.appendChild(row(doc, 'Camera', select(doc, [{ id: 'chase', label: 'Chase' }, { id: 'helmet', label: 'Helmet' }], settings.camera || 'chase', (v) => handlers.change({ camera: v }))));
      el.list.appendChild(row(doc, 'Audio', toggleBtn(doc, settings.audioOn, (v) => handlers.change({ audioOn: v }))));

      el.list.appendChild(groupTitle(doc, 'Calibration and onboarding'));
      const recal = doc.createElement('button'); recal.type = 'button'; recal.className = 'btn-secondary'; recal.textContent = 'Recalibrate'; recal.addEventListener('click', handlers.recalibrate);
      recal.disabled = !tilt;
      el.list.appendChild(row(doc, 'Tilt centre', recal, tilt ? undefined : 'Tilt steering only. This session steers by keyboard or touch.'));
      const redo = doc.createElement('button'); redo.type = 'button'; redo.className = 'btn-secondary'; redo.textContent = 'Redo the intro'; redo.addEventListener('click', handlers.redoIntro);
      el.list.appendChild(row(doc, 'First-run intro', redo));

      el.list.appendChild(groupTitle(doc, 'Advanced'));
      el.list.appendChild(row(doc, 'Telemetry overlay', toggleBtn(doc, settings.telemetryOverlay, (v) => handlers.change({ telemetryOverlay: v })), 'Fz, slip, front utilisation, rpm'));
      el.list.appendChild(row(doc, 'What if: uncoupled 110 Nm at 3165 rpm', toggleBtn(doc, settings.whatIf, (v) => handlers.change({ whatIf: v })), 'Taints bests and ghosts; this motor does not exist'));

      el.list.appendChild(groupTitle(doc, 'About'));
      const whatThisBtn = doc.createElement('button'); whatThisBtn.type = 'button'; whatThisBtn.className = 'btn-secondary'; whatThisBtn.textContent = 'What this sim is'; whatThisBtn.addEventListener('click', handlers.openWhatThis);
      el.list.appendChild(row(doc, 'Honesty', whatThisBtn));
      const creditsBtn = doc.createElement('button'); creditsBtn.type = 'button'; creditsBtn.className = 'btn-secondary'; creditsBtn.textContent = 'Credits'; creditsBtn.addEventListener('click', handlers.openCredits);
      el.list.appendChild(row(doc, 'Attribution', creditsBtn));
      const usage = doc.createElement('span'); usage.className = 'note'; usage.textContent = `${(usageBytes / 1024).toFixed(1)} kB used`;
      el.list.appendChild(row(doc, 'Storage usage', usage));
      const clear = doc.createElement('button'); clear.type = 'button'; clear.className = 'btn-secondary'; clear.textContent = 'Clear all'; clear.addEventListener('click', clearAllFlow);
      el.list.appendChild(row(doc, 'Clear saved data', clear));
    },

    renderWhatThis() {
      el.whatThisBody.innerHTML = '';
      const h = doc.createElement('h2'); h.textContent = 'What this sim is'; el.whatThisBody.appendChild(h);
      const p = doc.createElement('p'); p.textContent = 'Model, not measurement. Uncalibrated until Andre\'s corner weights, motor no-load test and skidpad grip test land.'; el.whatThisBody.appendChild(p);
      for (const [label, text] of WHAT_THIS_IS) {
        const row2 = doc.createElement('p');
        const b = doc.createElement('b'); b.textContent = `${label}: `;
        row2.appendChild(b);
        row2.appendChild(doc.createTextNode(text));
        el.whatThisBody.appendChild(row2);
      }
    },
  };
}
