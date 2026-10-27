// The Floor — a top-down village green, drawn on canvas, driven entirely by
// bridge data handed in by app.js. No placeholder agents live here: if the
// roster is empty, the home spots are empty.
//
// Layout (36 × 22 tiles) — geometry unchanged from the office build; only
// the drawing changed (KC room pass, 2026-10-27). Building pass (same
// day): the working spots are cutaway buildings — interior floor slabs,
// side walls, foundation courses — and the Terrace/Smithy wear room
// shells (posts, wall plates, door sills). Drawing only, again.
// Pass 3 (same day): authored surfaces over procedural ones — shaped
// grass tufts, plank grain and flag bevels, roof volume, a pond
// shoreline, a sculpted oak, and the cottages' framed windows made
// real. Drawing only, still.
//   The Green  x 2..20,  y 2..14   the three home spots (facades row 2–3,
//                                  worktables row 3, seats row 4), the square
//   The Lane   x 22..24, y 2..19   connects the Green, Terrace, Smithy, Meadow
//   The Terrace x 26..34, y 2..7   lounge under a day sky
//   The Smithy  x 26..34, y 11..16 forge, bench, pegboard
//   The Meadow  x 2..20,  y 17..20 grass, pond, string lights
//
// Seats: planner (4,4) · executor (11,4) · reviewer (18,4)
// Executor doorstep: (12,4). A rose trellis at x 13..17 on row 4 forces
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
  foundry: { x0: 2, y0: 2, x1: 20, y1: 14, floor: "#6d8148", line: "#7d9157", label: "THE GREEN", labelAt: { x: 3, y: 13 } },
  hall: { x0: 22, y0: 2, x1: 24, y1: 19, floor: "#9a7c55", line: "#a98a63", label: "THE LANE", labelAt: { x: 22.1, y: 2.9 } },
  skyloft: { x0: 26, y0: 2, x1: 34, y1: 7, floor: "#9a7448", line: "#a9825a", label: "THE TERRACE", labelAt: { x: 27, y: 6.8 } },
  workshop: { x0: 26, y0: 11, x1: 34, y1: 16, floor: "#8a6c4c", line: "#987a58", label: "THE SMITHY", labelAt: { x: 27, y: 15.8 } },
  yard: { x0: 2, y0: 17, x1: 20, y1: 20, floor: "#5d8a42", line: "#6c9a50", label: "THE MEADOW", labelAt: { x: 4, y: 20.2 } },
};

