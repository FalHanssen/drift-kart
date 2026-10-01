

const MAX_Z = '2147483647';
let overlay = null;
let pre = null;
let copyBtn = null;
let shown = false;

function styleAll(el, props) {
  for (const key in props) el.style[key] = props[key];
}

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  styleAll(overlay, {
    position: 'fixed', left: '0', right: '0', top: '0', maxHeight: '70%',
    overflow: 'auto', zIndex: MAX_Z, background: 'rgba(32, 4, 4, 0.96)',
    color: '#fff', fontFamily: 'ui-monospace, monospace', fontSize: '12px', lineHeight: '1.4',
    padding: '10px 12px', boxSizing: 'border-box',
  });
  const heading = document.createElement('div');
  heading.textContent = 'Diagnostic report (something failed)';
  styleAll(heading, { fontWeight: 'bold', fontSize: '13px', marginBottom: '6px' });
  pre = document.createElement('pre');
  styleAll(pre, { margin: '0 0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 'inherit' });
  copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy';
  styleAll(copyBtn, {
    fontFamily: 'inherit', fontSize: '13px', fontWeight: 'bold', padding: '6px 16px',
    borderRadius: '8px', border: '1px solid #fff', background: '#fff', color: '#200',
  });
  copyBtn.addEventListener('click', () => {
    const text = pre.textContent;
    const settle = (label) => { copyBtn.textContent = label; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => settle('Copied'), () => settle('Copy failed'));
    } else {
      settle('Copy unavailable');
    }
  });
  overlay.appendChild(heading);
  overlay.appendChild(pre);
  overlay.appendChild(copyBtn);
  document.body.appendChild(overlay);
}

function append(line) {
  ensureOverlay();
  pre.textContent = shown ? `${pre.textContent}\n---\n${line}` : line;
  shown = true;
}

function stackLocation(err) {
  const stack = err && err.stack;
  if (!stack || typeof stack !== 'string') return '';
  const m = stack.match(/([^\s(]+:\d+:\d+)/);
  return m ? m[1] : '';
}

function report(label, message, location) {
  const where = location ? ` (${location})` : '';
  append(`${label}: ${message}${where}\nUA: ${navigator.userAgent}`);
}

window.addEventListener('error', (e) => {
  const where = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : stackLocation(e.error);
  report('Script error', e.message || (e.error && e.error.message) || 'Unknown error', where);
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  report('Unhandled rejection', message, stackLocation(reason));
});

const viewCanvas = document.getElementById('view');
if (viewCanvas) {
  viewCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    report('WebGL context lost', "the 3D view's drawing context was lost", '');
  });
}

export function reportFailure(label, err) {
  const message = err instanceof Error ? err.message : String(err);
  report(label, message, stackLocation(err));
}
