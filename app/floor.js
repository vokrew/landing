/*
 * floor.js — the Floor room inside Vokrew's web face (Phase 1, Stage 1).
 *
 * FORKED from floor-oc: FourHandsGames/Four-Hands `tools/floor/index.html`
 * at upstream commit c86a77efd6947ea49882debce6b70a01be305f60
 * ("tools/floor: hub profile for Hagan's PC (option A, local only)").
 * Per PHASE1-FLOOR-SPEC.md §7.1 this file is a FORK: floor-oc keeps
 * evolving upstream, and any future sync is a deliberate, diffed port —
 * never an overwrite. The world data, nav grid, entity engine, behavior
 * and drawing below are carried over verbatim from that commit except
 * for the seams marked "VOKREW SEAM" / "VOKREW EDIT".
 *
 * What was cut (spec §4 — Floor-server product surface with no bridge
 * equivalent): meetings UI, talk-to-agent, task CRUD / repeat / projects,
 * agent hire/edit/desk-drag modals, studio, sellers/listings/inventory,
 * connectors/MCP, org chart, decisions, the Line panel, away mode,
 * run ack, the walk-the-floor boss avatar + POV modes, Ollama rig
 * polling, and the XP / CREW LV surfaces.
 *
 * State enters ONLY through VokrewFloor.applyState() (the adapter
 * boundary, spec §2). Stage 1 fed it from a recorded fixture (deleted
 * in Stage 2); Stage 2 feeds it from the real bridge via
 * floor-adapter.js. Nothing in this file fetches.
 *
 * Loaded lazily by app.js the first time the Floor tab opens.
 */
"use strict";
/* =========================================================================
   THE FLOOR - phase 1 client
   A strict hallway-only nav grid, cubicles you own, and a 30fps sim.
   ========================================================================= */
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const stage = document.getElementById("stage");
let W = 800, H = 600, DPR = Math.min(2, window.devicePixelRatio || 1);

const WW = 2560, WH = 2000, CELL = 20, GW = WW / CELL, GH = Math.ceil(WH / CELL);
const MOVE_PERIOD = 0.16;
const PALETTES = {
  "cherry-pop": { body:"#e5486c", trim:"#ffd1dc", dark:"#761b37", glow:"#ff7c9a" },
  "sunset":     { body:"#e8863a", trim:"#ffe3c2", dark:"#7c3f14", glow:"#ffb067" },
  "ocean":      { body:"#3e8ef7", trim:"#d6ecff", dark:"#17457c", glow:"#79b5ff" },
  "forest":     { body:"#3fae6a", trim:"#d8f5e2", dark:"#14532d", glow:"#6de39b" },
  "violet":     { body:"#8b5cf6", trim:"#e9e2ff", dark:"#3b1d78", glow:"#b593ff" },
  "sky":        { body:"#a8d8f0", trim:"#eaf7ff", dark:"#3a6ea8", glow:"#c9ecff" },
  "pearl":      { body:"#eef1f4", trim:"#ffffff", dark:"#8b93a7", glow:"#ffffff" },
  "storm":      { body:"#7f8ea3", trim:"#dfe6ef", dark:"#39445c", glow:"#b3c2d4" },
  "aurora":     { body:"#7fe3c0", trim:"#e2fff2", dark:"#1d6e52", glow:"#a6f7dc" },
  "boss":       { body:"#d9973f", trim:"#fff0cf", dark:"#4b2b0d", glow:"#ffd58a" }
};
const STATUS_COLOR = {
  idle:"#7f90a4", running:"#43d68b", pending:"#f0c47d", paused:"#7f90a4",
  rejected:"#e5535e", error:"#e5535e", meeting:"#e8a45c", break:"#6db7ff", visit:"#b78cff"
};

/* -------------------------------------------------------------------------
   World geometry
   ------------------------------------------------------------------------- */
const ZONES = {
  foundry:  { x:40,   y:40,   w:1500, h:1860 },
  skyloft:  { x:1580, y:40,   w:940,  h:680 },
  workshop: { x:1580, y:760,  w:940,  h:700 },
  yard:     { x:1580, y:1500, w:940,  h:460 }
};
const HALLS = {
  foundry: [
    { x:60, y:60, w:1460, h:140 },   // north
    { x:60, y:480, w:1460, h:100 },  // mid
    { x:60, y:1080, w:1460, h:100 }, // lower
    { x:60, y:1340, w:1460, h:100 }, // south
    { x:60, y:60, w:120, h:1820 },   // west
    { x:440, y:60, w:120, h:1820 },  // V1
    { x:1000, y:60, w:120, h:1820 }, // V2
    { x:1400, y:60, w:120, h:1820 }, // V3
    { x:60, y:1440, w:1460, h:100 }, // annex connector
    { x:60, y:1780, w:1460, h:100 }  // annex south
  ],
  skyloft: [
    { x:1600, y:60, w:900, h:80 },
    { x:1600, y:360, w:900, h:80 },
    { x:1600, y:620, w:900, h:80 },
    { x:1600, y:60, w:80, h:640 },
    { x:2420, y:60, w:80, h:640 },
    { x:1960, y:60, w:80, h:640 }
  ],
  workshop: [
    { x:1600, y:780, w:900, h:80 },
    { x:1600, y:1340, w:900, h:100 },
    { x:1600, y:780, w:80, h:660 },
    { x:2420, y:780, w:80, h:660 },
    { x:1960, y:780, w:80, h:660 }
  ],
  yard: [
    { x:1600, y:1520, w:60, h:420 },   // west walk
    { x:1660, y:1540, w:780, h:60 },   // north walk
    { x:1600, y:1680, w:900, h:60 },   // central walk
    { x:1600, y:1880, w:900, h:60 },   // south walk
    { x:2440, y:1520, w:60, h:420 }    // east walk
  ]
};
const BRIDGES = [
  { x:1520, y:360, w:80, h:80 }, // Foundry <-> Skyloft
  { x:1960, y:700, w:80, h:80 }, // Skyloft <-> Workshop
  { x:1520, y:1650, w:80, h:80 } // Foundry annex <-> Yard
];

function mkCube(id, x, y, w, h, door, label, zone) {
  const c = { id, x, y, w, h, door, label, zone, kind:"cube" };
  const cx = x + w / 2, cy = y + h / 2;
  c.interior = { x:x+20, y:y+20, w:w-40, h:h-40 };
  if (door === "e") {
    c.doorGap = { x:x+w-20, y:cy-30, w:20, h:60 };
    c.seat = { x:x+w-130, y:cy };
    c.desk = { x:x+20, y:cy-45, w:80, h:90 };
    c.step = { x:x+w+20, y:cy };
  } else if (door === "w") {
    c.doorGap = { x, y:cy-30, w:20, h:60 };
    c.seat = { x:x+130, y:cy };
    c.desk = { x:x+w-100, y:cy-45, w:80, h:90 };
    c.step = { x:x-20, y:cy };
  } else if (door === "s") {
    c.doorGap = { x:cx-30, y:y+h-20, w:60, h:20 };
    c.seat = { x:cx, y:y+h-60 };
    c.desk = { x:cx-60, y:y+20, w:120, h:70 };
    c.step = { x:cx, y:y+h+20 };
  } else {
    c.doorGap = { x:cx-30, y, w:60, h:20 };
    c.seat = { x:cx, y:y+60 };
    c.desk = { x:cx-60, y:y+h-90, w:120, h:70 };
    c.step = { x:cx, y:y-20 };
  }
  return c;
}

const CUBICLES = {
  "c-w1": mkCube("c-w1", 180, 620, 260, 180, "e", "ANVIL", "foundry"),
  "c-w2": mkCube("c-w2", 180, 840, 260, 180, "e", "FLINT", "foundry"),
  "c-sw": mkCube("c-sw", 180, 1180, 260, 160, "e", "JETT", "foundry"),
  "c-e1": mkCube("c-e1", 1120, 620, 260, 180, "w", "OPAL", "foundry"),
  "c-e2": mkCube("c-e2", 1120, 840, 260, 180, "w", "SPARE", "foundry"),
  "c-se": mkCube("c-se", 1120, 1180, 260, 160, "w", "SPARE", "foundry"),
  "c-cirrus": mkCube("c-cirrus", 1700, 180, 240, 180, "s", "CIRRUS", "skyloft"),
  "c-zephyr": mkCube("c-zephyr", 2080, 180, 240, 180, "s", "ZEPHYR", "skyloft"),
  "c-nimbus": mkCube("c-nimbus", 1700, 440, 240, 180, "n", "NIMBUS", "skyloft"),
  "c-strato": mkCube("c-strato", 2080, 440, 240, 180, "n", "STRATO", "skyloft"),
  // Free-tier row, upper Workshop: open-weight and free models at work.
  "c-beam":   mkCube("c-beam",   1720, 880,  240, 140, "e", "BEAM",   "workshop"),
  "c-mimo":   mkCube("c-mimo",   1720, 1040, 240, 140, "e", "MIMO",   "workshop"),
  "c-glm":    mkCube("c-glm",    2180, 880,  240, 140, "e", "GLM",    "workshop"),
  "c-flint40":mkCube("c-flint40",2180, 1040, 240, 140, "e", "FLINT40","workshop"),
  // Two small rooms under the conference room.
  "c-pickle": mkCube("c-pickle", 580,  1180, 200, 160, "s", "PICKLE", "foundry"),
  // Annex row: four more desks below the south hall.
  "c-s1": mkCube("c-s1", 180,  1560, 260, 200, "e", "SPARE", "foundry"),
  "c-s2": mkCube("c-s2", 560,  1560, 220, 200, "w", "SPARE", "foundry"),
  "c-s3": mkCube("c-s3", 800,  1560, 200, 200, "e", "SPARE", "foundry"),
  "c-s4": mkCube("c-s4", 1120, 1560, 280, 200, "w", "SPARE", "foundry")
};
const OFFICE = {
  id:"office", kind:"office", label:"CEO", zone:"foundry",
  x:580, y:200, w:400, h:260,
  interior:{ x:600, y:220, w:360, h:220 },
  doorGap:{ x:760, y:440, w:60, h:20 },
  lane:{ x:740, y:460, w:80, h:20 },
  seat:{ x:780, y:370 },
  desk:{ x:680, y:250, w:200, h:80 },
  shelf:{ x:600, y:260, w:30, h:160 },
  plant:{ x:900, y:250, w:30, h:30 }
};
const CONF = {
  id:"conference", kind:"conference", label:"CONFERENCE", zone:"foundry",
  x:600, y:620, w:380, h:400,
  interior:{ x:620, y:640, w:340, h:360 },
  doorGap:{ x:740, y:620, w:80, h:20 },
  lane:{ x:720, y:580, w:120, h:40 },
  table:{ x:700, y:800, w:200, h:120 },
  seats:[
    { x:730, y:770 }, { x:800, y:770 }, { x:870, y:770 },
    { x:730, y:950 }, { x:800, y:950 }, { x:870, y:950 },
    { x:670, y:830 }, { x:670, y:890 }, { x:930, y:860 }
  ]
};
const FIXTURES = {
  board:  { id:"board", x:240, y:60, w:260, h:80, apron:{ x:220, y:140, w:300, h:60 }, label:"THE BOARD" },
  rig:    { id:"rig", x:1180, y:60, w:200, h:90, apron:{ x:1160, y:150, w:240, h:50 }, label:"THE RIG" },
  water:  { id:"water", x:60, y:260, w:80, h:100, apron:{ x:60, y:240, w:120, h:140 }, label:"WATER" },
  vending:{ id:"vending", x:60, y:880, w:80, h:110, apron:{ x:60, y:860, w:120, h:150 }, label:"VENDING" },
  hearth: { id:"hearth", x:1460, y:860, w:60, h:120, apron:{ x:1400, y:840, w:60, h:160 }, label:"HEARTH" }
};
const BREAK_SPOTS = [
  { id:"water",   x:120, y:300, label:"the water cooler" },
  { id:"vending", x:120, y:920, label:"the vending machine" },
  { id:"hearth",  x:1430, y:920, label:"the hearth" },
  { id:"board",   x:360, y:175, label:"the board" },
  { id:"rig",     x:1280, y:175, label:"the rig" },
  { id:"yard",    x:1900, y:1710, label:"the yard fountain" }
];
const SKY_BREAKS = [
  { id:"window", x:2460, y:300, label:"the sky window" },
  { id:"window2",x:2460, y:520, label:"the sky window" },
  { id:"loft",   x:2000, y:680, label:"the loft rail" }
];
const DESK_SPOTS = {};
Object.values(CUBICLES).forEach(c => { DESK_SPOTS[c.id] = c.seat; });
DESK_SPOTS.office = OFFICE.seat;
/* -------------------------------------------------------------------------
   Nav grid: only halls, aprons, own cubicle, office (owner), conference room.
   ------------------------------------------------------------------------- */
const gType = new Uint8Array(GW * GH);       // 0 solid, 1 public, 2 owned room
const gCube = new Array(GW * GH).fill(null); // cubicle/office id
const FURNITURE = [];                        // solid world rects, for audit + drawing

const cellIdx = (cx, cy) => cy * GW + cx;
const cellKey = (cx, cy) => cx + "," + cy;
const clampCell = (cx, cy) => ({ cx:Math.max(0, Math.min(GW-1, cx)), cy:Math.max(0, Math.min(GH-1, cy)) });

function eachCellIn(rect, fn) {
  const x0 = Math.floor(rect.x / CELL), x1 = Math.ceil((rect.x + rect.w) / CELL);
  const y0 = Math.floor(rect.y / CELL), y1 = Math.ceil((rect.y + rect.h) / CELL);
  for (let cy = y0; cy < y1; cy++) for (let cx = x0; cx < x1; cx++) {
    if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue;
    const px = (cx + .5) * CELL, py = (cy + .5) * CELL;
    if (px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h) fn(cx, cy);
  }
}
function carve(rect, type, owner) {
  eachCellIn(rect, (cx, cy) => {
    const i = cellIdx(cx, cy);
    gType[i] = type;
    gCube[i] = owner || null;
  });
}
function solid(rect) {
  eachCellIn(rect, (cx, cy) => { gType[cellIdx(cx, cy)] = 0; gCube[cellIdx(cx, cy)] = null; });
  FURNITURE.push(rect);
}

(function buildNav() {
  Object.values(HALLS).forEach(list => list.forEach(h => carve(h, 1, null)));
  BRIDGES.forEach(b => carve(b, 1, null));

  // The conference room is public: a meeting belongs to everyone.
  carve(CONF.interior, 1, null);
  carve(CONF.doorGap, 1, null);
  carve(CONF.lane, 1, null);

  // The office is owned by whoever holds the office desk.
  carve(OFFICE.interior, 2, "office");
  carve(OFFICE.doorGap, 2, "office");
  carve(OFFICE.lane, 1, null);

  // Cubicles: interior plus the single doorway are owned room cells.
  Object.values(CUBICLES).forEach(c => {
    carve(c.interior, 2, c.id);
    carve(c.doorGap, 2, c.id);
  });

  // Aprons are public standing room in front of fixtures.
  Object.values(FIXTURES).forEach(f => carve(f.apron, 1, null));

  // Fixtures and desks are solid AFTER the rooms/aprons have been carved.
  Object.values(FIXTURES).forEach(f => solid({ x:f.x, y:f.y, w:f.w, h:f.h }));
  Object.values(CUBICLES).forEach(c => solid(c.desk));
  solid(OFFICE.desk);
  solid(OFFICE.shelf);
  solid(OFFICE.plant);
  solid(CONF.table);
})();
function agentById(id) { return agents.find(a => a.id === id) || null; }

function walkableFor(agentId, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return false;
  const i = cellIdx(cx, cy);
  if (gType[i] === 0) return false;
  if (gType[i] === 2) {
    if (agentId === "boss") return false;
    const a = agentById(agentId);
    return !!a && a.deskId === gCube[i];
  }
  return true;
}
function walkablePoint(agentId, x, y) {
  return walkableFor(agentId, Math.floor(x / CELL), Math.floor(y / CELL));
}
function cellOfPoint(p) { return { cx:Math.floor(p.x / CELL), cy:Math.floor(p.y / CELL) }; }
function pointOfCell(c) { return { x:(c.cx + .5) * CELL, y:(c.cy + .5) * CELL }; }
function sameCell(a, b) { return a && b && a.cx === b.cx && a.cy === b.cy; }

function nearestWalkable(agentId, cx, cy, maxR) {
  if (walkableFor(agentId, cx, cy)) return { cx, cy };
  maxR = maxR == null ? 10 : maxR;
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!walkableFor(agentId, nx, ny)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { cx:nx, cy:ny }; }
    }
    if (best) return best;
  }
  return null;
}

class MinHeap {
  constructor() { this.a = []; }
  push(node) {
    const a = this.a; a.push(node); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; if (!a.length) return null;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        let l = i * 2 + 1, r = l + 1, m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const DIRS = [
  { dx:1, dy:0, cost:1 }, { dx:-1, dy:0, cost:1 }, { dx:0, dy:1, cost:1 }, { dx:0, dy:-1, cost:1 },
  { dx:1, dy:1, cost:1.4142 }, { dx:1, dy:-1, cost:1.4142 }, { dx:-1, dy:1, cost:1.4142 }, { dx:-1, dy:-1, cost:1.4142 }
];

function astar(agentId, start, goal, blocked) {
  if (!start || !goal) return null;
  if (!walkableFor(agentId, goal.cx, goal.cy)) return null;
  const sk = cellKey(start.cx, start.cy), gk = cellKey(goal.cx, goal.cy);
  const open = new MinHeap();
  const gScore = new Map(), came = new Map(), closed = new Set();
  gScore.set(sk, 0);
  open.push({ cx:start.cx, cy:start.cy, f:0 });
  const h = (x, y) => {
    const dx = Math.abs(x - goal.cx), dy = Math.abs(y - goal.cy);
    return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
  };
  let guard = 0;
  while (open.size && guard++ < 60000) {
    const cur = open.pop();
    const k = cellKey(cur.cx, cur.cy);
    if (closed.has(k)) continue;
    closed.add(k);
    if (k === gk) {
      const path = [{ cx:cur.cx, cy:cur.cy }];
      let p = came.get(k);
      while (p) {
        path.push(p);
        const pk = cellKey(p.cx, p.cy);
        p = came.get(pk);
      }
      path.reverse();
      return path;
    }
    for (const d of DIRS) {
      const nx = cur.cx + d.dx, ny = cur.cy + d.dy;
      if (!walkableFor(agentId, nx, ny)) continue;
      const nk = cellKey(nx, ny);
      if (closed.has(nk)) continue;
      if (blocked && blocked.has(nk) && nk !== sk) continue;
      if (d.dx && d.dy) {
        // Never cut a corner through a solid/wrong-owner cell.
        if (!walkableFor(agentId, cur.cx + d.dx, cur.cy)) continue;
        if (!walkableFor(agentId, cur.cx, cur.cy + d.dy)) continue;
      }
      const ng = (gScore.get(k) || 0) + d.cost;
      if (ng < (gScore.get(nk) == null ? 1e9 : gScore.get(nk))) {
        gScore.set(nk, ng);
        came.set(nk, { cx:cur.cx, cy:cur.cy });
        open.push({ cx:nx, cy:ny, f:ng + h(nx, ny) });
      }
    }
  }
  return null;
}

function walkPath(agentId, fromPoint, toPoint, opts) {
  const a = agentById(agentId);
  if (!a) return null;
  const sRaw = cellOfPoint(fromPoint), tRaw = cellOfPoint(toPoint);
  const start = nearestWalkable(agentId, sRaw.cx, sRaw.cy, 12);
  const goal = nearestWalkable(agentId, tRaw.cx, tRaw.cy, 12);
  if (!start || !goal) return null;
  let blocked = (opts && opts.blocked) || null;
  let path = astar(agentId, start, goal, blocked);
  if (!path && blocked && blocked.size) path = astar(agentId, start, goal, null);
  if (!path) return null;
  return path.map(c => Object.assign({}, c, pointOfCell(c)));
}

function sampleRoute(agentId, points, step) {
  const bad = [];
  const cubeVisits = new Set();
  for (let i = 0; i < points.length; i++) {
    const cell = cellOfPoint(points[i]);
    if (!walkableFor(agentId, cell.cx, cell.cy)) bad.push({ x:points[i].x, y:points[i].y, cell });
    const gi = cellIdx(cell.cx, cell.cy);
    if (gType[gi] === 2) cubeVisits.add(gCube[gi]);
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / (step || 4)));
    for (let s = 0; s <= n; s++) {
      const x = a.x + (b.x - a.x) * s / n, y = a.y + (b.y - a.y) * s / n;
      const cell = cellOfPoint({ x, y });
      if (!walkableFor(agentId, cell.cx, cell.cy)) {
        bad.push({ x:Math.round(x), y:Math.round(y), cell });
        if (bad.length > 20) return { bad, cubeVisits:Array.from(cubeVisits) };
      }
    }
  }
  return { bad, cubeVisits:Array.from(cubeVisits) };
}

