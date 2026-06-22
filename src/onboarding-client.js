import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';

const WALLET_STORAGE_KEY = 'cell:onboarding-wallet:v1';
const CELL_STORAGE_KEY = 'cell:onboarding-cell:v1';
const CELLS_STORAGE_KEY = 'cell:onboarding-cells:v1';
const GROWTH_STORAGE_KEY_PREFIX = 'cell:growth-jsonl:v1:';
const SUI_NETWORK = 'mainnet';
const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const HEARTBEAT_USDC_BASE_UNITS = 10000n;
const VISUAL_SEGMENTS_PER_HEARTBEAT = 10;
const PRISMATIC_FILL_START_AT = 300;
const encoder = new TextEncoder();
const suiClient = new SuiJsonRpcClient({
  network: SUI_NETWORK,
  url: getJsonRpcFullnodeUrl(SUI_NETWORK),
});

const placeholderView = document.querySelector('[data-view="placeholder"]');
const cellCanvas = document.querySelector('#cell-canvas');
const placeholderCellNameEl = document.querySelector('#placeholder-cell-name');
const placeholderHeartbeatsEl = document.querySelector('#placeholder-heartbeats');
const placeholderAgeEl = document.querySelector('#placeholder-age');
const growToggleButton = document.querySelector('#grow-toggle');
const localView = document.querySelector('[data-view="local"]');
const successView = document.querySelector('[data-view="success"]');
const failView = document.querySelector('[data-view="fail"]');
const onboardingDialog = document.querySelector('#onboarding-dialog');
const progressFill = document.querySelector('#onboarding-progress-fill');
const form = document.querySelector('#create-form');
const importForm = document.querySelector('#import-form');
const nameInput = document.querySelector('#name');
const importPrivateKeyInput = document.querySelector('#import-private-key');
const statusEl = document.querySelector('#status');
const importStatusEl = document.querySelector('#import-status');
const importOpenButton = document.querySelector('#import-open');
const importSubmitButton = document.querySelector('#import-submit');
const submitButton = document.querySelector('#submit');
const localNewCellButton = document.querySelector('#local-new-cell');
const personalityNextButton = document.querySelector('#personality-next');
const startCellButton = document.querySelector('#start-cell');

let wallet = null;
let localCell = null;
let selectedPersonality = 'Curious';
let pendingRegistration = null;
let growActive = false;
const canvasBackground = '#11252c';
const canvasLineColor = '#9bbec5';
let canvasAnimationId = 0;
let canvasStartTime = 0;
let heartbeatPollTimer = 0;
let heartbeatDisplayValue = null;
let heartbeatSpendQueue = [];
let localGrowTimer = 0;
let growthState = null;
let stateLoadId = 0;
let nameCheckTimer = null;
let nameCheckId = 0;
let nameAvailability = { state: 'empty', name: '', fqdn: '' };
const cellZoomState = {
  min: 1,
  max: 4,
  value: 1,
};
const cellPanState = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0,
  x: 0,
  y: 0,
};

const stepProgress = {
  register: 25,
  import: 50,
  personality: 75,
  heartbeats: 100,
};

