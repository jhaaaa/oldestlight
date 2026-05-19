/* OLDEST LIGHT — main.js */

const GRID_COLS = 72;
const GRID_ROWS = 36;
const NOISE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ·';

let cells = [];          // lightweight metadata for all cells
let hoveredCell  = null;
let selectedCell = null;
const decodedCells = new Set();  // "col,row" keys for decoded blocks
let currentCopy = null;          // { message, glon, glat } for clipboard

const HINT_DEFAULT  = 'Click a block to decode a poem from the Cosmic Microwave Background';
const HINT_DECODED  = 'Already decoded — click to read the transmission';
const HINT_TOUCH    = 'Tap a block to decode a poem from the Cosmic Microwave Background';
const HINT_ALL_DONE = 'All 2,592 transmissions decoded — click any purple coordinate to read';

const canvas        = document.getElementById('grid-canvas');
const ctx           = canvas.getContext('2d');
const shimmerCanvas = document.getElementById('shimmer-canvas');
const shimmerCtx    = shimmerCanvas.getContext('2d');
const depthCanvas   = document.getElementById('depth-canvas');
const depthCtx      = depthCanvas.getContext('2d');
const cosmicCanvas  = document.getElementById('cosmic-web-canvas');
const cosmicCtx     = cosmicCanvas.getContext('2d');
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

// ── Depth ────────────────────────────────────────────────────────────────────

function drawDepth() {
  const dpr = window.devicePixelRatio || 1;
  depthCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = depthCanvas.offsetWidth;
  const h = depthCanvas.offsetHeight;
  depthCtx.clearRect(0, 0, w, h);

  const { left, top, width, height } = getImageBounds();
  const cx = left + width  / 2;
  const cy = top  + height / 2;

  // Vignette: scale canvas to unit-circle space so createRadialGradient
  // produces an elliptical falloff matching the Mollweide oval
  depthCtx.save();
  depthCtx.translate(cx, cy);
  depthCtx.scale(width / 2, height / 2);
  const vignette = depthCtx.createRadialGradient(0, 0, 0.35, 0, 0, 1.0);
  vignette.addColorStop(0,    'rgba(0,0,0,0)');
  vignette.addColorStop(0.65, 'rgba(0,0,0,0.15)');
  vignette.addColorStop(1.0,  'rgba(0,0,0,0.72)');
  depthCtx.fillStyle = vignette;
  depthCtx.beginPath();
  depthCtx.arc(0, 0, 1, 0, Math.PI * 2);
  depthCtx.fill();
  depthCtx.restore();

  // Specular highlight: soft white glow upper-left, implies a light source
  const spx = cx - width  * 0.22;
  const spy = cy - height * 0.28;
  const specular = depthCtx.createRadialGradient(spx, spy, 0, spx, spy, width * 0.42);
  specular.addColorStop(0,   'rgba(255,255,255,0.13)');
  specular.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  specular.addColorStop(1,   'rgba(255,255,255,0)');
  depthCtx.fillStyle = specular;
  depthCtx.fillRect(left, top, width, height);
}

function resizeDepth() {
  const dpr = window.devicePixelRatio || 1;
  depthCanvas.width  = depthCanvas.offsetWidth  * dpr;
  depthCanvas.height = depthCanvas.offsetHeight * dpr;
  drawDepth();
}

// ── Cosmic Web ───────────────────────────────────────────────────────────────

const NODE_COUNT    = 90;
const CONNECT_DIST  = 230;
const FLOW_SPEED    = 0.20;   // px/frame — geological pace
const ATTRACT_RADIUS = 160;
const ATTRACT_FORCE  = 1.2;

let cosmicNodes = [];
let cosmicMouse = { x: -9999, y: -9999, vx: 0, vy: 0 };
let flowTime    = 0;

// Slow-evolving vector field — gives organic wandering without linear drift
function flowAngle(x, y, t) {
  const s = 0.0026;
  return (
    Math.sin(x * s         + t * 0.00032) * Math.cos(y * s * 0.7  + t * 0.00024) +
    Math.cos(x * s * 0.52  - t * 0.00038) * Math.sin(y * s        + t * 0.00029)
  ) * Math.PI;
}