function allDoorsteps() {
  const out = [];
  Object.values(CUBICLES).forEach(c => out.push({ id:c.id, x:c.step.x, y:c.step.y }));
  out.push({ id:"office", x:790, y:475 });
  return out;
}

function routeDestinations() {
  const out = [
    { id:"hall-nw", x:100, y:100 }, { id:"hall-ne", x:1480, y:100 },
    { id:"hall-sw", x:100, y:1400 }, { id:"hall-se", x:1480, y:1400 },
    { id:"hall-v1-n", x:500, y:300 }, { id:"hall-v2-n", x:1060, y:300 },
    { id:"hall-v1-s", x:500, y:1200 }, { id:"hall-v2-s", x:1060, y:1200 },
    { id:"bridge-foundry", x:1560, y:400 }, { id:"sky-west", x:1640, y:100 },
    { id:"sky-mid", x:2460, y:400 }, { id:"sky-central", x:2000, y:200 },
    { id:"sky-bottom", x:2000, y:680 }, { id:"bridge-shop", x:2000, y:740 },
    { id:"shop-nw", x:1640, y:800 }, { id:"shop-se", x:2460, y:1380 },
    { id:"shop-mid", x:2000, y:1100 }, { id:"conf-room", x:660, y:700 },
    { id:"annex-v1", x:500, y:1690 }, { id:"annex-v2", x:1060, y:1690 },
    { id:"annex-south", x:780, y:1830 }, { id:"annex-v3", x:1460, y:1830 },
    { id:"bridge-yard", x:1560, y:1690 }, { id:"yard-north", x:2000, y:1570 },
    { id:"yard-mid", x:2000, y:1710 }, { id:"yard-south", x:2000, y:1910 },
    { id:"yard-east", x:2470, y:1710 }
  ];
  BREAK_SPOTS.forEach(b => out.push({ id:"fx-" + b.id, x:b.x, y:b.y }));
  CONF.seats.forEach((s, i) => out.push({ id:"seat-" + i, x:s.x, y:s.y }));
  allDoorsteps().forEach(d => out.push({ id:"step-" + d.id, x:d.x, y:d.y }));
  return out;
}

function auditRoutes() {
  const dests = routeDestinations();
  const results = [];
  let routes = 0, failures = 0, samples = 0;
  const starts = agents.map(a => ({ id:a.id, x:(DESK_SPOTS[a.deskId] || { x:1080, y:900 }).x, y:(DESK_SPOTS[a.deskId] || { x:1080, y:900 }).y }));
  for (const a of agents) {
    const from = DESK_SPOTS[a.deskId] || { x:1080, y:900 };
    for (const d of dests) {
      const path = walkPath(a.id, from, d, {});
      if (!path) {
        failures++;
        results.push({ agent:a.id, dest:d.id, ok:false, reason:"no path" });
        continue;
      }
      routes++;
      const chk = sampleRoute(a.id, path, 4);
      samples += path.length;
      const foreign = chk.cubeVisits.filter(id => id && id !== a.deskId);
      const ok = chk.bad.length === 0 && foreign.length === 0;
      if (!ok) failures++;
      if (!ok || results.length < 12) {
        results.push({
          agent:a.id, dest:d.id, ok, waypoints:path.length,
          illegalPoints:chk.bad.length, foreignCubicles:foreign,
          firstBad:chk.bad[0] || null
        });
      }
    }
  }
  return {
    ok: failures === 0, agents:agents.length, destinations:dests.length,
    routes, failures, samples, checkedAt:new Date().toISOString(),
    failuresDetail:results.filter(r => !r.ok).slice(0, 40),
    sample:results.filter(r => r.ok).slice(0, 6)
  };
}

function liveAudit() {
  const occupied = new Map();
  const failures = [];
  for (const a of agents) {
    const e = ents[a.id];
    if (!e) { failures.push({ agent:a.id, reason:"no entity" }); continue; }
    const cell = cellOfPoint({ x:e.x, y:e.y });
    if (!walkableFor(a.id, cell.cx, cell.cy)) {
      failures.push({ agent:a.id, reason:"position in blocked cell", x:Math.round(e.x), y:Math.round(e.y), cell });
    }
    const k = cellKey(cell.cx, cell.cy);
    if (occupied.has(k) && occupied.get(k) !== a.id) {
      failures.push({ agent:a.id, reason:"two agents in one cell", other:occupied.get(k), cell });
    }
    occupied.set(k, a.id);
    if (e.cell) {
      const kk = cellKey(e.cell.cx, e.cell.cy);
      if (occupied.has(kk) && occupied.get(kk) !== a.id) {
        failures.push({ agent:a.id, reason:"logical cell collision", other:occupied.get(kk), cell:e.cell });
      }
    }
  }
  return { ok:failures.length === 0, sampled:agents.length, failures, at:new Date().toISOString() };
}

/* -------------------------------------------------------------------------
   VOKREW SEAM — page state. floor-oc's state block also carried its
   server product surface (sellers, listings, connectors, projects,
   studio, talk, POV). All cut for Phase 1 (spec §4); what remains is
   exactly what the carried engine reads. `boss` and `povMode` stay as
   permanent nulls: kept engine paths check them (yield-to-boss,
   rebuildOccupancy, POV camera/click branches) and must never fire.
   ------------------------------------------------------------------------- */
let agents = [];
let tasks = [];
let runs = [];
let liveRuns = [];
let meetings = [];            // always empty in Phase 1: desiredFor's meeting branch stays inert
let budget = null;
let selectedId = null, selectedTaskId = null, focusId = null, trackedTaskId = null;
let placingDeskFor = null;    // desk-drag is cut; drawPlacing() stays a no-op
let simClock = 0, simAcc = 0, lastFrame = performance.now(), lastRender = 0;
let staticWorld = null;
let stickyHits = [];
let prevRunStates = {};
let hoverAgent = null;
const ents = {};
const occupancy = new Map();
const lastGreet = {};
let lastIdleChat = 0;
let ollamaPs = [];            // rig polling cut; isLoaded()/drawRigLive read this as "nothing loaded"
let boss = null;              // SEAM: no boss avatar in Phase 1
let povMode = null;           // SEAM: no walk/ride POV in Phase 1
let soundOn = true;
function activeMeeting() {
  return meetings.find(m => m.state === "gathering" || m.state === "in_session") || null;
}
function latestMeeting() {
  return meetings.length ? meetings[meetings.length - 1] : null;
}
function liveFor(agentId) { return liveRuns.find(r => r.agentId === agentId) || null; }
function paletteFor(a) { return PALETTES[(a.appearance && a.appearance.paletteId)] || PALETTES.ocean; }
function seatFor(a) {
  if (a && a.deskId && DESK_SPOTS[a.deskId]) return DESK_SPOTS[a.deskId];
  const i = Math.max(0, agents.findIndex(x => x.id === (a && a.id)));
  return { x:520 + (i % 5) * 40, y:980 };
}
function doorwayFor(a) {
  if (!a || !a.deskId) return null;
  if (a.deskId === "office") return { x:790, y:475 };
  const c = CUBICLES[a.deskId];
  return c ? { x:c.step.x, y:c.step.y, id:c.id } : null;
}
function meetingSeatFor(a) {
  const m = activeMeeting();
  if (!m) return null;
  const idx = (m.participants || []).indexOf(a.id);
  if (idx < 0) return null;
  return CONF.seats[idx % CONF.seats.length];
}

function rebuildOccupancy() {
  occupancy.clear();
  Object.values(ents).forEach(e => {
    if (e.cell) occupancy.set(cellKey(e.cell.cx, e.cell.cy), e.id);
    if (e.toCell) occupancy.set(cellKey(e.toCell.cx, e.toCell.cy), e.id);
  });
  if (boss && boss.cell) occupancy.set(cellKey(boss.cell.cx, boss.cell.cy), "boss");
  if (boss && boss.toCell) occupancy.set(cellKey(boss.toCell.cx, boss.toCell.cy), "boss");
}
/* VOKREW EDIT: simulate() below loses its two boss calls
   (simulateBoss/updateBossProximity) — the boss avatar is cut (§4). */
function makeEntity(a) {
  const seat = seatFor(a);
  const cell = nearestWalkable(a.id, Math.floor(seat.x / CELL), Math.floor(seat.y / CELL), 12) || { cx:0, cy:0 };
  const p = pointOfCell(cell);
  return {
    id:a.id, x:p.x, y:p.y, cell, toCell:null,
    tween:null, path:null, pathI:0, goalKey:null, replanAt:0,
    activity:"desk", activityPoint:null, activityUntil:0, nextBreakAt:simClock + 55 + Math.random() * 130,
    visitId:null, sitting:true, mode:"desk", working:false, bubble:null,
    face:1, stepPhase:0, deskSig:a.deskId, waitSince:0, yieldUntil:0
  };
}

function syncEntities() {
  let reset = false;
  const byId = new Set(agents.map(a => a.id));
  Object.keys(ents).forEach(id => { if (!byId.has(id)) { delete ents[id]; reset = true; } });
  agents.forEach(a => {
    let e = ents[a.id];
    if (!e) { e = makeEntity(a); ents[a.id] = e; reset = true; }
    if (e.deskSig !== a.deskId) {
      const seat = seatFor(a);
      const cell = nearestWalkable(a.id, Math.floor(seat.x / CELL), Math.floor(seat.y / CELL), 12) || e.cell;
      const p = pointOfCell(cell);
      Object.assign(e, {
        x:p.x, y:p.y, cell, toCell:null, tween:null, path:null, pathI:0,
        goalKey:null, sitting:true, mode:"desk", deskSig:a.deskId,
        activity:"desk", activityPoint:null, activityUntil:0
      });
      reset = true;
    }
  });
  if (reset) rebuildOccupancy();
}

function beginBreak(a, e) {
  const spots = (a.cloud ? SKY_BREAKS.concat(Math.random() < 0.22 ? BREAK_SPOTS : []) : BREAK_SPOTS);
  const spot = spots[Math.floor(Math.random() * spots.length)];
  if (!spot) return false;
  e.activity = "break";
  e.activityPoint = { x:spot.x, y:spot.y };
  e.activityLabel = spot.label;
  e.activityUntil = simClock + 26 + Math.random() * 22;
  e.goalKey = null;
  return true;
}
function beginVisit(a, e) {
  const others = agents.filter(x => x.id !== a.id && x.lifecycleState === "ready" && doorwayFor(x));
  if (!others.length) return false;
  const target = others[Math.floor(Math.random() * others.length)];
  const door = doorwayFor(target);
  if (!door) return false;
  e.activity = "visit";
  e.activityPoint = { x:door.x, y:door.y };
  e.visitId = target.id;
  e.activityLabel = "visiting " + target.name;
  e.activityUntil = simClock + 18 + Math.random() * 14;
  e.goalKey = null;
  return true;
}

function desiredFor(a, e) {
  const m = activeMeeting();
  if (m && (m.state === "gathering" || m.state === "in_session")) {
    const seat = meetingSeatFor(a);
    if (seat) {
      if (e.activity !== "meeting") { e.activity = "meeting"; e.visitId = null; e.goalKey = null; }
      return { mode:"meeting", point:seat, sit:true };
    }
  }
  if (e.activity === "meeting") { e.activity = "desk"; e.goalKey = null; }

  const live = liveFor(a.id);
  if (live && a.lifecycleState === "ready") {
    if (e.activity !== "work") { e.activity = "work"; e.goalKey = null; }
    return { mode:"work", point:seatFor(a), sit:true };
  }
  if (e.activity === "work") { e.activity = "desk"; e.goalKey = null; }

  if (a.lifecycleState !== "ready") {
    if (e.activity !== "desk") { e.activity = "desk"; e.goalKey = null; }
    return { mode:"desk", point:seatFor(a), sit:true };
  }

  if (e.activity === "yield" && simClock < e.yieldUntil) {
    return { mode:"yield", point:e.activityPoint, sit:false };
  }
  if (e.activity === "break" && simClock < e.activityUntil) {
    return { mode:"break", point:e.activityPoint, sit:false };
  }
  if (e.activity === "visit" && simClock < e.activityUntil) {
    return { mode:"visit", point:e.activityPoint, sit:false };
  }
  if (e.activity === "break" || e.activity === "visit" || e.activity === "yield") {
    e.activity = "desk"; e.visitId = null; e.goalKey = null;
  }

  // Work is the default. Long dwells at the desk, rare breaks and social visits.
  const seat = seatFor(a);
  const sc = cellOfPoint(seat);
  const atSeat = sameCell(e.cell, sc) && !e.tween;
  if (atSeat && !m && !live && simClock >= e.nextBreakAt) {
    const roll = Math.random();
    if (roll < 0.17) {
      if (beginBreak(a, e)) return { mode:"break", point:e.activityPoint, sit:false };
    } else if (roll < 0.225) {
      if (beginVisit(a, e)) return { mode:"visit", point:e.activityPoint, sit:false };
    }
    e.nextBreakAt = simClock + 120 + Math.random() * 180;
  }
  return { mode:"desk", point:seat, sit:true };
}

function planFor(a, e, goal) {
  const goalCell = nearestWalkable(a.id, Math.floor(goal.x / CELL), Math.floor(goal.y / CELL), 12);
  if (!goalCell) return false;
  const blocked = new Set();
  Object.values(ents).forEach(o => {
    if (o.id === a.id) return;
    if (o.cell) blocked.add(cellKey(o.cell.cx, o.cell.cy));
    if (o.toCell) blocked.add(cellKey(o.toCell.cx, o.toCell.cy));
  });
  if (boss && boss.cell) blocked.add(cellKey(boss.cell.cx, boss.cell.cy));
  if (boss && boss.toCell) blocked.add(cellKey(boss.toCell.cx, boss.toCell.cy));
  let path = astar(a.id, e.cell, goalCell, blocked);
  if (!path) {
    const movingBlocked = new Set();
    Object.values(ents).forEach(o => {
      if (o.id === a.id || !o.tween) return;
      if (o.cell) movingBlocked.add(cellKey(o.cell.cx, o.cell.cy));
      if (o.toCell) movingBlocked.add(cellKey(o.toCell.cx, o.toCell.cy));
    });
    if (boss && boss.cell) movingBlocked.add(cellKey(boss.cell.cx, boss.cell.cy));
    if (boss && boss.toCell) movingBlocked.add(cellKey(boss.toCell.cx, boss.toCell.cy));
    path = astar(a.id, e.cell, goalCell, movingBlocked);
  }
  if (!path) path = astar(a.id, e.cell, goalCell, null);
  if (!path) return false;
  e.path = path;
  e.pathI = 0;
  e.goalKey = goalCell.cx + "," + goalCell.cy;
  e.replanAt = simClock + 3.2;
  return true;
}

function startTween(a, e, next) {
  const key = cellKey(next.cx, next.cy);
  const holder = occupancy.get(key);
  if (holder && holder !== a.id) return false;
  e.toCell = next;
  e.tween = {
    fromX:e.x, fromY:e.y,
    toX:(next.cx + .5) * CELL, toY:(next.cy + .5) * CELL,
    t0:simClock, dur:MOVE_PERIOD
  };
  occupancy.set(key, a.id);
  e.nextStepAt = simClock + MOVE_PERIOD;
  return true;
}

function finishTween(a, e) {
  const old = e.cell;
  e.cell = e.toCell;
  e.x = e.tween.toX; e.y = e.tween.toY;
  e.toCell = null; e.tween = null;
  if (old) {
    const ok = cellKey(old.cx, old.cy);
    if (occupancy.get(ok) === a.id) occupancy.delete(ok);
  }
  occupancy.set(cellKey(e.cell.cx, e.cell.cy), a.id);
  e.pathI++;
  if (e.activity === "break" || e.activity === "visit") {
    // The dwell clock starts when the destination is actually reached.
    const sc = cellOfPoint(e.activityPoint || { x:e.x, y:e.y });
    if (sameCell(e.cell, sc)) {
      if (!e.activityArrived) {
        e.activityArrived = true;
        e.activityUntil = simClock + (e.activity === "break" ? 14 + Math.random() * 12 : 10 + Math.random() * 10);
        if (e.activity === "visit" && e.visitId) {
          setBubble(e.id, VISIT_LINE(), 2.8);
          const other = ents[e.visitId];
          if (other) setTimeout(() => setBubble(e.visitId, VISIT_REPLY(), 2.4), 950);
        }
      }
    }
  }
  if (e.activity === "yield") {
    e.activity = "desk";
    e.goalKey = null;
  }
  e.activityArrived = false;
}

function findSidestep(a, e) {
  const opts = [];
  const from = e.cell;
  const dir = e.path && e.path[e.pathI + 1] ? { dx:e.path[e.pathI+1].cx - from.cx, dy:e.path[e.pathI+1].cy - from.cy } : { dx:1, dy:0 };
  for (const d of DIRS) {
    const nx = from.cx + d.dx, ny = from.cy + d.dy;
    if (!walkableFor(a.id, nx, ny)) continue;
    const k = cellKey(nx, ny);
    if (occupancy.has(k) && occupancy.get(k) !== a.id) continue;
    // Prefer a cell that is not deeper into the conflict direction.
    const dot = d.dx * dir.dx + d.dy * dir.dy;
    const penalty = dot > 0 ? 4 : (dot === 0 ? 0 : 1);
    opts.push({ cx:nx, cy:ny, score:penalty + Math.random() * .3 });
  }
  opts.sort((x, y) => x.score - y.score);
  return opts[0] || null;
}

function yieldAside(a, e, reason) {
  const side = findSidestep(a, e);
  if (side) {
    e.activity = "yield";
    e.activityPoint = pointOfCell(side);
    e.yieldUntil = simClock + 1.1;
    e.goalKey = null;
    e.path = null;
    return true;
  }
  // No side room: step back one cell if the path has one and it is free.
  if (e.path && e.pathI > 0) {
    const back = e.path[e.pathI - 1];
    const bk = cellKey(back.cx, back.cy);
    if (walkableFor(a.id, back.cx, back.cy) && (!occupancy.has(bk) || occupancy.get(bk) === a.id)) {
      e.activity = "yield";
      e.activityPoint = pointOfCell(back);
      e.yieldUntil = simClock + 1.1;
      e.goalKey = null;
      e.path = null;
      return true;
    }
  }
  e.waitSince = e.waitSince || simClock;
  return false;
}

function setBubble(agentId, text, seconds) {
  const e = ents[agentId];
  if (!e || !text) return;
  e.bubble = { text:String(text).slice(0, 420), until:Date.now() + (seconds || 4) * 1000 };
}

const VISIT_LINES = ["Morning.", "Hey - got a second?", "How's the queue?", "Back to it in a minute.", "Looks busy over here."];
const VISIT_REPLIES = ["Morning.", "One minute - just finishing a step.", "Queue's moving.", "Yep. Coffee soon?", "All good here."];
const VISIT_LINE = () => VISIT_LINES[Math.floor(Math.random() * VISIT_LINES.length)];
const VISIT_REPLY = () => VISIT_REPLIES[Math.floor(Math.random() * VISIT_REPLIES.length)];

