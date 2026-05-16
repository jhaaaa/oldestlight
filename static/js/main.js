/* OLDEST LIGHT — main.js */

const GRID_COLS = 72;
const GRID_ROWS = 36;
const NOISE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ·';

let cells = [];          // lightweight metadata for all cells
let hoveredCell = null;
let selectedCell = null;
let mapRect = null;      // bounding rect of the map image

const canvas  = document.getElementById('grid-canvas');
const ctx     = canvas.getContext('2d');
const bubble  = document.getElementById('bubble');
const hint    = document.getElementById('hint');

// ── Mollweide projection ────────────────────────────────────────────────────

function solveTheta(phi) {
  // Newton's method: 2θ + sin(2θ) = π sin(φ)
  let t = phi;
  const target = Math.PI * Math.sin(phi);
  for (let i = 0; i < 12; i++) {
    t -= (2 * t + Math.sin(2 * t) - target) / (2 + 2 * Math.cos(2 * t));
  }
  return t;
}

function galacticToMollweide(glon, glat) {
  // glon 0-360 → -π to π (galactic center = 0 = center of image)
  let lambda = glon * Math.PI / 180;
  if (lambda > Math.PI) lambda -= 2 * Math.PI;
  const phi = glat * Math.PI / 180;
  const theta = solveTheta(phi);
  const x = (2 * Math.SQRT2 / Math.PI) * lambda * Math.cos(theta);
  const y = Math.SQRT2 * Math.sin(theta);
  return { x, y };  // x ∈ [-2√2, 2√2], y ∈ [-√2, √2]
}

function mollweideToScreen(x, y, w, h) {
  // Mollweide extent: x ∈ [-2√2, 2√2], y ∈ [-√2, √2]
  // The healpy map image has some padding — empirically ~5% on each side
  const pad = 0.05;
  const sx = (x / (2 * Math.SQRT2) * (1 - 2*pad) + 0.5 + pad/2) * w;
  const sy = (1 - (y / Math.SQRT2 * (1 - 2*pad) / 2 + 0.5 + pad/2)) * h;
  return { sx, sy };
}

function screenToGalactic(px, py, w, h) {
  const pad = 0.05;
  // Inverse
  const nx = ((px / w) - 0.5 - pad/2) / (1 - 2*pad);  // -0.5 to 0.5
  const ny = (0.5 + pad/2 - (py / h)) / (1 - 2*pad);   // -0.5 to 0.5

  const x = nx * 2 * Math.SQRT2;
  const y = ny * 2 * Math.SQRT2;

  // Check inside ellipse
  if ((x / (2 * Math.SQRT2)) ** 2 + (y / Math.SQRT2) ** 2 > 1) return null;

  const theta = Math.asin(Math.max(-1, Math.min(1, y / Math.SQRT2)));
  const sinPhi = (2 * theta + Math.sin(2 * theta)) / Math.PI;
  const glat = Math.asin(Math.max(-1, Math.min(1, sinPhi))) * 180 / Math.PI;

  const cosTheta = Math.cos(theta);
  if (Math.abs(cosTheta) < 1e-9) return { glon: 0, glat };
  let lambda = Math.PI * x / (2 * Math.SQRT2 * cosTheta);
  let glon = lambda * 180 / Math.PI;
  if (glon < 0) glon += 360;
  return { glon, glat };
}

// ── Grid ────────────────────────────────────────────────────────────────────

function cellFromGalactic(glon, glat) {
  const col = Math.min(GRID_COLS - 1, Math.floor(glon / (360 / GRID_COLS)));
  const row = Math.min(GRID_ROWS - 1, Math.floor((90 - glat) / (180 / GRID_ROWS)));
  return { col, row };
}

function cellCorners(col, row, w, h) {
  const lonStep = 360 / GRID_COLS;
  const latStep = 180 / GRID_ROWS;
  const lons = [col * lonStep, (col + 1) * lonStep];
  const lats = [90 - row * latStep, 90 - (row + 1) * latStep];
  return [
    [lons[0], lats[0]], [lons[1], lats[0]],
    [lons[1], lats[1]], [lons[0], lats[1]],
  ].map(([glon, glat]) => {
    const { x, y } = galacticToMollweide(glon, glat);
    return mollweideToScreen(x, y, w, h);
  });
}

function drawCell(col, row, fillColor, strokeColor) {
  const corners = cellCorners(col, row, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.moveTo(corners[0].sx, corners[0].sy);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].sx, corners[i].sy);
  ctx.closePath();
  if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
  if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = 1; ctx.stroke(); }
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (hoveredCell && (!selectedCell ||
    hoveredCell.col !== selectedCell.col || hoveredCell.row !== selectedCell.row)) {
    drawCell(hoveredCell.col, hoveredCell.row,
      'rgba(200,184,154,0.08)', 'rgba(200,184,154,0.25)');
  }
  if (selectedCell) {
    drawCell(selectedCell.col, selectedCell.row,
      'rgba(200,184,154,0.15)', 'rgba(200,184,154,0.6)');
  }
}

// ── Canvas sizing ────────────────────────────────────────────────────────────

function resizeCanvas() {
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  redraw();
}

// ── Animation ────────────────────────────────────────────────────────────────

