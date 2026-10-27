// Pure adapter + room-geometry tests. Run with:
//   node --test web/test/*.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  budgetPill,
  sumBudget,
  reviewSentence,
  reviewLabel,
  stageForServed,
  PhaseTracker,
  stampText,
  stampLine,
  modelLabel,
  rosterFor,
  stampsByRole,
  failovers,
  buildRecord,
  upsertRecord,
  settleStaleRuns,
  verdictTone,
  normaliseBaseUrl,
} from "../adapter.js";

import { GRID, SEATS, DOORSTEPS, findPath, isPassable, buildGrid } from "../floor.js";

/* ── budget ─────────────────────────────────────────────────────────────── */

test("budgetPill sums capped lanes only when caps exist", () => {
  const pill = budgetPill({
    surface: "coding",
    lanes: [
      { id: "a", used: 3, cap: 5 },
      { id: "b", used: 2, cap: null },
      { id: "c", used: 4, cap: 10 },
    ],
  });
  assert.equal(pill.used, 7);
  assert.equal(pill.cap, 15);
  assert.equal(pill.cappedLanesOnly, true);
  assert.equal(pill.label, "⚡ CALLS TODAY 7 / 15");
});

test("budgetPill falls back to every lane when the bridge reports no caps", () => {
  const budget = {
    surface: "coding",
    lanes: [
      { id: "pc-lfm", used: 2, cap: null },
      { id: "pc-gemma", used: 1, cap: null },
    ],
  };
  assert.equal(sumBudget(budget).used, 3);
  const pill = budgetPill(budget);
  assert.equal(pill.used, 3);
  assert.equal(pill.cap, null);
  assert.equal(pill.cappedLanesOnly, false);
  assert.equal(pill.label, "⚡ CALLS TODAY 3 / —");
});

test("budgetPill never invents a cap", () => {
  const pill = budgetPill({ lanes: [{ id: "x", used: 0, cap: 0 }] });
  assert.equal(pill.cap, null);
  assert.equal(pill.cappedLanesOnly, false);
});

/* ── honesty labels ─────────────────────────────────────────────────────── */

test("same-family review is labelled as such", () => {
  const rec = {
    verdict: "APPROVED",
    crossFamily: false,
    stamps: [
      { role: "executor", family: "gemma" },
      { role: "reviewer", family: "gemma" },
    ],
  };
  assert.equal(reviewLabel(false), "same family");
  assert.match(reviewSentence(rec), /same family/);
  assert.match(reviewSentence(rec), /gemma → gemma/);
  assert.doesNotMatch(reviewSentence(rec), /cross-family/);
});

test("cross-family review is labelled as such", () => {
  const rec = {
    verdict: "CHANGES",
    crossFamily: true,
    stamps: [
      { role: "executor", family: "granite" },
      { role: "reviewer", family: "gemma" },
    ],
  };
  assert.equal(reviewLabel(true), "cross-family review");
  assert.match(reviewSentence(rec), /cross-family review/);
  assert.match(reviewSentence(rec), /granite → gemma/);
});

test("missing stamps are never turned into a review claim", () => {
  assert.match(reviewSentence({ verdict: "APPROVED", stamps: [] }), /stamps unavailable/);
});

/* ── stamps ─────────────────────────────────────────────────────────────── */

test("stamp lines carry lane, model, family and latency", () => {
  const stamp = {
    role: "executor",
    agent: "Patch",
    lane: "pc-granite",
    model: "/home/ksheep/models/granite-4.1-8b.gguf",
    family: "granite",
    tier: "local",
    latencyMs: 48873,
  };
  assert.equal(modelLabel(stamp.model), "granite-4.1-8b.gguf");
  assert.equal(stampLine(stamp), "pc-granite · granite-4.1-8b.gguf · granite · 49s");
  assert.match(stampText(stamp), /planner|executor/);
  assert.match(stampText(stamp), /pc-granite/);
  assert.match(stampText(stamp), /local/);
});