function stepAgent(a, e, now) {
  if (e.tween) return;
  if (simClock < (e.nextStepAt || 0)) return;
  const desired = desiredFor(a, e);
  if (e.mode !== desired.mode) e.mode = desired.mode;
  const goalCell = nearestWalkable(a.id, Math.floor(desired.point.x / CELL), Math.floor(desired.point.y / CELL), 12);
  if (!goalCell) return;
  const gk = goalCell.cx + "," + goalCell.cy;
  const atGoal = sameCell(e.cell, goalCell);
  e.sitting = !!desired.sit && atGoal;
  e.working = desired.mode === "work" && atGoal;

  if (atGoal) {
    e.path = null;
    e.goalKey = gk;
    e.waitSince = 0;
    if (e.activity === "break" || e.activity === "visit") {
      if (!e.activityArrived) {
        e.activityArrived = true;
        e.activityUntil = simClock + (e.activity === "break" ? 14 + Math.random() * 12 : 10 + Math.random() * 10);
        if (e.activity === "visit" && e.visitId) {
          setBubble(e.id, VISIT_LINE(), 2.8);
          setTimeout(() => setBubble(e.visitId, VISIT_REPLY(), 2.4), 950);
        }
      }
    }
    return;
  }
  e.activityArrived = false;

  const goalChanged = e.goalKey !== gk;
  if (goalChanged || !e.path || simClock > e.replanAt) {
    if (!planFor(a, e, desired.point)) {
      e.waitSince = e.waitSince || simClock;
      if (simClock - e.waitSince > 3.5 && (e.activity === "break" || e.activity === "visit")) {
        e.activity = "desk"; e.goalKey = null; e.waitSince = 0;
      }
      return;
    }
  }
  if (!e.path || e.pathI + 1 >= e.path.length) return;
  const next = e.path[e.pathI + 1];
  const nk = cellKey(next.cx, next.cy);
  const holder = occupancy.get(nk);
  if (holder && holder !== a.id) {
    // The Boss has right of way. Agents yield to the boss deterministically,
    // never the other way around.
    if (holder === "boss") {
      if (!yieldAside(a, e, "boss")) {
        e.waitSince = e.waitSince || simClock;
        if (simClock - e.waitSince > 2.4) { e.goalKey = null; e.path = null; e.waitSince = 0; }
      }
      return;
    }
    const blocker = ents[holder];
    const selfWins = String(a.id) < String(holder);
    if (!selfWins) {
      // Larger ids yield. Step aside if possible; otherwise wait for the
      // smaller-id walker to pass.
      if (!yieldAside(a, e, "head-on")) {
        e.waitSince = e.waitSince || simClock;
        if (simClock - e.waitSince > 3.2) {
          e.goalKey = null; e.path = null; e.waitSince = 0;
        }
      }
      return;
    }
    // This agent has priority. If the blocker is settled and idle, ask it to
    // step aside rather than freezing the hallway. A settled agent is not an
    // obstacle in the pathfinder; it still gets a nudge here.
    if (blocker && !blocker.tween && blocker.sitting) {
      const bAgent = agentById(holder);
      if (bAgent && bAgent.lifecycleState === "ready" && !liveFor(holder) && !meetingSeatFor(bAgent)) {
        const side = findSidestep(bAgent, blocker);
        if (side) {
          blocker.activity = "yield";
          blocker.activityPoint = pointOfCell(side);
          blocker.yieldUntil = simClock + 1.1;
          blocker.goalKey = null;
          blocker.path = null;
          blocker.sitting = false;
        }
      }
    }
    e.waitSince = e.waitSince || simClock;
    if (simClock - e.waitSince > 2.2) {
      e.goalKey = null;
      e.path = null;
      e.waitSince = 0;
      e.nextBreakAt = Math.min(e.nextBreakAt, simClock + 2);
    }
    return;
  }
  e.waitSince = 0;
  startTween(a, e, next);
}

function simulate(dt) {
  simClock += dt;
  const order = agents.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  order.forEach(a => {
    const e = ents[a.id];
    if (!e) return;
    if (e.tween) {
      const p = Math.min(1, (simClock - e.tween.t0) / e.tween.dur);
      e.x = e.tween.fromX + (e.tween.toX - e.tween.fromX) * p;
      e.y = e.tween.fromY + (e.tween.toY - e.tween.fromY) * p;
      e.stepPhase += dt * 12;
      if (p >= 1) finishTween(a, e);
    } else {
      stepAgent(a, e, Date.now());
    }
  });

  // Ambient studio chatter: managers and specialists think out loud.
  const chatNow = Date.now();
  if (chatNow - (lastIdleChat || 0) > 14000 && Math.random() < .55) {
    const pool = agents.filter((a) => {
      const e = ents[a.id];
      return e && e.mode !== "meeting" && !e.bubble;
    });
    if (pool.length) {
      const a = pool[Math.floor(Math.random() * pool.length)];
      const role = String(a.role || "").toLowerCase();
      const lines = /producer|manager|lead|ceo|director/.test(role)
        ? ["Greenlight the next milestone.", "What is blocking that handoff?", "Protect the release date.", "Who owns the next deliverable?", "Cut scope, not quality."]
        : /qa|test/.test(role)
          ? ["I need evidence, not a story.", "That build needs one more pass.", "Reproduce it, then fix it.", "Show me the artifact."]
          : ["Shipping the next slice.", "The closet is filling up.", "Any new briefs?", "That prototype has legs.", "Coffee, then the queue.", "One clean step at a time."];
      setBubble(a.id, lines[Math.floor(Math.random() * lines.length)], 5);
      lastIdleChat = chatNow;
    }
  }

  // Occasional greetings when two crew members pass each other.
  const t = Date.now();
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const A = agents[i], B = agents[j], ea = ents[A.id], eb = ents[B.id];
      if (!ea || !eb) continue;
      if (ea.mode === "meeting" || eb.mode === "meeting") continue;
      if (Math.hypot(ea.x - eb.x, ea.y - eb.y) > 38) continue;
      const pair = A.id + ":" + B.id;
      if (t - (lastGreet[pair] || 0) < 50000) continue;
      lastGreet[pair] = t;
      if (!ea.bubble) setBubble(A.id, VISIT_LINE(), 2.2);
      break;
    }
  }
}
/* -------------------------------------------------------------------------
   Static world art (rendered once to an offscreen canvas)
   ------------------------------------------------------------------------- */
function rr(g, x, y, w, h, r) {
  const rad = Math.min(r == null ? 6 : r, Math.min(w, h) / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}
function fillRR(g, x, y, w, h, r, color) { g.fillStyle = color; rr(g, x, y, w, h, r); g.fill(); }
function strokeRR(g, x, y, w, h, r, color, width) { g.strokeStyle = color; g.lineWidth = width || 1; rr(g, x, y, w, h, r); g.stroke(); }

function drawFloorPattern(g, rect, base, seam, stepX, stepY) {
  g.fillStyle = base;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.save();
  g.beginPath(); g.rect(rect.x, rect.y, rect.w, rect.h); g.clip();
  g.strokeStyle = seam; g.lineWidth = 1;
  for (let x = rect.x; x <= rect.x + rect.w; x += stepX) {
    g.beginPath(); g.moveTo(x, rect.y); g.lineTo(x, rect.y + rect.h); g.stroke();
  }
  for (let y = rect.y; y <= rect.y + rect.h; y += stepY) {
    g.beginPath(); g.moveTo(rect.x, y); g.lineTo(rect.x + rect.w, y); g.stroke();
  }
  g.restore();
}

function drawHall(g, r, base, seam, edge) {
  drawFloorPattern(g, r, base, seam, 70, 40);
  g.strokeStyle = edge; g.lineWidth = 2;
  g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  g.fillStyle = "rgba(255,255,255,.035)";
  g.fillRect(r.x + 3, r.y + 3, r.w - 6, 2);
}

function drawWall(g, x, y, w, h, color, top) {
  const gr = g.createLinearGradient(x, y, x, y + h);
  gr.addColorStop(0, top || "#2c3a4d");
  gr.addColorStop(.22, color || "#1d2836");
  gr.addColorStop(1, "#121a24");
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  g.strokeStyle = "rgba(160,190,220,.12)"; g.lineWidth = 1;
  g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  if (w > h) {
    g.fillStyle = "rgba(255,255,255,.06)";
    g.fillRect(x + 2, y + 2, w - 4, 2);
  } else {
    g.fillStyle = "rgba(255,255,255,.05)";
    g.fillRect(x + 2, y + 2, 2, h - 4);
  }
}

function drawDoorFrame(g, rect, orientation, accent) {
  // rect is the gap itself. Draw threshold + jamb blocks.
  if (orientation === "v") {
    g.fillStyle = "#101820"; g.fillRect(rect.x, rect.y, rect.w, rect.h);
    g.fillStyle = accent || "#e8a45c";
    g.globalAlpha = .28; g.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4); g.globalAlpha = 1;
    g.fillStyle = "#3b2a18";
    g.fillRect(rect.x - 3, rect.y - 3, rect.w + 6, 3);
    g.fillRect(rect.x - 3, rect.y + rect.h, rect.w + 6, 3);
  } else {
    g.fillStyle = "#101820"; g.fillRect(rect.x, rect.y, rect.w, rect.h);
    g.fillStyle = accent || "#e8a45c";
    g.globalAlpha = .28; g.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4); g.globalAlpha = 1;
    g.fillStyle = "#3b2a18";
    g.fillRect(rect.x - 3, rect.y - 3, 3, rect.h + 6);
    g.fillRect(rect.x + rect.w, rect.y - 3, 3, rect.h + 6);
  }
}

function drawCrate(g, x, y, w, h, tone) {
  fillRR(g, x, y, w, h, 3, tone || "#34281c");
  strokeRR(g, x, y, w, h, 3, "rgba(220,180,120,.18)", 1);
  g.strokeStyle = "rgba(220,180,120,.20)"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + w - 4, y + h - 4);
  g.moveTo(x + w - 4, y + 4); g.lineTo(x + 4, y + h - 4); g.stroke();
}
function drawPlant(g, x, y, scale) {
  const s = scale || 1;
  g.fillStyle = "#4a3322"; fillRR(g, x - 7*s, y + 2*s, 14*s, 12*s, 3, "#4a3322");
  g.fillStyle = "#2f6d4a";
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    g.beginPath();
    g.ellipse(x + Math.cos(a) * 6*s, y - 5*s + Math.sin(a) * 5*s, 6*s, 3.5*s, a, 0, 7);
    g.fill();
  }
  g.fillStyle = "#3c8a5f"; g.beginPath(); g.arc(x, y - 5*s, 5*s, 0, 7); g.fill();
}
function drawShelf(g, x, y, w, h, horizontal) {
  g.fillStyle = "#2a2119"; g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(240,200,140,.16)"; g.fillRect(x + 2, y + 2, w - 4, 2);
  const books = ["#9c4545", "#4e7fa8", "#7d8e4c", "#a77a3d", "#6b5aa0", "#4c8a77"];
  if (horizontal) {
    let bx = x + 5;
    for (let i = 0; i < 7 && bx < x + w - 6; i++) {
      const bw = 4 + (i * 3) % 6;
      g.fillStyle = books[i % books.length];
      g.fillRect(bx, y + 5, bw, h - 10);
      bx += bw + 3;
    }
  } else {
    let by = y + 5;
    for (let i = 0; i < 7 && by < y + h - 6; i++) {
      const bh = 4 + (i * 3) % 6;
      g.fillStyle = books[i % books.length];
      g.fillRect(x + 5, by, w - 10, bh);
      by += bh + 3;
    }
  }
}

function drawDeskAndChair(g, desk, seat, orientation, pal) {
  const accent = pal ? pal.body : "#e8a45c";
  // Desk surface
  g.save();
  g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 10; g.shadowOffsetY = 4;
  fillRR(g, desk.x, desk.y, desk.w, desk.h, 4, "#2a241d");
  g.restore();
  fillRR(g, desk.x + 4, desk.y + 4, desk.w - 8, desk.h - 8, 3, "#3a3025");
  g.strokeStyle = "rgba(232,164,92,.22)"; g.lineWidth = 1;
  rr(g, desk.x + 4, desk.y + 4, desk.w - 8, desk.h - 8, 3); g.stroke();
  // Monitor(s)
  const mx = desk.x + desk.w / 2, my = desk.y + desk.h / 2;
  if (orientation === "e" || orientation === "w") {
    fillRR(g, mx - 18, my - 17, 36, 24, 3, "#0a1119");
    strokeRR(g, mx - 18, my - 17, 36, 24, 3, "#41566c", 1);
    g.fillStyle = "rgba(109,183,255,.18)"; g.fillRect(mx - 14, my - 13, 28, 16);
    g.fillStyle = "rgba(109,183,255,.55)"; g.fillRect(mx - 10, my - 10, 15, 1.5); g.fillRect(mx - 10, my - 6, 20, 1.5);
    g.fillStyle = "#1a232e"; g.fillRect(mx - 3, my + 7, 6, 4);
  } else {
    fillRR(g, mx - 24, my - 15, 48, 22, 3, "#0a1119");
    strokeRR(g, mx - 24, my - 15, 48, 22, 3, "#41566c", 1);
    g.fillStyle = "rgba(109,183,255,.18)"; g.fillRect(mx - 20, my - 11, 40, 14);
    g.fillStyle = "rgba(109,183,255,.55)"; g.fillRect(mx - 15, my - 8, 20, 1.5); g.fillRect(mx - 15, my - 4, 27, 1.5);
  }
  // Keyboard
  g.fillStyle = "#141e29";
  if (orientation === "e" || orientation === "w") fillRR(g, mx - 22, desk.y + desk.h - 20, 44, 12, 3, "#141e29");
  else fillRR(g, mx - 20, my + 14, 40, 11, 3, "#141e29");
  // Mug + lamp
  g.fillStyle = "#c9b08a"; g.beginPath(); g.arc(desk.x + desk.w - 16, desk.y + 16, 5, 0, 7); g.fill();
  g.fillStyle = "#5c4327"; g.beginPath(); g.arc(desk.x + desk.w - 16, desk.y + 16, 3.4, 0, 7); g.fill();
  g.strokeStyle = "#7c6442"; g.lineWidth = 1.2;
  g.beginPath(); g.arc(desk.x + 14, desk.y + 14, 6, 0, 7); g.stroke();
  g.fillStyle = accent; g.globalAlpha = .55; g.beginPath(); g.arc(desk.x + 14, desk.y + 14, 2.2, 0, 7); g.fill(); g.globalAlpha = 1;

  // Chair (seat is walkable; it is a sitting pad, not furniture to route through)
  const cx = seat.x, cy = seat.y;
  g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.ellipse(cx + 2, cy + 8, 14, 5, 0, 0, 7); g.fill();
  fillRR(g, cx - 10, cy - 3, 20, 16, 5, "#233040");
  strokeRR(g, cx - 10, cy - 3, 20, 16, 5, "#405b78", 1);
  g.fillStyle = "#1b2836"; fillRR(g, cx - 8, cy - 16, 16, 12, 5, "#1b2836");
  strokeRR(g, cx - 8, cy - 16, 16, 12, 5, "#3c5673", 1);
  g.strokeStyle = "#2b3d50"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, cy + 13); g.lineTo(cx, cy + 19); g.stroke();
  g.beginPath(); g.moveTo(cx - 8, cy + 21); g.lineTo(cx + 8, cy + 21); g.stroke();
}

function drawCubicle(g, c, pal) {
  const accent = pal ? pal.body : "#4d657f";
  // Floor plate
  g.save();
  g.shadowColor = "rgba(0,0,0,.4)"; g.shadowBlur = 14; g.shadowOffsetY = 5;
  fillRR(g, c.x - 4, c.y - 4, c.w + 8, c.h + 8, 8, "#0b1118");
  g.restore();
  const gr = g.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
  gr.addColorStop(0, "#15202c");
  gr.addColorStop(1, "#0e1620");
  g.fillStyle = gr; g.fillRect(c.x + 20, c.y + 20, c.w - 40, c.h - 40);
  // Rug
  g.globalAlpha = .14; g.fillStyle = accent;
  rr(g, c.interior.x + 8, c.interior.y + 8, c.interior.w - 16, c.interior.h - 16, 8); g.fill(); g.globalAlpha = 1;
  g.strokeStyle = "rgba(255,255,255,.045)"; g.lineWidth = 1;
  for (let x = c.interior.x + 20; x < c.interior.x + c.interior.w; x += 40) {
    g.beginPath(); g.moveTo(x, c.interior.y); g.lineTo(x, c.interior.y + c.interior.h); g.stroke();
  }
  // Walls with exactly one entrance gap
  const wall = "#202e3f";
  const top = "#304459";
  drawWall(g, c.x, c.y, c.w, 20, wall, top);
  drawWall(g, c.x, c.y + c.h - 20, c.w, 20, wall, top);
  if (c.door === "e" || c.door === "w") {
    drawWall(g, c.x, c.y + 20, 20, c.h - 40, wall, top);
    drawWall(g, c.x + c.w - 20, c.y + 20, 20, c.h - 40, wall, top);
    // Knock out the door gap on the correct wall (visual)
    g.clearRect(c.doorGap.x, c.doorGap.y, c.doorGap.w, c.doorGap.h);
    g.fillStyle = "#0e1620"; g.fillRect(c.doorGap.x, c.doorGap.y, c.doorGap.w, c.doorGap.h);
    drawDoorFrame(g, c.doorGap, "v", accent);
  } else {
    drawWall(g, c.x + 20, c.y, 20, c.h - 40, wall, top);
    drawWall(g, c.x + c.w - 20, c.y + 20, 20, c.h - 40, wall, top);
    g.clearRect(c.doorGap.x, c.doorGap.y, c.doorGap.w, c.doorGap.h);
    g.fillStyle = "#0e1620"; g.fillRect(c.doorGap.x, c.doorGap.y, c.doorGap.w, c.doorGap.h);
    drawDoorFrame(g, c.doorGap, "h", accent);
  }
  // Accent strip on the back wall
  g.fillStyle = accent; g.globalAlpha = .55;
  if (c.door === "e") g.fillRect(c.x + 4, c.y + 24, 4, c.h - 48);
  else if (c.door === "w") g.fillRect(c.x + c.w - 8, c.y + 24, 4, c.h - 48);
  else if (c.door === "s") g.fillRect(c.x + 24, c.y + 4, c.w - 48, 4);
  else g.fillRect(c.x + 24, c.y + c.h - 8, c.w - 48, 4);
  g.globalAlpha = 1;
  // Shelf on the back wall
  if (c.door === "e") drawShelf(g, c.x + 23, c.y + 42, 9, 62, false);
  else if (c.door === "w") drawShelf(g, c.x + c.w - 32, c.y + 42, 9, 62, false);
  else if (c.door === "s") drawShelf(g, c.x + 40, c.y + 24, 64, 9, true);
  else drawShelf(g, c.x + 40, c.y + c.h - 33, 64, 9, true);
  // Desk and chair
  drawDeskAndChair(g, c.desk, c.seat, c.door === "e" ? "e" : c.door === "w" ? "w" : c.door === "s" ? "s" : "n", pal);
  // Plant / decor
  drawPlant(g, c.interior.x + c.interior.w - 22, c.interior.y + c.interior.h - 20, .8);
  // Lamp glow pad
  g.fillStyle = "rgba(255,214,140,.07)";
  g.beginPath(); g.arc(c.desk.x + c.desk.w / 2, c.desk.y + c.desk.h / 2, 54, 0, 7); g.fill();
  // Doorstep mat
  g.fillStyle = "rgba(232,164,92,.14)";
  if (c.door === "e") g.fillRect(c.x + c.w, c.step.y - 22, 20, 44);
  else if (c.door === "w") g.fillRect(c.x - 20, c.step.y - 22, 20, 44);
  else if (c.door === "s") g.fillRect(c.step.x - 22, c.y + c.h, 44, 20);
  else g.fillRect(c.step.x - 22, c.y - 20, 44, 20);
}

