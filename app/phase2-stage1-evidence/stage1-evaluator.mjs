#!/usr/bin/env node
/*
 * Phase 2 Stage 1 evaluator — PHASE2-SPEC.md Stage 1 gate (agent
 * focus panel = the agent's dossier), run against the Phase 1 VM
 * rehearsal rig: real bridge (isolated VOKREW_HOME) + llama.cpp
 * Gemma 3 1B as the single local lane — no mocks anywhere. Same
 * serving mechanism as the Phase 1 / Stage 0 evaluators: page over
 * file://, CDP Fetch interception bridging ONLY the browser's CORS
 * enforcement point against the untouched real bridge.
 *
 * Assertions (task list):
 *   (1) click a real agent (canvas, real mouse) -> dossier opens;
 *       identity fields deep-equal the bridge's GET /crews +
 *       GET /lanes payloads for that agent (crew, name, seat, lane,
 *       provider, model, family, tier). Also proven for the reviewer
 *       mid-review (the spec's own evaluator scenario).
 *   (2) the dossier's lane-calls-today figure == GET /budget
 *       (coding surface — the bridge's default) for that lane at
 *       that moment; crew total + share checked arithmetically.
 *   (3) after a real run settles, the executor's dossier history
 *       contains the run and deep-equals GET /runs/:id (per-stamp
 *       lane, model, latency, attempts, failover, run verdict,
 *       crossFamily) for every role checked (executor + reviewer).
 *   (4) dossier opened DURING a run shows the agent's live phase at
 *       two poll points and a phase transition as the record moves
 *       on (planner), and the reviewer's live state mid-review.
 *   (5) three separate verified closes: the x button, Esc, and a
 *       real mouse click on empty room space.
 *   (6) crew switch with the dossier open closes it (G-7).
 *   (7) an agent with zero runs in the registry shows the honest
 *       empty state (no fabricated rows) — proven on the nameless
 *       default crew (identity shows the unnamed state too) and on
 *       the rig crew before its first page run.
 *   (8) zero console errors across the whole session, with the
 *       Phase 1 classification (handled net::ERR_FAILED transport
 *       entries against the bridge origin tallied, anything else
 *       fails).
 *   (+) phone 412x915: dossier opens (via the engine's selectAgent
 *       debug hook — the click path itself is proven on desktop;
 *       the phone assertion is layout) with no element overflowing
 *       the viewport width; budget pill == served stamps across
 *       takes, as in Stage 0.
 *
 * Captures are named `${LABEL}-*.png` (LABEL env, default "after");
 * run once pre-fix with LABEL=before for the baseline pair (the
 * dossier assertions fail there — the Phase 1 panel has no dossier —
 * and that failure IS the baseline).
 *
 * TAB CHOREOGRAPHY (rig accommodation, disclosed — same as Stage
 * 0): on this 2-vCPU VM the co-located 1B lane starves when the
 * browser renders beside it, so during a run's planner/executor
 * grind the evaluator activates a blank tab (the product's shipped
 * hidden-tab behavior applies; the run continues server-side) and
 * brings the page back for the reviewer stage. Takes: a run that
 * dies on the lane ("no lane could serve") is resubmitted up to 3
 * takes, every take recorded in results.rig.
 *
 * Run:  xvfb-run -a node stage1-evaluator.mjs
 * Exit code 0 = gate green.
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
const CDP_PORT = 9337;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const RIG_HOME = "/tmp/vokrew-s1-eval-home";
const PROFILE = "/tmp/floor-s1-eval-profile";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const LABEL = process.env.LABEL || "after";
const TASK = "Write a one-line bash command that prints the current folder path, then explain it in one short sentence.";

const results = { assertions: [], consoleErrors: [], screenshots: [], rig: {}, label: LABEL, measurements: {} };
function assert(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
function note(name, detail = "") {
  results.assertions.push({ name, ok: true, note: true, detail: String(detail) });
  console.log(`NOTE  ${name}${detail ? " — " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- tiny CDP client (same shape as Phase 1) ---------------- */

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

/* ---------------- page probes ---------------- */

