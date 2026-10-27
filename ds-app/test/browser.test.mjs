// End-to-end browser test against a real Vokrew bridge with real local model
// lanes. No mocks, no stubbed bridge.
//
//   node --test web/test/browser.test.mjs
//
// Requires: Chromium, llama-swap serving pc-lfm + pc-gemma at
// http://127.0.0.1:8080/v1 (the same lanes this machine's bridge uses).
// Screenshots land in web/test/evidence/.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchChromium, waitFor } from "./cdp.mjs";
import { startTestBridge } from "./test-bridge.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEB_PORT = Number(process.env.WEB_TEST_PORT || 7790);
const BRIDGE_PORT = Number(process.env.BRIDGE_TEST_PORT || 7791);
const EVIDENCE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "evidence");
const TASK = "Say hello in one short sentence about local models.";

function pillUsed(text) {
  const m = /CALLS TODAY\s+(\d+)\s*\/\s*/.exec(String(text || ""));
  return m ? Number(m[1]) : null;
}

async function waitHttp(url, timeout = 15000) {
  return waitFor(async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch { return false; }
  }, { timeout, label: url });
}

test("the floor is live, honest, and walks the reviewer to the executor's doorway", { timeout: 420000 }, async (t) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  // ── real lanes available? ───────────────────────────────────────────────
  const models = await fetch("http://127.0.0.1:8080/v1/models", { signal: AbortSignal.timeout(4000) })
    .then((r) => r.json()).catch(() => null);
  assert.ok(models && Array.isArray(models.data), "llama-swap must be reachable at 127.0.0.1:8080");
  const ids = models.data.map((m) => m.id);
  assert.ok(ids.some((id) => id.startsWith("lfm")), "pc-lfm model must exist: " + ids.join(", "));
  assert.ok(ids.some((id) => id.startsWith("gemma")), "pc-gemma model must exist: " + ids.join(", "));

  // ── servers ─────────────────────────────────────────────────────────────
  const web = spawn(process.execPath, ["web/dev-server.js"], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
    env: { ...process.env, PORT: String(WEB_PORT) },
    stdio: "ignore",
  });
  let bridge = await startTestBridge({ port: BRIDGE_PORT });
  let restartedBridge = null;
  let browser = null;

  try {
    await waitHttp(`http://localhost:${WEB_PORT}/`);
    assert.ok(bridge.getCode(), "test bridge must print a pairing code");

    browser = await launchChromium({ url: `http://localhost:${WEB_PORT}/`, port: 9335, width: 1440, height: 1000 });
    const cdp = browser.cdp;

    const evaluate = (js) => cdp.eval(js);
    const state = async () => JSON.parse(await evaluate("JSON.stringify(window.__vokrew.getState())"));
    const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
    const visible = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && !el.hidden && el.getClientRects().length > 0; })()`);
    const setValue = (sel, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const textOf = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent : null; })()`);
    const countOf = (sel) => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

    await waitFor(async () => await evaluate("!!window.__vokrew && !!window.__vokrew.floor"), { timeout: 20000, label: "app boot" });

    // Spy on the pairing modal: record a stack whenever it is opened, so a
    // stray "connect your bridge" prompt during a run is traceable.
    await evaluate(`(() => {
      window.__pairLog = [];
      const el = document.getElementById('pairModal');
      const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
      Object.defineProperty(el, 'hidden', {
        configurable: true,
        get() { return desc.get.call(this); },
        set(v) {
          if (!v) window.__pairLog.push(String((new Error('pairModal opened')).stack));
          desc.set.call(this, v);
        },
      });
      return true;
    })()`);
    const assertPairClosed = async (stage) => {
      const open = await evaluate("!document.getElementById('pairModal').hidden");
      if (open) {
        const log = await evaluate("JSON.stringify(window.__pairLog, null, 1)");
        throw new Error(`pairing modal unexpectedly open at ${stage}: ${log}`);
      }
    };

    // ── stage 1: unpaired → locked, empty, OFFLINE ─────────────────────────
    const locked = await state();
    assert.equal(locked.online, false);
    assert.equal(locked.paired, false);
    assert.equal(locked.floor.seated, 0);
    assert.equal(Object.values(locked.floor.chars).every((c) => c === null), true, "no placeholder crew");
    assert.equal(await evaluate("document.getElementById('roomLocked').hidden"), false, "locked overlay visible");
    assert.equal((await textOf("#bridgeStatusText")).trim(), "OFFLINE");
    await browser.screenshot(path.join(EVIDENCE, "01-locked-offline.png"));

    // ── stage 2: pair through the UI → lands on the Floor ──────────────────
    await click("#connectBtn");
    await waitFor(async () => await visible("#pairModal"), { timeout: 5000, label: "pair modal" });
    await setValue("#pairUrl", `http://127.0.0.1:${BRIDGE_PORT}`);
    await setValue("#pairCode", bridge.getCode());
    await click("#pairBtn");
    await waitFor(async () => (await state()).online, { timeout: 30000, label: "paired online" });

    const paired = await state();
    assert.equal(paired.paired, true);
    assert.equal(paired.crewName, "default");
    assert.equal(await evaluate("document.querySelector('.tab.active').dataset.tab"), "floor", "lands on the Floor");
    assert.equal(paired.floor.seated, 3);
    assert.equal(paired.floor.chars.planner.name, "Nova");
    assert.equal(paired.floor.chars.executor.name, "Rivet");
    assert.equal(paired.floor.chars.reviewer.name, "Glass");
    assert.deepEqual(paired.floor.chars.planner.cell, { x: 4, y: 4 });
    assert.deepEqual(paired.floor.chars.executor.cell, { x: 11, y: 4 });
    assert.deepEqual(paired.floor.chars.reviewer.cell, { x: 18, y: 4 });
    await browser.screenshot(path.join(EVIDENCE, "02-paired-crew-seated.png"));
    await assertPairClosed("stage 2 (paired)");

    const pillBefore = pillUsed(await textOf("#budgetPill"));
    assert.equal(pillBefore, 0, "fresh test ledger starts at zero");

    // ── stage 3: conduct one instruction → run the live chain ──────────────
    await setValue("#conductInput", TASK);
    await click("#conductBtn");
    await waitFor(async () => (await state()).running, { timeout: 8000, label: "run started" });

    let sawPlannerWork = false;
    let sawExecutorWork = false;
    let reviewerAtDoorway = null;
    const started = Date.now();

    while (Date.now() - started < 300000) {
      const s = await state();
      const f = s.floor;
      if (f.chars.planner && f.chars.planner.phase === "working") sawPlannerWork = true;
      if (f.chars.executor && f.chars.executor.phase === "working") sawExecutorWork = true;
      if (!reviewerAtDoorway && f.phase === "reviewer" && f.chars.reviewer.phase === "reviewing") {
        reviewerAtDoorway = {
          cell: f.chars.reviewer.cell,
          doorstep: f.doorsteps.executor,
          walk: f.chars.reviewer.walk,
          budget: s.budget ? s.budget.lanes.map((l) => ({ id: l.id, used: l.used })) : null,
        };
        await browser.screenshot(path.join(EVIDENCE, "03-reviewer-at-executor-doorway.png"));
      }
      if (!s.running) break;
      await sleep(90);
    }
    assert.ok(sawPlannerWork, "planner visibly worked at its desk");
    assert.ok(sawExecutorWork, "executor visibly worked during its phase");

    // reviewer walked to the executor's doorway, via row 5 (glass detour)
    assert.ok(reviewerAtDoorway, "reviewer phase was observed with the reviewer at the doorway");
    assert.deepEqual(reviewerAtDoorway.cell, reviewerAtDoorway.doorstep, "reviewer grid cell equals executor doorstep");
    assert.deepEqual(reviewerAtDoorway.doorstep, { x: 12, y: 4 });
    assert.ok(reviewerAtDoorway.walk.some((p) => p.y === 5), "reviewer walked the row-5 detour around the glass");

    await waitFor(async () => !(await state()).running, { timeout: 30000, label: "run settle" });
    await waitFor(async () => (await state()).floor.phase === "idle", { timeout: 15000, label: "crew back at desks" });

    const done = await state();
    const rec = done.journal[0];
    assert.equal(rec.state, "done");
    assert.equal(rec.crew, "default");
    assert.match(rec.verdict, /^(APPROVED|CHANGES)$/);
    assert.equal(rec.stamps.length, 3);
    assert.equal(rec.crossFamily, false, "gemma executor + gemma reviewer is same-family");
    assert.equal(rec.stamps.find((s) => s.role === "reviewer").family, "gemma");

    // room re-seated with reported lanes/models
    assert.equal(done.floor.chars.planner.lane, "pc-lfm");
    assert.equal(done.floor.chars.executor.lane, "pc-gemma");
    assert.equal(done.floor.chars.reviewer.lane, "pc-gemma");
    assert.ok(done.floor.chars.executor.model);

    // completion message says same family, never cross-family
    const completion = await textOf("#liveText");
    assert.match(completion, /same family/);
    assert.doesNotMatch(completion, /cross-family/);

    // ── stage 4: budget pill increases by exactly the served stages ────────
    const expectedPill = pillBefore + rec.stamps.length;
    await waitFor(async () => pillUsed(await textOf("#budgetPill")) === expectedPill, {
      timeout: 15000, label: `budget pill = ${expectedPill}`,
    });
    const pillAfter = pillUsed(await textOf("#budgetPill"));
    assert.equal(pillAfter, pillBefore + 3, "one call per served stage, failover never charged");
    const ledger = await state();
    assert.equal(ledger.budget.lanes.find((l) => l.id === "dead-lane").used, 0, "failed attempts are never charged");
    await assertPairClosed("stage 4 (after run settle)");

    // ── stage 5: conduct transcript, stamped parts ─────────────────────────
    assert.equal(await countOf("#conductParts .conduct-part"), 3);
    const partStamps = await evaluate("[...document.querySelectorAll('#conductParts .cp-stamp')].map((e) => e.textContent)");
    for (const stamp of partStamps) {
      assert.match(stamp, /pc-lfm|pc-gemma/);
      assert.match(stamp, /\d+(\.\d+)?(ms|s)/, "each part carries reported latency");
    }
    assert.match(await textOf("#conductMeta"), /APPROVED|CHANGES/);
    await assertPairClosed("stage 5 (conduct transcript)");

    // ── stage 6: run card from the quest log ──────────────────────────────
    await click(".quest-row");
    await waitFor(async () => await visible("#runModal"), { timeout: 5000, label: "run card" });
    const cardText = await textOf("#runCardBody");
    assert.match(cardText, /Say hello/);
    assert.match(cardText, /same family/);
    assert.doesNotMatch(cardText, /cross-family/);
    for (const role of ["planner", "executor", "reviewer"]) {
      assert.equal(await countOf(`#runCardBody .rc-part[data-role="${role}"]`), 1, role + " part exists");
    }
    const cardStamps = await evaluate("[...document.querySelectorAll('#runCardBody .rc-stamp')].map((e) => e.textContent)");
    assert.equal(cardStamps.length, 3);
    for (const line of cardStamps) {
      assert.match(line, /pc-lfm|pc-gemma/);
      assert.match(line, /gemma|lfm/);
      assert.match(line, /\d+(\.\d+)?(ms|s)/);
    }
    const failLine = await evaluate("(document.querySelector('#runCardBody .rc-stamp .fail')||{}).textContent || ''");
    assert.match(failLine, /dead-lane failed → served on pc-lfm/);
    // Model markdown is formatted, not printed raw. The renderer is DOM-safe:
    // a model cannot inject an element through a part string.
    const md = await evaluate(`(() => {
      const el = window.__vokrew.renderMarkdown("**Plan:**\\n\\n1. one\\n2. two");
      const safe = window.__vokrew.renderMarkdown("<img src=x onerror=1> **ok**");
      return {
        strong: el.querySelectorAll("strong").length,
        items: el.querySelectorAll("ol li").length,
        escaped: safe.querySelector("img") === null && safe.querySelector("strong") !== null,
      };
    })()`);
    assert.equal(md.strong, 1, "bold markdown renders as <strong>");
    assert.equal(md.items, 2, "ordered markdown renders as a list");
    assert.equal(md.escaped, true, "model HTML is escaped, not injected");
    await browser.screenshot(path.join(EVIDENCE, "04-run-card.png"));
    await click("#runClose");
    await assertPairClosed("stage 6 (run card)");

    // ── stage 7: failover bubble on the character that failed over ────────
    await waitFor(async () => {
      const s = await state();
      return s.floor.bubbles.some((b) => b.kind === "failover" && /served on pc-lfm/.test(b.text));
    }, { timeout: 12000, label: "failover bubble" });
    const bubble = (await state()).floor.bubbles.find((b) => b.kind === "failover");
    assert.equal(bubble.role, "planner");
    assert.match(bubble.text, /dead-lane failed → served on pc-lfm/);
    await assertPairClosed("stage 7 (failover bubble)");

    // ── stage 8: clicking a character opens the focus panel ───────────────
    await evaluate("document.getElementById('view-floor').scrollIntoView({ block: 'start' })");
    await sleep(200);
    const box = await evaluate("(() => { const r = document.getElementById('floorCanvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
    const cell = done.floor.chars.executor.cell;
    const px = box.x + ((cell.x + 0.5) / 36) * box.w;
    const py = box.y + ((cell.y + 0.5) / 22) * box.h;
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: px, y: py, button: "left", buttons: 1, clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px, y: py, button: "left", buttons: 0, clickCount: 1 });
    await sleep(300);
    await waitFor(async () => await visible("#focusPanel"), { timeout: 5000, label: "focus panel" });
    assert.equal((await textOf("#focusName")).trim(), "Rivet");
    assert.equal((await textOf("#focusRole")).trim(), "executor");
    assert.equal((await textOf("#focusLane")).trim(), "pc-gemma");
    assert.match(await textOf("#focusCalls"), /pc-gemma/);
    await browser.screenshot(path.join(EVIDENCE, "05-focus-panel.png"));
    await click("#focusClose");

    // ── stage 9: crew switch re-seats the room ────────────────────────────
    await setValue("#crewSelect", "relief");
    await waitFor(async () => (await state()).crewName === "relief", { timeout: 5000, label: "crew switch" });
    await sleep(300);
    const relief = await state();
    assert.equal(relief.crewName, "relief");
    assert.equal(relief.floor.chars.planner.name, "Moss");
    assert.equal(relief.floor.chars.executor.name, "Anvil");
    assert.equal(relief.floor.chars.reviewer.name, "Quill");
    for (const role of ["planner", "executor", "reviewer"]) {
      const c = relief.floor.chars[role];
      assert.deepEqual(c.cell, c.seat, `${role} is seated after the crew switch`);
    }
    // the last crew's conduct transcript must not linger under new nameplates
    assert.equal(await evaluate("document.getElementById('conductPanel').hidden"), true, "transcript cleared on crew switch");
    await browser.screenshot(path.join(EVIDENCE, "06-crew-relief.png"));

    // ── stage 10: reload mid-run → reattach by runId, land the verdict ────
    await setValue("#runTask", "This run will be interrupted by a page reload.");
    await click("#runBtn");
    await waitFor(async () => (await state()).running, { timeout: 8000, label: "second run started" });
    const tracked = await waitFor(async () => {
      const s = await state();
      return s.journal.find((r) => r.state === "running" && r.runId) || false;
    }, { timeout: 5000, label: "bridge runId saved at submit" });
    const reloadedRunId = tracked.runId;
    assert.match(reloadedRunId, /^[0-9a-f-]{20,}$/i, "the 202 runId is on the journal entry before settle");

    await sleep(1200);
    await cdp.send("Page.reload", { ignoreCache: true });
    try {
      await waitFor(async () => !!(await state()) && (await state()).online, { timeout: 30000, label: "reloaded online" });
    } catch (err) {
      const diag = await evaluate("JSON.stringify({href:location.href, ready:document.readyState, vok:typeof window.__vokrew, text:document.body?document.body.innerText.slice(0,300):null})").catch((e) => "eval failed: " + e.message);
      console.log("RELOAD DIAG:", diag, browser.errors());
      throw err;
    }

    // cache invalidation: the journal survives the reload with the same runId
    // and the page resumes following it instead of declaring it lost.
    let adopted = null;
    let resumedWhileRunning = false;
    const stagesSeen = new Set();
    const settleBy = Date.now() + 180000;
    while (Date.now() < settleBy) {
      const s = await state();
      const row = s.journal.find((r) => r.runId === reloadedRunId);
      if (row && row.state === "running") {
        resumedWhileRunning = resumedWhileRunning || s.running === true;
        if (row.stage) stagesSeen.add(row.stage);
      } else if (row) {
        adopted = row;
        break;
      }
      await sleep(120);
    }
    if (!adopted) {
      const s = await state().catch(() => null);
      console.log("REATTACH DIAG:", JSON.stringify({
        online: s && s.online,
        running: s && s.running,
        journal: s && s.journal && s.journal.map((r) => ({
          id: r.id, runId: r.runId, state: r.state, reattached: r.reattached, lostReason: r.lostReason,
        })),
      }), browser.errors());
    }
    assert.ok(adopted, "the reloaded run settled");
    assert.equal(adopted.runId, reloadedRunId, "same bridge runId after reload");
    assert.equal(adopted.state, "done", "a healthy bridge never marks the reloaded run lost");
    assert.equal(adopted.reattached, true, "the record was adopted from GET /runs/:id");
    assert.match(adopted.verdict, /^(APPROVED|CHANGES)$/);
    assert.equal(adopted.stamps.length, 3);
    assert.ok(resumedWhileRunning, "phase tracking resumed on the reloaded page");
    if (stagesSeen.size) {
      assert.ok([...stagesSeen].every((st) => ["planner", "executor", "reviewer", "settling"].includes(st)));
    }
    const reloadedState = await state();
    assert.equal(reloadedState.journal.some((r) => r.state === "lost"), false, "nothing is marked lost on reload");

    // quest-log verdict, run-card verdict, and run-card stamps all equal the
    // bridge's own GET /runs/:id record.
    const token = await evaluate("localStorage.getItem('vokrew.token')");
    const wire = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/runs/${encodeURIComponent(reloadedRunId)}`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    assert.equal(wire.ok, true);
    const wireRec = wire.run;
    assert.equal(adopted.verdict, wireRec.verdict);
    assert.deepEqual(adopted.stamps, wireRec.stamps);
    assert.equal((await textOf(".quest-row .chip")).trim(), wireRec.verdict, "quest log shows the wire verdict");

    await click(".quest-row");
    await waitFor(async () => await visible("#runModal"), { timeout: 5000, label: "reattached run card" });
    const reattachedCard = await textOf("#runCardBody");
    assert.match(reattachedCard, new RegExp(wireRec.verdict));
    const reattachedStamps = await evaluate("[...document.querySelectorAll('#runCardBody .rc-stamp')].map((e) => e.textContent)");
    assert.equal(reattachedStamps.length, 3);
    wireRec.stamps.forEach((stamp, i) => {
      const line = reattachedStamps[i];
      assert.ok(line.includes(stamp.lane), `${stamp.role} stamp lane equals the wire record`);
      assert.ok(line.includes(stamp.family), `${stamp.role} stamp family equals the wire record`);
      assert.match(line, /\d+(\.\d+)?(ms|s)/, `${stamp.role} stamp carries reported latency`);
    });
    await browser.screenshot(path.join(EVIDENCE, "07-reattached-after-reload.png"));
    await click("#runClose");
    await waitFor(async () => {
      const s = await state();
      return !s.running && s.floor.phase === "idle";
    }, { timeout: 30000, label: "reattached crew back at their desks" });

    // ── stage 11: the bridge restarts mid-run → honest lost card ──────────
    await setValue("#runTask", "This run will lose its bridge mid-flight.");
    await click("#runBtn");
    await waitFor(async () => (await state()).running, { timeout: 8000, label: "restart run started" });
    await sleep(1400);
    await bridge.close();
    // same home → same token and config: the page stays paired to the new
    // process, while the in-flight /run has already died.
    restartedBridge = await startTestBridge({ port: BRIDGE_PORT, home: bridge.home, reuse: true });
    await waitFor(async () => (await state()).journal[0].state === "lost", { timeout: 25000, label: "restart run settled lost" });
    const afterRestart = (await state()).journal[0];
    assert.match(afterRestart.lostReason, /run lost — bridge restarted/, "mid-run restart is named honestly");
    await click(".quest-row");
    await waitFor(async () => await visible("#runModal"), { timeout: 5000, label: "restart lost card" });
    assert.match(await textOf("#runCardBody"), /run lost — bridge restarted/);
    await browser.screenshot(path.join(EVIDENCE, "10-bridge-restart-lost.png"));
    await click("#runClose");

    // ── stage 12: zero console errors / uncaught exceptions ───────────────
    const errors = browser.errors().filter((e) => !/favicon/i.test(e));
    assert.deepEqual(errors, [], "no console errors or uncaught exceptions");
  } finally {
    try { if (browser) await browser.close(); } catch { /* closed */ }
    try { if (restartedBridge) await restartedBridge.close(); } catch { /* closed */ }
    try { await bridge.close(); } catch { /* closed */ }
    try { web.kill("SIGTERM"); } catch { /* gone */ }
    try { fs.rmSync(bridge.home, { recursive: true, force: true }); } catch { /* gone */ }
  }
});