function drawOffice(g) {
  const o = OFFICE;
  // Floor and rug
  g.fillStyle = "#101923"; g.fillRect(o.x + 20, o.y + 20, o.w - 40, o.h - 40);
  const rug = g.createRadialGradient(o.x + o.w/2, o.y + o.h/2, 10, o.x + o.w/2, o.y + o.h/2, 200);
  rug.addColorStop(0, "rgba(120,76,40,.34)"); rug.addColorStop(1, "rgba(120,76,40,.05)");
  g.fillStyle = rug; g.fillRect(o.x + 40, o.y + 40, o.w - 80, o.h - 80);
  // Glass wall panels
  const glass = g.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
  glass.addColorStop(0, "rgba(88,145,190,.22)"); glass.addColorStop(1, "rgba(30,60,90,.10)");
  g.fillStyle = glass;
  g.fillRect(o.x + 20, o.y, o.w - 40, 18);
  g.fillRect(o.x, o.y + 20, 18, o.h - 40);
  g.fillRect(o.x + o.w - 18, o.y + 20, 18, o.h - 40);
  // Bottom glass split by the doorway
  g.fillRect(o.x + 20, o.y + o.h - 18, 160, 18);
  g.fillRect(o.x + 240, o.y + o.h - 18, 160, 18);
  g.strokeStyle = "rgba(160,205,240,.25)"; g.lineWidth = 1;
  for (let x = o.x + 20; x < o.x + o.w - 20; x += 44) {
    g.beginPath(); g.moveTo(x, o.y); g.lineTo(x, o.y + 18); g.stroke();
  }
  // Door frame
  drawDoorFrame(g, o.doorGap, "h", "#e8a45c");
  g.fillStyle = "rgba(232,164,92,.16)"; g.fillRect(o.lane.x, o.lane.y, o.lane.w, o.lane.h);
  // Desk
  drawDeskAndChair(g, o.desk, o.seat, "s", PALETTES["cherry-pop"]);
  g.fillStyle = "#3a3025"; fillRR(g, o.desk.x - 8, o.desk.y + 8, o.desk.w + 16, o.desk.h - 16, 4, "#3a3025");
  // Bookshelf
  drawShelf(g, o.shelf.x, o.shelf.y, o.shelf.w, o.shelf.h, false);
  drawPlant(g, o.plant.x + 15, o.plant.y + 15, 1.15);
  // CEO nameplate
  g.fillStyle = "#d9c39b"; fillRR(g, o.x + o.w/2 - 64, o.y + o.h - 42, 128, 16, 2, "#d9c39b");
  g.fillStyle = "#3a2b1e"; g.font = "700 9px system-ui"; g.textAlign = "center";
  g.fillText("HEAD HANCHO · CEO", o.x + o.w/2, o.y + o.h - 31);
  // Pendant lamp
  g.strokeStyle = "#4f3b25"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(o.x + o.w/2, o.y + 4); g.lineTo(o.x + o.w/2, o.y + 46); g.stroke();
  g.fillStyle = "#e8a45c"; g.beginPath(); g.arc(o.x + o.w/2, o.y + 50, 10, 0, 7); g.fill();
  g.fillStyle = "rgba(255,214,140,.10)"; g.beginPath(); g.arc(o.x + o.w/2, o.y + 50, 70, 0, 7); g.fill();
}

function drawConference(g) {
  const c = CONF;
  g.fillStyle = "#101820"; g.fillRect(c.x + 20, c.y + 20, c.w - 40, c.h - 40);
  // Rug
  g.fillStyle = "rgba(74,96,122,.24)";
  fillRR(g, c.interior.x + 12, c.interior.y + 12, c.interior.w - 24, c.interior.h - 24, 14, "rgba(74,96,122,.24)");
  g.strokeStyle = "rgba(140,180,220,.12)"; strokeRR(g, c.interior.x + 18, c.interior.y + 18, c.interior.w - 36, c.interior.h - 36, 12, "rgba(140,180,220,.12)", 2);
  // Walls
  drawWall(g, c.x, c.y, c.w, 20, "#202e3f", "#304459");
  drawWall(g, c.x, c.y + c.h - 20, c.w, 20, "#202e3f", "#304459");
  drawWall(g, c.x, c.y + 20, 20, c.h - 40, "#202e3f", "#304459");
  drawWall(g, c.x + c.w - 20, c.y + 20, 20, c.h - 40, "#202e3f", "#304459");
  g.clearRect(c.doorGap.x, c.doorGap.y, c.doorGap.w, c.doorGap.h);
  g.fillStyle = "#101820"; g.fillRect(c.doorGap.x, c.doorGap.y, c.doorGap.w, c.doorGap.h);
  drawDoorFrame(g, c.doorGap, "h", "#6db7ff");
  g.fillStyle = "rgba(109,183,255,.16)"; g.fillRect(c.lane.x, c.lane.y, c.lane.w, c.lane.h);
  // Table
  g.save();
  g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 16; g.shadowOffsetY = 8;
  fillRR(g, c.table.x, c.table.y, c.table.w, c.table.h, 22, "#2f3d4b");
  g.restore();
  fillRR(g, c.table.x + 6, c.table.y + 6, c.table.w - 12, c.table.h - 12, 18, "#3f5264");
  g.strokeStyle = "rgba(160,200,235,.22)"; g.lineWidth = 2;
  rr(g, c.table.x + 10, c.table.y + 10, c.table.w - 20, c.table.h - 20, 16); g.stroke();
  // Objects on the table
  g.fillStyle = "#1a2531"; g.beginPath(); g.arc(c.table.x + c.table.w/2, c.table.y + c.table.h/2, 13, 0, 7); g.fill();
  g.fillStyle = "rgba(109,183,255,.3)"; g.beginPath(); g.arc(c.table.x + c.table.w/2, c.table.y + c.table.h/2, 8, 0, 7); g.fill();
  // Chairs
  c.seats.forEach(s => {
    g.fillStyle = "rgba(0,0,0,.26)"; g.beginPath(); g.ellipse(s.x, s.y + 7, 12, 4, 0, 0, 7); g.fill();
    fillRR(g, s.x - 9, s.y - 2, 18, 14, 4, "#243447");
    strokeRR(g, s.x - 9, s.y - 2, 18, 14, 4, "#46617d", 1);
  });
  // Pendants
  for (let i = 0; i < 3; i++) {
    const x = c.x + 110 + i * 80;
    g.strokeStyle = "#4f3b25"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, c.y + 20); g.lineTo(x, c.y + 58); g.stroke();
    g.fillStyle = "#6db7ff"; g.beginPath(); g.arc(x, c.y + 62, 7, 0, 7); g.fill();
    g.fillStyle = "rgba(109,183,255,.09)"; g.beginPath(); g.arc(x, c.y + 62, 48, 0, 7); g.fill();
  }
  // Whiteboard
  g.fillStyle = "#c9d6df"; fillRR(g, c.x + 28, c.y + 70, 54, 6, 2, "#c9d6df");
  g.fillStyle = "rgba(30,50,70,.20)"; g.fillRect(c.x + 34, c.y + 79, 40, 2); g.fillRect(c.x + 34, c.y + 85, 52, 2);
  g.strokeStyle = "#4c677f"; g.lineWidth = 2; g.strokeRect(c.x + 24, c.y + 62, 62, 34);
  // Sign
  g.fillStyle = "#cfe5f7"; g.font = "800 9px system-ui"; g.textAlign = "center";
  g.fillText("CONFERENCE", c.x + c.w/2, c.y + 40);
}

function drawBoard(g) {
  const b = FIXTURES.board;
  g.save();
  g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 14;
  fillRR(g, b.x, b.y, b.w, b.h, 6, "#4e3520");
  g.restore();
  fillRR(g, b.x + 6, b.y + 6, b.w - 12, b.h - 12, 4, "#8f6738");
  g.fillStyle = "rgba(60,38,16,.20)";
  for (let i = 0; i < 220; i++) {
    const x = b.x + 10 + ((i * 73) % (b.w - 20));
    const y = b.y + 10 + ((i * 37) % (b.h - 20));
    g.beginPath(); g.arc(x, y, .8, 0, 7); g.fill();
  }
  g.fillStyle = "#f3e9d2"; fillRR(g, b.x + b.w/2 - 52, b.y - 4, 104, 18, 2, "#f3e9d2");
  g.fillStyle = "#4a2f16"; g.font = "800 10px system-ui"; g.textAlign = "center";
  g.fillText("THE BOARD", b.x + b.w/2, b.y + 9);
  g.fillStyle = "#c23333"; g.beginPath(); g.arc(b.x + b.w/2, b.y + 2, 2.5, 0, 7); g.fill();
}

function drawRig(g) {
  const r = FIXTURES.rig;
  g.save();
  g.shadowColor = "rgba(240,118,42,.25)"; g.shadowBlur = 20;
  fillRR(g, r.x, r.y + 6, r.w, r.h - 6, 6, "#1b222d");
  g.restore();
  strokeRR(g, r.x, r.y + 6, r.w, r.h - 6, 6, "#4a5d72", 2);
  fillRR(g, r.x + 12, r.y + 16, r.w - 24, 24, 4, "#081018");
  g.strokeStyle = "#3b556f"; g.lineWidth = 1; g.strokeRect(r.x + 12, r.y + 16, r.w - 24, 24);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? "#2a1a10" : "#3f2614";
    fillRR(g, r.x + 16, r.y + 48 + i * 11, r.w - 32, 6, 2, i % 2 ? "#2a1a10" : "#3f2614");
  }
  // Dynamic screen text is drawn on top each frame.
}

function drawWater(g) {
  const w = FIXTURES.water;
  fillRR(g, w.x + 10, w.y + 36, w.w - 20, w.h - 36, 5, "#d8e3ec");
  fillRR(g, w.x + 20, w.y + 6, 40, 34, 12, "rgba(130,200,240,.85)");
  g.fillStyle = "rgba(255,255,255,.35)"; fillRR(g, w.x + 25, w.y + 10, 9, 20, 5, "rgba(255,255,255,.35)");
  g.fillStyle = "#3f566e"; g.fillRect(w.x + 23, w.y + 58, 10, 5); g.fillRect(w.x + 47, w.y + 58, 10, 5);
  g.fillStyle = "#1a2632"; g.fillRect(w.x + 18, w.y + 74, 44, 8);
}

function drawVending(g) {
  const v = FIXTURES.vending;
  fillRR(g, v.x + 4, v.y + 8, v.w - 8, v.h - 8, 4, "#242c38");
  fillRR(g, v.x + 10, v.y + 16, v.w - 20, 58, 3, "#0a1119");
  const cols = ["#e5535e", "#f2d06b", "#6db7ff", "#43d68b", "#b78cff"];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    g.fillStyle = cols[(r * 3 + c) % cols.length];
    g.fillRect(v.x + 15 + c * 16, v.y + 22 + r * 13, 11, 8);
  }
  g.fillStyle = "#3c4a5a"; g.fillRect(v.x + 14, v.y + 84, 52, 14);
  g.fillStyle = "#e5535e"; g.beginPath(); g.arc(v.x + 25, v.y + 91, 3, 0, 7); g.fill();
  g.fillStyle = "#f2d06b"; g.beginPath(); g.arc(v.x + 35, v.y + 91, 3, 0, 7); g.fill();
}

function drawHearth(g) {
  const h = FIXTURES.hearth;
  fillRR(g, h.x - 2, h.y + 4, h.w + 4, h.h - 4, 5, "#3a3f47");
  fillRR(g, h.x + 5, h.y + 18, h.w - 10, h.h - 34, 4, "#120c08");
  g.fillStyle = "#5a4b3d"; g.fillRect(h.x - 4, h.y - 6, h.w + 8, 8);
  // Fire is animated on the dynamic layer.
}

function drawFoundry(g) {
  const z = ZONES.foundry;
  drawFloorPattern(g, { x:z.x+20, y:z.y+20, w:z.w-40, h:z.h-40 }, "#0c1118", "rgba(255,255,255,.025)", 120, 90);
  HALLS.foundry.forEach(h => drawHall(g, h, "#1a232e", "rgba(255,255,255,.035)", "rgba(232,164,92,.10)"));
  // Aprons
  Object.values(FIXTURES).forEach(f => {
    g.fillStyle = "rgba(232,164,92,.075)"; g.fillRect(f.apron.x, f.apron.y, f.apron.w, f.apron.h);
    g.strokeStyle = "rgba(232,164,92,.12)"; g.lineWidth = 1; g.strokeRect(f.apron.x, f.apron.y, f.apron.w, f.apron.h);
  });
  // Storage dressing in the solid NW block
  drawCrate(g, 205, 220, 54, 44, "#33271b"); drawCrate(g, 265, 226, 44, 38, "#2b241d");
  drawCrate(g, 205, 274, 48, 40, "#30271e"); drawCrate(g, 258, 278, 62, 42, "#362a1d");
  fillRR(g, 340, 222, 80, 92, 4, "#232b35");
  g.strokeStyle = "#34455a"; g.lineWidth = 2; g.strokeRect(344, 226, 72, 84);
  for (let i = 0; i < 4; i++) { g.fillStyle = "#1a222c"; g.fillRect(350, 234 + i * 19, 60, 12); g.fillStyle = "#e8a45c"; g.fillRect(398, 238 + i * 19, 4, 4); }
  // Pipes along the block
  g.strokeStyle = "rgba(120,150,180,.16)"; g.lineWidth = 5;
  g.beginPath(); g.moveTo(190, 440); g.lineTo(430, 440); g.stroke();
  g.strokeStyle = "rgba(120,150,180,.09)"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(190, 452); g.lineTo(430, 452); g.stroke();
  // Muted machinery in the E-mid / SE gaps
  drawCrate(g, 1150, 1040, 42, 34, "#2a221a"); drawPlant(g, 1350, 1045, .9);
  drawCrate(g, 1150, 1200, 40, 30, "#2a221a");
  // Office, conference, cubicles
  drawOffice(g);
  drawConference(g);
  Object.values(CUBICLES).filter(c => c.zone === "foundry").forEach(c => drawCubicle(g, c, null));
  // Fixtures
  drawBoard(g); drawRig(g); drawWater(g); drawVending(g); drawHearth(g);
  // Outer walls
  const wall = "#1c2634", top = "#32445a";
  drawWall(g, z.x, z.y, z.w, 20, wall, top);
  drawWall(g, z.x, z.y + z.h - 20, z.w, 20, wall, top);
  drawWall(g, z.x, z.y + 20, 20, z.h - 40, wall, top);
  drawWall(g, 1520, 40, 20, 320, wall, top);
  drawWall(g, 1520, 440, 20, 1210, wall, top);
  drawWall(g, 1520, 1730, 20, 150, wall, top);
  // Bridge side walls
  drawWall(g, 1520, 340, 80, 20, wall, top);
  drawWall(g, 1520, 440, 80, 20, wall, top);
  // Annex wayfinding: painted arrows and lamp pools
  g.strokeStyle = "rgba(232,164,92,.16)"; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const x = 700 + i * 210;
    g.beginPath(); g.moveTo(x, 1824); g.lineTo(x + 14, 1830); g.lineTo(x, 1836); g.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = 320 + i * 560;
    g.fillStyle = "rgba(255,214,140,.05)";
    g.beginPath(); g.arc(x, 1510, 64, 0, 7); g.fill();
    g.fillRect(x, 1470, 2, 40);
    g.fillStyle = "#3a2e20"; g.beginPath(); g.ellipse(x, 1512, 20, 6, 0, 0, 7); g.fill();
    g.fillStyle = "rgba(255,214,140,.35)"; g.beginPath(); g.ellipse(x, 1512, 12, 3.5, 0, 0, 7); g.fill();
  }
  // Zone title on the north wall
  g.fillStyle = "rgba(240,170,100,.75)"; g.font = "900 18px system-ui"; g.textAlign = "center";
  g.fillText("T H E   F O U N D R Y", 780, 36);
}

function drawSkyloft(g) {
  const z = ZONES.skyloft;
  drawFloorPattern(g, { x:z.x+20, y:z.y+20, w:z.w-40, h:z.h-40 }, "#0d1621", "rgba(168,216,240,.035)", 110, 80);
  // Glass ceiling over the top hall
  const sky = g.createLinearGradient(0, 60, 0, 140);
  sky.addColorStop(0, "rgba(120,180,235,.20)"); sky.addColorStop(1, "rgba(120,180,235,.02)");
  g.fillStyle = sky; g.fillRect(1600, 60, 900, 80);
  g.strokeStyle = "rgba(168,216,240,.18)"; g.lineWidth = 2;
  for (let x = 1660; x < 2500; x += 105) { g.beginPath(); g.moveTo(x, 60); g.lineTo(x, 140); g.stroke(); }
  g.beginPath(); g.moveTo(1600, 100); g.lineTo(2500, 100); g.stroke();
  HALLS.skyloft.forEach(h => drawHall(g, h, "#182636", "rgba(168,216,240,.04)", "rgba(109,183,255,.12)"));
  Object.values(CUBICLES).filter(c => c.zone === "skyloft").forEach(c => drawCubicle(g, c, null));
  // Loft rail and plants
  g.strokeStyle = "rgba(120,170,210,.30)"; g.lineWidth = 3;
  g.beginPath(); g.moveTo(1600, 698); g.lineTo(1960, 698); g.moveTo(2040, 698); g.lineTo(2500, 698); g.stroke();
  drawPlant(g, 1670, 690, 1.2); drawPlant(g, 2440, 150, 1);
  // Skyline silhouettes through the glass
  g.fillStyle = "rgba(8,16,26,.55)";
  for (let i = 0; i < 13; i++) {
    const bx = 1615 + i * 68, bh = 18 + ((i * 37) % 42);
    g.fillRect(bx, 140 - bh, 42, bh);
  }
  const wall = "#1b2a3b", top = "#315073";
  drawWall(g, z.x, z.y, z.w, 20, wall, top);
  drawWall(g, z.x, z.y + z.h - 20, 900, 20, wall, top);
  drawWall(g, z.x, z.y + z.h - 20, 380, 20, wall, top);
  drawWall(g, 2420, z.y + z.h - 20, 100, 20, wall, top);
  drawWall(g, 1580, 40, 20, 320, wall, top);
  drawWall(g, 1580, 440, 20, 280, wall, top);
  drawWall(g, 2500, 40, 20, 680, wall, top);
  g.fillStyle = "rgba(150,210,245,.78)"; g.font = "900 18px system-ui"; g.textAlign = "center";
  g.fillText("T H E   S K Y L O F T", 2050, 36);
}

function drawWorkshop(g) {
  const z = ZONES.workshop;
  drawFloorPattern(g, { x:z.x+20, y:z.y+20, w:z.w-40, h:z.h-40 }, "#100e0b", "rgba(240,163,94,.03)", 100, 80);
  HALLS.workshop.forEach(h => drawHall(g, h, "#211a13", "rgba(240,163,94,.04)", "rgba(240,163,94,.14)"));
  // Automation line dressing: belt, rollers, stations, crates. No status text.
  g.fillStyle = "rgba(240,163,94,.10)"; g.fillRect(1720, 1180, 660, 180);
  g.strokeStyle = "rgba(240,163,94,.22)"; g.lineWidth = 2; g.strokeRect(1720, 1180, 660, 180);
  fillRR(g, 1760, 1240, 580, 60, 8, "#2a2118");
  fillRR(g, 1770, 1248, 560, 44, 6, "#1a1611");
  g.strokeStyle = "rgba(240,163,94,.35)"; g.lineWidth = 2;
  for (let x = 1790; x < 2320; x += 42) { g.beginPath(); g.arc(x, 1270, 9, 0, 7); g.stroke(); }
  // Stations
  for (let i = 0; i < 4; i++) {
    const x = 1775 + i * 145;
    fillRR(g, x, 1310, 86, 34, 4, "#241d16");
    strokeRR(g, x, 1310, 86, 34, 4, "rgba(240,163,94,.25)", 1);
    g.fillStyle = "rgba(240,163,94,.45)"; g.beginPath(); g.arc(x + 14, 1327, 3, 0, 7); g.fill();
  }
  // Robot arm
  g.strokeStyle = "#7f6a4d"; g.lineWidth = 7;
  g.beginPath(); g.moveTo(2350, 1320); g.lineTo(2350, 1250); g.lineTo(2296, 1226); g.stroke();
  g.fillStyle = "#a87c46"; g.beginPath(); g.arc(2350, 1320, 12, 0, 7); g.fill();
  g.fillStyle = "#2a2118"; g.beginPath(); g.arc(2296, 1226, 8, 0, 7); g.fill();
  // Workbenches along the south wall
  for (let i = 0; i < 3; i++) {
    const x = 1780 + i * 245;
    fillRR(g, x, 1386, 180, 38, 4, "#211a14");
    strokeRR(g, x, 1386, 180, 38, 4, "rgba(240,163,94,.16)", 1);
    g.fillStyle = "rgba(240,163,94,.28)";
    g.fillRect(x + 12, 1394, 24, 4); g.fillRect(x + 44, 1394, 14, 4);
  }
  drawCrate(g, 1660, 880, 54, 44, "#2b231b"); drawCrate(g, 1720, 900, 40, 34, "#33271b");
  drawCrate(g, 2360, 900, 52, 44, "#2b231b"); drawPlant(g, 2450, 1380, 1.1);
  const wall = "#241d16", top = "#4a3622";
  drawWall(g, z.x, z.y, z.w, 20, wall, top);
  drawWall(g, z.x, z.y + z.h - 20, z.w, 20, wall, top);
  drawWall(g, z.x, z.y + 20, 20, z.h - 40, wall, top);
  drawWall(g, 2500, z.y + 20, 20, z.h - 40, wall, top);
  // Top wall split by the bridge
  drawWall(g, 1580, 760, 380, 20, wall, top);
  drawWall(g, 2040, 760, 480, 20, wall, top);
  drawWall(g, 1940, 700, 20, 80, wall, top);
  drawWall(g, 2040, 700, 20, 80, wall, top);
  g.fillStyle = "rgba(240,163,94,.70)"; g.font = "900 16px system-ui"; g.textAlign = "center";
  g.fillText("T H E   W O R K S H O P", 2280, 747);
}