// Lit-window centres of the three home spots, in tile units — the dynamic
// layer glows these when the seat's owner is really working.
const HOME_WINDOWS = {
  planner: { x: 3.65, y: 2.62 },
  executor: { x: 12.35, y: 2.62 },
  reviewer: { x: 17.65, y: 2.62 },
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

// A shaped grass tuft: four blades fanning from a root point, drawn as
// strokes — the authored replacement for speckle scatter (pass 3).
function tuft(g, x, y, s, tone) {
  g.strokeStyle = tone;
  g.lineWidth = 1.1;
  g.beginPath();
  for (const [dx, h, lean] of [[-2.6, 5.5, -1.6], [-0.9, 7, -0.5], [0.9, 6.2, 0.7], [2.6, 5, 1.7]]) {
    g.moveTo(x + dx * s, y);
    g.quadraticCurveTo(x + dx * s + lean * s * 0.4, y - h * s * 0.6, x + (dx + lean) * s, y - h * s);
  }
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
    // backdrop — deep meadow beyond the walls, never a black void
    g.fillStyle = "#2e4423";
    g.fillRect(0, 0, WIDTH, HEIGHT);

    // floors — each zone gets a material, not a flat fill
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] !== FLOOR) continue;
        const zone = zoneAt(x, y);
        const zname = zone ? zone.name : "foundry";
        let base = zone ? zone.floor : "#55703c";
        const px = x * TILE;
        const py = y * TILE;
        const n = hash(x, y);

        if (zname === "foundry") {
          // the Green: home terraces along the north edge, a stone plaza
          // around the fountain, dirt paths joining them to the Lane door
          const plaza = ((x - 11.7) / 3.6) ** 2 + ((y - 10.2) / 2.8) ** 2 <= 1;
          const path = (y === 8 && x >= 13) || (x >= 10 && x <= 11 && y >= 6 && y <= 8);
          if (y <= 5) base = "#a5855c";            // packed-earth terraces
          else if (plaza) base = "#ab9a78";       // plaza stones
          else if (path) base = "#9a7c55";        // dirt path
          g.fillStyle = shade(base, (n - 0.5) * 9);
          g.fillRect(px, py, TILE, TILE);
          if (base === "#a5855c") {
            // packed-earth terrace: pebbles, swept arcs, worn flecks
            g.fillStyle = "rgba(90,66,40,.20)";
            for (let pb = 0; pb < 3; pb++) {
              g.fillRect(px + 4 + hash(x * 7 + pb, y * 3) * 26, py + 5 + hash(x * 3, y * 7 + pb) * 24, 2.2, 1.6);
            }
            g.fillStyle = "rgba(255,238,205,.10)";
            g.fillRect(px + 6 + hash(x + 40, y) * 22, py + 8 + hash(x, y + 40) * 20, 2.6, 1.4);
            if (n > 0.84) {
              g.strokeStyle = "rgba(96,72,44,.16)";
              g.beginPath();
              g.arc(px + 18, py + 30, 13, Math.PI * 1.15, Math.PI * 1.6);
              g.stroke();
            }
          }
          if (base === "#9a7c55") {
            // worn dirt path: a pebble edge and grass creeping in
            g.fillStyle = "rgba(70,54,34,.25)";
            for (let pb2 = 0; pb2 < 2; pb2++) {
              g.beginPath();
              g.ellipse(px + 6 + hash(x * 11 + pb2, y * 3) * 24, py + 27 + hash(x * 3, y * 13 + pb2) * 6, 1.9, 1.2, 0, 0, Math.PI * 2);
              g.fill();
            }
            if (n > 0.55) tuft(g, px + 4 + hash(x, y * 9) * 6, py + TILE - 2, 0.7, "rgba(46,70,28,.4)");
          }
          if (base === "#6d8148" || base === "#ab9a78") {
            // shaped grass tufts on the green, joints + bevels on the plaza
            if (base === "#6d8148") {
              if (n > 0.16) {
                tuft(g, px + 6 + hash(x * 3, y * 7) * 10, py + 14 + hash(x * 5, y * 3) * 9, 0.9, "rgba(34,56,22,.34)");
                tuft(g, px + 19 + hash(x * 7, y * 5) * 10, py + 25 + hash(x * 3, y * 11) * 8, 0.75, "rgba(56,86,34,.30)");
              }
              if (n > 0.86) {
                g.fillStyle = "rgba(255,240,180,.14)";
                g.fillRect(px + 6 + n * 18, py + 6 + hash(y, x) * 22, 2, 2);
              }
              if (n > 0.52 && n < 0.6) {
                g.fillStyle = "rgba(190,235,150,.30)";
                for (const [cox, coy] of [[9, 12], [14, 9], [12, 16]]) {
                  g.beginPath();
                  g.arc(px + cox + n * 8, py + coy, 1.3, 0, Math.PI * 2);
                  g.fill();
                }
              }
            } else {
              g.strokeStyle = "rgba(70,58,40,.25)";
              g.beginPath();
              g.moveTo(px, py + TILE - 0.5);
              g.lineTo(px + TILE, py + TILE - 0.5);
              if ((x + y) % 2 === 0) {
                g.moveTo(px + TILE - 0.5, py);
                g.lineTo(px + TILE - 0.5, py + TILE);
              }
              g.stroke();
              // flagstone bevels: a lit top edge per stone, a worn chip
              g.fillStyle = "rgba(255,246,225,.10)";
              g.fillRect(px + 2, py + 1.5, TILE - 4, 1);
              if (n > 0.7) {
                g.fillStyle = "rgba(60,48,30,.12)";
                g.fillRect(px + 8 + n * 14, py + TILE - 5, 5, 1.4);
              }
            }
          }
        } else if (zname === "workshop") {
          // smithy floor: worn stone flags over a warm grout bed — an
          // interior surface, not swept dirt (building pass)
          g.fillStyle = shade(base, (n - 0.5) * 6);
          g.fillRect(px, py, TILE, TILE);
          const flagLite = (hash(x * 3 + 1, y * 5) - 0.5) * 10;
          g.fillStyle = flagLite > 0 ? `rgba(255,246,225,${flagLite / 90})` : `rgba(30,24,18,${-flagLite / 80})`;
          rr(g, px + 1.5, py + 1.5, TILE - 3, TILE - 3, 3);
          g.fill();
          // bevel highlight along the flag's top edge (pass 3)
          g.fillStyle = "rgba(255,250,236,.09)";
          g.fillRect(px + 3.5, py + 2.5, TILE - 7, 1.1);
          g.strokeStyle = "rgba(52,42,30,.38)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px, py + TILE / 2);
          g.lineTo(px + TILE, py + TILE / 2);
          g.moveTo(px + (n > 0.5 ? TILE * 0.36 : TILE * 0.64), py);
          g.lineTo(px + (n > 0.5 ? TILE * 0.36 : TILE * 0.64), py + TILE / 2);
          g.moveTo(px + (n > 0.5 ? TILE * 0.64 : TILE * 0.36), py + TILE / 2);
          g.lineTo(px + (n > 0.5 ? TILE * 0.64 : TILE * 0.36), py + TILE);
          g.stroke();
          if (n > 0.82) {
            g.strokeStyle = "rgba(226,192,110,.16)";
            g.beginPath();
            const sx2 = px + 6 + hash(x * 5, y * 2) * 22;
            const sy2 = py + 7 + hash(x * 2, y * 5) * 22;
            g.moveTo(sx2, sy2);
            g.lineTo(sx2 + 4.4, sy2 - 1.6);
            g.stroke();
          }
        } else if (zname === "skyloft") {
          // warm oak planks
          g.fillStyle = shade(base, (n - 0.5) * 7);
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle = "rgba(255,220,160,.05)";
          g.fillRect(px, py, TILE, TILE);
          g.strokeStyle = "rgba(60,38,20,.22)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(px, py + TILE - 0.5);
          g.lineTo(px + TILE, py + TILE - 0.5);
          g.moveTo(px + (y % 2 ? 9 : 25) + 0.5, py);
          g.lineTo(px + (y % 2 ? 9 : 25) + 0.5, py + TILE);
          g.stroke();
          // authored grain: two wavy strokes per tile, a knot now and then
          g.strokeStyle = "rgba(70,44,20,.13)";
          g.lineWidth = 0.8;
          for (const gy2 of [8 + n * 6, 21 + n * 5]) {
            g.beginPath();
            g.moveTo(px + 3, py + gy2);
            g.quadraticCurveTo(px + 16, py + gy2 + (n > 0.5 ? 1.6 : -1.6), px + 33, py + gy2 + 0.8);
            g.stroke();
          }
          g.strokeStyle = "rgba(255,230,190,.07)";
          g.beginPath();
          g.moveTo(px + 5, py + 14 + n * 8);
          g.quadraticCurveTo(px + 17, py + 13 + n * 8, px + 30, py + 14.6 + n * 8);
          g.stroke();
          if (n > 0.82) {
            g.strokeStyle = "rgba(70,44,20,.20)";
            g.beginPath();
            g.ellipse(px + 10 + n * 12, py + 11 + hash(y, x) * 12, 1.9, 1.3, 0.3, 0, Math.PI * 2);
            g.stroke();
          }
        } else if (zname === "hall") {
          // the Lane: dirt with a worn stone centre line
          g.fillStyle = shade(base, (n - 0.5) * 8);
          g.fillRect(px, py, TILE, TILE);
          if (x === 23) {
            g.fillStyle = (y % 2 ? "rgba(190,172,138,.35)" : "rgba(170,152,118,.30)");
            rr(g, px + 7, py + 4, TILE - 14, TILE - 8, 5);
            g.fill();
          }
          if (n > 0.78) {
            g.fillStyle = "rgba(255,235,200,.10)";
            g.fillRect(px + 5 + n * 20, py + 6 + hash(y, x) * 20, 2, 2);
          }
        } else if (zname === "yard") {
          // mown stripes
          g.fillStyle = shade(base, (n - 0.5) * 8);
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle = (y % 2 ? "rgba(190,240,160,.05)" : "rgba(20,40,16,.05)");
          g.fillRect(px, py, TILE, TILE);
        }
      }
    }

    // warm morning sunlight sweeping in across the Green
    const sheen = g.createLinearGradient(2 * TILE, 2 * TILE, 20 * TILE, 15 * TILE);
    sheen.addColorStop(0, "rgba(255,232,175,.07)");
    sheen.addColorStop(0.45, "rgba(255,232,175,.02)");
    sheen.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sheen;
    g.fillRect(2 * TILE, 2 * TILE, 19 * TILE, 13 * TILE);

    // daylight spilling from the Terrace windows
    const moon = g.createRadialGradient(30 * TILE, 2.2 * TILE, 10, 30 * TILE, 2.2 * TILE, 8 * TILE);
    moon.addColorStop(0, "rgba(255,240,200,.10)");
    moon.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = moon;
    g.fillRect(24 * TILE, 1 * TILE, 11 * TILE, 9 * TILE);

    // yard grass — shaped tufts scattered like the Green's, not speckle
    for (let i = 0; i < 170; i++) {
      const x = 2 + hash(i, 3) * 18;
      const y = 17 + hash(i, 7) * 3.7;
      if (!isPassable(grid, Math.floor(x), Math.floor(y)) && !inYard(x, y)) continue;
      tuft(g, x * TILE, (y + 0.12) * TILE, 0.72 + hash(i, 13) * 0.4, i % 3 ? "rgba(146,204,126,.28)" : "rgba(40,66,26,.38)");
    }
    g.fillStyle = "rgba(122,94,60,.4)";
    g.fillRect(10 * TILE + 6, 16 * TILE, TILE - 12, 4.6 * TILE);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = "rgba(190,172,138,.35)";
      g.fillRect(10 * TILE + 9 + (i % 2 ? 4 : 0), 16.2 * TILE + i * 15, 12, 6);
    }

    // the Lane's worn centre — a lighter tread down the dirt, edged with
    // grass tufts creeping in from both sides
    for (let i = 0; i < 30; i++) {
      const yy = 2.3 * TILE + i * ((16.6 * TILE) / 30);
      g.fillStyle = "rgba(255,238,205,.045)";
      g.fillRect(22.7 * TILE, yy, 1.6 * TILE, 7);
      const side = i % 2 ? 1 : -1;
      const gx = (23 + side * 1.28) * TILE;
      g.strokeStyle = "rgba(70,100,44,.5)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(gx, yy + 6);
      g.lineTo(gx + side * 2.2, yy + 1);
      g.moveTo(gx + side * 3, yy + 6);
      g.lineTo(gx + side * 4.4, yy + 2);
      g.stroke();
    }

    // warm sunlight washes — the day pooling where people live and work
    for (const [lx, ly, rad, a] of [
      [7, 5.4, 150, 0.06], [7, 10.6, 170, 0.065], [14.5, 7, 150, 0.05], [14.5, 12, 160, 0.055],
      [23, 7, 100, 0.05], [23, 15, 100, 0.045], [30, 4.4, 130, 0.055], [30, 13.5, 120, 0.05],
    ]) {
      const cx = lx * TILE;
      const cy = ly * TILE;
      const wash = g.createRadialGradient(cx, cy, 4, cx, cy, rad);
      wash.addColorStop(0, `rgba(255,228,170,${a})`);
      wash.addColorStop(0.6, `rgba(255,214,150,${a * 0.45})`);
      wash.addColorStop(1, "rgba(255,214,150,0)");
      g.fillStyle = wash;
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }

    // stone terrace in front of the three homes
    g.save();
    g.fillStyle = "rgba(171,154,120,.5)";
    rr(g, 3 * TILE - 2, 4 * TILE + 4, 17 * TILE + 4, 2.4 * TILE, 10);
    g.fill();
    g.strokeStyle = "rgba(80,66,44,.22)";
    g.lineWidth = 1.2;
    g.beginPath();
    for (let sx2 = 4; sx2 < 20; sx2++) {
      g.moveTo(sx2 * TILE, 4 * TILE + 6);
      g.lineTo(sx2 * TILE, 6.35 * TILE);
    }
    g.moveTo(3 * TILE, 5.2 * TILE);
    g.lineTo(20 * TILE, 5.2 * TILE);
    g.stroke();
    g.restore();

    // terrace rug — woven bands and warp lines over the flat fill
    g.fillStyle = "rgba(146,84,52,.4)";
    rr(g, 27 * TILE, 3 * TILE + 4, 6 * TILE, 3 * TILE, 12);
    g.fill();
    g.save();
    rr(g, 27 * TILE, 3 * TILE + 4, 6 * TILE, 3 * TILE, 12);
    g.clip();
    for (let ry2 = 0; ry2 < 7; ry2++) {
      g.fillStyle = ry2 % 2 ? "rgba(242,234,216,.05)" : "rgba(70,36,18,.05)";
      g.fillRect(27 * TILE, 3 * TILE + 4 + ry2 * 15.5, 6 * TILE, 7.5);
    }
    g.strokeStyle = "rgba(242,234,216,.10)";
    g.lineWidth = 1;
    for (let wx = 0; wx < 12; wx++) {
      g.beginPath();
      g.moveTo(27 * TILE + 9 + wx * 17, 3 * TILE + 6);
      g.lineTo(27 * TILE + 9 + wx * 17, 6 * TILE + 2);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = "rgba(240,220,185,.18)";
    g.lineWidth = 1;
    rr(g, 27 * TILE + 5, 3 * TILE + 9, 6 * TILE - 10, 3 * TILE - 10, 9);
    g.stroke();

    // smithy straw mat inside the door line
    g.fillStyle = "rgba(198,164,94,.20)";
    g.fillRect(26.2 * TILE, 11.2 * TILE, 8.6 * TILE, 5.6 * TILE);
    g.strokeStyle = "rgba(120,90,44,.28)";
    g.lineWidth = 2;
    g.setLineDash([12, 10]);
    g.strokeRect(26.2 * TILE, 11.2 * TILE, 8.6 * TILE, 5.6 * TILE);
    g.setLineDash([]);
    // the mat is woven, not printed — a plain over-under grid
    g.strokeStyle = "rgba(120,90,44,.10)";
    g.lineWidth = 1;
    g.beginPath();
    for (let mx2 = 0; mx2 < 8; mx2++) {
      g.moveTo(26.2 * TILE + 12 + mx2 * 36, 11.2 * TILE + 3);
      g.lineTo(26.2 * TILE + 12 + mx2 * 36, 16.8 * TILE - 3);
    }
    for (let my2 = 0; my2 < 5; my2++) {
      g.moveTo(26.2 * TILE + 3, 11.2 * TILE + 12 + my2 * 36);
      g.lineTo(34.8 * TILE - 3, 11.2 * TILE + 12 + my2 * 36);
    }
    g.stroke();

    // walls — warm village stone with a sunlit cap, timber baseboards,
    // ivy creeping on the inner faces and a tree-line along the outer ring
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] !== WALL) continue;
        const px = x * TILE;
        const py = y * TILE;
        const wall = g.createLinearGradient(px, py, px, py + TILE);
        wall.addColorStop(0, "#7d6244");
        wall.addColorStop(0.45, "#63492f");
        wall.addColorStop(1, "#4a3623");
        g.fillStyle = wall;
        g.fillRect(px, py, TILE, TILE);
        g.fillStyle = "rgba(255,236,200,.12)";
        g.fillRect(px, py, TILE, 2.4);
        g.fillStyle = "rgba(0,0,0,.20)";
        g.fillRect(px, py + 2.4, TILE, 1);
        // stone joints
        g.strokeStyle = "rgba(40,26,14,.20)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(px, py + TILE * 0.55);
        g.lineTo(px + TILE, py + TILE * 0.55);
        g.moveTo(px + (y % 2 ? 11 : 24), py + TILE * 0.55);
        g.lineTo(px + (y % 2 ? 11 : 24), py + TILE);
        g.moveTo(px + (y % 2 ? 24 : 11), py);
        g.lineTo(px + (y % 2 ? 24 : 11), py + TILE * 0.55);
        g.stroke();
        // baseboard where the wall meets a floor tile below
        if (y + 1 < ROWS && grid[y + 1][x] === FLOOR) {
          g.fillStyle = "#54402a";
          g.fillRect(px, py + TILE - 6, TILE, 4);
          g.fillStyle = "rgba(255,236,200,.08)";
          g.fillRect(px, py + TILE - 6, TILE, 1);
          g.fillStyle = "rgba(0,0,0,.28)";
          g.fillRect(px, py + TILE - 2, TILE, 2);
        }
        // and along a vertical wall face (floor to the right)
        if (x + 1 < COLS && grid[y][x + 1] === FLOOR) {
          g.fillStyle = "#54402a";
          g.fillRect(px + TILE - 5, py, 4, TILE);
          g.fillStyle = "rgba(255,236,200,.07)";
          g.fillRect(px + TILE - 5, py, 1, TILE);
        }
        // ivy on sunlit inner faces
        if (hash(x * 7 + 1, y * 3 + 2) > 0.68) {
          g.fillStyle = "rgba(84,128,58,.55)";
          for (let l = 0; l < 3; l++) {
            g.beginPath();
            g.ellipse(px + 7 + hash(x + l, y) * 22, py + 9 + hash(x, y + l) * 20, 3.1, 2.3, hash(x, y) * 2, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = "rgba(140,190,100,.4)";
          g.beginPath();
          g.ellipse(px + 9 + hash(x, y + 9) * 16, py + 10 + hash(x + 9, y) * 14, 1.8, 1.3, 0.4, 0, Math.PI * 2);
          g.fill();
        }
        // the outer ring is a tree-line, not a wall
        if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) {
          const ccx = px + TILE / 2;
          const ccy = py + TILE / 2;
          const canopy = g.createRadialGradient(ccx - 4, ccy - 5, 2, ccx, ccy, 21);
          canopy.addColorStop(0, "#4d7a38");
          canopy.addColorStop(0.65, "#385c2a");
          canopy.addColorStop(1, "#2a4720");
          g.fillStyle = canopy;
          g.beginPath();
          g.arc(ccx, ccy, 20, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "rgba(150,205,110,.35)";
          g.beginPath();
          g.arc(ccx - 6, ccy - 7, 5.4, 0, Math.PI * 2);
          g.fill();
          if (hash(x + 31, y + 17) > 0.8) {
            g.fillStyle = "rgba(255,170,90,.5)";
            g.beginPath();
            g.arc(ccx + 5, ccy + 3, 1.6, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }

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
      g.fillStyle = "rgba(38,46,24,.45)";
      g.fillText(spaced(zone.label), zone.labelAt.x * TILE, zone.labelAt.y * TILE);
      g.restore();
    }

    // the village notice board stands free on the Green, west of the plaza
    // (it used to hang on the north wall, where the cottage roofs now are)
    g.fillStyle = "#5d4630";
    g.fillRect(8.05 * TILE, 7.32 * TILE, 5.4, 0.5 * TILE);
    g.fillRect(11.95 * TILE, 7.32 * TILE, 5.4, 0.5 * TILE);
    g.fillStyle = "rgba(30,40,18,.25)";
    g.beginPath();
    g.ellipse(10.15 * TILE, 7.86 * TILE, 2.15 * TILE, 4.6, 0, 0, Math.PI * 2);
    g.fill();
    drawWhiteboard(g, 7.7 * TILE, 6.42 * TILE, 4.9 * TILE, 0.92 * TILE);

    // framed prints on the structural walls, so the shell has a story
    drawWallArt(g);

    // plants
    [[2, 2], [20, 2], [2, 14], [20, 14], [33, 2], [33, 17]].forEach(([x, y]) => drawPlant(g, x, y));

    // rain barrel
    drawCooler(g, 20, 6);

    // the three home spots
    drawHome(g, "planner", 3 * TILE, 3 * TILE);
    drawHome(g, "executor", 10 * TILE, 3 * TILE);
    drawHome(g, "reviewer", 17 * TILE, 3 * TILE);

    // stools (behind characters)
    for (const role of ["planner", "executor", "reviewer"]) {
      const s = SEATS[role];
      drawChair(g, s.x * TILE, s.y * TILE + 4, role);
    }

    // the village square: fountain, oak, market stall, picnic green
    drawCommons(g);

    // rose trellis
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

    // a gentle vignette only — daylight doesn't need cinema corners
    const vig = g.createRadialGradient(WIDTH * 0.46, HEIGHT * 0.38, HEIGHT * 0.3, WIDTH / 2, HEIGHT / 2, WIDTH * 0.74);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(0.74, "rgba(0,0,0,.05)");
    vig.addColorStop(1, "rgba(0,0,0,.12)");
    g.fillStyle = vig;
    g.fillRect(0, 0, WIDTH, HEIGHT);

    const topLight = g.createLinearGradient(0, 0, 0, HEIGHT * 0.4);
    topLight.addColorStop(0, "rgba(255,225,170,.04)");
    topLight.addColorStop(1, "rgba(255,225,170,0)");
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
      img.data[i + 3] = 5;
    }
    gx.putImageData(img, 0, 0);
    const pattern = g.createPattern(grain, "repeat");
    if (pattern) {
      g.fillStyle = pattern;
      g.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // a whisper of frame shadow, so the village sits inside its bezel
    const frame = g.createLinearGradient(0, 0, 0, 26);
    frame.addColorStop(0, "rgba(0,0,0,.16)");
    frame.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = frame;
    g.fillRect(0, 0, WIDTH, 26);
    g.fillStyle = "rgba(0,0,0,.10)";
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

  // A wooden rain barrel with a bucket beside it — same footprint the
  // water cooler had, same blocked cell.
  function drawCooler(g, tx, ty) {
    const x = tx * TILE + 7;
    const y = ty * TILE + 2;
    g.fillStyle = "rgba(0,0,0,.25)";
    g.beginPath();
    g.ellipse(x + 10, y + 30, 12, 3.6, 0, 0, Math.PI * 2);
    g.fill();
    // barrel body — staves and iron hoops
    const body = g.createLinearGradient(x, y + 4, x + 20, y + 4);
    body.addColorStop(0, "#7a5a38");
    body.addColorStop(0.5, "#966f45");
    body.addColorStop(1, "#6e5133");
    g.fillStyle = body;
    rr(g, x + 1, y + 5, 18, 26, 4);
    g.fill();
    g.strokeStyle = "rgba(46,30,16,.35)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + 6.6, y + 6);
    g.lineTo(x + 6.6, y + 30);
    g.moveTo(x + 13.4, y + 6);
    g.lineTo(x + 13.4, y + 30);
    g.stroke();
    g.fillStyle = "#3d3d42";
    g.fillRect(x + 0.6, y + 10, 18.8, 2.4);
    g.fillRect(x + 0.6, y + 24, 18.8, 2.4);
    g.fillStyle = "rgba(255,235,200,.18)";
    g.fillRect(x + 0.6, y + 10, 18.8, 0.8);
    // water surface in the open top
    const water = g.createRadialGradient(x + 10, y + 7, 1, x + 10, y + 7, 8);
    water.addColorStop(0, "rgba(150,205,240,.85)");
    water.addColorStop(1, "rgba(70,130,190,.7)");
    g.fillStyle = water;
    g.beginPath();
    g.ellipse(x + 10, y + 7, 8.4, 2.8, 0, 0, Math.PI * 2);
    g.fill();
    // the bucket
    g.fillStyle = "#8a8f96";
    g.beginPath();
    g.moveTo(x + 21, y + 20);
    g.lineTo(x + 27.4, y + 20);
    g.lineTo(x + 26.2, y + 29);
    g.lineTo(x + 22.2, y + 29);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(30,30,34,.5)";
    g.beginPath();
    g.arc(x + 24.2, y + 19.4, 3.1, Math.PI, 0);
    g.stroke();
    g.fillStyle = "rgba(150,205,240,.6)";
    g.beginPath();
    g.ellipse(x + 24.2, y + 20.4, 2.9, 0.9, 0, 0, Math.PI * 2);
    g.fill();
  }

  // The three home spots. Each seat's desk becomes a little house front on
  // the Green's north edge: its own roof colour, wall finish and dressing,
  // a door the character walks out of, a lit window (the dynamic layer adds
  // the working glow at HOME_WINDOWS), and a worktable at row 3 where the
  // craft of the role shows. x,y = the seat's desk tile, as drawDesk had it.
  function drawHome(g, role, x, y) {
    const pal = PALETTES[({ planner: "sunset", executor: "ocean", reviewer: "violet" })[role]];
    const cx = x + TILE / 2;
    const HOMES = {
      planner: { roof: "#c96f3f", wall: "#f0dcbc", doorSide: 1 },
      executor: { roof: "#5d7d99", wall: "#cfd6d4", doorSide: -1 },
      reviewer: { roof: "#7d5a99", wall: "#e6d9f2", doorSide: 1 },
    };
    const home = HOMES[role] || HOMES.planner;
    const fx = cx - 1.55 * TILE;          // facade left
    const fw = 3.1 * TILE;                // facade width
    const fy = 1.62 * TILE;               // facade top (eaves line)
    const fb = 3.18 * TILE;               // facade bottom (ground line)
    const doorW = 0.52 * TILE;
    const doorX = home.doorSide > 0 ? cx + 0.28 * TILE : cx - 0.28 * TILE - doorW;
    // the framed window sits on the wall opposite the door, centred on
    // the HOME_WINDOWS line (2.62) the lamplight and working flare use
    const winCx = cx + (home.doorSide > 0 ? -0.68 : 0.68) * TILE;
    const winCy = 2.62 * TILE;

    /* ---- the cutaway interior (building pass, 2026-10-27) ----
       The cottage is a room you look into, not a facade on the lawn:
       an interior floor slab (planks or stone flags, never the outdoor
       earth), side walls with real thickness, the cut front wall left
       as low stubs at the corners, a stone foundation course under the
       front edge, and stepping stones where the path meets the room.
       The worktable and the seat row sit inside this room. */
    const slabX0 = fx - 5;
    const slabX1 = fx + fw + 5;
    const slabTop = fb - 3;
    const slabBot = 4.88 * TILE;
    const seed = role === "planner" ? 3 : role === "executor" ? 7 : 11;

    // ground shadow spilling from under the front foundation
    const slabShadow = g.createLinearGradient(0, slabBot + 12, 0, slabBot + 20);
    slabShadow.addColorStop(0, "rgba(24,32,14,.34)");
    slabShadow.addColorStop(1, "rgba(24,32,14,0)");
    g.fillStyle = slabShadow;
    g.fillRect(slabX0 - 3, slabBot + 12, slabX1 - slabX0 + 6, 8);

    // interior floor surface — a material, not the yard
    const floorBase = role === "executor" ? "#8f887b" : role === "planner" ? "#a57c50" : "#9c7a58";
    g.fillStyle = floorBase;
    g.fillRect(slabX0, slabTop, slabX1 - slabX0, slabBot - slabTop);
    if (role === "executor") {
      // stone flags: courses with offset joints, shade wandering per flag
      const rows = 4;
      for (let ry = 0; ry < rows; ry++) {
        const fy2 = slabTop + (ry * (slabBot - slabTop)) / rows;
        const fh = (slabBot - slabTop) / rows;
        let fx2 = slabX0 - (ry % 2 ? 13 : 0);
        while (fx2 < slabX1) {
          const fwFlag = 25 + hash(Math.round(fx2 * 0.7), ry * 3 + seed) * 9;
          const flagW = Math.min(fwFlag, slabX1 - fx2) - 2;
          if (flagW > 1) {
            const lite = hash(fx2, ry + seed) > 0.5;
            g.fillStyle = lite ? "rgba(255,246,225,.07)" : "rgba(40,34,26,.07)";
            rr(g, fx2 + 1, fy2 + 1, flagW, fh - 2, 2.4);
            g.fill();
            // bevel: the flag's top edge catches the light
            g.fillStyle = "rgba(255,250,236,.10)";
            g.fillRect(fx2 + 3, fy2 + 2, Math.max(0, flagW - 5), 1);
          }
          fx2 += fwFlag;
        }
        g.fillStyle = "rgba(52,45,36,.4)";
        g.fillRect(slabX0, fy2, slabX1 - slabX0, 1);
      }
    } else {
      // wood planks: courses run east-west, light wandering per course
      const courseH = 10.5;
      for (let cy2 = slabTop, ci = 0; cy2 < slabBot; cy2 += courseH, ci++) {
        g.fillStyle = ci % 2 ? "rgba(255,232,190,.055)" : "rgba(52,32,14,.055)";
        g.fillRect(slabX0, cy2, slabX1 - slabX0, Math.min(courseH, slabBot - cy2));
        g.fillStyle = "rgba(58,36,16,.34)";
        g.fillRect(slabX0, Math.min(cy2 + courseH - 1, slabBot - 1), slabX1 - slabX0, 1);
        const jointX = slabX0 + 12 + hash(ci * 3, seed) * (slabX1 - slabX0 - 24);
        g.fillRect(jointX, cy2, 1, Math.min(courseH, slabBot - cy2));
        // grain running the course's length + a pale cut face at the end
        const gy3 = Math.min(cy2 + 3 + hash(ci * 7, seed) * 4, slabBot - 2);
        g.strokeStyle = "rgba(66,40,16,.12)";
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(slabX0 + 6 + hash(ci, seed * 2) * 22, gy3);
        g.quadraticCurveTo(slabX0 + (slabX1 - slabX0) / 2, gy3 + 1.2, slabX0 + (slabX1 - slabX0) - 8 - hash(ci * 3, seed) * 16, gy3 + 0.6);
        g.stroke();
        g.fillStyle = "rgba(255,236,200,.13)";
        g.fillRect(jointX - 1, cy2 + 1.5, 1, Math.max(0, Math.min(courseH, slabBot - cy2) - 3));
      }
    }
    // a woven rug under the worktable and seat — the lived-in middle
    g.fillStyle = role === "reviewer" ? "rgba(125,90,153,.28)" : role === "planner" ? "rgba(198,110,62,.20)" : "rgba(70,54,36,.20)";
    rr(g, cx - 1.05 * TILE, 3.42 * TILE, 2.1 * TILE, 1.28 * TILE, 5);
    g.fill();
    g.strokeStyle = "rgba(255,240,215,.16)";
    g.lineWidth = 1;
    rr(g, cx - 1.05 * TILE + 2.5, 3.42 * TILE + 2.5, 2.1 * TILE - 5, 1.28 * TILE - 5, 4);
    g.stroke();

    // side walls: a real thickness of wall running from the facade to
    // the front edge, with a skirting shadow where wall meets floor
    const wallW = 12;
    for (const sx of [slabX0, slabX1 - wallW]) {
      const leftSide = sx === slabX0;
      const wallFace = g.createLinearGradient(sx, 0, sx + wallW, 0);
      wallFace.addColorStop(0, shade(home.wall, leftSide ? -46 : -30));
      wallFace.addColorStop(0.45, shade(home.wall, -26));
      wallFace.addColorStop(1, shade(home.wall, -44));
      g.fillStyle = wallFace;
      g.fillRect(sx, slabTop + 4, wallW, slabBot - slabTop - 4);
      g.fillStyle = "rgba(30,20,10,.4)";
      g.fillRect(leftSide ? sx : sx + wallW - 1, slabTop + 4, 1, slabBot - slabTop - 4);
      g.fillStyle = "rgba(30,20,10,.20)";
      g.fillRect(leftSide ? sx + wallW : sx - 3, slabTop + 6, 3, slabBot - slabTop - 8);
    }

    // contact shadow pooled under the back wall
    const backShadow = g.createLinearGradient(0, slabTop, 0, slabTop + 13);
    backShadow.addColorStop(0, "rgba(30,18,6,.24)");
    backShadow.addColorStop(1, "rgba(30,18,6,0)");
    g.fillStyle = backShadow;
    g.fillRect(slabX0 + wallW, slabTop, slabX1 - slabX0 - wallW * 2, 13);

    // cut front wall: low stubs left standing at both corners, the
    // opening in the middle — the cutaway tell
    for (const stX of [slabX0, slabX1 - 0.5 * TILE]) {
      g.fillStyle = shade(home.wall, -14);
      g.fillRect(stX, slabBot - 16, 0.5 * TILE, 16);
      g.fillStyle = shade(home.wall, 18);
      g.fillRect(stX, slabBot - 16, 0.5 * TILE, 3);
      g.fillStyle = "rgba(255,246,220,.35)";
      g.fillRect(stX, slabBot - 16, 0.5 * TILE, 1);
      g.fillStyle = "rgba(30,20,10,.35)";
      g.fillRect(stX, slabBot - 1, 0.5 * TILE, 1);
    }

    // foundation course: stone blocks carrying the front edge, with
    // short returns running back under the side walls
    g.fillStyle = "#7d7466";
    g.fillRect(slabX0 - 2, slabBot, slabX1 - slabX0 + 4, 13);
    for (let bx = slabX0 - 2, bi = 0; bx < slabX1 + 2; bx += 17, bi++) {
      g.fillStyle = bi % 2 ? "rgba(255,246,225,.07)" : "rgba(38,32,24,.07)";
      g.fillRect(bx, slabBot, Math.min(17, slabX1 + 2 - bx), 13);
      g.fillStyle = "rgba(40,34,26,.45)";
      g.fillRect(bx, slabBot, 1, 13);
    }
    g.fillStyle = "rgba(255,242,214,.4)";
    g.fillRect(slabX0 - 2, slabBot, slabX1 - slabX0 + 4, 1);
    g.fillStyle = "rgba(255,242,214,.16)";
    g.fillRect(slabX0 - 2, slabBot + 1, slabX1 - slabX0 + 4, 1);
    g.fillStyle = "rgba(20,16,10,.4)";
    g.fillRect(slabX0 - 2, slabBot + 12, slabX1 - slabX0 + 4, 1);
    g.fillStyle = "#6b6357";
    g.fillRect(slabX0 - 4, slabTop + 12, 3, slabBot + 13 - slabTop - 12);
    g.fillRect(slabX1 + 1, slabTop + 12, 3, slabBot + 13 - slabTop - 12);

    // stepping stones from the front opening down across the terrace —
    // the path arrives at the room instead of the lawn
    g.fillStyle = "#b3a58a";
    for (const [sox, soy, sr] of [[0, 0.34, 10.5], [4, 0.8, 8.8]]) {
      const scx = doorX + doorW / 2 + sox;
      g.beginPath();
      g.ellipse(scx, slabBot + soy * TILE, sr, sr * 0.34, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(70,58,40,.4)";
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(scx, slabBot + soy * TILE, sr, sr * 0.34, 0, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }

    // soft ground shadow the house stands on
    g.fillStyle = "rgba(30,40,18,.28)";
    g.beginPath();
    g.ellipse(cx, fb + 3, fw / 2 + 3, 5.4, 0, 0, Math.PI * 2);
    g.fill();

    // wall
    const wallGrad = g.createLinearGradient(0, fy, 0, fb);
    wallGrad.addColorStop(0, home.wall);
    wallGrad.addColorStop(1, shade(home.wall, -22));
    g.fillStyle = wallGrad;
    g.fillRect(fx, fy, fw, fb - fy);
    // timber framing: corner posts, mid post, sill beam
    g.fillStyle = "#6b4f35";
    g.fillRect(fx, fy, 5, fb - fy);
    g.fillRect(fx + fw - 5, fy, 5, fb - fy);
    g.fillRect(cx - 2.2, fy, 4.4, fb - fy);
    g.fillRect(fx, fb - 6, fw, 6);
    g.fillStyle = "rgba(255,255,255,.16)";
    g.fillRect(fx, fb - 6, fw, 1);

    // roof: gable cap, shingle courses, ridge highlight
    const roofGrad = g.createLinearGradient(0, fy - 0.52 * TILE, 0, fy + 4);
    roofGrad.addColorStop(0, shade(home.roof, 22));
    roofGrad.addColorStop(1, shade(home.roof, -14));
    g.fillStyle = roofGrad;
    g.beginPath();
    g.moveTo(fx - 7, fy + 3);
    g.lineTo(cx, fy - 0.55 * TILE);
    g.lineTo(fx + fw + 7, fy + 3);
    g.lineTo(fx + fw + 2, fy + 9);
    g.lineTo(cx, fy - 0.42 * TILE);
    g.lineTo(fx - 2, fy + 9);
    g.closePath();
    g.fill();
    // two planes meeting at the ridge (pass 3): the west slope takes
    // the sun, the east slope sits a breath darker — volume, not stencil
    g.fillStyle = shadeA(shade(home.roof, 10), 0.30);
    g.beginPath();
    g.moveTo(fx - 7, fy + 3);
    g.lineTo(cx, fy - 0.55 * TILE);
    g.lineTo(cx, fy - 0.42 * TILE);
    g.lineTo(fx - 2, fy + 9);
    g.closePath();
    g.fill();
    g.fillStyle = shadeA(shade(home.roof, -16), 0.38);
    g.beginPath();
    g.moveTo(cx, fy - 0.55 * TILE);
    g.lineTo(fx + fw + 7, fy + 3);
    g.lineTo(fx + fw + 2, fy + 9);
    g.lineTo(cx, fy - 0.42 * TILE);
    g.closePath();
    g.fill();
    // bargeboard trim just inside both slopes
    g.strokeStyle = "rgba(255,240,210,.22)";
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(fx + 1, fy + 7);
    g.lineTo(cx, fy - 0.50 * TILE);
    g.lineTo(fx + fw - 1, fy + 7);
    g.stroke();
    g.strokeStyle = "rgba(46,28,14,.30)";
    g.lineWidth = 1;
    for (const t of [0.38, 0.66]) {
      g.beginPath();
      g.moveTo(cx - (cx - fx) * (1 - t) - 4, fy - 0.55 * TILE + (0.55 * TILE + 3) * t);
      g.lineTo(cx + (cx - fx) * (1 - t) + 4, fy - 0.55 * TILE + (0.55 * TILE + 3) * t);
      g.stroke();
    }
    g.strokeStyle = "rgba(255,240,210,.35)";
    g.beginPath();
    g.moveTo(fx - 5, fy + 2.4);
    g.lineTo(cx, fy - 0.55 * TILE - 1);
    g.lineTo(fx + fw + 5, fy + 2.4);
    g.stroke();
    // roof thickness: the eaves edge is a board, not a line — a dark
    // cut edge, a timber fascia under it, and the shadow the overhang
    // throws down the wall face
    g.strokeStyle = "rgba(46,28,14,.55)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(fx - 2, fy + 9);
    g.lineTo(cx, fy - 0.42 * TILE);
    g.lineTo(fx + fw + 2, fy + 9);
    g.stroke();
    g.strokeStyle = "#5d4630";
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(fx - 2, fy + 12);
    g.lineTo(cx, fy - 0.42 * TILE + 3);
    g.lineTo(fx + fw + 2, fy + 12);
    g.stroke();
    const eaveShadow = g.createLinearGradient(0, fy + 13, 0, fy + 30);
    eaveShadow.addColorStop(0, "rgba(43,26,10,.20)");
    eaveShadow.addColorStop(1, "rgba(43,26,10,0)");
    g.fillStyle = eaveShadow;
    g.fillRect(fx - 2, fy + 13, fw + 4, 17);
    // the far slope (pass 3): a sliver of roof plane behind the ridge
    // on the door side, and eave returns where the roof wraps the two
    // front corners — the shell gains a third dimension
    const farSide = home.doorSide > 0 ? 1 : -1;
    const eaveFarX = farSide > 0 ? fx + fw + 7 : fx - 7;
    g.fillStyle = shadeA(shade(home.roof, -34), 0.85);
    g.beginPath();
    g.moveTo(cx, fy - 0.55 * TILE);
    g.lineTo(eaveFarX, fy + 3);
    g.lineTo(eaveFarX + farSide * 9, fy - 1);
    g.lineTo(cx + farSide * 9, fy - 0.55 * TILE - 4);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(255,240,210,.30)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx + farSide * 9, fy - 0.55 * TILE - 4);
    g.lineTo(eaveFarX + farSide * 9, fy - 1);
    g.stroke();
    for (const retX of [fx - 14, fx + fw + 7]) {
      g.fillStyle = shade(home.roof, -20);
      g.fillRect(retX, fy + 1, 7, 6);
      g.fillStyle = "rgba(255,240,210,.28)";
      g.fillRect(retX, fy + 1, 7, 1);
      g.fillStyle = "rgba(43,26,10,.30)";
      g.fillRect(retX, fy + 6, 7, 1);
    }
    // chimney puff house gets a chimney on the executor's smithy-cottage
    if (role === "executor") {
      g.fillStyle = "#8d8578";
      g.fillRect(cx + 0.78 * TILE, fy - 0.78 * TILE, 9, 16);
      g.fillStyle = "#6e675c";
      g.fillRect(cx + 0.78 * TILE - 1.4, fy - 0.78 * TILE, 11.8, 3.4);
    }

    // door — the panel the character's doorstep faces
    const doorGrad = g.createLinearGradient(doorX, 0, doorX + doorW, 0);
    doorGrad.addColorStop(0, "#7a5a38");
    doorGrad.addColorStop(1, "#5f452b");
    g.fillStyle = doorGrad;
    rr(g, doorX, 2.28 * TILE, doorW, 0.9 * TILE, 3);
    g.fill();
    g.strokeStyle = "rgba(46,30,16,.5)";
    g.lineWidth = 1;
    rr(g, doorX + 2.4, 2.33 * TILE, doorW - 4.8, 0.8 * TILE, 2);
    g.stroke();
    g.fillStyle = "#e8c478";
    g.beginPath();
    g.arc(doorX + (home.doorSide > 0 ? 4.6 : doorW - 4.6), 2.74 * TILE, 1.7, 0, Math.PI * 2);
    g.fill();
    // a stone threshold step at the door, sitting on the interior slab
    g.fillStyle = "#6e675c";
    rr(g, doorX - 5, fb + 5.5, doorW + 10, 4.5, 1.6);
    g.fill();
    g.fillStyle = "#a29885";
    rr(g, doorX - 5, fb - 1.5, doorW + 10, 7.5, 1.8);
    g.fill();
    g.fillStyle = "rgba(255,246,220,.35)";
    g.fillRect(doorX - 3, fb - 1, doorW + 6, 1);
    // role-coloured doorstep mat
    g.fillStyle = shadeA(pal.base, 0.5);
    rr(g, doorX - 2, 3.2 * TILE, doorW + 4, 4.6, 2);
    g.fill();

    // window with a warm lit interior, a stone sill and a flower box —
    // sized to read at full-room zoom (pass 3)
    g.fillStyle = "#54402a";
    rr(g, winCx - 12.7, winCy - 11.2, 25.4, 22.4, 3);
    g.fill();
    const glow = g.createRadialGradient(winCx, winCy, 1, winCx, winCy, 12);
    glow.addColorStop(0, "#fff3c4");
    glow.addColorStop(1, "#eda93e");
    g.fillStyle = glow;
    rr(g, winCx - 10.7, winCy - 9.2, 21.4, 18.4, 2);
    g.fill();
    g.strokeStyle = "rgba(84,64,42,.75)";
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(winCx, winCy - 9.2);
    g.lineTo(winCx, winCy + 9.2);
    g.moveTo(winCx - 10.7, winCy);
    g.lineTo(winCx + 10.7, winCy);
    g.stroke();
    // stone sill under the frame
    g.fillStyle = "#6e675c";
    rr(g, winCx - 13.7, winCy + 11.2, 27.4, 3.4, 1.4);
    g.fill();
    g.fillStyle = "rgba(255,246,220,.32)";
    g.fillRect(winCx - 12.7, winCy + 11.2, 25.4, 1);
    // flower box, sitting on the sill
    g.fillStyle = "#7a5a38";
    rr(g, winCx - 11.7, winCy + 13.4, 23.4, 5.6, 2);
    g.fill();
    g.fillStyle = "#4d7a38";
    g.beginPath();
    g.ellipse(winCx - 6, winCy + 13.8, 4.2, 2.3, 0, 0, Math.PI * 2);
    g.ellipse(winCx + 5.6, winCy + 14, 4.4, 2.4, 0, 0, Math.PI * 2);
    g.fill();
    for (const [fxo, col] of [[-8.6, "#e86a7a"], [-3.4, "#f2f0e6"], [1.8, "#e8a84c"], [6.8, "#e86a7a"], [9.8, "#f2b64f"]]) {
      g.fillStyle = col;
      g.beginPath();
      g.arc(winCx + fxo, winCy + 12.4, 1.7, 0, Math.PI * 2);
      g.fill();
    }

    /* the worktable at row 3 — each role's craft on show */
    const top = 3 * TILE + 17;
    const tx = x + 2;
    const tw = 2 * TILE - 4;
    const wood = g.createLinearGradient(tx, top, tx, top + 18);
    wood.addColorStop(0, "#8a6a44");
    wood.addColorStop(0.5, "#71552f");
    wood.addColorStop(1, "#573f22");
    g.fillStyle = wood;
    rr(g, tx, top, tw, 18, 3);
    g.fill();
    g.strokeStyle = "rgba(255,225,175,.18)";
    g.lineWidth = 1;
    rr(g, tx + 0.5, top + 0.5, tw - 1, 17, 2.6);
    g.stroke();
    // grain along the tabletop boards
    g.strokeStyle = "rgba(46,30,16,.25)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(tx + 5, top + 6);
    g.quadraticCurveTo(tx + tw / 2, top + 7.5, tx + tw - 5, top + 6);
    g.moveTo(tx + 5, top + 12.5);
    g.quadraticCurveTo(tx + tw / 2, top + 11, tx + tw - 5, top + 12.5);
    g.stroke();

    if (role === "planner") {
      // drafting table: a chart unrolled, scrolls, a quill pot
      g.fillStyle = "#efe3c2";
      rr(g, cx - 17, top + 2.6, 34, 12.4, 1.4);
      g.fill();
      g.strokeStyle = "rgba(120,140,90,.65)";
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(cx - 11, top + 8.6);
      g.bezierCurveTo(cx - 5, top + 4.6, cx + 3, top + 10.6, cx + 11, top + 5.8);
      g.stroke();
      g.fillStyle = "#c96f3f";
      g.beginPath();
      g.arc(cx - 7.4, top + 7, 1.5, 0, Math.PI * 2);
      g.arc(cx + 5.4, top + 8.4, 1.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#e8dcc0";
      rr(g, cx - 21, top + 3.4, 4.6, 9, 2.2);
      g.fill();
      rr(g, cx + 16.6, top + 2.8, 4.6, 9.6, 2.2);
      g.fill();
      g.fillStyle = "#6b4f35";
      rr(g, cx + 19, top - 1.4, 5.4, 6.4, 1.4);
      g.fill();
      g.strokeStyle = "#f3eedd";
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(cx + 21.6, top + 4.4);
      g.quadraticCurveTo(cx + 24.6, top - 3.4, cx + 26.8, top - 4.6);
      g.stroke();
    } else if (role === "executor") {
      // workbench: plank stack, a hammer, and a horseshoe keepsake
      g.fillStyle = "#a37f52";
      rr(g, cx - 20, top + 3, 15, 4.4, 1);
      g.fill();
      g.fillStyle = "#8f6c42";
      rr(g, cx - 19, top + 8, 15, 4.4, 1);
      g.fill();
      g.strokeStyle = "#5a4630";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(cx + 8, top + 11);
      g.lineTo(cx + 15.4, top + 3.8);
      g.stroke();
      g.fillStyle = "#9aa2ab";
      rr(g, cx + 13.6, top + 1.2, 7.6, 4.6, 1.2);
      g.fill();
      g.strokeStyle = "#7c8894";
      g.lineWidth = 1.3;
      g.beginPath();
      g.arc(cx + 1.4, top + 7.6, 3.4, Math.PI * 0.75, Math.PI * 2.25);
      g.stroke();
      g.fillStyle = pal.base;
      g.beginPath();
      g.arc(cx - 12.4, top + 5.4, 1.6, 0, Math.PI * 2);
      g.fill();
    } else {
      // reading table: a stack of books, one open, a teapot
      const bookCols = ["#7d5a99", "#a8542f", "#476b8f"];
      bookCols.forEach((bc, i) => {
        g.fillStyle = bc;
        rr(g, cx - 20 + i * 0.8, top + 8.6 - i * 3.1, 12.4, 3, 1);
        g.fill();
        g.fillStyle = "rgba(240,232,210,.75)";
        g.fillRect(cx - 18.6 + i * 0.8, top + 9.5 - i * 3.1, 9.4, 1);
      });
      g.fillStyle = "#f0e7d2";
      g.beginPath();
      g.moveTo(cx - 2, top + 4);
      g.lineTo(cx + 1.4, top + 3);
      g.lineTo(cx + 1.4, top + 10.6);
      g.lineTo(cx - 2, top + 11.6);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(cx + 12, top + 4);
      g.lineTo(cx + 8.6, top + 3);
      g.lineTo(cx + 8.6, top + 10.6);
      g.lineTo(cx + 12, top + 11.6);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(110,95,70,.55)";
      g.lineWidth = 0.7;
      for (const lx of [-0.4, 10.4]) {
        g.beginPath();
        g.moveTo(cx + lx - 1.4, top + 6);
        g.lineTo(cx + lx + 1.8, top + 5.4);
        g.moveTo(cx + lx - 1.4, top + 8.4);
        g.lineTo(cx + lx + 1.8, top + 7.8);
        g.stroke();
      }
      // teapot
      g.fillStyle = "#b8bcc2";
      g.beginPath();
      g.ellipse(cx + 17.6, top + 8.6, 4.6, 3.6, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#8f959d";
      g.fillRect(cx + 16.2, top + 3.8, 2.8, 1.8);
      g.strokeStyle = "#8f959d";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx + 21.6, top + 7.4);
      g.quadraticCurveTo(cx + 24.4, top + 6.4, cx + 24, top + 9.8);
      g.stroke();
    }

    /* role dressing on the terrace beside the table */
    if (role === "planner") {
      // flower bed + watering can along the west side
      g.fillStyle = "#5d4630";
      rr(g, fx - 1, fb + 1, 1.28 * TILE, 7, 3);
      g.fill();
      g.fillStyle = "#4d7a38";
      for (let bIdx = 0; bIdx < 4; bIdx++) {
        g.beginPath();
        g.ellipse(fx + 5 + bIdx * 10.4, fb + 3.4, 4.4, 2.6, 0, 0, Math.PI * 2);
        g.fill();
      }
      for (const [bxo, col] of [[4, "#e86a7a"], [14, "#f2b64f"], [24, "#e86a7a"], [34, "#f2f0e6"], [42, "#f2b64f"]]) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(fx + bxo, fb + 1.8, 1.8, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "#7f9c46";
      rr(g, fx + fw - 20, fb - 11, 11, 8.6, 2);
      g.fill();
      g.strokeStyle = "#5d7038";
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(fx + fw - 20, fb - 8);
      g.lineTo(fx + fw - 25.4, fb - 12.6);
      g.stroke();
      g.fillStyle = "#7f9c46";
      g.beginPath();
      g.moveTo(fx + fw - 27.4, fb - 13.6);
      g.lineTo(fx + fw - 23.2, fb - 13.2);
      g.lineTo(fx + fw - 24.8, fb - 10.4);
      g.closePath();
      g.fill();
    } else if (role === "executor") {
      // a barrel and a leaning plank by the door; horseshoe over the frame
      g.fillStyle = "#7a5a38";
      rr(g, fx + fw - 16, fb - 15, 13, 16, 3.4);
      g.fill();
      g.fillStyle = "#3d3d42";
      g.fillRect(fx + fw - 16.4, fb - 11, 13.8, 2);
      g.fillRect(fx + fw - 16.4, fb - 4.4, 13.8, 2);
      g.save();
      g.translate(fx + 6, fb - 4);
      g.rotate(-0.32);
      g.fillStyle = "#a37f52";
      g.fillRect(0, 0, 22, 4.6);
      g.restore();
      g.strokeStyle = "#c8ccd2";
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(doorX + doorW / 2, 2.22 * TILE, 3.6, Math.PI * 0.8, Math.PI * 2.2);
      g.stroke();
    } else {
      // climbing vine up the east post + a hanging lantern by the door
      g.strokeStyle = "#4d7a38";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(fx + fw - 3, fb);
      g.bezierCurveTo(fx + fw - 7, fb - 0.5 * TILE, fx + fw + 1, fb - 0.9 * TILE, fx + fw - 4, fy + 8);
      g.stroke();
      g.fillStyle = "rgba(96,150,66,.8)";
      for (let v = 0; v < 5; v++) {
        g.beginPath();
        g.ellipse(fx + fw - 4 + Math.sin(v * 1.7) * 3.4, fb - 8 - v * 9.6, 3, 2, v, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "#a86fc0";
      for (const vy of [fb - 26, fb - 52, fb - 76]) {
        g.beginPath();
        g.arc(fx + fw - 1.4, vy, 1.7, 0, Math.PI * 2);
        g.fill();
      }
      const lx2 = doorX + doorW + 7;
      g.strokeStyle = "#54402a";
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(lx2, 2.14 * TILE);
      g.lineTo(lx2, 2.34 * TILE);
      g.stroke();
      g.fillStyle = "#54402a";
      rr(g, lx2 - 3.4, 2.34 * TILE, 6.8, 8.6, 1.6);
      g.fill();
      g.fillStyle = "#ffd98a";
      rr(g, lx2 - 2, 2.38 * TILE, 4, 5.6, 1);
      g.fill();
    }
  }

  // A wooden stool with a cushion in the seat's colour — the chair became
  // part of the home spot.
  function drawChair(g, x, y, role) {
    const pal = PALETTES[({ planner: "sunset", executor: "ocean", reviewer: "violet" })[role]] || PALETTES.sunset;
    const cx = x + TILE / 2;
    g.fillStyle = "rgba(0,0,0,.25)";
    g.beginPath();
    g.ellipse(cx, y + 20, 12, 4.2, 0, 0, Math.PI * 2);
    g.fill();
    // legs
    g.strokeStyle = "#5f452b";
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx - 7, y + 12);
    g.lineTo(cx - 8.6, y + 19.4);
    g.moveTo(cx + 7, y + 12);
    g.lineTo(cx + 8.6, y + 19.4);
    g.stroke();
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(cx - 8, y + 16.6);
    g.lineTo(cx + 8, y + 16.6);
    g.stroke();
    // cushion seat
    g.fillStyle = shade(pal.base, -18);
    rr(g, cx - 10.5, y + 5.4, 21, 8.4, 3.6);
    g.fill();
    g.fillStyle = pal.base;
    rr(g, cx - 10.5, y + 4.2, 21, 6.4, 3.2);
    g.fill();
    g.fillStyle = shadeA(pal.light, 0.5);
    rr(g, cx - 7.4, y + 5.4, 14.8, 1.8, 0.9);
    g.fill();
    // low back slats behind the seated character
    g.fillStyle = "#6b4f35";
    rr(g, cx - 9, y - 3.4, 18, 3.4, 1.6);
    g.fill();
    rr(g, cx - 9, y + 1.6, 18, 3, 1.5);
    g.fill();
    g.fillRect(cx - 8.6, y - 3, 3, 8.6);
    g.fillRect(cx + 5.6, y - 3, 3, 8.6);
  }

  /* ── the village square ────────────────────────────────────────────────── */
  // The lower half of the Green is a lived-in square, not a void: a stone
  // fountain at its heart, a great oak with a rope swing, a market stall,
  // a picnic table on the grass, benches and flower beds. Hand-placed, the
  // way Stardew places its town — every piece earns its spot. None of it is
  // in the blocked set; the crew's walking rows stay clear to the north.

  function drawCommons(g) {
    const T = TILE;

    /* the fountain — heart of the square */
    const fcx = 12.2 * T;
    const fcy = 10.1 * T;
    // worn stone apron
    g.fillStyle = "rgba(150,138,110,.35)";
    g.beginPath();
    g.ellipse(fcx, fcy + 4, 62, 34, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(80,66,44,.25)";
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(fcx, fcy + 4, 52, 27, 0, 0, Math.PI * 2);
    g.stroke();
    // basin wall
    const basin = g.createRadialGradient(fcx - 8, fcy - 10, 6, fcx, fcy, 52);
    basin.addColorStop(0, "#b9ac90");
    basin.addColorStop(0.7, "#9a8c6e");
    basin.addColorStop(1, "#7d7157");
    g.fillStyle = basin;
    g.beginPath();
    g.ellipse(fcx, fcy, 50, 27, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(60,48,30,.4)";
    g.lineWidth = 1.4;
    g.stroke();
    // water
    const water = g.createRadialGradient(fcx - 6, fcy - 5, 2, fcx, fcy, 42);
    water.addColorStop(0, "#aee2f5");
    water.addColorStop(0.55, "#7ec8e3");
    water.addColorStop(1, "#4a90c2");
    g.fillStyle = water;
    g.beginPath();
    g.ellipse(fcx, fcy - 1, 41, 20.5, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.35)";
    g.lineWidth = 1;
    for (const rr2 of [0.45, 0.75]) {
      g.beginPath();
      g.ellipse(fcx, fcy - 1, 41 * rr2, 20.5 * rr2, 0, 0.15, Math.PI * 0.85);
      g.stroke();
    }
    // centre pillar + falling water + sparkles
    g.fillStyle = "#a89a7c";
    rr(g, fcx - 5, fcy - 17, 10, 15, 3);
    g.fill();
    g.fillStyle = "#c2b494";
    g.beginPath();
    g.arc(fcx, fcy - 18, 5.6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(230,248,255,.55)";
    g.lineWidth = 1.2;
    for (const sx of [-3.4, 0, 3.4]) {
      g.beginPath();
      g.moveTo(fcx + sx, fcy - 15);
      g.quadraticCurveTo(fcx + sx * 2.3, fcy - 8, fcx + sx * 2.9, fcy - 1.4);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,.75)";
    for (const [ox, oy] of [[-24, -6], [18, 3], [6, -12], [-9, 8], [28, -9]]) {
      g.fillRect(fcx + ox, fcy + oy, 1.8, 1.8);
    }

    /* the great oak, west green — canopy, swing, dappled shade */
    const ox = 5.4 * T;
    const oy = 9.6 * T;
    g.fillStyle = "rgba(35,55,22,.20)";
    g.beginPath();
    g.ellipse(ox + 8, oy + 34, 74, 26, 0, 0, Math.PI * 2);
    g.fill();
    // trunk with roots
    const trunk = g.createLinearGradient(ox - 8, 0, ox + 9, 0);
    trunk.addColorStop(0, "#5d4630");
    trunk.addColorStop(0.5, "#7a5c3e");
    trunk.addColorStop(1, "#4c3823");
    g.fillStyle = trunk;
    g.beginPath();
    g.moveTo(ox - 6, oy + 36);
    g.quadraticCurveTo(ox - 4, oy + 8, ox - 6.4, oy - 12);
    g.lineTo(ox + 6.4, oy - 12);
    g.quadraticCurveTo(ox + 4.4, oy + 10, ox + 7, oy + 36);
    g.closePath();
    g.fill();
    g.fillStyle = "#4c3823";
    g.beginPath();
    g.moveTo(ox - 9, oy + 37);
    g.lineTo(ox - 2, oy + 31);
    g.lineTo(ox + 1, oy + 37);
    g.closePath();
    g.moveTo(ox + 2, oy + 37);
    g.lineTo(ox + 6, oy + 31.4);
    g.lineTo(ox + 10, oy + 37);
    g.closePath();
    g.fill();
    // leafy branches reaching out — two low limbs for the swing and
    // the square, two more climbing into the canopy's shoulders
    g.strokeStyle = "#5d4630";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(ox - 2, oy - 8);
    g.quadraticCurveTo(ox - 22, oy - 20, ox - 34, oy - 16);
    g.moveTo(ox + 2, oy - 9);
    g.quadraticCurveTo(ox + 24, oy - 22, ox + 36, oy - 14);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(ox - 1, oy - 10);
    g.quadraticCurveTo(ox - 14, oy - 30, ox - 20, oy - 38);
    g.moveTo(ox + 1, oy - 10);
    g.quadraticCurveTo(ox + 16, oy - 32, ox + 22, oy - 40);
    g.stroke();
    // canopy — sculpted lobes over a shadow underpass (pass 3): uneven
    // radii and shoulders instead of uniform blobs, darkness pooled
    // beneath so the silhouette has a top and an underside
    const lobes = [
      [0, -36, 30], [-27, -26, 22], [28, -28, 23], [-13, -47, 21], [15, -48, 20],
      [-38, -10, 15], [40, -12, 16], [-4, -16, 24], [-20, -38, 16], [22, -40, 15],
    ];
    g.fillStyle = "rgba(34,58,24,.5)";
    for (const [bx, by, br] of lobes) {
      g.beginPath();
      g.arc(ox + bx + 3, oy + by + 5, br * 0.96, 0, Math.PI * 2);
      g.fill();
    }
    for (const [bx, by, br] of lobes) {
      const cg = g.createRadialGradient(ox + bx - br * 0.3, oy + by - br * 0.34, 2, ox + bx, oy + by, br);
      cg.addColorStop(0, "#6da34c");
      cg.addColorStop(0.7, "#4d7a34");
      cg.addColorStop(1, "#3a6128");
      g.fillStyle = cg;
      g.beginPath();
      g.arc(ox + bx, oy + by, br, 0, Math.PI * 2);
      g.fill();
    }
    // underside shade, where the canopy hangs over the grass
    g.fillStyle = "rgba(30,50,20,.20)";
    for (const [ux, uy, ur] of [[-24, -8, 12], [18, -6, 13], [0, -4, 14]]) {
      g.beginPath();
      g.arc(ox + ux, oy + uy, ur, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(190,230,140,.35)";
    for (const [hx, hy] of [[-16, -48], [12, -52], [-34, -26], [30, -30]]) {
      g.beginPath();
      g.arc(ox + hx, oy + hy, 5.2, 0, Math.PI * 2);
      g.fill();
    }
    // apples
    g.fillStyle = "#d94f3d";
    for (const [ax, ay] of [[-24, -18], [8, -30], [26, -14], [-6, -12], [38, -22]]) {
      g.beginPath();
      g.arc(ox + ax, oy + ay, 2.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,.4)";
      g.fillRect(ox + ax - 1.2, oy + ay - 1.6, 1.2, 1.2);
      g.fillStyle = "#d94f3d";
    }
    // rope swing hanging from the east branch — a wider seat, rope
    // knots, and its own shadow on the grass so it sits in the scene
    g.fillStyle = "rgba(35,55,22,.18)";
    g.beginPath();
    g.ellipse(ox + 35, oy + 24, 15, 3.4, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(120,96,60,.9)";
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(ox + 30, oy - 18);
    g.lineTo(ox + 30, oy + 16);
    g.moveTo(ox + 40, oy - 17);
    g.lineTo(ox + 40, oy + 16);
    g.stroke();
    g.fillStyle = "#8a6a44";
    rr(g, ox + 23, oy + 16, 24, 3.8, 1.6);
    g.fill();
    g.fillStyle = "rgba(255,235,200,.18)";
    g.fillRect(ox + 24, oy + 16.6, 22, 1);
    g.fillStyle = "#6e5133";
    g.beginPath();
    g.arc(ox + 30, oy + 17, 1.7, 0, Math.PI * 2);
    g.arc(ox + 40, oy + 17, 1.7, 0, Math.PI * 2);
    g.fill();

    /* market stall, east green — striped awning, produce crates */
    const mx = 16.9 * T;
    const my = 8.3 * T;
    g.fillStyle = "rgba(35,55,22,.18)";
    g.beginPath();
    g.ellipse(mx + 20, my + 54, 52, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#6b4f35";
    g.fillRect(mx - 34, my + 6, 4.4, 46);
    g.fillRect(mx + 66, my + 6, 4.4, 46);
    // counter
    const counter = g.createLinearGradient(0, my + 34, 0, my + 52);
    counter.addColorStop(0, "#966f45");
    counter.addColorStop(1, "#71552f");
    g.fillStyle = counter;
    rr(g, mx - 36, my + 34, 106, 18, 3);
    g.fill();
    g.fillStyle = "rgba(255,235,200,.14)";
    g.fillRect(mx - 36, my + 34, 106, 2);
    // crates of produce
    const crateCols = [["#e07840", "#c85f28"], ["#d94f3d", "#b23a2a"], ["#8fbf4d", "#6f9c38"]];
    crateCols.forEach(([c1, c2], ci) => {
      const cxp = mx - 28 + ci * 34;
      g.fillStyle = "#7a5a38";
      rr(g, cxp, my + 22, 28, 13, 2);
      g.fill();
      g.fillStyle = "rgba(46,30,16,.35)";
      g.fillRect(cxp + 2, my + 27.4, 24, 1.6);
      for (let f = 0; f < 5; f++) {
        g.fillStyle = f % 2 ? c1 : c2;
        g.beginPath();
        g.arc(cxp + 5.4 + f * 4.6 + (ci % 2) * 1.4, my + 21 - (f % 2) * 2.2, 3, 0, Math.PI * 2);
        g.fill();
      }
    });
    // awning — red and cream stripes with a scalloped edge
    g.save();
    g.beginPath();
    g.moveTo(mx - 42, my + 8);
    g.lineTo(mx + 76, my + 8);
    g.lineTo(mx + 68, my - 14);
    g.lineTo(mx - 34, my - 14);
    g.closePath();
    g.clip();
    for (let sIdx = 0; sIdx < 8; sIdx++) {
      g.fillStyle = sIdx % 2 ? "#f2ead8" : "#c8503f";
      g.fillRect(mx - 42 + sIdx * 15, my - 16, 15, 26);
    }
    g.restore();
    g.fillStyle = "#c8503f";
    for (let sIdx = 0; sIdx < 8; sIdx++) {
      g.beginPath();
      g.arc(mx - 35 + sIdx * 15, my + 8.4, 7.5, 0, Math.PI);
      g.fill();
      g.fillStyle = sIdx % 2 ? "#c8503f" : "#f2ead8";
    }
    g.strokeStyle = "rgba(90,50,30,.35)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(mx - 42, my + 8);
    g.lineTo(mx - 34, my - 14);
    g.lineTo(mx + 68, my - 14);
    g.lineTo(mx + 76, my + 8);
    g.stroke();

    /* picnic table on the south grass + benches by the fountain */
    const px2 = 16.6 * T;
    const py2 = 12.4 * T;
    g.fillStyle = "rgba(35,55,22,.16)";
    g.beginPath();
    g.ellipse(px2 + 26, py2 + 34, 56, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#8a6a44";
    rr(g, px2 - 26, py2 + 22, 104, 6.4, 2);
    g.fill();
    rr(g, px2 - 26, py2 - 2, 104, 6.4, 2);
    g.fill();
    const ptop = g.createLinearGradient(0, py2 + 4, 0, py2 + 22);
    ptop.addColorStop(0, "#a37f52");
    ptop.addColorStop(1, "#86643c");
    g.fillStyle = ptop;
    rr(g, px2 - 32, py2 + 4, 116, 18, 3);
    g.fill();
    g.strokeStyle = "rgba(70,50,28,.3)";
    g.lineWidth = 1;
    for (const gy of [9, 14.4, 19.8]) {
      g.beginPath();
      g.moveTo(px2 - 29, py2 + gy);
      g.lineTo(px2 + 81, py2 + gy);
      g.stroke();
    }
    // a checked cloth corner + a jug of lemonade on the table
    g.fillStyle = "#f2ead8";
    g.fillRect(px2 + 6, py2 + 6, 22, 13);
    g.fillStyle = "rgba(200,80,63,.5)";
    for (let ck = 0; ck < 3; ck++) {
      g.fillRect(px2 + 6, py2 + 8 + ck * 4.6, 22, 1.6);
      g.fillRect(px2 + 10 + ck * 6.4, py2 + 6, 1.6, 13);
    }
    g.fillStyle = "rgba(245,214,110,.85)";
    rr(g, px2 + 44, py2 + 8, 8.6, 10.6, 2.4);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.4)";
    g.fillRect(px2 + 45.6, py2 + 9.4, 2, 7);
    // benches flanking the fountain
    for (const bx of [fcx - 108, fcx + 76]) {
      g.fillStyle = "#7a5a38";
      rr(g, bx, fcy + 26, 34, 5, 2);
      g.fill();
      rr(g, bx, fcy + 19.4, 34, 4.4, 2);
      g.fill();
      g.fillStyle = "#5d4630";
      g.fillRect(bx + 3, fcy + 23, 3.4, 8);
      g.fillRect(bx + 27.6, fcy + 23, 3.4, 8);
    }

    /* flower beds along the west and east walls + lantern posts */
    for (const side of [0, 1]) {
      const bx0 = side ? 19.15 * T : 2.06 * T;
      g.fillStyle = "#5d4630";
      rr(g, bx0, 6.3 * T, 0.74 * T, 7.4 * T, 5);
      g.fill();
      for (let f = 0; f < 16; f++) {
        const fx2 = bx0 + 4 + hash(f * 3 + side, 8) * 18;
        const fy2 = 6.5 * T + f * (7 * T / 16) + hash(9, f + side) * 8;
        g.fillStyle = "rgba(84,128,58,.75)";
        g.beginPath();
        g.ellipse(fx2, fy2 + 2.4, 3.4, 2.2, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = ["#e86a7a", "#f2b64f", "#f2f0e6", "#a86fc0"][f % 4];
        g.beginPath();
        g.arc(fx2, fy2, 1.9, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (const [lx3, ly3] of [[9.3, 6.9], [14.6, 12.9]]) {
      const X = lx3 * T;
      const Y = ly3 * T;
      g.fillStyle = "rgba(35,55,22,.2)";
      g.beginPath();
      g.ellipse(X, Y + 22, 8, 2.8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#4c3823";
      g.fillRect(X - 1.5, Y, 3, 22);
      g.fillRect(X - 5, Y - 3.4, 10, 3);
      g.fillStyle = "#2e2115";
      rr(g, X - 4.2, Y - 2.6, 8.4, 10.4, 1.8);
      g.fill();
      g.fillStyle = "#ffd98a";
      rr(g, X - 2.6, Y - 1, 5.2, 7.2, 1.2);
      g.fill();
    }
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
    // soft shade the foliage throws on the terrace — in front of the
    // reviewer's house it stops short of the foundation line and
    // thins out, so the lattice reads as a garden fence standing in
    // front of the house, not as growth swallowing it (pass 3)
    g.fillStyle = "rgba(40,60,25,.16)";
    g.fillRect(x0 - 2, y + h - 2, 15.7 * TILE - x0 + 2, 7);
    g.fillStyle = "rgba(40,60,25,.07)";
    g.fillRect(15.7 * TILE, y + h - 2, x1 - 15.7 * TILE + 2, 4);
    // lattice rails
    g.fillStyle = "#6b4f35";
    g.fillRect(x0, y + 4, x1 - x0, 3.4);
    g.fillRect(x0, y + h - 8, x1 - x0, 3.4);
    g.strokeStyle = "rgba(90,66,40,.55)";
    g.lineWidth = 1.1;
    for (let d = 0; d < 9; d++) {
      const dx = x0 + 8 + d * 20;
      g.beginPath();
      g.moveTo(dx, y + h - 6);
      g.lineTo(dx + 12, y + 6);
      g.moveTo(dx + 12, y + h - 6);
      g.lineTo(dx, y + 6);
      g.stroke();
    }
    // posts
    for (let x = 13; x <= 18; x++) {
      g.fillStyle = "#5f452b";
      g.fillRect(x * TILE - 2.6, y - 2, 5.2, h + 2);
      g.fillStyle = "rgba(255,236,200,.16)";
      g.fillRect(x * TILE - 2.6, y - 2, 1.6, h + 2);
      g.fillStyle = "#54402a";
      g.beginPath();
      g.arc(x * TILE, y - 2.6, 3.4, 0, Math.PI * 2);
      g.fill();
    }
    // foliage — deterministic clusters so every frame agrees
    for (let c = 0; c < 26; c++) {
      const fx = x0 + 8 + hash(c * 3 + 1, 7) * (x1 - x0 - 16);
      let fy = y + 4 + hash(3, c * 5 + 2) * (h - 10);
      // in front of the reviewer's house the foliage stays up in the
      // lattice, clear of the foundation course below
      if (fx > 15.7 * TILE) fy = Math.min(fy, y + h - 17);
      const fr = 4.6 + hash(c, 11) * 4.6;
      g.fillStyle = c % 3 ? "rgba(84,128,58,.88)" : "rgba(104,152,70,.88)";
      g.beginPath();
      g.arc(fx, fy, fr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(160,205,110,.4)";
      g.beginPath();
      g.arc(fx - fr * 0.3, fy - fr * 0.34, fr * 0.42, 0, Math.PI * 2);
      g.fill();
    }
    // blooms: reviewer violet and planner amber along the green
    for (let bIdx = 0; bIdx < 9; bIdx++) {
      const bx = x0 + 12 + hash(bIdx * 7, 3) * (x1 - x0 - 24);
      let by = y + 6 + hash(5, bIdx * 3) * (h - 13);
      if (bx > 15.7 * TILE) by = Math.min(by, y + h - 18);
      g.fillStyle = bIdx % 2 ? "#a86fc0" : "#f2b64f";
      for (let p = 0; p < 5; p++) {
        const pa = (p / 5) * Math.PI * 2 + bIdx;
        g.beginPath();
        g.arc(bx + Math.cos(pa) * 2.1, by + Math.sin(pa) * 2.1, 1.7, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "#fff3d6";
      g.beginPath();
      g.arc(bx, by, 1.1, 0, Math.PI * 2);
      g.fill();
    }
    // dappled light spilling through the leaves onto the path below
    const spill = g.createLinearGradient(0, y + h, 0, y + h + 40);
    spill.addColorStop(0, "rgba(190,225,140,.10)");
    spill.addColorStop(1, "rgba(190,225,140,0)");
    g.fillStyle = spill;
    g.fillRect(x0, y + h, x1 - x0, 40);
    g.restore();
  }

  // Room shell for the two east rooms (building pass): chunky corner
  // posts, a skirting shadow where the side walls meet the floor, a
  // timber plate along the south edge, and a stone sill where the Lane
  // door crosses in — the cues that say "indoors" without closing the
  // sightlines the layout needs.
  function drawRoomShell(g, zone, door) {
    const x0 = zone.x0 * TILE;
    const y0 = zone.y0 * TILE;
    const x1 = (zone.x1 + 1) * TILE;
    const y1 = (zone.y1 + 1) * TILE;
    // skirting shadow along the west and east walls
    for (const [sx, dir] of [[x0, 1], [x1, -1]]) {
      const sk = g.createLinearGradient(sx, 0, sx + dir * 8, 0);
      sk.addColorStop(0, "rgba(24,16,8,.26)");
      sk.addColorStop(1, "rgba(24,16,8,0)");
      g.fillStyle = sk;
      g.fillRect(Math.min(sx, sx + dir * 8), y0 + 4, 8, y1 - y0 - 8);
    }
    // south wall plate: the beam the south wall sits on
    g.fillStyle = "#54402a";
    g.fillRect(x0 + 3, y1 - 7, x1 - x0 - 6, 5);
    g.fillStyle = "rgba(255,236,200,.10)";
    g.fillRect(x0 + 3, y1 - 7, x1 - x0 - 6, 1);
    g.fillStyle = "rgba(0,0,0,.22)";
    g.fillRect(x0 + 3, y1 - 2, x1 - x0 - 6, 2);
    // corner posts with a sunlit cap and a ground shadow
    for (const [qx, qy] of [[x0 + 3, y0 + 3], [x1 - 14, y0 + 3], [x0 + 3, y1 - 14], [x1 - 14, y1 - 14]]) {
      g.fillStyle = "rgba(0,0,0,.25)";
      g.fillRect(qx + 1.5, qy + 9, 11, 3);
      const post = g.createLinearGradient(qx, qy, qx + 11, qy);
      post.addColorStop(0, "#7d6244");
      post.addColorStop(1, "#5d4630");
      g.fillStyle = post;
      g.fillRect(qx, qy, 11, 11);
      g.fillStyle = "rgba(255,236,200,.20)";
      g.fillRect(qx, qy, 11, 2);
      g.strokeStyle = "rgba(30,20,10,.45)";
      g.lineWidth = 1;
      g.strokeRect(qx + 0.5, qy + 0.5, 10, 10);
    }
    // stone sill where the Lane door crosses into the room — the floor
    // changes at the threshold, like the cottages' steps
    const dy = door.y * TILE;
    g.fillStyle = "#6e675c";
    rr(g, x0 - 4, dy + TILE - 9, 15, 6, 1.6);
    g.fill();
    g.fillStyle = "#a99a80";
    rr(g, x0 - 4, dy + 3, 15, TILE - 10, 2);
    g.fill();
    g.fillStyle = "rgba(255,246,220,.32)";
    g.fillRect(x0 - 2, dy + 3.5, 11, 1);
  }

  function drawSkyloft(g) {
    // day window band on the north wall — blue sky over green hills
    const wx = 26 * TILE;
    const wy = 1 * TILE + 4;
    const ww = 8 * TILE;
    // the wall the windows are set into: chunky end posts and a top
    // beam, so the band reads as openings in a wall, not a sticker
    g.fillStyle = "#5d4630";
    g.fillRect(wx - 7, wy - 5, 10, 34);
    g.fillRect(wx + ww - 3, wy - 5, 10, 34);
    g.fillRect(wx - 7, wy - 6, ww + 14, 6);
    g.fillStyle = "rgba(255,236,200,.18)";
    g.fillRect(wx - 7, wy - 6, ww + 14, 1.4);
    g.fillRect(wx - 7, wy - 5, 1.6, 34);
    g.fillRect(wx + ww - 3, wy - 5, 1.6, 34);
    const sky = g.createLinearGradient(wx, wy, wx, wy + 22);
    sky.addColorStop(0, "#7ec3ee");
    sky.addColorStop(0.62, "#b5dff7");
    sky.addColorStop(1, "#cfeeff");
    g.fillStyle = sky;
    rr(g, wx, wy, ww, 22, 3);
    g.fill();
    // sun with a soft halo
    const sunX = wx + ww * 0.78;
    const sunY = wy + 6.4;
    const sunGlow = g.createRadialGradient(sunX, sunY, 1, sunX, sunY, 13);
    sunGlow.addColorStop(0, "rgba(255,240,170,.8)");
    sunGlow.addColorStop(1, "rgba(255,240,170,0)");
    g.fillStyle = sunGlow;
    g.beginPath();
    g.arc(sunX, sunY, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffdf6b";
    g.beginPath();
    g.arc(sunX, sunY, 3.6, 0, Math.PI * 2);
    g.fill();
    // clouds
    g.fillStyle = "rgba(255,255,255,.9)";
    for (const [clx, cly, cs] of [[0.14, 6, 1], [0.42, 4.4, 0.8], [0.6, 9.4, 0.65]]) {
      const bx = wx + ww * clx;
      g.beginPath();
      g.ellipse(bx, wy + cly, 7.4 * cs, 2.7 * cs, 0, 0, Math.PI * 2);
      g.ellipse(bx + 5.6 * cs, wy + cly + 0.7, 5.4 * cs, 2.1 * cs, 0, 0, Math.PI * 2);
      g.ellipse(bx - 5.8 * cs, wy + cly + 0.8, 5 * cs, 1.9 * cs, 0, 0, Math.PI * 2);
      g.fill();
    }
    // rolling hills + a tiny farmhouse on the far ridge
    g.fillStyle = "#8fbf6a";
    g.beginPath();
    g.moveTo(wx, wy + 22);
    g.quadraticCurveTo(wx + ww * 0.24, wy + 11, wx + ww * 0.48, wy + 17.4);
    g.quadraticCurveTo(wx + ww * 0.72, wy + 21.4, wx + ww, wy + 14.6);
    g.lineTo(wx + ww, wy + 22);
    g.closePath();
    g.fill();
    g.fillStyle = "#6da34c";
    g.beginPath();
    g.moveTo(wx, wy + 22);
    g.quadraticCurveTo(wx + ww * 0.4, wy + 15.4, wx + ww * 0.66, wy + 19.6);
    g.quadraticCurveTo(wx + ww * 0.86, wy + 22, wx + ww, wy + 19.4);
    g.lineTo(wx + ww, wy + 22);
    g.closePath();
    g.fill();
    g.fillStyle = "#f0dcbc";
    g.fillRect(wx + ww * 0.3 - 3.4, wy + 12.4, 6.8, 4.4);
    g.fillStyle = "#c8503f";
    g.beginPath();
    g.moveTo(wx + ww * 0.3 - 4.4, wy + 12.6);
    g.lineTo(wx + ww * 0.3, wy + 9.6);
    g.lineTo(wx + ww * 0.3 + 4.4, wy + 12.6);
    g.closePath();
    g.fill();
    // wooden mullions
    g.fillStyle = "#6b4f35";
    for (let i = 0; i <= 8; i++) g.fillRect(wx + (i * TILE) - 1, wy, 2, 22);
    g.fillStyle = "rgba(255,255,255,.22)";
    g.fillRect(wx, wy, ww, 1.4);
    // header beam under the window band — the wall continues below it
    // and the room hangs from it
    g.fillStyle = "#6b4f35";
    g.fillRect(wx - 7, wy + 22, ww + 14, 7);
    g.fillStyle = "rgba(255,236,200,.16)";
    g.fillRect(wx - 7, wy + 22, ww + 14, 1.4);
    g.fillStyle = "rgba(0,0,0,.28)";
    g.fillRect(wx - 7, wy + 28, ww + 14, 1.6);

    // rug
    const rug = g.createRadialGradient(30 * TILE, 4.4 * TILE, 4, 30 * TILE, 4.4 * TILE, 5 * TILE);
    rug.addColorStop(0, "rgba(146,84,52,.45)");
    rug.addColorStop(1, "rgba(120,66,40,.25)");
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

    // bunting strung under the window band, and hanging planters
    g.strokeStyle = "rgba(90,66,40,.55)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(26.2 * TILE, 1.95 * TILE);
    g.quadraticCurveTo(30 * TILE, 2.3 * TILE, 33.8 * TILE, 1.95 * TILE);
    g.stroke();
    const flagCols = ["#c8503f", "#f2b64f", "#7d5a99", "#5d8a42", "#e86a7a"];
    for (let fIdx = 0; fIdx < 9; fIdx++) {
      const t = (fIdx + 0.5) / 9;
      const bxx = 26.2 * TILE + t * (33.8 - 26.2) * TILE;
      const byy = 1.95 * TILE + Math.sin(t * Math.PI) * 0.32 * TILE;
      g.fillStyle = flagCols[fIdx % flagCols.length];
      g.beginPath();
      g.moveTo(bxx - 5.4, byy);
      g.lineTo(bxx + 5.4, byy);
      g.lineTo(bxx, byy + 9.6);
      g.closePath();
      g.fill();
    }
    for (const hx of [27.3, 32.8]) {
      const X = hx * TILE;
      const Y = 2.06 * TILE;
      g.strokeStyle = "rgba(90,66,40,.6)";
      g.beginPath();
      g.moveTo(X, Y);
      g.lineTo(X, Y + 7);
      g.stroke();
      g.fillStyle = "#a85f38";
      g.beginPath();
      g.moveTo(X - 6, Y + 7);
      g.lineTo(X + 6, Y + 7);
      g.lineTo(X + 4.4, Y + 13.4);
      g.lineTo(X - 4.4, Y + 13.4);
      g.closePath();
      g.fill();
      g.fillStyle = "#5d8a42";
      for (let lf = 0; lf < 4; lf++) {
        g.beginPath();
        g.ellipse(X - 4.6 + lf * 3, Y + 6.4 + (lf % 2) * 1.6, 2.5, 1.6, lf * 0.7, 0, Math.PI * 2);
        g.fill();
      }
    }

    // the room's shell goes on last, over the furniture feet
    drawRoomShell(g, ZONES.skyloft, DOORS[1]);
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

    // chimney breast: the forge's stone stack rises into the north
    // wall, tying the hearth into the building's structure
    const chX = 32.7 * TILE;
    const breast = g.createLinearGradient(chX - 17, 0, chX + 17, 0);
    breast.addColorStop(0, "#7e766a");
    breast.addColorStop(0.5, "#948c7e");
    breast.addColorStop(1, "#6e675c");
    g.fillStyle = breast;
    g.fillRect(chX - 17, 10 * TILE + 2, 34, 78);
    g.strokeStyle = "rgba(50,44,36,.35)";
    g.lineWidth = 1;
    for (let jy = 10 * TILE + 13; jy < 12.3 * TILE; jy += 11) {
      g.beginPath();
      g.moveTo(chX - 16, jy);
      g.lineTo(chX + 16, jy);
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,.18)";
    g.fillRect(chX + 12, 10 * TILE + 2, 5, 78);

    // the forge, east wall — stone arch, glowing heart, anvil out front
    const fgx = 32.7 * TILE;
    const fgy = 12.35 * TILE;
    g.fillStyle = "rgba(0,0,0,.25)";
    g.beginPath();
    g.ellipse(fgx, fgy + 34, 34, 8, 0, 0, Math.PI * 2);
    g.fill();
    const forgeStone = g.createLinearGradient(0, fgy - 26, 0, fgy + 32);
    forgeStone.addColorStop(0, "#8d8578");
    forgeStone.addColorStop(1, "#6e675c");
    g.fillStyle = forgeStone;
    g.beginPath();
    g.moveTo(fgx - 27, fgy + 32);
    g.lineTo(fgx - 27, fgy - 8);
    g.quadraticCurveTo(fgx, fgy - 30, fgx + 27, fgy - 8);
    g.lineTo(fgx + 27, fgy + 32);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(50,44,36,.4)";
    g.lineWidth = 1;
    for (const jy of [-2, 10, 22]) {
      g.beginPath();
      g.moveTo(fgx - 26, fgy + jy);
      g.lineTo(fgx + 26, fgy + jy);
      g.stroke();
    }
    const forgeGlow = g.createRadialGradient(fgx, fgy + 18, 2, fgx, fgy + 18, 21);
    forgeGlow.addColorStop(0, "rgba(255,190,90,.95)");
    forgeGlow.addColorStop(0.55, "rgba(230,110,40,.75)");
    forgeGlow.addColorStop(1, "rgba(120,50,20,.25)");
    g.fillStyle = "#2e1c10";
    g.beginPath();
    g.moveTo(fgx - 15, fgy + 32);
    g.lineTo(fgx - 15, fgy + 8);
    g.quadraticCurveTo(fgx, fgy - 4, fgx + 15, fgy + 8);
    g.lineTo(fgx + 15, fgy + 32);
    g.closePath();
    g.fill();
    g.fillStyle = forgeGlow;
    g.beginPath();
    g.ellipse(fgx, fgy + 21, 12.4, 9.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffd98a";
    for (const [ex, ey] of [[-6, 24], [3, 27], [7, 20]]) {
      g.beginPath();
      g.arc(fgx + ex, fgy + ey, 1.5, 0, Math.PI * 2);
      g.fill();
    }
    // anvil
    g.fillStyle = "#3d3d42";
    g.beginPath();
    g.moveTo(fgx - 34, fgy + 26);
    g.lineTo(fgx - 22, fgy + 26);
    g.lineTo(fgx - 25.4, fgy + 31);
    g.lineTo(fgx - 25.4, fgy + 35);
    g.lineTo(fgx - 30.6, fgy + 35);
    g.lineTo(fgx - 30.6, fgy + 31);
    g.lineTo(fgx - 34, fgy + 28.4);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,255,255,.22)";
    g.fillRect(fgx - 33.4, fgy + 26, 10.4, 1.4);
    // a hay bale by the crates
    const hay = g.createRadialGradient(32.55 * TILE - 4, 15.5 * TILE - 4, 2, 32.55 * TILE, 15.5 * TILE, 15);
    hay.addColorStop(0, "#e8cc7e");
    hay.addColorStop(1, "#c49a4a");
    g.fillStyle = hay;
    g.beginPath();
    g.ellipse(32.55 * TILE, 15.5 * TILE, 14.6, 10.4, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(140,105,44,.5)";
    g.lineWidth = 1;
    for (const hr2 of [4.4, 8.4, 12]) {
      g.beginPath();
      g.ellipse(32.55 * TILE, 15.5 * TILE, hr2 + 2.4, hr2 * 0.72, 0, 0, Math.PI * 2);
      g.stroke();
    }

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

    // the room's shell goes on last, over the furniture feet
    drawRoomShell(g, ZONES.workshop, DOORS[2]);
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

    // the pond, east meadow — stone rim, lilies, a frog on a pad
    const pnx = 17.9 * TILE;
    const pny = 18.9 * TILE;
    g.fillStyle = "rgba(120,110,88,.5)";
    g.beginPath();
    g.ellipse(pnx, pny + 2, 1.52 * TILE, 0.82 * TILE, 0, 0, Math.PI * 2);
    g.fill();
    const pond = g.createRadialGradient(pnx - 10, pny - 6, 4, pnx, pny, 1.4 * TILE);
    pond.addColorStop(0, "#9fd8ee");
    pond.addColorStop(0.6, "#6db3d9");
    pond.addColorStop(1, "#4a90c2");
    g.fillStyle = pond;
    g.beginPath();
    g.ellipse(pnx, pny, 1.38 * TILE, 0.72 * TILE, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.4)";
    g.lineWidth = 1;
    for (const pr of [0.4, 0.68]) {
      g.beginPath();
      g.ellipse(pnx, pny, 1.38 * TILE * pr, 0.72 * TILE * pr, 0, 0.3, Math.PI * 0.9);
      g.stroke();
    }
    // shoreline (pass 3): a wet-sand band inside the rim, a scalloped
    // foam edge where water meets it, and the world smeared faintly
    // on the surface — the stall's red, the oak's green
    g.strokeStyle = "rgba(146,124,90,.35)";
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(pnx, pny, 1.45 * TILE, 0.78 * TILE, 0, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,.45)";
    g.lineWidth = 1.5;
    g.setLineDash([6.5, 4.5]);
    g.beginPath();
    g.ellipse(pnx, pny, 1.36 * TILE, 0.70 * TILE, 0, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.save();
    g.beginPath();
    g.ellipse(pnx, pny, 1.38 * TILE, 0.72 * TILE, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "rgba(200,80,63,.10)";
    g.beginPath();
    g.ellipse(pnx - 24, pny - 9, 13, 3.8, -0.15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(70,110,50,.12)";
    g.beginPath();
    g.ellipse(pnx - 2, pny + 11, 17, 4.4, 0.08, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.35)";
    g.fillRect(pnx - 30, pny - 12, 5, 1.2);
    g.fillRect(pnx + 8, pny + 4, 6, 1.2);
    g.restore();
    g.fillStyle = "#8d8578";
    for (const [sx3, sy3, sr3] of [[-50, 8, 5], [-38, 22, 4], [44, 16, 5.4], [52, -4, 4.2], [-46, -14, 4.4], [30, -22, 4]]) {
      g.beginPath();
      g.ellipse(pnx + sx3, pny + sy3, sr3, sr3 * 0.7, 0.3, 0, Math.PI * 2);
      g.fill();
    }
    // stepping stones wading into the shallows on the west shore
    for (const [sx4, sy4, sr4] of [[-49, 3, 4.6], [-42.5, -2.5, 3.5], [-36.5, 1.5, 2.6]]) {
      g.fillStyle = "#8d8578";
      g.beginPath();
      g.ellipse(pnx + sx4, pny + sy4, sr4, sr4 * 0.66, 0.25, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,250,236,.22)";
      g.beginPath();
      g.ellipse(pnx + sx4 - 0.8, pny + sy4 - 0.9, sr4 * 0.55, sr4 * 0.3, 0.25, 0, Math.PI * 2);
      g.fill();
    }
    // lily pads, one in flower
    for (const [lx4, ly4, lr] of [[-22, -4, 6.4], [14, 8, 5.4], [30, -10, 4.4]]) {
      g.fillStyle = "#4d8a4a";
      g.beginPath();
      g.arc(pnx + lx4, pny + ly4, lr, 0.5, Math.PI * 1.9);
      g.lineTo(pnx + lx4, pny + ly4);
      g.closePath();
      g.fill();
    }
    g.fillStyle = "#f2a7c3";
    g.beginPath();
    g.arc(pnx - 22, pny - 5, 2.1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff3d6";
    g.beginPath();
    g.arc(pnx - 22, pny - 5, 0.9, 0, Math.PI * 2);
    g.fill();
    // the frog
    g.fillStyle = "#5da24a";
    g.beginPath();
    g.ellipse(pnx + 14, pny + 7.4, 3.4, 2.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#5da24a";
    g.beginPath();
    g.arc(pnx + 12.2, pny + 5.2, 1.4, 0, Math.PI * 2);
    g.arc(pnx + 15.8, pny + 5.2, 1.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#20301c";
    g.beginPath();
    g.arc(pnx + 12.2, pny + 5, 0.62, 0, Math.PI * 2);
    g.arc(pnx + 15.8, pny + 5, 0.62, 0, Math.PI * 2);
    g.fill();
    // flower patches scattered on the meadow
    for (let fp = 0; fp < 7; fp++) {
      const fx3 = (3 + hash(fp * 3, 21) * 7.4) * TILE;
      const fy3 = (17.6 + hash(21, fp * 5) * 2.2) * TILE;
      g.fillStyle = "rgba(84,128,58,.6)";
      g.beginPath();
      g.ellipse(fx3, fy3, 7.4, 4.4, 0, 0, Math.PI * 2);
      g.fill();
      for (let fb2 = 0; fb2 < 4; fb2++) {
        g.fillStyle = ["#e86a7a", "#f2b64f", "#f2f0e6", "#a86fc0"][(fp + fb2) % 4];
        g.beginPath();
        g.arc(fx3 - 4.6 + fb2 * 3.2, fy3 - 1.6 + (fb2 % 2) * 2.8, 1.7, 0, Math.PI * 2);
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

    // a stack of wooden parcel crates on the Lane
    const mx = 22.2 * T;
    const my = 12.4 * T;
    g.fillStyle = "rgba(0,0,0,.22)";
    rr(g, mx + 1, my + 5, 0.68 * T, 0.66 * T, 3);
    g.fill();
    g.fillStyle = "#8a6a44";
    rr(g, mx, my, 0.68 * T, 0.62 * T, 2.4);
    g.fill();
    g.fillStyle = "#71552f";
    rr(g, mx + 3, my + 3, 0.68 * T - 6, 0.3 * T, 1.4);
    g.fill();
    g.fillStyle = "#d9c9a8";
    rr(g, mx + 6, my + 5, 12, 8, 1);
    g.fill();
    g.fillStyle = "rgba(90,80,62,.5)";
    g.fillRect(mx + 7.5, my + 7, 9, 0.8);
    g.fillRect(mx + 7.5, my + 9, 6, 0.8);
    g.fillStyle = "#4c3823";
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
      const a = 0.04 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.8 + d.ph));
      g.fillStyle = `rgba(255,240,210,${a})`;
      g.beginPath();
      g.arc(x, y, d.r, 0, Math.PI * 2);
      g.fill();
    }

    // lamplight breathing in each home's window, independent of the crew
    // sitting there — the working flare itself lives in drawDynamic
    for (const role of ["planner", "executor", "reviewer"]) {
      const win = HOME_WINDOWS[role];
      const sx = win.x * TILE;
      const sy = win.y * TILE;
      const a = 0.05 + 0.025 * Math.sin(t * 1.7 + sx * 0.01);
      const glow = g.createRadialGradient(sx, sy, 3, sx, sy, 46);
      glow.addColorStop(0, `rgba(255,214,140,${a})`);
      glow.addColorStop(1, "rgba(255,214,140,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(sx, sy, 46, 0, Math.PI * 2);
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

    // lamp/ambient pulses — plus the working seat's window flaring up:
    // light in a window means that seat is really working, nothing else
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
        const win = HOME_WINDOWS[c.role];
        if (win) {
          const wxp = win.x * TILE;
          const wyp = win.y * TILE;
          const wa = 0.16 + 0.05 * Math.sin(now / 300 + sx);
          const wglow = g.createRadialGradient(wxp, wyp, 2, wxp, wyp, 34);
          wglow.addColorStop(0, `rgba(255,222,150,${wa})`);
          wglow.addColorStop(1, "rgba(255,222,150,0)");
          g.fillStyle = wglow;
          g.beginPath();
          g.arc(wxp, wyp, 34, 0, Math.PI * 2);
          g.fill();
        }
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
    mctx.fillStyle = "#22331c";
    mctx.fillRect(0, 0, mw, mh);
    const colors = { foundry: "#5d7a3c", hall: "#9a7c55", skyloft: "#a87f4e", workshop: "#8a6c4c", yard: "#4d7a34" };
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
