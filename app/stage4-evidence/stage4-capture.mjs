#!/usr/bin/env node
/*
 * Stage 4 capture harness — PHASE1-FLOOR-SPEC.md §6, Stage 4 LOOK GATE.
 *
 * This stage builds NO features. It produces the evidence Kevin judges:
 *   A. floor-oc reference captures (the original room, running against
 *      its OWN server booted from the Four Hands clone source with the
 *      scrubbed data.example.json — 2 placeholder agents, 1 task).
 *   B. Vokrew Floor captures at the SAME viewport (1440x900): idle with
 *      the rig crew seated, a focus view of one agent, and a mid-run
 *      frame with the reviewer standing on the executor's doorstep.
 *   C. A CDP screencast VIDEO of one complete real run (planner works
 *      -> executor works -> reviewer walks to the executor's doorway,
 *      waits, walks back -> verdict lands) plus an entity-state log
 *      polled from the page + bridge that corroborates every key
 *      moment from state, not pixels.
 *
 * Serving mechanisms (same findings as Stages 1-3): this VM's Chromium
 * hard-blocks CDP navigations to http://127.0.0.1 (LNA checks). Both
 * pages are therefore loaded through CDP Fetch interception: floor-oc
 * keeps its real http://127.0.0.1:13201 origin with every request
 * (document included) fulfilled by Node fetch against the untouched
 * real server; the Vokrew page loads over file:// with only the bridge
 * origin intercepted (Stage 2/3 mechanism). No server code is modified
 * on either side.
 *
 * Run:  xvfb-run -a node stage4-capture.mjs
 * Evidence lands in this directory (+ frames/ for the screencast).
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
const FLOOROC_DIR = "/tmp/floor-oc-s4";
const FLOOROC_PORT = 13201;
const FLOOROC_BASE = `http://127.0.0.1:${FLOOROC_PORT}`;
const CHROME = process.env.CHROME || "/opt/meta-chromium/chrome";
const LLAMA_PORT = 18080;
const BRIDGE_PORT = 17717;
const CDP_PORT = 9336;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const RIG_HOME = "/tmp/vokrew-s4-eval-home";
const PROFILE = "/tmp/floor-s4-eval-profile";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const FRAMES_DIR = path.join(HERE, "frames");
const TASK = "Write a one-line bash command that prints the current folder path, then explain it in one short sentence.";

const SKIP_A = process.env.STAGE4_SKIP_A === "1";
const results = {
  assertions: [], consoleErrors: [], screenshots: [], rig: {},
  readability: {}, flooroc: {}, video: {}, phases: []
};
if (SKIP_A && fs.existsSync(path.join(HERE, "results.json"))) {
  const prior = JSON.parse(fs.readFileSync(path.join(HERE, "results.json"), "utf8"));
  results.flooroc = prior.flooroc || {};
  results.readability.flooroc = (prior.readability || {}).flooroc;
  results.readability.floorocFocus = (prior.readability || {}).floorocFocus;
  results.screenshots = (prior.screenshots || []).filter((s) => s.file.startsWith("flooroc-"));
  results.assertions = (prior.assertions || []).filter((a) => a.name.startsWith("floor-oc"));
  console.log("STAGE4_SKIP_A=1: reusing prior floor-oc captures + measurements");
}
function note(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "OK  " : "MISS"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- tiny CDP client (same shape as Stages 1-3) ---------------- */

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