function initCosmicNodes() {
  cosmicNodes = [];
  const w = cosmicCanvas.offsetWidth;
  const h = cosmicCanvas.offsetHeight;
  for (let i = 0; i < NODE_COUNT; i++) {
    cosmicNodes.push({ x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0 });
  }
}

function drawCosmicWeb() {
  const dpr = window.devicePixelRatio || 1;
  cosmicCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = cosmicCanvas.offsetWidth;
  const h = cosmicCanvas.offsetHeight;
  if (!w || !h || !cosmicNodes.length) { requestAnimationFrame(drawCosmicWeb); return; }

  const { left, top, width, height } = getImageBounds();
  const cx = left + width / 2;
  const cy = top  + height / 2;

  cosmicCtx.save();
  cosmicCtx.beginPath();
  cosmicCtx.rect(0, 0, w, h);
  cosmicCtx.ellipse(cx, cy, width / 2, height / 2, 0, 0, Math.PI * 2);
  cosmicCtx.clip('evenodd');

  // Fade rather than clear — filaments leave warm trails (~0.5s persistence)
  cosmicCtx.fillStyle = 'rgba(0,0,0,0.05)';
  cosmicCtx.fillRect(0, 0, w, h);

  // Draw curved filaments
  cosmicCtx.lineWidth = 0.7;
  for (let i = 0; i < cosmicNodes.length; i++) {
    for (let j = i + 1; j < cosmicNodes.length; j++) {
      const dx   = cosmicNodes[j].x - cosmicNodes[i].x;
      const dy   = cosmicNodes[j].y - cosmicNodes[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CONNECT_DIST) {
        const t     = dist / CONNECT_DIST;
        const alpha = (1 - t) * (1 - t) * 0.35;  // quadratic fade, visible over accumulated black
        const mx  = (cosmicNodes[i].x + cosmicNodes[j].x) / 2;
        const my  = (cosmicNodes[i].y + cosmicNodes[j].y) / 2;
        const bow = dist * 0.18;                  // pronounced bow so curves read as liquid
        const cpx = mx - (dy / dist) * bow;
        const cpy = my + (dx / dist) * bow;
        cosmicCtx.beginPath();
        cosmicCtx.moveTo(cosmicNodes[i].x, cosmicNodes[i].y);
        cosmicCtx.quadraticCurveTo(cpx, cpy, cosmicNodes[j].x, cosmicNodes[j].y);
        cosmicCtx.strokeStyle = `rgba(200,184,154,${alpha.toFixed(3)})`;
        cosmicCtx.stroke();
      }
    }
  }

  cosmicCtx.restore();

  // Physics: flow field + cursor attraction
  for (const node of cosmicNodes) {
    node.vx *= 0.90;
    node.vy *= 0.90;

    const cdx   = node.x - cosmicMouse.x;
    const cdy   = node.y - cosmicMouse.y;
    const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
    if (cdist < ATTRACT_RADIUS && cdist > 35) {
      // Pull toward cursor — minimum distance stops collapse, flow field keeps it billowy
      const influence = (1 - cdist / ATTRACT_RADIUS);
      node.vx -= (cdx / cdist) * influence * 0.45;
      node.vy -= (cdy / cdist) * influence * 0.45;
    }

    const angle = flowAngle(node.x, node.y, flowTime);
    node.x += Math.cos(angle) * FLOW_SPEED + node.vx;
    node.y += Math.sin(angle) * FLOW_SPEED + node.vy;

    // Wrap — nodes drift off one edge and reappear on the other
    if (node.x < -60)    node.x = w + 60;
    if (node.x > w + 60) node.x = -60;
    if (node.y < -60)    node.y = h + 60;
    if (node.y > h + 60) node.y = -60;
  }

  flowTime++;
  requestAnimationFrame(drawCosmicWeb);
}

function resizeCosmicWeb() {
  const dpr = window.devicePixelRatio || 1;
  cosmicCanvas.width  = cosmicCanvas.offsetWidth  * dpr;
  cosmicCanvas.height = cosmicCanvas.offsetHeight * dpr;
  initCosmicNodes();
}

