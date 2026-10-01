

export function buildSegmentGrid(ax, ay, bx, by, count, { cell = 15, reach = 0, pad = 0 } = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, ax[i], bx[i]); maxX = Math.max(maxX, ax[i], bx[i]);
    minY = Math.min(minY, ay[i], by[i]); maxY = Math.max(maxY, ay[i], by[i]);
  }
  if (count === 0) { minX = minY = 0; maxX = maxY = 1; }
  const grow = reach + pad;
  minX -= grow; minY -= grow; maxX += grow; maxY += grow;
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell));
  const counts = new Int32Array(nx * ny);
  const range = (i) => {
    const x0 = Math.min(ax[i], bx[i]) - reach, x1 = Math.max(ax[i], bx[i]) + reach;
    const y0 = Math.min(ay[i], by[i]) - reach, y1 = Math.max(ay[i], by[i]) + reach;
    return [
      Math.max(0, Math.floor((x0 - minX) / cell)), Math.min(nx - 1, Math.floor((x1 - minX) / cell)),
      Math.max(0, Math.floor((y0 - minY) / cell)), Math.min(ny - 1, Math.floor((y1 - minY) / cell)),
    ];
  };
  for (let i = 0; i < count; i++) {
    const [cx0, cx1, cy0, cy1] = range(i);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) counts[cy * nx + cx]++;
  }
  const start = new Int32Array(nx * ny + 1);
  for (let c = 0; c < nx * ny; c++) start[c + 1] = start[c] + counts[c];
  const items = new Int32Array(start[nx * ny]);
  const fill = start.slice(0, nx * ny);
  for (let i = 0; i < count; i++) {
    const [cx0, cx1, cy0, cy1] = range(i);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) items[fill[cy * nx + cx]++] = i;
  }
  let maxPer = 0;
  for (let c = 0; c < nx * ny; c++) maxPer = Math.max(maxPer, counts[c]);
  return { minX, minY, maxX, maxY, cell, nx, ny, start, items, reach, maxPerCell: maxPer };
}

export function gridCell(g, x, y) {
  const cx = Math.floor((x - g.minX) / g.cell);
  const cy = Math.floor((y - g.minY) / g.cell);
  if (cx < 0 || cy < 0 || cx >= g.nx || cy >= g.ny) return -1;
  return cy * g.nx + cx;
}
