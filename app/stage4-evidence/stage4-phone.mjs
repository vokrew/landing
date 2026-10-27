#!/usr/bin/env node
/*
 * Stage 4 phone pass — PHASE1-FLOOR-SPEC.md §6 Stage 4 + §7 risk 3.
 *
 * Renders the Vokrew Floor screen at a Galaxy S26-class viewport
 * (412x915 CSS px, deviceScaleFactor 2.6, mobile + touch emulation) in
 * real Chromium under xvfb, against the same real rig as Stages 2-4
 * (llama.cpp Gemma 3 1B lane + real bridge, file:// page, bridge-origin
 * Fetch interception — see stage4-capture.mjs header).
 *
 * Captures: locked / idle / mid-run. Probes: rAF frame times idle and
 * during a run, horizontal-overflow audit, panel reachability, the
 * engine's small-screen DPR cap (spec §7: min(1.5, DPR) under 720px),
 * and the Floor screen's page weight vs the spec's 160 KB ceiling.
 * This pass DOCUMENTS phone behavior; it fixes nothing.
 *
 * Run AFTER stage4-capture.mjs (same rig ports).
 *   xvfb-run -a node stage4-phone.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
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
const CDP_PORT = 9337;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const RIG_HOME = "/tmp/vokrew-s4p-home";
const PROFILE = "/tmp/floor-s4p-profile";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const TASK = "Write a one-line bash command that prints the current folder path, then explain it in one short sentence.";
const VIEW = { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true };

const results = { assertions: [], consoleErrors: [], screenshots: [], rig: {}, phone: {}, phases: [] };
function note(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "OK  " : "MISS"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

let llamaProc = null, bridge = null, chromeProc = null, token = null;
const authH = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
async function bridgeGet(p) {
  const r = await fetch(BRIDGE_BASE + p, { headers: authH() });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function shot(cdp, file, noteText) {
  const p = path.join(HERE, file);
  const s = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(p, Buffer.from(s.data, "base64"));
  results.screenshots.push({ file, note: noteText });
  return fs.statSync(p).size;
}

const FRAME_PROBE_START = `(() => {
  window.__ft = { deltas: [], last: 0, on: true };
  function loop(t) {
    if (!window.__ft || !window.__ft.on) return;
    if (window.__ft.last) window.__ft.deltas.push(t - window.__ft.last);
    window.__ft.last = t;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  return true;
})()`;
const FRAME_PROBE_STOP = `(() => {
  if (!window.__ft) return null;
  window.__ft.on = false;
  const d = window.__ft.deltas.slice(2); // drop warm-up
  if (!d.length) return { n: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  return {
    n: d.length, avgMs: +avg.toFixed(2), avgFps: +(1000 / avg).toFixed(1),
    p50Ms: +q(0.5).toFixed(2), p95Ms: +q(0.95).toFixed(2), p99Ms: +q(0.99).toFixed(2),
    maxMs: +sorted[sorted.length - 1].toFixed(2),
    over33: d.filter((x) => x > 33).length, over50: d.filter((x) => x > 50).length
  };
})()`;

const OVERFLOW_AUDIT = `(() => {
  const iw = window.innerWidth;
  const wide = [];
  for (const e of document.querySelectorAll('#appShell *')) {
    const r = e.getBoundingClientRect();
    if (r.width && r.right > iw + 1) wide.push((e.id || e.className || e.tagName) + ' right=' + Math.round(r.right));
    if (wide.length >= 10) break;
  }
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }; };
  const c = document.querySelector('#screen-floor canvas');
  const cr = c ? c.getBoundingClientRect() : null;
  return {
    innerWidth: iw, innerHeight: window.innerHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    wideElements: wide,
    canvasCss: cr ? [Math.round(cr.width), Math.round(cr.height)] : null,
    canvasBacking: c ? [c.width, c.height] : null,
    canvasDprRatio: c && cr && cr.width ? +(c.width / cr.width).toFixed(2) : null,
    roster: box('#roster'), tasklist: box('#tasklist'),
    runForm: box('#floorRunTask'), focus: box('#focus')
  };
})()`;

try {
  /* ---- page weight (spec §6 Stage 4: Floor screen <= 160 KB) ---- */
  const weight = {};
  let floorTotal = 0, shellTotal = 0;
  for (const f of ["index.html", "app.css", "app.js", "floor.css", "floor.js", "floor-adapter.js"]) {
    const buf = fs.readFileSync(path.join(APP_DIR, f));
    weight[f] = { bytes: buf.length, gzipBytes: zlib.gzipSync(buf).length };
  }
  floorTotal = weight["floor.js"].bytes + weight["floor.css"].bytes + weight["floor-adapter.js"].bytes;
  shellTotal = weight["index.html"].bytes + weight["app.css"].bytes + weight["app.js"].bytes;
  results.phone.pageWeight = { files: weight, floorScreenBytes: floorTotal, shellBytes: shellTotal, specCeilingBytes: 160 * 1024 };
  note("page weight measured", true,
    `floor screen (floor.js+floor.css+floor-adapter.js) = ${floorTotal} B raw (${(floorTotal / 1024).toFixed(1)} KB) vs spec ceiling 160 KB; shell = ${shellTotal} B`);

  writeRigHome();
  llamaProc = spawn(LLAMA_BIN, ["-m", MODEL, "--alias", "gemma-local", "--host", "127.0.0.1", "--port", String(LLAMA_PORT)],
    { stdio: "ignore" });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/models`).catch(() => null);
    return r && r.ok;
  }, 60000, "llama-server models");
  results.rig.llama = `gemma-local on :${LLAMA_PORT}`;

  bridge = (() => {
    const proc = spawn("node", ["src/cli.js", "serve", "--port", String(BRIDGE_PORT)], {
      cwd: APP_REPO, env: { ...process.env, VOKREW_HOME: RIG_HOME }, stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { out += d; });
    return { proc, out: () => out };
  })();
  const code = await waitFor(() => {
    const m = /Pairing code: (\d{6})/.exec(bridge.out());
    return m && m[1];
  }, 20000, "bridge pairing code");
  results.rig.bridge = `registry build on :${BRIDGE_PORT}`;

  const chromeEnv = { ...process.env };
  for (const k of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]) delete chromeEnv[k];
  fs.rmSync(PROFILE, { recursive: true, force: true });
  chromeProc = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server",
    `--remote-debugging-port=${CDP_PORT}`, "--window-size=412,915",
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
      const resp = await fetch(request.url, { method: request.method, headers, body: request.postData || undefined });
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
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...VIEW, screenWidth: 412, screenHeight: 915 });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  /* ---- locked at phone size ---- */
  await cdp.send("Page.navigate", { url: PAGE_URL });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor load (phone, locked)");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 15000, "locked room (phone)");
  await sleep(1500);
  const lockedAudit = await cdp.eval(OVERFLOW_AUDIT);
  results.phone.lockedAudit = lockedAudit;
  const lkSize = await shot(cdp, "phone-locked.png", "PHONE 412x915 @DPR2.6: connect door over the locked room");
  note("phone locked screenshot captured", lkSize > 5000, JSON.stringify({ iw: lockedAudit.innerWidth, docSW: lockedAudit.docScrollWidth, wide: lockedAudit.wideElements.length }));

  /* ---- pair, seat the rig crew, idle ---- */
  await cdp.eval(`(() => {
    document.getElementById('bridgeUrl').value = ${JSON.stringify(BRIDGE_BASE)};
    document.getElementById('pairCode').value = ${JSON.stringify(code)};
  })()`);
  await cdp.eval(`document.getElementById('pairBtn').click()`);
  await waitFor(() => cdp.eval(`document.getElementById('connectScreen').classList.contains('hidden')`), 25000, "door drops (phone)");
  token = await cdp.eval(`localStorage.getItem('vokrew.token')`);
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "crew seats (phone)");
  await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, "crew picker (phone)");
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew (phone)");
  await sleep(2500);
  const idleAudit = await cdp.eval(OVERFLOW_AUDIT);
  results.phone.idleAudit = idleAudit;
  const idSize = await shot(cdp, "phone-idle.png", "PHONE 412x915 @DPR2.6: paired, rig crew seated, idle room");
  note("phone idle screenshot captured", idSize > 5000,
    `canvas css=${JSON.stringify(idleAudit.canvasCss)} backing=${JSON.stringify(idleAudit.canvasBacking)} dprRatio=${idleAudit.canvasDprRatio} wide=${idleAudit.wideElements.length}`);

  /* ---- idle frame times ---- */
  await cdp.eval(FRAME_PROBE_START);
  await sleep(12000);
  results.phone.frameTimesIdle = await cdp.eval(FRAME_PROBE_STOP);
  note("phone idle frame times probed", !!results.phone.frameTimesIdle, JSON.stringify(results.phone.frameTimesIdle));

  /* ---- run at phone size, probe running, capture mid-run ---- */
  const doorstep = await cdp.eval(`(() => { const d = window.__floorDebug.allDoorsteps().find(x => x.id === 'c-w2'); return window.__floorDebug.cellOfPoint(d); })()`);
  await cdp.eval(FRAME_PROBE_START);
  await cdp.eval(`(() => { document.getElementById('floorRunTask').value = ${JSON.stringify(TASK)}; })()`);
  await cdp.eval(`document.getElementById('floorRunBtn').click()`);
  const started = await waitFor(async () => {
    const l = await bridgeGet("/runs?limit=5");
    return l.data.runs.find((r) => r.task === TASK && r.crew === "rig") || null;
  }, 20000, "phone run registered");
  const runId = started.id;
  results.phone.runId = runId;

  let lastPhase = null, final = null, midShot = false, midPhase = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 420000) {
    const { data } = await bridgeGet("/runs/" + runId);
    const rec = data.run;
    if (rec.phase !== lastPhase) {
      results.phases.push({ phase: rec.phase, state: rec.state, atSec: Math.round((Date.now() - t0) / 1000), stamps: rec.stamps.length });
      lastPhase = rec.phase;
    }
    if (!midShot && rec.phase === "reviewer") {
      const act = await cdp.eval(`window.__floorDebug.activity()`).catch(() => []);
      const rev = act.find((a) => a.agent === "rig:reviewer");
      if (rev && rev.cell && rev.cell.cx === doorstep.cx && rev.cell.cy === doorstep.cy) {
        midShot = true; midPhase = "reviewer-at-doorstep";
        const sz = await shot(cdp, "phone-midrun.png", "PHONE 412x915 @DPR2.6: mid-run — reviewer on the executor doorstep");
        note("phone mid-run screenshot captured (reviewer at doorstep)", sz > 5000, "");
      }
    }
    if (rec.state !== "running") { final = rec; break; }
    await sleep(400);
  }
  if (!midShot) {
    midPhase = `fallback at settle (phase=${lastPhase})`;
    const sz = await shot(cdp, "phone-midrun.png", "PHONE 412x915 @DPR2.6: run settling (doorstep moment not caught at phone size)");
    note("phone mid-run screenshot captured (fallback timing)", sz > 5000, midPhase);
  }
  results.phone.midRunPhase = midPhase;
  results.phone.finalRecord = final && { state: final.state, verdict: final.verdict, crossFamily: final.crossFamily };
  note("phone run settled", !!final && final.state === "done", final ? `verdict=${final.verdict}` : "no settle in window");
  results.phone.frameTimesRun = await cdp.eval(FRAME_PROBE_STOP);
  note("phone run frame times probed", !!results.phone.frameTimesRun, JSON.stringify(results.phone.frameTimesRun));
  const runAudit = await cdp.eval(OVERFLOW_AUDIT);
  results.phone.postRunAudit = runAudit;

  const logEntries = results.consoleErrors.filter((e) => e.startsWith("log:"));
  const nonLog = results.consoleErrors.filter((e) => !e.startsWith("log:"));
  const noise = logEntries.filter((e) => e.includes("net::ERR_FAILED") && e.includes(`127.0.0.1:${BRIDGE_PORT}`));
  const unexplained = logEntries.filter((e) => !noise.includes(e));
  results.consoleClassification = { total: results.consoleErrors.length, nonLog: nonLog.length, transportNoise: noise.length, unexplained };
  note("phone: zero console errors (same classification as desktop)",
    nonLog.length === 0 && unexplained.length === 0,
    `nonLog=${nonLog.length} noise=${noise.length} unexplained=${unexplained.slice(0, 2).join(" | ") || "none"}`);

  ws.close();
} catch (e) {
  note("phone pass completed without harness error", false, e.message);
} finally {
  try { if (chromeProc) chromeProc.kill("SIGKILL"); } catch { /* gone */ }
  try { if (bridge) bridge.proc.kill("SIGKILL"); } catch { /* gone */ }
  try { if (llamaProc) llamaProc.kill("SIGKILL"); } catch { /* gone */ }
  const missed = results.assertions.filter((a) => !a.ok);
  results.verdict = missed.length === 0 ? "STAGE 4 PHONE PASS: COMPLETE" : `STAGE 4 PHONE PASS: COMPLETE WITH ${missed.length} MISS(ES)`;
  fs.writeFileSync(path.join(HERE, "phone-results.json"), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict);
}