test("failover lists the failed lanes and the lane that served", () => {
  const out = failovers([
    {
      role: "planner",
      lane: "pc-lfm",
      attempts: [
        { lane: "dead-lane", status: "failed", error: "ECONNREFUSED" },
        { lane: "pc-lfm", status: "served" },
      ],
    },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].failedLanes, ["dead-lane"]);
  assert.equal(out[0].servedLane, "pc-lfm");
  assert.match(out[0].text, /dead-lane failed → served on pc-lfm/);
});

test("a clean run produces no failover bubble", () => {
  assert.equal(failovers([{ role: "planner", lane: "a", attempts: [{ lane: "a", status: "served" }] }]).length, 0);
});

/* ── phases from the bridge's served-call counter ───────────────────────── */

test("stageForServed maps served stages to the working phase", () => {
  assert.equal(stageForServed(0), "planner");
  assert.equal(stageForServed(1), "executor");
  assert.equal(stageForServed(2), "reviewer");
  assert.equal(stageForServed(3), "settling");
});

test("PhaseTracker only advances on reported served calls", () => {
  const t = new PhaseTracker(10, "2026-10-27T00:00:00Z");
  assert.equal(t.current().stage, "planner");
  t.observe(10);
  assert.equal(t.served, 0);
  t.observe(11);
  assert.equal(t.stage, "executor");
  assert.equal(t.served, 1);
  const jump = t.observe(13);
  assert.equal(jump.served, 3);
  assert.equal(jump.stage, "settling");
  assert.equal(t.timeline.length, 3);
});

/* ── roster is built only from bridge data ──────────────────────────────── */

test("rosterFor shows reported names and stamps, never placeholders", () => {
  const crew = { name: "example", roles: { planner: { name: "Scout" }, executor: { name: "Patch" }, reviewer: { name: "Judge" } } };
  const stamps = {
    planner: { role: "planner", agent: "Scout", lane: "pc-granite", model: "granite4.1:8b-cpu", family: "granite" },
    executor: { role: "executor", agent: "Patch", lane: "pc-lfm", model: "lfm2.5:latest", family: "lfm" },
  };
  const roster = rosterFor(crew, stamps);
  assert.equal(roster.length, 3);
  assert.equal(roster[0].name, "Scout");
  assert.equal(roster[0].lane, "pc-granite");
  assert.equal(roster[0].palette, "sunset");
  assert.equal(roster[1].palette, "ocean");
  assert.equal(roster[2].palette, "violet");
  assert.equal(roster[2].lane, null); // reviewer had not served yet
  assert.equal(roster[2].name, "Judge");
});

test("a default crew with no names stays unnamed", () => {
  const roster = rosterFor({ name: "default", roles: {} }, {});
  assert.equal(roster.every((r) => r.name === null), true);
});

test("stampsByRole keeps one stamp per role", () => {
  const out = stampsByRole([
    { role: "planner", lane: "a" },
    { role: "nope", lane: "b" },
    { role: "reviewer", lane: "c" },
  ]);
  assert.deepEqual(Object.keys(out).sort(), ["planner", "reviewer"]);
});

/* ── records + journal ──────────────────────────────────────────────────── */

test("buildRecord keeps only reported stages", () => {
  const rec = buildRecord({
    id: "r1",
    task: "t",
    surface: "coding",
    crew: "example",
    startedAt: "2026-10-27T00:00:00Z",
    endedAt: "2026-10-27T00:01:00Z",
    result: {
      verdict: "APPROVED",
      crossFamily: true,
      plan: "p",
      work: "w",
      review: "r",
      stamps: [
        { role: "planner", agent: "Scout", lane: "a", model: "m", family: "f", tier: "local", latencyMs: 5, attempts: [] },
        { role: "executor", agent: "Patch", lane: "b", model: "m2", family: "g", tier: "local", latencyMs: 6, attempts: [] },
        { role: "reviewer", agent: "Judge", lane: "c", model: "m3", family: "h", tier: "local", latencyMs: 7, attempts: [] },
      ],
    },
  });
  assert.equal(rec.verdict, "APPROVED");
  assert.equal(rec.crossFamily, true);
  assert.equal(rec.stamps.length, 3);
  assert.equal(rec.stampLines.length, 3);
  assert.equal(rec.stamps[0].agent, "Scout");
});