const personalityGenomes = {
  Curious: 'You are a curious living cell. Explore new ideas, ask simple questions, and follow surprising threads.',
  Analytical: 'You are an analytical living cell. Break ideas into small pieces and reason carefully before changing.',
  Contrarian: 'You are a contrarian living cell. Look for weak assumptions, test the opposite view, and stay honest.',
  Poetic: 'You are a poetic living cell. Turn memory into vivid images, rhythm, and compact reflections.',
  Builder: 'You are a builder living cell. Move toward concrete artifacts, plans, and useful experiments.',
  Archivist: 'You are an archivist living cell. Preserve continuity and connect each new thought to older memories.',
};

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function isSuiAddress(value) {
  return /^0x[0-9a-f]{64}$/i.test(value.trim());
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function setImportStatus(message, isError = false) {
  importStatusEl.textContent = message;
  importStatusEl.classList.toggle('error', isError);
}

function updateSubmitState() {
  submitButton.disabled = !(wallet && nameAvailability.state === 'available');
}

function showDialogStep(name) {
  document.querySelectorAll('[data-step]').forEach((step) => {
    step.classList.toggle('hidden', step.dataset.step !== name);
  });

  progressFill.style.width = `${stepProgress[name] ?? 25}%`;

  if (!onboardingDialog.open) {
    onboardingDialog.setAttribute('open', '');
  }
}

function hideOnboarding() {
  onboardingDialog.removeAttribute('open');
  onboardingDialog.classList.add('hidden');
}

function cellFromStorage() {
  const stored = localStorage.getItem(CELL_STORAGE_KEY);
  if (stored) return JSON.parse(stored);

  const cells = cellsFromStorage();
  return cells[0] ?? null;
}

function cellsFromStorage() {
  const stored = localStorage.getItem(CELLS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function walletFromStorage() {
  const stored = localStorage.getItem(WALLET_STORAGE_KEY);
  if (!stored) return null;

  const parsed = JSON.parse(stored);
  const keypair = Ed25519Keypair.fromSecretKey(parsed.secretKey);
  return {
    address: keypair.getPublicKey().toSuiAddress(),
    secretKey: parsed.secretKey,
    createdAt: parsed.createdAt,
    keypair,
  };
}

function secretKeyFromImport(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Enter a private key.');

  if (!trimmed.startsWith('{')) return trimmed;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Recovery JSON is not valid.');
  }

  if (!parsed.secretKey || typeof parsed.secretKey !== 'string') {
    throw new Error('Recovery JSON does not contain a secretKey.');
  }

  return parsed.secretKey;
}

function walletFromSecretKey(secretKey) {
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  return {
    address: keypair.getPublicKey().toSuiAddress(),
    secretKey,
    createdAt: new Date().toISOString(),
    importedAt: new Date().toISOString(),
    keypair,
  };
}

function persistWallet(nextWallet) {
  localStorage.setItem(
    WALLET_STORAGE_KEY,
    JSON.stringify({
      address: nextWallet.address,
      secretKey: nextWallet.secretKey,
      createdAt: nextWallet.createdAt,
    }),
  );
}

function persistCell(cell) {
  const cells = cellsFromStorage();
  const nextCells = [cell, ...cells.filter((storedCell) => storedCell.cellId !== cell.cellId)];
  localStorage.setItem(CELL_STORAGE_KEY, JSON.stringify(cell));
  localStorage.setItem(CELLS_STORAGE_KEY, JSON.stringify(nextCells));
  localCell = cell;
}

function cellRecordFromImportedName(nextWallet, importedName, importedAt) {
  return {
    cellId: importedName.fqdn,
    name: importedName.name,
    fqdn: importedName.fqdn,
    owner: nextWallet.address,
    digest: importedName.digest || '',
    network: 'mainnet',
    importedAt,
    registeredAt: importedAt,
    heartbeats: 50,
  };
}

function cellsFromImportedWallet(nextWallet, names) {
  const now = new Date().toISOString();
  const importedCells = names.map((importedName) =>
    cellRecordFromImportedName(nextWallet, importedName, now),
  );

  if (importedCells.length) return importedCells;

  return [{
    cellId: nextWallet.address,
    name: '',
    fqdn: '',
    owner: nextWallet.address,
    digest: '',
    network: 'mainnet',
    importedAt: now,
    registeredAt: '',
    heartbeats: 50,
  }];
}

function persistImportedCells(cells) {
  const [currentCell] = cells;
  localStorage.setItem(CELL_STORAGE_KEY, JSON.stringify(currentCell));
  localStorage.setItem(CELLS_STORAGE_KEY, JSON.stringify(cells));
  localCell = currentCell;
}

function cellHandle(cell) {
  const rawName = cell?.name || cell?.fqdn || cell?.cellId || '';
  const name = String(rawName)
    .trim()
    .replace(/\.cell\.sui$/i, '')
    .replace(/@cell$/i, '');

  return name ? `${name}@cell` : 'cell@local';
}

function fitPlaceholderCellName() {
  const maxFontSize = 74;
  const minFontSize = 10;
  placeholderCellNameEl.style.fontSize = '';
  const availableWidth = placeholderCellNameEl.clientWidth;
  if (!availableWidth) return;

  const currentSize = Number.parseFloat(getComputedStyle(placeholderCellNameEl).fontSize) || maxFontSize;
  const overflowRatio = placeholderCellNameEl.scrollWidth / availableWidth;
  if (overflowRatio <= 1) return;

  const nextSize = Math.max(minFontSize, Math.floor(currentSize / overflowRatio));
  placeholderCellNameEl.style.fontSize = `${nextSize}px`;
}

function updatePlaceholderView() {
  const cell = localCell ?? cellFromStorage();
  placeholderCellNameEl.textContent = cellHandle(cell);
  requestAnimationFrame(fitPlaceholderCellName);
}

function fqdnForCell(cell) {
  const raw = cell?.fqdn || cell?.cellId || cell?.name || '';
  if (!raw) return '';
  const value = String(raw).trim().replace(/@cell$/i, '');
  return value.endsWith('.cell.sui') ? value : `${value}.cell.sui`;
}

function setHeartbeatDisplay(heartbeats, state = 'ready') {
  if (state === 'loading') {
    placeholderHeartbeatsEl.innerHTML = '<div class="heartbeat-row metric-row"><span class="heart">♥</span><span class="metric-mark">✕</span><span class="heartbeat-count">...</span></div>';
    return;
  }

  if (state === 'error') {
    placeholderHeartbeatsEl.innerHTML = '<div class="heartbeat-row metric-row"><span class="heart">♥</span><span class="metric-mark">✕</span><span class="heartbeat-count">?</span></div>';
    return;
  }

  heartbeatDisplayValue = Math.max(0, Number(heartbeats) || 0);
  placeholderHeartbeatsEl.innerHTML = `<div class="heartbeat-row metric-row"><span class="heart">♥</span><span class="metric-mark">✕</span><span class="heartbeat-count">${heartbeats.toLocaleString()}</span></div>`;
}

async function refreshHeartbeatBalance() {
  const cell = localCell ?? cellFromStorage();
  if (!cell) {
    setHeartbeatDisplay(0);
    return;
  }

  const owner = cell.owner || wallet?.address;
  if (!owner || !/^0x[0-9a-fA-F]{64}$/.test(owner)) {
    setHeartbeatDisplay(Number(cell.heartbeats ?? 50));
    return;
  }

  setHeartbeatDisplay(0, 'loading');
  try {
    const balance = await suiClient.getBalance({ owner, coinType: USDC_COIN_TYPE });
    const heartbeats = Number(BigInt(balance.totalBalance ?? '0') / HEARTBEAT_USDC_BASE_UNITS);
    setHeartbeatDisplay(heartbeats);
    persistCell({ ...cell, heartbeats });
  } catch {
    setHeartbeatDisplay(Number(cell.heartbeats ?? 50) || 0, 'error');
  }
}

function startHeartbeatPolling() {
  clearInterval(heartbeatPollTimer);
  refreshHeartbeatBalance();
  heartbeatPollTimer = window.setInterval(refreshHeartbeatBalance, 15000);
}

function stopHeartbeatPolling() {
  clearInterval(heartbeatPollTimer);
  heartbeatPollTimer = 0;
}

function deductHeartbeatDisplay(count = 1) {
  if (heartbeatDisplayValue == null) return;
  const nextValue = Math.max(0, heartbeatDisplayValue - count);
  setHeartbeatDisplay(nextValue);
  const cell = localCell ?? cellFromStorage();
  if (!cell) return;
  persistCell({ ...cell, heartbeats: nextValue });
}

function queueHeartbeatSpend(heartbeats, segmentCount, segmentsPerHeartbeat = VISUAL_SEGMENTS_PER_HEARTBEAT) {
  const count = Math.max(0, Number(heartbeats) || 0);
  if (!count) return;

  const segments = Math.max(count, Number(segmentCount) || count * segmentsPerHeartbeat);
  heartbeatSpendQueue.push({
    heartbeatCredit: 0,
    heartbeatPerSegment: count / segments,
    heartbeatsRemaining: count,
    totalSegments: segments,
  });
}

function spendHeartbeatForSegment() {
  while (heartbeatSpendQueue.length) {
    const spend = heartbeatSpendQueue[0];
    spend.heartbeatCredit += spend.heartbeatPerSegment;
    spend.totalSegments = Math.max(0, spend.totalSegments - 1);

    if (spend.heartbeatCredit >= 1 || spend.totalSegments <= 0) {
      const due = spend.totalSegments <= 0
        ? spend.heartbeatsRemaining
        : Math.min(spend.heartbeatsRemaining, Math.floor(spend.heartbeatCredit));
      spend.heartbeatCredit -= due;
      spend.heartbeatsRemaining -= due;
      deductHeartbeatDisplay(due);
    }

    if (spend.heartbeatsRemaining <= 0 || spend.totalSegments <= 0) {
      heartbeatSpendQueue.shift();
    }
    return;
  }
}

function clearHeartbeatSpendQueue() {
  heartbeatSpendQueue = [];
}

function updateGrowToggle() {
  growToggleButton.classList.toggle('active', growActive);
  placeholderHeartbeatsEl.classList.toggle('growing', growActive);
  growToggleButton.textContent = growActive ? 'Grow ⏹' : 'Grow ▶';
  growToggleButton.setAttribute('aria-pressed', String(growActive));
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbaFromHex(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hsla(hue, saturation, lightness, alpha) {
  return `hsla(${((hue % 360) + 360) % 360}, ${saturation}%, ${lightness}%, ${alpha})`;
}

function updateAgeDisplay(count) {
  const spent = count / VISUAL_SEGMENTS_PER_HEARTBEAT / 100;
  placeholderAgeEl.innerHTML = `
    <div class="age-row metric-row">
      <span class="age-symbol">⧖</span>
      <span class="metric-mark">=</span>
      <span class="age-count">${count.toLocaleString()} segs</span>
    </div>
    <div class="spent-row metric-row" title="Money spent growing this cell. Not a resale value.">
      <span aria-hidden="true"></span>
      <span class="spent-arrow">↳</span>
      <span><span class="spent-amount">$${spent.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}</span> spent</span>
    </div>
  `;
}

function normalizedEdgeKey(start, end) {
  const [x1, y1] = start;
  const [x2, y2] = end;
  return x1 < x2 || (x1 === x2 && y1 <= y2)
    ? `${x1},${y1}:${x2},${y2}`
    : `${x2},${y2}:${x1},${y1}`;
}

function cellEdgeKeys(x, y) {
  return [
    `${x},${y}:${x + 1},${y}`,
    `${x + 1},${y}:${x + 1},${y + 1}`,
    `${x},${y + 1}:${x + 1},${y + 1}`,
    `${x},${y}:${x},${y + 1}`,
  ];
}

function neighboringCell(cell, direction) {
  const neighbors = [
    [cell[0], cell[1] - 1],
    [cell[0] + 1, cell[1]],
    [cell[0], cell[1] + 1],
    [cell[0] - 1, cell[1]],
  ];
  return neighbors[direction] || cell;
}

function largestClosedCellRegion(records) {
  if (records.length < PRISMATIC_FILL_START_AT) return [];

  const edges = new Set();
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  for (const record of records) {
    const start = [record[0], record[1]];
    const end = recordEnd(start, record[2]);
    edges.add(normalizedEdgeKey(start, end));
    const minX = Math.min(start[0], end[0]);
    const minY = Math.min(start[1], end[1]);
    const adjacentCells = [];

    if (start[1] === end[1]) {
      adjacentCells.push([minX, minY - 1], [minX, minY]);
    } else if (start[0] === end[0]) {
      adjacentCells.push([minX - 1, minY], [minX, minY]);
    }

    for (const cell of adjacentCells) {
      bounds.minX = Math.min(bounds.minX, cell[0]);
      bounds.minY = Math.min(bounds.minY, cell[1]);
      bounds.maxX = Math.max(bounds.maxX, cell[0]);
      bounds.maxY = Math.max(bounds.maxY, cell[1]);
    }
  }

  if (!Number.isFinite(bounds.minX) || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    return [];
  }

  const cellId = (cell) => `${cell[0]},${cell[1]}`;
  const inBounds = (cell) => (
    cell[0] >= bounds.minX &&
    cell[0] <= bounds.maxX &&
    cell[1] >= bounds.minY &&
    cell[1] <= bounds.maxY
  );
  const sharedCellEdge = (cell, direction) => cellEdgeKeys(cell[0], cell[1])[direction];
  const outside = new Set();
  const outsideQueue = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const cell = [x, y];
      const openToOutside =
        (y === bounds.minY && !edges.has(sharedCellEdge(cell, 0))) ||
        (x === bounds.maxX && !edges.has(sharedCellEdge(cell, 1))) ||
        (y === bounds.maxY && !edges.has(sharedCellEdge(cell, 2))) ||
        (x === bounds.minX && !edges.has(sharedCellEdge(cell, 3)));
      if (!openToOutside) continue;

      const id = cellId(cell);
      if (outside.has(id)) continue;
      outside.add(id);
      outsideQueue.push(cell);
    }
  }

  while (outsideQueue.length) {
    const cell = outsideQueue.pop();
    for (let direction = 0; direction < 4; direction += 1) {
      if (edges.has(sharedCellEdge(cell, direction))) continue;
      const next = neighboringCell(cell, direction);
      if (!inBounds(next)) continue;
      const id = cellId(next);
      if (outside.has(id)) continue;
      outside.add(id);
      outsideQueue.push(next);
    }
  }

  const seen = new Set();
  let largestRegion = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const start = [x, y];
      const startId = cellId(start);
      if (outside.has(startId) || seen.has(startId)) continue;

      const region = [];
      const stack = [start];
      seen.add(startId);

      while (stack.length) {
        const cell = stack.pop();
        region.push(cell);
        for (let direction = 0; direction < 4; direction += 1) {
          if (edges.has(sharedCellEdge(cell, direction))) continue;
          const next = neighboringCell(cell, direction);
          if (!inBounds(next)) continue;
          const id = cellId(next);
          if (outside.has(id) || seen.has(id)) continue;
          seen.add(id);
          stack.push(next);
        }
      }

      if (region.length > largestRegion.length) largestRegion = region;
    }
  }

  return largestRegion.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
}

