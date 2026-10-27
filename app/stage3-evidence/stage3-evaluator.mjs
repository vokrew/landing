#!/usr/bin/env node
/*
 * Stage 3 evaluator — PHASE1-FLOOR-SPEC.md §6, Stage 3 gate.
 *
 * Same rig and serving mechanism as the Stage 2 evaluator (real
 * Chromium over CDP, page over file://, CDP Fetch interception bridging
 * ONLY the browser's CORS enforcement point against the untouched real
 * bridge; llama.cpp Gemma 3 1B as the single local lane — no mocks).
 * See stage2-evaluator.mjs's header for the full mechanism rationale.
 *
 * What this gate adds over Stage 2 — shell integration:
 *   (0) fresh profile, NO token anywhere: the connect screen (the
 *       door) renders OVER the locked room — shell visible underneath,
 *       Floor is the active screen, chip OFFLINE, zero agents seated,
 *       zero entities, and nothing moves.
 *   (1) pairing through the page's OWN form drops the door and lands
 *       on the Floor screen by default (no tab click) — room lights,
 *       the bridge's default crew seats.
 *   (2) crew switch in the Floor screen's picker re-seats the room:
 *       exactly the new crew's 3 entities exist, the old crew's entity
 *       ids are gone, roster shows the new names.
 *   (3) a run submitted on the switched crew, then a PAGE RELOAD
 *       mid-run (during the executor phase): the room reattaches to
 *       the same runId from GET /runs alone — quest row in progress,
 *       run card reopens on the adopted run, the reviewer STILL walks
 *       to the executor's doorway after the reload, the run completes
 *       and the status line reports the verdict through the adopted
 *       tracked run; quest/card verdicts == GET /runs/:id; the
 *       record's stamps carry the NEW crew's agent names.
 *   (4) regression: Chat / Run (?wait=1) / Budget / Crew tabs as in
 *       Stage 2 (the Run tab run uses the unnamed default crew, whose
 *       stamps must carry no agent= names — the two crews stamp
 *       differently, proving the switch in (2)/(3) was real).
 *   (5) Disconnect: token cleared, door returns, and the adapter
 *       resets to the pristine locked room (zero agents, OFFLINE).
 *   (h) zero console errors for the whole session (classification as
 *       in Stage 2: JS exceptions / console.error are zero-tolerance;
 *       bridge-origin net::ERR_FAILED Log entries — in-flight polls
 *       aborted by the deliberate page reload — are tallied, named,
 *       and any other Log entry fails the gate).
 *
 * Run:  xvfb-run -a node stage3-evaluator.mjs
 * Exit code 0 = gate green. Evidence lands in this directory.
 */
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
const CDP_PORT = 9335;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const RIG_HOME = "/tmp/vokrew-s3-eval-home";
const PROFILE = "/tmp/floor-s3-eval-profile";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const TASK = "Write a one-line bash command that prints the current folder path, then explain it in one short sentence.";

