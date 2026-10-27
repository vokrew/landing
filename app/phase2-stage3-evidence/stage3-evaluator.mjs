#!/usr/bin/env node
/*
 * Phase 2 Stage 3 evaluator — PHASE2-SPEC.md Stage 3 gate (approvals
 * as holds in the office: approve / edit / dismiss, reload
 * persistence, the top-bar badge, retry-as-hold, stale crews), run
 * against the Phase 1 VM rehearsal rig: real bridge (isolated
 * VOKREW_HOMEs) + llama.cpp Gemma 3 1B as the single local lane —
 * no mocks anywhere. Same serving mechanism as the Phase 1 /
 * Stage 0 / 1 / 2 evaluators: page over file://, CDP Fetch
 * interception bridging ONLY the browser's CORS enforcement point
 * against the untouched real bridge.
 *
 * Verdict vocabulary note (bridge contract, src/core.js
 * parseVerdict): this bridge returns APPROVED | CHANGES | UNKNOWN —
 * there is no REJECTED literal. CHANGES is the reviewer's rejection
 * ("Reply starting with APPROVED or CHANGES"). The spec's
 * "REJECTED" case is therefore exercised as a CHANGES verdict,
 * forced on the rig by a second bridge home whose reviewer carries
 * standing drill instructions to always open with CHANGES (a crew
 * configuration, not a lane mock: the same real Gemma 3 1B serves
 * every stage; smoke-tested before this evaluator was written —
 * first take settled CHANGES in 83 s).
 *
 * Stale-crew method (per the stage brief): a hold is created for
 * crew "rig" on bridge A; bridge A is then replaced on the same
 * port by a fresh bridge whose crews.json defines only "default".
 * The page re-pairs through its own form; the hold's crew is gone
 * from GET /crews, so the hold must render stale and dismiss-only.
 *
 * Budget accounting: the bridge ledger persists per VOKREW_HOME;
 * the run registry is in-memory and resets on restart. Expected
 * coding total at any checkpoint = snapshot + banked (stamps of
 * every run settled on earlier bridge instances, tallied before
 * each kill) + stamps of every record in the current registry.
 * The chat surface must never move (no conductor questions here).
 *
 * Assertions:
 *   (0) connect door + pairing through the page form.
 *   (A) approve/edit/dismiss on the main bridge: hold card actions
 *       + office noticeboard + badge; hold carries no stamps or
 *       verdict; creation fires nothing; the hold survives a reload
 *       unfired; approve fires a run whose bridge record carries
 *       the held task verbatim + the held crew, clears the hold,
 *       zeroes the badge, and logs the firing in the transcript;
 *       the run settles and the coding ledger moves by exactly the
 *       served stamps; edit rewrites the task in place and the
 *       approved run's record carries the EDITED text; dismiss
 *       clears the hold and the transcript notes the dismissal.
 *   (B) rejection: a Floor-form run on the reject rig settles
 *       CHANGES (takes recorded); a retry-as-hold control is
 *       offered (transcript verdict row + run card) and creates
 *       exactly one hold carrying the original task text, firing
 *       nothing; the control is one-shot; dismiss clears it with
 *       a transcript note.
 *   (C) stale crew: after the bridge swap the hold renders stale
 *       in both surfaces, offers no approve/edit, and dismiss
 *       still works; nothing fires on the new bridge.
 *   (D) phone 412x915 with a hold pending: no horizontal overflow,
 *       hold card + noticeboard inside the viewport width.
 *   (E) zero console errors across the whole session.
 *
 * Captures are named `${LABEL}-*.png` (LABEL env, default "after");
 * run once pre-fix with LABEL=before for the baseline pair (the
 * Stage 2 page has no hold actions, badge, noticeboard, retry or
 * stale rendering — those assertions fail there, and those
 * failures ARE the baseline). Phase bodies are fault-isolated so
 * the baseline run records its failures instead of aborting.
 *
 * TAB CHOREOGRAPHY (rig accommodation, disclosed — same as Stage
 * 0/1/2): on this 2-vCPU VM the co-located 1B lane starves when
 * the browser renders beside it, so while a run's planner/executor
 * stages grind, the evaluator activates a blank tab (the product's
 * shipped hidden-tab behavior applies) and brings the page back
 * for the reviewer stage and the settle.
 *
 * Run:  xvfb-run -a node stage3-evaluator.mjs
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
const CDP_PORT = 9339;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const HOME_MAIN = "/tmp/vokrew-s3-eval-home";
const HOME_NORIG = "/tmp/vokrew-s3-eval-home-norig";
const PROFILE = "/tmp/floor-s3-eval-profile";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const LABEL = process.env.LABEL || "after";
const TASK = "Write a one-line bash command that prints the current folder path, then explain it in one short sentence.";
const TEXT_NAMED = "Scout, draft the release checklist and tag the open issues";
const TEXT_PLAIN = "Tidy the changelog and bump the version";
const EDITED_TEXT = "Tidy the changelog, bump the version, and note the date";
const TEXT_DISMISS = "Scout, sweep the risers and log the count";
const TEXT_STALE = "Scout, final sweep of the risers before we lock up";

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

const REJECT_INSTRUCTIONS = "Drill rule: you are exercising the rejection path. You must ALWAYS begin your reply with the word CHANGES, then give one short reason the work is not approved yet. Never approve in this drill.";

function crewsJson(reject) {
  return JSON.stringify({
    default: { roles: {} },
    rig: { roles: {
      planner: { name: "Scout", instructions: "Plan small, verifiable steps.", lanes: ["local-gemma"] },
      executor: { name: "Musky", instructions: "Do the work plainly and completely.", lanes: ["local-gemma"] },
      reviewer: { name: "Judge", instructions: reject ? REJECT_INSTRUCTIONS : "Be strict. Flag anything unverified.", lanes: ["local-gemma"] }
    } }
  }, null, 2) + "\n";
}

function writeHome(dir, { reject = false, withRig = true } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({
    lanes: [{
      id: "local-gemma", provider: "openai-compatible", family: "gemma",
      tier: "local", model: "gemma-local",
      baseUrl: `http://127.0.0.1:${LLAMA_PORT}/v1`, cap: null
    }],
    roles: { planner: ["local-gemma"], executor: ["local-gemma"], reviewer: ["local-gemma"] }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "crews.json"),
    withRig ? crewsJson(reject) : JSON.stringify({ default: { roles: {} } }, null, 2) + "\n");
}

function startBridge(home) {
  const proc = spawn("node", ["src/cli.js", "serve", "--port", String(BRIDGE_PORT)], {
    cwd: APP_REPO, env: { ...process.env, VOKREW_HOME: home }, stdio: ["ignore", "pipe", "pipe"]
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

/* ---------------- page probes ---------------- */

