#!/usr/bin/env node
/*
 * Phase 2 Stage 2 evaluator — PHASE2-SPEC.md Stage 2 gate (the text
 * conductor: call-outs, holds, chat replies with stamps, transcript
 * persistence), run against the Phase 1 VM rehearsal rig: real
 * bridge (isolated VOKREW_HOME) + llama.cpp Gemma 3 1B as the single
 * local lane — no mocks anywhere. Same serving mechanism as the
 * Phase 1 / Stage 0 / Stage 1 evaluators: page over file://, CDP
 * Fetch interception bridging ONLY the browser's CORS enforcement
 * point against the untouched real bridge.
 *
 * The Fetch bridge-over additionally RECORDS the page's POST /chat
 * request + response as they pass through: the transcript's reply
 * stamp is deep-equaled against the real response the page itself
 * received (stamps[0], field by field) — no second chat call is
 * spent and no stamp is taken on trust.
 *
 * Assertions (task list):
 *   (1) a named task instruction creates exactly one hold naming
 *       the agent + its seat, task text verbatim (single-seat and
 *       multi-seat call-outs); NO run is created by a hold alone
 *       (bridge registry + both budget surfaces unchanged, zero
 *       /chat calls captured).
 *   (2) an instruction naming a non-existent agent ("Zebedee, do
 *       X") is flagged inline as unknown and fires nothing: no
 *       hold, no run, no chat call (registry + budgets + captured
 *       chats all unchanged).
 *   (3) a question via the conductor returns a transcript reply
 *       whose stamp deep-equals the captured POST /chat response's
 *       stamp (role, agent, lane, provider, model, family, tier,
 *       latency, attempts, failover), the request carried
 *       surface=chat + the seated crew, and the answering agent's
 *       nameplate pulse is live in the page (entity pulseUntil in
 *       the future at two samples; the other agents do not pulse).
 *       The chat budget moves by exactly the served calls (1); the
 *       coding budget does not move.
 *   (4) the transcript + holds survive a page reload
 *       (sessionStorage): same entries, same order, nothing fired
 *       by the reload itself.
 *   (5) a plain instruction with no name becomes a hold for the
 *       whole crew (standard chain).
 *   (6) budget math across the whole gate: the coding pill moves
 *       by exactly the served run stamps (a real Floor-form run,
 *       takes recorded), the chat surface by exactly the served
 *       chat calls — no phantom calls anywhere. The settled run's
 *       verdict also lands in the transcript, equal to the bridge
 *       record (same-family labeled, single-family rig).
 *   (7) zero console errors across the whole session, with the
 *       Phase 1 classification.
 *   (+) phone 412x915: conductor present, no element overflows the
 *       viewport width, transcript intact.
 *
 * Captures are named `${LABEL}-*.png` (LABEL env, default "after");
 * run once pre-fix with LABEL=before for the baseline pair (the
 * Stage 1 page has no conductor — the conductor assertions fail
 * there, and those failures ARE the baseline).
 *
 * TAB CHOREOGRAPHY (rig accommodation, disclosed — same as Stage
 * 0/1): on this 2-vCPU VM the co-located 1B lane starves when the
 * browser renders beside it, so while a chat reply or a run's
 * planner/executor stages grind, the evaluator activates a blank
 * tab (the product's shipped hidden-tab behavior applies) and
 * brings the page back to observe the results live. Takes: a run
 * that dies on the lane ("no lane could serve") is resubmitted up
 * to 3 takes, every take recorded in results.rig.
 *
 * Run:  xvfb-run -a node stage2-evaluator.mjs
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
const CDP_PORT = 9338;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const RIG_HOME = "/tmp/vokrew-s2-eval-home";
const PROFILE = "/tmp/floor-s2-eval-profile";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const LABEL = process.env.LABEL || "after";
const TASK = "Write a one-line bash command that prints the current folder path, then explain it in one short sentence.";
const TEXT_NAMED = "Scout, draft the release checklist and tag the open issues";
const TEXT_MULTI = "Musky builds the parser, Judge checks it";
const TEXT_UNKNOWN = "Zebedee, do the thing";
const TEXT_PLAIN = "Tidy the changelog and bump the version";
const QUESTION = "What does the pwd command print?";

const results = { assertions: [], consoleErrors: [], screenshots: [], rig: {}, label: LABEL, measurements: {}, capturedChats: [] };
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
const J = (x) => JSON.stringify(x);

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

/* The conductor probe: session state via the adapter's read-only
   debug surface, the rendered transcript rows with their data-*
   claims, and the holds list. On the pre-Stage-2 page none of this
   exists: the probe returns nulls and the assertions fail (the
   baseline). */