function drawTree(g, x, y, s) {
  const k = s || 1;
  g.fillStyle = "rgba(0,0,0,.30)";
  g.beginPath(); g.ellipse(x + 5*k, y + 20*k, 22*k, 8*k, 0, 0, 7); g.fill();
  g.fillStyle = "#4a3520"; fillRR(g, x - 4*k, y - 8*k, 8*k, 30*k, 3, "#4a3520");
  const tones = ["#24583c", "#2c6b49", "#347a54"];
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    g.fillStyle = tones[i];
    g.beginPath();
    g.arc(x + Math.cos(a) * 12*k, y - 18*k + Math.sin(a) * 8*k, 18*k - i*2*k, 0, 7);
    g.fill();
  }
  g.fillStyle = "rgba(140,220,160,.18)";
  g.beginPath(); g.arc(x - 4*k, y - 24*k, 8*k, 0, 7); g.fill();
}
function drawBench(g, x, y, w) {
  fillRR(g, x, y, w, 12, 3, "#4a3520");
  fillRR(g, x, y - 8, w, 10, 3, "#5a4027");
  g.fillStyle = "#2c2119";
  g.fillRect(x + 4, y + 12, 4, 8); g.fillRect(x + w - 8, y + 12, 4, 8);
}
function drawYard(g) {
  const z = ZONES.yard;
  // Grass
  drawFloorPattern(g, { x:z.x+20, y:z.y+20, w:z.w-40, h:z.h-40 }, "#0b1710", "rgba(120,200,150,.03)", 84, 66);
  g.fillStyle = "rgba(60,140,90,.10)"; g.fillRect(z.x+20, z.y+20, z.w-40, z.h-40);
  // Flower beds and tufts
  for (let i = 0; i < 42; i++) {
    const x = z.x + 30 + ((i * 97) % (z.w - 60));
    const y = z.y + 30 + ((i * 53) % (z.h - 60));
    g.fillStyle = i % 3 ? "rgba(110,190,140,.22)" : "rgba(220,190,120,.30)";
    g.fillRect(x, y, 2, 4);
  }
  // Paths
  HALLS.yard.forEach(h => drawHall(g, h, "#20291f", "rgba(220,240,200,.045)", "rgba(126,190,150,.16)"));
  // Central path inlay
  g.strokeStyle = "rgba(232,164,92,.14)"; g.lineWidth = 2;
  g.setLineDash([14, 12]);
  g.beginPath(); g.moveTo(1610, 1710); g.lineTo(2490, 1710); g.stroke();
  g.setLineDash([]);
  // Fountain
  const fx = 1920, fy = 1812;
  g.fillStyle = "rgba(0,0,0,.32)"; g.beginPath(); g.ellipse(fx + 4, fy + 22, 52, 16, 0, 0, 7); g.fill();
  g.fillStyle = "#3a4a42"; g.beginPath(); g.ellipse(fx, fy + 14, 50, 22, 0, 0, 7); g.fill();
  g.fillStyle = "#2e3d36"; g.beginPath(); g.ellipse(fx, fy + 9, 50, 22, 0, 0, 7); g.fill();
  g.fillStyle = "rgba(80,170,210,.55)"; g.beginPath(); g.ellipse(fx, fy + 9, 42, 17, 0, 0, 7); g.fill();
  g.fillStyle = "rgba(150,220,245,.35)"; g.beginPath(); g.ellipse(fx - 8, fy + 5, 22, 8, 0, 0, 7); g.fill();
  g.fillStyle = "#4c5c52"; g.fillRect(fx - 7, fy - 14, 14, 22);
  g.fillStyle = "#5d6e62"; g.beginPath(); g.ellipse(fx, fy - 16, 13, 6, 0, 0, 7); g.fill();
  // Benches
  drawBench(g, 1760, 1650, 90);
  drawBench(g, 2100, 1650, 90);
  drawBench(g, 2120, 1752, 90);
  // Trees
  drawTree(g, 1700, 1628, 1.15);
  drawTree(g, 2380, 1628, 1.05);
  drawTree(g, 1745, 1808, 1.35);
  drawTree(g, 2360, 1812, 1.2);
  drawTree(g, 2260, 1818, .9);
  // Hermes statue: winged helmet on a plinth
  g.fillStyle = "rgba(0,0,0,.30)"; g.beginPath(); g.ellipse(1694, 1858, 28, 9, 0, 0, 7); g.fill();
  fillRR(g, 1676, 1832, 36, 24, 3, "#2b3a33");
  strokeRR(g, 1676, 1832, 36, 24, 3, "rgba(150,210,180,.22)", 1);
  g.fillStyle = "#6e8f7c"; g.beginPath(); g.arc(1694, 1822, 11, Math.PI, 0); g.fill();
  g.fillStyle = "#8fb9a2";
  g.beginPath(); g.moveTo(1683, 1818); g.lineTo(1672, 1806); g.lineTo(1681, 1810); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(1705, 1818); g.lineTo(1716, 1806); g.lineTo(1707, 1810); g.closePath(); g.fill();
  g.strokeStyle = "#8fb9a2"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(1694, 1822); g.lineTo(1694, 1810); g.stroke();
  // Courier depot hut
  fillRR(g, 2290, 1608, 108, 62, 4, "#26301f");
  strokeRR(g, 2290, 1608, 108, 62, 4, "rgba(150,210,170,.20)", 1);
  fillRR(g, 2282, 1598, 124, 12, 3, "#3c4a2c");
  g.fillStyle = "#0a120c"; g.fillRect(2304, 1624, 26, 46);
  g.fillStyle = "rgba(255,214,140,.45)"; g.fillRect(2340, 1622, 26, 18);
  g.fillStyle = "rgba(240,190,120,.85)"; g.font = "800 7.5px system-ui"; g.textAlign = "center";
  g.fillText("HERMES", 2353, 1635);
  drawCrate(g, 2410, 1642, 22, 18, "#3a2f21");
  drawCrate(g, 2408, 1662, 18, 14, "#33291d");
  // String lights across the north grass
  g.strokeStyle = "rgba(220,200,150,.25)"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(1670, 1606); g.quadraticCurveTo(2000, 1640, 2380, 1606); g.stroke();
  for (let i = 0; i < 9; i++) {
    const t = i / 8, mx = 1670 + (2380 - 1670) * t;
    const my = 1606 + Math.sin(Math.PI * t) * 26;
    g.fillStyle = i % 2 ? "#ffd98a" : "#9fe3b8";
    g.beginPath(); g.arc(mx, my + 3, 2.4, 0, 7); g.fill();
  }
  // Walls
  const wall = "#1b2a25", top = "#33544a";
  drawWall(g, z.x, z.y, z.w, 20, wall, top);
  drawWall(g, z.x, z.y + z.h - 20, z.w, 20, wall, top);
  drawWall(g, z.x, z.y + 20, 20, 130, wall, top);
  drawWall(g, z.x, z.y + 230, 20, 210, wall, top);
  drawWall(g, 2500, z.y + 20, 20, z.h - 40, wall, top);
  g.fillStyle = "rgba(150,225,185,.75)"; g.font = "900 14px system-ui"; g.textAlign = "center";
  g.fillText("T H E   Y A R D", 2050, 1516);
  g.fillStyle = "rgba(150,225,185,.45)"; g.font = "700 8px system-ui";
  g.fillText("COURIER DEPOT · OPEN AIR", 2350, 1686);
}
function buildStaticWorld() {
  const c = document.createElement("canvas");
  c.width = WW; c.height = WH;
  const g = c.getContext("2d");
  g.fillStyle = "#05080c"; g.fillRect(0, 0, WW, WH);
  // Ground shadow plate
  const halo = g.createRadialGradient(WW/2, WH/2, 200, WW/2, WH/2, 1500);
  halo.addColorStop(0, "rgba(35,55,76,.18)"); halo.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = halo; g.fillRect(0, 0, WW, WH);
  drawFoundry(g);
  drawSkyloft(g);
  drawWorkshop(g);
  drawYard(g);
  // Bridge floors
  BRIDGES.forEach(b => { drawFloorPattern(g, b, "#1a2634", "rgba(255,255,255,.035)", 40, 40); });
  g.strokeStyle = "rgba(232,164,92,.20)"; g.lineWidth = 2;
  BRIDGES.forEach(b => g.strokeRect(b.x, b.y, b.w, b.h));
  // Door frames at the bridges
  drawDoorFrame(g, { x:1520, y:360, w:20, h:80 }, "v", "#6db7ff");
  drawDoorFrame(g, { x:1580, y:360, w:20, h:80 }, "v", "#6db7ff");
  drawDoorFrame(g, { x:1960, y:700, w:80, h:20 }, "h", "#e8a45c");
  drawDoorFrame(g, { x:1960, y:760, w:80, h:20 }, "h", "#e8a45c");
  drawDoorFrame(g, { x:1540, y:1650, w:40, h:80 }, "v", "#7fe3c0");
  // Vignette
  const vg = g.createRadialGradient(WW/2, WH/2, 500, WW/2, WH/2, 2050);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)");
  g.fillStyle = vg; g.fillRect(0, 0, WW, WH);
  staticWorld = c;
}
/* -------------------------------------------------------------------------
   Camera + dynamic rendering
   ------------------------------------------------------------------------- */
const cam = { x:WW/2, y:WH/2, s:.5, tx:WW/2, ty:WH/2, ts:.5, mode:"overview", room:"foundry" };
let camReady = false;
let drag = null, dragged = false;

function fitScale(w, h) { return Math.min(W / w, H / h) * 0.94; }
function overviewScale() { return fitScale(WW, WH); }
function focusScale() { return Math.max(overviewScale() * 2.25, .72); }

function setView(mode, room) {
  if (mode === "focus") { cam.mode = "focus"; setText("zoneName", "CREW MEMBER"); return; }
  cam.mode = mode;
  if (mode === "room") cam.room = room || "foundry";
  const zoneNames = { overview:"THE FLOOR", foundry:"THE FOUNDRY", skyloft:"SKYLOFT", workshop:"WORKSHOP", yard:"THE YARD" };
  setText("zoneName", zoneNames[mode === "room" ? cam.room : mode] || "THE FLOOR");
  document.querySelectorAll("#viewbar button").forEach(b => {
    b.classList.toggle("on", b.dataset.view === (mode === "focus" ? "overview" : mode === "room" ? cam.room : mode));
  });
}

function updateCamera(dt) {
  let tx = cam.tx, ty = cam.ty, ts = cam.ts;
  if (cam.mode === "focus" && focusId === "boss" && boss) {
    tx = boss.x; ty = boss.y; ts = focusScale();
  } else if (cam.mode === "focus" && focusId && ents[focusId]) {
    tx = ents[focusId].x; ty = ents[focusId].y; ts = focusScale();
  } else if (cam.mode === "room") {
    const z = ZONES[cam.room] || ZONES.foundry;
    tx = z.x + z.w/2; ty = z.y + z.h/2; ts = fitScale(z.w + 80, z.h + 80);
  } else if (cam.mode === "overview") {
    tx = WW/2; ty = WH/2; ts = overviewScale();
  }
  cam.tx = tx; cam.ty = ty; cam.ts = ts;
  const k = 1 - Math.exp(-Math.max(0.001, dt) * 6.5);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.s += (ts - cam.s) * k;
  if (cam.mode === "focus") {
    document.querySelectorAll("#viewbar button").forEach(b => b.classList.remove("on"));
  }
}

function resizeCanvas() {
  const r = stage.getBoundingClientRect();
  W = Math.max(320, r.width); H = Math.max(240, r.height);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  if (!camReady) {
    cam.s = overviewScale(); cam.ts = cam.s;
    cam.x = WW/2; cam.y = WH/2; cam.tx = cam.x; cam.ty = cam.y;
    camReady = true;
  }
}

function screenToWorld(sx, sy) {
  return { x:(sx - W/2) / cam.s + cam.x, y:(sy - H/2) / cam.s + cam.y };
}
function worldToScreen(x, y) {
  return { x:(x - cam.x) * cam.s + W/2, y:(y - cam.y) * cam.s + H/2 };
}
function drawBoardNotes(now) {
  stickyHits = [];
  const b = FIXTURES.board;
  const open = tasks.filter(t => t.status !== "done").slice(0, 6);
  if (!open.length) {
    ctx.fillStyle = "rgba(70,45,20,.55)"; ctx.font = "700 10px system-ui"; ctx.textAlign = "center";
    ctx.fillText("no open work", b.x + b.w/2, b.y + 49);
    return;
  }
  open.forEach((t, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = b.x + 14 + col * 78, y = b.y + 16 + row * 30;
    ctx.save();
    ctx.translate(x + 32, y + 12 + Math.sin(now / 1100 + i * 1.3) * 0.7); ctx.rotate((col - 1) * .035);
    ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    ctx.fillStyle = t.status === "failed" ? "#f0a0a0" : t.status === "in_progress" ? "#b9e6c9" : "#f2d06b";
    rr(ctx, -32, -11, 64, 24, 2); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
    ctx.fillStyle = "#392d10"; ctx.font = "800 8px system-ui"; ctx.textAlign = "center";
    ctx.fillText(t.identifier || "TASK", 0, 1);
    ctx.font = "600 7px system-ui"; ctx.fillStyle = "rgba(57,45,16,.75)";
    ctx.fillText((t.title || "").slice(0, 11), 0, 8);
    ctx.restore();
    stickyHits.push({ x:x - 1, y:y - 2, w:66, h:28, taskId:t.id });
  });
}

function drawRigLive(now) {
  const r = FIXTURES.rig;
  const loaded = (ollamaPs.models || [])[0];
  const busy = liveRuns.length > 0;
  ctx.save();
  if (busy) {
    ctx.shadowColor = "#f0762a"; ctx.shadowBlur = 24 + 10 * Math.sin(now / 240);
    ctx.fillStyle = "rgba(240,118,42,.16)";
    rr(ctx, r.x - 8, r.y - 2, r.w + 16, r.h + 16, 8); ctx.fill();
  }
  ctx.restore();
  // Screen
  ctx.fillStyle = busy ? "#3a1c0a" : "#071018";
  rr(ctx, r.x + 12, r.y + 16, r.w - 24, 24, 4); ctx.fill();
  ctx.strokeStyle = busy ? "#f0762a" : "#3b556f"; ctx.lineWidth = 1;
  rr(ctx, r.x + 12, r.y + 16, r.w - 24, 24, 4); ctx.stroke();
  ctx.fillStyle = busy ? "#ffc078" : "#7fb9de";
  ctx.font = "700 9px ui-monospace,monospace"; ctx.textAlign = "center";
  ctx.fillText(loaded ? String(loaded.name).slice(0, 22) : "NO BRAIN LOADED", r.x + r.w/2, r.y + 31);
  for (let i = 0; i < 4; i++) {
    const on = busy ? (Math.floor(now / (140 + i * 30)) + i) % 2 === 0 : loaded && i < 2;
    ctx.fillStyle = on ? (busy ? "#f0762a" : "#43d68b") : "#2a1a10";
    rr(ctx, r.x + 16, r.y + 48 + i * 11, r.w - 32, 6, 2); ctx.fill();
  }
}

function drawHearthLive(now) {
  const h = FIXTURES.hearth;
  const flick = .78 + .22 * Math.sin(now / 120) * Math.sin(now / 51 + 1.3);
  const cx = h.x + h.w/2, cy = h.y + h.h - 24;
  const gl = ctx.createRadialGradient(cx, cy, 4, cx, cy, 92);
  gl.addColorStop(0, "rgba(255,126,36," + (.30 * flick) + ")");
  gl.addColorStop(1, "rgba(255,126,36,0)");
  ctx.fillStyle = gl; ctx.fillRect(cx - 100, cy - 90, 200, 180);
  ctx.fillStyle = "rgba(240,118,42," + (.75 * flick) + ")";
  ctx.beginPath(); ctx.ellipse(cx, cy, 16, 10 + 4 * flick, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(255,210,120," + (.85 * flick) + ")";
  ctx.beginPath(); ctx.ellipse(cx, cy + 2, 8, 6 + 2 * flick, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(90,60,40,.8)";
  ctx.fillRect(cx - 21, cy + 10, 42, 5);
}

function drawConveyorLive(now) {
  const off = (now / 19) % 42;
  ctx.strokeStyle = "rgba(240,163,94,.32)"; ctx.lineWidth = 2;
  for (let x = 1770; x < 2335; x += 42) {
    const xx = x + off;
    if (xx > 2320) continue;
    ctx.beginPath(); ctx.arc(xx, 1270, 9, 0, 7); ctx.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const on = Math.floor(now / 700 + i) % 3 === 0;
    ctx.fillStyle = on ? "#e8a45c" : "rgba(240,163,94,.22)";
    ctx.beginPath(); ctx.arc(1789 + i * 145, 1327, 3, 0, 7); ctx.fill();
  }
}

/* Ambient life: skyloft weather, yard water, workshop motion, Hermes courier */
function drawSkyLive(now) {
  // Drifting clouds through the glass roof
  ctx.save();
  ctx.beginPath(); ctx.rect(1600, 60, 900, 80); ctx.clip();
  for (let i = 0; i < 4; i++) {
    const x = 1520 + ((now / 90 + i * 260) % 1120);
    const y = 78 + (i % 3) * 18;
    ctx.fillStyle = "rgba(200,230,255,.055)";
    ctx.beginPath();
    ctx.ellipse(x, y, 70, 16, 0, 0, 7);
    ctx.ellipse(x + 40, y + 6, 46, 12, 0, 0, 7);
    ctx.ellipse(x - 44, y + 7, 38, 10, 0, 0, 7);
    ctx.fill();
  }
  ctx.restore();
  // City window twinkle
  for (let i = 0; i < 13; i++) {
    const bx = 1622 + i * 68, bh = 18 + ((i * 37) % 42);
    const a = .10 + .18 * (0.5 + 0.5 * Math.sin(now / 900 + i * 1.7));
    ctx.fillStyle = "rgba(255,214,140," + a.toFixed(3) + ")";
    ctx.fillRect(bx + 8, 140 - bh + 6, 4, 3);
    ctx.fillRect(bx + 22, 140 - bh + 14, 4, 3);
  }
  // A pair of birds crossing the skyline
  ctx.strokeStyle = "rgba(190,220,240,.35)"; ctx.lineWidth = 1.4;
  for (let i = 0; i < 2; i++) {
    const x = 1620 + ((now / 42 + i * 380) % 900);
    const y = 96 + i * 14 + Math.sin(now / 700 + i) * 4;
    const f = Math.sin(now / 140 + i * 2) * 3;
    ctx.beginPath();
    ctx.moveTo(x - 5, y + f); ctx.lineTo(x, y); ctx.lineTo(x + 5, y + f);
    ctx.stroke();
  }
}

function drawYardLive(now) {
  const fx = 1920, fy = 1803;
  // Fountain rings
  for (let i = 0; i < 3; i++) {
    const t = ((now / 1700) + i / 3) % 1;
    ctx.strokeStyle = "rgba(150,225,245," + (0.28 * (1 - t)).toFixed(3) + ")";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(fx, fy + 9, 9 + 40 * t, 3.5 + 16 * t, 0, 0, 7);
    ctx.stroke();
  }
  // Spray
  for (let i = 0; i < 9; i++) {
    const p = ((now / 1000) + i / 9) % 1;
    const a = (i / 9) * Math.PI * 2;
    const px = fx + Math.cos(a) * (4 + 15 * p);
    const py = fy - 14 - Math.sin(Math.PI * p) * 26;
    ctx.fillStyle = "rgba(190,240,255," + (0.55 * (1 - p)).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(px, py, 1.4, 0, 7); ctx.fill();
  }
  // Fireflies over the lower lawn
  for (let i = 0; i < 14; i++) {
    const x = 1615 + ((i * 167) % 800) + Math.sin(now / 1100 + i) * 9;
    const y = 1752 + ((i * 67) % 112) + Math.cos(now / 900 + i * 1.4) * 6;
    const a = 0.18 + 0.62 * (0.5 + 0.5 * Math.sin(now / 620 + i * 2.2));
    ctx.fillStyle = "rgba(255,236,160," + a.toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,236,160," + (a * .18).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
  }
  // String-light shimmer
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const mx = 1670 + 710 * t;
    const my = 1606 + Math.sin(Math.PI * t) * 26 + 3;
    const a = 0.18 + 0.30 * (0.5 + 0.5 * Math.sin(now / 520 + i * 1.1));
    ctx.fillStyle = (i % 2 ? "rgba(255,217,138," : "rgba(159,227,184,") + a.toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(mx, my, 5, 0, 7); ctx.fill();
  }
}

function drawWorkshopLive(now) {
  // Boxes riding the belt
  for (let i = 0; i < 3; i++) {
    const x = 1780 + ((now / 26 + i * 186) % 540);
    const bob = Math.sin(now / 180 + i) * 1.2;
    ctx.fillStyle = "#4a3822";
    rr(ctx, x, 1254 + bob, 18, 16, 2); ctx.fill();
    ctx.strokeStyle = "rgba(240,190,120,.35)"; ctx.lineWidth = 1;
    rr(ctx, x, 1254 + bob, 18, 16, 2); ctx.stroke();
    ctx.fillStyle = "rgba(240,190,120,.30)";
    ctx.fillRect(x + 2, 1259 + bob, 14, 1);
  }
  // Welding spark at the arm tip
  const t = Math.sin(now / 420) * 0.5 + 0.5;
  const sx = 2296, sy = 1226;
  ctx.fillStyle = "rgba(255,170,60," + (0.25 + 0.55 * t).toFixed(3) + ")";
  ctx.beginPath(); ctx.arc(sx, sy, 3 + t * 2, 0, 7); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = now / 220 + i * 1.25;
    const d = 5 + ((now / 7 + i * 13) % 12);
    ctx.fillStyle = "rgba(255,210,140," + (0.55 * (1 - d / 18)).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d, 1.1, 0, 7); ctx.fill();
  }
  // Robot arm sway
  ctx.strokeStyle = "rgba(168,124,70,.65)"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(2350, 1320);
  ctx.lineTo(2350, 1290 + Math.sin(now / 700) * 3);
  ctx.lineTo(2320 + Math.sin(now / 900) * 5, 1262 + Math.cos(now / 800) * 3);
  ctx.lineTo(sx, sy);
  ctx.stroke();
}

