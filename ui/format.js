

export function formatClock(totalSeconds) {
  if (!(totalSeconds >= 0)) return '0:00.00';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function formatDelta(deltaSeconds) {
  if (deltaSeconds === null || deltaSeconds === undefined || !Number.isFinite(deltaSeconds)) return '';
  const sign = deltaSeconds > 0 ? '+' : (deltaSeconds < 0 ? '-' : '+');
  return `${sign}${Math.abs(deltaSeconds).toFixed(2)}`;
}

export function formatKmh(speedMs) {
  return String(Math.round(speedMs * 3.6));
}

export function formatDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function formatTime24(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function assistLabel(level) {
  return { off: 'Off', low: 'Low', med: 'Med', high: 'High', mixed: 'Mixed' }[level] || 'Low';
}

export function setupLine(summary) {
  return summary ? `${summary.label}, ${Math.round(summary.gearedTopKmh)} km/h` : '';
}
export function setupChipText(summary) {
  return summary ? `${summary.label.replace(/ setup$/i, '')} ${Math.round(summary.gearedTopKmh)} km/h` : '';
}
