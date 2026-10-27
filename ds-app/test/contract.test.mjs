// Integration tests against a real spawned `vokrew serve` bridge — the same
// createBridge/runChain code the app talks to in production, real HTTP, real
// envelopes ({ok:true, run} / 404 {ok:false, error}). Only the model lane is a
// stub, so these run without llama-swap and stay deterministic.
//
//   node --test web/test/contract.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildLanes, loadLedger } from "../../src/core.js";
import { createBridge } from "../../src/serve.js";
import { BridgeClient } from "../adapter.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stubChat(delayMs) {
  return (prompt, ctx = {}) => new Promise((resolve) => {
    setTimeout(() => {
      const task = (ctx.task || prompt || "").slice(0, 80);
      let text;
      if (ctx.role === "planner") text = `Plan: stub plan for "${task}".`;
      else if (ctx.role === "reviewer") text = `APPROVED: stub review for "${task}".`;
      else text = `Work: stub work for "${task}".`;
      resolve({ text, model: "stub-1", latencyMs: delayMs });
    }, delayMs);
  });
}

async function spawnBridge(t, { stageDelayMs = 300 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vokrew-web-contract-"));
  const stub = { id: "stub", provider: "mock", family: "stubfam", tier: "local", model: "stub-1", cap: null };
  const config = { lanes: [stub], roles: { planner: ["stub"], executor: ["stub"], reviewer: ["stub"] } };
  const lanes = buildLanes(config, { stub: stubChat(stageDelayMs) });
  const ledger = loadLedger(home);
  const bridge = createBridge({ home, config, lanes, ledger, version: "web-contract" });
  await new Promise((resolve, reject) => {
    bridge.server.once("error", reject);
    bridge.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => Promise.all([
    new Promise((r) => bridge.server.close(r)),
    Promise.resolve(fs.rmSync(home, { recursive: true, force: true })),
  ]));
  return { bridge, base: `http://127.0.0.1:${bridge.server.address().port}` };
}

async function pairedClient(t, opts) {
  const { bridge, base } = await spawnBridge(t, opts);
  const client = new BridgeClient({ baseUrl: base });
  await client.pair(bridge.newPairingCode());
  return { client, base };
}

/* (e) submit → follow → settle, and every card-visible value equals the record */

test("live contract: submit, follow the 202 runId to settle, and match GET /runs/:id", async (t) => {
  const { client } = await pairedClient(t, { stageDelayMs: 220 });

  const phases = [];
  let idAtSubmit = null;
  const rec = await client.startRun({
    task: "contract demo",
    pollMs: 120,
    onRunId: (id) => { idAtSubmit = id; },
    onPhase: (p) => phases.push(p),
  });

  assert.ok(idAtSubmit, "the bridge runId is handed to the page at submit");
  assert.equal(rec.state, "done");
  assert.equal(rec.runId, idAtSubmit, "the settled record keeps the bridge runId");

  // The page renders from the follow result; it must equal the wire record.
  const wire = await client.getRun(rec.runId);
  assert.equal(wire.state, "done");
  assert.equal(rec.verdict, wire.verdict);
  assert.equal(rec.crossFamily, wire.crossFamily);
  assert.deepEqual(rec.stamps, wire.stamps);
  assert.deepEqual(rec.stampLines, wire.stampLines);
  assert.equal(rec.stamps.length, 3);

  // Phases came from the record, not from guessing at the served counter.
  const tracked = phases.filter((p) => p.source === "run-record");
  assert.ok(tracked.length > 0, "the follow loop reports phases from the run record");
  assert.equal(tracked[tracked.length - 1].stage, "settling");
});

/* second run mid-flight, page reload, reattach by runId only */

test("reload contract: a fresh page adopts the same runId and lands its verdict", async (t) => {
  const { client } = await pairedClient(t, { stageDelayMs: 400 });

  // Submit exactly as the page does, but keep only what a reload preserves:
  // the journal entry's page-local id and the bridge runId from the 202.
  const res = await client.raw("/run", {
    method: "POST",
    body: { task: "reload demo", surface: "coding" },
    timeoutMs: 10000,
  });
  assert.equal(res.status, 202);
  assert.equal(res.json.ok, true);
  const runId = res.json.runId;
  assert.ok(runId);

  // The envelope really nests the record under .run; mid-run it is running.
  const mid = await client.getRun(runId);
  assert.equal(mid.state, "running");
  assert.ok(["planner", "executor", "reviewer"].includes(mid.phase));

  // On load the page asks the registry about that id (never compares
  // page-local ids) and follows it to settle.
  const phases = [];
  const { result, timeline } = await client.followRun(runId, {
    onPhase: (p) => phases.push(p),
  });
  assert.equal(result.state, "done");
  assert.ok(timeline.length > 1);
  assert.ok(phases.some((p) => p.stage === "settling"));

  const wire = await client.getRun(runId);
  assert.equal(result.verdict, wire.verdict);
  assert.deepEqual(result.stamps, wire.stamps);

  // Reattaching to an already-settled run adopts it immediately.
  const again = await client.followRun(runId);
  assert.equal(again.result.state, "done");
  assert.equal(again.result.verdict, wire.verdict);
});

test("lost contract: only a 404 from the registry means the run is gone", async (t) => {
  const { client } = await pairedClient(t, { stageDelayMs: 50 });
  await assert.rejects(
    () => client.getRun("does-not-exist"),
    (err) => err.status === 404 && /no such run|not found/i.test(err.message),
  );
  await assert.rejects(
    () => client.followRun("does-not-exist"),
    (err) => err.status === 404,
  );
});

test("the registry lists the run it was asked about", async (t) => {
  const { client } = await pairedClient(t, { stageDelayMs: 150 });
  const rec = await client.startRun({ task: "listed run", pollMs: 100 });
  const list = await client.listRuns(10);
  assert.ok(list.some((r) => r.id === rec.runId && r.state === "done"),
    "GET /runs returns the same id the run card was built from");
  await sleep(1);
});