// ── Shimmer ──────────────────────────────────────────────────────────────────

function resizeShimmer() {
  const dpr = window.devicePixelRatio || 1;
  shimmerCanvas.width  = shimmerCanvas.offsetWidth  * dpr;
  shimmerCanvas.height = shimmerCanvas.offsetHeight * dpr;
}

function drawShimmer() {
  const dpr = window.devicePixelRatio || 1;
  shimmerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = shimmerCanvas.offsetWidth;
  const h = shimmerCanvas.offsetHeight;
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
  const cw = canvas.offsetWidth;
  const ch = canvas.offsetHeight;
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
  const corners = [
    [lons[0], lats[0]], [lons[1], lats[0]],
    [lons[1], lats[1]], [lons[0], lats[1]],
  ].map(([glon, glat]) => {
    const { x, y } = galacticToMollweide(glon, glat);
    return mollweideToScreen(x, y, w, h);
  });
  // Cells spanning glon=180° have corners on opposite sides of the ellipse —
  // drawing them as a polygon produces a band across the entire canvas.
  const xs = corners.map(c => c.sx);
  if (Math.max(...xs) - Math.min(...xs) > w * 0.5) return null;
  return corners;
}

function drawCell(col, row, fillColor, strokeColor, lineWidth = 1) {
  const corners = cellCorners(col, row, canvas.width, canvas.height);
  if (!corners) return;
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

  // Pass 1: all cell borders
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const corners = cellCorners(col, row, canvas.width, canvas.height);
      if (!corners) continue;
      ctx.beginPath();
      ctx.moveTo(corners[0].sx, corners[0].sy);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].sx, corners[i].sy);
      ctx.closePath();
      if (decodedCells.has(`${col},${row}`)) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(180,100,255,0.75)';
      } else {
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = `rgba(255,255,255,${(Math.random() * 0.35 + 0.05).toFixed(2)})`;
      }
      ctx.stroke();
    }
  }

  // Pass 2: soft inner glow for each decoded cell
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (!decodedCells.has(`${col},${row}`)) continue;
      const corners = cellCorners(col, row, canvas.width, canvas.height);
      if (!corners) continue;

      const xs = corners.map(c => c.sx);
      const ys = corners.map(c => c.sy);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const r  = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.75;

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0,   'rgba(180,100,255,0.60)');
      glow.addColorStop(0.5, 'rgba(140,60,220,0.25)');
      glow.addColorStop(1,   'rgba(100,0,200,0)');

      ctx.beginPath();
      ctx.moveTo(corners[0].sx, corners[0].sy);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].sx, corners[i].sy);
      ctx.closePath();
      ctx.fillStyle = glow;
      ctx.fill();
    }
  }

  ctx.restore();
}

// Slow grid flicker — signal interference aesthetic
setInterval(() => redraw(), 250);

function redraw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
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
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth  * dpr;
  canvas.height = canvas.offsetHeight * dpr;
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

const isMobile = () => window.innerWidth <= 600;

