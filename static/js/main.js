/* OLDEST LIGHT — main.js */

const GRID_COLS = 72;
const GRID_ROWS = 36;
const NOISE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ·';

let cells = [];          // lightweight metadata for all cells
let hoveredCell = null;
let selectedCell = null;

const canvas        = document.getElementById('grid-canvas');
const ctx           = canvas.getContext('2d');
const shimmerCanvas = document.getElementById('shimmer-canvas');
const shimmerCtx    = shimmerCanvas.getContext('2d');
const bubble        = document.getElementById('bubble');
const hint          = document.getElementById('hint');

// ── Map image processing ──────────────────────────────────────────────────────

async function processMapImage() {
  const img = document.getElementById('cmb-map');
  if (!img.complete) {
    await new Promise(r => { img.onload = r; });
  }

  const off = document.createElement('canvas');
  off.width  = img.naturalWidth;
  off.height = img.naturalHeight;
  const offCtx = off.getContext('2d');
  offCtx.drawImage(img, 0, 0);

  const id = offCtx.getImageData(0, 0, off.width, off.height);
  const d  = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum < 20) continue;   // keep near-black (outside ellipse) as black
    d[i]     = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  offCtx.putImageData(id, 0, 0);

  await new Promise(r => {
    img.onload = r;
    img.src = off.toDataURL('image/jpeg', 0.92);
  });
}

// ── Shimmer ──────────────────────────────────────────────────────────────────

function resizeShimmer() {
  shimmerCanvas.width  = shimmerCanvas.offsetWidth;
  shimmerCanvas.height = shimmerCanvas.offsetHeight;
}

function drawShimmer() {
  const w = shimmerCanvas.width;
  const h = shimmerCanvas.height;
  if (!w || !h) return;

  shimmerCtx.clearRect(0, 0, w, h);

  // Scatter bright pixels randomly across the map area
  const count = 350;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = Math.random() * 3 + 1;
    const bright = Math.random();

    // Warm or cool shimmer to echo the CMB palette
    const warmCool = Math.random();
    let color;
    if (warmCool > 0.6) {
      color = `rgba(220,120,80,${bright * 0.7})`;   // warm
    } else if (warmCool > 0.3) {
      color = `rgba(80,140,220,${bright * 0.7})`;   // cool
    } else {
      color = `rgba(240,240,240,${bright * 0.4})`;  // white
    }

    shimmerCtx.beginPath();
    shimmerCtx.arc(x, y, r, 0, Math.PI * 2);
    shimmerCtx.fillStyle = color;
    shimmerCtx.fill();
  }
}

// Shimmer runs at ~12fps — subtle, not distracting
setInterval(drawShimmer, 85);

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

function getImageBounds() {
  const img = document.getElementById('cmb-map');
  const cw = canvas.width;
  const ch = canvas.height;
  const aspect = (img.naturalWidth && img.naturalHeight)
    ? img.naturalWidth / img.naturalHeight
    : 2;
  let iw, ih;
  if (cw / ch > aspect) { ih = ch; iw = ih * aspect; }
  else                   { iw = cw; ih = iw / aspect; }
  return { left: (cw - iw) / 2, top: (ch - ih) / 2, width: iw, height: ih };
}

// Grid extends 1% past image left edge, flush with image right edge
const GRID_X_LEFT  = 0.01;
const GRID_X_SCALE = 1 + GRID_X_LEFT;  // total horizontal span = 1.01

function mollweideToScreen(x, y, w, h) {
  const { left, top, width, height } = getImageBounds();
  const sx = left - GRID_X_LEFT * width + (x / (4 * Math.SQRT2) + 0.5) * GRID_X_SCALE * width;
  const sy = top  + (0.5 - y / (2 * Math.SQRT2)) * height;
  return { sx, sy };
}

