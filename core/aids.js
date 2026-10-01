

export function assistTarget(deltaCmd, k, vx, vy, r, a, V, lo, hi, lockRad) {
  if (!(k > 0) || vx <= 0) return deltaCmd;
  let fade = (V - lo) / (hi - lo);
  if (fade <= 0) return deltaCmd;
  if (fade > 1) fade = 1;
  const d0 = Math.atan2(vy + r * a, vx);
  let t = deltaCmd + k * fade * (d0 - deltaCmd);
  if (t > lockRad) t = lockRad; else if (t < -lockRad) t = -lockRad;
  return t;
}

export function rateLimit(current, target, rate, dt) {
  if (!(rate < Infinity)) return target;
  const step = rate * dt;
  const e = target - current;
  return current + (e > step ? step : (e < -step ? -step : e));
}