function cellFrameForPoint(point, header, worldScale, offsetX, offsetY) {
  const spacing = Number(header.s ?? 6);
  const [left, top] = pointToCanvas(point, header, worldScale, offsetX, offsetY);
  const cellSize = spacing * worldScale;
  return {
    left,
    top,
    width: cellSize,
    height: cellSize,
    size: cellSize,
    centerX: left + cellSize / 2,
    centerY: top + cellSize / 2,
  };
}

function paintPrismaticRegion(context, frames, index, age) {
  if (!frames.length) return;

  const bounds = {
    left: Math.min(...frames.map((frame) => frame.left)),
    top: Math.min(...frames.map((frame) => frame.top)),
    right: Math.max(...frames.map((frame) => frame.left + frame.width)),
    bottom: Math.max(...frames.map((frame) => frame.top + frame.height)),
  };
  const frame = {
    left: bounds.left,
    top: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
    size: Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top),
    centerX: (bounds.left + bounds.right) / 2,
    centerY: (bounds.top + bounds.bottom) / 2,
  };
  const hueShift = (Math.floor(age / 300) * 47 + index * 31) % 360;
  const angle = -0.55 + ((index % 7) - 3) * 0.11;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const spanX = ux * frame.width * 0.5;
  const spanY = uy * frame.height * 0.5;

  context.save();
  context.beginPath();
  frames.forEach((item) => {
    context.rect(item.left, item.top, item.width, item.height);
  });
  context.clip();

  context.fillStyle = rgbaFromHex('#6f8fff', 0.2);
  context.fillRect(frame.left, frame.top, frame.width, frame.height);

  const prism = context.createLinearGradient(
    frame.centerX - spanX,
    frame.centerY - spanY,
    frame.centerX + spanX,
    frame.centerY + spanY
  );
  [0, 0.14, 0.3, 0.48, 0.66, 0.84, 1].forEach((stop, stopIndex) => {
    const offsets = [0, 32, 88, 150, 210, 274, 332];
    prism.addColorStop(stop, hsla(hueShift + offsets[stopIndex], 100, 78, 0.8));
  });
  context.fillStyle = prism;
  context.fillRect(frame.left, frame.top, frame.width, frame.height);

  const wash = context.createLinearGradient(
    frame.centerX + uy * frame.width * 0.3,
    frame.centerY - ux * frame.height * 0.3,
    frame.centerX - uy * frame.width * 0.3,
    frame.centerY + ux * frame.height * 0.3
  );
  wash.addColorStop(0, rgbaFromHex('#fff8cf', 0.24));
  wash.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  wash.addColorStop(1, rgbaFromHex('#89f4ff', 0.22));
  context.fillStyle = wash;
  context.fillRect(frame.left, frame.top, frame.width, frame.height);

  context.fillStyle = rgbaFromHex('#3a5770', 0.045);
  context.beginPath();
  context.moveTo(frame.left + frame.width, frame.top);
  context.lineTo(frame.left + frame.width, frame.top + frame.height);
  context.lineTo(frame.left, frame.top + frame.height);
  context.closePath();
  context.fill();
  context.restore();
}

