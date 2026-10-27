#!/usr/bin/env node
/*
 * Stage 2 evaluator — PHASE1-FLOOR-SPEC.md §6, Stage 2 gate.
 *
 * Drives the real /app page in real Chromium over CDP against the REAL
 * bridge (app repo, phase1-stage0-run-registry build) and the proven
 * local rig: llama.cpp llama-server serving Gemma 3 1B Q4_K_M as the
 * openai-compatible lane "local-gemma" — every role served by that one
 * local model family, NO mock lanes anywhere. Asserts, from live
 * bridge records + page entity state:
 *   (a) planner entity in work mode at its desk during phase planner
 *   (b) executor working during phase executor
 *   (c) during phase reviewer, the reviewer entity's cell leaves its
 *       own cubicle AND arrives at the executor's doorstep cell
 *       (positions from __floorDebug entity state, never pixels)
 *   (d) quest-log verdict (row label + run card) == GET /runs/:id verdict
 *   (e) focus-panel stamps match the record's stamps (lane+model+family)
 *   (f) budget pill count increases by exactly the record's stamp count
 *   (g) crossFamily is false on this single-family rig (flagged, not
 *       forced, if not) AND the "same family" label is visible
 *   (h) zero console errors for the whole session
 *   (i) Chat / Run / Budget / Crew tabs regression-pass (Run tab via
 *       the ?wait=1 compat path returns a stamped result)
 *   (j) no FIXTURE chip, and floor-fixture.js is neither on disk nor
 *       loaded by the page
 * Plus the spec §7.6 behavior: after a bridge restart, the open run
 * card renders "run lost — bridge restarted" (registry is in-memory).
 *
 * SERVING / CORS MECHANISM (spec Stage 2 build item 5): this VM's
 * Chromium blocks CDP navigations to http://127.0.0.1 (LNA), so the
 * page loads over file:// exactly as in Stage 1. A file:// page sends
 * Origin "null", which the real bridge's origin gate (vokrew.com +
 * localhost only — deliberately NOT weakened) refuses with 403. The
 * harness therefore enables CDP Fetch interception for the bridge
 * origin only: preflights are answered synthetically, and each real
 * request is executed by Node's fetch against the untouched bridge
 * (real HTTP, real auth, real registry) and fulfilled back to the
 * page with an Access-Control-Allow-Origin header. The bridge binary,
 * its CORS policy, and its responses are exactly production's; only
 * the browser's CORS enforcement point is bridged over, inside the
 * evaluator. Production (vokrew.com, an allowed origin) never needs it.
 *
 * Run:  xvfb-run -a node stage2-evaluator.mjs
 * Exit code 0 = gate green. Evidence lands in this directory.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const APP_REPO = path.resolve(HERE, "..", "..", "..", "app");
const LLAMA_DIR = path.resolve(HERE, "..", "..", "..", "..", "vokrew-local-test");
const LLAMA_BIN = path.join(LLAMA_DIR, "llama-b11669", "llama-server");
const MODEL = path.join(LLAMA_DIR, "gemma3-1b.gguf");
const CHROME = process.env.CHROME || "/opt/meta-chromium/chrome";
const LLAMA_PORT = 18080;
const BRIDGE_PORT = 17717;
const CDP_PORT = 9334;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const RIG_HOME = "/tmp/vokrew-s2-eval-home";
const PROFILE = "/tmp/floor-s2-eval-profile";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const TASK = "Write a one-line bash command that prints the current folder path, then explain it in one short sentence.";

const results = { assertions: [], consoleErrors: [], screenshots: [], rig: {}, phases: [] };
function assert(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- tiny CDP client (same shape as Stage 1) ---------------- */

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      } else if (m.method) {
        this.handlers.forEach((h) => h(m));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this.handlers.push(fn); }
  async eval(expression, awaitPromise = false) {
    const r = await this.send("Runtime.evaluate", {
      expression, awaitPromise, returnByValue: true, userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error("evaluate failed: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error("timeout waiting for " + label);
    await sleep(300);
  }
}

/* ---------------- rig: llama-server + real bridge ---------------- */

function writeRigHome() {
  fs.rmSync(RIG_HOME, { recursive: true, force: true });
  fs.mkdirSync(RIG_HOME, { recursive: true });
  fs.writeFileSync(path.join(RIG_HOME, "config.json"), JSON.stringify({
    lanes: [{
      id: "local-gemma", provider: "openai-compatible", family: "gemma",
      tier: "local", model: "gemma-local",
      baseUrl: `http://127.0.0.1:${LLAMA_PORT}/v1`, cap: null
    }],
    roles: { planner: ["local-gemma"], executor: ["local-gemma"], reviewer: ["local-gemma"] }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(RIG_HOME, "crews.json"), JSON.stringify({
    default: { roles: {} },
    rig: { roles: {
      planner: { name: "Scout", instructions: "Plan small, verifiable steps.", lanes: ["local-gemma"] },
      executor: { name: "Musky", instructions: "Do the work plainly and completely.", lanes: ["local-gemma"] },
      reviewer: { name: "Judge", instructions: "Be strict. Flag anything unverified.", lanes: ["local-gemma"] }
    } }
  }, null, 2) + "\n");
}

function startBridge() {
  const proc = spawn("node", ["src/cli.js", "serve", "--port", String(BRIDGE_PORT)], {
    cwd: APP_REPO, env: { ...process.env, VOKREW_HOME: RIG_HOME }, stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data", (d) => { out += d; });
  return { proc, out: () => out };
}

async function bridgePairCode(bridge) {
  return waitFor(() => {
    const m = /Pairing code: (\d{6})/.exec(bridge.out());
    return m && m[1];
  }, 20000, "bridge pairing code");
}

async function bridgeHealth() {
  const r = await fetch(BRIDGE_BASE + "/health").catch(() => null);
  return !!(r && r.ok);
}

/* ---------------- main ---------------- */

let llamaProc = null, bridge = null, chromeProc = null, token = null;
const authH = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
async function bridgeGet(p) {
  const r = await fetch(BRIDGE_BASE + p, { headers: authH() });
  return { status: r.status, data: await r.json().catch(() => null) };
}

try {
  writeRigHome();

  llamaProc = spawn(LLAMA_BIN, ["-m", MODEL, "--alias", "gemma-local", "--host", "127.0.0.1", "--port", String(LLAMA_PORT)],
    { stdio: "ignore" });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/models`).catch(() => null);
    return r && r.ok;
  }, 60000, "llama-server models");
  results.rig.llama = `gemma-local on :${LLAMA_PORT}`;

  bridge = startBridge();
  const code = await bridgePairCode(bridge);
  const pairRes = await fetch(BRIDGE_BASE + "/pair", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code })
  });
  const pairData = await pairRes.json();
  if (!pairData.token) throw new Error("pairing failed: " + JSON.stringify(pairData));
  token = pairData.token;
  results.rig.bridge = `registry build on :${BRIDGE_PORT}, paired`;

  const lanes = await bridgeGet("/lanes");
  assert("rig lane is the real local model (no mock)", lanes.data.lanes.length === 1 &&
    lanes.data.lanes[0].id === "local-gemma" && /reachable/.test(lanes.data.lanes[0].health),
    JSON.stringify(lanes.data.lanes.map((l) => `${l.id}: ${l.health}`)));

  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chromeEnv = { ...process.env };
  for (const k of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]) delete chromeEnv[k];
  chromeProc = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server",
    `--remote-debugging-port=${CDP_PORT}`, "--window-size=1440,900",
    `--user-data-dir=${PROFILE}`, "about:blank"
  ], { stdio: "ignore", env: chromeEnv });

  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).catch(() => null);
    return r && r.ok;
  }, 20000, "chrome CDP");

  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const cdp = new CDP(ws);

  cdp.on((m) => {
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      results.consoleErrors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") {
      results.consoleErrors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      results.consoleErrors.push("log: " + m.params.entry.text + " @ " + (m.params.entry.url || ""));
    }
  });

  /* CORS bridge-over (see header): intercept ONLY the bridge origin. */
  cdp.on(async (m) => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      if (request.method === "OPTIONS") {
        await cdp.send("Fetch.fulfillRequest", {
          requestId, responseCode: 204,
          responseHeaders: [
            { name: "Access-Control-Allow-Origin", value: "*" },
            { name: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
            { name: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" },
            { name: "Access-Control-Allow-Private-Network", value: "true" }
          ]
        });
        return;
      }
      const headers = {};
      for (const [k, v] of Object.entries(request.headers || {})) {
        const lk = k.toLowerCase();
        if (lk === "authorization" || lk === "content-type") headers[k] = v;
      }
      const resp = await fetch(request.url, {
        method: request.method, headers,
        body: request.postData || undefined
      });
      const buf = Buffer.from(await resp.arrayBuffer());
      await cdp.send("Fetch.fulfillRequest", {
        requestId, responseCode: resp.status,
        responseHeaders: [
          { name: "Content-Type", value: resp.headers.get("content-type") || "application/json" },
          { name: "Access-Control-Allow-Origin", value: "*" }
        ],
        body: buf.toString("base64")
      });
    } catch (e) {
      try { await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }); } catch { /* gone */ }
    }
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*127.0.0.1:${BRIDGE_PORT}*`, requestStage: "Request" }] });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("vokrew.token", ${JSON.stringify(token)}); localStorage.setItem("vokrew.bridgeUrl", ${JSON.stringify(BRIDGE_BASE)});`
  });
  await cdp.send("Page.navigate", { url: PAGE_URL });

  await waitFor(() => cdp.eval(`!document.getElementById('appShell').classList.contains('hidden')`), 20000, "app shell");
  assert("app shell enters against the real bridge", true);

  /* ---- the Floor, live ---- */

  await cdp.eval(`document.querySelector('[data-screen="floor"]').click()`);
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 20000, "floor.js + adapter load");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "adapter seats 3 agents");
  assert("adapter seats a 3-agent roster from the real bridge", true);

  const chip = await cdp.eval(`document.getElementById('floorModeChip').textContent`);
  assert("(j) mode chip is LIVE, never FIXTURE", chip === "LIVE", `chip=${chip}`);

  // Pick the named "rig" crew in the Floor form's own picker → room re-seats.
  await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, "crew picker populated");
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew seated");
  const rosterNames = await cdp.eval(`[...document.querySelectorAll('#roster .acard .aname')].map(e => e.textContent).join(',')`);
  assert("roster shows the rig crew by name", rosterNames === "Scout,Musky,Judge", rosterNames);

  await sleep(1200); // let everyone settle at their desks
  await cdp.eval(`document.getElementById('floorRoot').scrollIntoView({ block: 'start' })`);
  await sleep(400);
  const idleShot = path.join(HERE, "stage2-room-idle.png");
  const shot0 = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(idleShot, Buffer.from(shot0.data, "base64"));
  results.screenshots.push({ file: "stage2-room-idle.png", note: "live room, rig crew seated, no run yet" });
  assert("idle room screenshot captured", fs.statSync(idleShot).size > 10000, `${fs.statSync(idleShot).size} bytes`);

  const pillBefore = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
  const doorstep = await cdp.eval(`(() => { const d = window.__floorDebug.allDoorsteps().find(x => x.id === 'c-w2'); return window.__floorDebug.cellOfPoint(d); })()`);
  const reviewerSeatCell = await cdp.eval(`(() => { const a = window.__floorDebug.activity().find(x => x.agent === 'rig:reviewer'); return a.cell; })()`);

  /* ---- submit a run from the page's own form ---- */

  await cdp.eval(`(() => { document.getElementById('floorRunTask').value = ${JSON.stringify(TASK)}; })()`);
  await cdp.eval(`document.getElementById('floorRunBtn').click()`);
  const started = await waitFor(async () => {
    const l = await bridgeGet("/runs?limit=5");
    return l.data.runs.find((r) => r.task === TASK && r.crew === "rig") || null;
  }, 20000, "run registered on the bridge");
  const runId = started.id;
  results.rig.runId = runId;
  assert("run submitted from the Floor form is registered (async 202)", !!runId, runId);

  /* ---- observe the whole run: bridge phases vs page entity state ---- */

  let sawPlannerWork = false, sawExecutorWork = false;
  let reviewerLeft = false, reviewerArrived = false, doorwayShotDone = false;
  let lastPhase = null;
  const t0 = Date.now();
  let final = null;
  while (Date.now() - t0 < 300000) {
    const { data } = await bridgeGet("/runs/" + runId);
    const rec = data.run;
    if (rec.phase !== lastPhase) {
      results.phases.push({ phase: rec.phase, state: rec.state, atSec: Math.round((Date.now() - t0) / 1000), stamps: rec.stamps.length });
      lastPhase = rec.phase;
    }
    const act = await cdp.eval(`window.__floorDebug.activity()`).catch(() => []);
    const byId = Object.fromEntries(act.map((a) => [a.agent, a]));
    if (rec.phase === "planner" && byId["rig:planner"] && byId["rig:planner"].mode === "work") sawPlannerWork = true;
    if (rec.phase === "executor" && byId["rig:executor"] && byId["rig:executor"].mode === "work") sawExecutorWork = true;
    if (rec.phase === "reviewer" && byId["rig:reviewer"] && byId["rig:reviewer"].cell) {
      const c = byId["rig:reviewer"].cell;
      const inOwnCube = c.cx >= 9 && c.cx <= 22 && c.cy >= 59 && c.cy <= 67; // c-sw cubicle cells
      if (!inOwnCube) reviewerLeft = true;
      if (c.cx === doorstep.cx && c.cy === doorstep.cy) {
        reviewerArrived = true;
        if (!doorwayShotDone) {
          doorwayShotDone = true;
          // Frame the room itself: close the run card and scroll the
          // room into view, or the capture fills with the card instead
          // of the doorway moment it is meant to evidence.
          await cdp.eval(`(() => { const c = document.getElementById('floorCardClose'); if (c) c.click(); const r = document.getElementById('floorRoot'); if (r) r.scrollIntoView({ block: 'start' }); })()`);
          await sleep(700);
          const p = path.join(HERE, "stage2-reviewer-at-doorway.png");
          const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(p, Buffer.from(shot.data, "base64"));
          results.screenshots.push({ file: "stage2-reviewer-at-doorway.png", note: "reviewer entity standing on the executor doorstep cell during phase reviewer" });
        }
      }
    }
    if (rec.state !== "running") { final = rec; break; }
    await sleep(400);
  }
  if (!final) throw new Error("run did not settle within 300s");
  results.rig.finalRecord = { state: final.state, verdict: final.verdict, crossFamily: final.crossFamily, stamps: final.stamps };

  assert("(a) planner entity in work mode during phase planner", sawPlannerWork);
  assert("(b) executor entity in work mode during phase executor", sawExecutorWork);
  assert("(c) reviewer leaves its own cubicle during phase reviewer", reviewerLeft,
    `seat cell=${JSON.stringify(reviewerSeatCell)}`);
  assert("(c) reviewer arrives at the executor's doorstep cell", reviewerArrived,
    `doorstep cell=${JSON.stringify(doorstep)}`);
  assert("reviewer-at-doorway screenshot captured during the reviewer phase", doorwayShotDone);
  assert("run completes done on the bridge", final.state === "done", `state=${final.state} verdict=${final.verdict}`);

  /* ---- (d) quest log + run card verdict ---- */

  await sleep(1500); // adapter's next poll lands the settled record in the room
  const rowVerdict = await cdp.eval(`(() => { const r = document.querySelector('#tasklist .trow[data-id="${runId}"]'); return r ? r.textContent : null; })()`);
  assert("(d) quest-log row carries the verdict", !!rowVerdict && rowVerdict.includes(final.verdict), String(rowVerdict).slice(0, 120));
  await cdp.eval(`document.querySelector('#tasklist .trow[data-id="${runId}"]').click()`);
  await waitFor(() => cdp.eval(`!document.getElementById('floorRunCard').classList.contains('hidden')`), 10000, "run card opens");
  const cardVerdict = await cdp.eval(`document.getElementById('floorCardVerdict').textContent`);
  assert("(d) run card verdict == GET /runs/:id verdict", cardVerdict.includes(final.verdict), cardVerdict);
  const cardStamps = await cdp.eval(`document.getElementById('floorCardStamps').textContent`);
  assert("run card stamps name the real lane + model", cardStamps.includes("lane=local-gemma") && cardStamps.includes("model=gemma-local"),
    cardStamps.split("\n")[0] || "");

  await cdp.eval(`document.getElementById('floorRunCard').scrollIntoView({ block: 'start' })`);
  await sleep(400);
  const cardShot = path.join(HERE, "stage2-run-card.png");
  const shotC = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(cardShot, Buffer.from(shotC.data, "base64"));
  results.screenshots.push({ file: "stage2-run-card.png", note: "completed run card opened from the quest-log entry" });
  assert("completed run card screenshot captured", fs.statSync(cardShot).size > 10000, `${fs.statSync(cardShot).size} bytes`);

  /* ---- (e) focus-panel stamps match the record ---- */

  let focusOk = true;
  const focusDetail = [];
  for (const st of final.stamps) {
    await cdp.eval(`window.__floorDebug.selectAgent(${JSON.stringify("rig:" + st.role)})`);
    await sleep(700);
    const panel = await cdp.eval(`document.getElementById('focus').textContent`);
    const ok = panel.includes(`lane=${st.lane}`) && panel.includes(`model=${st.model}`) && panel.includes(`family=${st.family}`);
    if (!ok) focusOk = false;
    focusDetail.push(`${st.role}:${ok ? "ok" : "MISSING"}`);
  }
  assert("(e) focus-panel stamps match the record (lane + model + family)", focusOk, focusDetail.join(" "));

  /* ---- (f) budget pill delta == served stages ----
     The pill is stamped from the adapter's budget poll (spec §3: 15 s
     cadence, plus a refresh when a run settles) — wait for it to
     settle to the settled ledger value, then compare exactly. */

  const pillAfter = await waitFor(async () => {
    const v = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
    return v === pillBefore + final.stamps.length ? v : null;
  }, 30000, "budget pill settling to the final count").catch(() =>
    cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`));
  assert("(f) budget pill increases by exactly the served stage count",
    pillAfter - pillBefore === final.stamps.length,
    `pill ${pillBefore} -> ${pillAfter}, stamps=${final.stamps.length}`);

  /* ---- (g) same family: flagged by the data, labeled by the room ---- */

  assert("(g) rig record reports crossFamily=false (single-family rig)", final.crossFamily === false,
    `crossFamily=${final.crossFamily} — if this is ever true, the rig changed, do not force it`);
  const statusLine = await cdp.eval(`document.getElementById('floorRunStatus').textContent`);
  assert("(g) 'same family' label visible (status line)", /same family/.test(statusLine), statusLine);
  assert("(g) 'same family' label visible (run card footer)", /cross-family=no/.test(cardStamps), "");

  /* ---- (i) regression: Chat / Run / Budget / Crew tabs ---- */

  await cdp.eval(`document.querySelector('[data-screen="chat"]').click()`);
  await sleep(300);
  await cdp.eval(`(() => { document.getElementById('chatInput').value = 'In one short sentence, what does the bash command pwd do?'; })()`);
  await cdp.eval(`document.getElementById('chatSend').click()`);
  const chatOk = await waitFor(async () => {
    const t = await cdp.eval(`[...document.querySelectorAll('#chatThread .msg.crew .stamp')].map(e => e.textContent).join(' ')`);
    return t.includes("local-gemma") ? t : null;
  }, 180000, "chat reply with a real stamp");
  assert("(i) Chat tab answers with a real local-gemma stamp", !!chatOk, String(chatOk).slice(0, 100));

  await cdp.eval(`document.querySelector('[data-screen="budget"]').click()`);
  await sleep(800);
  const budgetHtml = await cdp.eval(`document.getElementById('budgetCoding').textContent`);
  assert("(i) Budget tab lists the lane with its call count", budgetHtml.includes("local-gemma") && /\d+ used/.test(budgetHtml),
    budgetHtml.slice(0, 100));

  await cdp.eval(`document.querySelector('[data-screen="crew"]').click()`);
  await sleep(800);
  const crewHtml = await cdp.eval(`document.getElementById('crewList').textContent + document.getElementById('laneList').textContent`);
  assert("(i) Crew tab lists crews + lanes", crewHtml.includes("rig") && crewHtml.includes("local-gemma"), crewHtml.slice(0, 100));

  await cdp.eval(`document.querySelector('[data-screen="run"]').click()`);
  await sleep(300);
  await cdp.eval(`(() => { document.getElementById('runTask').value = 'Write a one-line bash command that lists the files in the current folder.'; const s = document.getElementById('runCrew'); if ([...s.options].some(o => o.value === 'rig')) s.value = 'rig'; })()`);
  await cdp.eval(`document.getElementById('runBtn').click()`);
  await waitFor(() => cdp.eval(`!document.getElementById('runResult').classList.contains('hidden')`), 600000, "Run tab result via ?wait=1");
  const runTabStamps = await cdp.eval(`document.getElementById('runStamps').textContent`);
  const runTabVerdict = await cdp.eval(`document.getElementById('runVerdict').textContent`);
  assert("(i) Run tab (?wait=1 compat) returns a stamped result as today",
    runTabStamps.includes("lane=local-gemma") && runTabStamps.includes("model=gemma-local") && /verdict/i.test(runTabVerdict),
    runTabVerdict + " | " + (runTabStamps.split("\n")[0] || ""));

  /* ---- run lost: restart the bridge under the open card ---- */

  await cdp.eval(`document.querySelector('[data-screen="floor"]').click()`);
  await sleep(500);
  bridge.proc.kill("SIGKILL");
  await waitFor(async () => !(await bridgeHealth()), 15000, "bridge down");
  bridge = startBridge();
  await waitFor(() => bridgeHealth(), 20000, "bridge back (fresh registry)");
  const lostText = await waitFor(async () => {
    const t = await cdp.eval(`document.getElementById('floorCardVerdict').textContent`);
    return t === "run lost — bridge restarted" ? t : null;
  }, 30000, "run-lost rendering");
  assert("bridge restart -> open card renders 'run lost — bridge restarted'", !!lostText, String(lostText));

  /* ---- (j) + (h) ---- */

  const fixtureOnDisk = fs.existsSync(path.join(APP_DIR, "floor-fixture.js"));
  const fixtureLoaded = await cdp.eval(`performance.getEntriesByType('resource').some(e => e.name.includes('floor-fixture'))`);
  const chipNow = await cdp.eval(`document.getElementById('floorModeChip').textContent`);
  assert("(j) floor-fixture.js deleted and never loaded; chip never FIXTURE",
    !fixtureOnDisk && !fixtureLoaded && chipNow !== "FIXTURE",
    `onDisk=${fixtureOnDisk} loaded=${fixtureLoaded} chip=${chipNow}`);

  /* (h) zero console errors — with two named, by-design exceptions,
     both created by the bridge-restart test above and both HANDLED
     by the page (they are Chrome Log-domain network entries, not JS
     exceptions or console.error calls):
       1. the run-lost probe: GET /runs/:id against the restarted
          bridge answers 404 — that 404 IS the feature under test;
       2. outage noise: while the bridge is killed, the adapter's
          polls hit a dead port (net::ERR_FAILED) — exactly how the
          adapter learns to show the locked room; it recovers on the
          next poll after the restart.
     Both classes are tallied in results.json for the reviewer. Any
     other console error, any exception, or any unexplained log entry
     fails the gate. */
  const logEntries = results.consoleErrors.filter((e) => e.startsWith("log:"));
  const nonLogErrors = results.consoleErrors.filter((e) => !e.startsWith("log:"));
  const probe404s = logEntries.filter((e) => e.includes("status of 404") && e.includes("/runs/"));
  const outageNoise = logEntries.filter((e) => e.includes("net::ERR_FAILED") && e.includes(`127.0.0.1:${BRIDGE_PORT}`));
  const unexplained = logEntries.filter((e) => !probe404s.includes(e) && !outageNoise.includes(e));
  results.runLostProbe404s = probe404s.length;
  results.bridgeOutageLogEntries = outageNoise;
  assert("(h) zero console errors (excluding by-design restart-test network entries)",
    nonLogErrors.length === 0 && unexplained.length === 0 && probe404s.length >= 1,
    `probe404s=${probe404s.length} outageEntries=${outageNoise.length}; unexplained=${unexplained.slice(0, 3).join(" | ") || "none"}; nonLog=${nonLogErrors.slice(0, 3).join(" | ") || "none"}`);

  ws.close();
} catch (e) {
  assert("evaluator completed without harness error", false, e.message);
} finally {
  try { if (chromeProc) chromeProc.kill("SIGKILL"); } catch { /* already gone */ }
  try { if (bridge) bridge.proc.kill("SIGKILL"); } catch { /* already gone */ }
  try { if (llamaProc) llamaProc.kill("SIGKILL"); } catch { /* already gone */ }
  const failed = results.assertions.filter((a) => !a.ok);
  results.verdict = failed.length === 0 ? "STAGE 2 GATE: PASS" : `STAGE 2 GATE: FAIL (${failed.length})`;
  fs.writeFileSync(path.join(HERE, "results.json"), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict);
  process.exit(failed.length === 0 ? 0 : 1);
}