/* The Stage 3 probe: conductor session state (adapter debug
   surface), the rendered hold cards in BOTH surfaces (sidebar
   list + office noticeboard) with their action controls, the
   top-bar badge, transcript rows, and the run card's retry
   control. On the pre-Stage-3 page the actions/badge/noticeboard/
   retry/stale fields are absent and the assertions fail (the
   baseline). */
const PROBE = `(() => {
  const dbg = window.__conductorDebug;
  const card = (r) => ({
    hold: r.getAttribute('data-hold'), crew: r.getAttribute('data-crew'),
    seats: r.getAttribute('data-seats'), stale: r.getAttribute('data-stale'),
    actions: [...r.querySelectorAll('[data-hold-action]')].map((b) => b.getAttribute('data-hold-action') + (b.disabled ? ':disabled' : '')),
    textarea: (r.querySelector('textarea') || {}).value ?? null,
    text: r.textContent.replace(/\\s+/g, ' ').trim()
  });
  const log = document.getElementById('conductorLog');
  const rows = log ? [...log.querySelectorAll('[data-kind]')].map((r) => ({
    kind: r.getAttribute('data-kind'), hold: r.getAttribute('data-hold'),
    crew: r.getAttribute('data-crew'), seats: r.getAttribute('data-seats'),
    run: r.getAttribute('data-run'), verdict: r.getAttribute('data-verdict'),
    retry: r.querySelector('[data-retry-run]') ? r.querySelector('[data-retry-run]').getAttribute('data-retry-run') : null,
    text: r.textContent.replace(/\\s+/g, ' ').trim()
  })) : null;
  const nb = document.getElementById('noticeboard');
  const nbRect = nb ? nb.getBoundingClientRect() : null;
  const cardRetry = document.querySelector('#floorCardBody [data-retry-run]');
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
  return {
    state: dbg ? dbg.state() : null,
    rows,
    badge: (document.getElementById('holdBadge') || {}).textContent ?? null,
    holdCount: (document.getElementById('holdCount') || {}).textContent || null,
    sidebarCards: [...document.querySelectorAll('#holdList .holdrow')].map(card),
    nb: nb ? { hidden: nb.classList.contains('hidden'), box: box(nb),
      cards: [...nb.querySelectorAll('.nbcard')].map(card) } : null,
    cardRetry: cardRetry ? cardRetry.getAttribute('data-retry-run') : null,
    crewOptions: [...document.querySelectorAll('#floorRunCrew option')].map((o) => o.value),
    inputDisabled: (document.getElementById('conductorInput') || {}).disabled ?? null
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

let llamaProc = null, bridge = null, chromeProc = null, token = null, cdp = null;
let bankedStamps = 0;         // served stamps settled on earlier bridge instances
let coding0 = 0, chat0 = 0;   // ledger snapshot after the warm-up restart
const authH = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
async function bridgeGet(p) {
  const r = await fetch(BRIDGE_BASE + p, { headers: authH() });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function bridgeRun(id) {
  const { data } = await bridgeGet("/runs/" + id);
  return data && data.run;
}
async function budgetTotal(surface) {
  const { data } = await bridgeGet("/budget?surface=" + surface);
  const lanes = (data && data.lanes) || [];
  return lanes.reduce((a, l) => a + (l.used || 0), 0);
}
async function registryList() {
  const { data } = await bridgeGet("/runs?limit=50");
  return (data && data.runs) || [];
}
async function registryCount() { return (await registryList()).length; }
async function servedStampsTotal() {
  const sums = await registryList();
  let total = 0;
  for (const s of sums) {
    const rec = await bridgeRun(s.id);
    total += rec ? (rec.stamps || []).length : 0;
  }
  return total;
}
async function expectedCoding() { return coding0 + bankedStamps + (await servedStampsTotal()); }
async function waitRunSettled(id, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const rec = await bridgeRun(id);
    if (rec && rec.state !== "running") return rec;
    if (Date.now() - t0 > timeoutMs) throw new Error("run " + id + " did not settle in " + timeoutMs + "ms");
    await sleep(600);
  }
}

const probe = () => cdp.eval(PROBE).catch(() => null);
async function waitProbe(fn, timeoutMs, label) {
  const v = await waitFor(async () => {
    const p = await probe();
    return p && fn(p) ? p : null;
  }, timeoutMs, label).catch(() => null);
  return v;
}
async function typeConductor(text) {
  const okFocus = await cdp.eval(`(() => { const i = document.getElementById('conductorInput'); if (!i) return false; i.focus(); return true; })()`).catch(() => false);
  if (!okFocus) return false;
  await cdp.send("Input.insertText", { text });
  await cdp.eval(`document.getElementById('conductorSend').click()`).catch(() => null);
  return true;
}
async function clickHoldAction(holdId, action, surface = "sidebar") {
  return cdp.eval(`(() => {
    const root = ${surface === "nb" ? "document.getElementById('noticeboard')" : "document.getElementById('holdList')"};
    if (!root) return false;
    const cardEl = [...root.querySelectorAll('[data-hold]')].find((r) => r.getAttribute('data-hold') === ${J(holdId)});
    if (!cardEl) return false;
    const btn = cardEl.querySelector('[data-hold-action="${action}"]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  })()`).catch(() => false);
}
async function clickRetry(surface) {
  return cdp.eval(`(() => {
    const root = ${surface === "card" ? "document.getElementById('floorCardBody')" : "document.getElementById('conductorLog')"};
    if (!root) return false;
    const btn = root.querySelector('[data-retry-run]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  })()`).catch(() => false);
}

/* Tab choreography (see header). */
let pageTargetId = null, blankTargetId = null;
async function hidePage() {
  if (!blankTargetId) {
    const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })).json();
    blankTargetId = t.id;
  }
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${blankTargetId}`).catch(() => null);
  await sleep(400);
}
async function showPage() {
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${pageTargetId}`).catch(() => null);
  await sleep(400);
}
/* Watch a run the page is tracking: hide the page while the early
   stages grind, bring it back at the reviewer stage so the room +
   transcript observe the settle live; return the settled record. */