function positionBubble(col, row) {
  if (isMobile()) return;  // CSS bottom-sheet handles mobile positioning
  const corners = cellCorners(col, row, canvas.width, canvas.height);
  const centerX = corners.reduce((s, c) => s + c.sx, 0) / 4;
  const centerY = corners.reduce((s, c) => s + c.sy, 0) / 4;
  const bw = bubble.offsetWidth || 380;
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
  document.getElementById('bubble-temps').textContent = '';
  document.getElementById('bubble-message').textContent = '';
  document.getElementById('bubble-date').textContent = '';
  document.getElementById('bubble-decoder').textContent = '';
  document.getElementById('bubble-decoder').classList.add('hidden');
  document.getElementById('bubble-copy').classList.add('hidden');
  currentCopy = null;

  const msgEl    = document.getElementById('bubble-message');
  const isNew    = !decodedCells.has(`${col},${row}`);

  // Snake noise only for first-time decodes
  let noiseTmr = null;
  if (isNew) {
    document.getElementById('transmission-status').textContent = 'receiving ...';
    noiseTmr = snakeNoise(msgEl);
  } else {
    document.getElementById('transmission-status').textContent = '';
  }

  // Fetch
  let data;
  try {
    const res = await fetch(`/api/cell/${col}/${row}`);
    if (res.status === 429) {
      if (noiseTmr) clearInterval(noiseTmr);
      msgEl.textContent = 'To enable wider participation,\neach visitor can decode one transmission\nevery 5 minutes.\n\nClick or tap a purple block to read\nalready decoded transmissions.';
      document.getElementById('transmission-status').textContent = '';
      positionBubble(col, row);
      return;
    }
    data = await res.json();
  } catch (e) {
    if (noiseTmr) clearInterval(noiseTmr);
    msgEl.textContent = '(transmission failed)';
    document.getElementById('transmission-status').textContent = '';
    return;
  }

  if (noiseTmr) clearInterval(noiseTmr);

  // Mark this cell decoded on the map
  decodedCells.add(`${col},${row}`);
  redraw();

  // Temperatures
  const tempsEl = document.getElementById('bubble-temps');
  tempsEl.textContent = '';
  if (data.temp_min != null && data.temp_max != null) {
    const CMB_MEAN_C = 2.725 - 273.15;  // −270.425°C
    const fmtC = v => (CMB_MEAN_C + v / 1e6).toFixed(7) + ' °C';

    const absLine = document.createElement('div');
    absLine.textContent = fmtC(data.temp_min) + '  ·  ' + fmtC(data.temp_max);

    tempsEl.appendChild(absLine);
  } else {
    tempsEl.textContent = '(no temperature data)';
  }

  // Words
  const wordsEl = document.getElementById('bubble-words');
  if (data.words?.length) {
    wordsEl.textContent = data.words.map(([w]) => w.toUpperCase()).join('  ·  ');
  } else {
    wordsEl.textContent = '(masked region — no signal)';
  }

  document.getElementById('transmission-status').textContent = '';

  // Normalize API newlines so text wraps naturally
  const message = data.message
    ? data.message.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (message) {
    if (isNew) {
      await animateText(msgEl, message, 2600);
    } else {
      msgEl.textContent = message;
    }
  } else {
    msgEl.textContent = '(no words found at this location)';
  }

  // Date
  if (data.generated_at) {
    document.getElementById('bubble-date').textContent =
      data.is_new ? `First received  ${data.generated_at}` : `Received  ${data.generated_at}`;
  }

  // Decoder location
  const decoderEl = document.getElementById('bubble-decoder');
  if (data.decoder_city) {
    const location = `${data.decoder_city}, ${data.decoder_country}`;
    decoderEl.textContent = `Decoded from  ${location}`;
    decoderEl.classList.remove('hidden');
  }

  // Enable copy button now that message is ready
  if (message) {
    currentCopy = { message, glon, glat };
    document.getElementById('bubble-copy').classList.remove('hidden');
  }

  // Reposition now that final content height is known
  positionBubble(col, row);
}

// ── Transmission page (mobile) ───────────────────────────────────────────────

function showCellOnMobile(col, row) {
  window.location.href = `/transmission?col=${col}&row=${row}&v=2`;
}

// ── Events ───────────────────────────────────────────────────────────────────

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  cosmicMouse.x = px;
  cosmicMouse.y = py;
  const coord = screenToGalactic(px, py, canvas.width, canvas.height);
  if (!coord) {
    hoveredCell = null;
    canvas.style.cursor = 'default';
    if (!hint.classList.contains('hidden')) hint.textContent = HINT_DEFAULT;
    redraw();
    return;
  }
  const { col, row } = cellFromGalactic(coord.glon, coord.glat);
  hoveredCell = { col, row };
  canvas.style.cursor = 'crosshair';
  if (!hint.classList.contains('hidden')) {
    hint.textContent = decodedCells.has(`${col},${row}`) ? HINT_DECODED : HINT_DEFAULT;
  }
  redraw();
});

canvas.addEventListener('mouseleave', () => {
  cosmicMouse.x = -9999;
  cosmicMouse.y = -9999;
  hoveredCell = null;
  if (!hint.classList.contains('hidden')) hint.textContent = HINT_DEFAULT;
  redraw();
});