const HERMES_ROUTE = [
  { x:2350, y:1698 }, { x:2200, y:1698 }, { x:1700, y:1698 },
  { x:1630, y:1690 }, { x:1560, y:1690 }, { x:1470, y:1690 },
  { x:1470, y:1830 }, { x:1200, y:1830 }, { x:1060, y:1830 },
  { x:520, y:1830 }, { x:520, y:1690 }, { x:520, y:1500 },
  { x:520, y:1380 }, { x:760, y:1380 }
];
const HERMES = (() => {
  let total = 0;
  const segs = [];
  for (let i = 0; i < HERMES_ROUTE.length - 1; i++) {
    const a = HERMES_ROUTE[i], b = HERMES_ROUTE[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ a, b, len, start: total });
    total += len;
  }
  return { segs, total };
})();

function hermesAt(dist) {
  const d = Math.max(0, Math.min(HERMES.total - 0.001, dist));
  for (const s of HERMES.segs) {
    if (d <= s.start + s.len) {
      const t = (d - s.start) / s.len;
      return {
        x: s.a.x + (s.b.x - s.a.x) * t,
        y: s.a.y + (s.b.y - s.a.y) * t,
        dx: (s.b.x - s.a.x) / s.len,
        dy: (s.b.y - s.a.y) / s.len
      };
    }
  }
  const last = HERMES.segs[HERMES.segs.length - 1];
  return { x: last.b.x, y: last.b.y, dx: 0, dy: 0 };
}