async function startChrome(profile) {
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server",
    `--remote-debugging-port=${CDP_PORT}`, "--window-size=1440,900",
    `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: "ignore", env: chromeEnvClean() });
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
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  return { proc, cdp, ws };
}

/* Fulfill every request to `origin` from Node fetch against the real
   server listening there (document included). */
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

/* ---------------- rig: llama-server + real bridge (Stages 2-3 rig) -------- */

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

let llamaProc = null, bridge = null, floorocProc = null, token = null;
const authH = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
async function bridgeGet(p) {
  const r = await fetch(BRIDGE_BASE + p, { headers: authH() });
  return { status: r.status, data: await r.json().catch(() => null) };
}

/* ============================ PART A: floor-oc ============================ */

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

  const { proc, cdp, ws } = await startChrome(PROFILE + "-oc");
  interceptOrigin(cdp, `*127.0.0.1:${FLOOROC_PORT}*`, ["authorization", "content-type"]);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*127.0.0.1:${FLOOROC_PORT}*`, requestStage: "Request" }] });
  await cdp.send("Page.navigate", { url: FLOOROC_BASE + "/" });
  await waitFor(() => cdp.eval(`!!window.__floorDebug`), 25000, "floor-oc __floorDebug");
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.length === 2`), 20000, "floor-oc agents loaded");
  await sleep(6000); // settle: static layer painted, agents at desks, fountain running

  const meas = await cdp.eval(`(() => {
    const c = document.querySelector('canvas');
    const cam = window.__floorDebug.camera;
    const r = c ? c.getBoundingClientRect() : null;
    return {
      camS: cam.s, camMode: cam.mode,
      canvasBacking: c ? [c.width, c.height] : null,
      canvasCss: r ? [Math.round(r.width), Math.round(r.height)] : null,
      agents: window.__floorDebug.agents.map(a => a.name)
    };
  })()`);
  results.readability.flooroc = {
    ...meas,
    nameplateWorldPx: 9, characterWorldPx: 46,
    nameplateScreenPx: +(9 * meas.camS).toFixed(2),
    characterScreenPx: +(46 * meas.camS).toFixed(1)
  };
  note("floor-oc reference: room loaded, 2 example agents, overview camera measured",
    meas.agents.length === 2, `cam.s=${meas.camS} canvas=${JSON.stringify(meas.canvasBacking)}`);

  const idleSize = await shot(cdp, "flooroc-idle.png", "REFERENCE (floor-oc, own server, example data): idle room, agents at desks, 1440x900 overview");
  note("floor-oc idle screenshot captured", idleSize > 10000, `${idleSize} bytes`);

  // Focus view of an agent (selectAgent drives the shared engine's focus camera)
  const firstId = await cdp.eval(`window.__floorDebug.agents[0].id`);
  await cdp.eval(`window.__floorDebug.selectAgent(${JSON.stringify(firstId)})`);
  await sleep(3500);
  const focusMeas = await cdp.eval(`(() => { const cam = window.__floorDebug.camera; return { camS: cam.s, mode: cam.mode }; })()`);
  results.readability.floorocFocus = { ...focusMeas, nameplateScreenPx: +(9 * focusMeas.camS).toFixed(2), characterScreenPx: +(46 * focusMeas.camS).toFixed(1) };
  const focSize = await shot(cdp, "flooroc-focus-agent.png", "REFERENCE (floor-oc): focus view on the first agent — character + nameplate at focus zoom");
  note("floor-oc focus screenshot captured", focSize > 10000, `cam.s=${focusMeas.camS}`);
  await cdp.eval(`window.__floorDebug.setView('overview')`);
  await sleep(2500);

  // Active moment: floor-oc's sim walks agents on breaks (nextBreakAt
  // 55-185s). Watch entity state for real movement; capture the first
  // sustained walk. This is ambient sim motion — the same engine
  // behavior Kevin approved — not a dispatched run: with the scrubbed
  // example data and no Ollama on this VM, floor-oc cannot execute a
  // brain run here, and the report says so plainly.
  let basePos = await cdp.eval(`window.__floorDebug.activity().map(a => ({ agent: a.agent, x: a.x, y: a.y, mode: a.mode }))`);
  let moved = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000 && !moved) {
    await sleep(1000);
    const act = await cdp.eval(`window.__floorDebug.activity()`);
    for (let i = 0; i < act.length; i++) {
      const dx = act[i].x - basePos[i].x, dy = act[i].y - basePos[i].y;
      if (act[i].tween || Math.hypot(dx, dy) > 60) { moved = { agent: act[i].agent, mode: act[i].mode, activity: act[i].activity, dx, dy }; break; }
    }
  }
  if (moved) {
    await sleep(1200);
    const actSize = await shot(cdp, "flooroc-active.png", "REFERENCE (floor-oc): ambient sim motion — an agent walking (break route) caught from entity state");
    note("floor-oc active screenshot captured (agent walking)", actSize > 10000, JSON.stringify(moved));
    results.flooroc.activeMoment = { kind: "ambient break walk (entity tween/position change)", ...moved };
  } else {
    const actSize = await shot(cdp, "flooroc-active.png", "REFERENCE (floor-oc): no ambient walk observed in 240s; settled room frame");
    note("floor-oc active screenshot captured (no walk observed in window)", actSize > 10000, "no entity moved >60 world px in 240s");
    results.flooroc.activeMoment = { kind: "none observed in 240s window" };
  }

  ws.close();
  proc.kill("SIGKILL");
  floorocProc.kill("SIGKILL"); floorocProc = null;
}

/* ===================== PART B: Vokrew Floor + video ====================== */

async function partVokrew() {
  writeRigHome();
  llamaProc = spawn(LLAMA_BIN, ["-m", MODEL, "--alias", "gemma-local", "--host", "127.0.0.1", "--port", String(LLAMA_PORT)],
    { stdio: "ignore" });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/models`).catch(() => null);
    return r && r.ok;
  }, 60000, "llama-server models");
  results.rig.llama = `gemma-local on :${LLAMA_PORT}`;

  bridge = startBridge();
  const code = await waitFor(() => {
    const m = /Pairing code: (\d{6})/.exec(bridge.out());
    return m && m[1];
  }, 20000, "bridge pairing code");
  results.rig.bridge = `registry build on :${BRIDGE_PORT}`;

  const { proc, cdp, ws } = await startChrome(PROFILE);
  interceptOrigin(cdp, `*127.0.0.1:${BRIDGE_PORT}*`, ["authorization", "content-type"]);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*127.0.0.1:${BRIDGE_PORT}*`, requestStage: "Request" }] });
  await cdp.send("Page.navigate", { url: PAGE_URL });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 15000, "locked before pairing");

  await cdp.eval(`(() => {
    document.getElementById('bridgeUrl').value = ${JSON.stringify(BRIDGE_BASE)};
    document.getElementById('pairCode').value = ${JSON.stringify(code)};
  })()`);
  await cdp.eval(`document.getElementById('pairBtn').click()`);
  await waitFor(() => cdp.eval(`document.getElementById('connectScreen').classList.contains('hidden')`), 25000, "door drops after pairing");
  token = await cdp.eval(`localStorage.getItem('vokrew.token')`);
  note("vokrew: paired through the page's own form", !!token);

  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "default crew seats");
  await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, "crew picker populated");
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew seated");
  await sleep(2500);

  /* Lane warm-up: the first recorded attempt failed at the planner
     stage after exactly 120s with zero stamps — the bridge's lane
     timeout hit while the cold llama.cpp process was still loading
     the model + generating (Stage 2's warm planner took 76s). One
     small real chat completion through the bridge loads the model so
     the RECORDED run starts warm, exactly as a user's rig would be
     after any first use. The recorded run itself is untouched. */
  const warmT0 = Date.now();
  const warm = await fetch(BRIDGE_BASE + "/chat", {
    method: "POST", headers: authH(),
    body: JSON.stringify({ message: "Reply with the single word: ready", surface: "chat" })
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  results.rig.warmup = { ms: Date.now() - warmT0, ok: !warm.error && warm.ok === true, detail: warm.error || (warm.text ? String(warm.text).slice(0, 40) : JSON.stringify(warm).slice(0, 120)) };
  note("lane warm-up chat completed through the bridge", results.rig.warmup.ok, `${results.rig.warmup.ms}ms`);

  const meas = await cdp.eval(`(() => {
    const c = document.querySelector('#screen-floor canvas');
    const r = c ? c.getBoundingClientRect() : null;
    let camS = null, bw = null, bh = null;
    try { camS = cam.s; } catch (e) { /* fall back to fitScale inputs below */ }
    try { bw = W; bh = H; } catch (e) { /* globals not exposed under those names */ }
    return {
      camS, W: bw, H: bh,
      canvasBacking: c ? [c.width, c.height] : null,
      canvasCss: r ? [Math.round(r.width), Math.round(r.height)] : null,
      names: window.__floorDebug.agents.map(a => a.name)
    };
  })()`);
  const scale = meas.camS != null ? meas.camS
    : Math.min(meas.canvasBacking[0] / 2560, meas.canvasBacking[1] / 2000) * 0.94;
  results.readability.vokrew = {
    ...meas, effectiveScale: scale,
    nameplateWorldPx: 9, characterWorldPx: 46,
    nameplateScreenPx: +(9 * scale).toFixed(2),
    characterScreenPx: +(46 * scale).toFixed(1)
  };
  note("vokrew: rig crew seated, overview scale measured",
    meas.names.join(",") === "Scout,Musky,Judge", `scale=${scale} canvas=${JSON.stringify(meas.canvasBacking)}`);

  const idleSize = await shot(cdp, "vokrew-idle.png", "VOKREW FLOOR: idle room, rig crew (Scout/Musky/Judge) seated, 1440x900 overview — pairs with flooroc-idle.png");
  note("vokrew idle screenshot captured", idleSize > 10000, `${idleSize} bytes`);

  await cdp.eval(`window.__floorDebug.selectAgent('rig:executor')`);
  await sleep(3500);
  const focS = await cdp.eval(`(() => { try { return cam.s; } catch (e) { return null; } })()`);
  results.readability.vokrewFocus = { camS: focS, nameplateScreenPx: focS ? +(9 * focS).toFixed(2) : null, characterScreenPx: focS ? +(46 * focS).toFixed(1) : null };
  const vfSize = await shot(cdp, "vokrew-focus-agent.png", "VOKREW FLOOR: focus view on Musky (executor) — character + nameplate at focus zoom");
  note("vokrew focus screenshot captured", vfSize > 10000, `cam.s=${focS}`);
  await cdp.eval(`window.__floorDebug.setView('overview')`);
  await sleep(2500);

  /* ---- the recorded run ---- */
  const doorstep = await cdp.eval(`(() => { const d = window.__floorDebug.allDoorsteps().find(x => x.id === 'c-w2'); return window.__floorDebug.cellOfPoint(d); })()`);
  results.video.doorstepCell = doorstep;

  /* The run card auto-opens on submit and OCCLUDES the room for the
     whole run (attempt 2 finding, preserved in attempt2-* evidence and
     logged as a gap in LOOK-GATE.md). For the look-gate video the
     room must be visible, so — exactly as a user who wants to watch
     the room would — the harness closes the card via its own Close
     button and scrolls the room into view BEFORE the screencast
     starts. No entity state is touched; the adapter keeps tracking
     the run (status line + quest log stay live in frame). */
  results.video.cardHandling = "run card closed via its own Close button after submit; room scrolled into view before screencast start";

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

  // Entity-state corroboration log: page activity + bridge record, 400ms.
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

  /* Screencast at the DELIVERABLE's resolution and half frame rate:
     attempts 1-4 recorded at 1440x900/every-frame and every one raced
     the bridge's 120s lane timeout on the planner stage (112s pass,
     3x ~120s fail) while every non-screencast run of the same task on
     this rig finished its planner in 54-77s — the full-size capture
     was eating one of this VM's 2 vCPUs. 1152x720 is the phone-spec
     encode size anyway, so nothing the gate judges is lost. */
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 2, maxWidth: 1152, maxHeight: 720 });
  screencastLive = true;
  const castT0 = Date.now();
  results.video.screencastStartWallMs = castT0;
  await sleep(1500); // a breath of idle room at the head of the video

  /* The recorded run uses a deliberately small task: on this 2-vCPU VM
     the canonical pwd task's planner stage takes 69-125s against the
     bridge's fixed 120s lane timeout (attempts 1+3 died at ~120s with
     zero stamps; attempt 2 landed at 111.9s; the phone pass's planner
     took 69s — pure VM variance). A small task keeps every stage far
     from the timeout so the VIDEO captures the room's behavior, not
     the VM's noise. Disclosed in LOOK-GATE.md. */
  const VIDEO_TASK = "Write a one-line bash command that prints the word hello, then explain it in one short sentence.";
  results.video.task = VIDEO_TASK;
  await cdp.eval(`(() => { document.getElementById('floorRunTask').value = ${JSON.stringify(VIDEO_TASK)}; })()`);
  await cdp.eval(`document.getElementById('floorRunBtn').click()`);
  const started = await waitFor(async () => {
    const l = await bridgeGet("/runs?limit=5");
    return l.data.runs.find((r) => r.task === VIDEO_TASK && r.crew === "rig") || null;
  }, 20000, "run registered on the bridge");
  const runId = started.id;
  results.video.runId = runId;
  note("video run registered on the bridge", !!runId, runId);

  // Close the auto-opened run card and frame the room (see above).
  await cdp.eval(`(() => { const c = document.getElementById('floorCardClose'); if (c) c.click(); const r = document.getElementById('floorRoot'); if (r) r.scrollIntoView({ block: 'start' }); })()`);
  await sleep(1200);
  const cardState = await cdp.eval(`(() => { const card = document.getElementById('floorRunCard'); return { cardHidden: !!card && card.classList.contains('hidden') }; })()`);
  note("run card closed for the recording; room framed", cardState.cardHidden, JSON.stringify(cardState));

  let lastPhase = null;
  let final = null;
  let reviewerAtDoorAt = null, doorwayShotDone = false, settledAt = null, reviewerHomeAt = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 420000) {
    const { data } = await bridgeGet("/runs/" + runId);
    const rec = data.run;
    if (rec.phase !== lastPhase) {
      results.phases.push({ phase: rec.phase, state: rec.state, atSec: Math.round((Date.now() - t0) / 1000), stamps: rec.stamps.length });
      lastPhase = rec.phase;
    }
    const act = await cdp.eval(`window.__floorDebug.activity()`).catch(() => []);
    const rev = act.find((a) => a.agent === "rig:reviewer");
    if (rev && rev.cell) {
      if (rev.cell.cx === doorstep.cx && rev.cell.cy === doorstep.cy) {
        if (!reviewerAtDoorAt) reviewerAtDoorAt = Date.now();
        if (!doorwayShotDone && rec.phase === "reviewer") {
          doorwayShotDone = true;
          await cdp.eval(`(() => { const c = document.getElementById('floorCardClose'); if (c) c.click(); const r = document.getElementById('floorRoot'); if (r) r.scrollIntoView({ block: 'start' }); })()`);
          await sleep(700);
          const sz = await shot(cdp, "vokrew-midrun.png", "VOKREW FLOOR mid-run: Judge (reviewer) standing on Musky's doorstep cell during phase reviewer — pairs with flooroc-active.png");
          note("vokrew mid-run screenshot captured (reviewer at doorway)", sz > 10000, `doorstep=${JSON.stringify(doorstep)}`);
        }
      }
      // reviewer back home = cell inside its own c-sw cubicle
      if (settledAt && !reviewerHomeAt && rev.cell.cx >= 9 && rev.cell.cx <= 22 && rev.cell.cy >= 59 && rev.cell.cy <= 67) {
        reviewerHomeAt = Date.now();
      }
    }
    if (rec.state !== "running" && !final) { final = rec; settledAt = Date.now(); }
    if (final && reviewerHomeAt) break;
    if (final && Date.now() - settledAt > 45000) break; // walk-back grace expired
    await sleep(400);
  }
  if (!final) throw new Error("video run did not settle within 420s");
  results.video.finalRecord = { state: final.state, verdict: final.verdict, crossFamily: final.crossFamily, error: final.error || null, stamps: final.stamps };
  results.video.timeline = {
    runStartWallMs: t0, settledWallMs: settledAt,
    reviewerAtDoorstepWallMs: reviewerAtDoorAt,
    reviewerHomeWallMs: reviewerHomeAt,
    runDurationSec: Math.round((settledAt - t0) / 1000)
  };
  note("video run settled on the bridge", final.state === "done", `verdict=${final.verdict} duration=${results.video.timeline.runDurationSec}s`);
  note("reviewer reached the executor doorstep during the recorded run", !!reviewerAtDoorAt);
  note("reviewer walked back to its own cubicle after the verdict", !!reviewerHomeAt,
    reviewerHomeAt ? `home at +${Math.round((reviewerHomeAt - t0) / 1000)}s` : "not observed within 45s grace");

  await sleep(3000); // tail: verdict resting in the room
  screencastLive = false;
  try { await cdp.send("Page.stopScreencast"); } catch { /* already stopped */ }
  logging = false;
  await logLoop.catch(() => {});
  results.video.frameCount = frames.length;
  results.video.frames = { first: frames[0] || null, last: frames[frames.length - 1] || null };
  fs.writeFileSync(path.join(HERE, "frames.json"), JSON.stringify({ runId, castT0, frames }, null, 2));
  fs.writeFileSync(path.join(HERE, "run-state-log.json"), JSON.stringify({ runId, doorstep, entries: stateLog }, null, 2));
  note("screencast frames captured", frames.length > 100, `${frames.length} frames; state log entries=${stateLog.length}`);

  // Corroboration from the state log itself: reviewer cell == doorstep
  // cell in at least one logged entry, and planner/executor work modes
  // appear during their phases.
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
  const noise = logEntries.filter((e) =>
    (e.includes("net::ERR_FAILED") && (e.includes(`127.0.0.1:${BRIDGE_PORT}`) || e.includes(`127.0.0.1:${FLOOROC_PORT}`))));
  // floor-oc's own rig panel polls /api/ollama/* on ITS server, which
  // proxies to an Ollama that does not exist on this VM -> 502s in the
  // Log domain during the REFERENCE capture only. Named, tallied, and
  // reported in LOOK-GATE.md — not part of the Vokrew page's behavior.
  const floorocRigPoll = logEntries.filter((e) => e.includes("/api/ollama") && e.includes(`127.0.0.1:${FLOOROC_PORT}`));
  const unexplained = logEntries.filter((e) => !noise.includes(e) && !floorocRigPoll.includes(e));
  results.consoleClassification = { total: results.consoleErrors.length, nonLog: nonLog.length, transportNoise: noise.length, floorocRigPoll: floorocRigPoll.length, unexplained };
  note("zero console errors across all captures (JS/console.error zero-tolerance; tallied transport noise + floor-oc rig polls named)",
    nonLog.length === 0 && unexplained.length === 0,
    `nonLog=${nonLog.length} noise=${noise.length} floorocRigPoll=${floorocRigPoll.length} unexplained=${unexplained.slice(0, 2).join(" | ") || "none"}`);

  ws.close();
  proc.kill("SIGKILL");
}

try {
  if (!SKIP_A) await partFloorOc();
  await partVokrew();
} catch (e) {
  note("capture harness completed without error", false, e.message);
} finally {
  for (const p of [llamaProc, bridge && bridge.proc, floorocProc]) {
    try { if (p) p.kill("SIGKILL"); } catch { /* already gone */ }
  }
  const missed = results.assertions.filter((a) => !a.ok);
  results.verdict = missed.length === 0
    ? "STAGE 4 CAPTURE: COMPLETE (all captures + corroboration collected)"
    : `STAGE 4 CAPTURE: COMPLETE WITH ${missed.length} MISS(ES) — see assertions`;
  fs.writeFileSync(path.join(HERE, "results.json"), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict);
}