async function settleWatched(runId, timeoutMs = 420000) {
  await hidePage();
  const t0 = Date.now();
  let rec = null;
  while (Date.now() - t0 < timeoutMs) {
    rec = await bridgeRun(runId);
    if (rec && rec.state !== "running") break;
    if (rec && rec.phase === "reviewer") break;
    await sleep(500);
  }
  await showPage();
  return waitRunSettled(runId, timeoutMs);
}

async function shot(file, noteText) {
  const p = path.join(HERE, file);
  const s = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(p, Buffer.from(s.data, "base64"));
  results.screenshots.push({ file, note: noteText });
  return fs.statSync(p).size;
}

async function pairThroughForm(code) {
  await cdp.eval(`(() => {
    document.getElementById('bridgeUrl').value = ${J(BRIDGE_BASE)};
    document.getElementById('pairCode').value = ${J(code)};
  })()`);
  await cdp.eval(`document.getElementById('pairBtn').click()`);
  await waitFor(() => cdp.eval(`document.getElementById('connectScreen').classList.contains('hidden')`), 25000, "door drops after pairing");
  token = await cdp.eval(`localStorage.getItem('vokrew.token')`);
  return !!token;
}
async function seatRigCrew() {
  await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, "crew picker populated");
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 20000, "rig crew seated");
}
async function assertBudgetRule(label) {
  const coding = await budgetTotal("coding");
  const chat = await budgetTotal("chat");
  const expected = await expectedCoding();
  assert(`${label} budget rule: the coding ledger moved by exactly the served stamps of every settled run, the chat ledger never moved`,
    coding === expected && chat === chat0,
    `coding=${coding} expected=${expected} (snapshot ${coding0} + banked ${bankedStamps}); chat=${chat}/${chat0}`);
  return coding;
}