function drawHermes(now) {
  const cycle = HERMES.total * 2;
  let d = ((now / 1000) * 36) % cycle;
  if (d > HERMES.total) d = cycle - d;
  const p = hermesAt(d);
  const bob = Math.sin(now / 260) * 1.6;
  const dir = p.dx < -0.2 ? -1 : 1;
  ctx.save();
  ctx.translate(p.x, p.y + bob);
  // Ground shadow
  ctx.fillStyle = "rgba(0,0,0,.30)";
  ctx.beginPath(); ctx.ellipse(0, 14, 13, 4, 0, 0, 7); ctx.fill();
  // Glow
  const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  gl.addColorStop(0, "rgba(240,190,110,.30)");
  gl.addColorStop(1, "rgba(240,190,110,0)");
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
  // Body
  ctx.fillStyle = "#2b3a45";
  rr(ctx, -11, -9, 22, 17, 6); ctx.fill();
  ctx.strokeStyle = "#e8b463"; ctx.lineWidth = 1.2;
  rr(ctx, -11, -9, 22, 17, 6); ctx.stroke();
  // Winged helmet
  ctx.fillStyle = "#f0c47d";
  ctx.beginPath(); ctx.arc(0, -11, 6.5, Math.PI, 0); ctx.fill();
  const flap = Math.sin(now / 90) * 2.2;
  ctx.beginPath(); ctx.moveTo(-6, -13); ctx.lineTo(-14, -18 - flap); ctx.lineTo(-7, -15); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(6, -13); ctx.lineTo(14, -18 + flap); ctx.lineTo(7, -15); ctx.closePath(); ctx.fill();
  // Eyes
  ctx.fillStyle = "#9fe8ff";
  ctx.beginPath(); ctx.arc(-4 * dir, -3, 1.7, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(4 * dir, -3, 1.7, 0, 7); ctx.fill();
  // Satchel
  ctx.fillStyle = "#6b4a2a";
  rr(ctx, -6, 2, 12, 8, 2); ctx.fill();
  ctx.strokeStyle = "rgba(240,190,120,.45)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(6, 4); ctx.stroke();
  // Beacon
  const on = Math.sin(now / 300) > -0.2;
  ctx.fillStyle = on ? "#ffb347" : "rgba(255,179,71,.25)";
  ctx.beginPath(); ctx.arc(9, -7, 1.8, 0, 7); ctx.fill();
  if (on) {
    ctx.fillStyle = "rgba(255,179,71,.18)";
    ctx.beginPath(); ctx.arc(9, -7, 7, 0, 7); ctx.fill();
  }
  // Label
  ctx.fillStyle = "rgba(8,13,18,.82)";
  rr(ctx, -21, -32, 42, 12, 3); ctx.fill();
  ctx.strokeStyle = "rgba(232,180,99,.45)"; ctx.lineWidth = 1;
  rr(ctx, -21, -32, 42, 12, 3); ctx.stroke();
  ctx.fillStyle = "#f0c48a"; ctx.font = "800 7.5px system-ui"; ctx.textAlign = "center";
  ctx.fillText("HERMES", 0, -23.5);
  ctx.restore();
}

function drawDeskLife(now) {
  Object.values(CUBICLES).forEach((c, i) => {
    const owner = agents.find((a) => a.deskId === c.id);
    const running = owner && owner.status === "running";
    const mx = c.desk.x + c.desk.w / 2;
    const my = c.desk.y + c.desk.h / 2;
    const flick = 0.5 + 0.5 * Math.sin(now / 760 + i * 1.37);
    const glow = running ? "rgba(67,214,139," : "rgba(109,183,255,";
    ctx.fillStyle = glow + (0.045 + 0.045 * flick).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(mx, my, 30, 0, 7); ctx.fill();
    // Screen cursor blink
    if (Math.sin(now / 420 + i) > 0.55) {
      ctx.fillStyle = running ? "rgba(120,255,180,.55)" : "rgba(150,215,255,.45)";
      ctx.fillRect(mx - 8, my - 9, 2, 2);
    }
    // Mug steam
    const sx = c.desk.x + c.desk.w - 16;
    const sy = c.desk.y + 12;
    for (let k = 0; k < 2; k++) {
      const p = ((now / 2100) + k / 2 + i * 0.11) % 1;
      ctx.fillStyle = "rgba(235,240,245," + (0.16 * (1 - p)).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(sx + Math.sin(p * 6 + i) * 2.5, sy - p * 15, 1.4 + p * 1.2, 0, 7);
      ctx.fill();
    }
  });
}

function drawBoardLife(now) {  const b = FIXTURES.board;
  const gl = ctx.createRadialGradient(b.x + b.w / 2, b.y + b.h / 2, 10, b.x + b.w / 2, b.y + b.h / 2, 190);
  const a = .035 + .02 * Math.sin(now / 1200);
  gl.addColorStop(0, "rgba(255,200,120," + a.toFixed(3) + ")");
  gl.addColorStop(1, "rgba(255,200,120,0)");
  ctx.fillStyle = gl;
  ctx.fillRect(b.x - 80, b.y - 60, b.w + 160, b.h + 140);
  // Warm pin light that breathes over the notes
  ctx.fillStyle = "rgba(255,214,140," + (.06 + .04 * Math.sin(now / 700)).toFixed(3) + ")";
  ctx.fillRect(b.x + 8, b.y + 10, b.w - 16, b.h - 20);
}
function drawMeetingAura(now) {  const m = activeMeeting();
  if (!m) return;
  const c = CONF;
  const gl = ctx.createRadialGradient(c.x + c.w/2, c.y + c.h/2, 20, c.x + c.w/2, c.y + c.h/2, 250);
  gl.addColorStop(0, "rgba(232,164,92,.12)");
  gl.addColorStop(1, "rgba(232,164,92,0)");
  ctx.fillStyle = gl; ctx.fillRect(c.x - 150, c.y - 150, c.w + 300, c.h + 300);
}
function drawDynamicSigns(now) {
  // Cubicle name signs + owner lamps. Clear, but not a status banner.
  Object.values(CUBICLES).forEach(c => {
    const owner = agents.find(a => a.deskId === c.id);
    const x = c.x + c.w/2, y = c.y + 33;
    const pal = owner ? paletteFor(owner) : null;
    const w = owner ? Math.min(c.w - 60, Math.max(52, owner.name.length * 7 + 18)) : 70;
    ctx.fillStyle = owner ? "rgba(8,13,20,.92)" : "rgba(10,15,22,.72)";
    rr(ctx, x - w/2, y - 10, w, 15, 3); ctx.fill();
    ctx.strokeStyle = owner ? pal.body : "#35485d"; ctx.lineWidth = 1;
    rr(ctx, x - w/2, y - 10, w, 15, 3); ctx.stroke();
    ctx.fillStyle = owner ? "#f2f7fc" : "#6f8296";
    ctx.font = "800 8px system-ui"; ctx.textAlign = "center";
    ctx.fillText(owner ? owner.name.toUpperCase() : "OPEN DESK", x, y + 1);
    if (owner) {
      const active = a => a.status === "running";
      ctx.fillStyle = active(owner) ? "#43d68b" : (owner.lifecycleState === "ready" ? pal.body : "#6f8296");
      ctx.beginPath(); ctx.arc(x + w/2 - 5, y - 2.5, 2.2, 0, 7); ctx.fill();
    }
  });
  // Office door plate
  const o = OFFICE;
  const hancho = agents.find(a => a.deskId === "office");
  ctx.fillStyle = "rgba(10,15,22,.9)";
  rr(ctx, o.x + o.w/2 - 56, o.y + o.h - 22, 112, 14, 3); ctx.fill();
  ctx.strokeStyle = "#7a5426"; ctx.lineWidth = 1;
  rr(ctx, o.x + o.w/2 - 56, o.y + o.h - 22, 112, 14, 3); ctx.stroke();
  ctx.fillStyle = "#f0c48a"; ctx.font = "800 8px system-ui"; ctx.textAlign = "center";
  ctx.fillText(hancho ? hancho.name.toUpperCase() + " · CEO" : "CEO · OPEN", o.x + o.w/2, o.y + o.h - 12);
}

function agentLook(a) {
  const role = String(a.role || "").toLowerCase();
  let h = 0;
  const key = (a.id || "") + "|" + role;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  let hat = ["cap", "beanie", "visor", "horns", "none", "headset"][h % 6];
  if (/ceo|producer|manager|lead|director/.test(role) || a.id === "boss") hat = "crown";
  if (/qa|research|analyst/.test(role) && hat === "horns") hat = "visor";
  return {
    hat,
    glasses: /qa|research|analyst|engineer|ops/.test(role) || h % 7 === 0,
    scarf: h % 4 === 1,
    badge: /producer|manager|lead|ceo/.test(role) ? "star" : (h % 3 === 0 ? "chip" : "none"),
    accent: [a.appearance && a.appearance.paletteId, a.paletteId, a.id].join("")
  };
}

function drawAccessory(a, e, look, pal, baseY, bh, bob, seated) {
  const hy = baseY - bh - 9 - bob;
  ctx.save();
  if (look.scarf) {
    ctx.strokeStyle = pal.trim; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(e.x, hy + 10, 7, .15, Math.PI - .15); ctx.stroke();
  }
  if (look.badge !== "none") {
    ctx.fillStyle = look.badge === "star" ? "#f0c48a" : "#8fd0ff";
    if (look.badge === "star") {
      const bx = e.x + 7, by = baseY - bh + 7;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 1.6 : 3.6;
        const ang = -Math.PI / 2 + i * Math.PI / 5;
        ctx.lineTo(bx + Math.cos(ang) * r, by + Math.sin(ang) * r);
      }
      ctx.closePath(); ctx.fill();
    } else {
      rr(ctx, e.x - 11, baseY - bh + 6, 4, 3, 1); ctx.fill();
    }
  }
  if (look.glasses) {
    ctx.strokeStyle = "rgba(210,235,255,.8)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(e.x - 6, hy - 1); ctx.lineTo(e.x - 1, hy - 1);
    ctx.moveTo(e.x + 1, hy - 1); ctx.lineTo(e.x + 6, hy - 1); ctx.stroke();
  }
  if (look.hat === "cap") {
    ctx.fillStyle = pal.dark;
    ctx.beginPath(); ctx.arc(e.x, hy - 3, 9.4, Math.PI, 0); ctx.fill();
    ctx.fillRect(e.x, hy - 3, 10, 2);
  } else if (look.hat === "beanie") {
    ctx.fillStyle = pal.trim;
    ctx.beginPath(); ctx.arc(e.x, hy - 2, 9, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#f0c48a"; ctx.beginPath(); ctx.arc(e.x, hy - 11, 2, 0, 7); ctx.fill();
  } else if (look.hat === "visor") {
    ctx.fillStyle = "rgba(143,208,255,.22)"; ctx.strokeStyle = "#8fd0ff"; ctx.lineWidth = 1;
    rr(ctx, e.x - 8, hy - 3, 16, 4, 2); ctx.fill(); ctx.stroke();
  } else if (look.hat === "horns") {
    ctx.fillStyle = pal.dark;
    ctx.beginPath(); ctx.moveTo(e.x - 7, hy - 5); ctx.lineTo(e.x - 10, hy - 13); ctx.lineTo(e.x - 4, hy - 8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(e.x + 7, hy - 5); ctx.lineTo(e.x + 10, hy - 13); ctx.lineTo(e.x + 4, hy - 8); ctx.closePath(); ctx.fill();
  } else if (look.hat === "crown") {
    ctx.fillStyle = "rgba(240,196,138,.92)";
    ctx.beginPath();
    ctx.moveTo(e.x - 8, hy - 6); ctx.lineTo(e.x - 7, hy - 13); ctx.lineTo(e.x - 2, hy - 9);
    ctx.lineTo(e.x, hy - 14); ctx.lineTo(e.x + 2, hy - 9); ctx.lineTo(e.x + 7, hy - 13);
    ctx.lineTo(e.x + 8, hy - 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff3d6"; ctx.beginPath(); ctx.arc(e.x, hy - 8, 1.2, 0, 7); ctx.fill();
  } else if (look.hat === "headset") {
    ctx.strokeStyle = "#8fd0ff"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(e.x, hy - 2, 10, Math.PI * .88, Math.PI * .12); ctx.stroke();
    ctx.fillStyle = "#8fd0ff"; rr(ctx, e.x + 8, hy - 3, 3, 5, 1.5); ctx.fill();
    ctx.fillStyle = "#6ee7a5"; ctx.beginPath(); ctx.arc(e.x - 9, hy + 1, 1.2, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawAgent(a, e, now) {
  const pal = paletteFor(a);
  const moving = !!e.tween;
  const meeting = e.mode === "meeting";
  const working = e.mode === "work" || (liveFor(a.id) && e.mode !== "meeting");
  const atDesk = e.mode === "desk" || e.mode === "work";
  const seated = e.sitting && (atDesk || meeting);
  const isCloud = !!a.cloud || (a.adapterConfig && a.adapterConfig.type === "cloud");
  const isBoss = a.id === "boss";
  const bob = moving ? Math.abs(Math.sin(e.stepPhase)) * 3 : Math.sin(now / 900 + a.id.length) * .8;
  const baseY = e.y;
  const bodyTop = baseY - (seated ? 24 : 38) - bob;
  const ringColor = isBoss ? "#f0c37a" : meeting ? STATUS_COLOR.meeting : (a.status === "running" ? STATUS_COLOR.running :
    a.status === "paused" || a.status === "pending" ? STATUS_COLOR.pending :
    a.status === "rejected" ? STATUS_COLOR.rejected : STATUS_COLOR.idle);

  // Selected halo
  if (selectedId === a.id) {
    ctx.save();
    ctx.strokeStyle = "rgba(232,164,92,.65)"; ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]); ctx.lineDashOffset = -now / 55;
    ctx.beginPath(); ctx.ellipse(e.x, baseY + 3, 24, 12, 0, 0, 7); ctx.stroke();
    ctx.restore();
  }

  // Floor ring = live status (shape, not a banner)
  ctx.strokeStyle = ringColor;
  ctx.globalAlpha = working ? .65 + .35 * Math.sin(now / 220) : .8;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(e.x, baseY + 8, 17, 6, 0, 0, 7); ctx.stroke();
  ctx.globalAlpha = 1;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,.42)";
  ctx.beginPath(); ctx.ellipse(e.x, baseY + 8, 15, 5, 0, 0, 7); ctx.fill();

  if (isCloud) {
    // Cloud body
    const yy = baseY - 22 - bob + (moving ? 0 : Math.sin(now / 560 + a.id.length) * 1.5);
    ctx.globalAlpha = .96;
    ctx.fillStyle = pal.body;
    ctx.beginPath();
    ctx.arc(e.x - 11, yy, 8, 0, 7); ctx.arc(e.x, yy - 8, 11, 0, 7);
    ctx.arc(e.x + 11, yy, 8, 0, 7); ctx.arc(e.x, yy + 4, 10, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.trim;
    rr(ctx, e.x - 13, yy + 1, 26, 5, 2.5); ctx.fill();
    ctx.fillStyle = pal.dark;
    const fx = (e.face || 1) * 2;
    ctx.beginPath(); ctx.arc(e.x - 3.5 + fx, yy - 5, 1.5, 0, 7); ctx.arc(e.x + 3.5 + fx, yy - 5, 1.5, 0, 7); ctx.fill();
    if (working) {
      ctx.fillStyle = "rgba(200,240,255,.85)";
      const rp = Math.floor(now / 240) % 3;
      ctx.beginPath();
      ctx.arc(e.x - 7, yy + 12 + rp * 2, 1.2, 0, 7);
      ctx.arc(e.x + 1, yy + 13 + ((rp + 1) % 3) * 2, 1.2, 0, 7);
      ctx.arc(e.x + 8, yy + 12 + ((rp + 2) % 3) * 2, 1.2, 0, 7); ctx.fill();
    }
  } else {
    // Body
    const look = agentLook(a);
    ctx.fillStyle = pal.body;
    const bh = seated ? 24 : 30;
    rr(ctx, e.x - 10, baseY - bh - bob, 20, bh, 8); ctx.fill();
    // Head
    ctx.fillStyle = pal.trim;
    ctx.beginPath(); ctx.arc(e.x, baseY - bh - 9 - bob, 9, 0, 7); ctx.fill();
    // Hair / crown
    ctx.fillStyle = pal.dark;
    ctx.beginPath(); ctx.arc(e.x, baseY - bh - 12 - bob, 8.6, Math.PI * 1.06, Math.PI * 1.94); ctx.fill();
    // Eyes
    const fx = (e.face || 1) * 2.2;
    ctx.beginPath(); ctx.arc(e.x - 3.2 + fx, baseY - bh - 8 - bob, 1.35, 0, 7);
    ctx.arc(e.x + 3.2 + fx, baseY - bh - 8 - bob, 1.35, 0, 7); ctx.fill();
    drawAccessory(a, e, look, pal, baseY, bh, bob, seated);
    // Arms / typing
    if (working && seated) {
      const tap = Math.floor(now / 150) % 2;
      ctx.fillStyle = pal.body;
      ctx.beginPath(); ctx.ellipse(e.x - 8, baseY - 25 + (tap ? 1 : 0), 4.2, 2.4, -.35, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(e.x + 8, baseY - 25 - (tap ? 0 : 1), 4.2, 2.4, .35, 0, 7); ctx.fill();
    } else if (moving) {
      ctx.strokeStyle = pal.trim; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(e.x - 7, baseY - 16); ctx.lineTo(e.x - 11, baseY - 6 + Math.sin(e.stepPhase) * 2);
      ctx.moveTo(e.x + 7, baseY - 16); ctx.lineTo(e.x + 11, baseY - 6 - Math.sin(e.stepPhase) * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = pal.trim; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(e.x - 8, baseY - 17); ctx.lineTo(e.x - 11, baseY - 9);
      ctx.moveTo(e.x + 8, baseY - 17); ctx.lineTo(e.x + 11, baseY - 9);
      ctx.stroke();
    }
  }

  // Name tag
  const tagY = baseY - (seated ? 58 : 62) - bob;
  ctx.font = "700 9px system-ui"; ctx.textAlign = "center";
  const tw = Math.max(34, ctx.measureText(a.name).width + 12);
  ctx.fillStyle = "rgba(8,13,20,.82)";
  rr(ctx, e.x - tw/2, tagY, tw, 13, 6); ctx.fill();
  ctx.strokeStyle = isBoss ? "rgba(240,195,122,.85)" : a.status === "running" ? "rgba(67,214,139,.55)" : "rgba(90,120,150,.35)";
  ctx.lineWidth = isBoss ? 1.6 : 1;
  rr(ctx, e.x - tw/2, tagY, tw, 13, 6); ctx.stroke();
  ctx.fillStyle = isBoss ? "#ffdf9e" : "#f0f6fb";
  ctx.fillText(a.name, e.x, tagY + 9.5);

  // error mark only
  if (a.status === "running") {
    ctx.fillStyle = "#43d68b";
    ctx.beginPath(); ctx.arc(e.x + tw/2 + 3, tagY + 3, 2.4, 0, 7); ctx.fill();
  }
}

function wrapText(text, maxChars) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
    if (lines.length >= 4) break;
  }
  if (cur && lines.length < 4) lines.push(cur);
  return lines.length ? lines : [""];
}

function drawBubble(e, text, now, tone) {
  const lines = wrapText(text, 34);
  const w = Math.min(250, Math.max(100, Math.max.apply(null, lines.map(l => l.length)) * 5.4 + 18));
  const h = 14 + lines.length * 11;
  const x = Math.max(10, Math.min(WW - w - 10, e.x - w/2));
  const y = e.y - 78 - h;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fillStyle = tone === "meeting" ? "rgba(37,27,14,.96)" : "rgba(12,21,31,.96)";
  rr(ctx, x, y, w, h, 7); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
  ctx.strokeStyle = tone === "meeting" ? "#b77d3a" : "#3d5d7b"; ctx.lineWidth = 1;
  rr(ctx, x, y, w, h, 7); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(e.x - 5, y + h); ctx.lineTo(e.x + 5, y + h); ctx.lineTo(e.x, y + h + 6); ctx.closePath();
  ctx.fillStyle = tone === "meeting" ? "rgba(37,27,14,.96)" : "rgba(12,21,31,.96)"; ctx.fill();
  ctx.fillStyle = tone === "meeting" ? "#f1d2a2" : "#d7e6f4";
  ctx.font = "600 8.5px system-ui"; ctx.textAlign = "left";
  lines.forEach((l, i) => ctx.fillText(l, x + 9, y + 13 + i * 11));
  ctx.restore();
}

function drawBubbles(now) {
  const m = activeMeeting();
  const meetingBubbles = {};
  if (m && (m.state === "in_session" || m.state === "gathering")) {
    (m.notes || []).forEach(n => {
      const age = now - new Date(n.at).getTime();
      if (age < 26000) meetingBubbles[n.agentId] = n.text;
    });
  }
  agents.forEach(a => {
    const e = ents[a.id]; if (!e) return;
    let text = meetingBubbles[a.id];
    let tone = "meeting";
    if (!text && e.bubble && Date.now() < e.bubble.until) { text = e.bubble.text; tone = "normal"; }
    if (text) drawBubble(e, text, now, tone);
  });
}

function drawPlacing(now) {
  if (!placingDeskFor) return;
  const a = agentById(placingDeskFor);
  if (!a) { placingDeskFor = null; return; }
  const all = Object.values(CUBICLES).concat([OFFICE]);
  ctx.save();
  all.forEach(c => {
    if (c.id === a.deskId) return;
    const owner = agents.find(x => x.deskId === c.id);
    ctx.fillStyle = owner ? "rgba(232,164,92,.10)" : "rgba(67,214,139,.14)";
    rr(ctx, c.x + 4, c.y + 4, c.w - 8, c.h - 8, 8); ctx.fill();
    ctx.strokeStyle = owner ? "rgba(232,164,92,.75)" : "rgba(67,214,139,.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]); ctx.lineDashOffset = -now / 40;
    rr(ctx, c.x + 4, c.y + 4, c.w - 8, c.h - 8, 8); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = owner ? "#f0c48a" : "#7ce8b0";
    ctx.font = "800 10px system-ui"; ctx.textAlign = "center";
    ctx.fillText(owner ? "SWAP HERE" : "MOVE HERE", c.x + c.w/2, c.y + c.h/2);
  });
  ctx.restore();
}

function drawSelectedPath() {
  if (!selectedId) return;
  const e = ents[selectedId];
  if (!e || !e.path || e.pathI >= e.path.length) return;
  ctx.save();
  ctx.strokeStyle = "rgba(232,164,92,.45)"; ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 6]);
  ctx.beginPath(); ctx.moveTo(e.x, e.y);
  for (let i = e.pathI; i < e.path.length; i++) ctx.lineTo(e.path[i].x, e.path[i].y);
  ctx.stroke(); ctx.restore();
}

function drawMiniMap() {
  const el = $id("mini");
  if (!el) return;
  const c = el.getContext("2d");
  if (!c) return;
  const mw = el.width, mh = el.height;
  const sx = mw / WW, sy = mh / WH;
  c.clearRect(0, 0, mw, mh);
  c.fillStyle = "#05090d";
  c.fillRect(0, 0, mw, mh);
  const zoneTone = { foundry:"#2c5c4a", skyloft:"#2f4c6b", workshop:"#6b5429", yard:"#31562f" };
  Object.keys(ZONES).forEach((key) => {
    const z = ZONES[key];
    c.fillStyle = zoneTone[key] || "#243040";
    c.globalAlpha = .18;
    c.fillRect(z.x * sx, z.y * sy, z.w * sx, z.h * sy);
    c.globalAlpha = 1;
    c.strokeStyle = zoneTone[key] || "#31404f";
    c.lineWidth = 1;
    c.strokeRect(z.x * sx + .5, z.y * sy + .5, z.w * sx - 1, z.h * sy - 1);
  });
  c.fillStyle = "#26313b";
  Object.values(CUBICLES).forEach((cu) => {
    c.fillRect(cu.x * sx, cu.y * sy, Math.max(1, cu.w * sx), Math.max(1, cu.h * sy));
  });
  // Conference and CEO office as brighter landmarks.
  c.fillStyle = "#5c4a29";
  [OFFICE, CONF].forEach((r) => {
    if (!r) return;
    c.fillRect(r.x * sx, r.y * sy, Math.max(1, r.w * sx), Math.max(1, r.h * sy));
  });
  agents.forEach((a) => {
    const e = ents[a.id];
    if (!e) return;
    c.beginPath();
    c.arc(e.x * sx, e.y * sy, a.id === selectedId ? 2.6 : 1.7, 0, Math.PI * 2);
    c.fillStyle = statusColor(a);
    c.fill();
  });
  if (boss) {
    c.beginPath();
    c.arc(boss.x * sx, boss.y * sy, povMode ? 3 : 2.3, 0, Math.PI * 2);
    c.fillStyle = "#ffd58a";
    c.fill();
    c.strokeStyle = "rgba(0,0,0,.55)"; c.lineWidth = 1; c.stroke();
  }
  const viewW = W / cam.s, viewH = H / cam.s;
  c.strokeStyle = "rgba(240,195,122,.85)";
  c.lineWidth = 1;
  c.strokeRect((cam.x - viewW / 2) * sx, (cam.y - viewH / 2) * sy, viewW * sx, viewH * sy);
  setText("mmCoords", Math.round(cam.x) + " · " + Math.round(cam.y));
}
/* VOKREW EDIT: drawFrame() below loses drawBoss()/drawPovWorld() (§4 cuts). */
function drawFrame(now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.scale(DPR, DPR);
  ctx.fillStyle = "#05080c"; ctx.fillRect(0, 0, W, H);
  ctx.translate(W/2, H/2);
  ctx.scale(cam.s, cam.s);
  ctx.translate(-cam.x, -cam.y);
  if (staticWorld) ctx.drawImage(staticWorld, 0, 0);
  drawSkyLive(now);
  drawYardLive(now);
  drawWorkshopLive(now);
  drawDeskLife(now);
  drawBoardLife(now);
  drawBoardNotes(now);
  drawRigLive(now);
  drawHearthLive(now);
  drawConveyorLive(now);
  drawMeetingAura(now);
  drawDynamicSigns(now);
  drawSelectedPath();
  drawPlacing(now);
  const order = agents.slice().sort((a, b) => {
    const ea = ents[a.id], eb = ents[b.id];
    return ((ea ? ea.y : 0) - (eb ? eb.y : 0));
  });
  order.forEach(a => { const e = ents[a.id]; if (e) drawAgent(a, e, now); });
  drawHermes(now);
  drawBubbles(now);
  ctx.restore();
}
/* VOKREW EDIT: frame() pauses while the Floor tab is closed and
   loses its POV-prompt block (§4 cuts). Canvas handlers stay verbatim;
   their POV branches can never fire (povMode is permanently null). */
let lastMini = 0;
function frame(now) {
  if (!floorActive) { lastFrame = now; requestAnimationFrame(frame); return; }
  const dt = Math.min(.12, (now - lastFrame) / 1000);
  lastFrame = now;
  simAcc += dt;
  let guard = 0;
  while (simAcc >= 1/30 && guard++ < 6) {
    simulate(1/30);
    simAcc -= 1/30;
  }
  updateCamera(dt);
  if (now - lastRender >= 30) {
    drawFrame(now);
    lastRender = now;
  }
  if (now - lastMini > 250) {
    drawMiniMap();
    lastMini = now;
  }
  requestAnimationFrame(frame);
}

/* -------------------------------------------------------------------------
   Canvas interaction
   ------------------------------------------------------------------------- */
function hitAgent(wx, wy) {
  let best = null, bd = 32;
  agents.forEach(a => {
    const e = ents[a.id]; if (!e) return;
    const d = Math.hypot(e.x - wx, e.y - wy);
    if (d < bd) { bd = d; best = a.id; }
  });
  return best;
}
function hitCubicle(wx, wy) {
  const all = Object.values(CUBICLES).concat([OFFICE]);
  return all.find(c => wx >= c.x && wx <= c.x + c.w && wy >= c.y && wy <= c.y + c.h) || null;
}

cv.addEventListener("pointerdown", (ev) => {
  drag = { sx:ev.clientX, sy:ev.clientY, cx:cam.x, cy:cam.y, pov:!!povMode };
  dragged = false;
  cv.setPointerCapture(ev.pointerId);
});
cv.addEventListener("pointermove", (ev) => {
  if (drag) {
    if (drag.pov) return; // in POV the camera belongs to the character
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    dragged = true;
    cam.mode = "free";
    cam.x = drag.cx - dx / cam.s; cam.y = drag.cy - dy / cam.s;
    cam.tx = cam.x; cam.ty = cam.y; cam.ts = cam.s;
    return;
  }
  const r = cv.getBoundingClientRect();
  const p = screenToWorld(ev.clientX - r.left, ev.clientY - r.top);
  hoverAgent = hitAgent(p.x, p.y);
  cv.style.cursor = povMode === "walk" ? "crosshair" : hoverAgent ? "pointer" : (placingDeskFor ? "crosshair" : "default");
});
cv.addEventListener("pointerup", (ev) => {
  const wasDrag = dragged;
  drag = null; dragged = false;
  if (wasDrag) return;
  const r = cv.getBoundingClientRect();
  const p = screenToWorld(ev.clientX - r.left, ev.clientY - r.top);
  if (povMode === "ride") {
    if (boss && Math.hypot(boss.x - p.x, boss.y - p.y) <= 28) exitRideToWalk();
    return;
  }
  if (povMode === "walk") {
    if (boss && Math.hypot(boss.x - p.x, boss.y - p.y) <= 22) return;
    const aid = hitAgent(p.x, p.y);
    if (aid) {
      const owner = agentById(aid);
      const door = owner ? doorwayFor(owner) : null;
      if (door && bossMoveTo(door)) toast("Walking to " + owner.name + "'s doorstep.", "");
      else if (ents[aid] && bossMoveTo({ x:ents[aid].x, y:ents[aid].y })) toast("Walking to " + owner.name + ".", "");
      return;
    }
    const cube = hitCubicle(p.x, p.y);
    if (cube) {
      const owner = agents.find(a => a.deskId === cube.id);
      const door = owner ? doorwayFor(owner) : null;
      if (door && bossMoveTo(door)) toast("Walking to " + owner.name + "'s doorstep.", "");
      return;
    }
    if (bossMoveTo(p)) sfx("tick");
    else toast("No walkable route there.", "bad");
    return;
  }
  if (placingDeskFor) {
    const cube = hitCubicle(p.x, p.y);
    if (cube) { updateAgentDesk(placingDeskFor, cube.id); return; }
    placingDeskFor = null;
    toast("Desk placement cancelled", "bad");
    return;
  }
  const sticky = stickyHits.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
  if (sticky) { openTask(sticky.taskId); return; }
  const aid = hitAgent(p.x, p.y);
  if (aid) { selectAgent(aid); return; }
  const cube = hitCubicle(p.x, p.y);
  if (cube) {
    const owner = agents.find(a => a.deskId === cube.id);
    if (owner) { selectAgent(owner.id); return; }
  }
  selectedId = null; selectedTaskId = null; focusId = null;
  closePanels();
  renderAll();
});
cv.addEventListener("pointerleave", () => { drag = null; dragged = false; hoverAgent = null; });

cv.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  if (povMode) return; // camera is attached in POV
  const r = cv.getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const before = screenToWorld(mx, my);
  cam.mode = "free";
  const minS = overviewScale() * .72, maxS = overviewScale() * 6;
  cam.s = Math.max(minS, Math.min(maxS, cam.s * (ev.deltaY < 0 ? 1.12 : .892)));
  cam.tx = cam.x = before.x - (mx - W/2) / cam.s;
  cam.ty = cam.y = before.y - (my - H/2) / cam.s;
  cam.ts = cam.s;
}, { passive:false });

document.querySelectorAll("#viewbar button").forEach(b => {
  b.addEventListener("click", () => {
    if (povMode) stopPov();
    const v = b.dataset.view;
    if (v === "overview") { setView("overview"); focusId = null; }
    else setView("room", v);
    document.querySelectorAll("#viewbar button").forEach(x => x.classList.toggle("on", x === b));
  });
});

window.addEventListener("resize", resizeCanvas);

/* -------------------------------------------------------------------------
   VOKREW SEAM — UI/poll state (floor-oc's pollAll/api layer is replaced
   by the adapter boundary at the bottom of this file).
   ------------------------------------------------------------------------- */
let connected = false;
let pollBusy = false;
let focusSig = "";
let taskSig = "";
let toastTimer = 0;
let audioCtx = null;
let rigText = "lanes \u2014";   // state source reports lane health here (spec §3); fixture sets it in Stage 1
let floorActive = false;      // app shell toggles via VokrewFloor.setActive()
const $id = (x) => document.getElementById(x);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function setText(id, v) { const el = $id(id); if (el) el.textContent = v; }
function fmtTok(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(2).replace(/\.00$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}
function timeShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour12: false });
}
function dayShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + timeShort(iso);
}
function initials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
function modelName(a) {
  if (!a || !a.adapterConfig) return "no brain";
  return String(a.adapterConfig.model || "").replace(/^ollama-local\//, "").replace(/^cloud\//, "");
}
function isLoaded(a) {
  const m = modelName(a);
  return (ollamaPs || []).some((p) => String(p.name || p.model || "") === m);
}
function statusColor(a) {
  if (a.status === "running") return "#43d68b";
  if (a.status === "pending") return "#f0c47d";
  if (a.status === "paused") return "#7f90a4";
  if (a.status === "rejected") return "#e5535e";
  return "#5f7287";
}
function deskLabel(id) {
  if (!id) return "unassigned";
  if (id === "office") return "CEO office";
  const c = CUBICLES[id];
  if (!c) return id;
  return "cubicle · " + (c.zone === "skyloft" ? "Skyloft" : c.zone === "workshop" ? "Workshop" : "Foundry");
}
function pillClass(s) {
  return ["todo", "in_progress", "done", "failed", "blocked_budget", "pending", "paused"].includes(s) ? s : "todo";
}
function pillLabel(s) {
  return String(s || "todo").replace(/_/g, " ");
}

/* -------------------------------------------------------------------------
   Sound
   ------------------------------------------------------------------------- */
function sfx(kind) {
  if (!soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const map = {
      tick: [520, .035, .022], click: [340, .06, .03], good: [660, .14, .045],
      bad: [170, .18, .05], note: [430, .09, .03], run: [300, .2, .035],
      meet: [250, .24, .04]
    };
    const m = map[kind] || map.tick;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = kind === "bad" ? "sawtooth" : "sine";
    o.frequency.setValueAtTime(m[0], t);
    if (kind === "good") o.frequency.exponentialRampToValueAtTime(m[0] * 1.5, t + m[1]);
    g.gain.setValueAtTime(m[2], t);
    g.gain.exponentialRampToValueAtTime(.0001, t + m[1]);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + m[1] + .02);
  } catch (e) {}
}

function toast(msg, tone) {
  const el = $id("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "show " + (tone || "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, 4200);
  if (tone === "bad") sfx("bad");
  else if (tone === "good") sfx("good");
}

/* -------------------------------------------------------------------------
   VOKREW SEAM — transitions. Verbatim from floor-oc's noteTransitions()
   minus the meeting block (meetings never arrive in Phase 1).
   ------------------------------------------------------------------------- */
function noteTransitions() {
  runs.forEach((r) => {
    const prev = prevRunStates[r.id];
    if (prev === "running" && r.state !== "running") {
      const t = tasks.find((x) => x.id === r.taskId);
      if (r.state === "done") {
        const stamped = t && t.stamped;
        toast("Run finished: " + (t ? t.identifier : "task") + (stamped ? " \u00b7 STAMPED" : " \u00b7 unstamped"), stamped ? "good" : "");
      } else if (r.state === "failed" || r.state === "blocked_budget") {
        toast("Run " + r.state.replace("_", " ") + ": " + (t ? t.identifier : "task") + " \u2014 " + String(r.error || "").slice(0, 90), "bad");
      }
    }
    prevRunStates[r.id] = r.state;
  });
}