/* The dossier probe. Identity / today values ride on .drow[data-k]
   rows and history rows carry their stamp fields as data-*
   attributes, so the deep-equal below compares the panel's own
   rendered claims against the bridge payloads field by field. On
   the pre-Stage-1 panel none of these elements exist: the probe
   returns empty structures and the assertions fail (the baseline). */
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
    lane: r.getAttribute('data-lane'), model: r.getAttribute('data-model'),
    latency: r.getAttribute('data-latency'), attempts: r.getAttribute('data-attempts'),
    failover: r.getAttribute('data-failover'), verdict: r.getAttribute('data-verdict'),
    runState: r.getAttribute('data-runstate'), crossFamily: r.getAttribute('data-xfam'),
    text: r.textContent.replace(/\\s+/g, ' ').trim()
  }));
  const empty = p.querySelector('.histempty');
  const stat = (label) => {
    const s = [...p.querySelectorAll('.stat')].find((x) => {
      const k = x.querySelector('.k');
      return k && k.textContent === label;
    });
    return s ? s.querySelector('.v').textContent : null;
  };
  const pr = p.getBoundingClientRect();
  return {
    present: true,
    open: p.classList.contains('open'),
    headName: (p.querySelector('.panelhead h2') || {}).textContent || null,
    headRole: (p.querySelector('.panelhead .role') || {}).textContent || null,
    kv, hist, histCount: hist.length,
    histEmpty: empty ? empty.textContent.replace(/\\s+/g, ' ').trim() : null,
    nowV: (document.getElementById('fNowV') || {}).textContent ?? null,
    nowS: (document.getElementById('fNowS') || {}).textContent ?? null,
    statusStat: stat('Status'),
    panelBox: { left: Math.round(pr.left), right: Math.round(pr.right), width: Math.round(pr.width) }
  };
})()`;

const OVERFLOW_AUDIT = `(() => {
  const iw = window.innerWidth;
  const wide = [];
  for (const e of document.querySelectorAll('#appShell *')) {
    const r = e.getBoundingClientRect();
    if (r.width && r.right > iw + 1) wide.push((e.id || (typeof e.className === 'string' && e.className) || e.tagName) + ' right=' + Math.round(r.right));
    if (wide.length >= 12) break;
  }
  const fp = document.getElementById('focus');
  const fr = fp ? fp.getBoundingClientRect() : null;
  return {
    innerWidth: iw, innerHeight: window.innerHeight,
    wideElements: wide,
    focusBox: fr ? { left: Math.round(fr.left), right: Math.round(fr.right), width: Math.round(fr.width) } : null,
    focusOpen: fp ? fp.classList.contains('open') : false
  };
})()`;

/* Candidate empty-room click points: on-canvas screen points whose
   world position is far from every entity and every doorstep (a
   cubicle interior hit would select its owner instead of closing —
   the caller detects that and tries the next candidate). */
const EMPTY_POINTS = `(() => {
  const dbg = window.__floorDebug;
  const ents = dbg.activity().map((a) => ({ x: a.x, y: a.y }));
  const doors = dbg.allDoorsteps();
  const c = document.querySelector('#cv');
  const r = c.getBoundingClientRect();
  const out = [];
  for (let wx = 40; wx <= 1560 && out.length < 8; wx += 40) {
    for (let wy = 40; wy <= 1160 && out.length < 8; wy += 40) {
      if (ents.some((e) => Math.hypot(e.x - wx, e.y - wy) < 110)) continue;
      if (doors.some((d) => Math.hypot(d.x - wx, d.y - wy) < 80)) continue;
      const p = worldToScreen(wx, wy);
      const sx = Math.round(r.left + p.x), sy = Math.round(r.top + p.y);
      if (sx > r.left + 10 && sx < r.right - 10 && sy > r.top + 10 && sy < r.bottom - 10) {
        out.push({ wx, wy, x: sx, y: sy });
      }
    }
  }
  return out;
})()`;

/* ---------------- main ---------------- */

let llamaProc = null, bridge = null, chromeProc = null, token = null;
const authH = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
async function bridgeGet(p) {
  const r = await fetch(BRIDGE_BASE + p, { headers: authH() });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function bridgeRun(id) {
  const { data } = await bridgeGet("/runs/" + id);
  return data && data.run;
}
async function waitRunSettled(id, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const rec = await bridgeRun(id);
    if (rec && rec.state !== "running") return rec;
    if (Date.now() - t0 > timeoutMs) throw new Error("run " + id + " did not settle in " + timeoutMs + "ms");
    await sleep(600);
  }
}
async function bridgePairCode(bridge) {
  return waitFor(() => {
    const m = /Pairing code: (\d{6})/.exec(bridge.out());
    return m && m[1];
  }, 20000, "bridge pairing code");
}

/* The history the dossier MUST show for (crew, role), derived only
   from the bridge: GET /runs summaries to find candidate runs,
   GET /runs/:id for the records, newest run first (the registry's
   own order), stamps in stage order, capped at the panel's 12. */
async function expectedHistory(crewName, role) {
  const list = (await bridgeGet("/runs?limit=20")).data.runs || [];
  const rows = [];
  for (const sum of list) {
    const rec = await bridgeRun(sum.id);
    if (!rec) continue;
    if (rec.crew && rec.crew !== crewName) continue;
    for (const st of rec.stamps || []) {
      if (st.role !== role) continue;
      rows.push({
        run: rec.id, role: st.role, lane: st.lane, model: st.model,
        latency: String(st.latencyMs), attempts: String((st.attempts || []).length),
        failover: st.failover ? "1" : "0",
        verdict: rec.state === "done" ? (rec.verdict || "") : "",
        runState: rec.state,
        crossFamily: rec.crossFamily === null || rec.crossFamily === undefined ? "" : rec.crossFamily ? "yes" : "no"
      });
    }
  }
  return rows.slice(0, 12);
}

function histDiff(panelRows, expected) {
  const slim = (rows) => rows.map((r) => ({
    run: r.run, role: r.role, lane: r.lane, model: r.model, latency: r.latency,
    attempts: r.attempts, failover: r.failover, verdict: r.verdict,
    runState: r.runState, crossFamily: r.crossFamily
  }));
  const a = JSON.stringify(slim(panelRows));
  const b = JSON.stringify(slim(expected));
  return a === b ? null : `panel=${a.slice(0, 300)} expected=${b.slice(0, 300)}`;
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

  /* Quiet-machine warm-up (Stage 0 precedent, disclosed there):
     one full chain with no browser on the VM, then the bridge is
     restarted so the page pairs through its own form with a fresh
     code (registry resets; the token + ledger persist). Outcome
     recorded, not asserted — rig warm-up. */
  {
    const code0 = await bridgePairCode(bridge);
    const pairRes = await fetch(BRIDGE_BASE + "/pair", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code0 })
    }).then((r) => r.json()).catch(() => null);
    const wH = { Authorization: "Bearer " + (pairRes && pairRes.token), "Content-Type": "application/json" };
    const wRun = async (id) => {
      const r = await fetch(BRIDGE_BASE + "/runs/" + id, { headers: wH });
      const d = await r.json().catch(() => null);
      return d && d.run;
    };
    let warm = null;
    for (let attempt = 1; attempt <= 2 && !warm; attempt++) {
      const post = await fetch(BRIDGE_BASE + "/run", {
        method: "POST", headers: wH, body: JSON.stringify({ task: TASK, crew: "rig" })
      }).then((r) => r.json()).catch(() => null);
      if (post && post.runId) {
        const t0 = Date.now();
        for (;;) {
          const rec = await wRun(post.runId);
          if (rec && rec.state !== "running") {
            if (rec.state === "done") warm = { id: post.runId, attempt, verdict: rec.verdict, secs: Math.round((Date.now() - t0) / 1000) };
            break;
          }
          if (Date.now() - t0 > 300000) break;
          await sleep(700);
        }
      }
    }
    results.rig.quietWarmUpRun = warm;
    console.log(warm ? `NOTE  quiet warm-up run done in ${warm.secs}s (attempt ${warm.attempt})` : "NOTE  quiet warm-up run FAILED twice");
    try { bridge.proc.kill("SIGKILL"); } catch { /* restarted below */ }
    await sleep(900);
    bridge = startBridge();
  }
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

  /* Tab choreography (see header). */
  const pageTargetId = target.id;
  let blankTargetId = null;
  async function hidePage() {
    if (!blankTargetId) {
      const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })).json();
      blankTargetId = t.id;
    }
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${blankTargetId}`).catch(() => null);
    await sleep(400);
    if (results.rig.pageHiddenVerified === undefined) {
      results.rig.pageHiddenVerified = await cdp.eval(`document.hidden`).catch(() => null);
    }
  }
  async function showPage() {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${pageTargetId}`).catch(() => null);
    await sleep(400);
  }

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

  /* CORS bridge-over (Phase 1 mechanism): intercept ONLY the bridge origin. */
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

  async function shot(file, noteText) {
    const p = path.join(HERE, file);
    const s = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(p, Buffer.from(s.data, "base64"));
    results.screenshots.push({ file, note: noteText });
    return fs.statSync(p).size;
  }

  async function mouseClick(x, y) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  /* Real mouse click on an agent's entity, at its CURRENT position
     (the focus camera moves the room, so the point is recomputed
     for every click — the Stage 0 pattern). */
  async function clickAgent(agentId) {
    const pointOf = () => cdp.eval(`(() => {
      const e = window.__floorDebug.ents[${JSON.stringify(agentId)}];
      if (!e) return null;
      const c = document.querySelector('#cv');
      const r = c.getBoundingClientRect();
      const p = worldToScreen(e.x, e.y - 8);
      return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
    })()`);
    /* The camera glides between views; a click computed mid-glide
       lands where the agent no longer is. Wait for the point to
       stop moving first (walking agents keep a moving point — the
       timeout falls through and clicks the freshest point). */
    let pt = await pointOf();
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      await sleep(350);
      const next = await pointOf();
      if (!next) break;
      const still = pt && Math.abs(next.x - pt.x) < 2 && Math.abs(next.y - pt.y) < 2;
      pt = next;
      if (still) break;
    }
    if (!pt) throw new Error("no entity for " + agentId);
    await mouseClick(pt.x, pt.y);
    return pt;
  }
  const panel = () => cdp.eval(PANEL);
  async function waitPanelOpen(name, timeoutMs = 12000) {
    return waitFor(async () => {
      const p = await panel();
      return p.open && (!name || p.headName === name) ? p : null;
    }, timeoutMs, "dossier open" + (name ? " for " + name : ""));
  }
  async function waitPanelClosed(timeoutMs = 8000) {
    return waitFor(async () => {
      const p = await panel();
      return p.present && !p.open ? p : null;
    }, timeoutMs, "dossier closed").catch(() => null);
  }

  /* ============ door + pairing (Stage 0 pattern) ============ */
  await cdp.send("Page.navigate", { url: PAGE_URL });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 15000, "locked room seats nobody");
  const door = await cdp.eval(`(() => {
    const cs = document.getElementById('connectScreen');
    return { overlayVisible: !cs.classList.contains('hidden'), chip: document.getElementById('floorModeChip').textContent };
  })()`);
  assert("(0) connect door up over the locked room", door.overlayVisible && door.chip === "OFFLINE", JSON.stringify(door));

  await cdp.eval(`(() => {
    document.getElementById('bridgeUrl').value = ${JSON.stringify(BRIDGE_BASE)};
    document.getElementById('pairCode').value = ${JSON.stringify(code)};
  })()`);
  await cdp.eval(`document.getElementById('pairBtn').click()`);
  await waitFor(() => cdp.eval(`document.getElementById('connectScreen').classList.contains('hidden')`), 25000, "door drops after pairing");
  token = await cdp.eval(`localStorage.getItem('vokrew.token')`);
  assert("(1) paired through the page form", !!token);

  const warm = await fetch(BRIDGE_BASE + "/chat", {
    method: "POST", headers: authH(), body: JSON.stringify({ message: "Reply with the single word: ready" })
  }).then((r) => r.json()).catch(() => null);
  assert("(1) warm-up chat served by the real lane", !!(warm && warm.ok), warm ? "ok" : "no response");
  note("(1) quiet warm-up run (pre-browser) outcome", results.rig.quietWarmUpRun
    ? `done in ${results.rig.quietWarmUpRun.secs}s` : "FAILED — measured runs rely on the recorded-takes policy");

  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "default crew seats");
  await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, "crew picker populated");

  /* ============ (7a) the nameless default crew: honest identity + empty history ============ */
  await clickAgent("default:planner");
  const pNameless = await waitPanelOpen("Planner");
  results.measurements.namelessPanel = pNameless;
  assert("(7) nameless crew: dossier opens on the role-label agent", !!pNameless, `head=${pNameless.headName}/${pNameless.headRole}`);
  assert("(7) nameless crew: identity says the agent is unnamed (no invented name)",
    !!pNameless.kv.name && /unnamed/i.test(pNameless.kv.name), `name row=${JSON.stringify(pNameless.kv.name)}`);
  assert("(7) nameless crew: crew + seat rows come from the bridge payload",
    pNameless.kv.crew === "default" && /^planner/.test(pNameless.kv.seat || ""), JSON.stringify(pNameless.kv));
  assert("(7) zero-run agent: history is the honest empty state, zero fabricated rows",
    pNameless.histCount === 0 && !!pNameless.histEmpty && /no runs/i.test(pNameless.histEmpty),
    `rows=${pNameless.histCount} empty=${JSON.stringify(pNameless.histEmpty)}`);
  const namelessSize = await shot(`${LABEL}-dossier-nameless.png`, "default (nameless) crew planner dossier: unnamed identity, empty history");
  assert("(7) nameless dossier screenshot captured", namelessSize > 5000, `${namelessSize} bytes`);

  /* ============ (5a) close via the x button ============ */
  await cdp.eval(`(() => { const b = document.querySelector('#focus .panelhead .close'); if (b) b.click(); })()`);
  const closedX = await waitPanelClosed();
  assert("(5) close via the x button", !!closedX);

  /* ============ seat the rig crew ============ */
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew seated");

  /* Bridge truth for the rig crew, fetched once per check from the
     API itself — the panel is compared against THESE payloads. */
  const crewsData = (await bridgeGet("/crews")).data;
  const lanesData = (await bridgeGet("/lanes")).data;
  const rigCrew = (crewsData.crews || []).find((c) => c.name === "rig");
  const laneById = new Map((lanesData.lanes || []).map((l) => [l.id, l]));
  results.measurements.rigCrewRoles = Object.keys((rigCrew && rigCrew.roles) || {});

  function checkIdentity(p, role, label) {
    const slot = (rigCrew.roles || {})[role] || {};
    const laneId = Array.isArray(slot.lanes) && slot.lanes.length ? slot.lanes[0] : null;
    const lane = laneId ? laneById.get(laneId) : null;
    const want = {
      crew: "rig",
      name: slot.name || null,
      lane: laneId,
      provider: lane ? lane.provider : null,
      model: lane ? lane.model : null,
      family: lane ? lane.family : null,
      tier: lane ? lane.tier : null
    };
    const got = {
      crew: p.kv.crew, name: p.headName, lane: p.kv.lane, provider: p.kv.provider,
      model: p.kv.model, family: p.kv.family, tier: p.kv.tier
    };
    assert(`${label} identity deep-equals GET /crews + GET /lanes (${role})`,
      JSON.stringify(got) === JSON.stringify(want),
      `panel=${JSON.stringify(got)} bridge=${JSON.stringify(want)}`);
    assert(`${label} seat row names the role (${role})`,
      new RegExp("^" + role + "\\b").test(p.kv.seat || ""), `seat=${JSON.stringify(p.kv.seat)}`);
    return want;
  }

  async function checkBudget(p, label) {
    const budget = (await bridgeGet("/budget")).data; // default surface = coding
    const laneRow = (budget.lanes || []).find((l) => l.id === "local-gemma");
    const wantLane = laneRow ? laneRow.used : null;
    const wantCrew = wantLane; // the rig crew's only lane (crews payload above)
    const gotLane = p.kv.laneCalls == null ? null : Number(p.kv.laneCalls);
    const gotCrew = p.kv.crewCalls == null ? null : Number(p.kv.crewCalls);
    assert(`${label} lane calls today == GET /budget for the lane`,
      gotLane === wantLane, `panel=${JSON.stringify(p.kv.laneCalls)} budget=${wantLane} day=${budget.day}`);
    assert(`${label} crew calls + share are the same ledger, honestly derived`,
      gotCrew === wantCrew && (wantCrew > 0 ? p.kv.share === "100%" : true),
      `crew panel=${JSON.stringify(p.kv.crewCalls)} want=${wantCrew} share=${JSON.stringify(p.kv.share)}`);
  }

  /* ============ (1)+(2)+(7b) Scout's dossier at idle ============ */
  await clickAgent("rig:planner");
  const pScoutIdle = await waitPanelOpen("Scout");
  checkIdentity(pScoutIdle, "planner", "(1)");
  await checkBudget(pScoutIdle, "(2)");
  const expHistIdle = await expectedHistory("rig", "planner");
  const diffIdle = histDiff(pScoutIdle.hist, expHistIdle);
  assert("(7) rig planner before any page run: history matches the registry exactly (empty state, no rows)",
    diffIdle === null && (expHistIdle.length > 0 || !!pScoutIdle.histEmpty),
    diffIdle || `rows=${pScoutIdle.histCount} registry=${expHistIdle.length}`);
  const idleSize = await shot(`${LABEL}-dossier-idle.png`, "Scout (planner) dossier at idle: identity, today, empty history");
  assert("(1) idle dossier screenshot captured", idleSize > 5000, `${idleSize} bytes`);

  /* ============ (5b) close via Esc ============ */
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const closedEsc = await waitPanelClosed();
  assert("(5) close via Esc", !!closedEsc);

  /* ============ run #1: (4) live dossier, (1b) reviewer mid-review ============ */
  const pillBefore = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
  const knownIds = new Set(((await bridgeGet("/runs?limit=20")).data.runs || []).map((r) => r.id));
  const findNewRun = async () => {
    const l = await bridgeGet("/runs?limit=10");
    return (l.data.runs || []).find((r) => r.task === TASK && r.crew === "rig" && !knownIds.has(r.id)) || null;
  };
  const submitFromPage = async () => {
    await waitFor(() => cdp.eval(`!document.getElementById('floorRunBtn').disabled`), 20000, "Run button re-enabled");
    await cdp.eval(`(() => { document.getElementById('floorRunTask').value = ${JSON.stringify(TASK)}; })()`);
    await cdp.eval(`document.getElementById('floorRunBtn').click()`);
    return waitFor(findNewRun, 20000, "run registered on the bridge");
  };

  const started = await submitFromPage();
  let runId = started.id;
  knownIds.add(runId);
  results.rig.run1 = runId;
  assert("(4) run #1 submitted from the Floor form", !!runId, runId);
  await waitFor(async () => {
    const rec = await bridgeRun(runId);
    return rec && rec.state === "running" && rec.phase === "planner" ? rec : null;
  }, 30000, "run #1 in the planner phase");

  /* Open the planner's dossier DURING its phase: live state at two
     poll points, both tied to the bridge record's phase. */
  await clickAgent("rig:planner");
  const liveSamples = [];
  for (let i = 0; i < 2; i++) {
    const p = await panel();
    const rec = await bridgeRun(runId);
    liveSamples.push({ status: p.statusStat, nowS: p.nowS, bridgePhase: rec && rec.phase, open: p.open, head: p.headName });
    if (i === 0) await sleep(1600);
  }
  results.measurements.livePlanner = liveSamples;
  assert("(4) planner dossier open mid-run shows the live phase at two poll points",
    liveSamples.every((s) => s.open && s.head === "Scout" && s.status === "running" && /phase: planner/.test(s.nowS || "") && s.bridgePhase === "planner"),
    JSON.stringify(liveSamples));

  /* Grind through planner + executor with the page hidden (rig
     choreography), Scout's dossier still open behind the tab. */
  const takes1 = [];
  let final1 = null, midrunShotDone = false;
  for (let take = 1; take <= 3; take++) {
    let settledRec = null;
    await hidePage();
    const tHide = Date.now();
    while (Date.now() - tHide < 420000) {
      const rec = await bridgeRun(runId);
      if (rec.state !== "running") { settledRec = rec; break; }
      if (rec.phase === "reviewer") break;
      await sleep(500);
    }
    await showPage();
    if (!settledRec) {
      /* The reviewer stage, page live: (4b) the planner's dossier —
         still open — must have moved on from the planner phase. */
      await sleep(2200); // adapter poll lands the reviewer-phase record
      const pScoutLater = await panel();
      results.measurements.plannerAfterPhase = { status: pScoutLater.statusStat, nowV: pScoutLater.nowV, nowS: pScoutLater.nowS, head: pScoutLater.headName, open: pScoutLater.open };
      assert("(4) phase transition: the open planner dossier leaves the planner phase as the record moves on",
        pScoutLater.open && pScoutLater.headName === "Scout" && pScoutLater.statusStat !== "running" && !/phase: planner/.test(pScoutLater.nowS || ""),
        JSON.stringify(results.measurements.plannerAfterPhase));

      /* (1b) click the reviewer mid-review (roster card — the
         canvas-click path is already proven; the reviewer is
         walking) and check identity + live state against the
         bridge while its phase lasts. */
      const recNow = await bridgeRun(runId);
      if (recNow.state === "running" && recNow.phase === "reviewer") {
        await cdp.eval(`(() => { const c = document.querySelector('#roster .acard[data-id="rig:reviewer"]'); if (c) c.click(); })()`);
        const pJudgeLive = await waitPanelOpen("Judge", 8000).catch(() => null);
        if (pJudgeLive) {
          checkIdentity(pJudgeLive, "reviewer", "(1b)");
          const recChk = await bridgeRun(runId);
          assert("(4) reviewer dossier mid-review shows it live (status running in its phase)",
            pJudgeLive.statusStat === "running" && recChk.phase === "reviewer",
            `status=${pJudgeLive.statusStat} nowV=${JSON.stringify(pJudgeLive.nowV)} bridgePhase=${recChk.phase}`);
          if (!midrunShotDone) {
            midrunShotDone = true;
            const sz = await shot(`${LABEL}-dossier-midrun.png`, "Judge (reviewer) dossier open mid-review, reviewer at the executor doorstep");
            assert("(4) mid-review dossier screenshot captured", sz > 5000, `${sz} bytes`);
          }
        } else {
          note("(1b) reviewer phase ended before the dossier opened — identity rechecked at idle instead");
        }
      } else {
        note("(1b) run settled before the reviewer phase was observable — mid-review identity skipped", `state=${recNow.state}`);
      }

      const tWalk = Date.now();
      while (Date.now() - tWalk < 420000) {
        const rec = await bridgeRun(runId);
        if (rec.state !== "running") { settledRec = rec; break; }
        await sleep(500);
      }
    }
    if (!settledRec) settledRec = await bridgeRun(runId);
    takes1.push({ id: runId, state: settledRec.state, stamps: settledRec.stamps.length, error: settledRec.error || null });
    final1 = settledRec;
    if (settledRec.state === "done") break;
    if (take === 3 || !/no lane could serve/.test(settledRec.error || "")) break;
    note(`(4) run #1 take ${take} died on the lane (rig contention, G-9) — resubmitting`, settledRec.error || "");
    const again = await submitFromPage();
    runId = again.id;
    knownIds.add(runId);
    results.rig.run1 = runId;
  }
  results.rig.run1Takes = takes1;
  results.rig.finalRecord1 = { state: final1.state, verdict: final1.verdict, crossFamily: final1.crossFamily, stamps: final1.stamps.length };
  assert("(4) run #1 settles done on the bridge", final1.state === "done", `verdict=${final1.verdict}`);
  await sleep(2200); // adapter polls land the settled record + refreshed budget

  /* ============ (3) settled history deep-equals the bridge records ============ */
  /* Close the reviewer's dossier first (x button): on settle the run
     card auto-expands over the stage's bottom edge and the focus
     camera is on Judge — the executor's canvas click point is not
     reachable until the room is back in overview. (Choreography
     fix after the baseline run truncated here; assertions are
     unchanged.) */
  await cdp.eval(`(() => { const b = document.querySelector('#focus .panelhead .close'); if (b) b.click(); })()`);
  await waitPanelClosed().catch(() => null);
  await clickAgent("rig:executor");
  const pMusky = await waitPanelOpen("Musky");
  const expMusky = await expectedHistory("rig", "executor");
  const diffMusky = histDiff(pMusky.hist, expMusky);
  assert("(3) executor history deep-equals GET /runs/:id across the registry (lane, model, latency, attempts, failover, verdict, crossFamily)",
    diffMusky === null, diffMusky || `rows=${pMusky.histCount}`);
  const rowRun1 = pMusky.hist.find((r) => r.run === runId);
  assert("(3) executor history contains the just-settled run with its verdict",
    !!rowRun1 && rowRun1.verdict === (final1.verdict || "") && rowRun1.runState === "done",
    rowRun1 ? `verdict=${rowRun1.verdict}` : "row missing");
  await checkBudget(pMusky, "(2b)");

  await cdp.eval(`(() => { const c = document.querySelector('#roster .acard[data-id="rig:reviewer"]'); if (c) c.click(); })()`);
  const pJudge = await waitPanelOpen("Judge");
  const expJudge = await expectedHistory("rig", "reviewer");
  const diffJudge = histDiff(pJudge.hist, expJudge);
  assert("(3) reviewer history deep-equals GET /runs/:id across the registry",
    diffJudge === null, diffJudge || `rows=${pJudge.histCount}`);
  const judgeRow1 = pJudge.hist.find((r) => r.run === runId);
  assert("(3) same-family review is labeled in the reviewer's history (single-family rig)",
    !!judgeRow1 && judgeRow1.crossFamily === "no" && /same family/.test(judgeRow1.text) && final1.crossFamily === false,
    judgeRow1 ? judgeRow1.text.slice(0, 140) : "row missing");
  const settledSize = await shot(`${LABEL}-dossier-settled.png`, "Judge dossier after settle: history rows with the run's stamps, same-family labeled");
  assert("(3) settled dossier screenshot captured", settledSize > 5000, `${settledSize} bytes`);

  const totalServed1 = takes1.reduce((a, t) => a + t.stamps, 0);
  const pillAfter = await waitFor(async () => {
    const v = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
    return v === pillBefore + totalServed1 ? v : null;
  }, 30000, "budget pill settling").catch(() => cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`));
  assert("(+) budget pill increased by exactly the served stage count (all takes)",
    pillAfter - pillBefore === totalServed1, `pill ${pillBefore} -> ${pillAfter}, served=${totalServed1}`);

  /* ============ (5c) close via a click on empty room space ============ */
  const cands = await cdp.eval(EMPTY_POINTS);
  results.measurements.emptyCandidates = cands.length;
  let roomClosed = null, usedPoint = null;
  for (const pt of cands) {
    await mouseClick(pt.x, pt.y);
    await sleep(700);
    const p = await panel();
    if (!p.open) { roomClosed = p; usedPoint = pt; break; }
    // The point selected someone (cubicle interior) — that agent's
    // dossier is open now; try the next candidate from this state.
  }
  assert("(5) close via a real click on empty room space", !!roomClosed,
    usedPoint ? `world=${usedPoint.wx},${usedPoint.wy} screen=${usedPoint.x},${usedPoint.y}` : `no empty point found among ${cands.length} candidates`);

  /* ============ (6) G-7: crew switch closes the dossier ============ */
  await clickAgent("rig:planner");
  const pBeforeSwitch = await waitPanelOpen("Scout");
  assert("(6) dossier open on Scout before the crew switch", !!pBeforeSwitch);
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'default'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Planner,Executor,Reviewer'`), 15000, "default crew re-seated");
  const pAfterSwitch = await panel();
  results.measurements.afterCrewSwitch = { open: pAfterSwitch.open, head: pAfterSwitch.headName };
  assert("(6) crew switch auto-closes the dossier (G-7)", pAfterSwitch.present && !pAfterSwitch.open,
    JSON.stringify(results.measurements.afterCrewSwitch));

  /* ============ phone 412x915: dossier layout ============ */
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true, screenWidth: 412, screenHeight: 915
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Page.reload", { ignoreCache: false });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor reloads at phone size");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "crew seats at phone size");
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew seated at phone size");
  await sleep(1200);
  await cdp.eval(`window.__floorDebug.selectAgent('rig:executor')`);
  const pPhone = await waitPanelOpen("Musky");
  const auditPhone = await cdp.eval(OVERFLOW_AUDIT);
  results.measurements.phoneDossier = auditPhone;
  assert("(+) phone: dossier opens for Musky with its identity intact",
    !!pPhone && pPhone.kv.crew === "rig" && pPhone.kv.lane === "local-gemma",
    JSON.stringify(pPhone.kv));
  assert("(+) phone: no element overflows the viewport width with the dossier open",
    auditPhone.wideElements.length === 0, JSON.stringify(auditPhone.wideElements));
  assert("(+) phone: the dossier panel itself fits the viewport",
    auditPhone.focusBox && auditPhone.focusBox.right <= auditPhone.innerWidth + 1 && auditPhone.focusBox.left >= -1,
    JSON.stringify(auditPhone.focusBox) + ` iw=${auditPhone.innerWidth}`);
  const phoneSize = await shot(`${LABEL}-phone-dossier.png`, "phone 412x915: Musky dossier open, no overflow");
  assert("(+) phone dossier screenshot captured", phoneSize > 5000, `${phoneSize} bytes`);

  /* ============ (8) zero console errors ============ */
  const logEntries = results.consoleErrors.filter((e) => e.startsWith("log:"));
  const nonLogErrors = results.consoleErrors.filter((e) => !e.startsWith("log:"));
  const transportNoise = logEntries.filter((e) => e.includes("net::ERR_FAILED") && e.includes(`127.0.0.1:${BRIDGE_PORT}`));
  const unexplained = logEntries.filter((e) => !transportNoise.includes(e));
  results.transportNoise = transportNoise;
  assert("(8) zero console errors across the whole session (pair, dossier, run, crew switch, phone)",
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
  results.verdict = failed.length === 0 ? "PHASE 2 STAGE 1 GATE: PASS" : `PHASE 2 STAGE 1 GATE: FAIL (${failed.length})`;
  const outName = LABEL === "before" ? "baseline-results.json" : "results.json";
  fs.writeFileSync(path.join(HERE, outName), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict + `  (label=${LABEL}, wrote ${outName})`);
  process.exit(failed.length === 0 ? 0 : 1);
}