const CONDUCTOR = `(() => {
  const dbg = window.__conductorDebug;
  const log = document.getElementById('conductorLog');
  const rows = log ? [...log.querySelectorAll('[data-kind]')].map((r) => ({
    kind: r.getAttribute('data-kind'), hold: r.getAttribute('data-hold'),
    crew: r.getAttribute('data-crew'), seats: r.getAttribute('data-seats'),
    unknown: r.getAttribute('data-unknown'), role: r.getAttribute('data-role'),
    agent: r.getAttribute('data-agent'), lane: r.getAttribute('data-lane'),
    provider: r.getAttribute('data-provider'), model: r.getAttribute('data-model'),
    family: r.getAttribute('data-family'), tier: r.getAttribute('data-tier'),
    latency: r.getAttribute('data-latency'), attempts: r.getAttribute('data-attempts'),
    failover: r.getAttribute('data-failover'), run: r.getAttribute('data-run'),
    state: r.getAttribute('data-state'), verdict: r.getAttribute('data-verdict'),
    xfam: r.getAttribute('data-xfam'),
    text: r.textContent.replace(/\\s+/g, ' ').trim()
  })) : null;
  const holdRows = [...document.querySelectorAll('#holdList .holdrow')].map((r) => ({
    hold: r.getAttribute('data-hold'), crew: r.getAttribute('data-crew'),
    seats: r.getAttribute('data-seats'), text: r.textContent.replace(/\\s+/g, ' ').trim()
  }));
  const input = document.getElementById('conductorInput');
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
  return {
    present: !!log,
    state: dbg ? dbg.state() : null,
    rows, holdRows,
    holdCount: (document.getElementById('holdCount') || {}).textContent || null,
    inputDisabled: input ? input.disabled : null,
    sendText: (document.getElementById('conductorSend') || {}).textContent || null,
    formBox: box(document.getElementById('conductorForm')),
    logBox: box(log),
    inputBox: box(input)
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
  return { innerWidth: iw, innerHeight: window.innerHeight, wideElements: wide };
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
async function budgetTotal(surface) {
  const { data } = await bridgeGet("/budget?surface=" + surface);
  const lanes = (data && data.lanes) || [];
  return { total: lanes.reduce((a, l) => a + (l.used || 0), 0), lanes, day: data && data.day };
}
async function registryCount() {
  const { data } = await bridgeGet("/runs?limit=50");
  return ((data && data.runs) || []).length;
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

  /* Quiet-machine warm-up (Stage 0/1 precedent, disclosed there):
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

  /* CORS bridge-over (Phase 1 mechanism): intercept ONLY the bridge
     origin. POST /chat traffic is recorded as it passes (see the
     header): the reply stamp is judged against the real response. */
  const capturedChats = results.capturedChats;
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
      if (request.method === "POST" && /\/chat$/.test(new URL(request.url).pathname)) {
        let reqBody = null, resBody = null;
        try { reqBody = JSON.parse(request.postData || "null"); } catch { /* kept null */ }
        try { resBody = JSON.parse(buf.toString("utf8")); } catch { /* kept null */ }
        capturedChats.push({ status: resp.status, request: reqBody, response: resBody });
      }
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

  const conductor = () => cdp.eval(CONDUCTOR).catch(() => null);
  async function waitConductor(fn, timeoutMs, label) {
    return waitFor(async () => {
      const c = await conductor();
      return c && fn(c) ? c : null;
    }, timeoutMs, label).catch(() => null);
  }
  /* Type into the conductor bar like a user: focus, insert text,
     click Send (the form's own submit path). */
  async function typeConductor(text) {
    const okFocus = await cdp.eval(`(() => { const i = document.getElementById('conductorInput'); if (!i) return false; i.focus(); return true; })()`).catch(() => false);
    if (!okFocus) return false;
    await cdp.send("Input.insertText", { text });
    await cdp.eval(`document.getElementById('conductorSend').click()`).catch(() => null);
    return true;
  }

  /* ============ door + pairing (Stage 0/1 pattern) ============ */
  await cdp.send("Page.navigate", { url: PAGE_URL });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 15000, "locked room seats nobody");
  const door = await waitFor(async () => {
    const d = await cdp.eval(`(() => {
      const cs = document.getElementById('connectScreen');
      return { overlayVisible: !cs.classList.contains('hidden'), chip: document.getElementById('floorModeChip').textContent };
    })()`);
    return d.chip === "OFFLINE" ? d : null;
  }, 15000, "locked room chip settles to OFFLINE").catch(() => ({ overlayVisible: false, chip: "never settled" }));
  assert("(0) connect door up over the locked room", door.overlayVisible && door.chip === "OFFLINE", J(door));

  await cdp.eval(`(() => {
    document.getElementById('bridgeUrl').value = ${J(BRIDGE_BASE)};
    document.getElementById('pairCode').value = ${J(code)};
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
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew seated");

  /* ============ snapshot: every counter the gate will hold still ============ */
  const c0 = await conductor();
  assert("(2) conductor is present in the Floor sidebar with an empty transcript and no holds",
    !!c0 && c0.present && !!c0.state && c0.state.entries.length === 0 && c0.state.holds.length === 0 && c0.inputDisabled === false,
    c0 ? `present=${c0.present} entries=${c0.state ? c0.state.entries.length : "?"} holds=${c0.state ? c0.state.holds.length : "?"}` : "probe failed");
  const coding0 = await budgetTotal("coding");
  const chat0 = await budgetTotal("chat");
  const registry0 = await registryCount();
  const pill0 = await waitFor(async () => {
    const v = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
    return v === coding0.total ? v : null;
  }, 20000, "pill == coding ledger at snapshot").catch(() => null);
  results.measurements.snapshot = { coding: coding0.total, chat: chat0.total, registry: registry0, pill: pill0 };
  assert("(2) snapshot: the page pill reads the same coding ledger as GET /budget",
    pill0 === coding0.total, `pill=${pill0} api=${coding0.total} chat=${chat0.total} registry=${registry0}`);

  async function assertNothingFired(label, wantHolds) {
    const reg = await registryCount();
    const cod = await budgetTotal("coding");
    const cha = await budgetTotal("chat");
    assert(`${label} fires nothing: registry + both budgets unchanged, zero /chat calls`,
      reg === registry0 && cod.total === coding0.total && cha.total === chat0.total && capturedChats.length === 0,
      `registry=${reg}/${registry0} coding=${cod.total}/${coding0.total} chat=${cha.total}/${chat0.total} chats=${capturedChats.length} holds=${wantHolds}`);
  }

  /* ============ (1a) named single-seat task -> exactly one hold ============ */
  await typeConductor(TEXT_NAMED);
  const cNamed = await waitConductor((c) => c.state && c.state.holds.length === 1, 20000, "first hold created");
  const hold1 = cNamed && cNamed.state.holds[0];
  assert("(1) named task creates exactly one hold", !!hold1, hold1 ? `holds=${cNamed.state.holds.length}` : "no hold");
  assert("(1) the hold names the called-out agent and its seat",
    !!hold1 && J(hold1.seats) === J([{ role: "planner", name: "Scout" }]),
    hold1 ? J(hold1.seats) : "no hold");
  assert("(1) the hold carries the task text verbatim and the seated crew",
    !!hold1 && hold1.text === TEXT_NAMED && hold1.crew === "rig",
    hold1 ? `crew=${hold1.crew} text=${J(hold1.text)}` : "no hold");
  const holdEntry1 = cNamed && cNamed.state.entries.find((e) => e.kind === "hold");
  assert("(1) the transcript records the hold as issued (one hold entry, same id, same text)",
    !!holdEntry1 && !!hold1 && holdEntry1.holdId === hold1.id && holdEntry1.text === TEXT_NAMED &&
    J(holdEntry1.seats) === J(hold1.seats),
    holdEntry1 ? `entry=${holdEntry1.holdId} hold=${hold1 && hold1.id}` : "no transcript hold entry");
  const domHold1 = cNamed && cNamed.rows && cNamed.rows.find((r) => r.kind === "hold");
  assert("(1) the holds list + transcript render the hold (DOM rows carry its id, crew, seats)",
    !!cNamed && cNamed.holdRows.length === 1 && cNamed.holdRows[0].hold === (hold1 && hold1.id) &&
    cNamed.holdRows[0].crew === "rig" && cNamed.holdRows[0].seats === "planner" &&
    !!domHold1 && domHold1.hold === (hold1 && hold1.id) && /Scout/.test(domHold1.text) && /Scout/.test(cNamed.holdRows[0].text) &&
    cNamed.holdCount === "1 held",
    cNamed ? `holdRows=${J(cNamed.holdRows)} count=${cNamed.holdCount}` : "probe failed");
  await assertNothingFired("(1)", 1);
  const holdShot = await shot(`${LABEL}-conductor-hold.png`, "conductor: named call-out to Scout became a hold; transcript + holds list show it");
  assert("(1) conductor hold screenshot captured", holdShot > 5000, `${holdShot} bytes`);

  /* ============ (1b) multi-seat call-out -> one hold, the right seats ============ */
  await typeConductor(TEXT_MULTI);
  const cMulti = await waitConductor((c) => c.state && c.state.holds.length === 2, 20000, "second hold created");
  const hold2 = cMulti && cMulti.state.holds[1];
  assert("(1) multi-seat call-out creates exactly one more hold, naming both seats in order",
    !!hold2 && hold2.text === TEXT_MULTI && J(hold2.seats) === J([{ role: "executor", name: "Musky" }, { role: "reviewer", name: "Judge" }]),
    hold2 ? J(hold2.seats) : "no second hold");
  await assertNothingFired("(1b)", 2);

  /* ============ (2) unknown name: flagged inline, fires nothing ============ */
  await typeConductor(TEXT_UNKNOWN);
  const cFlag = await waitConductor((c) => c.state && c.state.entries.some((e) => e.kind === "flag"), 20000, "unknown-name flag entry");
  const flag = cFlag && cFlag.state.entries.find((e) => e.kind === "flag");
  assert("(2) the unknown call-out is flagged in the transcript, naming the unknown",
    !!flag && J(flag.unknown) === J(["Zebedee"]) && flag.text === TEXT_UNKNOWN,
    flag ? J(flag.unknown) : "no flag entry");
  const domFlag = cFlag && cFlag.rows && cFlag.rows.find((r) => r.kind === "flag");
  assert("(2) the flag renders inline in the transcript (DOM row names Zebedee, says nothing was fired)",
    !!domFlag && domFlag.unknown === "Zebedee" && /Zebedee/.test(domFlag.text) && /nothing was fired/i.test(domFlag.text),
    domFlag ? domFlag.text.slice(0, 140) : "no flag row");
  assert("(2) no hold was created for the unknown name",
    !!cFlag && cFlag.state.holds.length === 2, cFlag ? `holds=${cFlag.state.holds.length}` : "probe failed");
  await assertNothingFired("(2)", 2);
  const flagShot = await shot(`${LABEL}-unknown-flag.png`, "conductor: 'Zebedee, do the thing' flagged inline — no crewmate by that name, nothing fired");
  assert("(2) unknown-flag screenshot captured", flagShot > 5000, `${flagShot} bytes`);

  /* ============ (5) plain instruction, no name -> hold for the crew ============ */
  await typeConductor(TEXT_PLAIN);
  const cPlain = await waitConductor((c) => c.state && c.state.holds.length === 3, 20000, "third hold created");
  const hold3 = cPlain && cPlain.state.holds[2];
  assert("(5) a plain instruction becomes a hold for the whole crew (no seats called out, standard chain)",
    !!hold3 && hold3.text === TEXT_PLAIN && hold3.crew === "rig" && J(hold3.seats) === J([]),
    hold3 ? `crew=${hold3.crew} seats=${J(hold3.seats)}` : "no third hold");
  await assertNothingFired("(5)", 3);

  /* ============ (3) a question: chat reply, real stamp, nameplate pulse ============ */
  await typeConductor(QUESTION);
  await hidePage(); // lane relief while the single chat stage grinds (see header)
  const cReply = await waitConductor((c) => c.state && c.state.entries.some((e) => e.kind === "reply"), 300000, "chat reply lands in the transcript");
  await showPage();
  const reply = cReply && cReply.state.entries.find((e) => e.kind === "reply");
  assert("(3) the question returns a reply in the conductor transcript",
    !!reply && typeof reply.text === "string" && reply.text.length > 0,
    reply ? `reply=${J(reply.text).slice(0, 90)}` : "no reply entry");
  const cap = capturedChats[0];
  assert("(3) exactly one POST /chat was fired, carrying the question verbatim, surface=chat, the seated crew",
    capturedChats.length === 1 && !!cap && cap.request && cap.request.message === QUESTION &&
    cap.request.surface === "chat" && cap.request.crew === "rig" && cap.status === 200 &&
    !!cap.response && cap.response.ok === true && cap.response.surface === "chat",
    `chats=${capturedChats.length} req=${cap ? J(cap.request) : "none"} status=${cap ? cap.status : "?"}`);
  const capStamp = cap && cap.response && (cap.response.stamps || [])[0];
  const stampEq = !!reply && !!capStamp && !!reply.stamp &&
    reply.stamp.role === capStamp.role && reply.stamp.agent === (capStamp.agent || null) &&
    reply.stamp.lane === capStamp.lane && reply.stamp.provider === capStamp.provider &&
    reply.stamp.model === capStamp.model && reply.stamp.family === capStamp.family &&
    reply.stamp.tier === capStamp.tier && reply.stamp.latencyMs === capStamp.latencyMs &&
    reply.stamp.failover === !!capStamp.failover &&
    (reply.stamp.attempts || []).length === (capStamp.attempts || []).length;
  assert("(3) the transcript reply's stamp deep-equals the real /chat response stamp (role, agent, lane, provider, model, family, tier, latency, attempts, failover)",
    stampEq, `entry=${J(reply && reply.stamp)} response=${J(capStamp)}`);
  assert("(3) the answering stage is the crew's executor, named by the bridge (Musky on local-gemma/gemma-local)",
    !!capStamp && capStamp.role === "executor" && capStamp.agent === "Musky" &&
    capStamp.lane === "local-gemma" && capStamp.model === "gemma-local",
    J(capStamp));
  const domReply = cReply && cReply.rows && cReply.rows.find((r) => r.kind === "reply");
  assert("(3) the rendered reply row carries the same stamp as data attributes",
    !!domReply && !!capStamp && domReply.role === capStamp.role && domReply.agent === (capStamp.agent || "") &&
    domReply.lane === capStamp.lane && domReply.model === capStamp.model && domReply.latency === String(capStamp.latencyMs) &&
    domReply.attempts === String((capStamp.attempts || []).length) && domReply.failover === (capStamp.failover ? "1" : "0"),
    domReply ? J({ role: domReply.role, agent: domReply.agent, lane: domReply.lane, model: domReply.model, latency: domReply.latency }) : "no reply row");
  /* The nameplate pulse: entity state in the page, sampled twice —
     the adapter refreshes it on the poll cadence while the reply
     is the latest, so it must still be live seconds later. The
     other agents must NOT pulse. */
  const pulseProbe = () => cdp.eval(`(() => {
    const ents = window.__floorDebug.ents;
    const now = Date.now();
    const get = (id) => { const e = ents[id]; return e && e.pulseUntil ? e.pulseUntil - now : null; };
    return { executor: get('rig:executor'), planner: get('rig:planner'), reviewer: get('rig:reviewer') };
  })()`).catch(() => null);
  const pulse1 = await pulseProbe();
  await sleep(3200);
  const pulse2 = await pulseProbe();
  results.measurements.pulse = { first: pulse1, second: pulse2 };
  assert("(3) the answering agent's nameplate pulse is live in the page (pulseUntil ahead of the clock at two samples)",
    !!pulse1 && !!pulse2 && pulse1.executor > 0 && pulse2.executor > 0,
    J(results.measurements.pulse));
  assert("(3) only the answerer pulses — planner and reviewer nameplates stay quiet",
    !!pulse1 && pulse1.executor > 0 && !(pulse1.planner > 0) && !(pulse1.reviewer > 0) && !!pulse2 && !(pulse2.planner > 0) && !(pulse2.reviewer > 0),
    J(results.measurements.pulse));
  const chat1 = await budgetTotal("chat");
  const codingMid = await budgetTotal("coding");
  assert("(3)/(6) the chat budget moved by exactly the served calls (1) and the coding budget did not move",
    chat1.total === chat0.total + 1 && codingMid.total === coding0.total,
    `chat ${chat0.total} -> ${chat1.total}; coding ${coding0.total} -> ${codingMid.total}`);
  const replyShot = await shot(`${LABEL}-chat-reply.png`, "conductor: question answered in the transcript with the real chat stamp; Musky's nameplate pulses");
  assert("(3) chat reply screenshot captured", replyShot > 5000, `${replyShot} bytes`);

  /* ============ (4) reload: transcript + holds persist, nothing fires ============ */
  const preReload = await conductor();
  const entrySig = (c) => ((c && c.state && c.state.entries) || []).map((e) => [e.kind, e.holdId || "", e.text || "", J(e.seats || []), J(e.unknown || []),
    e.stamp ? [e.stamp.role, e.stamp.agent, e.stamp.lane, e.stamp.model, e.stamp.latencyMs].join("/") : "",
    e.runId || "", e.verdict || ""].join(":"));
  const holdSig = (c) => ((c && c.state && c.state.holds) || []).map((h) => [h.id, h.text, h.crew, J(h.seats)].join(":"));
  const preEntries = entrySig(preReload), preHolds = holdSig(preReload);
  results.measurements.preReload = { entries: preEntries.length, holds: preHolds.length };
  await cdp.send("Page.reload", { ignoreCache: false });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor reloads");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "crew re-seats after reload");
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 20000, "rig crew restored after reload");
  const cReload = await waitConductor((c) => c.state && c.state.entries.length === preEntries.length, 20000, "transcript restored after reload");
  assert("(4) the transcript survives the reload — same entries, same order (sessionStorage)",
    preEntries.length === 7 && !!cReload && !!cReload.state && J(entrySig(cReload)) === J(preEntries),
    `pre=${preEntries.length} post=${cReload && cReload.state ? cReload.state.entries.length : "none"}`);
  assert("(4) the holds survive the reload — same holds, same seats, still pending",
    preHolds.length === 3 && !!cReload && !!cReload.state && J(holdSig(cReload)) === J(preHolds) && cReload.holdRows.length === preHolds.length && cReload.holdCount === preHolds.length + " held",
    `pre=${preHolds.length} post=${cReload && cReload.state ? cReload.state.holds.length : "none"}`);
  const regAfterReload = await registryCount();
  const codingAfterReload = await budgetTotal("coding");
  const chatAfterReload = await budgetTotal("chat");
  assert("(4) the reload itself fired nothing (registry + budgets unchanged)",
    regAfterReload === registry0 && codingAfterReload.total === coding0.total && chatAfterReload.total === chat1.total,
    `registry=${regAfterReload}/${registry0} coding=${codingAfterReload.total}/${coding0.total} chat=${chatAfterReload.total}/${chat1.total}`);
  const reloadShot = await shot(`${LABEL}-after-reload.png`, "after reload: transcript + 3 holds restored from sessionStorage, nothing fired");
  assert("(4) post-reload screenshot captured", reloadShot > 5000, `${reloadShot} bytes`);

  /* ============ (6) a real run: verdict lands in the transcript, budget math ============ */
  const knownIds = new Set(((await bridgeGet("/runs?limit=50")).data.runs || []).map((r) => r.id));
  const findNewRun = async () => {
    const l = await bridgeGet("/runs?limit=10");
    return (l.data.runs || []).find((r) => r.task === TASK && r.crew === "rig" && !knownIds.has(r.id)) || null;
  };
  const submitFromPage = async () => {
    await waitFor(() => cdp.eval(`!document.getElementById('floorRunBtn').disabled`), 20000, "Run button re-enabled");
    await cdp.eval(`(() => { document.getElementById('floorRunTask').value = ${J(TASK)}; })()`);
    await cdp.eval(`document.getElementById('floorRunBtn').click()`);
    return waitFor(findNewRun, 20000, "run registered on the bridge");
  };
  const started = await submitFromPage();
  let runId = started.id;
  knownIds.add(runId);
  results.rig.gateRun = runId;
  assert("(6) gate run submitted from the Floor form", !!runId, runId);
  const takes = [];
  let final = null;
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
    if (!settledRec) settledRec = await waitRunSettled(runId, 420000).catch(() => bridgeRun(runId));
    takes.push({ id: runId, state: settledRec.state, stamps: (settledRec.stamps || []).length, error: settledRec.error || null });
    final = settledRec;
    if (settledRec.state === "done") break;
    if (take === 3 || !/no lane could serve/.test(settledRec.error || "")) break;
    note(`(6) gate run take ${take} died on the lane (rig contention, G-9) — resubmitting`, settledRec.error || "");
    const again = await submitFromPage();
    runId = again.id;
    knownIds.add(runId);
    results.rig.gateRun = runId;
  }
  results.rig.gateRunTakes = takes;
  assert("(6) the gate run settles done on the bridge", !!final && final.state === "done",
    final ? `verdict=${final.verdict} stamps=${(final.stamps || []).length}` : "no record");
  const cVerdict = await waitConductor((c) => c.state && c.state.entries.some((e) => e.kind === "verdict" && e.runId === runId), 30000, "verdict entry lands in the transcript");
  const vEntry = cVerdict && cVerdict.state.entries.find((e) => e.kind === "verdict" && e.runId === runId);
  assert("(6) the settled run's verdict lands in the conductor transcript, equal to the bridge record",
    !!vEntry && !!final && vEntry.state === "done" && vEntry.verdict === (final.verdict || null) &&
    vEntry.crossFamily === final.crossFamily && vEntry.calls === (final.stamps || []).length,
    vEntry ? `entry verdict=${vEntry.verdict} xfam=${vEntry.crossFamily} calls=${vEntry.calls}` : "no verdict entry");
  assert("(6) the same-family review is labeled in the transcript verdict (single-family rig)",
    !!vEntry && !!final && final.crossFamily === false && vEntry.crossFamily === false,
    `record crossFamily=${final && final.crossFamily}`);
  const domVerdict = cVerdict && cVerdict.rows && cVerdict.rows.find((r) => r.kind === "verdict" && r.run === runId);
  assert("(6) the verdict renders as a transcript row carrying the run id + verdict + family label",
    !!domVerdict && !!final && domVerdict.verdict === (final.verdict || "") && domVerdict.xfam === "no",
    domVerdict ? J({ run: domVerdict.run, verdict: domVerdict.verdict, xfam: domVerdict.xfam }) : "no verdict row");
  const totalServed = takes.reduce((a, t) => a + t.stamps, 0);
  const codingFinal = await budgetTotal("coding");
  const chatFinal = await budgetTotal("chat");
  const pillFinal = await waitFor(async () => {
    const v = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
    return v === codingFinal.total ? v : null;
  }, 30000, "pill settles to the coding ledger").catch(() => cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`));
  assert("(6) budget math across the gate: coding moved by exactly the served run stamps (all takes), chat by exactly the one served chat call — no phantom calls",
    codingFinal.total - coding0.total === totalServed && chatFinal.total - chat0.total === 1,
    `coding ${coding0.total} -> ${codingFinal.total} (served ${totalServed}); chat ${chat0.total} -> ${chatFinal.total} (served 1)`);
  assert("(6) the page pill equals the bridge's coding ledger at the end",
    pillFinal === codingFinal.total, `pill=${pillFinal} api=${codingFinal.total}`);

  /* ============ phone 412x915: conductor layout ============ */
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true, screenWidth: 412, screenHeight: 915
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Page.reload", { ignoreCache: false });
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor reloads at phone size");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "crew seats at phone size");
  await sleep(1500);
  const auditPhone = await cdp.eval(OVERFLOW_AUDIT);
  const cPhone = await conductor();
  results.measurements.phone = { audit: auditPhone, conductor: cPhone && { present: cPhone.present, entries: cPhone.state ? cPhone.state.entries.length : null, holds: cPhone.state ? cPhone.state.holds.length : null, formBox: cPhone.formBox, inputBox: cPhone.inputBox } };
  assert("(+) phone: no element overflows the viewport width (conductor included)",
    auditPhone.wideElements.length === 0, J(auditPhone.wideElements));
  assert("(+) phone: the conductor bar fits the viewport and the session transcript is intact",
    !!cPhone && cPhone.present && !!cPhone.formBox && cPhone.formBox.right <= auditPhone.innerWidth + 1 && cPhone.formBox.left >= -1 &&
    !!cPhone.inputBox && cPhone.inputBox.right <= auditPhone.innerWidth + 1 &&
    !!cPhone.state && cPhone.state.holds.length === 3,
    J(results.measurements.phone.conductor));
  const phoneShot = await shot(`${LABEL}-phone-conductor.png`, "phone 412x915: conductor bar + transcript in the stacked sidebar, no overflow");
  assert("(+) phone conductor screenshot captured", phoneShot > 5000, `${phoneShot} bytes`);

  /* ============ (7) zero console errors ============ */
  const logEntries = results.consoleErrors.filter((e) => e.startsWith("log:"));
  const nonLogErrors = results.consoleErrors.filter((e) => !e.startsWith("log:"));
  const transportNoise = logEntries.filter((e) => e.includes("net::ERR_FAILED") && e.includes(`127.0.0.1:${BRIDGE_PORT}`));
  const unexplained = logEntries.filter((e) => !transportNoise.includes(e));
  results.transportNoise = transportNoise;
  assert("(7) zero console errors across the whole session (pair, holds, flag, chat, reload, run, phone)",
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
  results.verdict = failed.length === 0 ? "PHASE 2 STAGE 2 GATE: PASS" : `PHASE 2 STAGE 2 GATE: FAIL (${failed.length})`;
  const outName = LABEL === "before" ? "baseline-results.json" : "results.json";
  fs.writeFileSync(path.join(HERE, outName), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict + `  (label=${LABEL}, wrote ${outName})`);
  process.exit(failed.length === 0 ? 0 : 1);
}
