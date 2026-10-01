

const PEAK_SLIP = 0.12;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function makeNoiseBuffer(ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function loopedSource(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start();
  return src;
}

export function createAudioEngine(env = globalThis) {
  let ctx = null;
  let graph = null;
  let unlocked = false;
  let masterGain = null;

  function AudioContextCtor() {
    return env.AudioContext || env.webkitAudioContext || null;
  }

  function buildGraph() {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12; compressor.ratio.value = 4;
    masterGain = ctx.createGain();
    masterGain.gain.value = Math.pow(10, -6 / 20);
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    const noiseBuf = makeNoiseBuffer(ctx);

    const whineGain = ctx.createGain(); whineGain.gain.value = 0;
    const whineLp = ctx.createBiquadFilter(); whineLp.type = 'lowpass'; whineLp.frequency.value = 4000;
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 100; saw.start();
    const sine2 = ctx.createOscillator(); sine2.type = 'sine'; sine2.frequency.value = 200; sine2.start();
    saw.connect(whineLp); sine2.connect(whineLp); whineLp.connect(whineGain); whineGain.connect(compressor);

    const humGain = ctx.createGain(); humGain.gain.value = 0;
    const humLp = ctx.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 6000;
    const square = ctx.createOscillator(); square.type = 'square'; square.frequency.value = 8000; square.start();
    square.connect(humLp); humLp.connect(humGain); humGain.connect(compressor);

    const scrubGain = ctx.createGain(); scrubGain.gain.value = 0;
    const scrubBp = ctx.createBiquadFilter(); scrubBp.type = 'bandpass'; scrubBp.frequency.value = 600; scrubBp.Q.value = 1.2;
    const scrubSrc = loopedSource(ctx, noiseBuf);
    scrubSrc.connect(scrubBp); scrubBp.connect(scrubGain); scrubGain.connect(compressor);

    const kerbGain = ctx.createGain(); kerbGain.gain.value = 0;
    const kerbLfo = ctx.createOscillator(); kerbLfo.frequency.value = 40; kerbLfo.start();
    const kerbLfoGain = ctx.createGain(); kerbLfoGain.gain.value = 0.5;
    kerbLfo.connect(kerbLfoGain); kerbLfoGain.connect(kerbGain.gain);
    const kerbSrc = loopedSource(ctx, noiseBuf);
    const kerbBp = ctx.createBiquadFilter(); kerbBp.type = 'bandpass'; kerbBp.frequency.value = 700; kerbBp.Q.value = 1.0;
    kerbSrc.connect(kerbBp); kerbBp.connect(kerbGain); kerbGain.connect(compressor);
    const thump = ctx.createOscillator(); thump.type = 'sine'; thump.frequency.value = 90; thump.start();
    const thumpGain = ctx.createGain(); thumpGain.gain.value = 0;
    thump.connect(thumpGain); thumpGain.connect(compressor);

    const gravelGain = ctx.createGain(); gravelGain.gain.value = 0;
    const gravelLp = ctx.createBiquadFilter(); gravelLp.type = 'lowpass'; gravelLp.frequency.value = 500;
    const gravelSrc = loopedSource(ctx, noiseBuf);
    const gravelLfo = ctx.createOscillator(); gravelLfo.type = 'square'; gravelLfo.frequency.value = 12; gravelLfo.start();
    const gravelLfoGain = ctx.createGain(); gravelLfoGain.gain.value = 0.5;
    gravelLfo.connect(gravelLfoGain); gravelLfoGain.connect(gravelGain.gain);
    gravelSrc.connect(gravelLp); gravelLp.connect(gravelGain); gravelGain.connect(compressor);

    const grassGain = ctx.createGain(); grassGain.gain.value = 0;
    const grassLp = ctx.createBiquadFilter(); grassLp.type = 'lowpass'; grassLp.frequency.value = 300;
    const grassSrc = loopedSource(ctx, noiseBuf);
    grassSrc.connect(grassLp); grassLp.connect(grassGain); grassGain.connect(compressor);

    const windGain = ctx.createGain(); windGain.gain.value = 0;
    const windLp = ctx.createBiquadFilter(); windLp.type = 'lowpass'; windLp.frequency.value = 200;
    const windSrc = loopedSource(ctx, noiseBuf);
    windSrc.connect(windLp); windLp.connect(windGain); windGain.connect(compressor);

    return {
      compressor, saw, sine2, whineGain, whineLp,
      square, humGain,
      scrubBp, scrubGain,
      kerbGain, kerbBp, thumpGain,
      gravelGain, gravelLp,
      grassGain,
      windGain, windLp,
    };
  }

  function unlock() {
    const Ctor = AudioContextCtor();
    if (!Ctor) { unlocked = false; return 'unavailable'; }
    try {
      if (!ctx) { ctx = new Ctor(); graph = buildGraph(); }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      unlocked = true;
      return 'ok';
    } catch { unlocked = false; return 'unavailable'; }
  }

  function setMasterVolume(on) {
    if (!masterGain) return;
    masterGain.gain.value = on ? Math.pow(10, -6 / 20) : 0;
  }

  function update(snap) {
    if (!ctx || !graph || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const rpm = snap.drivetrain ? snap.drivetrain.rpm : 0;
    const f1 = clamp((Math.abs(rpm) / 60) * 8, 20, 2000);
    graph.saw.frequency.setTargetAtTime(f1, t, 0.03);
    graph.sine2.frequency.setTargetAtTime(f1 * 2, t, 0.03);
    const torqueFrac = snap.drivetrain && snap.drivetrain.availableOut > 0 ? clamp(snap.drivetrain.torqueAxle / (snap.drivetrain.availableOut * 3), 0, 1) : 0;
    graph.whineGain.gain.setTargetAtTime(0.05 + 0.22 * torqueFrac, t, 0.05);
    graph.humGain.gain.setTargetAtTime((snap.input ? snap.input.throttle : 0) * 0.15, t, 0.05);

    const rearSlip = snap.wheels && snap.wheels.length === 4 ? Math.max(snap.wheels[2].s, snap.wheels[3].s) : 0;
    const past = clamp((Math.abs(rearSlip) - PEAK_SLIP) / (PEAK_SLIP * 3), 0, 1);
    graph.scrubBp.frequency.setTargetAtTime(600 + 1400 * past, t, 0.04);
    graph.scrubGain.gain.setTargetAtTime(0.35 * past, t, 0.04);

    const surfaces = (snap.wheels || []).map((w) => w.surface);
    const onKerb = surfaces.includes('kerb'), onGravel = surfaces.includes('gravel'), onGrass = surfaces.includes('grass');
    const speedKmh = snap.speed * 3.6;
    graph.kerbGain.gain.setTargetAtTime(onKerb ? 0.3 : 0, t, 0.03);
    graph.thumpGain.gain.setTargetAtTime(onKerb ? 0.18 : 0, t, 0.03);
    graph.gravelGain.gain.setTargetAtTime(onGravel ? clamp(speedKmh / 40, 0, 1) * 0.4 : 0, t, 0.03);
    graph.grassGain.gain.setTargetAtTime(onGrass ? clamp(speedKmh / 40, 0, 1) * 0.4 * 0.4 : 0, t, 0.03);

    graph.windLp.frequency.setTargetAtTime(200 + 40 * speedKmh, t, 0.08);
    graph.windGain.gain.setTargetAtTime(Math.pow(clamp(speedKmh / 40, 0, 2), 2) * 0.12, t, 0.08);
  }

  function blip(freq, ms, gainPeak = 0.3) {
    if (!ctx || !graph) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainPeak, t + 0.005);
    g.gain.linearRampToValueAtTime(0, t + ms / 1000);
    o.connect(g); g.connect(graph.compressor);
    o.start(t); o.stop(t + ms / 1000 + 0.02);
  }

  const EVENTS = Object.freeze({
    select: () => blip(880, 40),
    back: () => blip(660, 60),
    sectorLine: () => { blip(880, 70); setTimeout(() => blip(1175, 90), 70); },
    spin: () => { blip(440, 90); setTimeout(() => blip(330, 140), 90); },
  });

  function event(name) {
    const fn = EVENTS[name];
    if (fn) fn();
  }

  return {
    unlock, update, event, setMasterVolume,
    get unlocked() { return unlocked; },
    get context() { return ctx; },
  };
}