function screenToGalactic(px, py, w, h) {
  const { left, top, width, height } = getImageBounds();
  const xNorm = (px - left) / width;
  const yNorm = (py - top)  / height;

  const mx = ((xNorm + GRID_X_LEFT) / GRID_X_SCALE - 0.5) * 4 * Math.SQRT2;  // Mollweide x
  const my = (0.5 - yNorm) * 2 * Math.SQRT2;                                   // Mollweide y

  if ((mx / (2 * Math.SQRT2)) ** 2 + (my / Math.SQRT2) ** 2 > 1) return null;

  const theta = Math.asin(Math.max(-1, Math.min(1, my / Math.SQRT2)));
  const sinPhi = (2 * theta + Math.sin(2 * theta)) / Math.PI;
  const glat = Math.asin(Math.max(-1, Math.min(1, sinPhi))) * 180 / Math.PI;

  const cosTheta = Math.cos(theta);
  if (Math.abs(cosTheta) < 1e-9) return { glon: 0, glat };
  let lambda = Math.PI * mx / (2 * Math.SQRT2 * cosTheta);
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

function drawCell(col, row, fillColor, strokeColor, lineWidth = 1) {
  const corners = cellCorners(col, row, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.moveTo(corners[0].sx, corners[0].sy);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].sx, corners[i].sy);
  ctx.closePath();
  if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
  if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function drawGrid() {
  ctx.save();
  ctx.lineWidth = 0.7;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const opacity = Math.random() * 0.35 + 0.05;
      ctx.strokeStyle = `rgba(255,255,255,${opacity.toFixed(2)})`;
      const corners = cellCorners(col, row, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.moveTo(corners[0].sx, corners[0].sy);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].sx, corners[i].sy);
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Slow grid flicker — signal interference aesthetic
setInterval(() => redraw(), 250);

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  if (hoveredCell && (!selectedCell ||
    hoveredCell.col !== selectedCell.col || hoveredCell.row !== selectedCell.row)) {
    drawCell(hoveredCell.col, hoveredCell.row,
      'rgba(200,184,154,0.2)', 'rgba(200,184,154,0.8)', 1.5);
  }
  if (selectedCell) {
    drawCell(selectedCell.col, selectedCell.row,
      'rgba(200,184,154,0.25)', 'rgba(200,184,154,1.0)', 2);
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

function snakeNoise(el, rows = 7, cols = 38, interval_ms = 80) {
  function generate() {
    const lines = [];
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < cols; c++) {
        line += NOISE_CHARS[Math.floor(Math.random() * NOISE_CHARS.length)];
      }
      lines.push(line);
    }
    el.textContent = lines.join('\n');
  }
  generate();
  return setInterval(generate, interval_ms);
}

// ── Bubble ───────────────────────────────────────────────────────────────────

function positionBubble(col, row) {
  const corners = cellCorners(col, row, canvas.width, canvas.height);
  const centerX = corners.reduce((s, c) => s + c.sx, 0) / 4;
  const centerY = corners.reduce((s, c) => s + c.sy, 0) / 4;
  const bw = bubble.offsetWidth || 380;
  // Use actual height if content is loaded, else assume near max-height
  const bh = bubble.scrollHeight > 120
    ? Math.min(bubble.scrollHeight, window.innerHeight * 0.8)
    : Math.round(window.innerHeight * 0.78);
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

  // Snake noise block while API loads
  const msgEl    = document.getElementById('bubble-message');
  const noiseTmr = snakeNoise(msgEl);

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

  document.getElementById('transmission-status').textContent = '';

  // Message animation — normalize API newlines so text wraps naturally
  const message = data.message
    ? data.message.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (message) {
    await animateText(msgEl, message, 2600);
  } else {
    msgEl.textContent = '(no words found at this location)';
  }

  // Date
  if (data.generated_at) {
    document.getElementById('bubble-date').textContent =
      data.is_new ? `First received  ${data.generated_at}` : `Received  ${data.generated_at}`;
  }

  // Reposition now that final content height is known
  positionBubble(col, row);
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

window.addEventListener('resize', () => { resizeCanvas(); resizeShimmer(); });

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  resizeCanvas();
  resizeShimmer();
  await processMapImage();
  try {
    const res = await fetch('/api/cells');
    cells = await res.json();
  } catch (e) {
    console.warn('Could not load cell metadata', e);
  }
}

init();