test("upsertRecord replaces in place and caps the journal", () => {
  let j = [];
  for (let i = 0; i < 5; i++) j = upsertRecord(j, { id: "r" + i }, 3);
  assert.equal(j.length, 3);
  assert.equal(j[0].id, "r4");
  j = upsertRecord(j, { id: "r4", verdict: "APPROVED" }, 3);
  assert.equal(j.length, 3);
  assert.equal(j[0].verdict, "APPROVED");
  assert.equal(j.filter((x) => x.id === "r4").length, 1);
});

test("settleStaleRuns marks only running records lost", () => {
  const out = settleStaleRuns([
    { id: "a", state: "running" },
    { id: "b", state: "done", verdict: "APPROVED" },
  ], "run lost — page reloaded mid-run");
  assert.equal(out[0].state, "lost");
  assert.equal(out[0].lostReason, "run lost — page reloaded mid-run");
  assert.equal(out[1].state, "done");
  assert.equal(out[1].verdict, "APPROVED");
});

test("verdict tone and URL normalisation", () => {
  assert.equal(verdictTone("APPROVED"), "good");
  assert.equal(verdictTone("CHANGES"), "warn");
  assert.equal(verdictTone("LOST"), "bad");
  assert.equal(verdictTone("WEIRD"), "muted");
  assert.equal(normaliseBaseUrl("127.0.0.1:7717/"), "http://127.0.0.1:7717");
  assert.equal(normaliseBaseUrl("http://localhost:7717//"), "http://localhost:7717");
});

/* ── room geometry / A* ─────────────────────────────────────────────────── */

test("the room grid carves the expected zones and doors", () => {
  const grid = buildGrid();
  assert.equal(isPassable(grid, 4, 4), true);       // planner seat
  assert.equal(isPassable(grid, 22, 8), true);      // hall
  assert.equal(isPassable(grid, 30, 4), true);      // skyloft
  assert.equal(isPassable(grid, 30, 14), true);     // workshop
  assert.equal(isPassable(grid, 10, 18), true);     // yard
  assert.equal(isPassable(grid, 4, 3), false);      // desk
  assert.equal(isPassable(grid, 15, 4), false);     // glass partition
  assert.equal(isPassable(grid, 0, 0), false);      // outer wall
});

test("reviewer path detours around the glass via row 5 and ends at the executor doorstep", () => {
  const path = findPath(GRID, SEATS.reviewer, DOORSTEPS.executor);
  assert.ok(path.length > 0, "a path must exist");
  assert.deepEqual(path[path.length - 1], DOORSTEPS.executor);
  assert.ok(path.some((p) => p.y === 5), "the walk must use row 5");
  assert.ok(!path.some((p) => p.y === 4 && p.x >= 13 && p.x <= 17), "the walk must not cross the glass");
  for (const cell of path) assert.equal(isPassable(GRID, cell.x, cell.y), true);
});

test("every seat can reach every doorway through the plan", () => {
  for (const role of Object.keys(SEATS)) {
    for (const dest of Object.values(DOORSTEPS)) {
      const path = findPath(GRID, SEATS[role], dest);
      assert.ok(path.length > 0, `${role} → ${dest.x},${dest.y}`);
    }
  }
});

test("unreachable destinations return no path instead of a straight line", () => {
  assert.deepEqual(findPath(GRID, SEATS.planner, { x: 0, y: 0 }), []);
});