/* The floor-oc action bar is cut (spec §4); renderTop()/selectAgent()
   still call updateButtons(), so it stays as a deliberate no-op seam. */
function updateButtons() {}

/* VOKREW SEAM — floor-oc polled Ollama for the sidebar rig line. In
   Vokrew the state source reports lane health instead (spec §3). */
function renderRigFoot() { setText("rigFoot", rigText); }

/* -------------------------------------------------------------------------
   Panels / camera (slimmed to the kept chrome: focus panel only)
   ------------------------------------------------------------------------- */
const RIGHT_PANELS = ["focus"];

function closeRightPanels(except) {
  RIGHT_PANELS.forEach((id) => { if (id !== except) $id(id).classList.remove("open"); });
  if (except !== "focus") { selectedId = null; focusId = null; selectedTaskId = null; }
}

function closePanels() {
  RIGHT_PANELS.forEach((id) => $id(id).classList.remove("open"));
  selectedId = null;
  selectedTaskId = null;
  focusId = null;
  if (cam.mode === "focus") setView("overview");
}

/* VOKREW SEAM — Phase 1 quest rows select + track only. The run card
   (Plan / Work / Review) is Stage 2/3 scope, and there is no
   Floor-server task endpoint to fetch from. */
function openTask(id) {
  const t = tasks.find((x) => x.id === id || x.identifier === id);
  if (!t) return;
  selectedTaskId = t.id;
  trackedTaskId = t.id;
  renderTaskList();
  renderQuestTracker();
  sfx("click");
}

function renderAll() {
  renderTop();
  renderRoster();
  renderTaskList();
  renderFocusLive();
  renderRigFoot();
}
/* VOKREW EDIT: renderTop() loses its decisions-badge line (panel cut, §4).
   The CREW LV setText stays: the element is absent, setText() no-ops. */
function renderTop() {
  const dot = $id("connDot");
  if (dot) {
    dot.style.background = connected ? "var(--green)" : "var(--red)";
    dot.style.boxShadow = "0 0 8px " + (connected ? "var(--green)" : "var(--red)");
  }
  setText("floorStatus", connected ? (agents.length + " crew · " + liveRuns.length + " running") : "offline");
  const b = budget || { usedGlobal: 0, globalCap: 1000000, perAgentCap: 250000 };
  setText("budgetStatus", fmtTok(b.usedGlobal || 0) + " / " + fmtTok(b.globalCap || 1000000));
  const bw = $id("budgetWrap");
  if (bw) bw.title = "Global tokens today. Per-agent cap: " + fmtTok(b.perAgentCap || 250000) + ". Day: " + (b.day || "");
  const cc = $id("crewCount");
  if (cc) cc.textContent = "(" + agents.length + ")";
  setText("runCount", liveRuns.length + " live");
  const totalXp = agents.reduce((n, a) => n + (a.xp || 0), 0);
  setText("crewLevel", String(Math.floor(Math.sqrt(totalXp / 25)) + 1));
  renderQuestTracker();
  updateButtons();
}
/* VOKREW EDIT: renderRoster() loses the XP bar + LV tag (no XP
   source exists on the bridge, spec §4); the tag shows agent status. */
function renderRoster() {
  const el = $id("roster");
  if (!el) return;
  if (!agents.length) {
    el.innerHTML = '<div class="muted" style="padding:8px">No agents yet.</div>';
    return;
  }
  el.innerHTML = agents.map((a) => {
    const pal = paletteFor(a);
    const loaded = !a.cloud && isLoaded(a);
    const xp = a.xp || 0;
    const lvl = a.level || (Math.floor(Math.sqrt(xp / 25)) + 1);
    const floorXp = 25 * Math.pow(lvl - 1, 2);
    const nextXp = 25 * Math.pow(lvl, 2);
    const pct = Math.max(0, Math.min(100, Math.round(((xp - floorXp) / Math.max(1, nextXp - floorXp)) * 100)));
    return '<div class="acard ' + (selectedId === a.id ? "sel" : "") + '" data-id="' + esc(a.id) + '">' +
      '<div class="avatar" style="background:' + pal.body + ';box-shadow:0 0 12px ' + pal.glow + '55">' +
      esc(initials(a.name)) + (a.cloud ? '<span class="cloud">☁</span>' : "") + '</div>' +
      '<div class="ainfo"><div class="aname">' + esc(a.name) + '</div>' +
      '<div class="arole">' + esc(a.role) + '</div>' +
      '<div class="abrain">' + (a.cloud
        ? "cloud · " + esc((a.adapterConfig && a.adapterConfig.route) || "spool")
        : esc(modelName(a)) + (loaded ? '<span class="loaded"> · loaded</span>' : "")) + '</div>' +
      '</div>' +
      '<div class="astatus"><span class="sdot" title="' + esc(a.status) + '" style="background:' + statusColor(a) +
      ';box-shadow:0 0 7px ' + statusColor(a) + '"></span><span class="stag">' + esc(a.status || "idle") + '</span>' +
      (a.heartbeat ? '<span class="hb">HB</span>' : "") + '</div></div>';
  }).join("");
  el.querySelectorAll(".acard").forEach((card) => {
    card.addEventListener("click", () => { selectAgent(card.dataset.id); });
  });
  setText("crewSub", "local + free cloud");
}
function renderTaskList() {
  const el = $id("tasklist");
  if (!el) return;
  const open = tasks.filter((t) => t.status !== "done");
  setText("taskCount", open.length + " open / " + tasks.length + " total");
  if (!tasks.length) {
    el.innerHTML = '<div class="muted" style="padding:8px">No runs yet.</div>';
    return;
  }
  el.innerHTML = tasks.slice(0, 40).map((t) => {
    const a = agentById(t.agentId);
    return '<div class="trow ' + (selectedTaskId === t.id ? "sel" : "") + '" data-id="' + esc(t.id) + '">' +
      '<div class="t1"><span class="id">' + esc(t.identifier) + '</span>' +
      '<span class="tt">' + esc(t.title) + '</span>' +
      (t.repeat ? '<span class="loop" title="repeating quest · ' + (t.repeatCount || 0) + ' cycles">⟳' + (t.repeatCount || 0) + '</span>' : '') +
      '</div>' +
      '<div class="t2"><span class="pill ' + pillClass(t.status) + '">' + esc(pillLabel(t.status)) + '</span>' +
      '<span>' + esc(a ? a.name : "unassigned") + '</span></div></div>';
  }).join("");
  el.querySelectorAll(".trow").forEach((row) => {
    row.addEventListener("click", () => { openTask(row.dataset.id); });
  });
}

function trackedTask() {
  if (trackedTaskId) {
    const t = tasks.find((x) => x.id === trackedTaskId);
    if (t) return t;
  }
  return tasks.find((x) => x.repeat && !x.repeatPaused)
    || tasks.find((x) => x.repeat)
    || tasks.find((x) => x.status === "in_progress")
    || tasks[0]
    || null;
}

function renderQuestTracker() {
  const el = $id("questtracker");
  if (!el) return;
  const t = trackedTask();
  if (!t) {
    el.className = "hudpanel qempty";
    el.innerHTML = '<div class="qhead">ACTIVE QUEST</div>' +
      '<div class="qtitle">No quest assigned</div>' +
      '<div class="qmeta">Create a task to give the party work.</div>';
    el.onclick = null;
    return;
  }
  const a = agentById(t.agentId);
  const live = a ? liveFor(a.id) : null;
  const running = t.status === "in_progress" || !!live;
  const every = Math.max(30, t.repeatEverySeconds || 90);
  const count = t.repeatCount || 0;
  let state, next, pct;
  if (running) {
    state = "IN PROGRESS";
    next = "RUNNING NOW";
    pct = 100;
  } else if (t.repeatPaused) {
    state = "LOOP HALTED";
    next = "NEEDS A HUMAN";
    pct = 0;
  } else if (t.repeat) {
    state = "QUEUED";
    if (t.repeatNextAt) {
      const remain = Math.max(0, Math.ceil((new Date(t.repeatNextAt).getTime() - Date.now()) / 1000));
      pct = Math.max(0, Math.min(100, 100 - (remain / every) * 100));
      next = remain > 0 ? "NEXT IN " + remain + "s" : "STARTING…";
    } else {
      pct = 0;
      next = "STANDING BY";
    }
  } else {
    state = pillLabel(t.status).toUpperCase();
    next = t.status === "done" ? "COMPLETE" : "ONE-SHOT";
    pct = t.status === "done" ? 100 : 0;
  }
  const cycle = t.repeat ? String(count + 1).padStart(2, "0") : "—";
  el.className = "hudpanel" + (running ? " running" : "") + (t.repeatPaused ? " paused" : "");
  el.innerHTML =
    '<div class="qhead">' + (t.repeat ? "ACTIVE QUEST · REPEAT" : "ACTIVE QUEST") +
      '<span class="qcycle">' + (t.repeat ? "CYCLE " + cycle : "ONE-SHOT") + '</span></div>' +
    '<div class="qtitle">' + esc(t.title) + '</div>' +
    '<div class="qmeta">' + esc(t.identifier) + ' · ' + esc(a ? a.name : "unassigned") +
      (t.repeat ? ' · LOOP ' + every + 's · ' + count + ' cleared' : '') + '</div>' +
    '<div class="qbar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
    '<div class="qfoot"><span>STATUS <b>' + esc(state) + '</b></span>' +
      '<span class="qn">' + esc(next) + '</span></div>' +
    (t.repeatPaused && t.repeatReason ? '<div class="qmeta" style="color:#e8a45c">' + esc(t.repeatReason) + '</div>' : '');
  el.onclick = () => openTask(t.id);
}
function selectAgent(id) {
  if (!agentById(id)) return;
  selectedId = id;
  selectedTaskId = null;
  if (!povMode) focusId = id;
  closeRightPanels("focus");
  $id("focus").classList.add("open");
  if (!povMode) setView("focus");
  focusSig = "";
  renderFocus();
  renderRoster();
  sfx("click");
}
function nowText(a) {
  const live = liveFor(a.id);
  if (live) {
    const t = tasks.find((x) => x.id === live.taskId);
    const step = live.lastStep && live.lastStep.text ? " · " + String(live.lastStep.text).slice(0, 140) : "";
    return ["Running " + (live.taskIdentifier || "a task"), (t ? t.title : "") + step];
  }
  if (a.lifecycleState === "pending_approval") return ["Awaiting approval", "A human must approve this agent in Decisions before it can run."];
  if (a.lifecycleState === "paused") return ["Paused", "Heartbeat is " + (a.heartbeat ? "on" : "off") + ". Resume from this card to let it work."];
  if (a.lifecycleState === "rejected") return ["Rejected", "This agent was rejected and should be removed."];
  const e = ents[a.id];
  if (!e) return ["On the floor", "Finding its place."];
  if (e.mode === "meeting") {
    const m = activeMeeting();
    return ["In conference", m && m.topic ? "Topic: " + m.topic : "Crew stand-up at the conference table."];
  }
  if (e.mode === "break") return ["On a break", "At " + (e.activityLabel || "a fixture") + ". Back at the desk shortly."];
  if (e.mode === "visit") {
    const o = agentById(e.visitId);
    return ["Visiting " + (o ? o.name : "a colleague"), "Waiting at the doorstep — never inside another cubicle."];
  }
  if (e.mode === "yield") return ["Stepping aside", "Yielding the lane to a colleague."];
  if (e.mode === "work") return ["Working at its desk", "Head down on the current run."];
  return ["At its desk", "Work is the default; heartbeat " + (a.heartbeat ? "on" : "off") + "."];
}

function focusStateSig(a) {
  const live = liveFor(a.id);
  const e = ents[a.id];
  return [
    a.id, a.status, a.lifecycleState, a.heartbeat, a.deskId, a.reportsTo,
    a.personality, a.xp, a.tasksDone, (a.memory || []).length, (a.beliefs || []).length,
    a.talkCount || 0,
    live ? live.id : "-", e ? e.mode : "-", e ? e.activity : "-", modelName(a)
  ].join("|");
}

function renderFocusLive() {
  if (!selectedId) return;
  const a = agentById(selectedId);
  if (!a) {
    $id("focus").classList.remove("open");
    selectedId = null;
    if (!povMode) {
      focusId = null;
      if (cam.mode === "focus") setView("overview");
    }
    return;
  }
  const sig = focusStateSig(a);
  if (sig !== focusSig) {
    const panel = $id("focus");
    const editing = panel.classList.contains("open") && panel.contains(document.activeElement) &&
      document.activeElement && document.activeElement.tagName !== "BODY";
    if (!editing) renderFocus();
  }
  const now = nowText(a);
  setText("fNowV", now[0]);
  setText("fNowS", now[1]);
  const per = (budget && budget.usedPerAgent && budget.usedPerAgent[a.id]) || 0;
  setText("fTok", fmtTok(per));
  setText("fLevel", String(a.level || (Math.floor(Math.sqrt((a.xp || 0) / 25)) + 1)));
  setText("fDone", String(a.tasksDone || 0));
  const live = liveFor(a.id);
  const box = $id("fRunBox");
  if (box) {
    if (live) {
      box.classList.remove("hidden");
      const t = tasks.find((x) => x.id === live.taskId);
      setText("fRunHead", (live.taskIdentifier || "run") + (t ? " · " + t.title : ""));
      const st = live.lastStep;
      setText("fRunStep", st ? (String(st.kind || "step").toUpperCase() + ": " + String(st.text || "")) : "Waiting for the model…");
    } else {
      box.classList.add("hidden");
    }
  }
}

/* -------------------------------------------------------------------------
   VOKREW SEAM — focus panel, READ-ONLY shell (spec §4: "focus panel
   shell", data source rewritten in Stage 2). floor-oc's edit surface
   (beliefs editor, brain save, pause/approve, talk, ride, desk move)
   is cut: every one of those controls wrote to Floor-server endpoints
   the bridge does not have. Element ids fNowV/fNowS/fRunBox/fRunHead/
   fRunStep are kept so the verbatim renderFocusLive() keeps working.
   ------------------------------------------------------------------------- */
function renderFocus() {
  const panel = $id("focus");
  const a = agentById(selectedId);
  if (!a) { panel.classList.remove("open"); return; }
  focusSig = focusStateSig(a);
  const pal = paletteFor(a);
  const live = liveFor(a.id);
  const now = nowText(a);
  const isCloud = !!a.cloud;
  const mem = (a.memory || []).slice(-10).reverse();
  const memRows = mem.length ? mem.map((m) => {
    const text = typeof m === "string" ? m : (m.text || "");
    const when = typeof m === "string" ? "" : timeShort(m.at);
    return '<div class="memrow"><span class="when">' + esc(when) + '</span>' + esc(text) + '</div>';
  }).join("") : '<div class="muted">No memory yet.</div>';

  panel.innerHTML =
    '<div class="panelhead"><div class="avatar" style="background:' + pal.body + ';box-shadow:0 0 16px ' + pal.glow + '66">' +
    esc(initials(a.name)) + (isCloud ? '<span class="cloud">\u2601</span>' : "") + '</div>' +
    '<div><h2>' + esc(a.name) + '</h2><div class="role">' + esc(a.role) + '</div></div>' +
    '<button class="close" id="f-close">\u00d7</button></div>' +
    '<div class="pbody">' +
    '<div class="nowbox"><div class="k">NOW</div><div class="v" id="fNowV">' + esc(now[0]) + '</div>' +
    '<div class="s" id="fNowS">' + esc(now[1]) + '</div></div>' +
    '<div class="statgrid">' +
    '<div class="stat"><div class="k">Status</div><div class="v" style="font-size:12px">' + esc(a.status || "idle") + '</div></div>' +
    '<div class="stat"><div class="k">Desk</div><div class="v" style="font-size:11px">' + esc(deskLabel(a.deskId)) + '</div></div>' +
    '<div class="stat"><div class="k">Brain</div><div class="v" style="font-size:10.5px">' + esc(isCloud ? ("cloud \u00b7 " + ((a.adapterConfig && a.adapterConfig.route) || "spool")) : modelName(a)) + '</div></div>' +
    '<div class="stat"><div class="k">State</div><div class="v" style="font-size:12px">' + esc(a.lifecycleState || "ready") + '</div></div>' +
    '</div>' +
    '<div id="fRunBox" class="' + (live ? "" : "hidden") + '"><div class="nowbox" style="border-color:#2b6a4a;background:linear-gradient(180deg,#10251c,#0b1712)">' +
    '<div class="k">LIVE RUN</div><div class="v" id="fRunHead" style="font-size:11.5px">' +
    esc(live ? ((live.taskIdentifier || "run") + " \u00b7 " + ((tasks.find((x) => x.id === live.taskId) || {}).title || "")) : "") + '</div>' +
    '<div class="s" id="fRunStep">' + esc(live && live.lastStep ? String(live.lastStep.text || "") : "") + '</div></div></div>' +
    (a.instructions ? '<div class="sec"><h3>Instructions</h3><div class="pre">' + esc(a.instructions) + '</div></div>' : "") +
    '<div class="sec"><h3>Memory</h3><div>' + memRows + '</div></div>' +
    '</div>';

  $id("f-close").onclick = () => { closePanels(); renderAll(); };
}
function clockTick() {
  const d = new Date();
  setText("clock", d.toLocaleTimeString("en-GB", { hour12: false }));
  if (!document.hidden) renderQuestTracker();
}

/* -------------------------------------------------------------------------
   Wiring (slimmed: canvas + viewbar handlers live with the engine
   above; floor-oc's modal/action-bar wiring is cut with its panels)
   ------------------------------------------------------------------------- */
function initEvents() {
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const tag = (ev.target && ev.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || (ev.target && ev.target.isContentEditable)) return;
    closePanels();
    renderAll();
  });
}

/* -------------------------------------------------------------------------
   ADAPTER BOUNDARY — the only way state enters the room (spec §2).
   Stage 1: floor-fixture.js replays recorded Floor-shaped state through
   here. Stage 2: floor-adapter.js feeds the same shape from the real
   bridge. Everything downstream of this line (entities, pathing,
   drawing) cannot tell the difference — which is the point.
   Every field the engine reads is defaulted explicitly (spec §7.2).
   ------------------------------------------------------------------------- */
function applyState(state) {
  const s = state || {};
  agents = Array.isArray(s.agents) ? s.agents : [];
  tasks = Array.isArray(s.tasks) ? s.tasks : [];
  runs = Array.isArray(s.runs) ? s.runs : [];
  liveRuns = Array.isArray(s.liveRuns) ? s.liveRuns : [];
  meetings = [];
  budget = s.budget || null;
  if (typeof s.rigText === "string") rigText = s.rigText;
  connected = s.connected !== false;
  syncEntities();
  noteTransitions();
  renderAll();
}

function setActive(on) {
  floorActive = !!on;
  if (floorActive) resizeCanvas();
}

window.VokrewFloor = { applyState, setActive, auditRoutes, liveAudit };

/* Debug hooks for the Stage 1 evaluator (CDP) — a trimmed version of
   floor-oc's __floorDebug; no boss/POV/talk/studio surface exists here. */
window.__floorDebug = {
  auditRoutes,
  liveAudit,
  allDoorsteps,
  routeDestinations,
  walkableFor,
  cellOfPoint,
  sampleRoute,
  setView,
  selectAgent,
  applyState,
  ents,
  get agents() { return agents; },
  get tasks() { return tasks; },
  get runs() { return runs; },
  get liveRuns() { return liveRuns; },
  get budget() { return budget; },
  get simClock() { return simClock; },
  get connected() { return connected; },
  activity() {
    return agents.map((a) => {
      const e = ents[a.id] || {};
      return {
        agent: a.id, x: Math.round(e.x || 0), y: Math.round(e.y || 0),
        cell: e.cell || null, mode: e.mode || null, activity: e.activity || null,
        tween: !!e.tween, sitting: !!e.sitting
      };
    });
  },
  state() {
    return {
      connected, agents: agents.length, tasks: tasks.length, runs: runs.length,
      liveRuns: liveRuns.length, simClock,
      budget: budget ? { usedGlobal: budget.usedGlobal, globalCap: budget.globalCap } : null
    };
  }
};

function init() {
  buildStaticWorld();
  resizeCanvas();
  setView("overview");
  initEvents();
  clockTick();
  setInterval(clockTick, 1000);
  requestAnimationFrame(frame);
}

init();
