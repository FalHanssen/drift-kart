

export const KART_EULER_ORDER = 'ZYX';

const TWO_PI = 2 * Math.PI;

export function surfacePose(track, x, y, psi, out = {}) {
  const q = track.query(x, y);
  const nx = q.normal[0], ny = q.normal[1], nz = q.normal[2];
  const c = Math.cos(psi), s = Math.sin(psi);
  const gh = -(nx * c + ny * s) / nz;
  const gl = -(-nx * s + ny * c) / nz;
  out.x = x; out.y = y; out.z = q.z; out.psi = psi;
  out.pitch = Math.atan(gh);
  out.roll = Math.atan(gl);
  out.ry = -out.pitch;
  out.rx = Math.atan(gl / Math.sqrt(1 + gh * gh));
  return out;
}

export function drawnPose(track, p0, p1, alpha, out = {}) {
  const x = p0.x + (p1.x - p0.x) * alpha;
  const y = p0.y + (p1.y - p0.y) * alpha;
  let d = p1.psi - p0.psi;
  d -= TWO_PI * Math.round(d / TWO_PI);
  return surfacePose(track, x, y, p0.psi + d * alpha, out);
}

export function bodyToWorld(pose, bx, by, bz, out = [0, 0, 0]) {
  const cx = Math.cos(pose.rx), sx = Math.sin(pose.rx);
  const cy = Math.cos(pose.ry), sy = Math.sin(pose.ry);
  const cz = Math.cos(pose.psi), sz = Math.sin(pose.psi);
  const y1 = by * cx - bz * sx, z1 = by * sx + bz * cx;
  const x2 = bx * cy + z1 * sy, z2 = -bx * sy + z1 * cy;
  out[0] = pose.x + x2 * cz - y1 * sz;
  out[1] = pose.y + x2 * sz + y1 * cz;
  out[2] = pose.z + z2;
  return out;
}