canvas.addEventListener('click', e => {
  if (isMobile()) return;  // touchend handles mobile taps via iframe
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

document.getElementById('bubble-copy').addEventListener('click', () => {
  if (!currentCopy) return;
  const { message, glon, glat } = currentCopy;
  const latStr = `b=${glat >= 0 ? '+' : ''}${glat.toFixed(1)}°`;
  const text = `From OLDESTLIGHT.SPACE\n\n${message}\n\n— A poem from the Cosmic Microwave Background, galactic coordinates l=${glon.toFixed(1)}° ${latStr}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('bubble-copy');
    btn.textContent = 'COPIED';
    setTimeout(() => { btn.textContent = '⧉'; }, 2000);
  });
});

function resetZoom(callback) {
  if (!window.visualViewport || window.visualViewport.scale <= 1.05) {
    callback();
    return;
  }
  const meta = document.querySelector('meta[name=viewport]');
  const orig = meta.content;
  meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0';
  setTimeout(() => {
    meta.content = orig;
    setTimeout(callback, 50);
  }, 300);
}

let touchStartPos  = null;
let touchStartTime = 0;

canvas.addEventListener('touchstart', e => {
  if (e.touches.length > 1) { touchStartPos = null; return; }
  const touch = e.touches[0];
  const r = canvas.getBoundingClientRect();
  touchStartPos  = { x: touch.clientX, y: touch.clientY };
  touchStartTime = Date.now();
  cosmicMouse.x  = touch.clientX - r.left;
  cosmicMouse.y  = touch.clientY - r.top;
}, { passive: true }); // passive: true lets browser handle pinch-to-zoom

canvas.addEventListener('touchmove', e => {
  if (e.touches.length > 1) return; // let pinch pass through
  e.preventDefault();
  const r     = canvas.getBoundingClientRect();
  const touch = e.touches[0];
  cosmicMouse.x = touch.clientX - r.left;
  cosmicMouse.y = touch.clientY - r.top;
}, { passive: false });

canvas.addEventListener('touchend', e => {
  const touch = e.changedTouches[0];
  if (touchStartPos && e.touches.length === 0) {
    const dx      = touch.clientX - touchStartPos.x;
    const dy      = touch.clientY - touchStartPos.y;
    const moved   = Math.sqrt(dx * dx + dy * dy);
    const elapsed = Date.now() - touchStartTime;
    if (moved < 12 && elapsed < 350) {
      const r     = canvas.getBoundingClientRect();
      const coord = screenToGalactic(touch.clientX - r.left, touch.clientY - r.top,
        canvas.width, canvas.height);
      if (coord) {
        const { col, row } = cellFromGalactic(coord.glon, coord.glat);
        showCellOnMobile(col, row);
      }
    }
  }
  if (e.touches.length === 0) {
    touchStartPos = null;
    cosmicMouse.x = -9999;
    cosmicMouse.y = -9999;
  }
});

window.addEventListener('resize', () => { resizeCanvas(); resizeShimmer(); resizeDepth(); resizeCosmicWeb(); });

// Refresh decoded cells when returning from the transmission page (bfcache restore)
window.addEventListener('pageshow', e => {
  if (!e.persisted) return;
  fetch('/api/decoded').then(r => r.json()).then(list => {
    list.forEach(({ col, row }) => decodedCells.add(`${col},${row}`));
    redraw();
  }).catch(() => {});
});

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  resizeCanvas();
  resizeShimmer();
  resizeDepth();
  resizeCosmicWeb();
  requestAnimationFrame(drawCosmicWeb);
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    hint.textContent = HINT_TOUCH;
  }
  await processMapImage();
  drawDepth();
  redraw();
  try {
    const [cellsRes, decodedRes] = await Promise.all([
      fetch('/api/cells'),
      fetch('/api/decoded'),
    ]);
    cells = await cellsRes.json();
    const decodedList = await decodedRes.json();
    decodedList.forEach(({ col, row }) => decodedCells.add(`${col},${row}`));
    redraw();
    if (decodedCells.size >= GRID_COLS * GRID_ROWS) {
      hint.textContent = HINT_ALL_DONE;
    }
  } catch (e) {
    console.warn('Could not load cell metadata', e);
  }
}

init();