function animateText(el, finalText, duration = 2400) {
  return new Promise(resolve => {
    const steps = 36;
    const step_ms = duration / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const lockPoint = Math.floor(finalText.length * (step / steps));
      let out = '';
      for (let i = 0; i < finalText.length; i++) {
        const ch = finalText[i];
        if (i < lockPoint) {
          out += ch;
        } else if (ch === ' ' || ch === '\n' || ch === '\r') {
          out += ch;
        } else {
          out += NOISE_CHARS[Math.floor(Math.random() * NOISE_CHARS.length)];
        }
      }
      el.textContent = out;
      if (step >= steps) { clearInterval(timer); el.textContent = finalText; resolve(); }
    }, step_ms);
  });
}

function noiseText(el, length, interval_ms = 80) {
  el.textContent = Array.from({ length }, () =>
    NOISE_CHARS[Math.floor(Math.random() * NOISE_CHARS.length)]).join('');
  return setInterval(() => {
    el.textContent = Array.from({ length }, () =>
      NOISE_CHARS[Math.floor(Math.random() * NOISE_CHARS.length)]).join('');
  }, interval_ms);
}

// ── Bubble ───────────────────────────────────────────────────────────────────

function positionBubble(col, row) {
  const corners = cellCorners(col, row, canvas.width, canvas.height);
  const centerX = corners.reduce((s, c) => s + c.sx, 0) / 4;
  const centerY = corners.reduce((s, c) => s + c.sy, 0) / 4;
  const bw = bubble.offsetWidth  || 380;
  const bh = bubble.offsetHeight || 400;
  const margin = 16;
  let left = centerX + 20;
  let top  = centerY - bh / 2;
  if (left + bw > window.innerWidth  - margin) left = centerX - bw - 20;
  if (top  < margin)                           top  = margin;
  if (top  + bh > window.innerHeight - margin) top  = window.innerHeight - bh - margin;
  left = Math.max(margin, left);
  bubble.style.left = left + 'px';
  bubble.style.top  = top  + 'px';
}

async function showCell(col, row) {
  selectedCell = { col, row };
  redraw();
  hint.classList.add('hidden');

  // Show bubble with coords immediately
  bubble.classList.remove('hidden');
  positionBubble(col, row);

  const metadata = cells.find(c => c.col === col && c.row === row);
  const glon = metadata?.glon ?? col * 5 + 2.5;
  const glat = metadata?.glat ?? 90 - row * 5 - 2.5;

  document.getElementById('bubble-glon').textContent = `l=${glon.toFixed(1)}°`;
  document.getElementById('bubble-glat').textContent = `b=${glat >= 0 ? '+' : ''}${glat.toFixed(1)}°`;

  const notableEl = document.getElementById('bubble-notable');
  if (metadata?.notable) {
    notableEl.textContent = metadata.notable;
    notableEl.classList.remove('hidden');
  } else {
    notableEl.classList.add('hidden');
  }

  document.getElementById('bubble-words').textContent = '';
  document.getElementById('bubble-message').textContent = '';
  document.getElementById('bubble-date').textContent = '';
  document.getElementById('transmission-status').textContent = 'receiving ...';

  // Noise while loading
  const msgEl    = document.getElementById('bubble-message');
  const noiseLen = 120;
  const noiseTmr = noiseText(msgEl, noiseLen);

  // Fetch
  let data;
  try {
    const res = await fetch(`/api/cell/${col}/${row}`);
    data = await res.json();
  } catch (e) {
    clearInterval(noiseTmr);
    msgEl.textContent = '(transmission failed)';
    document.getElementById('transmission-status').textContent = '';
    return;
  }

  clearInterval(noiseTmr);

  // Words
  const wordsEl = document.getElementById('bubble-words');
  if (data.words?.length) {
    wordsEl.textContent = data.words.map(([w]) => w.toUpperCase()).join('  ·  ');
  } else {
    wordsEl.textContent = '(masked region — no signal)';
  }

  // Status
  const statusEl = document.getElementById('transmission-status');
  statusEl.textContent = data.is_new ? '— first received' : '';

  // Message animation
  if (data.message) {
    await animateText(msgEl, data.message, 2600);
  } else {
    msgEl.textContent = '(no words found at this location)';
  }

  // Date
  if (data.generated_at) {
    document.getElementById('bubble-date').textContent =
      data.is_new ? `First received  ${data.generated_at}` : `Received  ${data.generated_at}`;
  }
}

// ── Events ───────────────────────────────────────────────────────────────────

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  const coord = screenToGalactic(e.clientX - r.left, e.clientY - r.top,
    canvas.width, canvas.height);
  if (!coord) { hoveredCell = null; canvas.style.cursor = 'default'; redraw(); return; }
  const { col, row } = cellFromGalactic(coord.glon, coord.glat);
  hoveredCell = { col, row };
  canvas.style.cursor = 'crosshair';
  redraw();
});

canvas.addEventListener('mouseleave', () => {
  hoveredCell = null;
  redraw();
});

canvas.addEventListener('click', e => {
  const r = canvas.getBoundingClientRect();
  const coord = screenToGalactic(e.clientX - r.left, e.clientY - r.top,
    canvas.width, canvas.height);
  if (!coord) return;
  const { col, row } = cellFromGalactic(coord.glon, coord.glat);
  showCell(col, row);
});

document.getElementById('bubble-close').addEventListener('click', () => {
  bubble.classList.add('hidden');
  selectedCell = null;
  redraw();
});

window.addEventListener('resize', resizeCanvas);

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  resizeCanvas();
  try {
    const res = await fetch('/api/cells');
    cells = await res.json();
  } catch (e) {
    console.warn('Could not load cell metadata', e);
  }
}

init();
