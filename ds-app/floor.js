// The Floor — a top-down office room, drawn on canvas, driven entirely by
// bridge data handed in by app.js. No placeholder agents live here: if the
// roster is empty, the chairs are empty.
//
// Layout (36 × 22 tiles):
//   Foundry   x 2..20,  y 2..14    the three desks (row 3) and seats (row 4)
//   Hall      x 22..24, y 2..19    connects Foundry, Skyloft, Workshop, Yard
//   Skyloft   x 26..34, y 2..7     lounge, night windows
//   Workshop  x 26..34, y 11..16   bench, pegboard
//   Yard      x 2..20,  y 17..20   grass, string lights
//
// Seats: planner (4,4) · executor (11,4) · reviewer (18,4)
// Executor doorstep: (12,4). A glass partition at x 13..17 on row 4 forces
// the reviewer to leave the seat, drop to row 5 and come back up at x 12 —
// pathfinding, not teleporting.

export const TILE = 36;
export const COLS = 36;
export const ROWS = 22;
export const WIDTH = COLS * TILE;
export const HEIGHT = ROWS * TILE;

const WALL = 1;
const FLOOR = 0;

export const SEATS = {
  planner: { x: 4, y: 4 },
  executor: { x: 11, y: 4 },
  reviewer: { x: 18, y: 4 },
};

export const DOORSTEPS = {
  planner: { x: 3, y: 4 },
  executor: { x: 12, y: 4 },
  reviewer: { x: 19, y: 4 },
};

const DESKS = {
  planner: [{ x: 3, y: 3 }, { x: 4, y: 3 }],
  executor: [{ x: 10, y: 3 }, { x: 11, y: 3 }],
  reviewer: [{ x: 17, y: 3 }, { x: 18, y: 3 }],
};

const GLASS = [];
for (let x = 13; x <= 17; x++) GLASS.push({ x, y: 4 });

const key = (x, y) => x + "," + y;

const FURNITURE = new Set();
const addBlocked = (cells) => cells.forEach((c) => FURNITURE.add(key(c.x, c.y)));
Object.values(DESKS).forEach(addBlocked);
addBlocked(GLASS);
addBlocked([
  { x: 2, y: 2 }, { x: 20, y: 2 }, { x: 2, y: 14 }, { x: 20, y: 14 }, // foundry plants
  { x: 20, y: 6 },                                                     // water cooler
  { x: 28, y: 2 }, { x: 29, y: 2 }, { x: 30, y: 2 },                   // skyloft sofa back
  { x: 28, y: 5 }, { x: 29, y: 5 }, { x: 30, y: 5 },                   // sofa seat
  { x: 32, y: 5 }, { x: 33, y: 5 },                                    // armchair
  { x: 27, y: 12 }, { x: 28, y: 12 }, { x: 29, y: 12 },                // workshop bench
  { x: 33, y: 15 }, { x: 33, y: 16 },                                  // crates
  { x: 3, y: 18 }, { x: 3, y: 19 }, { x: 18, y: 17 }, { x: 5, y: 20 }, // yard trees
  { x: 14, y: 19 }, { x: 15, y: 19 },                                  // yard bench
]);

const PALETTES = {
  sunset: {
    light: "#ffc28c", base: "#ef914c", dark: "#9a4f1c", glow: "rgba(255,160,92,.30)",
    accent: "#ffdfb8", pants: "#2c2c3a", shoe: "#191923", hair: "#53301d", hairHi: "#8a5330",
    skin: "#f6cda6", skinHi: "#ffe0c2", skinShade: "#d8a57f", eye: "#2a1c14", prop: "#ffb46b",
  },
  ocean: {
    light: "#a7d8ff", base: "#4f9fe0", dark: "#20567f", glow: "rgba(100,181,255,.30)",
    accent: "#d8efff", pants: "#22313f", shoe: "#111a22", hair: "#16212e", hairHi: "#31465c",
    skin: "#e8b68d", skinHi: "#ffd3ad", skinShade: "#c18f69", eye: "#141b23", prop: "#7fc4ff",
  },
  violet: {
    light: "#dcc6ff", base: "#a07bea", dark: "#54348c", glow: "rgba(187,149,255,.30)",
    accent: "#f0e4ff", pants: "#2a2438", shoe: "#161221", hair: "#2b1c3e", hairHi: "#573f74",
    skin: "#f2c8a7", skinHi: "#ffe1c6", skinShade: "#d3a37f", eye: "#22162d", prop: "#c6a4ff",
  },
};

const ZONES = {
  foundry: { x0: 2, y0: 2, x1: 20, y1: 14, floor: "#2c3749", line: "#35435a", label: "FOUNDRY", labelAt: { x: 3, y: 13 } },
  hall: { x0: 22, y0: 2, x1: 24, y1: 19, floor: "#31323e", line: "#3a3b48", label: "HALL", labelAt: { x: 22.1, y: 2.9 } },
  skyloft: { x0: 26, y0: 2, x1: 34, y1: 7, floor: "#3d332c", line: "#473b32", label: "SKYLOFT", labelAt: { x: 27, y: 6.8 } },
  workshop: { x0: 26, y0: 11, x1: 34, y1: 16, floor: "#2b353d", line: "#333f48", label: "WORKSHOP", labelAt: { x: 27, y: 15.8 } },
  yard: { x0: 2, y0: 17, x1: 20, y1: 20, floor: "#2a4a36", line: "#325741", label: "YARD", labelAt: { x: 4, y: 20.2 } },
};

const DOORS = [
  { x: 21, y: 8, axis: "v" },
  { x: 25, y: 4, axis: "v" },
  { x: 25, y: 13, axis: "v" },
  { x: 10, y: 15, axis: "v" },
  { x: 10, y: 16, axis: "v" },
  { x: 21, y: 18, axis: "v" },
];

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// Dust motes in the room light — deterministic, so the room never flickers
// into a different arrangement between frames.
const DUST = Array.from({ length: 46 }, (_, i) => ({
  x: hash(i, 21) * WIDTH,
  y: hash(i, 37) * HEIGHT,
  r: 0.55 + hash(i, 5) * 1.25,
  sp: 2 + hash(i, 9) * 7,
  ph: hash(i, 13) * Math.PI * 2,
}));

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function limb(g, x1, y1, x2, y2, width, color) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function shadeA(hex, alpha) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/* ------------------------------------------------------------------------- */
/* Map + pathfinding                                                         */
/* ------------------------------------------------------------------------- */

export function buildGrid() {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(WALL));
  const carve = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = FLOOR;
  };
  carve(2, 2, 20, 14);
  carve(22, 2, 24, 19);
  carve(26, 2, 34, 7);
  carve(26, 11, 34, 16);
  carve(2, 17, 20, 20);
  DOORS.forEach((d) => { grid[d.y][d.x] = FLOOR; });
  return grid;
}

export const GRID = buildGrid();

export function isPassable(grid, x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
  if (grid[y][x] !== FLOOR) return false;
  return !FURNITURE.has(key(x, y));
}

export function findPath(grid, from, to) {
  if (!isPassable(grid, from.x, from.y) || !isPassable(grid, to.x, to.y)) return [];
  const start = key(from.x, from.y);
  const goal = key(to.x, to.y);
  if (start === goal) return [];
  const open = [{ x: from.x, y: from.y, g: 0, f: Math.abs(from.x - to.x) + Math.abs(from.y - to.y) }];
  const came = new Map();
  const gScore = new Map([[start, 0]]);
  const closed = new Set();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const cur = open.splice(best, 1)[0];
    const ck = key(cur.x, cur.y);
    if (ck === goal) {
      const path = [];
      let node = ck;
      while (node && node !== start) {
        const [nx, ny] = node.split(",").map(Number);
        path.unshift({ x: nx, y: ny });
        node = came.get(node);
      }
      return path;
    }
    if (closed.has(ck)) continue;
    closed.add(ck);
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!isPassable(grid, nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const g = (gScore.get(ck) || 0) + 1;
      if (g < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, g);
        came.set(nk, ck);
        open.push({ x: nx, y: ny, g, f: g + Math.abs(nx - to.x) + Math.abs(ny - to.y) });
      }
    }
  }
  return [];
}

/* ------------------------------------------------------------------------- */
/* Floor                                                                     */
/* ------------------------------------------------------------------------- */

