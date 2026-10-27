#!/usr/bin/env node
/*
 * Phase 2 Stage 4 phone pass — LOOK GATE package.
 *
 * The same real conductor session as the desktop pass, at the Galaxy
 * S26 viewport (412x915 CSS px, DPR 2.6, mobile + touch emulation):
 * pair -> seat the rig crew -> room capture -> conductor call-out ->
 * hold pending capture -> approve -> run settles -> conductor
 * transcript capture (verdict row) -> reviewer dossier capture.
 * Horizontal-overflow audits at every beat. Same rig as the desktop
 * pass (real bridge + llama.cpp Gemma 3 1B, isolated VOKREW_HOME,
 * file:// page, bridge-origin Fetch interception). The reviewer
 * dossier is opened via the engine's selectAgent debug hook (the
 * Phase 2 Stage 1 phone precedent — canvas tap targeting at this
 * size is the flaky path; the desktop pass proves the real canvas
 * click). The lane is warmed directly against llama-server, never
 * through the bridge.
 *
 * Run AFTER stage4-capture.mjs (same rig ports, own home/profile).
 *   xvfb-run -a node stage4-phone.mjs
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
const CDP_PORT = 9342;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const RIG_HOME = "/tmp/vokrew-aaap-home";
const PROFILE = "/tmp/floor-aaap-profile";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
/* Same deliberately small filmed task as the desktop pass (see
   stage4-capture.mjs): the canonical open-ended call-out's executor
   output cannot generate inside the 120s lane timeout on this rig. */
const TEXT_NAMED = "Scout, write a one-line bash command that prints the word hello, then explain it in one short sentence";
const VIEW = { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true };