const results = { assertions: [], consoleErrors: [], screenshots: [], rig: {}, phases: [] };
function assert(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- tiny CDP client (same shape as Stages 1–2) ---------------- */

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
async function shot(cdp, file, note) {
  const p = path.join(HERE, file);
  const s = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(p, Buffer.from(s.data, "base64"));
  results.screenshots.push({ file, note });
  return fs.statSync(p).size;
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
  results.rig.bridge = `registry build on :${BRIDGE_PORT}`;

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

  /* CORS bridge-over (see Stage 2 header): intercept ONLY the bridge origin. */
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

  /* ============ (0) fresh profile: the door over the locked room ============
     No token is seeded anywhere. The page must boot unpaired: shell
     rendered, Floor the active screen, connect overlay on top, room
     locked and empty. */

  await cdp.send("Page.navigate", { url: PAGE_URL });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load behind the door");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 15000, "locked room seats nobody");

  const door = await cdp.eval(`(() => {
    const cs = document.getElementById('connectScreen');
    const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      overlayVisible: !cs.classList.contains('hidden'),
      centerHit: !!(center && center.closest && center.closest('#connectScreen')),
      shellRendered: !!document.getElementById('appShell'),
      activeTab: document.querySelector('.tab.active')?.dataset.screen,
      floorVisible: !document.getElementById('screen-floor').classList.contains('hidden'),
      chip: document.getElementById('floorModeChip').textContent,
      pill: document.getElementById('statusText').textContent,
      connected: window.__floorDebug.state().connected,
      ents: Object.keys(window.__floorDebug.ents).length,
      rosterCards: document.querySelectorAll('#roster .acard').length
    };
  })()`);
  assert("(0) connect door is up over the rendered shell", door.overlayVisible && door.centerHit && door.shellRendered, JSON.stringify(door));
  assert("(0) Floor is the screen behind the door", door.activeTab === "floor" && door.floorVisible, `tab=${door.activeTab}`);
  assert("(0) locked room: OFFLINE chip, nobody seated, no entities",
    door.chip === "OFFLINE" && door.connected === false && door.ents === 0 && door.rosterCards === 0,
    `chip=${door.chip} connected=${door.connected} ents=${door.ents} roster=${door.rosterCards}`);
  assert("(0) status pill says not connected", door.pill === "not connected", door.pill);

  await sleep(3500); // locked means locked: nothing may appear or move
  const stillLocked = await cdp.eval(`window.__floorDebug.state().agents === 0 && Object.keys(window.__floorDebug.ents).length === 0`);
  assert("(0) no agent appears or moves while locked", stillLocked);
  const lockedSize = await shot(cdp, "stage3-locked-room.png", "fresh profile: connect door over the locked, empty Floor room");
  assert("(0) locked-room screenshot captured", lockedSize > 10000, `${lockedSize} bytes`);

  /* ============ (1) pair through the page's own form ============ */

  await cdp.eval(`(() => {
    document.getElementById('bridgeUrl').value = ${JSON.stringify(BRIDGE_BASE)};
    document.getElementById('pairCode').value = ${JSON.stringify(code)};
  })()`);
  await cdp.eval(`document.getElementById('pairBtn').click()`);
  await waitFor(() => cdp.eval(`document.getElementById('connectScreen').classList.contains('hidden')`), 25000, "door drops after pairing");
  token = await cdp.eval(`localStorage.getItem('vokrew.token')`);
  assert("(1) pairing via the page form stores a token and drops the door", !!token);

  const landing = await cdp.eval(`(() => ({
    activeTab: document.querySelector('.tab.active')?.dataset.screen,
    floorVisible: !document.getElementById('screen-floor').classList.contains('hidden'),
    chatHidden: document.getElementById('screen-chat').classList.contains('hidden'),
    pill: document.getElementById('statusText').textContent
  }))()`);
  assert("(1) Floor is the default post-pair screen (no tab click)",
    landing.activeTab === "floor" && landing.floorVisible && landing.chatHidden && landing.pill === "connected",
    JSON.stringify(landing));

  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "default crew seats after pairing");
  const chipLive = await cdp.eval(`document.getElementById('floorModeChip').textContent`);
  const defaultNames = await cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',')`);
  assert("(1) room lights: chip LIVE, default crew seated",
    chipLive === "LIVE" && defaultNames === "Planner,Executor,Reviewer",
    `chip=${chipLive} names=${defaultNames}`);
  const defSize = await shot(cdp, "stage3-floor-default.png", "just paired: Floor home screen, default crew seated");
  assert("(1) post-pair Floor screenshot captured", defSize > 10000, `${defSize} bytes`);

  /* ============ (2) crew switch re-seats the room ============ */

  await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, "crew picker populated");
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew seated");
  const entsAfterSwitch = await cdp.eval(`Object.keys(window.__floorDebug.ents).sort()`);
  assert("(2) exactly the new crew's 3 entities exist, old crew gone",
    JSON.stringify(entsAfterSwitch) === JSON.stringify(["rig:executor", "rig:planner", "rig:reviewer"]),
    entsAfterSwitch.join(","));
  const rosterNames = await cdp.eval(`[...document.querySelectorAll('#roster .acard .aname')].map(e => e.textContent).join(',')`);
  assert("(2) roster shows the new crew by name", rosterNames === "Scout,Musky,Judge", rosterNames);
  const swSize = await shot(cdp, "stage3-crew-switched.png", "after crew switch: rig crew (Scout/Musky/Judge) seated, default crew gone");
  assert("(2) crew-switch screenshot captured", swSize > 10000, `${swSize} bytes`);

  /* ============ (3) run on the new crew + mid-run reload reattach ============ */

  const pillBefore = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
  const doorstep = await cdp.eval(`(() => { const d = window.__floorDebug.allDoorsteps().find(x => x.id === 'c-w2'); return window.__floorDebug.cellOfPoint(d); })()`);

  await cdp.eval(`(() => { document.getElementById('floorRunTask').value = ${JSON.stringify(TASK)}; })()`);
  await cdp.eval(`document.getElementById('floorRunBtn').click()`);
  const started = await waitFor(async () => {
    const l = await bridgeGet("/runs?limit=5");
    return l.data.runs.find((r) => r.task === TASK && r.crew === "rig") || null;
  }, 20000, "run registered on the bridge");
  const runId = started.id;
  results.rig.runId = runId;
  assert("(3) run submitted from the Floor form on the switched crew", !!runId, runId);

  // Watch the bridge until the executor phase; confirm the page is
  // tracking the run BEFORE the reload (phase text / live run), then
  // reload mid-run.
  let sawPagePhasePreReload = false;
  let lastPhase = null;
  const t0 = Date.now();
  let reloaded = false;
  while (Date.now() - t0 < 240000) {
    const { data } = await bridgeGet("/runs/" + runId);
    const rec = data.run;
    if (rec.phase !== lastPhase) {
      results.phases.push({ phase: rec.phase, state: rec.state, atSec: Math.round((Date.now() - t0) / 1000), stamps: rec.stamps.length });
      lastPhase = rec.phase;
    }
    if (!reloaded) {
      const pagePhase = await cdp.eval(`(() => {
        const s = document.getElementById('floorRunStatus').textContent;
        return /planning|executing|reviewing/.test(s) || window.__floorDebug.state().liveRuns > 0;
      })()`).catch(() => false);
      if (pagePhase) sawPagePhasePreReload = true;
      if (rec.phase === "executor" && sawPagePhasePreReload) break;
      if (rec.state !== "running") break;
    }
    await sleep(400);
  }
  assert("(3) page tracked the run's phase before the reload", sawPagePhasePreReload);
  const phaseAtReload = lastPhase;
  assert("(3) reload happens mid-run (executor phase reached)", phaseAtReload === "executor", `phase=${phaseAtReload}`);

  await cdp.send("Page.reload", { ignoreCache: false });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor reloads after Page.reload");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "crew re-seats after reload");

  // Reattach: the room must rediscover THIS run from the bridge alone.
  const reattach = await waitFor(async () => {
    const v = await cdp.eval(`(() => {
      const row = document.querySelector('#tasklist .trow[data-id="${runId}"]');
      const card = document.getElementById('floorRunCard');
      const cardVerdict = document.getElementById('floorCardVerdict').textContent;
      return {
        row: row ? row.textContent : null,
        cardOpen: !!card && !card.classList.contains('hidden'),
        cardVerdict
      };
    })()`).catch(() => null);
    return v && v.row && /IN PROGRESS/i.test(v.row) && v.cardOpen && /Running — phase:/.test(v.cardVerdict) ? v : null;
  }, 30000, "room reattaches to the in-flight run");
  assert("(3) after reload the room reattaches: quest row IN PROGRESS + run card reopened on the same runId",
    !!reattach, JSON.stringify(reattach).slice(0, 160));
  results.rig.reattach = reattach;

  // Keep watching: the reviewer must still make the doorway visit in
  // the reloaded page (positions from entity state, never pixels).
  let reviewerLeft = false, reviewerArrived = false, doorwayShotDone = false;
  let final = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 300000) {
    const { data } = await bridgeGet("/runs/" + runId);
    const rec = data.run;
    if (rec.phase !== lastPhase) {
      results.phases.push({ phase: rec.phase, state: rec.state, atSec: Math.round((Date.now() - t0) / 1000), stamps: rec.stamps.length });
      lastPhase = rec.phase;
    }
    if (rec.phase === "reviewer") {
      const act = await cdp.eval(`window.__floorDebug.activity()`).catch(() => []);
      const rev = act.find((a) => a.agent === "rig:reviewer");
      if (rev && rev.cell) {
        const c = rev.cell;
        const inOwnCube = c.cx >= 9 && c.cx <= 22 && c.cy >= 59 && c.cy <= 67; // c-sw cubicle cells
        if (!inOwnCube) reviewerLeft = true;
        if (c.cx === doorstep.cx && c.cy === doorstep.cy) {
          reviewerArrived = true;
          if (!doorwayShotDone) {
            doorwayShotDone = true;
            await cdp.eval(`(() => { const c = document.getElementById('floorCardClose'); if (c) c.click(); const r = document.getElementById('floorRoot'); if (r) r.scrollIntoView({ block: 'start' }); })()`);
            await sleep(700);
            await shot(cdp, "stage3-reattached-doorway.png", "AFTER the mid-run reload: reviewer entity on the executor doorstep cell during phase reviewer");
          }
        }
      }
    }
    if (rec.state !== "running") { final = rec; break; }
    await sleep(400);
  }
  if (!final) throw new Error("run did not settle within 300s after reload");
  results.rig.finalRecord = { state: final.state, verdict: final.verdict, crossFamily: final.crossFamily, stamps: final.stamps };

  assert("(3) reviewer leaves its cubicle after the reload", reviewerLeft);
  assert("(3) reviewer arrives at the executor's doorstep after the reload", reviewerArrived,
    `doorstep cell=${JSON.stringify(doorstep)}`);
  assert("(3) reattached doorway screenshot captured", doorwayShotDone);
  assert("(3) run completes done on the bridge", final.state === "done", `state=${final.state} verdict=${final.verdict}`);
  assert("(3) record stamps carry the NEW crew's agents (Scout/Musky/Judge)",
    JSON.stringify(final.stamps.map((s) => s.agent)) === JSON.stringify(["Scout", "Musky", "Judge"]),
    final.stamps.map((s) => `${s.role}=${s.agent}`).join(" "));

  // Adapter polls land the settled record in the room — wait for both
  // the quest row and the status line to reflect the settle.
  const rowVerdict = await waitFor(async () => {
    const t = await cdp.eval(`(() => { const r = document.querySelector('#tasklist .trow[data-id="${runId}"]'); return r ? r.textContent : null; })()`);
    return t && t.includes(final.verdict) ? t : null;
  }, 20000, "quest row verdict after settle").catch(async () =>
    cdp.eval(`(() => { const r = document.querySelector('#tasklist .trow[data-id="${runId}"]'); return r ? r.textContent : null; })()`));
  assert("(3) quest-log row carries the verdict after reattach", !!rowVerdict && rowVerdict.includes(final.verdict),
    String(rowVerdict).slice(0, 120));
  const statusLine = await waitFor(async () => {
    const t = await cdp.eval(`document.getElementById('floorRunStatus').textContent`);
    return t.startsWith("Run complete") ? t : null;
  }, 20000, "status line completion after settle").catch(async () =>
    cdp.eval(`document.getElementById('floorRunStatus').textContent`));
  assert("(3) status line reports completion via the ADOPTED run (no form submit since reload)",
    statusLine.startsWith("Run complete — verdict") && statusLine.includes(final.verdict), statusLine);
  assert("(3) 'same family' label visible (status line)", /same family/.test(statusLine), statusLine);

  await cdp.eval(`document.querySelector('#tasklist .trow[data-id="${runId}"]').click()`);
  await waitFor(() => cdp.eval(`!document.getElementById('floorRunCard').classList.contains('hidden')`), 10000, "run card reopens");
  const cardVerdict = await cdp.eval(`document.getElementById('floorCardVerdict').textContent`);
  assert("(3) run card verdict == GET /runs/:id verdict", cardVerdict.includes(final.verdict), cardVerdict);
  const cardStamps = await cdp.eval(`document.getElementById('floorCardStamps').textContent`);
  assert("(3) run card stamps name the real lane + model + new crew's agents",
    cardStamps.includes("lane=local-gemma") && cardStamps.includes("model=gemma-local") && cardStamps.includes("agent=Scout"),
    (cardStamps.split("\n")[0] || ""));
  assert("(3) 'same family' label visible (run card footer)", /cross-family=no/.test(cardStamps), "");

  // (e) focus-panel stamps match the record (as Stage 2)
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
  assert("(3) focus-panel stamps match the record (lane + model + family)", focusOk, focusDetail.join(" "));

  // (f) budget pill delta == served stages
  const pillAfter = await waitFor(async () => {
    const v = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
    return v === pillBefore + final.stamps.length ? v : null;
  }, 30000, "budget pill settling to the final count").catch(() =>
    cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`));
  assert("(3) budget pill increases by exactly the served stage count",
    pillAfter - pillBefore === final.stamps.length,
    `pill ${pillBefore} -> ${pillAfter}, stamps=${final.stamps.length}`);
  assert("(3) rig record reports crossFamily=false (single-family rig)", final.crossFamily === false,
    `crossFamily=${final.crossFamily} — if this is ever true, the rig changed, do not force it`);

  /* ============ (4) regression: Chat / Run / Budget / Crew tabs ============ */

  await cdp.eval(`document.querySelector('[data-screen="chat"]').click()`);
  await sleep(300);
  await cdp.eval(`(() => { document.getElementById('chatInput').value = 'In one short sentence, what does the bash command pwd do?'; })()`);
  await cdp.eval(`document.getElementById('chatSend').click()`);
  const chatOk = await waitFor(async () => {
    const t = await cdp.eval(`[...document.querySelectorAll('#chatThread .msg.crew .stamp')].map(e => e.textContent).join(' ')`);
    return t.includes("local-gemma") ? t : null;
  }, 180000, "chat reply with a real stamp");
  assert("(4) Chat tab answers with a real local-gemma stamp", !!chatOk, String(chatOk).slice(0, 100));

  await cdp.eval(`document.querySelector('[data-screen="budget"]').click()`);
  await sleep(800);
  const budgetHtml = await cdp.eval(`document.getElementById('budgetCoding').textContent`);
  assert("(4) Budget tab lists the lane with its call count", budgetHtml.includes("local-gemma") && /\d+ used/.test(budgetHtml),
    budgetHtml.slice(0, 100));

  await cdp.eval(`document.querySelector('[data-screen="crew"]').click()`);
  await sleep(800);
  const crewHtml = await cdp.eval(`document.getElementById('crewList').textContent + document.getElementById('laneList').textContent`);
  assert("(4) Crew tab lists crews + lanes", crewHtml.includes("rig") && crewHtml.includes("local-gemma"), crewHtml.slice(0, 100));

  await cdp.eval(`document.querySelector('[data-screen="run"]').click()`);
  await sleep(300);
  await cdp.eval(`(() => { document.getElementById('runTask').value = 'Write a one-line bash command that lists the files in the current folder.'; const s = document.getElementById('runCrew'); if ([...s.options].some(o => o.value === 'default')) s.value = 'default'; })()`);
  await cdp.eval(`document.getElementById('runBtn').click()`);
  await waitFor(() => cdp.eval(`!document.getElementById('runResult').classList.contains('hidden')`), 600000, "Run tab result via ?wait=1");
  const runTabStamps = await cdp.eval(`document.getElementById('runStamps').textContent`);
  const runTabVerdict = await cdp.eval(`document.getElementById('runVerdict').textContent`);
  assert("(4) Run tab (?wait=1 compat) returns a stamped result as today",
    runTabStamps.includes("lane=local-gemma") && runTabStamps.includes("model=gemma-local") && /verdict/i.test(runTabVerdict),
    runTabVerdict + " | " + (runTabStamps.split("\n")[0] || ""));
  assert("(4) Run tab run on the unnamed default crew stamps no agent names",
    !/agent=Scout|agent=Musky|agent=Judge/.test(runTabStamps), (runTabStamps.split("\n")[0] || ""));

  /* ============ (5) disconnect: the locked state returns ============ */

  await cdp.eval(`document.querySelector('[data-screen="floor"]').click()`);
  await sleep(500);
  await cdp.eval(`document.getElementById('disconnectBtn').click()`);
  await waitFor(() => cdp.eval(`!document.getElementById('connectScreen').classList.contains('hidden')`), 10000, "door returns on disconnect");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 20000, "adapter resets to the pristine locked room");
  const lockedAgain = await cdp.eval(`(() => ({
    token: localStorage.getItem('vokrew.token'),
    chip: document.getElementById('floorModeChip').textContent,
    connected: window.__floorDebug.state().connected,
    ents: Object.keys(window.__floorDebug.ents).length,
    rosterCards: document.querySelectorAll('#roster .acard').length,
    pill: document.getElementById('statusText').textContent
  }))()`);
  assert("(5) disconnect clears the token and relocks the room (OFFLINE, nobody seated)",
    lockedAgain.token === null && lockedAgain.chip === "OFFLINE" && lockedAgain.connected === false &&
    lockedAgain.ents === 0 && lockedAgain.rosterCards === 0 && lockedAgain.pill === "not connected",
    JSON.stringify(lockedAgain));
  const discSize = await shot(cdp, "stage3-disconnected.png", "after Disconnect: door back up, room reset to the pristine locked state");
  assert("(5) disconnected screenshot captured", discSize > 10000, `${discSize} bytes`);

  /* ============ (h) zero console errors ============
     Zero-tolerance: JS exceptions and console.error calls. Chrome's
     Log domain also records HANDLED network failures; the only class
     this gate can produce by design is net::ERR_FAILED against the
     bridge origin — adapter polls in flight when the deliberate
     Page.reload tore the document down (the harness then fails those
     requests). They are tallied here; anything else fails the gate. */

  const logEntries = results.consoleErrors.filter((e) => e.startsWith("log:"));
  const nonLogErrors = results.consoleErrors.filter((e) => !e.startsWith("log:"));
  const transportNoise = logEntries.filter((e) => e.includes("net::ERR_FAILED") && e.includes(`127.0.0.1:${BRIDGE_PORT}`));
  const unexplained = logEntries.filter((e) => !transportNoise.includes(e));
  results.transportNoise = transportNoise;
  assert("(h) zero console errors (excluding tallied reload-transport entries)",
    nonLogErrors.length === 0 && unexplained.length === 0,
    `transport=${transportNoise.length}; unexplained=${unexplained.slice(0, 3).join(" | ") || "none"}; nonLog=${nonLogErrors.slice(0, 3).join(" | ") || "none"}`);

  ws.close();
} catch (e) {
  assert("evaluator completed without harness error", false, e.message);
} finally {
  try { if (chromeProc) chromeProc.kill("SIGKILL"); } catch { /* already gone */ }
  try { if (bridge) bridge.proc.kill("SIGKILL"); } catch { /* already gone */ }
  try { if (llamaProc) llamaProc.kill("SIGKILL"); } catch { /* already gone */ }
  const failed = results.assertions.filter((a) => !a.ok);
  results.verdict = failed.length === 0 ? "STAGE 3 GATE: PASS" : `STAGE 3 GATE: FAIL (${failed.length})`;
  fs.writeFileSync(path.join(HERE, "results.json"), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict);
  process.exit(failed.length === 0 ? 0 : 1);
}
