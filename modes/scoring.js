

export const SCORE = Object.freeze({
  onDeg: 10, lineLoDeg: 40, lineHiDeg: 70, lineTopDeg: 100,
  speedRefKmh: 30, speedMin: 0.2, speedMax: 1.2,
  holdCapS: 3,
  lineMult: 1.5,
  commitBelowDeg: 8, commitHoldS: 0.5,
  transitionDeg: 20, transitionWindowS: 1.2, transitionBonus: 150, transitionCooldownS: 3,
  spinBetaDeg: 100, spinYawDeg: 150, spinYawWindowS: 1.5,
  offTrackSpinS: 1.5,
  offTrackInvalidS: 1.0,
  barrierImpulseNs: 400,
  rateBase: 10,
});

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

export function angleTerm(angleDeg, o = SCORE) {
  const a = angleDeg < 0 ? -angleDeg : angleDeg;
  if (a < o.onDeg) return 0;
  if (a <= o.lineLoDeg) return (a - o.onDeg) / (o.lineLoDeg - o.onDeg);
  if (a <= o.lineHiDeg) return 1;
  if (a <= o.lineTopDeg) return 1 - (a - o.lineHiDeg) / (o.lineTopDeg - o.lineHiDeg);
  return 0;
}

export function speedTerm(speedKmh, o = SCORE) {
  return clamp(speedKmh / o.speedRefKmh, o.speedMin, o.speedMax);
}

export function holdTerm(tHoldS, o = SCORE) {
  return 1 + Math.min(tHoldS, o.holdCapS) / o.holdCapS;
}

export function gradeFor(score, targetT) {
  if (!(targetT > 0)) return 'D';
  const f = score / targetT;
  if (f >= 1) return 'S';
  if (f >= 0.8) return 'A';
  if (f >= 0.6) return 'B';
  if (f >= 0.4) return 'C';
  return 'D';
}

export function createDriftScorer(o = SCORE) {
  const st = {
    segment: 0, total: 0, tHold: 0,
    belowCommitS: 0,
    yawWin: null, yawN: 0, yawI: 0, headingU: 0, prevHeadingDeg: NaN,
    offStreakS: 0,
    pending: null,
    lastBonusT: -Infinity,
    t: 0,
    spinning: false,
  };

  function loseSegment() { st.segment = 0; st.tHold = 0; st.belowCommitS = 0; st.pending = null; }
  function commitSegment() { st.total += st.segment; st.segment = 0; st.tHold = 0; st.belowCommitS = 0; }

  function tick(reading, dt) {
    const { angleDeg, betaDeg, speedKmh, wheelsOk, inClipZone, headingDeg, barrierImpulseNs = 0 } = reading;
    st.t += dt;
    const ev = { committed: false, spin: false, barrierLoss: false, transitionBonus: false };

    if (st.yawWin === null) {
      const n = Math.max(1, Math.round(o.spinYawWindowS / dt));
      st.yawWin = new Float64Array(n);
    }
    if (st.prevHeadingDeg === st.prevHeadingDeg) {
      let d = headingDeg - st.prevHeadingDeg;
      d -= 360 * Math.round(d / 360);
      st.headingU += d;
    }
    st.prevHeadingDeg = headingDeg;
    const win = st.yawWin;
    const full = st.yawN >= win.length;
    const yawRotDeg = full ? Math.abs(st.headingU - win[st.yawI]) : 0;
    win[st.yawI] = st.headingU;
    st.yawI = (st.yawI + 1) % win.length;
    if (st.yawN < win.length) st.yawN++;

    st.offStreakS = wheelsOk <= 1 ? st.offStreakS + dt : 0;

    const spinNow = angleDeg > o.spinBetaDeg || yawRotDeg > o.spinYawDeg || st.offStreakS > o.offTrackSpinS;
    if (spinNow) {
      if (!st.spinning) {
        st.spinning = true;
        ev.spin = true;
        loseSegment();
      }
      return ev;
    }
    st.spinning = false;

    if (barrierImpulseNs > o.barrierImpulseNs) {
      ev.barrierLoss = true;
      loseSegment();
      return ev;
    }

    {

      const onTrackNow = wheelsOk >= 3;
      if (angleDeg >= o.onDeg) st.tHold += dt;
      const A = angleTerm(angleDeg, o);
      const S = speedTerm(speedKmh, o);
      const M_hold = holdTerm(st.tHold, o);
      const M_line = inClipZone ? o.lineMult : 1;
      const M_track = onTrackNow ? 1 : 0;
      st.segment += o.rateBase * A * S * M_hold * M_line * M_track * dt;

      const eps = 1e-6;
      const sgn = betaDeg > eps ? 1 : (betaDeg < -eps ? -1 : 0);
      let p = st.pending;
      if (p && (st.t - p.anchorT > o.transitionWindowS || !onTrackNow)) p = st.pending = null;
      if (!p) {
        if (sgn !== 0 && angleDeg >= o.transitionDeg) st.pending = { anchorT: st.t, sign: sgn, flipped: false, flipSign: 0 };
      } else if (!p.flipped) {
        if (sgn !== 0 && sgn !== p.sign) { p.flipped = true; p.flipSign = sgn; }
      } else if (sgn === p.flipSign && angleDeg >= o.transitionDeg) {
        if (st.t - st.lastBonusT >= o.transitionCooldownS) {
          st.segment += o.transitionBonus;
          st.lastBonusT = st.t;
          ev.transitionBonus = true;
        }
        st.pending = null;
      } else if (sgn !== 0 && sgn !== p.flipSign) {
        st.pending = angleDeg >= o.transitionDeg ? { anchorT: st.t, sign: sgn, flipped: false, flipSign: 0 } : null;
      }

      if (angleDeg < o.commitBelowDeg) {
        st.belowCommitS += dt;
        if (st.belowCommitS >= o.commitHoldS && st.segment > 0) {
          commitSegment();
          ev.committed = true;
        }
      } else {
        st.belowCommitS = 0;
      }
    }
    return ev;
  }

  function finish() {
    if (st.segment > 0) { commitSegment(); return true; }
    return false;
  }

  return {
    tick, finish,
    get segment() { return st.segment; },
    get total() { return st.total; },
    get tHold() { return st.tHold; },
    get spinning() { return st.spinning; },
    grade(targetT) { return gradeFor(st.total, targetT); },
  };
}

export function createTimer(o = SCORE) {
  const st = { ticks: 0, finishedAtS: null, offStreakS: 0, invalid: false };

  function tick(frac, wheelsOk, dt) {
    const ev = { finished: false, invalidated: false };
    if (st.finishedAtS === null) {
      st.offStreakS = wheelsOk <= 1 ? st.offStreakS + dt : 0;
      if (!st.invalid && st.offStreakS > o.offTrackInvalidS) { st.invalid = true; ev.invalidated = true; }
      if (frac !== null && frac !== undefined) {
        st.finishedAtS = (st.ticks + frac) * dt;
        ev.finished = true;
      }
    }
    st.ticks++;
    return ev;
  }

  return {
    tick,
    get ticks() { return st.ticks; },
    get finished() { return st.finishedAtS !== null; },
    get finishTimeS() { return st.finishedAtS; },
    get invalid() { return st.invalid; },
  };
}