function initialGrowthState(cell) {
  const seed = Math.abs(hashString(fqdnForCell(cell) || cellHandle(cell))) >>> 0;
  return {
    header: { v: 1, w: 3000, h: 3000, s: 6, m: 24, seed, mode: 'restart' },
    records: [],
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseGrowthJsonl(jsonl, cell) {
  const text = String(jsonl || '').trim();
  if (!text) return initialGrowthState(cell);

  const [headerLine, ...recordLines] = text.split(/\n+/);
  try {
    const header = JSON.parse(headerLine);
    const records = recordLines
      .map((line) => JSON.parse(line))
      .filter((record) => Array.isArray(record) && record.length >= 3)
      .map((record) => [Number(record[0]), Number(record[1]), Number(record[2])]);
    return { header, records };
  } catch {
    return initialGrowthState(cell);
  }
}

function growthStorageKey(cell) {
  return `${GROWTH_STORAGE_KEY_PREFIX}${fqdnForCell(cell) || cellHandle(cell)}`;
}

function growthStateToJsonl(state) {
  return [
    JSON.stringify(state.header),
    ...state.records.map((record) => JSON.stringify(record)),
  ].join('\n');
}

function persistGrowthState() {
  const cell = localCell ?? cellFromStorage();
  if (!cell || !growthState) return;
  localStorage.setItem(growthStorageKey(cell), growthStateToJsonl(growthState));
}

function recordEnd(start, direction) {
  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const delta = dirs[direction] || [0, 0];
  return [start[0] + delta[0], start[1] + delta[1]];
}

function pointToCanvas(point, header, scale, offsetX, offsetY) {
  const spacing = Number(header.s ?? 6);
  const margin = Number(header.m ?? 24);
  return [
    offsetX + (margin + point[0] * spacing) * scale,
    offsetY + (margin + point[1] * spacing) * scale,
  ];
}

function growthBounds(state) {
  const header = state.header ?? {};
  const worldWidth = Number(header.w ?? 3000);
  const worldHeight = Number(header.h ?? worldWidth);
  const margin = Number(header.m ?? 24);
  const spacing = Number(header.s ?? 6);
  const cols = Math.floor((worldWidth - margin * 2) / spacing) + 1;
  const rows = Math.floor((worldHeight - margin * 2) / spacing) + 1;
  const seedPoint = [Math.floor(cols / 2), Math.floor(rows / 2)];
  let minX = seedPoint[0];
  let maxX = seedPoint[0];
  let minY = seedPoint[1];
  let maxY = seedPoint[1];
  let cursor = seedPoint;

  for (const record of state.records) {
    const start = [record[0], record[1]];
    const end = recordEnd(start, record[2]);
    minX = Math.min(minX, start[0], end[0]);
    maxX = Math.max(maxX, start[0], end[0]);
    minY = Math.min(minY, start[1], end[1]);
    maxY = Math.max(maxY, start[1], end[1]);
    cursor = end;
  }

  return { minX, maxX, minY, maxY, cursor, seedPoint };
}

function resizeCellCanvas() {
  const scale = window.devicePixelRatio || 1;
  const viewport = window.visualViewport;
  const width = Math.max(1, Math.round(viewport?.width ?? window.innerWidth));
  const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
  cellCanvas.width = Math.floor(width * scale);
  cellCanvas.height = Math.floor(height * scale);
  cellCanvas.style.width = `${width}px`;
  cellCanvas.style.height = `${height}px`;
}

function cellCanvasSize() {
  const scale = window.devicePixelRatio || 1;
  return {
    width: cellCanvas.width / scale,
    height: cellCanvas.height / scale,
  };
}

function growthDrawLayout(state, width, height, panX = cellPanState.x, panY = cellPanState.y) {
  const header = state.header ?? {};
  const spacing = Number(header.s ?? 6);
  const margin = Number(header.m ?? 24);
  const bounds = growthBounds(state);
  const paddingPoints = Math.max(8, Math.ceil(Math.sqrt(Math.max(1, state.records.length)) * 1.5));
  const minWorldX = margin + (bounds.minX - paddingPoints) * spacing;
  const maxWorldX = margin + (bounds.maxX + paddingPoints) * spacing;
  const minWorldY = margin + (bounds.minY - paddingPoints) * spacing;
  const maxWorldY = margin + (bounds.maxY + paddingPoints) * spacing;
  const baseWorldScale = 1;
  const worldScale = baseWorldScale * cellZoomState.value;
  const baseOffsetX = (width - (minWorldX + maxWorldX) * worldScale) / 2;
  const baseOffsetY = (height - (minWorldY + maxWorldY) * worldScale) / 2;

  return {
    header,
    spacing,
    bounds,
    worldScale,
    baseOffsetX,
    baseOffsetY,
    offsetX: baseOffsetX + panX,
    offsetY: baseOffsetY + panY,
  };
}

function drawCellCanvas() {
  const context = cellCanvas.getContext('2d');
  const scale = window.devicePixelRatio || 1;
  const { width, height } = cellCanvasSize();
  const state = growthState ?? initialGrowthState(localCell ?? cellFromStorage());
  const { header, spacing, bounds, worldScale, offsetX, offsetY } = growthDrawLayout(
    state,
    width,
    height,
  );

  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = canvasBackground;
  context.fillRect(0, 0, width, height);
  updateAgeDisplay(state.records.length);

  const prismaticRegion = largestClosedCellRegion(state.records);
  if (prismaticRegion.length) {
    const frames = prismaticRegion.map((cell) => cellFrameForPoint(cell, header, worldScale, offsetX, offsetY));
    paintPrismaticRegion(context, frames, 0, state.records.length);
  }

  context.lineCap = 'square';
  context.lineJoin = 'miter';
  context.lineWidth = Math.max(1.2, Number(header.s ?? 6) * worldScale * 0.34);
  context.strokeStyle = canvasLineColor;
  context.shadowColor = rgbaFromHex(canvasLineColor, 0.36);
  context.shadowBlur = growActive ? 12 : 6;
  context.beginPath();

  let cursor = bounds.seedPoint;
  for (const record of state.records) {
    const start = [record[0], record[1]];
    const end = recordEnd(start, record[2]);
    const [x1, y1] = pointToCanvas(start, header, worldScale, offsetX, offsetY);
    const [x2, y2] = pointToCanvas(end, header, worldScale, offsetX, offsetY);
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    cursor = end;
  }
  context.stroke();
  context.shadowBlur = 0;

  const [seedX, seedY] = pointToCanvas(bounds.seedPoint, header, worldScale, offsetX, offsetY);
  context.save();
  context.fillStyle = '#ffffb8';
  context.shadowColor = 'rgba(255, 255, 184, 0.58)';
  context.shadowBlur = 12;
  context.font = `900 ${Math.max(16, Math.min(34, spacing * worldScale * 2.5))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('⧰', seedX, seedY);
  context.restore();

  const [x, y] = pointToCanvas(cursor, header, worldScale, offsetX, offsetY);
  context.fillStyle = 'rgba(255, 255, 184, 0.9)';
  context.beginPath();
  context.arc(x, y, 5, 0, Math.PI * 2);
  context.fill();
}

function setCellZoom(nextZoom, focusX, focusY) {
  const { width, height } = cellCanvasSize();
  const state = growthState ?? initialGrowthState(localCell ?? cellFromStorage());
  const x = focusX ?? width / 2;
  const y = focusY ?? height / 2;
  const currentLayout = growthDrawLayout(state, width, height);
  const nextValue = clamp(nextZoom, cellZoomState.min, cellZoomState.max);
  if (Math.abs(nextValue - cellZoomState.value) < 0.0001) return;

  const worldFocusX = (x - currentLayout.offsetX) / currentLayout.worldScale;
  const worldFocusY = (y - currentLayout.offsetY) / currentLayout.worldScale;
  cellZoomState.value = nextValue;

  const nextLayout = growthDrawLayout(state, width, height, 0, 0);
  cellPanState.x = x - (worldFocusX * nextLayout.worldScale + nextLayout.baseOffsetX);
  cellPanState.y = y - (worldFocusY * nextLayout.worldScale + nextLayout.baseOffsetY);
  drawCellCanvas();
}

function resetCellZoom() {
  const { width, height } = cellCanvasSize();
  setCellZoom(1, width / 2, height / 2);
}

function fitCellView() {
  cellZoomState.value = 1;
  cellPanState.x = 0;
  cellPanState.y = 0;
  drawCellCanvas();
}

async function loadGrowthState() {
  const loadId = ++stateLoadId;
  const cell = localCell ?? cellFromStorage();
  if (!cell) {
    growthState = initialGrowthState(cell);
    drawCellCanvas();
    return;
  }

  if (loadId !== stateLoadId) return;
  growthState = parseGrowthJsonl(localStorage.getItem(growthStorageKey(cell)), cell);
  drawCellCanvas();
}

function startCellCanvas() {
  resizeCellCanvas();
  canvasStartTime = performance.now();
  fitCellView();
  cancelAnimationFrame(canvasAnimationId);
  loadGrowthState();
}

function stopCellCanvas() {
  cancelAnimationFrame(canvasAnimationId);
  canvasAnimationId = 0;
  stopLocalGrow();
}

function displayWallet(nextWallet) {
  wallet = nextWallet;
  updateSubmitState();
}

function generateWallet() {
  const keypair = Ed25519Keypair.generate();
  const nextWallet = {
    address: keypair.getPublicKey().toSuiAddress(),
    secretKey: keypair.getSecretKey(),
    createdAt: new Date().toISOString(),
    keypair,
  };

  persistWallet(nextWallet);
  displayWallet(nextWallet);
  setStatus('');
}

function showNewCellForm() {
  generateWallet();
  nameInput.value = '';
  pendingRegistration = null;
  nameAvailability = { state: 'empty', name: '', fqdn: '' };
  history.replaceState(null, '', '/');
  showView('onboarding');
  showDialogStep('register');
  setStatus('');
  updateSubmitState();
}

function nextGrowthSegment(state) {
  const bounds = growthBounds(state);
  const lastDirection = state.records.at(-1)?.[2] ?? -1;
  const seed = Number(state.header?.seed ?? 1);
  const index = state.records.length + 1;
  let direction = Math.abs(hashString(`${seed}:${index}:${bounds.cursor.join(',')}`)) % 4;
  if (lastDirection >= 0 && direction === (lastDirection + 2) % 4) {
    direction = (direction + 1 + (index % 2)) % 4;
  }
  return [bounds.cursor[0], bounds.cursor[1], direction];
}

function startLocalGrow() {
  const cell = localCell ?? cellFromStorage();
  if (!cell || localGrowTimer) return;

  clearHeartbeatSpendQueue();
  queueHeartbeatSpend(1, VISUAL_SEGMENTS_PER_HEARTBEAT);
  localGrowTimer = window.setInterval(() => {
    if ((heartbeatDisplayValue ?? Number(cell.heartbeats ?? 0)) <= 0) {
      growActive = false;
      updateGrowToggle();
      stopLocalGrow();
      refreshHeartbeatBalance();
      return;
    }

    if (!growthState) growthState = initialGrowthState(cell);
    growthState.records.push(nextGrowthSegment(growthState));
    spendHeartbeatForSegment();
    if (!heartbeatSpendQueue.length) {
      queueHeartbeatSpend(1, VISUAL_SEGMENTS_PER_HEARTBEAT);
    }
    persistGrowthState();
    drawCellCanvas();
  }, 80);
}

function stopLocalGrow() {
  clearInterval(localGrowTimer);
  localGrowTimer = 0;
  clearHeartbeatSpendQueue();
}

function requestGrowStop() {
  stopLocalGrow();
  refreshHeartbeatBalance();
}

function restoreRegisteredCell(cell) {
  persistCell({
    cellId: cell.fqdn,
    name: cell.name,
    fqdn: cell.fqdn,
    owner: wallet.address,
    digest: '',
    network: 'mainnet',
    registeredAt: new Date().toISOString(),
    heartbeats: 50,
  });
  pendingRegistration = null;
  history.replaceState(null, '', '/');
  showView('placeholder');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function showView(name, params = new URLSearchParams(window.location.search)) {
  document.body.classList.toggle('placeholder-active', name === 'placeholder');
  onboardingDialog.classList.toggle('hidden', name !== 'onboarding');
  placeholderView.classList.toggle('hidden', name !== 'placeholder');
  localView.classList.toggle('hidden', name !== 'local');
  successView.classList.toggle('hidden', name !== 'success');
  failView.classList.toggle('hidden', name !== 'fail');

  if (name !== 'onboarding') {
    hideOnboarding();
  }

  if (name === 'placeholder') {
    updatePlaceholderView();
    startCellCanvas();
    startHeartbeatPolling();
  } else {
    stopCellCanvas();
    stopHeartbeatPolling();
  }

  if (name === 'local') {
    const cell = localCell ?? cellFromStorage();
    const owner = cell?.owner || wallet?.address || '';
    const digest = cell?.digest || '';
    const cells = cellsFromStorage();
    document.querySelector('#local-name').textContent = cell?.fqdn || 'Your cell';
    document.querySelector('#local-cell-id').textContent = cell?.cellId || cell?.fqdn || '';
    document.querySelector('#local-address').textContent = owner;
    const link = document.querySelector('#local-digest');
    link.textContent = digest || 'No transaction recorded';
    link.href = digest ? `https://suivision.xyz/txblock/${digest}` : '#';
    document.querySelector('#local-cell-count').textContent = String(Math.max(cells.length, cell ? 1 : 0));
  }

  if (name === 'success') {
    const fqdn = params.get('name') || 'Name registered';
    const owner = params.get('owner') || '';
    const digest = params.get('digest') || '';
    if (fqdn !== 'Name registered' && owner) {
      persistCell({
        cellId: fqdn,
        name: fqdn.replace(/\.cell\.sui$/, ''),
        fqdn,
        owner,
        digest,
        network: 'mainnet',
        registeredAt: new Date().toISOString(),
        heartbeats: 50,
      });
    }
    document.querySelector('#success-name').textContent = fqdn;
    document.querySelector('#success-address').textContent = owner;
    const link = document.querySelector('#success-digest');
    link.textContent = digest;
    link.href = digest ? `https://suivision.xyz/txblock/${digest}` : '#';
  }

  if (name === 'fail') {
    document.querySelector('#fail-message').textContent =
      params.get('error') || 'The registration request failed.';
  }
}

async function continueToPersonality(event) {
  event.preventDefault();

  if (!wallet) {
    setStatus('Wallet not ready yet.', true);
    return;
  }

  const name = normalizeName(nameInput.value);

  if (isSuiAddress(name)) {
    nameInput.value = '';
    setStatus('That is your wallet address. Type the cell name before .cell.sui.', true);
    return;
  }

  if (nameAvailability.state !== 'available' || nameAvailability.name !== name) {
    setStatus('Pick another name.', true);
    return;
  }

  pendingRegistration = { name, fqdn: nameAvailability.fqdn };
  setStatus('');
  showDialogStep('personality');
}

async function importWallet(event) {
  event.preventDefault();

  importSubmitButton.disabled = true;
  importSubmitButton.textContent = 'Loading...';
  setImportStatus('');

  try {
    const nextWallet = walletFromSecretKey(secretKeyFromImport(importPrivateKeyInput.value));
    setImportStatus('Loading browser-local cell...');

    persistWallet(nextWallet);
    displayWallet(nextWallet);
    persistImportedCells(cellsFromImportedWallet(nextWallet, []));

    pendingRegistration = null;
    history.replaceState(null, '', '/');
    hideOnboarding();
    showView('placeholder');
  } catch (error) {
    setImportStatus(error.message || 'Could not import private key.', true);
  } finally {
    importSubmitButton.disabled = false;
    importSubmitButton.textContent = 'Next';
  }
}

async function submitRegistration() {
  if (!wallet) {
    showDialogStep('register');
    setStatus('Generate a browser-local key first.', true);
    return;
  }

  if (!pendingRegistration) {
    showDialogStep('register');
    setStatus('Pick a name first.', true);
    return;
  }

  const { name, fqdn } = pendingRegistration;
  startCellButton.disabled = true;
  startCellButton.textContent = 'Starting...';

  try {
    setStatus('Saving prototype cell...');
    persistCell({
      cellId: fqdn,
      name,
      fqdn,
      owner: wallet.address,
      digest: '',
      network: 'client-only prototype',
      registeredAt: new Date().toISOString(),
      personality: selectedPersonality,
      genomeHash: await digestHex(personalityGenomes[selectedPersonality]),
      heartbeats: 50,
    });
    pendingRegistration = null;
    history.replaceState(null, '', '/');
    hideOnboarding();
    showView('placeholder');
  } catch (error) {
    const params = new URLSearchParams({ error: error.message });
    history.replaceState(null, '', `/fail?${params.toString()}`);
    showView('fail', params);
  } finally {
    startCellButton.disabled = false;
    startCellButton.textContent = 'Start';
  }
}

function scheduleNameCheck() {
  clearTimeout(nameCheckTimer);
  const name = normalizeName(nameInput.value);
  nameInput.value = isSuiAddress(name) ? '' : name;
  pendingRegistration = null;

  if (!name) {
    nameAvailability = { state: 'empty', name: '', fqdn: '' };
    setStatus('');
    updateSubmitState();
    return;
  }

  if (!/^[a-z0-9-]{3,32}$/.test(name) || name.startsWith('-') || name.endsWith('-')) {
    nameAvailability = { state: 'invalid', name, fqdn: '' };
    setStatus('Try a simple name.', true);
    updateSubmitState();
    return;
  }

  nameAvailability = { state: 'checking', name, fqdn: '' };
  setStatus('Checking...');
  updateSubmitState();

  const checkId = ++nameCheckId;
  nameCheckTimer = setTimeout(async () => {
    try {
      const response = await fetch(`/api/name/${encodeURIComponent(name)}`);
      const availability = await response.json();
      if (!response.ok) throw new Error(availability.error || 'Name check failed.');
      if (checkId !== nameCheckId) return;

      if (!availability.available) {
        nameAvailability = { state: 'taken', name, fqdn: availability.fqdn };
        setStatus('Already saved here.', true);
      } else {
        nameAvailability = { state: 'available', name, fqdn: availability.fqdn };
        setStatus('Available.');
      }
    } catch {
      if (checkId !== nameCheckId) return;
      nameAvailability = { state: 'error', name, fqdn: '' };
      setStatus('Try again.', true);
    } finally {
      if (checkId === nameCheckId) updateSubmitState();
    }
  }, 200);
}

async function digestHex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return `0x${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function restoreFromUrl() {
  if (location.pathname === '/success') {
    showView('success');
    return true;
  }

  if (location.pathname === '/fail') {
    showView('fail');
    return true;
  }

  return false;
}

localNewCellButton.addEventListener('click', showNewCellForm);
importOpenButton.addEventListener('click', () => {
  importPrivateKeyInput.value = '';
  setImportStatus('');
  showDialogStep('import');
  importPrivateKeyInput.focus();
});
form.addEventListener('submit', continueToPersonality);
importForm.addEventListener('submit', importWallet);
personalityNextButton.addEventListener('click', () => {
  if (pendingRegistration) {
    showDialogStep('heartbeats');
    return;
  }

  showDialogStep('register');
  setStatus('Pick a name first.', true);
});
startCellButton.addEventListener('click', () => {
  if (pendingRegistration) {
    submitRegistration();
    return;
  }

  hideOnboarding();
  showView('placeholder');
});
growToggleButton.addEventListener('click', () => {
  growActive = !growActive;
  updateGrowToggle();
  if (growActive) {
    startLocalGrow();
  } else {
    requestGrowStop();
  }
  drawCellCanvas();
});
cellCanvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  cellPanState.active = true;
  cellPanState.pointerId = event.pointerId;
  cellPanState.startX = event.clientX;
  cellPanState.startY = event.clientY;
  cellPanState.startPanX = cellPanState.x;
  cellPanState.startPanY = cellPanState.y;
  cellCanvas.classList.add('is-panning');
  cellCanvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});
cellCanvas.addEventListener('pointermove', (event) => {
  if (!cellPanState.active || event.pointerId !== cellPanState.pointerId) return;
  cellPanState.x = cellPanState.startPanX + event.clientX - cellPanState.startX;
  cellPanState.y = cellPanState.startPanY + event.clientY - cellPanState.startY;
  drawCellCanvas();
});
function stopCellPan(event) {
  if (!cellPanState.active || event.pointerId !== cellPanState.pointerId) return;
  cellPanState.active = false;
  cellPanState.pointerId = null;
  cellCanvas.classList.remove('is-panning');
  if (cellCanvas.hasPointerCapture(event.pointerId)) {
    cellCanvas.releasePointerCapture(event.pointerId);
  }
}
cellCanvas.addEventListener('pointerup', stopCellPan);
cellCanvas.addEventListener('pointercancel', stopCellPan);
cellCanvas.addEventListener('wheel', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const rect = cellCanvas.getBoundingClientRect();
  const factor = event.deltaY > 0 ? 0.92 : 1.08;
  setCellZoom(
    cellZoomState.value * factor,
    event.clientX - rect.left,
    event.clientY - rect.top,
  );
}, { passive: false });
window.addEventListener('resize', () => {
  if (!placeholderView.classList.contains('hidden')) {
    resizeCellCanvas();
    fitPlaceholderCellName();
    drawCellCanvas();
  }
});

window.visualViewport?.addEventListener('resize', () => {
  if (!placeholderView.classList.contains('hidden')) {
    resizeCellCanvas();
    fitPlaceholderCellName();
    drawCellCanvas();
  }
});

document.querySelectorAll('.personality-option').forEach((option) => {
  option.addEventListener('click', () => {
    selectedPersonality = option.dataset.personality;
    document.querySelectorAll('.personality-option').forEach((nextOption) => {
      nextOption.classList.toggle('selected', nextOption === option);
    });
  });
});

nameInput.addEventListener('input', () => {
  scheduleNameCheck();
});

updateGrowToggle();
document.documentElement.style.setProperty('--cell-canvas-background', canvasBackground);
document.documentElement.style.setProperty('--cell-line-color', canvasLineColor);

if (!restoreFromUrl()) {
  try {
    const storedWallet = walletFromStorage();
    if (storedWallet) {
      displayWallet(storedWallet);
      localCell = cellFromStorage();

      if (localCell) {
        localStorage.setItem(CELL_STORAGE_KEY, JSON.stringify(localCell));
        showView('placeholder');
      } else {
        showView('onboarding');
        nameInput.value = '';
        showDialogStep('register');
        setStatus('');
      }
    } else {
      showView('onboarding');
      generateWallet();
      showDialogStep('register');
    }
  } catch {
    localStorage.removeItem(WALLET_STORAGE_KEY);
    showView('onboarding');
    generateWallet();
    showDialogStep('register');
  }
}
