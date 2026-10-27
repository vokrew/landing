#!/usr/bin/env node
/*
 * Phase 2 Stage 4 capture harness — LOOK GATE package (PHASE2-SPEC.md
 * Stage 4). This stage builds NO features. It produces the evidence
 * Kevin judges:
 *   A. floor-oc reference captures (idle + focus) at the Phase 1
 *      house frame recipe (--window-size=1440,900; layout viewport
 *      1440x813 in this headless build), from floor-oc's OWN server
 *      booted from the Four Hands clone source with example data.
 *   B. A CDP screencast VIDEO of one real conductor-driven session on
 *      the rig: pair through the page form -> seat the rig crew ->
 *      type a named call-out in the conductor -> hold card appears
 *      (sidebar + office noticeboard, badge 1) -> Approve -> the run
 *      executes (planner/executor work, reviewer walks to the
 *      executor's doorstep) -> verdict lands in the transcript ->
 *      reviewer dossier opened by a real canvas click, showing the
 *      run in its history. Full-res stills at each beat.
 *   C. Gap probes measured on the CURRENT build (not asserted away):
 *      (a) after settle, what element sits at the executor's canvas
 *          click point (Stage 1 finding: the auto-expanded run card);
 *      (b) during the run, the docked strip's geometry vs the canvas
 *          (Stage 0 deviation: a HUD sliver over the room's bottom).
 *
 * Rig (identical to Stages 0-3): real bridge (registry build) +
 * llama.cpp Gemma 3 1B lane, isolated VOKREW_HOME, real Chromium over
 * CDP, Vokrew page over file:// with bridge-origin Fetch interception
 * (this VM's Chromium blocks 127.0.0.1 navigation — LNA). NO mock
 * lanes. The lane is warmed by ONE small completion sent DIRECTLY to
 * llama-server (not through the bridge), so the recorded run starts
 * warm and the bridge ledger counts only the session's own calls.
 *
 * Takes: if the recorded run dies on the lane (G-9 contention), the
 * take is logged in takes.json and the harness exits 2; re-run with
 * TAKE=<n+1> SKIP_OC=1 to reuse the floor-oc captures. Takes 1-2 died
 * at the planner stage (120s lane timeout, browser+screencast
 * contention); from take 3 the rig pins llama-server to its own
 * vCPU (taskset, -t 1) and Chrome+bridge to the other — process
 * scheduling only, the page is never hidden during filming.
 *
 * Run:  xvfb-run -a node stage4-capture.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const APP_REPO = path.resolve(HERE, "..", "..", "..", "app");
const LLAMA_DIR = path.resolve(HERE, "..", "..", "..", "..", "vokrew-local-test");
const LLAMA_BIN = path.join(LLAMA_DIR, "llama-b11669", "llama-server");
const MODEL = path.join(LLAMA_DIR, "gemma3-1b.gguf");
const FLOOROC_SRC = path.resolve(HERE, "..", "..", "..", "..", "four-hands-clone", "tools", "floor");
const FLOOROC_DIR = "/tmp/floor-oc-p2s4";
const FLOOROC_PORT = 13201;
const FLOOROC_BASE = `http://127.0.0.1:${FLOOROC_PORT}`;
const CHROME = process.env.CHROME || "/opt/meta-chromium/chrome";
const LLAMA_PORT = 18080;
const BRIDGE_PORT = 17717;
const CDP_PORT = 9340;
const CDP_PORT_OC = 9341;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const RIG_HOME = "/tmp/vokrew-p2s4-home";
const PROFILE = "/tmp/floor-p2s4-profile";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const TAKE = parseInt(process.env.TAKE || "1", 10);
const SKIP_OC = process.env.SKIP_OC === "1";
const FRAMES_DIR = `/tmp/phase2s4-frames-take${TAKE}`;
/* The recorded session's call-out. Takes 1-3 used the Stage 2/3
   canonical text ("draft the release checklist and tag the open
   issues") — an open-ended task whose executor output cannot
   generate inside the bridge's 120s lane timeout on this 1B rig
   (take 3: planner served at 95s, executor died at 120s). The
   Phase 1 precedent applies: the filmed task is deliberately small
   (one-line output) so the VIDEO captures the room's behavior, not
   the VM's noise. The call-out keeps the named-seat form; every
   mechanic filmed (hold, approve, phases, walk, verdict) is
   task-independent. Disclosed in LOOK-GATE.md. */
const TEXT_NAMED = "Scout, write a one-line bash command that prints the word hello, then explain it in one short sentence";