export function createFloor(canvas, { onSelect } = {}) {
  const ctx = canvas.getContext("2d");
  const minimap = document.getElementById("minimap");
  const mctx = minimap ? minimap.getContext("2d") : null;
  const grid = GRID;

  const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const staticLayer = document.createElement("canvas");
  staticLayer.width = WIDTH * dpr;
  staticLayer.height = HEIGHT * dpr;
  const sctx = staticLayer.getContext("2d");
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawStatic(sctx);

  const state = {
    chars: {},
    order: ["planner", "executor", "reviewer"],
    crew: null,
    phase: "idle",
    selected: null,
    seated: 0,
    started: null,
    bubbles: [],
  };

  let raf = 0;
  let last = 0;
  let clock = 0;
  let speed = 5.2; // tiles / second; the review walk is 8 cells ≈ 1.5 s
  const listeners = { select: onSelect || (() => {}) };

  function makeChar(role, rosterEntry) {
    const seat = SEATS[role];
    const e = rosterEntry || {};
    return {
      role,
      palette: e.palette || ({ planner: "sunset", executor: "ocean", reviewer: "violet" })[role],
      name: e.name || null,
      lane: e.lane || null,
      model: e.model || null,
      family: e.family || null,
      seat: { ...seat },
      cell: { ...seat },
      pos: { x: seat.x, y: seat.y },
      path: [],
      pathIndex: 0,
      moving: false,
      phase: "idle", // idle | working | walking | reviewing | waiting | done
      intent: null,
      walk: [],
      arrival: null,
      bubble: null,
      bubbleUntil: 0,
      sinceSeated: 0,
      facing: 1,
      gait: 0,
      seed: Math.random() * Math.PI * 2,
      lastStep: 0,
    };
  }

  function setRoster(roster = [], { crew = null } = {}) {
    state.crew = crew || state.crew;
    const byRole = {};
    (roster || []).forEach((r) => { if (r && r.role) byRole[r.role] = r; });
    for (const role of state.order) {
      const incoming = byRole[role];
      if (!state.chars[role]) {
        state.chars[role] = makeChar(role, incoming);
      } else if (incoming) {
        const c = state.chars[role];
        c.name = incoming.name || null;
        c.lane = incoming.lane || null;
        c.model = incoming.model || null;
        c.family = incoming.family || null;
        c.palette = incoming.palette || c.palette;
      }
    }
    state.seated = state.order.filter((r) => state.chars[r] && state.chars[r].name).length;
    if (state.selected && !state.chars[state.selected]) state.selected = null;
    drawFrame(clock);
  }

  function clearRoster() {
    state.chars = {};
    state.seated = 0;
    state.crew = null;
    state.phase = "idle";
    state.selected = null;
    state.bubbles = [];
    drawFrame(clock);
  }

  function updateAgent(role, patch) {
    const c = state.chars[role];
    if (!c) return;
    Object.assign(c, patch);
  }

  function setStatus(role, phase) {
    const c = state.chars[role];
    if (!c || c.moving) return;
    c.phase = phase;
  }

  function startWork(role) {
    const c = state.chars[role];
    if (!c) return;
    if (c.moving) { c.intent = { type: "work" }; return; }
    c.phase = c.cell.x === c.seat.x && c.cell.y === c.seat.y ? "working" : "walking";
  }

  function finishWork(role) {
    const c = state.chars[role];
    if (!c || c.moving) return;
    if (c.phase === "working") c.phase = "done";
  }

  function walkTo(role, dest, opts = {}) {
    const c = state.chars[role];
    if (!c) return Promise.resolve(false);
    const from = { ...c.cell };
    const path = findPath(grid, from, dest);
    if (!path.length) {
      if (from.x === dest.x && from.y === dest.y) {
        c.phase = opts.then || c.phase;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }
    c.path = path;
    c.pathIndex = 0;
    c.moving = true;
    c.phase = "walking";
    c.intent = opts.then ? { type: "phase", value: opts.then } : null;
    c.arrival = null;
    return new Promise((resolve) => {
      c.arrival = (ok) => {
        c.arrival = null;
        if (opts.then) c.phase = opts.then;
        resolve(ok);
      };
    });
  }

  /** Reviewer leaves the desk, walks the hall/row-5 detour and reviews at the executor's doorway. */
  function reviewWalk() {
    const c = state.chars.reviewer;
    const dest = DOORSTEPS.executor;
    if (!c) return Promise.resolve(false);
    state.phase = "reviewer";
    if (c.cell.x === dest.x && c.cell.y === dest.y) {
      c.phase = "reviewing";
      return Promise.resolve(true);
    }
    return walkTo("reviewer", dest, { then: "reviewing" });
  }

  function returnAll() {
    state.phase = "settling";
    const jobs = [];
    for (const role of state.order) {
      const c = state.chars[role];
      if (!c) continue;
      if (c.cell.x === c.seat.x && c.cell.y === c.seat.y) {
        c.moving = false;
        c.path = [];
        c.phase = "idle";
        continue;
      }
      jobs.push(walkTo(role, c.seat, { then: "idle" }));
    }
    return Promise.all(jobs).then(() => {
      state.phase = "idle";
      drawFrame(clock);
    });
  }

  /** Put everyone back at their desks immediately (start of a run, crew switch). */
  function resetToSeats() {
    state.phase = "idle";
    for (const role of state.order) {
      const c = state.chars[role];
      if (!c) continue;
      c.moving = false;
      c.path = [];
      c.pathIndex = 0;
      c.cell = { ...c.seat };
      c.pos = { x: c.seat.x, y: c.seat.y };
      c.phase = "idle";
      c.intent = null;
      c.walk = [];
      c.bubble = null;
      c.bubbleUntil = 0;
    }
    state.bubbles = [];
    drawFrame(clock);
  }

  function bubble(role, text, { kind = "info", ttl = 9000 } = {}) {
    if (!state.chars[role] || !text) return;
    const b = { role, text: String(text), kind, at: Date.now(), until: Date.now() + ttl };
    state.chars[role].bubble = b;
    state.chars[role].bubbleUntil = b.until;
    state.bubbles = state.bubbles.filter((x) => x.role !== role);
    state.bubbles.push(b);
  }

  function clearBubbles() {
    state.bubbles = [];
    for (const role of state.order) {
      if (state.chars[role]) {
        state.chars[role].bubble = null;
        state.chars[role].bubbleUntil = 0;
      }
    }
  }

  function select(role) {
    state.selected = state.selected === role ? null : role;
    listeners.select(state.selected);
    drawFrame(clock);
  }

  function setSelected(role) {
    state.selected = role || null;
    listeners.select(state.selected);
    drawFrame(clock);
  }

  function step(dt, now) {
    for (const role of state.order) {
      const c = state.chars[role];
      if (!c) continue;
      if (c.moving) {
        const target = c.path[c.pathIndex];
        if (!target) {
          c.moving = false;
          if (c.arrival) c.arrival(true);
          continue;
        }
        const tx = target.x;
        const ty = target.y;
        const dx = tx - c.pos.x;
        const dy = ty - c.pos.y;
        const dist = Math.hypot(dx, dy);
        const stepLen = speed * dt;
        if (Math.abs(dx) > 0.02) c.facing = dx > 0 ? 1 : -1;
        c.gait += stepLen;
        if (dist <= stepLen) {
          c.pos.x = tx;
          c.pos.y = ty;
          c.cell = { x: tx, y: ty };
          c.walk.push({ x: tx, y: ty });
          if (c.walk.length > 240) c.walk.shift();
          c.pathIndex += 1;
          if (c.pathIndex >= c.path.length) {
            c.moving = false;
            c.path = [];
            if (c.arrival) {
              const done = c.arrival;
              c.arrival = null;
              done(true);
            }
          }
        } else {
          c.pos.x += (dx / dist) * stepLen;
          c.pos.y += (dy / dist) * stepLen;
        }
      }
      if (c.bubble && now > c.bubbleUntil) {
        c.bubble = null;
        state.bubbles = state.bubbles.filter((b) => b.role !== role);
      }
    }
  }

  /* ── drawing ───────────────────────────────────────────────────────────── */

  function drawStatic(g) {
    // backdrop
    g.fillStyle = "#0a0e15";
    g.fillRect(0, 0, WIDTH, HEIGHT);

    // floors — each zone gets a material, not a flat fill
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] !== FLOOR) continue;
        const zone = zoneAt(x, y);
        const zname = zone ? zone.name : "foundry";
        const base = zone ? zone.floor : "#222a38";
        const px = x * TILE;
        const py = y * TILE;
        const n = hash(x, y);
        g.fillStyle = shade(base, (n - 0.5) * 9);
        g.fillRect(px, py, TILE, TILE);

        if (zname === "foundry" || zname === "workshop") {
          // poured-concrete slabs: saw cuts and a faint aggregate speckle
          g.strokeStyle = "rgba(0,0,0,.15)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px, py + TILE - 0.5);
          g.lineTo(px + TILE, py + TILE - 0.5);
          if ((x + y) % 2 === 0) {
            g.moveTo(px + TILE - 0.5, py);
            g.lineTo(px + TILE - 0.5, py + TILE);
          }
          g.stroke();
          if (n > 0.82) {
            g.fillStyle = "rgba(255,255,255,.02)";
            g.fillRect(px + 5 + n * 20, py + 6 + hash(y, x) * 20, 2, 2);
          }
          if (zname === "foundry" && hash(x + 7, y + 3) > 0.9) {
            g.strokeStyle = "rgba(120,160,220,.05)";
            g.beginPath();
            g.moveTo(px + 8, py + 14);
            g.lineTo(px + 18, py + 24);
            g.stroke();
          }
        } else if (zname === "skyloft") {
          // warm oak planks
          g.fillStyle = "rgba(255,205,150,.025)";
          g.fillRect(px, py, TILE, TILE);
          g.strokeStyle = "rgba(0,0,0,.14)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px, py + TILE - 0.5);
          g.lineTo(px + TILE, py + TILE - 0.5);
          g.moveTo(px + (y % 2 ? 9 : 25) + 0.5, py);
          g.lineTo(px + (y % 2 ? 9 : 25) + 0.5, py + TILE);
          g.stroke();
          g.strokeStyle = "rgba(255,220,180,.03)";
          g.beginPath();
          g.moveTo(px + 4, py + 7 + (n * 10));
          g.lineTo(px + 28, py + 8 + (n * 10));
          g.stroke();
        } else if (zname === "hall") {
          g.fillStyle = "rgba(255,255,255,.012)";
          g.fillRect(px, py, TILE, TILE);
        } else if (zname === "yard") {
          // mown stripes
          g.fillStyle = (y % 2 ? "rgba(150,220,170,.026)" : "rgba(0,0,0,.03)");
          g.fillRect(px, py, TILE, TILE);
        }
      }
    }

    // a soft specular sweep across the foundry floor
    const sheen = g.createLinearGradient(2 * TILE, 2 * TILE, 20 * TILE, 15 * TILE);
    sheen.addColorStop(0, "rgba(150,195,255,.045)");
    sheen.addColorStop(0.45, "rgba(150,195,255,.012)");
    sheen.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sheen;
    g.fillRect(2 * TILE, 2 * TILE, 19 * TILE, 13 * TILE);

    // cool moonlight spilling from the skyloft glass
    const moon = g.createRadialGradient(30 * TILE, 2.2 * TILE, 10, 30 * TILE, 2.2 * TILE, 8 * TILE);
    moon.addColorStop(0, "rgba(150,200,255,.10)");
    moon.addColorStop(1, "rgba(150,200,255,0)");
    g.fillStyle = moon;
    g.fillRect(24 * TILE, 1 * TILE, 11 * TILE, 9 * TILE);

    // yard grass speckle + stone path
    for (let i = 0; i < 420; i++) {
      const x = 2 + hash(i, 3) * 18;
      const y = 17 + hash(i, 7) * 3.7;
      if (!isPassable(grid, Math.floor(x), Math.floor(y)) && !inYard(x, y)) continue;
      g.fillStyle = `rgba(120,190,140,${0.05 + hash(i, 11) * 0.08})`;
      g.fillRect(x * TILE, y * TILE, 2, 2);
    }
    g.fillStyle = "rgba(90,80,64,.30)";
    g.fillRect(10 * TILE + 6, 16 * TILE, TILE - 12, 4.6 * TILE);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = "rgba(150,138,112,.20)";
      g.fillRect(10 * TILE + 9 + (i % 2 ? 4 : 0), 16.2 * TILE + i * 15, 12, 6);
    }

    // hall runner — a woven runner with fringe, not a slab of colour
    const rx = 22 * TILE + 14;
    const ry = 2 * TILE + 14;
    const rw = 3 * TILE - 28;
    const rh = 17 * TILE - 28;
    g.fillStyle = "rgba(34,50,70,.92)";
    rr(g, rx, ry, rw, rh, 3);
    g.fill();
    g.strokeStyle = "rgba(120,165,210,.26)";
    g.lineWidth = 1.2;
    rr(g, rx + 3, ry + 3, rw - 6, rh - 6, 2);
    g.stroke();
    g.strokeStyle = "rgba(255,205,155,.14)";
    g.lineWidth = 1;
    rr(g, rx + 7, ry + 7, rw - 14, rh - 14, 2);
    g.stroke();
    // woven field
    for (let i = 0; i < 26; i++) {
      const yy = ry + 14 + i * ((rh - 28) / 26);
      g.fillStyle = i % 4 === 0 ? "rgba(255,205,155,.10)" : "rgba(130,175,220,.055)";
      g.fillRect(rx + 11, yy, rw - 22, 1.3);
    }
    // diamond medallions down the centre
    for (let i = 0; i < 5; i++) {
      const cy = ry + 58 + i * ((rh - 116) / 4);
      g.strokeStyle = "rgba(160,200,240,.14)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(rx + rw / 2, cy - 12);
      g.lineTo(rx + rw / 2 + 12, cy);
      g.lineTo(rx + rw / 2, cy + 12);
      g.lineTo(rx + rw / 2 - 12, cy);
      g.closePath();
      g.stroke();
      g.fillStyle = "rgba(255,190,130,.14)";
      g.beginPath();
      g.arc(rx + rw / 2, cy, 2.4, 0, Math.PI * 2);
      g.fill();
    }
    // fringe
    g.strokeStyle = "rgba(170,200,230,.18)";
    g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const fx = rx + 5 + i * ((rw - 10) / 8);
      g.beginPath();
      g.moveTo(fx, ry + rh);
      g.lineTo(fx, ry + rh + 4);
      g.moveTo(fx, ry);
      g.lineTo(fx, ry - 4);
      g.stroke();
    }

    // warm ceiling washes — architectural downlights, so the floor reads at night
    for (const [lx, ly, rad, a] of [
      [7, 5.4, 150, 0.05], [7, 10.6, 170, 0.055], [14.5, 7, 150, 0.045], [14.5, 12, 160, 0.05],
      [23, 7, 100, 0.045], [23, 15, 100, 0.04], [30, 4.4, 130, 0.05], [30, 13.5, 120, 0.045],
    ]) {
      const cx = lx * TILE;
      const cy = ly * TILE;
      const wash = g.createRadialGradient(cx, cy, 4, cx, cy, rad);
      wash.addColorStop(0, `rgba(255,224,180,${a})`);
      wash.addColorStop(0.6, `rgba(210,225,255,${a * 0.45})`);
      wash.addColorStop(1, "rgba(180,210,255,0)");
      g.fillStyle = wash;
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }

    // foundry rug under the desks
    g.save();
    g.fillStyle = "rgba(46,60,86,.55)";
    rr(g, 3 * TILE - 2, 4 * TILE + 4, 17 * TILE + 4, 2.4 * TILE, 10);
    g.fill();
    g.strokeStyle = "rgba(120,150,200,.10)";
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();

    // skyloft rug
    g.fillStyle = "rgba(90,64,52,.35)";
    rr(g, 27 * TILE, 3 * TILE + 4, 6 * TILE, 3 * TILE, 12);
    g.fill();

    // workshop floor hazard strip
    g.strokeStyle = "rgba(255,190,90,.10)";
    g.lineWidth = 2;
    g.setLineDash([12, 10]);
    g.strokeRect(26.2 * TILE, 11.2 * TILE, 8.6 * TILE, 5.6 * TILE);
    g.setLineDash([]);

    // walls — deep plaster with a lit cap, panel seams and a baseboard
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] !== WALL) continue;
        const px = x * TILE;
        const py = y * TILE;
        const wall = g.createLinearGradient(px, py, px, py + TILE);
        wall.addColorStop(0, "#1a2231");
        wall.addColorStop(0.45, "#131a26");
        wall.addColorStop(1, "#0e131c");
        g.fillStyle = wall;
        g.fillRect(px, py, TILE, TILE);
        g.fillStyle = "rgba(255,255,255,.055)";
        g.fillRect(px, py, TILE, 2.4);
        g.fillStyle = "rgba(0,0,0,.22)";
        g.fillRect(px, py + 2.4, TILE, 1);
        if (x % 2 === 0) {
          g.strokeStyle = "rgba(255,255,255,.018)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px + 0.5, py + 6);
          g.lineTo(px + 0.5, py + TILE - 6);
          g.stroke();
        }
        // baseboard where the wall meets a floor tile below
        if (y + 1 < ROWS && grid[y + 1][x] === FLOOR) {
          g.fillStyle = "#222c3c";
          g.fillRect(px, py + TILE - 6, TILE, 4);
          g.fillStyle = "rgba(255,255,255,.06)";
          g.fillRect(px, py + TILE - 6, TILE, 1);
          g.fillStyle = "rgba(0,0,0,.30)";
          g.fillRect(px, py + TILE - 2, TILE, 2);
        }
        // and along a vertical wall face (floor to the right)
        if (x + 1 < COLS && grid[y][x + 1] === FLOOR) {
          g.fillStyle = "#222c3c";
          g.fillRect(px + TILE - 5, py, 4, TILE);
          g.fillStyle = "rgba(255,255,255,.05)";
          g.fillRect(px + TILE - 5, py, 1, TILE);
        }
      }
    }

    // wall-mounted switch plates and a small exit sign give the shell scale
    for (const [wx, wy] of [[21, 3], [25, 8], [25, 15], [2, 16]]) {
      g.fillStyle = "#2a3547";
      rr(g, wx * TILE + 13, wy * TILE + 16, 10, 14, 2);
      g.fill();
      g.fillStyle = "#ffcb6b";
      g.fillRect(wx * TILE + 17, wy * TILE + 19, 2, 3);
    }
    g.fillStyle = "#173a2c";
    rr(g, 33.4 * TILE, 10 * TILE + 12, 24, 12, 2);
    g.fill();
    g.fillStyle = "#6fe3ab";
    g.font = "700 6px ui-monospace, monospace";
    g.fillText("EXIT", 33.8 * TILE, 10 * TILE + 20);

    // wall edge shadows onto the floor
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] !== FLOOR) continue;
        if (y > 0 && grid[y - 1][x] === WALL) {
          const grad = g.createLinearGradient(0, y * TILE, 0, y * TILE + 10);
          grad.addColorStop(0, "rgba(0,0,0,.28)");
          grad.addColorStop(1, "rgba(0,0,0,0)");
          g.fillStyle = grad;
          g.fillRect(x * TILE, y * TILE, TILE, 10);
        }
      }
    }

    // doors: warm thresholds
    for (const d of DOORS) {
      const px = d.x * TILE;
      const py = d.y * TILE;
      g.fillStyle = "rgba(255,190,120,.10)";
      g.fillRect(px, py, TILE, TILE);
      g.strokeStyle = "rgba(255,200,140,.28)";
      g.lineWidth = 2;
      g.beginPath();
      if (d.axis === "v") {
        g.moveTo(px + 2, py + 4);
        g.lineTo(px + 2, py + TILE - 4);
        g.moveTo(px + TILE - 2, py + 4);
        g.lineTo(px + TILE - 2, py + TILE - 4);
      } else {
        g.moveTo(px + 4, py + 2);
        g.lineTo(px + TILE - 4, py + 2);
      }
      g.stroke();
    }

    // zone labels
    g.textBaseline = "top";
    for (const [name, zone] of Object.entries(ZONES)) {
      g.save();
      g.font = "700 11px ui-monospace, monospace";
      g.fillStyle = "rgba(255,255,255,.10)";
      g.fillText(spaced(name), zone.labelAt.x * TILE, zone.labelAt.y * TILE);
      g.restore();
    }

    // whiteboard on the foundry's north wall
    drawWhiteboard(g, 3 * TILE, 1 * TILE + 3, 5.6 * TILE, TILE - 6);

    // framed prints on the structural walls, so the shell has a story
    drawWallArt(g);

    // plants
    [[2, 2], [20, 2], [2, 14], [20, 14], [33, 2], [33, 17]].forEach(([x, y]) => drawPlant(g, x, y));

    // water cooler
    drawCooler(g, 20, 6);

    // desks
    drawDesk(g, "planner", 3 * TILE, 3 * TILE);
    drawDesk(g, "executor", 10 * TILE, 3 * TILE);
    drawDesk(g, "reviewer", 17 * TILE, 3 * TILE);

    // chairs (behind characters)
    for (const role of ["planner", "executor", "reviewer"]) {
      const s = SEATS[role];
      drawChair(g, s.x * TILE, s.y * TILE + 4);
    }

    // the foundry commons: lounge, meeting table, coffee bar
    drawCommons(g);

    // glass partition
    drawGlass(g);

    // skyloft
    drawSkyloft(g);

    // workshop
    drawWorkshop(g);

    // yard
    drawYard(g);

    // hall sconces
    for (const y of [5, 11, 16]) drawSconce(g, 21, y);

    // hall furniture: console, bench, plants, mail cart
    drawHall(g);

    // cinematic vignette: darker corners, a cool top light, warm floor bounce
    const vig = g.createRadialGradient(WIDTH * 0.46, HEIGHT * 0.38, HEIGHT * 0.3, WIDTH / 2, HEIGHT / 2, WIDTH * 0.74);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(0.74, "rgba(0,0,0,.14)");
    vig.addColorStop(1, "rgba(0,0,0,.5)");
    g.fillStyle = vig;
    g.fillRect(0, 0, WIDTH, HEIGHT);

    const topLight = g.createLinearGradient(0, 0, 0, HEIGHT * 0.4);
    topLight.addColorStop(0, "rgba(150,195,255,.055)");
    topLight.addColorStop(1, "rgba(150,195,255,0)");
    g.fillStyle = topLight;
    g.fillRect(0, 0, WIDTH, HEIGHT * 0.4);

    const floorBounce = g.createLinearGradient(0, HEIGHT * 0.62, 0, HEIGHT);
    floorBounce.addColorStop(0, "rgba(255,170,100,0)");
    floorBounce.addColorStop(1, "rgba(255,170,100,.035)");
    g.fillStyle = floorBounce;
    g.fillRect(0, HEIGHT * 0.62, WIDTH, HEIGHT * 0.38);

    // film grain, baked once so the room has texture at every zoom
    const grain = document.createElement("canvas");
    grain.width = 96;
    grain.height = 96;
    const gx = grain.getContext("2d");
    const img = gx.createImageData(96, 96);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(hash(i, 3) * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 10;
    }
    gx.putImageData(img, 0, 0);
    const pattern = g.createPattern(grain, "repeat");
    if (pattern) {
      g.fillStyle = pattern;
      g.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // inner frame shadow, so the room sits inside its bezel
    const frame = g.createLinearGradient(0, 0, 0, 26);
    frame.addColorStop(0, "rgba(0,0,0,.45)");
    frame.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = frame;
    g.fillRect(0, 0, WIDTH, 26);
    g.fillStyle = "rgba(0,0,0,.22)";
    g.fillRect(0, 0, 8, HEIGHT);
    g.fillRect(WIDTH - 8, 0, 8, HEIGHT);
    g.fillRect(0, HEIGHT - 8, WIDTH, 8);
  }

  function drawWhiteboard(g, x, y, w, h) {
    g.fillStyle = "rgba(0,0,0,.30)";
    rr(g, x + 2, y + 3, w, h, 2);
    g.fill();
    const board = g.createLinearGradient(x, y, x + w, y + h);
    board.addColorStop(0, "#e2eaf3");
    board.addColorStop(1, "#cdd9e7");
    g.fillStyle = board;
    rr(g, x, y, w, h, 2);
    g.fill();
    g.strokeStyle = "rgba(120,140,165,.55)";
    g.lineWidth = 1;
    rr(g, x + 0.5, y + 0.5, w - 1, h - 1, 2);
    g.stroke();
    g.fillStyle = "#9fb0c4";
    g.fillRect(x + 4, y + h - 3, w - 8, 1.4);
    g.font = "700 6px ui-monospace, monospace";
    g.fillStyle = "#43566e";
    g.fillText("PLAN", x + 8, y + 11);
    g.fillText("WORK", x + 44, y + 11);
    g.fillText("REVIEW", x + 88, y + 11);
    g.strokeStyle = "#8ea3bb";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + 34, y + 9);
    g.lineTo(x + 40, y + 9);
    g.lineTo(x + 37, y + 7);
    g.moveTo(x + 78, y + 9);
    g.lineTo(x + 84, y + 9);
    g.lineTo(x + 81, y + 7);
    g.stroke();
    // scribbled boxes and arrows
    g.strokeStyle = "rgba(80,105,135,.45)";
    g.lineWidth = 0.8;
    g.strokeRect(x + 8, y + 15, 22, 8);
    g.strokeRect(x + 44, y + 15, 24, 8);
    g.strokeRect(x + 88, y + 15, 26, 8);
    g.beginPath();
    g.moveTo(x + 30, y + 19);
    g.lineTo(x + 44, y + 19);
    g.moveTo(x + 68, y + 19);
    g.lineTo(x + 88, y + 19);
    g.stroke();
    g.fillStyle = "rgba(95,120,150,.40)";
    for (let i = 0; i < 4; i++) g.fillRect(x + 9, y + 27 + i * 3, 16 + (i % 2) * 8, 0.7);
    // sticky notes
    const notes = [["#ffd784", 48, 26], ["#a8e6c1", 63, 26], ["#f6b0c2", 108, 26], ["#b7d7ff", 17, 34]];
    for (const [col, nx, ny] of notes) {
      g.save();
      g.translate(x + nx, y + ny);
      g.rotate((hash(nx, ny) - 0.5) * 0.18);
      g.fillStyle = "rgba(0,0,0,.18)";
      g.fillRect(1, 1.5, 8, 8);
      g.fillStyle = col;
      g.fillRect(0, 0, 8, 8);
      g.fillStyle = "rgba(60,60,60,.35)";
      g.fillRect(1.4, 3, 5.2, 0.7);
      g.fillRect(1.4, 5, 3.8, 0.7);
      g.restore();
    }
    g.fillStyle = "#c8553d";
    g.beginPath();
    g.arc(x + 74, y + 34, 3.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#3f6b8f";
    g.beginPath();
    g.arc(x + 78, y + 36, 2.6, 0, Math.PI * 2);
    g.fill();
  }

  function drawPlant(g, tx, ty) {
    const x = tx * TILE + TILE / 2;
    const y = ty * TILE + TILE / 2;
    g.fillStyle = "rgba(0,0,0,.30)";
    g.beginPath();
    g.ellipse(x, y + 13, 12, 4, 0, 0, Math.PI * 2);
    g.fill();
    // pot
    const pot = g.createLinearGradient(x - 9, y, x + 9, y + 14);
    pot.addColorStop(0, "#5a4331");
    pot.addColorStop(1, "#33251c");
    g.fillStyle = pot;
    g.beginPath();
    g.moveTo(x - 9, y + 2);
    g.lineTo(x + 9, y + 2);
    g.lineTo(x + 7, y + 14);
    g.quadraticCurveTo(x, y + 16, x - 7, y + 14);
    g.closePath();
    g.fill();
    g.fillStyle = "#6b5039";
    rr(g, x - 10, y + 0.6, 20, 3.6, 1.8);
    g.fill();
    g.fillStyle = "#2a1f18";
    g.beginPath();
    g.ellipse(x, y + 3, 8, 2.2, 0, 0, Math.PI * 2);
    g.fill();
    // layered leaves
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.42;
      const len = 15 + (i % 3) * 3;
      const lx = x + Math.cos(a) * len * 0.55;
      const ly = y - 4 + Math.sin(a) * len * 0.55;
      g.save();
      g.translate(lx, ly);
      g.rotate(a + Math.PI / 2);
      const leaf = g.createLinearGradient(0, -8, 0, 6);
      leaf.addColorStop(0, i % 2 ? "#4a9c6a" : "#3c8557");
      leaf.addColorStop(1, "#265c3c");
      g.fillStyle = leaf;
      g.beginPath();
      g.ellipse(0, 0, 4.6 + (i % 2), 8.4, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(170,230,190,.25)";
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(0, 6.4);
      g.stroke();
      g.restore();
    }
    g.fillStyle = "#5bb37c";
    g.beginPath();
    g.ellipse(x - 1, y - 13, 4, 7, -0.25, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.08)";
    g.beginPath();
    g.ellipse(x - 2.4, y - 15, 1.4, 3.6, -0.3, 0, Math.PI * 2);
    g.fill();
  }

  function drawCooler(g, tx, ty) {
    const x = tx * TILE + 7;
    const y = ty * TILE + 2;
    g.fillStyle = "rgba(0,0,0,.30)";
    g.beginPath();
    g.ellipse(x + 9, y + 30, 11, 3.6, 0, 0, Math.PI * 2);
    g.fill();
    // pedestal
    const stand = g.createLinearGradient(x, y + 14, x + 20, y + 30);
    stand.addColorStop(0, "#46566d");
    stand.addColorStop(1, "#2b3647");
    g.fillStyle = stand;
    rr(g, x, y + 14, 20, 17, 3);
    g.fill();
    g.fillStyle = "rgba(0,0,0,.18)";
    g.fillRect(x + 2, y + 22, 16, 1);
    g.fillStyle = "#8fb6d6";
    g.fillRect(x + 7, y + 24, 6, 2.4);
    // bottle + water
    g.fillStyle = "rgba(180,220,250,.16)";
    rr(g, x + 2, y, 16, 15, 5);
    g.fill();
    const water = g.createLinearGradient(x + 3, y + 2, x + 17, y + 14);
    water.addColorStop(0, "rgba(110,190,255,.55)");
    water.addColorStop(1, "rgba(60,130,205,.35)");
    g.fillStyle = water;
    rr(g, x + 3.4, y + 2.6, 13.2, 11.4, 4);
    g.fill();
    g.strokeStyle = "rgba(210,240,255,.35)";
    g.lineWidth = 0.8;
    rr(g, x + 2, y, 16, 15, 5);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,.34)";
    rr(g, x + 5, y + 3, 2.4, 8, 1.2);
    g.fill();
    for (let i = 0; i < 3; i++) {
      g.fillStyle = "rgba(255,255,255,.28)";
      g.beginPath();
      g.arc(x + 8 + i * 3, y + 10 - (i % 2) * 3, 0.8, 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawDesk(g, role, x, y) {
    const pal = PALETTES[({ planner: "sunset", executor: "ocean", reviewer: "violet" })[role]];
    const w = TILE * 2;
    const h = TILE;
    const top = y + 4;
    const cx = x + w / 2;

    // pool of light from the monitor, onto the wall and the desk
    const pool = g.createRadialGradient(cx, top + 2, 3, cx, top + 4, 56);
    pool.addColorStop(0, shadeA(pal.light, 0.13));
    pool.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = pool;
    g.fillRect(cx - 58, top - 28, 116, 60);

    // shadow + legs
    g.fillStyle = "rgba(0,0,0,.32)";
    rr(g, x + 2, top + h - 7, w - 4, 8, 4);
    g.fill();
    g.fillStyle = "#2a2119";
    g.fillRect(x + 6, top + 18, 4, h - 15);
    g.fillRect(x + w - 10, top + 18, 4, h - 15);
    g.fillStyle = "rgba(0,0,0,.28)";
    g.fillRect(x + 6, top + h - 4, 4, 4);
    g.fillRect(x + w - 10, top + h - 4, 4, 4);

    // top
    const wood = g.createLinearGradient(x, top, x, top + 20);
    wood.addColorStop(0, "#5a4431");
    wood.addColorStop(0.5, "#483423");
    wood.addColorStop(1, "#33251b");
    g.fillStyle = wood;
    rr(g, x + 1, top, w - 2, 20, 3.5);
    g.fill();
    g.strokeStyle = "rgba(255,215,170,.13)";
    g.lineWidth = 1;
    rr(g, x + 1.5, top + 0.5, w - 3, 19, 3.2);
    g.stroke();
    g.strokeStyle = "rgba(0,0,0,.10)";
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      g.moveTo(x + 8, top + 5 + i * 5.4);
      g.bezierCurveTo(cx - 12, top + 4 + i * 5.4, cx + 14, top + 7 + i * 5.4, x + w - 8, top + 5 + i * 5.4);
    }
    g.stroke();

    // monitor: bezel, screen with a tiny live UI, stand
    g.fillStyle = "#0a0f17";
    rr(g, cx - 16, top - 1, 32, 15, 2.4);
    g.fill();
    const screen = g.createLinearGradient(cx - 14, top + 1, cx + 14, top + 13);
    screen.addColorStop(0, shade(pal.dark, 28));
    screen.addColorStop(1, "#0a1a29");
    g.fillStyle = screen;
    rr(g, cx - 14, top + 1, 28, 11, 1.6);
    g.fill();
    g.fillStyle = shadeA(pal.light, 0.55);
    g.fillRect(cx - 11, top + 3, 13, 1);
    g.fillRect(cx - 11, top + 5.2, 19, 0.8);
    g.fillStyle = shadeA(pal.light, 0.9);
    g.fillRect(cx + 6, top + 8.4, 5, 0.8);
    g.fillStyle = "rgba(255,255,255,.09)";
    g.fillRect(cx - 12.5, top + 2, 25, 0.6);
    g.fillStyle = "#1b2432";
    g.fillRect(cx - 2, top + 13, 4, 5);
    rr(g, cx - 7, top + 17.4, 14, 2.4, 1.2);
    g.fill();

    // desk lamp on the outer edge
    g.strokeStyle = "#4a5468";
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x + 9, top + 17);
    g.lineTo(x + 9, top + 7);
    g.lineTo(x + 15, top + 4);
    g.stroke();
    g.fillStyle = pal.base;
    g.beginPath();
    g.moveTo(x + 12, top + 3);
    g.lineTo(x + 21, top + 5.6);
    g.lineTo(x + 18, top + 9);
    g.closePath();
    g.fill();
    g.fillStyle = shadeA(pal.light, 0.9);
    g.beginPath();
    g.arc(x + 17, top + 8, 1.4, 0, Math.PI * 2);
    g.fill();

    // keyboard, mouse, notebook, mug, pen cup
    g.fillStyle = "#1e2836";
    rr(g, cx - 12, top + 19, 20, 6.4, 1.4);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.08)";
    g.lineWidth = 0.6;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(cx - 10, top + 20.6 + i * 1.2);
      g.lineTo(cx + 6, top + 20.6 + i * 1.2);
      g.stroke();
    }
    g.fillStyle = "#2a3546";
    rr(g, cx + 10, top + 19, 5, 7, 2.4);
    g.fill();
    g.fillStyle = "#d9c9a8";
    rr(g, x + 3, top + 19, 10, 7.4, 1);
    g.fill();
    g.fillStyle = "rgba(90,76,56,.5)";
    g.fillRect(x + 4.4, top + 21, 7.2, 0.6);
    g.fillRect(x + 4.4, top + 23, 5.4, 0.6);
    g.fillStyle = pal.base;
    rr(g, x + w - 15, top + 17.6, 7, 7, 1.8);
    g.fill();
    g.fillStyle = shadeA(pal.light, 0.65);
    g.fillRect(x + w - 13.4, top + 18.6, 4.8, 1);
    g.fillStyle = "#3a4760";
    rr(g, x + w - 25, top + 18, 6, 7, 1.6);
    g.fill();
    g.fillStyle = "#f3d7a4";
    g.fillRect(x + w - 24, top + 15, 1.5, 5);
    g.fillStyle = "#e7b06a";
    g.fillRect(x + w - 22, top + 14.4, 1.5, 5.4);
    g.fillStyle = "#ff9f6b";
    g.fillRect(x + w - 20, top + 15.6, 1.5, 4.4);

    // a small name tag on the desk edge, role-coloured
    g.fillStyle = shadeA(pal.base, 0.22);
    rr(g, x + w / 2 - 14, top + 22.2, 28, 3.4, 1.7);
    g.fill();
    g.fillStyle = shadeA(pal.light, 0.8);
    g.fillRect(x + w / 2 - 10, top + 23.2, 20, 1.2);
  }

  function drawChair(g, x, y) {
    const cx = x + TILE / 2;
    g.fillStyle = "rgba(0,0,0,.30)";
    g.beginPath();
    g.ellipse(cx, y + 20, 13, 4.6, 0, 0, Math.PI * 2);
    g.fill();
    // five-star base + gas stem
    g.strokeStyle = "#28323f";
    g.lineWidth = 2;
    for (const a of [0.35, 1.35, 2.35, 3.35, 4.35]) {
      g.beginPath();
      g.moveTo(cx, y + 17);
      g.lineTo(cx + Math.cos(a) * 10, y + 17 + Math.sin(a) * 4);
      g.stroke();
    }
    g.fillStyle = "#333f52";
    rr(g, cx - 3, y + 10, 6, 8, 2);
    g.fill();
    // backrest (behind the seated character)
    const back = g.createLinearGradient(0, y - 2, 0, y + 8);
    back.addColorStop(0, "#4c5c76");
    back.addColorStop(1, "#2f3b4e");
    g.fillStyle = back;
    rr(g, cx - 10, y - 3, 20, 11, 4.5);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.10)";
    g.lineWidth = 0.8;
    rr(g, cx - 8.4, y - 1.8, 16.8, 7.6, 3.4);
    g.stroke();
    // seat + armrests
    g.fillStyle = "#3a485e";
    rr(g, cx - 10.5, y + 6, 21, 9, 4);
    g.fill();
    g.fillStyle = "#465773";
    rr(g, cx - 9, y + 6, 18, 3.4, 2);
    g.fill();
    g.fillStyle = "#2b3546";
    rr(g, cx - 13, y + 7, 3.4, 7, 1.6);
    g.fill();
    rr(g, cx + 9.6, y + 7, 3.4, 7, 1.6);
    g.fill();
  }

  /* ── foundry commons ───────────────────────────────────────────────────── */
  // The lower half of the foundry is a living room, not a void: a rug, a
  // lounge pair, a meeting table, a coffee bar and a printer nook. All of it
  // is drawn from the same palette as the desks, so it reads as one room.

  function drawCommons(g) {
    const T = TILE;

    // rug
    g.save();
    g.fillStyle = "rgba(42,58,82,.72)";
    rr(g, 3.05 * T, 7.35 * T, 7.0 * T, 5.35 * T, 12);
    g.fill();
    g.strokeStyle = "rgba(130,168,220,.18)";
    g.lineWidth = 1.4;
    rr(g, 3.25 * T, 7.55 * T, 6.6 * T, 4.95 * T, 9);
    g.stroke();
    g.strokeStyle = "rgba(190,215,245,.08)";
    g.lineWidth = 1;
    rr(g, 3.55 * T, 7.85 * T, 6.0 * T, 4.35 * T, 7);
    g.stroke();
    // woven diamond field
    g.strokeStyle = "rgba(150,190,230,.055)";
    for (let i = 0; i < 5; i++) {
      const cx = 4.35 * T + i * 1.2 * T;
      const cy = 10.0 * T;
      g.beginPath();
      g.moveTo(cx, cy - 44);
      g.lineTo(cx + 26, cy);
      g.lineTo(cx, cy + 44);
      g.lineTo(cx - 26, cy);
      g.closePath();
      g.stroke();
    }
    g.restore();

    // low sideboard against the west wall
    const sbx = 2.12 * T;
    const sby = 7.4 * T;
    g.fillStyle = "rgba(0,0,0,.30)";
    rr(g, sbx + 2, sby + 5, 0.92 * T, 4.7 * T, 3);
    g.fill();
    const sb = g.createLinearGradient(sbx, sby, sbx + 26, sby);
    sb.addColorStop(0, "#4c3a2b");
    sb.addColorStop(1, "#33251b");
    g.fillStyle = sb;
    rr(g, sbx, sby, 0.9 * T, 4.65 * T, 3);
    g.fill();
    g.strokeStyle = "rgba(255,220,175,.12)";
    g.lineWidth = 1;
    rr(g, sbx + 1, sby + 1, 0.9 * T - 2, 4.65 * T - 2, 2.4);
    g.stroke();
    g.fillStyle = "rgba(255,220,175,.10)";
    for (let i = 1; i < 4; i++) g.fillRect(sbx + 2, sby + i * 1.15 * T, 0.9 * T - 4, 1);
    // objects on top
    g.fillStyle = "#c9d4e2";
    rr(g, sbx + 5, sby + 14, 13, 17, 1.4);
    g.fill();
    g.fillStyle = "#8a6fae";
    g.fillRect(sbx + 6.4, sby + 16, 10, 2);
    g.fillStyle = "#a35c4a";
    rr(g, sbx + 7, sby + 38, 11, 14, 1.2);
    g.fill();
    g.fillStyle = "#5bb37c";
    g.beginPath();
    g.ellipse(sbx + 13, sby + 10, 7, 4.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#d8cbb4";
    rr(g, sbx + 4, sby + 116, 18, 10, 2);
    g.fill();

    // sofa, facing up toward the coffee table
    const sx = 3.5 * T;
    const sy = 10.65 * T;
    g.fillStyle = "rgba(0,0,0,.34)";
    rr(g, sx + 3, sy + 7, 3.85 * T, 1.72 * T, 10);
    g.fill();
    g.fillStyle = "#2a3448";
    rr(g, sx, sy, 3.85 * T, 1.72 * T, 11);
    g.fill();
    const seat = g.createLinearGradient(0, sy + 4, 0, sy + 1.7 * T);
    seat.addColorStop(0, "#485a78");
    seat.addColorStop(1, "#36455f");
    g.fillStyle = seat;
    rr(g, sx + 4, sy + 9, 3.85 * T - 8, 1.72 * T - 20, 8);
    g.fill();
    // back + arms
    g.fillStyle = "#3d4d69";
    rr(g, sx + 2, sy + 1.72 * T - 13, 3.85 * T - 4, 13, 7);
    g.fill();
    g.fillStyle = "#526582";
    rr(g, sx - 1, sy + 4, 11, 1.72 * T - 12, 5);
    g.fill();
    rr(g, sx + 3.85 * T - 10, sy + 4, 11, 1.72 * T - 12, 5);
    g.fill();
    // cushions
    g.fillStyle = PALETTES.sunset.base;
    rr(g, sx + 17, sy + 16, 20, 20, 5);
    g.fill();
    g.fillStyle = PALETTES.ocean.base;
    rr(g, sx + 3.85 * T - 41, sy + 16, 20, 20, 5);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.10)";
    rr(g, sx + 20, sy + 19, 14, 4, 2);
    g.fill();

    // two armchairs opposite
    for (const ax of [3.75 * T, 6.05 * T]) {
      g.fillStyle = "rgba(0,0,0,.30)";
      rr(g, ax + 2, 8.6 * T + 2, 1.22 * T, 1.08 * T, 8);
      g.fill();
      g.fillStyle = "#3c4c68";
      rr(g, ax, 8.1 * T, 1.22 * T, 1.08 * T, 9);
      g.fill();
      g.fillStyle = "#4b5e7c";
      rr(g, ax + 5, 8.1 * T + 7, 1.22 * T - 10, 1.08 * T - 16, 7);
      g.fill();
      g.fillStyle = "#2f3c52";
      rr(g, ax, 8.1 * T, 1.22 * T, 8, 5);
      g.fill();
    }

    // coffee table
    const ctx = 4.35 * T;
    const cty = 9.45 * T;
    g.fillStyle = "rgba(0,0,0,.28)";
    rr(g, ctx + 2, cty + 5, 2.2 * T, 0.92 * T, 6);
    g.fill();
    const ct = g.createLinearGradient(0, cty, 0, cty + 0.92 * T);
    ct.addColorStop(0, "#5a4331");
    ct.addColorStop(1, "#3a2a1f");
    g.fillStyle = ct;
    rr(g, ctx, cty, 2.2 * T, 0.92 * T, 6);
    g.fill();
    g.strokeStyle = "rgba(255,220,175,.14)";
    g.lineWidth = 1;
    rr(g, ctx + 1, cty + 1, 2.2 * T - 2, 0.92 * T - 2, 5);
    g.stroke();
    // tray, cups, magazine
    g.fillStyle = "#2a3546";
    rr(g, ctx + 13, cty + 9, 0.8 * T, 0.44 * T, 4);
    g.fill();
    g.fillStyle = PALETTES.violet.light;
    g.beginPath();
    g.arc(ctx + 22, cty + 19, 3.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PALETTES.sunset.light;
    g.beginPath();
    g.arc(ctx + 31, cty + 22, 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#d9c9a8";
    rr(g, ctx + 43, cty + 10, 18, 12, 1.2);
    g.fill();
    g.fillStyle = "rgba(80,70,55,.5)";
    g.fillRect(ctx + 45, cty + 13, 14, 1);
    g.fillRect(ctx + 45, cty + 16, 10, 1);

    // floor lamp behind the sofa's right arm
    const lx = 7.62 * T;
    const ly = 11.9 * T;
    g.fillStyle = "rgba(0,0,0,.3)";
    g.beginPath();
    g.ellipse(lx, ly + 3, 11, 4, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#4a5468";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(lx, ly);
    g.lineTo(lx, ly - 64);
    g.stroke();
    g.fillStyle = "#d9e4f2";
    g.beginPath();
    g.moveTo(lx - 10, ly - 58);
    g.lineTo(lx + 10, ly - 58);
    g.lineTo(lx + 6, ly - 74);
    g.lineTo(lx - 6, ly - 74);
    g.closePath();
    g.fill();
    const lampGlow = g.createRadialGradient(lx, ly - 68, 2, lx, ly - 68, 46);
    lampGlow.addColorStop(0, "rgba(255,225,170,.16)");
    lampGlow.addColorStop(1, "rgba(255,225,170,0)");
    g.fillStyle = lampGlow;
    g.beginPath();
    g.arc(lx, ly - 68, 46, 0, Math.PI * 2);
    g.fill();

    // meeting table with four chairs
    const mtx = 10.55 * T;
    const mty = 8.95 * T;
    for (const [cx, cy] of [[mtx + 30, mty - 15], [mtx + 82, mty - 15], [mtx + 30, mty + 1.85 * T], [mtx + 82, mty + 1.85 * T]]) {
      g.fillStyle = "rgba(0,0,0,.26)";
      g.beginPath();
      g.ellipse(cx, cy + 8, 12, 4.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#3f4e67";
      rr(g, cx - 10, cy - 6, 20, 14, 5);
      g.fill();
      g.fillStyle = "rgba(255,255,255,.08)";
      rr(g, cx - 8, cy - 5, 16, 4, 2);
      g.fill();
    }
    g.fillStyle = "rgba(0,0,0,.32)";
    rr(g, mtx + 3, mty + 6, 3.35 * T, 1.78 * T, 9);
    g.fill();
    const mt = g.createLinearGradient(0, mty, 0, mty + 1.78 * T);
    mt.addColorStop(0, "#5b4a3a");
    mt.addColorStop(1, "#3a2d22");
    g.fillStyle = mt;
    rr(g, mtx, mty, 3.35 * T, 1.78 * T, 9);
    g.fill();
    g.strokeStyle = "rgba(255,225,180,.16)";
    g.lineWidth = 1.2;
    rr(g, mtx + 1.5, mty + 1.5, 3.35 * T - 3, 1.78 * T - 3, 8);
    g.stroke();
    // laptop + papers + mugs on the table
    g.fillStyle = "#1b2836";
    rr(g, mtx + 24, mty + 20, 26, 16, 2);
    g.fill();
    g.fillStyle = "#28486a";
    rr(g, mtx + 26, mty + 22, 22, 11, 1.4);
    g.fill();
    g.fillStyle = shadeA("#8fd0ff", 0.7);
    g.fillRect(mtx + 28, mty + 24, 12, 1);
    g.fillRect(mtx + 28, mty + 27, 17, 0.9);
    g.fillStyle = "#e6dcc6";
    rr(g, mtx + 62, mty + 18, 26, 19, 1.5);
    g.fill();
    g.fillStyle = "rgba(70,60,45,.45)";
    for (let i = 0; i < 4; i++) g.fillRect(mtx + 65, mty + 22 + i * 3.4, 19 - i * 3, 0.9);
    g.fillStyle = PALETTES.ocean.base;
    rr(g, mtx + 28, mty + 46, 20, 9, 3);
    g.fill();
    g.fillStyle = "#d9c9a8";
    rr(g, mtx + 78, mty + 44, 13, 10, 1);
    g.fill();
    g.fillStyle = "#5bb37c";
    g.beginPath();
    g.ellipse(mtx + 110, mty + 30, 8, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#7a4f3a";
    rr(g, mtx + 104, mty + 34, 12, 10, 2);
    g.fill();

    // printer + paper nook on the east wall
    const px = 18.25 * T;
    const py = 7.6 * T;
    g.fillStyle = "rgba(0,0,0,.3)";
    rr(g, px + 2, py + 6, 1.75 * T, 1.55 * T, 6);
    g.fill();
    g.fillStyle = "#303b4d";
    rr(g, px, py, 1.75 * T, 1.55 * T, 6);
    g.fill();
    g.fillStyle = "#3d4b62";
    rr(g, px + 4, py + 4, 1.75 * T - 8, 0.55 * T, 4);
    g.fill();
    g.fillStyle = "#141b25";
    rr(g, px + 9, py + 11, 1.75 * T - 18, 12, 2);
    g.fill();
    g.fillStyle = "#d8e6f2";
    rr(g, px + 12, py + 8, 1.75 * T - 24, 5, 1);
    g.fill();
    g.fillStyle = "#6fe3ab";
    g.beginPath();
    g.arc(px + 1.75 * T - 12, py + 18, 1.6, 0, Math.PI * 2);
    g.fill();

    // coffee bar / credenza under the east wall
    const cbx = 18.3 * T;
    const cby = 11.3 * T;
    g.fillStyle = "rgba(0,0,0,.32)";
    rr(g, cbx + 2, cby + 7, 1.7 * T, 2.2 * T, 5);
    g.fill();
    const cb = g.createLinearGradient(cbx, cby, cbx + 1.7 * T, cby);
    cb.addColorStop(0, "#4a3728");
    cb.addColorStop(1, "#2f2319");
    g.fillStyle = cb;
    rr(g, cbx, cby, 1.7 * T, 2.2 * T, 4);
    g.fill();
    g.strokeStyle = "rgba(255,220,175,.12)";
    g.lineWidth = 1;
    rr(g, cbx + 1, cby + 1, 1.7 * T - 2, 2.2 * T - 2, 3.4);
    g.stroke();
    g.fillStyle = "rgba(255,220,175,.08)";
    g.fillRect(cbx + 2, cby + 1.1 * T, 1.7 * T - 4, 1);
    // machine + cups
    g.fillStyle = "#38465a";
    rr(g, cbx + 12, cby + 10, 26, 22, 3);
    g.fill();
    g.fillStyle = "#1a2433";
    rr(g, cbx + 15, cby + 13, 20, 9, 2);
    g.fill();
    g.fillStyle = "#ffcb6b";
    g.fillRect(cbx + 19, cby + 15, 5, 1.4);
    g.fillStyle = "#2a3546";
    rr(g, cbx + 15, cby + 25, 20, 4, 1.4);
    g.fill();
    g.fillStyle = "#d9c9a8";
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.arc(cbx + 14 + i * 11, cby + 46, 3.2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#c9d4e2";
    rr(g, cbx + 50, cby + 9, 13, 17, 1.4);
    g.fill();
    g.fillStyle = "rgba(80,70,55,.45)";
    g.fillRect(cbx + 52, cby + 13, 9, 1);
    g.fillRect(cbx + 52, cby + 16, 6, 1);

    // plants frame the open floor
    drawPlant(g, 14.4, 12.9);
    drawPlant(g, 8.9, 7.2);

    // floor cushions by the rug
    for (const [fx, fy, col] of [[8.15, 12.45, PALETTES.violet.base], [9.15, 12.7, PALETTES.sunset.base]]) {
      g.fillStyle = "rgba(0,0,0,.28)";
      g.beginPath();
      g.ellipse(fx * T + 13, fy * T + 13, 13, 5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = col;
      rr(g, fx * T, fy * T, 24, 18, 7);
      g.fill();
      g.fillStyle = "rgba(255,255,255,.16)";
      rr(g, fx * T + 3, fy * T + 3, 18, 5, 3);
      g.fill();
    }

    // a robot vacuum making its rounds
    const vx = 16.2 * T;
    const vy = 12.5 * T;
    g.fillStyle = "rgba(0,0,0,.32)";
    g.beginPath();
    g.ellipse(vx + 2, vy + 3, 11, 4, 0, 0, Math.PI * 2);
    g.fill();
    const vac = g.createRadialGradient(vx - 3, vy - 3, 1, vx, vy, 10);
    vac.addColorStop(0, "#4b5a70");
    vac.addColorStop(1, "#232d3c");
    g.fillStyle = vac;
    g.beginPath();
    g.arc(vx, vy, 10, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(120,190,255,.55)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(vx, vy, 6.4, -0.4, Math.PI * 1.1);
    g.stroke();
    g.fillStyle = "#6fe3ab";
    g.beginPath();
    g.arc(vx, vy, 1.4, 0, Math.PI * 2);
    g.fill();

    // loose paper and a cable run, so the floor feels used
    g.save();
    g.translate(14.7 * T, 13.3 * T);
    g.rotate(-0.18);
    g.fillStyle = "rgba(230,236,244,.55)";
    g.fillRect(0, 0, 16, 20);
    g.fillStyle = "rgba(90,105,130,.30)";
    for (let i = 0; i < 4; i++) g.fillRect(3, 4 + i * 4, 10 - (i % 2) * 3, 0.9);
    g.restore();
    g.fillStyle = "rgba(220,228,238,.38)";
    g.beginPath();
    g.moveTo(15.2 * T, 13.1 * T);
    g.lineTo(15.9 * T, 13.0 * T);
    g.lineTo(15.6 * T, 13.4 * T);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(70,85,110,.45)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(10.4 * T, 6.05 * T);
    g.bezierCurveTo(11.6 * T, 6.4 * T, 12.2 * T, 7.0 * T, 12.6 * T, 7.9 * T);
    g.stroke();
  }

  function drawWallArt(g) {
    const art = [
      // [tileX, tileY, w, h, palette, motif]
      [21, 5.4, 28, 32, "sunset", "arc"],
      [21, 9.2, 28, 24, "ocean", "lines"],
      [21, 12.8, 28, 34, "violet", "circle"],
      [25, 8.2, 26, 28, "ocean", "lines"],
      [25, 16.2, 26, 22, "sunset", "circle"],
    ];
    for (const [tx, ty, w, h, key, motif] of art) {
      const pal = PALETTES[key];
      const x = tx * TILE + (TILE - w) / 2;
      const y = ty * TILE + 2;
      // glow from the picture light above
      const wash = g.createRadialGradient(x + w / 2, y + 4, 1, x + w / 2, y + 4, w);
      wash.addColorStop(0, shadeA(pal.light, 0.10));
      wash.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = wash;
      g.fillRect(x - w / 2, y - h / 2, w * 2, h * 2);
      g.fillStyle = "rgba(0,0,0,.34)";
      rr(g, x + 1.5, y + 2, w, h, 1.6);
      g.fill();
      g.fillStyle = "#3a2f26";
      rr(g, x, y, w, h, 1.6);
      g.fill();
      g.fillStyle = shadeA(pal.base, 0.16);
      rr(g, x + 2.4, y + 2.4, w - 4.8, h - 4.8, 1);
      g.fill();
      g.strokeStyle = shadeA(pal.light, 0.55);
      g.lineWidth = 0.9;
      if (motif === "circle") {
        g.beginPath();
        g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.22, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = shadeA(pal.light, 0.5);
        g.beginPath();
        g.arc(x + w / 2 + 3, y + h / 2 - 2, Math.min(w, h) * 0.09, 0, Math.PI * 2);
        g.fill();
      } else if (motif === "arc") {
        g.beginPath();
        g.arc(x + w / 2, y + h * 0.72, Math.min(w, h) * 0.33, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
        g.fillStyle = shadeA(pal.light, 0.42);
        g.fillRect(x + w / 2 - 1, y + h * 0.5, 2, h * 0.32);
      } else {
        g.beginPath();
        for (let i = 0; i < 3; i++) {
          g.moveTo(x + 4, y + 8 + i * 6);
          g.lineTo(x + w - 4, y + 7 + i * 6);
        }
        g.stroke();
        g.fillStyle = shadeA(pal.light, 0.5);
        g.beginPath();
        g.arc(x + w - 6, y + h - 6, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    // a wall clock in the hall
    const cx = 25 * TILE + TILE / 2;
    const cy = 6.1 * TILE;
    g.fillStyle = "rgba(0,0,0,.35)";
    g.beginPath();
    g.arc(cx + 1, cy + 2, 9.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#28313f";
    g.beginPath();
    g.arc(cx, cy, 9.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#e7edf6";
    g.beginPath();
    g.arc(cx, cy, 7.4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#5a6b82";
    g.lineWidth = 0.8;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 5.8, cy + Math.sin(a) * 5.8);
      g.lineTo(cx + Math.cos(a) * 6.6, cy + Math.sin(a) * 6.6);
      g.stroke();
    }
    g.strokeStyle = "#28313f";
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx - 1.6, cy - 4);
    g.moveTo(cx, cy);
    g.lineTo(cx + 3.2, cy + 1.4);
    g.stroke();
    g.fillStyle = "#c8553d";
    g.beginPath();
    g.arc(cx, cy, 1.1, 0, Math.PI * 2);
    g.fill();
  }

  function drawGlass(g) {
    const x0 = 13 * TILE;
    const x1 = 18 * TILE;
    const y = 4 * TILE;
    const h = TILE;
    g.save();
    const glass = g.createLinearGradient(x0, y, x1, y + h);
    glass.addColorStop(0, "rgba(150,210,255,.14)");
    glass.addColorStop(0.42, "rgba(190,232,255,.26)");
    glass.addColorStop(0.58, "rgba(165,218,255,.18)");
    glass.addColorStop(1, "rgba(150,210,255,.14)");
    g.fillStyle = glass;
    g.fillRect(x0, y + 2, x1 - x0, h - 4);
    // frosted band low on the pane
    g.fillStyle = "rgba(205,235,255,.10)";
    g.fillRect(x0, y + h - 12, x1 - x0, 10);
    g.strokeStyle = "rgba(190,228,255,.44)";
    g.lineWidth = 1;
    g.strokeRect(x0, y + 2, x1 - x0, h - 4);
    // top rail
    g.fillStyle = "#465a76";
    g.fillRect(x0, y + 1, x1 - x0, 2.8);
    g.fillStyle = "rgba(255,255,255,.18)";
    g.fillRect(x0, y + 1, x1 - x0, 0.9);
    // posts
    for (let x = 13; x <= 18; x++) {
      g.fillStyle = "#435673";
      g.fillRect(x * TILE - 2, y, 4, h);
      g.fillStyle = "rgba(255,255,255,.14)";
      g.fillRect(x * TILE - 2, y, 1.5, h);
    }
    // reflections
    g.strokeStyle = "rgba(255,255,255,.26)";
    g.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const sx = x0 + 22 + i * 52;
      g.beginPath();
      g.moveTo(sx, y + h - 5);
      g.lineTo(sx + 20, y + 6);
      g.stroke();
    }
    g.strokeStyle = "rgba(170,225,255,.18)";
    g.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(x0 + 12 + i * 44, y + 5);
      g.lineTo(x0 + 4 + i * 44, y + h - 4);
      g.stroke();
    }
    // caustic spill on the floor in front of the glass
    const spill = g.createLinearGradient(0, y + h, 0, y + h + 46);
    spill.addColorStop(0, "rgba(160,220,255,.10)");
    spill.addColorStop(1, "rgba(160,220,255,0)");
    g.fillStyle = spill;
    g.fillRect(x0, y + h, x1 - x0, 46);
    g.fillStyle = "rgba(255,255,255,.06)";
    g.fillRect(x0, y + h - 3, x1 - x0, 3);
    g.restore();
  }

  function drawSkyloft(g) {
    // night window band on the north wall
    const wx = 26 * TILE;
    const wy = 1 * TILE + 4;
    const ww = 8 * TILE;
    const sky = g.createLinearGradient(wx, wy, wx, wy + 22);
    sky.addColorStop(0, "#0a1829");
    sky.addColorStop(1, "#12283f");
    g.fillStyle = sky;
    rr(g, wx, wy, ww, 22, 3);
    g.fill();
    for (let i = 0; i < 34; i++) {
      const a = 0.22 + hash(i, 5) * 0.65;
      g.fillStyle = `rgba(205,228,255,${a})`;
      g.fillRect(wx + 7 + hash(i, 9) * (ww - 14), wy + 3 + hash(i, 2) * 13, 1.3, 1.3);
    }
    // a low moon and a distant skyline
    const moonX = wx + ww * 0.72;
    const moonY = wy + 9;
    const moonGlow = g.createRadialGradient(moonX, moonY, 1, moonX, moonY, 16);
    moonGlow.addColorStop(0, "rgba(215,235,255,.55)");
    moonGlow.addColorStop(1, "rgba(215,235,255,0)");
    g.fillStyle = moonGlow;
    g.beginPath();
    g.arc(moonX, moonY, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#dbe9f8";
    g.beginPath();
    g.arc(moonX, moonY, 3.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#0a1524";
    for (let i = 0; i < 16; i++) {
      const bh = 3 + hash(i, 44) * 8;
      g.fillRect(wx + 5 + i * 17, wy + 18 - bh, 13, bh);
    }
    g.fillStyle = "rgba(255,220,150,.28)";
    for (let i = 0; i < 12; i++) {
      if (hash(i, 77) < 0.55) continue;
      g.fillRect(wx + 8 + i * 22, wy + 12 + (i % 3) * 2, 1.2, 1.2);
    }
    g.fillStyle = "rgba(160,210,255,.10)";
    g.fillRect(wx, wy + 19, ww, 3);
    // mullions
    g.fillStyle = "#36465d";
    for (let i = 0; i <= 8; i++) g.fillRect(wx + (i * TILE) - 1, wy, 2, 22);
    g.fillStyle = "rgba(255,255,255,.10)";
    g.fillRect(wx, wy, ww, 1.4);

    // rug
    const rug = g.createRadialGradient(30 * TILE, 4.4 * TILE, 4, 30 * TILE, 4.4 * TILE, 5 * TILE);
    rug.addColorStop(0, "rgba(108,78,62,.42)");
    rug.addColorStop(1, "rgba(70,52,44,.22)");
    g.fillStyle = rug;
    rr(g, 27 * TILE, 3 * TILE + 4, 6 * TILE, 3 * TILE, 14);
    g.fill();

    // sofa
    g.fillStyle = "#2b2233";
    rr(g, 28 * TILE, 2 * TILE + 4, 3 * TILE - 6, 8, 4);
    g.fill();
    const back = g.createLinearGradient(0, 2 * TILE + 8, 0, 2 * TILE + 18);
    back.addColorStop(0, "#5a4870");
    back.addColorStop(1, "#463557");
    g.fillStyle = back;
    rr(g, 28 * TILE + 2, 2 * TILE + 8, 3 * TILE - 10, 10, 4);
    g.fill();
    g.fillStyle = "#6a5484";
    rr(g, 28 * TILE + 4, 5 * TILE + 4, 3 * TILE - 12, 10, 4);
    g.fill();
    g.fillStyle = "#4a3a5c";
    rr(g, 28 * TILE - 2, 5 * TILE + 2, 6, 18, 3);
    g.fill();
    // cushions + throw
    g.fillStyle = PALETTES.sunset.base;
    rr(g, 28.4 * TILE, 2.3 * TILE + 4, 12, 10, 3);
    g.fill();
    g.fillStyle = PALETTES.ocean.base;
    rr(g, 29.9 * TILE, 2.3 * TILE + 4, 12, 10, 3);
    g.fill();
    g.fillStyle = "rgba(255,210,170,.20)";
    rr(g, 30.3 * TILE, 5 * TILE + 8, 16, 6, 2);
    g.fill();
    // armchair
    g.fillStyle = "#4a3a5c";
    rr(g, 32 * TILE, 5 * TILE + 2, 2 * TILE - 4, 18, 5);
    g.fill();
    g.fillStyle = "#5b4774";
    rr(g, 32 * TILE + 3, 5 * TILE + 5, 2 * TILE - 10, 9, 3);
    g.fill();
    // coffee table + books + mug
    g.fillStyle = "#3a2b23";
    rr(g, 29 * TILE + 4, 4 * TILE + 4, 2 * TILE - 8, 22, 4);
    g.fill();
    g.fillStyle = "rgba(255,220,180,.10)";
    rr(g, 29 * TILE + 7, 4 * TILE + 6, 2 * TILE - 14, 8, 2);
    g.fill();
    const pal = PALETTES.violet;
    g.fillStyle = pal.light;
    g.beginPath();
    g.arc(29 * TILE + 20, 4 * TILE + 13, 2.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#c9d4e2";
    rr(g, 30 * TILE + 2, 4 * TILE + 9, 7, 9, 1);
    g.fill();
    g.fillStyle = "#7a4f3a";
    rr(g, 29 * TILE + 12, 4 * TILE + 8, 4.4, 3, 0.6);
    g.fill();
    // bookshelf on the west wall
    g.fillStyle = "#40302a";
    rr(g, 26.1 * TILE, 3 * TILE + 2, 10, 2.4 * TILE, 2);
    g.fill();
    const bookCols = ["#a35c4a", "#4d7a9c", "#8a6fae", "#c49a5a"];
    for (let i = 0; i < 7; i++) {
      g.fillStyle = bookCols[i % 4];
      g.fillRect(26.2 * TILE + 1.4, 3 * TILE + 6 + i * 5.4, 6.4, 4);
    }
    // hanging lamp
    const lx = 29 * TILE;
    const ly = 2 * TILE + 14;
    g.strokeStyle = "#5a4d3e";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(lx, 1 * TILE + 24);
    g.lineTo(lx, ly);
    g.stroke();
    const shade = g.createLinearGradient(lx - 9, ly, lx + 9, ly + 7);
    shade.addColorStop(0, "#ffe2b0");
    shade.addColorStop(1, "#c98f52");
    g.fillStyle = shade;
    g.beginPath();
    g.moveTo(lx - 10, ly + 8);
    g.lineTo(lx + 10, ly + 8);
    g.lineTo(lx + 4, ly);
    g.lineTo(lx - 4, ly);
    g.closePath();
    g.fill();
    g.fillStyle = "#fff0cc";
    g.beginPath();
    g.ellipse(lx, ly + 8, 3, 1.2, 0, 0, Math.PI * 2);
    g.fill();
    const glow = g.createRadialGradient(lx, ly + 9, 2, lx, ly + 9, 62);
    glow.addColorStop(0, "rgba(255,200,130,.22)");
    glow.addColorStop(1, "rgba(255,200,130,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(lx, ly + 9, 62, 0, Math.PI * 2);
    g.fill();

    // low record console against the south wall
    const cbx = 31.1 * TILE;
    const cby = 6.25 * TILE;
    g.fillStyle = "rgba(0,0,0,.30)";
    rr(g, cbx + 2, cby + 4, 2.7 * TILE, 0.7 * TILE, 4);
    g.fill();
    const console = g.createLinearGradient(0, cby, 0, cby + 0.7 * TILE);
    console.addColorStop(0, "#5a4331");
    console.addColorStop(1, "#33251b");
    g.fillStyle = console;
    rr(g, cbx, cby, 2.6 * TILE, 0.66 * TILE, 3);
    g.fill();
    g.strokeStyle = "rgba(255,220,175,.13)";
    g.lineWidth = 1;
    rr(g, cbx + 1, cby + 1, 2.6 * TILE - 2, 0.66 * TILE - 2, 2.4);
    g.stroke();
    // turntable
    g.fillStyle = "#222c39";
    rr(g, cbx + 14, cby + 6, 50, 32, 3);
    g.fill();
    g.fillStyle = "#10161e";
    g.beginPath();
    g.arc(cbx + 34, cby + 22, 12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(180,200,220,.30)";
    g.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(cbx + 34, cby + 22, 3 + i * 1.5, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = "#8d9aac";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cbx + 52, cby + 13);
    g.lineTo(cbx + 44, cby + 27);
    g.stroke();
    g.fillStyle = "#c9d4e2";
    rr(g, cbx + 72, cby + 8, 12, 20, 1.4);
    g.fill();
    g.fillStyle = "rgba(80,70,55,.45)";
    g.fillRect(cbx + 74, cby + 12, 8, 1);
    g.fillRect(cbx + 74, cby + 15, 5, 1);
    g.fillStyle = "#5bb37c";
    g.beginPath();
    g.ellipse(cbx + 82, cby + 2, 9, 5, 0, 0, Math.PI * 2);
    g.fill();

    // floor lamp in the reading corner
    const flx = 27.1 * TILE;
    const fly = 5.7 * TILE;
    g.strokeStyle = "#4a5468";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(flx, fly);
    g.lineTo(flx, fly - 46);
    g.stroke();
    g.fillStyle = "#e5d7b8";
    g.beginPath();
    g.moveTo(flx - 8, fly - 42);
    g.lineTo(flx + 8, fly - 42);
    g.lineTo(flx + 5, fly - 56);
    g.lineTo(flx - 5, fly - 56);
    g.closePath();
    g.fill();
    const fl = g.createRadialGradient(flx, fly - 50, 1, flx, fly - 50, 34);
    fl.addColorStop(0, "rgba(255,220,165,.18)");
    fl.addColorStop(1, "rgba(255,220,165,0)");
    g.fillStyle = fl;
    g.beginPath();
    g.arc(flx, fly - 50, 34, 0, Math.PI * 2);
    g.fill();

    // the office cat, asleep on the rug
    const catX = 28.3 * TILE;
    const catY = 4.15 * TILE;
    g.fillStyle = "rgba(0,0,0,.28)";
    g.beginPath();
    g.ellipse(catX, catY + 7, 15, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#c98f52";
    g.beginPath();
    g.ellipse(catX, catY, 13, 8, 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#e0ab6c";
    g.beginPath();
    g.ellipse(catX - 8, catY - 2, 6, 5.2, 0.1, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(catX - 12, catY - 6);
    g.lineTo(catX - 9, catY - 11);
    g.lineTo(catX - 5, catY - 6);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(catX - 6, catY - 7);
    g.lineTo(catX - 3, catY - 12);
    g.lineTo(catX - 1, catY - 7);
    g.closePath();
    g.fill();
    g.strokeStyle = "#a86d3a";
    g.lineWidth = 1.4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(catX + 11, catY + 3);
    g.quadraticCurveTo(catX + 17, catY + 7, catX + 13, catY + 12);
    g.stroke();
    g.strokeStyle = "rgba(60,40,25,.55)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(catX - 10, catY - 1.5, 1.6, 0.2, Math.PI - 0.2);
    g.moveTo(catX - 5, catY - 1.5);
    g.arc(catX - 5, catY - 1.5, 1.6, 0.2, Math.PI - 0.2);
    g.stroke();
  }

  function drawWorkshop(g) {
    // pegboard on the north wall
    const px = 27 * TILE;
    const py = 10 * TILE + 4;
    g.fillStyle = "rgba(0,0,0,.35)";
    rr(g, px + 1, py + 2, 4 * TILE, 22, 2);
    g.fill();
    const board = g.createLinearGradient(px, py, px, py + 22);
    board.addColorStop(0, "#4a3c2e");
    board.addColorStop(1, "#33291f");
    g.fillStyle = board;
    rr(g, px, py, 4 * TILE, 22, 2);
    g.fill();
    for (let i = 0; i < 24; i++) {
      g.fillStyle = "rgba(210,198,176,.28)";
      g.fillRect(px + 6 + (i % 12) * 11, py + 5 + Math.floor(i / 12) * 10, 1.2, 1.2);
    }
    // tools: wrench, hammer, saw, screwdrivers
    g.strokeStyle = "#9aa9bb";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px + 18, py + 7);
    g.lineTo(px + 18, py + 21);
    g.stroke();
    g.beginPath();
    g.arc(px + 18, py + 6, 3, 0.4, Math.PI * 1.9);
    g.stroke();
    g.fillStyle = "#8d5a35";
    g.fillRect(px + 30, py + 6, 2, 12);
    g.fillStyle = "#aab7c6";
    rr(g, px + 26, py + 12, 10, 4, 1);
    g.fill();
    g.fillStyle = "#9aa9bb";
    g.beginPath();
    g.moveTo(px + 52, py + 7);
    g.lineTo(px + 68, py + 9);
    g.lineTo(px + 68, py + 12);
    g.lineTo(px + 52, py + 14);
    g.closePath();
    g.fill();
    for (let i = 0; i < 3; i++) {
      g.fillStyle = ["#c47a3a", "#4d7a9c", "#8a6fae"][i];
      g.fillRect(px + 74 + i * 7, py + 8, 3, 11);
      g.fillStyle = "#aab7c6";
      g.fillRect(px + 74 + i * 7, py + 5, 3, 3);
    }

    // bench with a vise, parts tray and monitor
    g.fillStyle = "rgba(0,0,0,.32)";
    rr(g, 27 * TILE + 2, 12 * TILE + 8, 3 * TILE - 2, 20, 3);
    g.fill();
    const bench = g.createLinearGradient(0, 12 * TILE + 2, 0, 12 * TILE + 20);
    bench.addColorStop(0, "#4c3a2a");
    bench.addColorStop(1, "#33251b");
    g.fillStyle = bench;
    rr(g, 27 * TILE, 12 * TILE + 2, 3 * TILE - 4, 20, 3);
    g.fill();
    g.strokeStyle = "rgba(255,220,170,.10)";
    g.lineWidth = 1;
    rr(g, 27 * TILE + 1, 12 * TILE + 3, 3 * TILE - 6, 18, 2.6);
    g.stroke();
    g.fillStyle = "#54657f";
    rr(g, 27 * TILE + 6, 12 * TILE + 6, 14, 10, 2);
    g.fill();
    g.fillStyle = "#1b2c3d";
    rr(g, 27 * TILE + 8, 12 * TILE + 8, 10, 5, 1);
    g.fill();
    g.fillStyle = "#6fe3ab";
    g.fillRect(27 * TILE + 9, 12 * TILE + 10, 5, 0.8);
    g.fillStyle = "#c47a3a";
    rr(g, 28 * TILE + 3, 12 * TILE + 7, 10, 8, 2);
    g.fill();
    g.fillStyle = "#8d9aac";
    rr(g, 28 * TILE + 5, 12 * TILE + 5, 6, 3, 1);
    g.fill();
    g.fillStyle = "#2a3546";
    rr(g, 29 * TILE + 6, 12 * TILE + 9, 12, 8, 1.6);
    g.fill();
    g.fillStyle = "#e7b06a";
    g.fillRect(29 * TILE + 8, 12 * TILE + 11, 3, 1);
    g.fillRect(29 * TILE + 8, 12 * TILE + 13, 6, 1);

    // crates + toolbox
    g.fillStyle = "#4a3a2a";
    rr(g, 33 * TILE + 1, 15 * TILE + 1, TILE - 2, TILE - 2, 2);
    g.fill();
    g.strokeStyle = "rgba(255,220,170,.14)";
    g.strokeRect(33 * TILE + 4, 15 * TILE + 4, TILE - 8, TILE - 8);
    g.fillStyle = "rgba(255,220,170,.10)";
    g.fillRect(33 * TILE + 5, 15 * TILE + 16, TILE - 10, 1);
    g.fillStyle = "#3f6b8f";
    rr(g, 31 * TILE + 6, 15 * TILE + 8, 18, 11, 2);
    g.fill();
    g.fillStyle = "#6fa8d8";
    g.fillRect(31 * TILE + 14, 15 * TILE + 10, 3, 7);

    // rolling tool cart + stool under the bench
    const tx = 31.2 * TILE;
    const ty = 14.05 * TILE;
    g.fillStyle = "rgba(0,0,0,.30)";
    rr(g, tx + 2, ty + 5, 1.55 * TILE, 0.95 * TILE, 4);
    g.fill();
    g.fillStyle = "#b4483a";
    rr(g, tx, ty, 1.55 * TILE, 0.92 * TILE, 3);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.09)";
    rr(g, tx + 2, ty + 2, 1.55 * TILE - 4, 0.3 * TILE, 2);
    g.fill();
    g.fillStyle = "rgba(0,0,0,.18)";
    g.fillRect(tx + 4, ty + 0.47 * TILE, 1.55 * TILE - 8, 1);
    g.fillRect(tx + 4, ty + 0.72 * TILE, 1.55 * TILE - 8, 1);
    g.fillStyle = "#2a3546";
    g.fillRect(tx + 8, ty + 0.4 * TILE, 14, 2);
    g.fillRect(tx + 8, ty + 0.65 * TILE, 14, 2);
    g.fillStyle = "#9aa9bb";
    g.fillRect(tx + 12, ty - 6, 2, 10);
    g.fillRect(tx + 20, ty - 4, 2, 9);
    g.fillStyle = "#8d5a35";
    rr(g, tx + 38, ty + 10, 16, 6, 2);
    g.fill();

    // stool
    const stx = 30.1 * TILE;
    const sty = 13.75 * TILE;
    g.fillStyle = "rgba(0,0,0,.28)";
    g.beginPath();
    g.ellipse(stx + 9, sty + 13, 10, 3.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#3a4658";
    g.beginPath();
    g.arc(stx + 9, sty + 6, 9, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#4c5a70";
    g.lineWidth = 2;
    for (const a of [0.4, 1.8, 3.2, 4.6]) {
      g.beginPath();
      g.moveTo(stx + 9, sty + 6);
      g.lineTo(stx + 9 + Math.cos(a) * 8, sty + 6 + Math.sin(a) * 7);
      g.stroke();
    }
    g.fillStyle = "#a35c4a";
    g.beginPath();
    g.arc(stx + 9, sty + 6, 6.4, 0, Math.PI * 2);
    g.fill();

    // hanging work lamp
    const hx = 29 * TILE;
    const hy = 11 * TILE + 8;
    g.strokeStyle = "#4a5468";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(hx, 10 * TILE + 26);
    g.lineTo(hx, hy);
    g.stroke();
    g.fillStyle = "#d7e4f2";
    g.beginPath();
    g.moveTo(hx - 7, hy + 5);
    g.lineTo(hx + 7, hy + 5);
    g.lineTo(hx + 3, hy);
    g.lineTo(hx - 3, hy);
    g.closePath();
    g.fill();
    const halo = g.createRadialGradient(hx, hy + 6, 2, hx, hy + 6, 44);
    halo.addColorStop(0, "rgba(200,225,255,.16)");
    halo.addColorStop(1, "rgba(200,225,255,0)");
    g.fillStyle = halo;
    g.beginPath();
    g.arc(hx, hy + 6, 44, 0, Math.PI * 2);
    g.fill();
  }

  function drawYard(g) {
    // fence along the bottom wall
    g.strokeStyle = "rgba(130,108,80,.34)";
    g.lineWidth = 1.6;
    for (let x = 2; x < 21; x += 1.2) {
      g.beginPath();
      g.moveTo(x * TILE, 20 * TILE + 20);
      g.lineTo(x * TILE, 21 * TILE);
      g.stroke();
    }
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(2 * TILE, 20 * TILE + 22);
    g.lineTo(21 * TILE, 20 * TILE + 22);
    g.moveTo(2 * TILE, 20 * TILE + 30);
    g.lineTo(21 * TILE, 20 * TILE + 30);
    g.stroke();

    // trees: layered canopy with a warm rim from the string lights
    [[3, 18], [3, 19], [5, 20], [18, 17]].forEach(([x, y], idx) => {
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      g.fillStyle = "rgba(0,0,0,.30)";
      g.beginPath();
      g.ellipse(cx, cy + 12, 14, 4.6, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#4a3322";
      g.fillRect(cx - 2.4, cy + 1, 4.8, 12);
      g.fillStyle = "#5d422c";
      g.fillRect(cx - 2.4, cy + 1, 1.6, 12);
      const canopy = g.createRadialGradient(cx - 5, cy - 12, 2, cx, cy - 6, 16);
      canopy.addColorStop(0, "#4f9a67");
      canopy.addColorStop(0.6, "#357a4d");
      canopy.addColorStop(1, "#204c33");
      g.fillStyle = canopy;
      g.beginPath();
      g.arc(cx, cy - 7, 12.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(120,200,150,.30)";
      g.beginPath();
      g.arc(cx - 4.4, cy - 11.4, 6.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,205,140,.16)";
      g.beginPath();
      g.arc(cx + 4.5, cy - 6, 4.2, 0, Math.PI * 2);
      g.fill();
      if (idx === 3) {
        g.fillStyle = "rgba(255,160,190,.55)";
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.arc(cx - 5 + i * 3.4, cy - 10 + (i % 2) * 3.5, 0.9, 0, Math.PI * 2);
          g.fill();
        }
      }
    });

    // planters
    for (const [bx, by] of [[7, 18], [16, 20]]) {
      g.fillStyle = "#4a3a2a";
      rr(g, bx * TILE + 4, by * TILE + 12, 22, 12, 2);
      g.fill();
      g.fillStyle = "#2f6b45";
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.ellipse(bx * TILE + 8 + i * 4, by * TILE + 10, 3.6, 5.2, i % 2 ? 0.4 : -0.4, 0, Math.PI * 2);
        g.fill();
      }
    }

    // bench
    g.fillStyle = "rgba(0,0,0,.25)";
    rr(g, 14 * TILE, 19 * TILE + 13, 2 * TILE - 2, 7, 2);
    g.fill();
    const bn = g.createLinearGradient(0, 19 * TILE + 3, 0, 19 * TILE + 14);
    bn.addColorStop(0, "#5b4530");
    bn.addColorStop(1, "#3d2d1f");
    g.fillStyle = bn;
    rr(g, 14 * TILE, 19 * TILE + 4, 2 * TILE - 2, 10, 2);
    g.fill();
    g.strokeStyle = "rgba(255,220,170,.10)";
    g.strokeRect(14 * TILE + 3, 19 * TILE + 6, 2 * TILE - 8, 1);
    g.fillStyle = "#3a2b1d";
    g.fillRect(14 * TILE + 4, 19 * TILE + 14, 3, 7);
    g.fillRect(15 * TILE + 15, 19 * TILE + 14, 3, 7);

    // string lights across the yard
    const y0 = 17 * TILE + 12;
    const xs = 2 * TILE;
    const xe = 20 * TILE;
    g.strokeStyle = "rgba(84,72,55,.5)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(xs, y0);
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      const x = xs + (xe - xs) * t;
      const y = y0 + Math.sin(t * Math.PI) * 18;
      g.lineTo(x, y);
    }
    g.stroke();
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const x = xs + (xe - xs) * t;
      const y = y0 + Math.sin(t * Math.PI) * 18;
      const warm = i % 3 === 0 ? "rgba(255,170,130," : "rgba(255,214,150,";
      const glow = g.createRadialGradient(x, y + 3, 0.5, x, y + 3, 10);
      glow.addColorStop(0, warm + ".22)");
      glow.addColorStop(1, warm + "0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(x, y + 3, 10, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = warm + ".9)";
      g.beginPath();
      g.arc(x, y + 3, 1.9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,.55)";
      g.beginPath();
      g.arc(x - 0.4, y + 2.4, 0.7, 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawHall(g) {
    const T = TILE;

    // slim console against the east wall
    const cx = 24.05 * T;
    const cy = 5.9 * T;
    g.fillStyle = "rgba(0,0,0,.34)";
    rr(g, cx + 2, cy + 3, 0.82 * T, 1.55 * T, 4);
    g.fill();
    const top = g.createLinearGradient(cx, cy, cx + 0.82 * T, cy);
    top.addColorStop(0, "#4e3b2b");
    top.addColorStop(1, "#33251b");
    g.fillStyle = top;
    rr(g, cx, cy, 0.82 * T, 1.5 * T, 3);
    g.fill();
    g.strokeStyle = "rgba(255,220,175,.14)";
    g.lineWidth = 1;
    rr(g, cx + 1, cy + 1, 0.82 * T - 2, 1.5 * T - 2, 2.4);
    g.stroke();
    g.fillStyle = "rgba(255,220,175,.09)";
    g.fillRect(cx + 2, cy + 0.58 * T, 0.82 * T - 4, 1);
    // vase + bowl + framed photo
    g.fillStyle = "#c9d4e2";
    rr(g, cx + 7, cy + 10, 10, 13, 1.2);
    g.fill();
    g.fillStyle = "rgba(80,70,55,.5)";
    g.fillRect(cx + 8.6, cy + 13, 6.8, 0.8);
    g.fillStyle = "#5bb37c";
    g.beginPath();
    g.ellipse(cx + 20, cy + 20, 7, 4.4, 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#a35c4a";
    rr(g, cx + 6, cy + 0.95 * T, 16, 12, 2);
    g.fill();
    g.fillStyle = "#3a2f26";
    rr(g, cx + 7.2, cy + 0.98 * T, 13.6, 8, 1.2);
    g.fill();
    g.fillStyle = "#d9c9a8";
    g.beginPath();
    g.arc(cx + 8, cy + 1.2 * T, 9, 0, Math.PI * 2);
    g.fill();

    // bench near the yard door
    const bx = 24.02 * T;
    const by = 14.5 * T;
    g.fillStyle = "rgba(0,0,0,.30)";
    rr(g, bx + 2, by + 5, 0.85 * T, 1.5 * T, 4);
    g.fill();
    const bench = g.createLinearGradient(bx, by, bx + 0.85 * T, by);
    bench.addColorStop(0, "#5a4331");
    bench.addColorStop(1, "#3a2a1f");
    g.fillStyle = bench;
    rr(g, bx, by, 0.85 * T, 1.45 * T, 3);
    g.fill();
    g.fillStyle = "#46536b";
    rr(g, bx + 3, by + 4, 0.85 * T - 6, 0.62 * T, 4);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.09)";
    rr(g, bx + 4, by + 5, 0.85 * T - 8, 3, 1.6);
    g.fill();
    g.fillStyle = "#a35c4a";
    rr(g, bx + 7, by + 0.7 * T, 16, 13, 3);
    g.fill();
    g.fillStyle = "#d9c9a8";
    rr(g, bx + 10, by + 0.72 * T, 10, 10, 2);
    g.fill();

    // plants
    drawPlant(g, 22.15, 3.15);
    drawPlant(g, 24.12, 17.5);

    // rolling mail cart / parcel bin
    const mx = 22.2 * T;
    const my = 12.4 * T;
    g.fillStyle = "rgba(0,0,0,.26)";
    rr(g, mx + 1, my + 5, 0.68 * T, 0.66 * T, 3);
    g.fill();
    g.fillStyle = "#41526b";
    rr(g, mx, my, 0.68 * T, 0.62 * T, 2.4);
    g.fill();
    g.fillStyle = "#283748";
    rr(g, mx + 3, my + 3, 0.68 * T - 6, 0.3 * T, 1.4);
    g.fill();
    g.fillStyle = "#d9c9a8";
    rr(g, mx + 6, my + 5, 12, 8, 1);
    g.fill();
    g.fillStyle = "rgba(90,80,62,.5)";
    g.fillRect(mx + 7.5, my + 7, 9, 0.8);
    g.fillRect(mx + 7.5, my + 9, 6, 0.8);
    g.fillStyle = "#2a3546";
    g.beginPath();
    g.arc(mx + 6, my + 0.62 * T, 2.2, 0, Math.PI * 2);
    g.arc(mx + 0.68 * T - 6, my + 0.62 * T, 2.2, 0, Math.PI * 2);
    g.fill();
  }

  function drawSconce(g, tx, ty) {
    const x = tx * TILE + TILE / 2;
    const y = ty * TILE + TILE / 2;
    const glow = g.createRadialGradient(x, y, 2, x, y, 44);
    glow.addColorStop(0, "rgba(255,196,128,.28)");
    glow.addColorStop(0.45, "rgba(255,180,110,.10)");
    glow.addColorStop(1, "rgba(255,180,110,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, 44, 0, Math.PI * 2);
    g.fill();
    // bracket + shade
    g.strokeStyle = "#4c3b2c";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x - 4, y);
    g.lineTo(x, y);
    g.stroke();
    const shade = g.createLinearGradient(x - 5, y - 4, x + 5, y + 4);
    shade.addColorStop(0, "#ffe8bd");
    shade.addColorStop(1, "#c99558");
    g.fillStyle = shade;
    g.beginPath();
    g.moveTo(x - 5, y - 4.4);
    g.lineTo(x + 5, y - 4.4);
    g.lineTo(x + 3.4, y + 3.2);
    g.lineTo(x - 3.4, y + 3.2);
    g.closePath();
    g.fill();
    g.fillStyle = "#fff4d8";
    g.beginPath();
    g.ellipse(x, y + 3, 3.2, 1.2, 0, 0, Math.PI * 2);
    g.fill();
    // a soft cone of light toward the floor
    const cone = g.createLinearGradient(x, y + 4, x, y + 46);
    cone.addColorStop(0, "rgba(255,205,145,.09)");
    cone.addColorStop(1, "rgba(255,205,145,0)");
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(x - 5, y + 4);
    g.lineTo(x + 5, y + 4);
    g.lineTo(x + 22, y + 46);
    g.lineTo(x - 22, y + 46);
    g.closePath();
    g.fill();
  }

  function drawAmbient(g, now) {
    const t = now / 1000;
    // slow dust drift through the lamp light
    for (const d of DUST) {
      const x = ((d.x + t * d.sp + Math.sin(t * 0.3 + d.ph) * 12) % WIDTH + WIDTH) % WIDTH;
      const y = ((d.y - t * d.sp * 0.32 + Math.cos(t * 0.21 + d.ph) * 8) % HEIGHT + HEIGHT) % HEIGHT;
      const a = 0.045 + 0.09 * (0.5 + 0.5 * Math.sin(t * 0.8 + d.ph));
      g.fillStyle = `rgba(212,230,255,${a})`;
      g.beginPath();
      g.arc(x, y, d.r, 0, Math.PI * 2);
      g.fill();
    }

    // monitor breathing over each desk, independent of the crew sitting there
    for (const role of ["planner", "executor", "reviewer"]) {
      const pal = PALETTES[({ planner: "sunset", executor: "ocean", reviewer: "violet" })[role]];
      const seat = SEATS[role];
      const sx = (seat.x + 0.5) * TILE;
      const sy = 3 * TILE + 6;
      const a = 0.035 + 0.022 * Math.sin(t * 1.7 + sx * 0.01);
      const glow = g.createRadialGradient(sx, sy, 3, sx, sy, 54);
      glow.addColorStop(0, shadeA(pal.light, a));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(sx, sy, 54, 0, Math.PI * 2);
      g.fill();
    }

    // the skyloft pendant sways a hair, breathing warm light into the lounge
    const lx = 29 * TILE;
    const ly = 2 * TILE + 22;
    const pump = 0.035 + 0.018 * Math.sin(t * 1.2);
    const lamp = g.createRadialGradient(lx, ly, 4, lx, ly, 72);
    lamp.addColorStop(0, `rgba(255,205,140,${pump})`);
    lamp.addColorStop(1, "rgba(255,205,140,0)");
    g.fillStyle = lamp;
    g.beginPath();
    g.arc(lx, ly, 72, 0, Math.PI * 2);
    g.fill();
  }

  function drawDynamic(g, now) {
    drawAmbient(g, now);

    // lamp/ambient pulses
    for (const role of state.order) {
      const c = state.chars[role];
      if (!c) continue;
      if (c.phase === "working") {
        const pal = PALETTES[c.palette];
        const sx = c.seat.x * TILE + TILE / 2;
        const sy = c.seat.y * TILE - 2;
        const pulse = 0.55 + Math.sin(now / 240) * 0.12;
        const glow = g.createRadialGradient(sx, sy, 4, sx, sy, 40);
        glow.addColorStop(0, pal.glow.replace(/\.30\)/, (0.26 * pulse).toFixed(2) + ")"));
        glow.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = glow;
        g.beginPath();
        g.arc(sx, sy, 40, 0, Math.PI * 2);
        g.fill();
      }
    }

    // characters sorted by y so the nearer one overlaps
    const chars = state.order.map((r) => state.chars[r]).filter(Boolean).sort((a, b) => a.pos.y - b.pos.y);
    for (let i = 0; i < chars.length; i++) {
      // When two agents share a doorway, the later plate sits one row lower so
      // both nameplates stay readable instead of stacking on top of each other.
      const c = chars[i];
      const clash = chars.slice(0, i).some((o) =>
        Math.abs(o.pos.x - c.pos.x) < 1.6 && Math.abs(o.pos.y - c.pos.y) < 0.8);
      drawChar(g, c, now, clash);
    }
    for (const c of chars) if (c.bubble) drawBubble(g, c, now);
  }

  function drawChar(g, c, now, plateDrop = false) {
    const pal = PALETTES[c.palette] || PALETTES.ocean;
    const px = c.pos.x * TILE + TILE / 2;
    const baseY = c.pos.y * TILE + TILE / 2 + 7;
    const walking = !!c.moving;
    const working = c.phase === "working";
    const reviewing = c.phase === "reviewing";
    const done = c.phase === "done";
    const t = now / 1000;
    const seed = c.seed || 0;
    const face = c.facing || 1;

    // A four-beat gait from distance travelled, so the stride matches the walk.
    const cycle = walking ? (c.gait / TILE) * Math.PI * 1.6 : 0;
    const stride = walking ? Math.sin(cycle) : 0;
    const lift = walking ? Math.max(0, Math.sin(cycle)) : 0;
    const bob = walking
      ? Math.abs(Math.sin(cycle)) * 2.1
      : Math.sin(t * 1.6 + seed) * 0.9 + (working ? Math.sin(t * 6.4 + seed) * 0.65 : 0);
    const breathe = Math.sin(t * 1.9 + seed) * 0.55;
    const lean = walking ? face * 1.3 : working ? 1.2 : 0;

    // Blink every few seconds, offset per character.
    const blinkPhase = (t * 0.22 + seed * 0.31) % 1;
    const blink = blinkPhase > 0.965 ? Math.max(0.10, 1 - (blinkPhase - 0.965) / 0.035) : 1;

    const hipY = baseY - 12 + bob * 0.4;
    const shoulderY = baseY - 30 + bob;
    const headY = baseY - 40 + bob;
    const shoulder = 10.5;
    const waist = 8.4;

    /* ── floor contact ─────────────────────────────────────────────────── */
    g.fillStyle = "rgba(0,0,0,.38)";
    g.beginPath();
    g.ellipse(px, baseY + 1.5, 14.5, 4.8, 0, 0, Math.PI * 2);
    g.fill();
    const bounce = g.createRadialGradient(px, baseY + 1, 2, px, baseY + 1, 26);
    bounce.addColorStop(0, shadeA(pal.base, working ? 0.24 : 0.13));
    bounce.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = bounce;
    g.beginPath();
    g.ellipse(px, baseY + 1, 26, 9, 0, 0, Math.PI * 2);
    g.fill();

    if (state.selected === c.role) {
      g.save();
      g.translate(px, baseY - 17);
      g.rotate(t * 0.45);
      g.strokeStyle = shadeA(pal.light, 0.5);
      g.lineWidth = 1.2;
      g.setLineDash([5, 7]);
      g.beginPath();
      g.arc(0, 0, 27, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      g.strokeStyle = shadeA(pal.light, 0.28);
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(px, baseY + 1, 18, 6.4, 0, 0, Math.PI * 2);
      g.stroke();
    }

    /* ── legs (behind the torso) ───────────────────────────────────────── */
    const swing = stride * 5;
    const backFootX = px - 4 - swing;
    const frontFootX = px + 4 + swing;
    // back leg
    limb(g, px - 4, hipY, backFootX, baseY - 2 - lift * 1.2, 5.2, shade(pal.pants, -8));
    // front leg
    limb(g, px + 4, hipY, frontFootX, baseY - 2, 5.4, pal.pants);
    // shoes
    g.fillStyle = pal.shoe;
    rr(g, backFootX - 3.4, baseY - 4.6 - lift * 1.2, 8.4, 4.8, 2.2);
    g.fill();
    rr(g, frontFootX - 4.2, baseY - 4.4, 9, 5, 2.4);
    g.fill();
    g.fillStyle = shadeA(pal.light, 0.22);
    rr(g, frontFootX - 3.4, baseY - 4.2, 6.8, 1.3, 0.6);
    g.fill();

    /* ── back arm ──────────────────────────────────────────────────────── */
    const backShoulderX = px - shoulder + 1.4;
    const frontShoulderX = px + shoulder - 1.4;
    const armSwing = walking ? -stride * 5.2 : 0;
    const idleSway = Math.sin(t * 1.5 + seed + 1) * 0.8;
    let backHandX = backShoulderX - 2.4 + armSwing * 0.5 + idleSway;
    let backHandY = hipY + 1.5 + (working ? -4 : 0);
    let frontHandX = frontShoulderX + 2.4 - armSwing * 0.5 - idleSway;
    let frontHandY = hipY + 1.5 + (working ? -4 : 0);

    if (working) {
      const tapA = Math.sin(t * 11 + seed) * 1.3;
      const tapB = Math.sin(t * 11 + seed + Math.PI) * 1.3;
      backHandX = px - 6.2; backHandY = shoulderY + 14 + tapA;
      frontHandX = px + 6.2; frontHandY = shoulderY + 14 + tapB;
    } else if (reviewing) {
      frontHandX = px + face * 6.6; frontHandY = shoulderY + 11;
      backHandX = px - face * 4.2; backHandY = shoulderY + 14;
    } else if (walking) {
      backHandY = hipY + 1 - Math.abs(armSwing) * 0.18;
      frontHandY = hipY + 1 - Math.abs(armSwing) * 0.18;
    }

    limb(g, backShoulderX, shoulderY + 4, (backShoulderX + backHandX) / 2 - 1.6, (shoulderY + 4 + backHandY) / 2, 4.4, shade(pal.dark, 4));
    limb(g, (backShoulderX + backHandX) / 2 - 1.6, (shoulderY + 4 + backHandY) / 2, backHandX, backHandY, 3.8, pal.dark);
    g.fillStyle = pal.skinShade;
    g.beginPath();
    g.arc(backHandX, backHandY, 2.5, 0, Math.PI * 2);
    g.fill();

    /* ── torso ─────────────────────────────────────────────────────────── */
    g.save();
    g.translate(lean, 0);
    const bodyGrad = g.createLinearGradient(px - shoulder, shoulderY, px + shoulder, hipY);
    bodyGrad.addColorStop(0, pal.light);
    bodyGrad.addColorStop(0.46, pal.base);
    bodyGrad.addColorStop(1, shade(pal.base, -16));
    g.fillStyle = bodyGrad;
    g.beginPath();
    g.moveTo(px - shoulder + 1, shoulderY + 3);
    g.quadraticCurveTo(px - shoulder - 1.2, shoulderY + 10, px - waist, hipY + 1);
    g.quadraticCurveTo(px, hipY + 3.4, px + waist, hipY + 1);
    g.quadraticCurveTo(px + shoulder + 1.2, shoulderY + 10, px + shoulder - 1, shoulderY + 3);
    g.quadraticCurveTo(px + 5.4, shoulderY - 2.6, px, shoulderY - 2.8);
    g.quadraticCurveTo(px - 5.4, shoulderY - 2.6, px - shoulder + 1, shoulderY + 3);
    g.closePath();
    g.fill();
    // side shade + seam
    g.fillStyle = "rgba(0,0,0,.16)";
    g.beginPath();
    g.moveTo(px + waist - 1.6, hipY + 1);
    g.quadraticCurveTo(px + shoulder + 0.4, shoulderY + 10, px + shoulder - 1, shoulderY + 3);
    g.quadraticCurveTo(px + 5.4, shoulderY - 2.6, px, shoulderY - 2.8);
    g.lineTo(px, hipY + 2.6);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(0,0,0,.20)";
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(px, shoulderY + 1);
    g.lineTo(px + 0.4, hipY - 1.4);
    g.stroke();

    // collar / lapels
    g.fillStyle = pal.accent;
    g.beginPath();
    g.moveTo(px - 5.2, shoulderY - 2.1);
    g.lineTo(px, shoulderY + 3.6);
    g.lineTo(px - 1.4, shoulderY - 1.2);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(px + 5.2, shoulderY - 2.1);
    g.lineTo(px, shoulderY + 3.6);
    g.lineTo(px + 1.4, shoulderY - 1.2);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(0,0,0,.22)";
    g.beginPath();
    g.moveTo(px, shoulderY + 3.6);
    g.lineTo(px - 1.5, shoulderY + 8.5);
    g.lineTo(px + 1.5, shoulderY + 8.5);
    g.closePath();
    g.fill();

    // belt / hem
    g.fillStyle = shade(pal.pants, 6);
    rr(g, px - waist + 0.8, hipY - 2.4, waist * 2 - 1.6, 3.6, 1.6);
    g.fill();
    g.fillStyle = shadeA(pal.light, 0.5);
    rr(g, px - 2, hipY - 2, 4, 2.6, 1);
    g.fill();
    g.strokeStyle = "rgba(0,0,0,.18)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(px - waist, hipY + 1);
    g.lineTo(px + waist, hipY + 1);
    g.stroke();

    // role pin on the chest
    g.fillStyle = pal.accent;
    g.beginPath();
    g.arc(px + face * 4.4, shoulderY + 7.4, 1.5, 0, Math.PI * 2);
    g.fill();
    g.restore();

    /* ── front arm ─────────────────────────────────────────────────────── */
    const elbowX = (frontShoulderX + frontHandX) / 2 + 1.8;
    const elbowY = (shoulderY + 4 + frontHandY) / 2;
    limb(g, frontShoulderX, shoulderY + 4, elbowX, elbowY, 4.6, pal.base);
    limb(g, elbowX, elbowY, frontHandX, frontHandY, 4, pal.light);
    g.fillStyle = pal.skin;
    g.beginPath();
    g.arc(frontHandX, frontHandY, 2.7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = shadeA(pal.skinHi, 0.75);
    g.beginPath();
    g.arc(frontHandX - 0.7, frontHandY - 0.8, 1.1, 0, Math.PI * 2);
    g.fill();

    /* ── head ──────────────────────────────────────────────────────────── */
    // neck
    limb(g, px, shoulderY - 1, px + lean * 0.4, headY + 5, 5.4, pal.skinShade);

    // ears
    g.fillStyle = pal.skinShade;
    g.beginPath();
    g.arc(px - 8, headY + 1.4, 2.3, 0, Math.PI * 2);
    g.arc(px + 8, headY + 1.4, 2.3, 0, Math.PI * 2);
    g.fill();

    // face
    const faceGrad = g.createRadialGradient(px - 2.6, headY - 3, 1.5, px, headY, 9.6);
    faceGrad.addColorStop(0, pal.skinHi);
    faceGrad.addColorStop(0.62, pal.skin);
    faceGrad.addColorStop(1, pal.skinShade);
    g.fillStyle = faceGrad;
    g.beginPath();
    g.ellipse(px + lean * 0.35, headY, 8.5, 9.1, 0, 0, Math.PI * 2);
    g.fill();
    // jawline
    g.fillStyle = shadeA(pal.skinShade, 0.45);
    g.beginPath();
    g.ellipse(px + face * 1.2, headY + 4.4, 5.4, 3.2, 0, 0.1, Math.PI - 0.1);
    g.fill();

    drawHair(g, c, px + lean * 0.35, headY, pal, t, seed);

    // brows
    const browLift = reviewing ? -0.7 : working ? 0.2 : 0;
    g.strokeStyle = shade(pal.hair, 12);
    g.lineWidth = 1.1;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(px - 5, headY - 3.5 + browLift);
    g.lineTo(px - 2.2, headY - 4 + browLift);
    g.moveTo(px + 2.2, headY - 4 + browLift);
    g.lineTo(px + 5, headY - 3.5 + browLift);
    g.stroke();

    // eyes (blink squashes them; catchlights keep them alive)
    const look = walking ? face * 0.8 : Math.sin(t * 0.7 + seed) * 0.7;
    for (const side of [-1, 1]) {
      const ex = px + side * 3.5 + look * 0.35;
      const ey = headY + 0.1;
      g.save();
      g.translate(ex, ey);
      g.scale(1, blink);
      g.fillStyle = "#f7f2ea";
      g.beginPath();
      g.ellipse(0, 0, 2.15, 2.55, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = pal.eye;
      g.beginPath();
      g.arc(0.25 * face, 0.35, 1.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,.92)";
      g.beginPath();
      g.arc(-0.35, -0.55, 0.62, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // nose + mouth
    g.strokeStyle = shadeA(pal.skinShade, 0.75);
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(px + face * 0.4, headY + 2.2);
    g.lineTo(px + face * 1.1, headY + 3.6);
    g.stroke();
    g.strokeStyle = shadeA(pal.eye, 0.72);
    g.lineWidth = 1;
    g.beginPath();
    if (done) {
      g.arc(px + face * 0.5, headY + 5.2, 2.4, 0.15, Math.PI - 0.15);
    } else if (reviewing) {
      g.moveTo(px - 1.9, headY + 5.4);
      g.lineTo(px + 2.4, headY + 5.2);
    } else {
      g.arc(px + face * 0.4, headY + 5.3, 1.7, 0.15, Math.PI - 0.15);
    }
    g.stroke();

    // cheeks
    g.fillStyle = shadeA(pal.prop, 0.10);
    g.beginPath();
    g.arc(px - 5.3, headY + 3.1, 2.3, 0, Math.PI * 2);
    g.arc(px + 5.3, headY + 3.1, 2.3, 0, Math.PI * 2);
    g.fill();

    drawHeadwear(g, c, px + lean * 0.35, headY, pal, t, seed, face);

    /* ── props / activity ──────────────────────────────────────────────── */
    if (working) drawWorkProp(g, c, px, shoulderY, hipY, pal, t, face);
    if (reviewing) drawReviewProp(g, c, px, shoulderY, hipY, pal, t, face, frontHandX, frontHandY);
    if (c.bubble && c.role === "planner" && !working && !reviewing) {
      // planner keeps a notebook close even between runs
      g.fillStyle = "#d9c9a8";
      rr(g, px - face * 12 - 4, hipY - 3, 9, 11, 1.6);
      g.fill();
      g.fillStyle = "#8a7656";
      g.fillRect(px - face * 12 - 2.5, hipY, 5.6, 0.8);
    }

    /* ── ambient role light ────────────────────────────────────────────── */
    if (working) {
      const pulse = 0.6 + Math.sin(t * 4.2 + seed) * 0.2;
      const glow = g.createRadialGradient(px, shoulderY + 4, 4, px, shoulderY + 4, 46);
      glow.addColorStop(0, shadeA(pal.base, 0.26 * pulse));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(px, shoulderY + 4, 46, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = shadeA(pal.light, 0.42 + Math.sin(t * 3) * 0.15);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(px, shoulderY + 4, 21, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.9 + i / 3 + seed) % 1);
        g.fillStyle = `rgba(255,236,196,${(1 - k) * 0.55})`;
        g.fillRect(px - 8 + i * 7.4, shoulderY + 14 - k * 12, 1.5, 1.5);
      }
    } else if (reviewing) {
      const a = t * 1.4 + seed;
      g.save();
      g.strokeStyle = shadeA(pal.light, 0.55);
      g.lineWidth = 1.1;
      g.setLineDash([7, 9]);
      g.lineDashOffset = -t * 18;
      g.beginPath();
      g.arc(px, shoulderY + 6, 24, a, a + Math.PI * 1.25);
      g.stroke();
      g.restore();
      g.fillStyle = shadeA(pal.light, 0.8);
      g.beginPath();
      g.arc(px - 13, shoulderY - 12 + Math.sin(t * 2) * 1.5, 1.4, 0, Math.PI * 2);
      g.fill();
    }

    drawNameplate(g, c, px, baseY, pal, plateDrop ? 32 : 0);
  }

  function drawHair(g, c, px, hy, pal, t, seed) {
    g.fillStyle = pal.hair;
    if (c.role === "planner") {
      // swept bob with a loose top knot
      g.beginPath();
      g.arc(px, hy - 1.4, 8.8, Math.PI * 0.92, Math.PI * 2.08);
      g.lineTo(px + 8.4, hy + 3.4);
      g.quadraticCurveTo(px + 5.6, hy - 1.4, px + 3.2, hy - 2.2);
      g.quadraticCurveTo(px - 2, hy - 5.6, px - 7.8, hy + 0.6);
      g.lineTo(px - 8.6, hy + 2.2);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(px + 5.6, hy - 8.2, 3.1, 0, Math.PI * 2);
      g.fill();
    } else if (c.role === "executor") {
      // short crop with a quiff
      g.beginPath();
      g.arc(px, hy - 0.8, 8.7, Math.PI * 0.96, Math.PI * 2.04);
      g.lineTo(px + 7.6, hy + 1.2);
      g.quadraticCurveTo(px + 3.4, hy - 3.4, px - 1.2, hy - 2.4);
      g.quadraticCurveTo(px - 5.6, hy - 4.2, px - 8.2, hy + 1.4);
      g.closePath();
      g.fill();
      g.beginPath();
      g.ellipse(px + 2.4, hy - 8.2, 4.4, 2.3, -0.35, 0, Math.PI * 2);
      g.fill();
    } else {
      // tied back, high bun, side strands
      g.beginPath();
      g.arc(px, hy - 0.6, 8.8, Math.PI * 0.9, Math.PI * 2.1);
      g.lineTo(px + 7.8, hy + 3.6);
      g.quadraticCurveTo(px + 4.4, hy - 2, px + 1.6, hy - 3);
      g.quadraticCurveTo(px - 4.4, hy - 5.4, px - 8.2, hy + 1.8);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(px + 4.2, hy - 9, 3.4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = pal.hair;
      g.lineWidth = 1.6;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(px - 8.2, hy + 0.6);
      g.quadraticCurveTo(px - 10.4, hy + 5.4, px - 7.6, hy + 8.2);
      g.stroke();
    }
    // hair light
    g.strokeStyle = shadeA(pal.hairHi, 0.7);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(px - 1.6, hy - 2.2, 6.4, Math.PI * 1.07, Math.PI * 1.46);
    g.stroke();
  }

  function drawHeadwear(g, c, px, hy, pal, t, seed, face) {
    if (c.role === "planner") {
      // thin round glasses + pencil behind the ear
      g.strokeStyle = "rgba(255,216,168,.82)";
      g.lineWidth = 0.9;
      g.beginPath();
      g.arc(px - 3.5, hy + 0.1, 2.7, 0, Math.PI * 2);
      g.arc(px + 3.5, hy + 0.1, 2.7, 0, Math.PI * 2);
      g.moveTo(px - 0.8, hy);
      g.lineTo(px + 0.8, hy);
      g.stroke();
      g.strokeStyle = "#e7b06a";
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(px + 7.4, hy - 4.6);
      g.lineTo(px + 9.4, hy - 9.4);
      g.stroke();
      g.fillStyle = "#f3d7a4";
      g.beginPath();
      g.arc(px + 9.5, hy - 9.8, 1, 0, Math.PI * 2);
      g.fill();
    } else if (c.role === "executor") {
      // headset band, ear cup, mic boom
      g.strokeStyle = "#8fb6d6";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px, hy - 3.6, 8.4, Math.PI * 1.08, Math.PI * 1.92);
      g.stroke();
      g.fillStyle = "#243647";
      rr(g, px + 6.6, hy - 4.6, 3.8, 6.2, 1.8);
      g.fill();
      g.fillStyle = pal.prop;
      g.beginPath();
      g.arc(px + 8.5, hy - 1.6, 1.1, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#8fb6d6";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px + 8.6, hy + 0.6);
      g.quadraticCurveTo(px + 6.8, hy + 5, px + 3.4, hy + 4.6);
      g.stroke();
      g.fillStyle = "#8fb6d6";
      g.beginPath();
      g.arc(px + 3.2, hy + 4.6, 1, 0, Math.PI * 2);
      g.fill();
    } else {
      // rectangular spectacles + lanyard badge
      g.strokeStyle = "rgba(220,236,255,.78)";
      g.lineWidth = 0.9;
      rr(g, px - 6.4, hy - 1.6, 5.3, 3.5, 1.1);
      g.stroke();
      rr(g, px + 1.1, hy - 1.6, 5.3, 3.5, 1.1);
      g.stroke();
      g.beginPath();
      g.moveTo(px - 1.1, hy);
      g.lineTo(px + 1.1, hy);
      g.stroke();
      g.strokeStyle = pal.prop;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px - 3.4, hy + 10);
      g.lineTo(px, hy + 14.4);
      g.lineTo(px + 3.4, hy + 10);
      g.stroke();
      g.fillStyle = pal.accent;
      rr(g, px - 2.2, hy + 13.6, 4.4, 5.2, 1.1);
      g.fill();
      g.fillStyle = shadeA(pal.dark, 0.8);
      g.fillRect(px - 1.4, hy + 15, 2.8, 0.8);
    }
  }

  function drawWorkProp(g, c, px, shoulderY, hipY, pal, t, face) {
    // a small glowing slate in front of the character, with live scanlines
    const w = 17;
    const h = 11;
    const x = px - w / 2 + face * 1.4;
    const y = shoulderY + 16.4;
    g.fillStyle = "rgba(0,0,0,.32)";
    rr(g, x - 1, y + 2, w + 2, h, 2.4);
    g.fill();
    const screen = g.createLinearGradient(x, y, x + w, y + h);
    screen.addColorStop(0, shade(pal.dark, 18));
    screen.addColorStop(1, "#0a1826");
    g.fillStyle = screen;
    rr(g, x, y, w, h, 2.2);
    g.fill();
    g.strokeStyle = shadeA(pal.light, 0.55);
    g.lineWidth = 0.7;
    rr(g, x, y, w, h, 2.2);
    g.stroke();
    for (let i = 0; i < 3; i++) {
      const a = 0.25 + 0.25 * Math.sin(t * 3 + i + c.seed);
      g.fillStyle = shadeA(pal.light, 0.4 + a * 0.4);
      g.fillRect(x + 2.2, y + 2.2 + i * 2.6, 6.4 + (i === 2 ? -2 : 0), 0.9);
    }
    g.fillStyle = "rgba(255,255,255,.10)";
    g.fillRect(x + 2.2, y + 1.6, w - 4.4, 0.7);
  }

  function drawReviewProp(g, c, px, shoulderY, hipY, pal, t, face, handX, handY) {
    // clipboard angled toward the reviewer, pen tapping a line
    const cx = handX + (face > 0 ? 3.4 : -14);
    const cy = handY - 6;
    g.save();
    g.translate(cx, cy);
    g.rotate(face * -0.12);
    g.fillStyle = "rgba(0,0,0,.35)";
    rr(g, 0, 2, 12, 16, 2);
    g.fill();
    const paper = g.createLinearGradient(0, 0, 12, 16);
    paper.addColorStop(0, "#f2ead9");
    paper.addColorStop(1, "#d8cbb4");
    g.fillStyle = paper;
    rr(g, 0, 0, 12, 16, 2);
    g.fill();
    g.fillStyle = "#7d6b50";
    rr(g, 3.4, -1.2, 5.2, 2.4, 1.2);
    g.fill();
    g.fillStyle = "rgba(90,76,56,.55)";
    for (let i = 0; i < 4; i++) g.fillRect(2.4, 4 + i * 2.5, i === 3 ? 4.6 : 7.2, 0.75);
    g.fillStyle = shadeA(pal.base, 0.85);
    g.fillRect(2.4, 13.4, 4, 1.1);
    g.restore();
    const tap = Math.sin(t * 7 + c.seed) * 1.2;
    g.strokeStyle = "#d9e4f2";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(handX + face * 3, handY - 2);
    g.lineTo(cx + face * 9, cy + 5 + tap);
    g.stroke();
  }

  function drawNameplate(g, c, px, py, pal, drop = 0) {
    const name = c.name || (c.role ? "Unnamed " + c.role : "—");
    const lane = c.lane || "no stamp yet";
    const model = c.model ? shortModel(c.model) : "";
    const sub = model ? `${lane} · ${model}` : lane;
    const w = 162;
    const h = 29;
    const x = clamp(px - w / 2, 4, WIDTH - w - 4);
    const y = py + 5 + drop;
    const selected = state.selected === c.role;
    const status = c.moving ? "walking" : c.phase;

    g.save();
    g.shadowColor = "rgba(0,0,0,.5)";
    g.shadowBlur = 9;
    g.shadowOffsetY = 2;
    const plate = g.createLinearGradient(x, y, x, y + h);
    plate.addColorStop(0, "rgba(14,20,31,.95)");
    plate.addColorStop(1, "rgba(8,12,19,.96)");
    g.fillStyle = plate;
    rr(g, x, y, w, h, 7);
    g.fill();
    g.restore();

    g.strokeStyle = selected ? shadeA(pal.light, 0.75) : shadeA(pal.base, 0.30);
    g.lineWidth = 1;
    rr(g, x + 0.5, y + 0.5, w - 1, h - 1, 7);
    g.stroke();

    const strip = g.createLinearGradient(x, y, x, y + h);
    strip.addColorStop(0, pal.light);
    strip.addColorStop(1, pal.base);
    g.fillStyle = strip;
    rr(g, x, y + 3, 3, h - 6, 1.5);
    g.fill();

    const dotColor = status === "working" ? "#ffcb6b"
      : status === "reviewing" ? pal.light
        : status === "walking" ? "#64b5ff"
          : status === "done" ? "#5fd39b" : "#5c6880";
    g.fillStyle = dotColor;
    g.beginPath();
    g.arc(x + 10.5, y + 10.2, 2.1, 0, Math.PI * 2);
    g.fill();
    if (status === "working" || status === "reviewing") {
      g.globalAlpha = 0.18 + Math.sin(clock / 420) * 0.08;
      g.beginPath();
      g.arc(x + 10.5, y + 10.2, 4.6, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }

    g.textBaseline = "middle";
    const roleTag = (c.role || "").toUpperCase();
    g.font = "600 7px ui-monospace, monospace";
    const roleW = g.measureText(roleTag).width;
    g.font = "650 10.5px ui-sans-serif, system-ui, sans-serif";
    g.fillStyle = "#eef3fb";
    g.fillText(fit(g, name, w - 30 - roleW), x + 16, y + 10.4);

    g.font = "600 7px ui-monospace, monospace";
    g.fillStyle = shadeA(pal.light, 0.72);
    g.textAlign = "right";
    g.fillText(roleTag, x + w - 8, y + 10.2);
    g.textAlign = "left";

    g.font = "500 8.2px ui-monospace, monospace";
    g.fillStyle = "#8a98ae";
    g.fillText(fit(g, sub, w - 18), x + 8, y + 20.6);

    // soft role light under the plate
    g.fillStyle = shadeA(pal.base, selected ? 0.16 : 0.08);
    rr(g, x + 3, y + h - 1, w - 6, 1.4, 0.7);
    g.fill();
  }

  function drawBubble(g, c, now) {
    const b = c.bubble;
    if (!b) return;
    const px = c.pos.x * TILE + TILE / 2;
    const py = c.pos.y * TILE + TILE / 2;
    const maxW = 236;
    const text = b.text.replace(/\s+/g, " ").trim();
    g.font = "500 10px ui-sans-serif, system-ui, sans-serif";
    const lines = wrapText(g, text, maxW - 20, 4);
    const w = Math.min(maxW, Math.max(92, Math.max(...lines.map((l) => g.measureText(l).width)) + 20));
    const h = 13 + lines.length * 12;
    const x = clamp(px - w / 2, 6, WIDTH - w - 6);
    const y = Math.max(6, py - 44 - h);
    const tone = b.kind === "failover" ? "#ff7185" : b.kind === "good" ? "#5fd39b" : b.kind === "warn" ? "#ffcb6b" : "#64b5ff";
    const age = Math.max(0, Math.min(1, (now - (b.at || now)) / 180));
    const ease = 1 - Math.pow(1 - age, 3);

    g.save();
    g.globalAlpha = 0.35 + ease * 0.65;
    g.translate(px, y + h);
    g.scale(0.97 + ease * 0.03, 0.97 + ease * 0.03);
    g.translate(-px, -(y + h));

    g.shadowColor = "rgba(0,0,0,.55)";
    g.shadowBlur = 14;
    g.shadowOffsetY = 3;
    const bg = g.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, "rgba(18,25,38,.98)");
    bg.addColorStop(1, "rgba(10,15,24,.98)");
    g.fillStyle = bg;
    rr(g, x, y, w, h, 8);
    g.fill();
    g.restore();

    g.strokeStyle = shadeA(tone, 0.5);
    g.lineWidth = 1;
    rr(g, x + 0.5, y + 0.5, w - 1, h - 1, 8);
    g.stroke();
    g.fillStyle = shadeA(tone, 0.9);
    rr(g, x + 7, y + 1, w - 14, 1.6, 0.8);
    g.fill();

    // tail
    g.fillStyle = "rgba(11,16,25,.98)";
    g.beginPath();
    g.moveTo(clamp(px - 4, x + 10, x + w - 16), y + h - 0.5);
    g.lineTo(clamp(px + 4, x + 16, x + w - 10), y + h - 0.5);
    g.lineTo(clamp(px, x + 10, x + w - 10), y + h + 7);
    g.closePath();
    g.fill();
    g.strokeStyle = shadeA(tone, 0.32);
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(clamp(px - 4, x + 10, x + w - 16), y + h);
    g.lineTo(clamp(px, x + 10, x + w - 10), y + h + 7);
    g.lineTo(clamp(px + 4, x + 16, x + w - 10), y + h);
    g.stroke();

    g.textBaseline = "middle";
    g.font = "500 10px ui-sans-serif, system-ui, sans-serif";
    g.fillStyle = b.kind === "failover" ? "#ffd0d6" : "#e9f0fa";
    lines.forEach((line, i) => g.fillText(line, x + 10, y + 9 + i * 12));
  }

  /* ── minimap ───────────────────────────────────────────────────────────── */

  function drawMinimap() {
    if (!mctx) return;
    const mw = minimap.width;
    const mh = minimap.height;
    const sx = mw / COLS;
    const sy = mh / ROWS;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = "#0b1018";
    mctx.fillRect(0, 0, mw, mh);
    const colors = { foundry: "#243044", hall: "#2d2b38", skyloft: "#3a2f2b", workshop: "#2a3236", yard: "#24402e" };
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] !== FLOOR) continue;
        const z = zoneAt(x, y);
        mctx.fillStyle = z ? colors[z.name] || "#243044" : "#243044";
        mctx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
      }
    }
    mctx.fillStyle = "rgba(255,200,140,.55)";
    DOORS.forEach((d) => mctx.fillRect(d.x * sx, d.y * sy, Math.ceil(sx), Math.ceil(sy)));
    for (const role of state.order) {
      const c = state.chars[role];
      if (!c) continue;
      const pal = PALETTES[c.palette];
      mctx.fillStyle = pal.light;
      mctx.beginPath();
      mctx.arc((c.pos.x + 0.5) * sx, (c.pos.y + 0.5) * sy, 2.6, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.strokeStyle = "rgba(255,255,255,.14)";
    mctx.lineWidth = 1;
    mctx.strokeRect(0.5, 0.5, mw - 1, mh - 1);
  }

  /* ── frame loop ────────────────────────────────────────────────────────── */

  function drawFrame(now) {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(staticLayer, 0, 0, WIDTH, HEIGHT);
    drawDynamic(ctx, now);
    drawMinimap();
  }

  function frame(ts) {
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    clock = ts;
    step(dt, Date.now());
    drawFrame(ts);
    raf = requestAnimationFrame(frame);
  }

  // click / hover
  function roleAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    const y = ((clientY - rect.top) / rect.height) * HEIGHT;
    let best = null;
    let bestD = 26;
    for (const role of state.order) {
      const c = state.chars[role];
      if (!c) continue;
      const px = c.pos.x * TILE + TILE / 2;
      const py = c.pos.y * TILE + TILE / 2;
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) { best = role; bestD = d; }
    }
    return best;
  }

  function onClick(ev) {
    const role = roleAt(ev.clientX, ev.clientY);
    if (role) select(role);
  }

  function onMove(ev) {
    canvas.style.cursor = roleAt(ev.clientX, ev.clientY) ? "pointer" : "default";
  }

  canvas.addEventListener("click", onClick);
  canvas.addEventListener("mousemove", onMove);

  state.started = requestAnimationFrame(frame);

  // draw once immediately so tests and first paint have a room
  drawFrame(0);

  function getState() {
    const now = Date.now();
    const chars = {};
    for (const role of state.order) {
      const c = state.chars[role];
      if (!c) { chars[role] = null; continue; }
      chars[role] = {
        role,
        name: c.name,
        lane: c.lane,
        model: c.model,
        family: c.family,
        palette: c.palette,
        seat: { ...c.seat },
        cell: { ...c.cell },
        pos: { x: Number(c.pos.x.toFixed(3)), y: Number(c.pos.y.toFixed(3)) },
        moving: c.moving,
        phase: c.phase,
        path: c.path.map((p) => ({ x: p.x, y: p.y })),
        walk: c.walk.slice(-80).map((p) => ({ x: p.x, y: p.y })),
        bubble: c.bubble && c.bubble.until > now ? { text: c.bubble.text, kind: c.bubble.kind } : null,
      };
    }
    return {
      width: WIDTH,
      height: HEIGHT,
      tile: TILE,
      cols: COLS,
      rows: ROWS,
      seats: SEATS,
      doorsteps: DOORSTEPS,
      chars,
      crew: state.crew,
      phase: state.phase,
      selected: state.selected,
      seated: state.seated,
      bubbles: state.bubbles.filter((b) => b.until > now).map((b) => ({ role: b.role, text: b.text, kind: b.kind })),
    };
  }

  function destroy() {
    cancelAnimationFrame(raf);
    canvas.removeEventListener("click", onClick);
    canvas.removeEventListener("mousemove", onMove);
  }

  return {
    canvas,
    setRoster,
    clearRoster,
    updateAgent,
    setStatus,
    startWork,
    finishWork,
    walkTo,
    reviewWalk,
    returnAll,
    resetToSeats,
    bubble,
    clearBubbles,
    select,
    setSelected,
    getState,
    destroy,
    seats: SEATS,
    doorsteps: DOORSTEPS,
    findPath: (from, to) => findPath(grid, from, to),
    sleep,
  };
}

/* ------------------------------------------------------------------------- */
/* small helpers                                                             */
/* ------------------------------------------------------------------------- */

function zoneAt(x, y) {
  for (const [name, z] of Object.entries(ZONES)) {
    if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return { ...z, name };
  }
  return null;
}

function inYard(x, y) {
  return x >= 2 && x <= 20 && y >= 17 && y <= 20;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function spaced(s) {
  return s.split("").join(" ");
}

function shortModel(model) {
  const s = String(model || "").trim();
  if (!s) return "";
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1] || s;
}

function fit(g, text, maxW) {
  let s = String(text || "");
  if (g.measureText(s).width <= maxW) return s;
  while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

function wrapText(g, text, maxW, maxLines) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (g.measureText(next).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (!lines.length) lines.push("");
  // trim overflow on the last line
  if (lines.length === maxLines && g.measureText(lines[lines.length - 1]).width > maxW) {
    lines[lines.length - 1] = fit(g, lines[lines.length - 1], maxW);
  }
  return lines;
}