const results = { assertions: [], consoleErrors: [], screenshots: [], rig: {}, phone: {}, phases: [] };
function note(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "OK  " : "MISS"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (x) => JSON.stringify(x);

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

const OVERFLOW_AUDIT = `(() => {
  const iw = window.innerWidth;
  const wide = [];
  for (const e of document.querySelectorAll('#appShell *')) {
    const r = e.getBoundingClientRect();
    if (r.width && r.right > iw + 1) wide.push((e.id || (typeof e.className === 'string' && e.className) || e.tagName) + ' right=' + Math.round(r.right));
    if (wide.length >= 12) break;
  }
  return { innerWidth: iw, innerHeight: window.innerHeight, wideElements: wide };
})()`;

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
    state: dbg ? dbg.state() : null, rows,
    badge: (document.getElementById('holdBadge') || {}).textContent ?? null,
    nbHidden: nb ? nb.classList.contains('hidden') : null,
    nbCards: nb ? nb.querySelectorAll('.nbcard').length : 0,
    sidebarCards: document.querySelectorAll('#holdList .holdrow').length
  };
})()`;

const PANEL = `(() => {
  const p = document.getElementById('focus');
  if (!p) return { present: false };
  const hist = [...p.querySelectorAll('.histrow')].map((r) => ({
    run: r.getAttribute('data-run'), verdict: r.getAttribute('data-verdict')
  }));
  const pr = p.getBoundingClientRect();
  return {
    present: true, open: p.classList.contains('open'),
    headName: (p.querySelector('.panelhead h2') || {}).textContent || null,
    histCount: hist.length, hist,
    panelBox: { left: Math.round(pr.left), right: Math.round(pr.right), width: Math.round(pr.width) }
  };
})()`;

let llamaProc = null, bridge = null, chromeProc = null, token = null;
const authH = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
async function bridgeGet(p) {
  const r = await fetch(BRIDGE_BASE + p, { headers: authH() });
  return { status: r.status, data: await r.json().catch(() => null) };
}

try {
  writeRigHome();
  /* CPU pinning as in the desktop pass (G-9): llama-server alone on
     core 0 (-t 1); Chrome + bridge on core 1. Scheduling only. */
  llamaProc = spawn("taskset", ["-c", "0", LLAMA_BIN, "-m", MODEL, "--alias", "gemma-local", "-t", "1", "--host", "127.0.0.1", "--port", String(LLAMA_PORT)], { stdio: "ignore" });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/models`).catch(() => null);
    return r && r.ok;
  }, 60000, "llama-server models (phone)");
  const warmT0 = Date.now();
  const warm = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gemma-local", messages: [{ role: "user", content: "Reply with the single word: ready" }], max_tokens: 8 })
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  results.rig.warmup = { ms: Date.now() - warmT0, ok: !warm.error && !!(warm.choices && warm.choices[0]), via: "direct llama-server completion (bridge untouched)" };
  note("phone: lane warm-up completed directly against llama-server", results.rig.warmup.ok, `${results.rig.warmup.ms}ms`);

  bridge = (() => {
    const proc = spawn("taskset", ["-c", "1", "node", "src/cli.js", "serve", "--port", String(BRIDGE_PORT)], {
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
  }, 20000, "bridge pairing code (phone)");

  const env = { ...process.env };
  for (const k of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]) delete env[k];
  fs.rmSync(PROFILE, { recursive: true, force: true });
  chromeProc = spawn("taskset", ["-c", "1", CHROME,
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server",
    `--remote-debugging-port=${CDP_PORT}`, "--window-size=412,915",
    `--user-data-dir=${PROFILE}`, "about:blank"
  ], { stdio: "ignore", env });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).catch(() => null);
    return r && r.ok;
  }, 20000, "chrome CDP (phone)");
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
  const shot = async (file, noteText) => {
    const p = path.join(HERE, file);
    const s = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(p, Buffer.from(s.data, "base64"));
    results.screenshots.push({ file, note: noteText });
    return fs.statSync(p).size;
  };
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

  /* ---- pair + seat the rig crew ---- */
  await cdp.send("Page.navigate", { url: PAGE_URL });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor load (phone)");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 15000, "locked room (phone)");
  await cdp.eval(`(() => {
    document.getElementById('bridgeUrl').value = ${J(BRIDGE_BASE)};
    document.getElementById('pairCode').value = ${J(code)};
  })()`);
  await cdp.eval(`document.getElementById('pairBtn').click()`);
  await waitFor(() => cdp.eval(`document.getElementById('connectScreen').classList.contains('hidden')`), 25000, "door drops (phone)");
  token = await cdp.eval(`localStorage.getItem('vokrew.token')`);
  note("phone: paired through the page's own form", !!token);
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "crew seats (phone)");
  await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, "crew picker (phone)");
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew (phone)");
  await sleep(2500);

  /* ---- beat 1: the room ---- */
  await cdp.eval(`(() => { const r = document.getElementById('floorRoot'); if (r) r.scrollIntoView({ block: 'start' }); window.scrollTo(0, 0); })()`);
  await sleep(600);
  results.phone.roomAudit = await cdp.eval(OVERFLOW_AUDIT);
  const roomSize = await shot("after-phone-room.png", "PHONE 412x915 @DPR2.6: the room, rig crew seated, idle");
  note("phone room screenshot captured; zero horizontal overflow",
    roomSize > 5000 && results.phone.roomAudit.wideElements.length === 0,
    `${roomSize} bytes; wide=${J(results.phone.roomAudit.wideElements)}`);

  /* ---- beat 2: conductor call-out -> hold pending ---- */
  await cdp.eval(`(() => { const i = document.getElementById('conductorInput'); i.focus(); i.scrollIntoView({ block: 'center' }); })()`);
  await sleep(500);
  await cdp.send("Input.insertText", { text: TEXT_NAMED });
  await cdp.eval(`document.getElementById('conductorSend').click()`);
  const pHold = await waitFor(async () => {
    const p = await cdp.eval(CONDUCTOR_PROBE).catch(() => null);
    return p && p.state && p.state.holds && p.state.holds.length === 1 ? p : null;
  }, 20000, "hold created (phone)");
  note("phone: call-out became one hold; badge 1",
    pHold.badge === "1" && pHold.sidebarCards === 1, `badge=${J(pHold.badge)} sidebar=${pHold.sidebarCards} nb=${pHold.nbCards}`);
  await sleep(1500);
  results.phone.holdAudit = await cdp.eval(OVERFLOW_AUDIT);
  const holdSize = await shot("after-phone-hold-pending.png", "PHONE 412x915 @DPR2.6: hold pending — hold card + badge 1 (+ office noticeboard on the room)");
  note("phone hold-pending screenshot captured; zero horizontal overflow",
    holdSize > 5000 && results.phone.holdAudit.wideElements.length === 0,
    `${holdSize} bytes; wide=${J(results.phone.holdAudit.wideElements)}`);

  /* ---- approve -> the run plays out on the phone ---- */
  const holdId = pHold.state.holds[0].id;
  const approved = await cdp.eval(`(() => {
    const root = document.getElementById('holdList');
    const cardEl = [...root.querySelectorAll('[data-hold]')].find((r) => r.getAttribute('data-hold') === ${J(holdId)});
    if (!cardEl) return false;
    const btn = cardEl.querySelector('[data-hold-action="approve"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  note("phone: approve clicked on the hold card", approved);
  const started = await waitFor(async () => {
    const l = await bridgeGet("/runs?limit=5");
    return l.data.runs.find((r) => r.task === TEXT_NAMED && r.crew === "rig") || null;
  }, 30000, "phone run registered");
  const runId = started.id;
  results.phone.runId = runId;

  let lastPhase = null, final = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 480000) {
    const { data } = await bridgeGet("/runs/" + runId);
    const rec = data.run;
    if (rec.phase !== lastPhase) {
      results.phases.push({ phase: rec.phase, state: rec.state, atSec: Math.round((Date.now() - t0) / 1000), stamps: rec.stamps.length });
      lastPhase = rec.phase;
    }
    if (rec.state !== "running") { final = rec; break; }
    await sleep(500);
  }
  results.phone.finalRecord = final && { state: final.state, verdict: final.verdict, crossFamily: final.crossFamily, error: final.error || null, stamps: final.stamps.length };
  note("phone run settled done/APPROVED", !!final && final.state === "done" && final.verdict === "APPROVED",
    final ? `state=${final.state} verdict=${final.verdict}` : "no settle in window");
  await sleep(2500);

  /* ---- beat 3: conductor with the transcript (verdict row) ---- */
  const pSettled = await cdp.eval(CONDUCTOR_PROBE).catch(() => null);
  results.phone.settledRows = pSettled ? pSettled.rows : null;
  const verdictRow = pSettled && pSettled.rows.find((r) => r.kind === "verdict" && r.run === runId);
  note("phone: verdict row in the conductor transcript, tied to the run id",
    !!verdictRow && verdictRow.verdict === "APPROVED", verdictRow ? verdictRow.text.slice(0, 120) : "row missing");
  await cdp.eval(`(() => { const l = document.getElementById('conductorLog'); if (l) { l.scrollTop = l.scrollHeight; l.scrollIntoView({ block: 'center' }); } })()`);
  await sleep(700);
  results.phone.conductorAudit = await cdp.eval(OVERFLOW_AUDIT);
  const condSize = await shot("after-phone-conductor.png", "PHONE 412x915 @DPR2.6: conductor with transcript — instruction, hold, firing, verdict rows");
  note("phone conductor screenshot captured; zero horizontal overflow",
    condSize > 5000 && results.phone.conductorAudit.wideElements.length === 0,
    `${condSize} bytes; wide=${J(results.phone.conductorAudit.wideElements)}`);

  /* ---- beat 4: reviewer dossier (debug-hook open, Stage 1 phone precedent) ---- */
  await cdp.eval(`(() => { const b = document.getElementById('floorCardClose'); if (b) b.click(); })()`);
  await sleep(600);
  await cdp.eval(`window.__floorDebug.selectAgent('rig:reviewer')`);
  const panelJudge = await waitFor(async () => {
    const p = await cdp.eval(PANEL).catch(() => null);
    return p && p.open && p.headName === "Judge" ? p : null;
  }, 15000, "reviewer dossier opens (phone)");
  results.phone.dossier = { headName: panelJudge.headName, histCount: panelJudge.histCount, hist: panelJudge.hist, panelBox: panelJudge.panelBox };
  const histRow = panelJudge.hist.find((h) => h.run === runId);
  note("phone: reviewer dossier shows the settled run in its history",
    !!histRow && histRow.verdict === "APPROVED", histRow ? `verdict=${histRow.verdict}` : "row missing");
  await sleep(2500);
  results.phone.dossierAudit = await cdp.eval(OVERFLOW_AUDIT);
  const dosSize = await shot("after-phone-dossier.png", "PHONE 412x915 @DPR2.6: Judge's dossier — identity + run history at phone size");
  note("phone dossier screenshot captured; panel inside the viewport; zero horizontal overflow",
    dosSize > 5000 && panelJudge.panelBox.right <= 413 && results.phone.dossierAudit.wideElements.length === 0,
    `${dosSize} bytes; panel=${J(panelJudge.panelBox)} wide=${J(results.phone.dossierAudit.wideElements)}`);

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
  results.failed = String(e.message || e);
} finally {
  try { if (chromeProc) chromeProc.kill("SIGKILL"); } catch { /* gone */ }
  try { if (bridge) bridge.proc.kill("SIGKILL"); } catch { /* gone */ }
  try { if (llamaProc) llamaProc.kill("SIGKILL"); } catch { /* gone */ }
  const missed = results.assertions.filter((a) => !a.ok);
  results.verdict = results.failed
    ? `PHASE 2 STAGE 4 PHONE PASS: FAILED — ${results.failed}`
    : missed.length === 0 ? "PHASE 2 STAGE 4 PHONE PASS: COMPLETE" : `PHASE 2 STAGE 4 PHONE PASS: COMPLETE WITH ${missed.length} MISS(ES)`;
  fs.writeFileSync(path.join(HERE, "phone-results.json"), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict);
  if (results.failed) process.exitCode = 2;
}