try {
  writeHome(HOME_MAIN, { reject: false, withRig: true });
  writeHome(HOME_NORIG, { reject: false, withRig: false });

  llamaProc = spawn(LLAMA_BIN, ["-m", MODEL, "--alias", "gemma-local", "--host", "127.0.0.1", "--port", String(LLAMA_PORT)],
    { stdio: "ignore" });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/models`).catch(() => null);
    return r && r.ok;
  }, 60000, "llama-server models");
  results.rig.llama = `gemma-local on :${LLAMA_PORT}`;

  bridge = startBridge(HOME_MAIN);

  /* Quiet-machine warm-up (Stage 0/1/2 precedent, disclosed there):
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
    let warm = null;
    for (let attempt = 1; attempt <= 2 && !warm; attempt++) {
      const post = await fetch(BRIDGE_BASE + "/run", {
        method: "POST", headers: wH, body: JSON.stringify({ task: TASK, crew: "rig" })
      }).then((r) => r.json()).catch(() => null);
      if (post && post.runId) {
        const t0 = Date.now();
        for (;;) {
          const rr = await fetch(BRIDGE_BASE + "/runs/" + post.runId, { headers: wH }).then((r) => r.json()).catch(() => null);
          const rec = rr && rr.run;
          if (rec && rec.state !== "running") {
            if (rec.state === "done") warm = { attempt, verdict: rec.verdict, secs: Math.round((Date.now() - t0) / 1000) };
            break;
          }
          if (Date.now() - t0 > 300000) break;
          await sleep(700);
        }
      }
    }
    results.rig.quietWarmUpRun = warm;
    console.log(warm ? `NOTE  quiet warm-up run done in ${warm.secs}s (attempt ${warm.attempt})` : "NOTE  quiet warm-up run FAILED twice");
    const wChat = await fetch(BRIDGE_BASE + "/chat", {
      method: "POST", headers: wH, body: JSON.stringify({ message: "Reply with the single word: ready" })
    }).then((r) => r.json()).catch(() => null);
    results.rig.warmUpChat = !!(wChat && wChat.ok);
    try { bridge.proc.kill("SIGKILL"); } catch { /* restarted below */ }
    await sleep(900);
    bridge = startBridge(HOME_MAIN);
  }
  const code = await bridgePairCode(bridge);
  results.rig.bridge = `bridge on :${BRIDGE_PORT}, homes ${HOME_MAIN} + ${HOME_NORIG}`;

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
  pageTargetId = target.id;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  cdp = new CDP(ws);

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
  /* CORS bridge-over (Phase 1 mechanism): intercept ONLY the
     bridge origin; requests pass through to the real bridge. */
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

  /* ============ (0) door + pairing ============ */
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
  assert("(0) paired through the page form", await pairThroughForm(code));
  await seatRigCrew();

  /* Ledger snapshot (the warm-up run + chat are inside it). */
  coding0 = await budgetTotal("coding");
  chat0 = await budgetTotal("chat");
  const registry0 = await registryCount();
  const pill0 = await waitFor(async () => {
    const v = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
    return v === coding0 ? v : null;
  }, 20000, "pill == coding ledger at snapshot").catch(() => null);
  results.measurements.snapshot = { coding: coding0, chat: chat0, registry: registry0, pill: pill0 };
  assert("(A0) snapshot: the page pill reads the same coding ledger as GET /budget, registry empty after the restart",
    pill0 === coding0 && registry0 === 0, `pill=${pill0} api=${coding0} chat=${chat0} registry=${registry0}`);

  /* ============ (A) holds become actionable ============ */
  try {
    await typeConductor(TEXT_NAMED);
    const pHold = await waitProbe((p) => p.state && p.state.holds.length === 1, 20000, "first hold created");
    const hold1 = pHold && pHold.state.holds[0];
    assert("(A1) the named task still creates exactly one hold (Stage 2 behavior intact)",
      !!hold1 && hold1.text === TEXT_NAMED && hold1.crew === "rig", hold1 ? `id=${hold1.id}` : "no hold");
    const card1 = pHold && pHold.sidebarCards.find((c) => c.hold === (hold1 && hold1.id));
    assert("(A1) the hold card offers Approve / Edit / Dismiss and is not stale",
      !!card1 && card1.actions.includes("approve") && card1.actions.includes("edit") && card1.actions.includes("dismiss") &&
      card1.stale !== "1",
      card1 ? `actions=${J(card1.actions)} stale=${card1.stale}` : "no sidebar card");
    assert("(A2) the office noticeboard is visible and renders the same hold as a card with the same actions",
      !!pHold && !!pHold.nb && !pHold.nb.hidden && pHold.nb.cards.length === 1 &&
      pHold.nb.cards[0].hold === (hold1 && hold1.id) && pHold.nb.cards[0].actions.includes("approve") &&
      pHold.nb.cards[0].actions.includes("dismiss"),
      pHold && pHold.nb ? `hidden=${pHold.nb.hidden} cards=${pHold.nb.cards.length}` : "no noticeboard");
    assert("(A3) the top-bar badge shows the real pending count (1) and the sidebar count agrees",
      !!pHold && pHold.badge === "1" && pHold.holdCount === "1 held",
      pHold ? `badge=${J(pHold.badge)} sidebar=${J(pHold.holdCount)}` : "probe failed");
    assert("(A4) the hold card shows no stamps, no verdict, no fake progress (it is an instruction, not a run)",
      !!card1 && !/APPROVED|CHANGES|REJECTED|verdict|stamps|⚡/i.test(card1.text) &&
      !pHold.rows.some((r) => r.kind === "verdict"),
      card1 ? card1.text.slice(0, 120) : "no card");
    const regA = await registryCount();
    const codA = await budgetTotal("coding");
    assert("(A5) creating the hold fired nothing (registry + coding ledger unchanged)",
      regA === 0 && codA === coding0, `registry=${regA} coding=${codA}/${coding0}`);
    const shotA = await shot(`${LABEL}-hold-card.png`, "a held instruction as an actionable card: sidebar + office noticeboard + badge 1");
    assert("(A) hold card screenshot captured", shotA > 5000, `${shotA} bytes`);

    /* Reload BEFORE approving (the spec's order): the hold must
       still be there and nothing may fire. */
    await cdp.send("Page.reload", { ignoreCache: false });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor reloads");
    await seatRigCrew();
    const pReload = await waitProbe((p) => p.state && p.state.holds.length === 1, 20000, "hold restored after reload");
    assert("(A6) the hold survives a page reload — same id, same text, badge still 1",
      !!pReload && !!hold1 && pReload.state.holds[0].id === hold1.id && pReload.state.holds[0].text === TEXT_NAMED && pReload.badge === "1",
      pReload ? `id=${pReload.state.holds[0] && pReload.state.holds[0].id}` : "hold lost");
    const regR = await registryCount();
    const codR = await budgetTotal("coding");
    assert("(A6) the reload itself fired nothing",
      regR === 0 && codR === coding0, `registry=${regR} coding=${codR}/${coding0}`);

    /* Approve: fires POST /run with the held task + crew. */
    const approveClicked = hold1 ? await clickHoldAction(hold1.id, "approve") : false;
    assert("(A7) the Approve control is clickable", approveClicked);
    const runA = approveClicked ? await waitFor(async () => {
      const list = await registryList();
      return list.find((r) => r.crew === "rig" && r.task === TEXT_NAMED) || null;
    }, 30000, "approved run registered on the bridge").catch(() => null) : null;
    assert("(A7) approving the hold fires a run whose bridge record carries the held task verbatim and the held crew",
      !!runA, runA ? `run=${runA.id}` : "no matching record");
    const pApproved = await waitProbe((p) => p.state && p.state.holds.length === 0, 20000, "hold clears on approve");
    assert("(A8) the hold clears on approve — state, both surfaces, badge 0, noticeboard hidden",
      !!pApproved && pApproved.sidebarCards.length === 0 && pApproved.badge === "0" &&
      !!pApproved.nb && pApproved.nb.hidden && pApproved.holdCount === "0 held",
      pApproved ? `badge=${J(pApproved.badge)} cards=${pApproved.sidebarCards.length} nbHidden=${pApproved.nb && pApproved.nb.hidden}` : "probe failed");
    const firedRow = pApproved && pApproved.rows.find((r) => r.kind === "fired");
    assert("(A9) the transcript logs the firing, tied to the real run id",
      !!firedRow && !!runA && firedRow.run === runA.id,
      firedRow ? `run=${firedRow.run}` : "no fired entry");
    let settledA = null;
    if (runA) settledA = await settleWatched(runA.id);
    assert("(A10) the approved run settles done on the bridge",
      !!settledA && settledA.state === "done",
      settledA ? `verdict=${settledA.verdict} stamps=${(settledA.stamps || []).length}` : "no record");
    await assertBudgetRule("(A10)");
    const pillA = await waitFor(async () => {
      const v = await cdp.eval(`parseInt(document.getElementById('budgetStatus').textContent, 10)`);
      const led = await budgetTotal("coding");
      return v === led ? v : null;
    }, 30000, "pill settles to the ledger").catch(() => null);
    assert("(A10) the page pill equals the bridge's coding ledger after the run",
      pillA !== null && pillA === (await budgetTotal("coding")), `pill=${pillA}`);

    /* Edit: rewrite the task in place, then approve and prove the
       run record carries the EDITED text. */
    await typeConductor(TEXT_PLAIN);
    const pEdit0 = await waitProbe((p) => p.state && p.state.holds.length === 1, 20000, "second hold created");
    const hold2 = pEdit0 && pEdit0.state.holds[0];
    const editClicked = hold2 ? await clickHoldAction(hold2.id, "edit") : false;
    const pEditing = editClicked ? await waitProbe((p) => {
      const c = p.sidebarCards.find((x) => x.hold === (hold2 && hold2.id));
      return c && c.textarea !== null;
    }, 15000, "edit textarea opens") : null;
    const cardEditing = pEditing && pEditing.sidebarCards.find((x) => x.hold === (hold2 && hold2.id));
    assert("(A11) Edit opens the task text in place, prefilled with the held text",
      !!cardEditing && cardEditing.textarea === TEXT_PLAIN,
      cardEditing ? `textarea=${J(cardEditing.textarea)}` : "no textarea");
    if (cardEditing) {
      await cdp.eval(`(() => { const ta = document.querySelector('#holdList [data-hold="${hold2.id}"] textarea'); if (ta) { ta.focus(); ta.select(); } return !!ta; })()`);
      await cdp.send("Input.insertText", { text: EDITED_TEXT });
      await clickHoldAction(hold2.id, "save");
    }
    const pEdited = await waitProbe((p) => p.state && p.state.holds.length === 1 && p.state.holds[0].text === EDITED_TEXT, 15000, "edited text saved");
    const regE = await registryCount();
    assert("(A11) saving the edit rewrites the hold in place (edited flag set, still pending, nothing fired)",
      !!pEdited && pEdited.state.holds[0].edited === true &&
      pEdited.sidebarCards.some((c) => c.hold === (hold2 && hold2.id) && c.text.includes(EDITED_TEXT)) && regE === 1,
      pEdited ? `edited=${pEdited.state.holds[0].edited} registry=${regE}` : "edit not saved");
    const shotE = await shot(`${LABEL}-edited-hold.png`, "the edited hold: task text rewritten in place before approving");
    assert("(A11) edited hold screenshot captured", shotE > 5000, `${shotE} bytes`);
    const approve2 = hold2 ? await clickHoldAction(hold2.id, "approve") : false;
    const runB = approve2 ? await waitFor(async () => {
      const list = await registryList();
      return list.find((r) => r.crew === "rig" && r.task === EDITED_TEXT) || null;
    }, 30000, "edited run registered").catch(() => null) : null;
    assert("(A12) approving the edited hold fires a run whose record carries the EDITED task text",
      !!runB, runB ? `run=${runB.id}` : "no record with the edited text");
    let settledB = null;
    if (runB) settledB = await settleWatched(runB.id);
    assert("(A12) the edited run settles done", !!settledB && settledB.state === "done",
      settledB ? `verdict=${settledB.verdict}` : "no record");
    await assertBudgetRule("(A12)");

    /* Dismiss: clears the hold, transcript notes it, fires nothing. */
    const regBeforeDismiss = await registryCount();
    await typeConductor(TEXT_DISMISS);
    const pDis = await waitProbe((p) => p.state && p.state.holds.length === 1, 20000, "third hold created");
    const hold3 = pDis && pDis.state.holds[0];
    const dismissClicked = hold3 ? await clickHoldAction(hold3.id, "dismiss") : false;
    const pDismissed = dismissClicked ? await waitProbe((p) => p.state && p.state.holds.length === 0, 15000, "hold dismissed") : null;
    const noteRow = pDismissed && pDismissed.rows.find((r) => r.kind === "note" && r.hold === (hold3 && hold3.id));
    assert("(A13) Dismiss clears the hold (state + surfaces + badge 0) and the transcript notes the dismissal",
      !!pDismissed && pDismissed.badge === "0" && !!noteRow && /dismiss/i.test(noteRow.text),
      noteRow ? noteRow.text.slice(0, 110) : "no dismissal note");
    const regAfterDismiss = await registryCount();
    assert("(A13) dismissing fired nothing (registry unchanged)",
      regAfterDismiss === regBeforeDismiss, `registry ${regBeforeDismiss} -> ${regAfterDismiss}`);
  } catch (e) {
    assert("(A) phase A completed without harness error", false, e.message);
  }

  /* ============ (B) rejection -> retry as hold ============ */
  try {
    /* Restart the SAME home with the drill-reject reviewer (a crew
       configuration on the same real lane). Token + ledger persist;
       the registry resets, so bank the settled stamps first. */
    bankedStamps += await servedStampsTotal();
    results.measurements.bankedBeforeReject = bankedStamps;
    try { bridge.proc.kill("SIGKILL"); } catch { /* restarted below */ }
    await sleep(900);
    fs.writeFileSync(path.join(HOME_MAIN, "crews.json"), crewsJson(true));
    bridge = startBridge(HOME_MAIN);
    await bridgePairCode(bridge);
    await sleep(1500);
    await cdp.send("Page.reload", { ignoreCache: false });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor reloads on the reject rig");
    await seatRigCrew();
    note("(B) reject rig live", "same bridge home, reviewer standing instructions set to the CHANGES drill; token + ledger carried over");

    const knownIds = new Set((await registryList()).map((r) => r.id));
    const submitFromPage = async () => {
      await waitFor(() => cdp.eval(`!document.getElementById('floorRunBtn').disabled`), 30000, "Run button re-enabled");
      await cdp.eval(`(() => { document.getElementById('floorRunTask').value = ${J(TASK)}; })()`);
      await cdp.eval(`document.getElementById('floorRunBtn').click()`);
      return waitFor(async () => {
        const list = await registryList();
        return list.find((r) => r.task === TASK && r.crew === "rig" && !knownIds.has(r.id)) || null;
      }, 20000, "run registered on the bridge");
    };
    const takes = [];
    let rejected = null;
    for (let take = 1; take <= 3 && !rejected; take++) {
      const started = await submitFromPage();
      knownIds.add(started.id);
      const settled = await settleWatched(started.id);
      takes.push({ id: started.id, state: settled.state, verdict: settled.verdict || null, stamps: (settled.stamps || []).length });
      if (settled.state === "done" && settled.verdict === "CHANGES") rejected = settled;
      else note(`(B) take ${take} did not land the rejection`, `state=${settled.state} verdict=${settled.verdict} — resubmitting per the recorded-takes policy`);
    }
    results.rig.rejectTakes = takes;
    assert("(B1) a run on the reject rig settles with the reviewer's rejection verdict (CHANGES — this bridge's rejection; see header)",
      !!rejected, J(takes));

    const pRetry = rejected ? await waitProbe((p) => p.rows && p.rows.some((r) => r.kind === "verdict" && r.run === rejected.id && r.retry === rejected.id), 30000, "retry offered in the transcript") : null;
    const verdictRow = pRetry && pRetry.rows.find((r) => r.kind === "verdict" && r.run === rejected.id);
    assert("(B2) the rejected run offers retry-as-hold in the transcript verdict row, and the run card offers it too",
      !!verdictRow && !!pRetry && pRetry.cardRetry === rejected.id,
      `rowRetry=${verdictRow ? verdictRow.retry : "none"} cardRetry=${pRetry ? pRetry.cardRetry : "none"}`);
    assert("(B2) no retry hold exists before the offer is taken",
      !!pRetry && pRetry.state.holds.length === 0 && pRetry.badge === "0",
      pRetry ? `holds=${pRetry.state.holds.length}` : "probe failed");
    const regBeforeRetry = await registryCount();
    const codBeforeRetry = await budgetTotal("coding");
    const retryClicked = await clickRetry("transcript");
    const pRetried = retryClicked ? await waitProbe((p) => p.state && p.state.holds.length === 1, 15000, "retry hold created") : null;
    const retryHold = pRetried && pRetried.state.holds[0];
    assert("(B3) taking the offer creates exactly one hold carrying the original task text and crew",
      !!retryHold && retryHold.text === TASK && retryHold.crew === "rig" && retryHold.fromRun === rejected.id && pRetried.badge === "1",
      retryHold ? `fromRun=${retryHold.fromRun} text=${J(retryHold.text).slice(0, 60)}` : "no retry hold");
    const shotR = await shot(`${LABEL}-retry-hold.png`, "the rejected run's retry hold: original task text, held for approval");
    assert("(B3) retry hold screenshot captured", shotR > 5000, `${shotR} bytes`);
    const regAfterRetry = await registryCount();
    const codAfterRetry = await budgetTotal("coding");
    assert("(B4) creating the retry hold fired nothing (registry + ledger unchanged by the click)",
      regAfterRetry === regBeforeRetry && codAfterRetry === codBeforeRetry,
      `registry ${regBeforeRetry} -> ${regAfterRetry}; coding ${codBeforeRetry} -> ${codAfterRetry}`);
    assert("(B5) the retry offer is one-shot — no retry control remains for that run once the hold exists",
      !!pRetried && !pRetried.rows.some((r) => r.retry === rejected.id) && pRetried.cardRetry === null,
      pRetried ? `cardRetry=${pRetried.cardRetry}` : "probe failed");
    const dismissRetry = retryHold ? await clickHoldAction(retryHold.id, "dismiss") : false;
    const pRetryGone = dismissRetry ? await waitProbe((p) => p.state && p.state.holds.length === 0, 15000, "retry hold dismissed") : null;
    const retryNote = pRetryGone && pRetryGone.rows.find((r) => r.kind === "note" && r.hold === (retryHold && retryHold.id));
    assert("(B6) dismissing the retry hold clears it, zeroes the badge, and the transcript notes the dismissal",
      !!pRetryGone && pRetryGone.badge === "0" && !!retryNote && /dismiss/i.test(retryNote.text),
      retryNote ? retryNote.text.slice(0, 110) : "no dismissal note");
    await assertBudgetRule("(B6)");
  } catch (e) {
    assert("(B) phase B completed without harness error", false, e.message);
  }

  /* ============ (C) stale crew: the hold's crew disappears ============ */
  let staleHoldId = null;
  try {
    await typeConductor(TEXT_STALE);
    const pStale0 = await waitProbe((p) => p.state && p.state.holds.length === 1, 20000, "stale-candidate hold created");
    const staleHold = pStale0 && pStale0.state.holds[0];
    staleHoldId = staleHold && staleHold.id;
    const staleCard0 = pStale0 && pStale0.sidebarCards.find((c) => c.hold === staleHoldId);
    assert("(C1) the hold is created for crew rig and is not stale while the crew exists",
      !!staleHold && staleHold.crew === "rig" && !!staleCard0 && staleCard0.stale !== "1" && pStale0.badge === "1",
      staleHold ? `id=${staleHold.id} crew=${staleHold.crew}` : "no hold");

    /* Replace the bridge on the same port with a fresh home whose
       crews.json defines only "default" (the blessed method). */
    bankedStamps += await servedStampsTotal();
    try { bridge.proc.kill("SIGKILL"); } catch { /* replaced below */ }
    await sleep(900);
    bridge = startBridge(HOME_NORIG);
    const codeC = await bridgePairCode(bridge);
    results.rig.staleBridge = "fresh home, crews = [default] only";
    await cdp.send("Page.reload", { ignoreCache: false });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor reloads against the new bridge");
    /* The old token is invalid on the new home: the shell drops to
       the door (401 -> disconnect). Pair through the form. */
    await waitFor(() => cdp.eval(`!document.getElementById('connectScreen').classList.contains('hidden')`), 30000, "door up for the new bridge").catch(() => null);
    assert("(C2) re-paired with the replacement bridge through the page form", await pairThroughForm(codeC));
    const pStale = await waitProbe((p) => p.crewOptions.length === 1 && p.crewOptions[0] === "default" &&
      p.sidebarCards.some((c) => c.hold === staleHoldId && c.stale === "1"), 45000, "hold renders stale");
    const staleCard = pStale && pStale.sidebarCards.find((c) => c.hold === staleHoldId);
    const staleNb = pStale && pStale.nb && pStale.nb.cards.find((c) => c.hold === staleHoldId);
    assert("(C2) with crew rig gone from GET /crews, the hold renders stale in the sidebar and on the noticeboard",
      !!staleCard && !!staleNb && staleNb.stale === "1",
      staleCard ? `sidebar stale=${staleCard.stale}; noticeboard ${staleNb ? "stale=" + staleNb.stale : "absent"}` : "no stale card");
    assert("(C3) a stale hold can only be dismissed — no Approve, no Edit (absent or disabled)",
      !!staleCard && !staleCard.actions.includes("approve") && !staleCard.actions.includes("edit") &&
      staleCard.actions.includes("dismiss"),
      staleCard ? `actions=${J(staleCard.actions)}` : "no card");
    const regC = await fetch(BRIDGE_BASE + "/runs?limit=50", { headers: authH() }).then((r) => r.json()).catch(() => null);
    const budC = await fetch(BRIDGE_BASE + "/budget?surface=coding", { headers: authH() }).then((r) => r.json()).catch(() => null);
    const budCTotal = budC ? (budC.lanes || []).reduce((a, l) => a + (l.used || 0), 0) : -1;
    assert("(C4) nothing has fired on the replacement bridge (its registry and ledger are untouched)",
      !!regC && (regC.runs || []).length === 0 && budCTotal === 0,
      `runs=${regC ? (regC.runs || []).length : "?"} coding=${budCTotal}`);
    const shotS = await shot(`${LABEL}-stale-hold.png`, "the stale hold: crew rig no longer exists — dismiss only");
    assert("(C) stale hold screenshot captured", shotS > 5000, `${shotS} bytes`);
    const dismissStale = staleHoldId ? await clickHoldAction(staleHoldId, "dismiss") : false;
    const pStaleGone = dismissStale ? await waitProbe((p) => p.state && p.state.holds.length === 0, 15000, "stale hold dismissed") : null;
    const staleNote = pStaleGone && pStaleGone.rows.find((r) => r.kind === "note" && r.hold === staleHoldId);
    assert("(C5) dismissing the stale hold clears it, zeroes the badge, and the transcript notes the dismissal",
      !!pStaleGone && pStaleGone.badge === "0" && !!staleNote && /dismiss/i.test(staleNote.text),
      staleNote ? staleNote.text.slice(0, 110) : "no dismissal note");
  } catch (e) {
    assert("(C) phase C completed without harness error", false, e.message);
  }

  /* ============ (D) phone 412x915 with a hold pending ============ */
  try {
    await typeConductor(TEXT_PLAIN);
    const pPhone0 = await waitProbe((p) => p.state && p.state.holds.length === 1, 20000, "phone hold created");
    const phoneHold = pPhone0 && pPhone0.state.holds[0];
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true, screenWidth: 412, screenHeight: 915
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.reload", { ignoreCache: false });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor reloads at phone size");
    await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "crew seats at phone size");
    await sleep(1500);
    const auditPhone = await cdp.eval(OVERFLOW_AUDIT);
    const pPhone = await probe();
    const phoneCard = pPhone && pPhone.sidebarCards.find((c) => c.hold === (phoneHold && phoneHold.id));
    results.measurements.phone = { audit: auditPhone, badge: pPhone && pPhone.badge,
      nb: pPhone && pPhone.nb ? { hidden: pPhone.nb.hidden, box: pPhone.nb.box } : null,
      entries: pPhone && pPhone.state ? pPhone.state.entries.length : null };
    assert("(D1) phone: no element overflows the viewport width with a hold pending (badge, cards, noticeboard included)",
      auditPhone.wideElements.length === 0, J(auditPhone.wideElements));
    assert("(D1) phone: the hold persists across the reload, its card is in the layout, and the office noticeboard shows it inside the viewport",
      !!phoneCard && !!pPhone && pPhone.badge === "1" && !!pPhone.nb && !pPhone.nb.hidden &&
      !!pPhone.nb.box && pPhone.nb.box.right <= auditPhone.innerWidth + 1 && pPhone.nb.box.left >= -1,
      J(results.measurements.phone));
    const shotP = await shot(`${LABEL}-phone-holds.png`, "phone 412x915: a pending hold — badge, noticeboard card, sidebar card, no overflow");
    assert("(D) phone screenshot captured", shotP > 5000, `${shotP} bytes`);
  } catch (e) {
    assert("(D) phase D completed without harness error", false, e.message);
  }

  /* ============ (E) zero console errors ============ */
  const logEntries = results.consoleErrors.filter((e) => e.startsWith("log:"));
  const nonLogErrors = results.consoleErrors.filter((e) => !e.startsWith("log:"));
  const transportNoise = logEntries.filter((e) => e.includes("net::ERR_FAILED") && e.includes(`127.0.0.1:${BRIDGE_PORT}`));
  /* Disclosed rig noise #2: the phase C bridge swap makes the
     shell's designed 401 probe (enterApp checks the stored token
     against the replacement bridge, gets 401, drops to the door —
     asserted in C2) appear in Chromium's log as a failed resource
     load. It is the product working as designed, counted here,
     not hidden. */
  const authProbeNoise = logEntries.filter((e) => e.includes("status of 401") && e.includes(`127.0.0.1:${BRIDGE_PORT}`));
  const unexplained = logEntries.filter((e) => !transportNoise.includes(e) && !authProbeNoise.includes(e));
  results.transportNoise = transportNoise;
  results.authProbeNoise = authProbeNoise;
  assert("(E) zero console errors across the whole session (pair, holds, approve, edit, dismiss, reject, retry, stale swap, phone)",
    nonLogErrors.length === 0 && unexplained.length === 0,
    `transport=${transportNoise.length}; authProbe=${authProbeNoise.length}; unexplained=${unexplained.slice(0, 3).join(" | ") || "none"}; nonLog=${nonLogErrors.slice(0, 3).join(" | ") || "none"}`);

  ws.close();
} catch (e) {
  assert("evaluator completed without harness error", false, e.message);
} finally {
  try { if (chromeProc) chromeProc.kill("SIGKILL"); } catch { /* already gone */ }
  try { if (bridge) bridge.proc.kill("SIGKILL"); } catch { /* already gone */ }
  try { if (llamaProc) llamaProc.kill("SIGKILL"); } catch { /* already gone */ }
  const failed = results.assertions.filter((a) => !a.ok);
  results.verdict = failed.length === 0 ? "PHASE 2 STAGE 3 GATE: PASS" : `PHASE 2 STAGE 3 GATE: FAIL (${failed.length})`;
  const outName = LABEL === "before" ? "baseline-results.json" : "results.json";
  fs.writeFileSync(path.join(HERE, outName), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict + `  (label=${LABEL}, wrote ${outName})`);
  process.exit(failed.length === 0 ? 0 : 1);
}