const results = {
  take: TAKE, assertions: [], consoleErrors: [], screenshots: [],
  rig: {}, readability: {}, flooroc: {}, video: {}, phases: [], gaps: {}
};
if (SKIP_OC && fs.existsSync(path.join(HERE, "results.json"))) {
  const prior = JSON.parse(fs.readFileSync(path.join(HERE, "results.json"), "utf8"));
  results.flooroc = prior.flooroc || {};
  results.readability.flooroc = (prior.readability || {}).flooroc;
  results.readability.floorocFocus = (prior.readability || {}).floorocFocus;
  results.screenshots = (prior.screenshots || []).filter((s) => s.file.startsWith("flooroc-"));
  console.log("SKIP_OC=1: reusing prior floor-oc captures + measurements");
}
function note(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "OK  " : "MISS"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (x) => JSON.stringify(x);

/* ---------------- tiny CDP client (same shape as Stages 0-3) ---------------- */

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

function chromeEnvClean() {
  const e = { ...process.env };
  for (const k of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]) delete e[k];
  return e;
}

async function startChrome(profile, port, errSink) {
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn("taskset", ["-c", "1", CHROME,
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server",
    `--remote-debugging-port=${port}`, "--window-size=1440,900",
    `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: "ignore", env: chromeEnvClean() });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
    return r && r.ok;
  }, 20000, "chrome CDP");
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const cdp = new CDP(ws);
  cdp.on((m) => {
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errSink.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") {
      errSink.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      errSink.push("log: " + m.params.entry.text + " @ " + (m.params.entry.url || ""));
    }
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  return { proc, cdp, ws };
}

function interceptOrigin(cdp, urlPattern, forwardHeaders) {
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
        if (forwardHeaders.includes(lk)) headers[k] = v;
      }
      if (request.postData && !headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
      const resp = await fetch(request.url, {
        method: request.method, headers,
        body: request.postData || undefined
      });
      const buf = Buffer.from(await resp.arrayBuffer());
      await cdp.send("Fetch.fulfillRequest", {
        requestId, responseCode: resp.status,
        responseHeaders: [
          { name: "Content-Type", value: resp.headers.get("content-type") || "application/octet-stream" },
          { name: "Access-Control-Allow-Origin", value: "*" }
        ],
        body: buf.toString("base64")
      });
    } catch (e) {
      try { await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }); } catch { /* gone */ }
    }
  });
}

async function shot(cdp, file, noteText) {
  const p = path.join(HERE, file);
  const s = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(p, Buffer.from(s.data, "base64"));
  results.screenshots.push({ file, note: noteText });
  return fs.statSync(p).size;
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
  const proc = spawn("taskset", ["-c", "1", "node", "src/cli.js", "serve", "--port", String(BRIDGE_PORT)], {
    cwd: APP_REPO, env: { ...process.env, VOKREW_HOME: RIG_HOME }, stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data", (d) => { out += d; });
  return { proc, out: () => out };
}

let llamaProc = null, bridge = null, floorocProc = null, token = null, vokrewChrome = null, ocChrome = null;
const authH = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
async function bridgeGet(p) {
  const r = await fetch(BRIDGE_BASE + p, { headers: authH() });
  return { status: r.status, data: await r.json().catch(() => null) };
}

/* ---------------- page probes (lifted from Stages 0-3) ---------------- */

const CONDUCTOR_PROBE = `(() => {
  const dbg = window.__conductorDebug;
  const log = document.getElementById('conductorLog');
  const rows = log ? [...log.querySelectorAll('[data-kind]')].map((r) => ({
    kind: r.getAttribute('data-kind'), hold: r.getAttribute('data-hold'),
    run: r.getAttribute('data-run'), verdict: r.getAttribute('data-verdict'),
    text: r.textContent.replace(/\\s+/g, ' ').trim()
  })) : null;
  const nb = document.getElementById('noticeboard');
  return {
    state: dbg ? dbg.state() : null,
    rows,
    badge: (document.getElementById('holdBadge') || {}).textContent ?? null,
    holdCount: (document.getElementById('holdCount') || {}).textContent || null,
    nbHidden: nb ? nb.classList.contains('hidden') : null,
    nbCards: nb ? nb.querySelectorAll('.nbcard').length : 0,
    sidebarCards: document.querySelectorAll('#holdList .holdrow').length
  };
})()`;

const CARD_STATE = `(() => {
  const card = document.getElementById('floorRunCard');
  if (!card) return { present: false };
  const r = card.getBoundingClientRect();
  const strip = document.getElementById('floorCardStrip');
  const sr = strip ? strip.getBoundingClientRect() : null;
  const body = document.getElementById('floorCardBody');
  const br = body ? body.getBoundingClientRect() : null;
  const c = document.querySelector('#screen-floor canvas');
  const cr = c ? c.getBoundingClientRect() : null;
  const inter = (a, b) => a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
  return {
    present: true,
    cardHidden: card.classList.contains('hidden'),
    stripPresent: !!strip,
    stripVisible: !!strip && !card.classList.contains('hidden') && sr.height > 0,
    stripBox: sr ? { top: Math.round(sr.top), bottom: Math.round(sr.bottom), left: Math.round(sr.left), right: Math.round(sr.right), height: Math.round(sr.height) } : null,
    stripText: strip ? strip.textContent.replace(/\\s+/g, ' ').trim() : null,
    bodyVisible: !!body && !body.classList.contains('hidden') && br.height > 0,
    bodyBox: br ? { top: Math.round(br.top), bottom: Math.round(br.bottom), left: Math.round(br.left), right: Math.round(br.right), height: Math.round(br.height) } : null,
    canvasBox: cr ? { top: Math.round(cr.top), bottom: Math.round(cr.bottom), left: Math.round(cr.left), right: Math.round(cr.right), width: Math.round(cr.width), height: Math.round(cr.height) } : null,
    stripCanvasOverlap: inter(sr, cr),
    stripAreaFrac: sr && cr && cr.width ? +(((sr.width * sr.height) / (cr.width * cr.height)) * 100).toFixed(2) : null,
    bodyCanvasOverlap: inter(body && !body.classList.contains('hidden') ? br : null, cr),
    verdict: (document.getElementById('floorCardVerdict') || {}).textContent || null
  };
})()`;

const PANEL = `(() => {
  const p = document.getElementById('focus');
  if (!p) return { present: false };
  const kv = {};
  p.querySelectorAll('.drow').forEach((r) => {
    const k = r.getAttribute('data-k');
    const v = r.querySelector('.dv');
    if (k) kv[k] = v ? v.textContent : null;
  });
  const hist = [...p.querySelectorAll('.histrow')].map((r) => ({
    run: r.getAttribute('data-run'), role: r.getAttribute('data-role'),
    verdict: r.getAttribute('data-verdict'), runState: r.getAttribute('data-runstate'),
    crossFamily: r.getAttribute('data-xfam'),
    text: r.textContent.replace(/\\s+/g, ' ').trim()
  }));
  const pr = p.getBoundingClientRect();
  return {
    present: true,
    open: p.classList.contains('open'),
    headName: (p.querySelector('.panelhead h2') || {}).textContent || null,
    headRole: (p.querySelector('.panelhead .role') || {}).textContent || null,
    kv, hist, histCount: hist.length,
    panelBox: { left: Math.round(pr.left), right: Math.round(pr.right), width: Math.round(pr.width) }
  };
})()`;

const EXEC_CLICK_DIAG = `(() => {
  const e = window.__floorDebug.ents['rig:executor'];
  const c = document.querySelector('#cv');
  const r = c.getBoundingClientRect();
  const p = worldToScreen(e.x, e.y - 8);
  const x = Math.round(r.left + p.x), y = Math.round(r.top + p.y);
  const at = document.elementFromPoint(x, y);
  const chain = [];
  let el = at;
  while (el && chain.length < 5) { chain.push(el.id || (typeof el.className === 'string' && el.className) || el.tagName); el = el.parentElement; }
  return { x, y, atPoint: at ? (at.id || at.className || at.tagName) : null, chain,
           cardHidden: document.getElementById('floorRunCard').classList.contains('hidden') };
})()`;

/* ============================ PART A: floor-oc ============================ */

const ocErrors = [];
async function partFloorOc() {
  fs.rmSync(FLOOROC_DIR, { recursive: true, force: true });
  execSync(`cp -r ${JSON.stringify(FLOOROC_SRC)} ${JSON.stringify(FLOOROC_DIR)}`);
  fs.copyFileSync(path.join(FLOOROC_DIR, "data.example.json"), path.join(FLOOROC_DIR, "data.json"));
  floorocProc = spawn("node", ["server.js"], {
    cwd: FLOOROC_DIR, env: { ...process.env, FLOOR_PORT: String(FLOOROC_PORT) },
    stdio: ["ignore", "ignore", "pipe"]
  });
  await waitFor(async () => {
    const r = await fetch(FLOOROC_BASE + "/api/health").catch(() => null);
    return r && r.ok;
  }, 20000, "floor-oc server health");
  results.flooroc.server = `floor-oc server.js from four-hands-clone/tools/floor on :${FLOOROC_PORT}, data = data.example.json (2 placeholder agents, 1 unassigned task)`;

  const { proc, cdp, ws } = await startChrome(PROFILE + "-oc", CDP_PORT_OC, ocErrors);
  ocChrome = proc;
  interceptOrigin(cdp, `*127.0.0.1:${FLOOROC_PORT}*`, ["authorization", "content-type"]);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*127.0.0.1:${FLOOROC_PORT}*`, requestStage: "Request" }] });
  await cdp.send("Page.navigate", { url: FLOOROC_BASE + "/" });
  await waitFor(() => cdp.eval(`!!window.__floorDebug`), 25000, "floor-oc __floorDebug");
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.length === 2`), 20000, "floor-oc agents loaded");
  await sleep(6000);

  const meas = await cdp.eval(`(() => {
    const c = document.querySelector('canvas');
    const cam = window.__floorDebug.camera;
    const r = c ? c.getBoundingClientRect() : null;
    return {
      camS: cam.s, camMode: cam.mode,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      canvasBacking: c ? [c.width, c.height] : null,
      canvasCss: r ? [Math.round(r.width), Math.round(r.height)] : null,
      agents: window.__floorDebug.agents.map(a => a.name)
    };
  })()`);
  results.readability.flooroc = {
    ...meas, nameplateWorldPx: 9, characterWorldPx: 46,
    nameplateScreenPx: +(9 * meas.camS).toFixed(2),
    characterScreenPx: +(46 * meas.camS).toFixed(1)
  };
  note("floor-oc reference: room loaded, 2 example agents, overview camera measured",
    meas.agents.length === 2, `cam.s=${meas.camS} canvas=${J(meas.canvasBacking)} viewport=${meas.innerWidth}x${meas.innerHeight}`);

  const idleSize = await shot(cdp, "flooroc-idle.png", "REFERENCE (floor-oc, own server, example data): idle room, agents at desks, house frame");
  note("floor-oc idle screenshot captured", idleSize > 10000, `${idleSize} bytes`);

  const firstId = await cdp.eval(`window.__floorDebug.agents[0].id`);
  await cdp.eval(`window.__floorDebug.selectAgent(${J(firstId)})`);
  await sleep(3500);
  const focusMeas = await cdp.eval(`(() => { const cam = window.__floorDebug.camera; return { camS: cam.s, mode: cam.mode }; })()`);
  results.readability.floorocFocus = { ...focusMeas, nameplateScreenPx: +(9 * focusMeas.camS).toFixed(2), characterScreenPx: +(46 * focusMeas.camS).toFixed(1) };
  const focSize = await shot(cdp, "flooroc-focus-agent.png", "REFERENCE (floor-oc): focus view on the first agent — the reference analog of the Vokrew dossier shot");
  note("floor-oc focus screenshot captured", focSize > 10000, `cam.s=${focusMeas.camS}`);
  results.flooroc.consoleErrors = ocErrors;

  ws.close();
  proc.kill("SIGKILL");
  floorocProc.kill("SIGKILL"); floorocProc = null;
}

/* ===================== PART B: Vokrew conductor session ====================== */

async function partVokrew() {
  writeRigHome();
  /* CPU pinning (rig scheduling only — the G-9 contention fix for
     takes 3+: takes 1-2 lost the planner stage at exactly the
     bridge's 120s lane timeout while llama.cpp shared both vCPUs
     with Chromium's renderer + screencast). llama-server gets core 0
     to itself (-t 1); Chrome and the bridge are pinned to core 1.
     The page stays fully visible and live throughout — nothing is
     hidden, throttled page-side, or mocked. */
  llamaProc = spawn("taskset", ["-c", "0", LLAMA_BIN, "-m", MODEL, "--alias", "gemma-local", "-t", "1", "--host", "127.0.0.1", "--port", String(LLAMA_PORT)],
    { stdio: "ignore" });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/models`).catch(() => null);
    return r && r.ok;
  }, 60000, "llama-server models");
  results.rig.llama = `gemma-local on :${LLAMA_PORT}`;

  /* Lane warm-up DIRECT to llama-server (never through the bridge):
     loads the model so the recorded run starts warm, and the bridge
     ledger counts only the recorded session's own calls. */
  const warmT0 = Date.now();
  const warm = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gemma-local", messages: [{ role: "user", content: "Reply with the single word: ready" }], max_tokens: 8 })
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  results.rig.warmup = { ms: Date.now() - warmT0, ok: !warm.error && !!(warm.choices && warm.choices[0]), via: "direct llama-server completion (bridge untouched)" };
  note("lane warm-up completed directly against llama-server", results.rig.warmup.ok, `${results.rig.warmup.ms}ms`);

  bridge = startBridge();
  const code = await waitFor(() => {
    const m = /Pairing code: (\d{6})/.exec(bridge.out());
    return m && m[1];
  }, 20000, "bridge pairing code");
  results.rig.bridge = `registry build on :${BRIDGE_PORT}, VOKREW_HOME=${RIG_HOME}`;

  const { proc, cdp, ws } = await startChrome(PROFILE, CDP_PORT, results.consoleErrors);
  vokrewChrome = proc;
  interceptOrigin(cdp, `*127.0.0.1:${BRIDGE_PORT}*`, ["authorization", "content-type"]);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*127.0.0.1:${BRIDGE_PORT}*`, requestStage: "Request" }] });
  await cdp.send("Page.navigate", { url: PAGE_URL });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 15000, "locked before pairing");

  /* ---- screencast + entity-state corroboration log ---- */
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const frames = [];
  let screencastLive = false;
  cdp.on(async (m) => {
    if (m.method !== "Page.screencastFrame" || !screencastLive) return;
    const { data, metadata, sessionId } = m.params;
    const idx = frames.length;
    const file = `frame_${String(idx).padStart(5, "0")}.jpg`;
    fs.writeFileSync(path.join(FRAMES_DIR, file), Buffer.from(data, "base64"));
    frames.push({ idx, file, tsSec: metadata.timestamp, wallMs: Date.now() });
    try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch { /* stopping */ }
  });
  const stateLog = [];
  let logging = true;
  const logLoop = (async () => {
    while (logging) {
      try {
        const act = await cdp.eval(`window.__floorDebug.activity()`);
        stateLog.push({ wallMs: Date.now(), act });
      } catch { /* page busy */ }
      await sleep(1000);
    }
  })();

  /* Reduced-size screencast (1152x720 = the phone-spec encode size):
     the Phase 1 finding (G-9) — a full-size screencast eats a vCPU
     and pushes the 1B planner stage into the bridge's 120s timeout. */
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, everyNthFrame: 3, maxWidth: 1152, maxHeight: 720 });
  screencastLive = true;
  const castT0 = Date.now();
  results.video = { take: TAKE, screencastStartWallMs: castT0, task: TEXT_NAMED, framesDir: FRAMES_DIR };
  await sleep(1800); // beat: the locked room

  /* ---- pair through the page's own form (typed, as a user would) ---- */
  await cdp.eval(`(() => { const i = document.getElementById('bridgeUrl'); i.focus(); i.select(); })()`);
  await cdp.send("Input.insertText", { text: BRIDGE_BASE });
  await cdp.eval(`(() => { const i = document.getElementById('pairCode'); i.focus(); i.select(); })()`);
  await cdp.send("Input.insertText", { text: code });
  await sleep(600);
  await cdp.eval(`document.getElementById('pairBtn').click()`);
  await waitFor(() => cdp.eval(`document.getElementById('connectScreen').classList.contains('hidden')`), 25000, "door drops after pairing");
  token = await cdp.eval(`localStorage.getItem('vokrew.token')`);
  note("vokrew: paired through the page's own form", !!token);

  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "default crew seats");
  await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, "crew picker populated");
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew seated");
  await sleep(2500); // beat: the seated room

  const meas = await cdp.eval(`(() => {
    const c = document.querySelector('#screen-floor canvas');
    const r = c ? c.getBoundingClientRect() : null;
    let camS = null;
    try { camS = cam.s; } catch (e) { /* fall back below */ }
    return {
      camS,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      canvasBacking: c ? [c.width, c.height] : null,
      canvasCss: r ? [Math.round(r.width), Math.round(r.height)] : null,
      names: window.__floorDebug.agents.map(a => a.name)
    };
  })()`);
  const scale = meas.camS != null ? meas.camS
    : Math.min(meas.canvasBacking[0] / 2560, meas.canvasBacking[1] / 2000) * 0.94;
  results.readability.vokrew = {
    ...meas, effectiveScale: scale, nameplateWorldPx: 9, characterWorldPx: 46,
    nameplateScreenPx: +(9 * scale).toFixed(2), characterScreenPx: +(46 * scale).toFixed(1)
  };
  const focScale = results.readability.flooroc ? results.readability.flooroc.camS : null;
  note("vokrew: rig crew seated, overview scale measured (floor-oc parity band = within 5%)",
    meas.names.join(",") === "Scout,Musky,Judge" && (focScale ? Math.abs(scale - focScale) / focScale <= 0.05 : true),
    `scale=${scale} flooroc=${focScale} canvas=${J(meas.canvasBacking)} viewport=${meas.innerWidth}x${meas.innerHeight}`);

  const idleSize = await shot(cdp, "vokrew-idle.png", "VOKREW FLOOR: idle room, rig crew (Scout/Musky/Judge) seated, house frame — pairs with flooroc-idle.png");
  note("vokrew idle screenshot captured", idleSize > 10000, `${idleSize} bytes`);

  /* ---- conductor: type the named call-out (visible typing) ---- */
  await cdp.eval(`(() => { const i = document.getElementById('conductorInput'); i.focus(); i.scrollIntoView({ block: 'center' }); })()`);
  await sleep(500);
  for (const chunk of ["Scout, ", "write a one-line bash ", "command that prints ", "the word hello, then ", "explain it in one ", "short sentence"]) {
    await cdp.send("Input.insertText", { text: chunk });
    await sleep(420);
  }
  await sleep(700);
  await cdp.eval(`document.getElementById('conductorSend').click()`);
  const pHold = await waitFor(async () => {
    const p = await cdp.eval(CONDUCTOR_PROBE).catch(() => null);
    return p && p.state && p.state.holds && p.state.holds.length === 1 ? p : null;
  }, 20000, "hold created from the call-out");
  results.video.hold = { id: pHold.state.holds[0].id, badge: pHold.badge, sidebarCards: pHold.sidebarCards, nbCards: pHold.nbCards, nbHidden: pHold.nbHidden };
  note("conductor call-out became exactly one hold; badge + noticeboard agree",
    pHold.badge === "1" && pHold.sidebarCards === 1 && pHold.nbCards === 1 && pHold.nbHidden === false,
    `badge=${J(pHold.badge)} sidebar=${pHold.sidebarCards} noticeboard=${pHold.nbCards}`);
  await sleep(3000); // beat: the hold, on both surfaces
  const holdSize = await shot(cdp, "vokrew-hold-pending.png", "VOKREW FLOOR: hold pending — sidebar hold card + office noticeboard card + top-bar badge 1");
  note("vokrew hold-pending screenshot captured", holdSize > 10000, `${holdSize} bytes`);

  /* ---- approve the hold (the card's own Approve control) ---- */
  const holdId = pHold.state.holds[0].id;
  const doorstep = await cdp.eval(`(() => { const d = window.__floorDebug.allDoorsteps().find(x => x.id === 'c-w2'); return window.__floorDebug.cellOfPoint(d); })()`);
  results.video.doorstepCell = doorstep;
  const approved = await cdp.eval(`(() => {
    const root = document.getElementById('holdList');
    const cardEl = [...root.querySelectorAll('[data-hold]')].find((r) => r.getAttribute('data-hold') === ${J(holdId)});
    if (!cardEl) return false;
    const btn = cardEl.querySelector('[data-hold-action="approve"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  note("approve clicked on the hold card", approved);
  const started = await waitFor(async () => {
    const l = await bridgeGet("/runs?limit=5");
    return l.data.runs.find((r) => r.task === TEXT_NAMED && r.crew === "rig") || null;
  }, 30000, "approved run registered on the bridge");
  const runId = started.id;
  results.video.runId = runId;
  note("approved run registered on the bridge", !!runId, runId);

  /* ---- the run plays out ---- */
  let lastPhase = null, final = null, settledAt = null;
  let reviewerAtDoorAt = null, doorwayShotDone = false, stripMeasured = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 480000) {
    const { data } = await bridgeGet("/runs/" + runId);
    const rec = data.run;
    if (rec.phase !== lastPhase) {
      results.phases.push({ phase: rec.phase, state: rec.state, atSec: Math.round((Date.now() - t0) / 1000), stamps: rec.stamps.length });
      lastPhase = rec.phase;
    }
    if (!stripMeasured && (rec.phase === "executor" || rec.phase === "reviewer")) {
      stripMeasured = true;
      results.gaps.strip = await cdp.eval(CARD_STATE).catch(() => null);
    }
    const act = await cdp.eval(`window.__floorDebug.activity()`).catch(() => []);
    const rev = act.find((a) => a.agent === "rig:reviewer");
    if (rev && rev.cell && rev.cell.cx === doorstep.cx && rev.cell.cy === doorstep.cy) {
      if (!reviewerAtDoorAt) reviewerAtDoorAt = Date.now();
      if (!doorwayShotDone && rec.phase === "reviewer") {
        doorwayShotDone = true;
        const sz = await shot(cdp, "vokrew-midrun.png", "VOKREW FLOOR mid-run: Judge (reviewer) standing on Musky's doorstep cell during phase reviewer, run card docked as the slim strip");
        note("vokrew mid-run screenshot captured (reviewer at doorway)", sz > 10000, `doorstep=${J(doorstep)}`);
      }
    }
    if (rec.state !== "running" && !final) { final = rec; settledAt = Date.now(); }
    if (final) break;
    await sleep(400);
  }
  if (!final) throw new Error("approved run did not settle within 480s");
  results.video.finalRecord = { state: final.state, verdict: final.verdict, crossFamily: final.crossFamily, error: final.error || null, stamps: final.stamps };
  results.video.timeline = { runStartWallMs: t0, settledWallMs: settledAt, reviewerAtDoorstepWallMs: reviewerAtDoorAt, runDurationSec: Math.round((settledAt - t0) / 1000) };
  note("approved run settled done/APPROVED on the bridge", final.state === "done" && final.verdict === "APPROVED",
    `state=${final.state} verdict=${final.verdict} duration=${results.video.timeline.runDurationSec}s error=${final.error || "none"}`);
  if (final.state !== "done") throw new Error("TAKE FAILED: run settled " + final.state + " — " + (final.error || final.verdict || ""));
  note("reviewer reached the executor doorstep during the run", !!reviewerAtDoorAt);

  /* ---- settle beat: gap (a) probe BEFORE touching the card ---- */
  await sleep(2500);
  results.gaps.cardOcclusion = await cdp.eval(EXEC_CLICK_DIAG).catch(() => null);
  results.gaps.settledCard = await cdp.eval(CARD_STATE).catch(() => null);
  const diag = results.gaps.cardOcclusion;
  note("gap (a) measured: element at the executor's canvas click point in the settled layout",
    !!diag, diag ? `atPoint=${diag.atPoint} chain=${J(diag.chain)} cardHidden=${diag.cardHidden}` : "probe failed");
  const pSettled = await cdp.eval(CONDUCTOR_PROBE).catch(() => null);
  results.video.settledTranscript = pSettled ? pSettled.rows : null;
  const verdictRow = pSettled && pSettled.rows.find((r) => r.kind === "verdict" && r.run === runId);
  note("verdict landed in the conductor transcript, tied to the run id",
    !!verdictRow && verdictRow.verdict === "APPROVED", verdictRow ? verdictRow.text.slice(0, 120) : "row missing");
  await cdp.eval(`(() => { const l = document.getElementById('conductorLog'); if (l) l.scrollTop = l.scrollHeight; })()`);
  await sleep(600);
  const settledSize = await shot(cdp, "vokrew-settled.png", "VOKREW FLOOR: run settled — verdict in the conductor transcript + auto-expanded run card over the room (gap (a) in frame)");
  note("vokrew settled screenshot captured", settledSize > 10000, `${settledSize} bytes`);

  /* ---- close the card (its own button), click Judge in the room ---- */
  await cdp.eval(`(() => { const b = document.getElementById('floorCardClose'); if (b) b.click(); })()`);
  await sleep(800);
  const pointOf = () => cdp.eval(`(() => {
    const e = window.__floorDebug.ents['rig:reviewer'];
    if (!e) return null;
    const c = document.querySelector('#cv');
    const r = c.getBoundingClientRect();
    const p = worldToScreen(e.x, e.y - 8);
    return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
  })()`);
  let pt = await pointOf();
  const ptT0 = Date.now();
  while (Date.now() - ptT0 < 6000) {
    await sleep(350);
    const next = await pointOf();
    if (!next) break;
    const still = pt && Math.abs(next.x - pt.x) < 2 && Math.abs(next.y - pt.y) < 2;
    pt = next;
    if (still) break;
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  const panelJudge = await waitFor(async () => {
    const p = await cdp.eval(PANEL).catch(() => null);
    return p && p.open && p.headName === "Judge" ? p : null;
  }, 15000, "reviewer dossier opens on canvas click");
  results.video.dossier = { headName: panelJudge.headName, headRole: panelJudge.headRole, kv: panelJudge.kv, histCount: panelJudge.histCount, hist: panelJudge.hist, panelBox: panelJudge.panelBox };
  const histRow = panelJudge.hist.find((h) => h.run === runId);
  note("reviewer dossier shows the just-settled run in its history, verdict + same-family label intact",
    !!histRow && histRow.verdict === "APPROVED" && histRow.crossFamily === "no",
    histRow ? histRow.text.slice(0, 140) : "row missing");
  await sleep(3200); // beat: the dossier
  const dosSize = await shot(cdp, "vokrew-dossier.png", "VOKREW FLOOR: Judge's dossier after the run — identity from the bridge + this run's history row — pairs with flooroc-focus-agent.png");
  note("vokrew dossier screenshot captured", dosSize > 10000, `${dosSize} bytes`);
  await sleep(2000); // tail beat

  /* ---- stop, corroborate, classify ---- */
  screencastLive = false;
  try { await cdp.send("Page.stopScreencast"); } catch { /* already stopped */ }
  logging = false;
  await logLoop.catch(() => {});
  results.video.frameCount = frames.length;
  results.video.framesDir = FRAMES_DIR;
  fs.writeFileSync(path.join(HERE, "frames.json"), JSON.stringify({ runId, take: TAKE, castT0, framesDir: FRAMES_DIR, frames }, null, 2));
  fs.writeFileSync(path.join(HERE, "run-state-log.json"), JSON.stringify({ runId, take: TAKE, doorstep, entries: stateLog }, null, 2));
  let concat = "";
  for (let i = 0; i < frames.length; i++) {
    const next = frames[i + 1];
    const dur = next ? Math.max(0.01, next.tsSec - frames[i].tsSec) : 0.6;
    concat += `file '${FRAMES_DIR}/${frames[i].file}'\nduration ${dur.toFixed(3)}\n`;
  }
  if (frames.length) concat += `file '${FRAMES_DIR}/${frames[frames.length - 1].file}'\n`;
  fs.writeFileSync(path.join(HERE, "frames-concat.txt"), concat);
  results.video.totalSec = frames.length ? +(frames[frames.length - 1].tsSec - frames[0].tsSec).toFixed(1) : 0;
  note("screencast frames captured", frames.length > 100, `${frames.length} frames over ~${results.video.totalSec}s; state log entries=${stateLog.length}`);

  const revHits = stateLog.filter((e) => {
    const r = e.act.find((a) => a.agent === "rig:reviewer");
    return r && r.cell && r.cell.cx === doorstep.cx && r.cell.cy === doorstep.cy;
  }).length;
  const planWork = stateLog.some((e) => { const p = e.act.find((a) => a.agent === "rig:planner"); return p && p.mode === "work"; });
  const execWork = stateLog.some((e) => { const x = e.act.find((a) => a.agent === "rig:executor"); return x && x.mode === "work"; });
  results.video.corroboration = { reviewerDoorstepLogEntries: revHits, plannerWorkModeSeen: planWork, executorWorkModeSeen: execWork };
  note("state log corroborates: planner + executor work modes seen", planWork && execWork);
  note("state log corroborates: reviewer on doorstep cell in logged entries", revHits > 0, `${revHits} entries`);

  const logEntries = results.consoleErrors.filter((e) => e.startsWith("log:"));
  const nonLog = results.consoleErrors.filter((e) => !e.startsWith("log:"));
  const noise = logEntries.filter((e) => e.includes("net::ERR_FAILED") && e.includes(`127.0.0.1:${BRIDGE_PORT}`));
  const unexplained = logEntries.filter((e) => !noise.includes(e));
  results.consoleClassification = { total: results.consoleErrors.length, nonLog: nonLog.length, transportNoise: noise.length, unexplained };
  note("zero console errors in the Vokrew session (transport noise tallied + named)",
    nonLog.length === 0 && unexplained.length === 0,
    `nonLog=${nonLog.length} noise=${noise.length} unexplained=${unexplained.slice(0, 2).join(" | ") || "none"}`);

  ws.close();
  proc.kill("SIGKILL");
}

try {
  if (!SKIP_OC) await partFloorOc();
  await partVokrew();
} catch (e) {
  note("capture harness completed without error", false, e.message);
  results.takeFailed = String(e.message || e);
} finally {
  for (const p of [llamaProc, bridge && bridge.proc, floorocProc, vokrewChrome, ocChrome]) {
    try { if (p) p.kill("SIGKILL"); } catch { /* already gone */ }
  }
  const missed = results.assertions.filter((a) => !a.ok);
  results.verdict = results.takeFailed
    ? `TAKE ${TAKE} FAILED — ${results.takeFailed}`
    : missed.length === 0
      ? `PHASE 2 STAGE 4 CAPTURE (take ${TAKE}): COMPLETE`
      : `PHASE 2 STAGE 4 CAPTURE (take ${TAKE}): COMPLETE WITH ${missed.length} MISS(ES)`;
  fs.writeFileSync(path.join(HERE, `results-take${TAKE}.json`), JSON.stringify(results, null, 2));
  if (!results.takeFailed) fs.writeFileSync(path.join(HERE, "results.json"), JSON.stringify(results, null, 2));
  // takes ledger — every take on the record, pass or fail
  const takesPath = path.join(HERE, "takes.json");
  const takes = fs.existsSync(takesPath) ? JSON.parse(fs.readFileSync(takesPath, "utf8")) : [];
  takes.push({
    take: TAKE, at: new Date().toISOString(),
    outcome: results.takeFailed ? "failed" : "complete",
    detail: results.takeFailed || results.verdict,
    runId: results.video && results.video.runId || null,
    runOutcome: results.video && results.video.finalRecord
      ? `${results.video.finalRecord.state}/${results.video.finalRecord.verdict || results.video.finalRecord.error || ""}` : null
  });
  fs.writeFileSync(takesPath, JSON.stringify(takes, null, 2));
  console.log("\n" + results.verdict);
  if (results.takeFailed) process.exitCode = 2;
}
