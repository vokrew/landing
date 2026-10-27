#!/usr/bin/env node
/*
 * EMPTY-FLOOR SHELL capture harness (KC, 2026-10-27) — Kevin's order:
 * visitors see the empty Floor (the shell of what they'll fill)
 * without being forced into the bridge lane; setup is a collapsed
 * tab that expands when they're ready.
 *
 * PART S (desktop shell): fresh profile, NO bridge anywhere. The
 *   page must come up as the shell: room rendered empty + labeled,
 *   setup card collapsed, honest empty states, zero console errors,
 *   room explorable (view switch), setup tab expands + collapses.
 * PART P (phone shell): same at 412x915 (S26 emulation), zero
 *   horizontal overflow.
 * PART R (paired regression): the AAA rig (real bridge + llama.cpp
 *   Gemma 3 1B, isolated VOKREW_HOME, Fetch interception — this
 *   VM's Chromium blocks 127.0.0.1 navigation, LNA). The page still
 *   lands on the shell first; pairing goes THROUGH THE EXPANDED
 *   TAB; then the canonical conductor session: seat rig crew ->
 *   call-out -> hold -> approve -> run settles done/APPROVED ->
 *   reviewer on the executor's doorstep (state-log corroborated)
 *   -> verdict row in the transcript. Proves the paired experience
 *   is unregressed by the shell presentation change.
 *
 * Run:  xvfb-run -a node shell-capture.mjs
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
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const RIG_HOME = "/tmp/vokrew-shell-home";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const TEXT_NAMED = "Scout, write a one-line bash command that prints the word hello, then explain it in one short sentence";

const results = { assertions: [], screenshots: [], shell: {}, regression: {} };
function note(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "OK  " : "MISS"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (x) => JSON.stringify(x);

/* ---------------- tiny CDP client (same shape as Stages 0-3 / AAA) ---------------- */

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

async function startChrome(profile, port, errSink, pinned) {
  fs.rmSync(profile, { recursive: true, force: true });
  const args = [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server",
    `--remote-debugging-port=${port}`, "--window-size=1440,900",
    `--user-data-dir=${profile}`, "about:blank"
  ];
  const proc = pinned
    ? spawn("taskset", ["-c", "1", CHROME, ...args], { stdio: "ignore", env: chromeEnvClean() })
    : spawn(CHROME, args, { stdio: "ignore", env: chromeEnvClean() });
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

/* ---------------- shared page probes ---------------- */

const SHELL_PROBE = `(() => {
  const vis = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const g = (id) => document.getElementById(id);
  const dbg = window.__floorDebug;
  return {
    shellMode: document.body.classList.contains('shell-mode'),
    doorOpen: document.body.classList.contains('door-open'),
    connectHidden: g('connectScreen') ? g('connectScreen').classList.contains('hidden') : null,
    bannerVisible: vis(g('shellBanner')),
    bannerText: g('shellBanner') ? g('shellBanner').textContent.replace(/\\s+/g, ' ').trim() : null,
    setupTabVisible: vis(g('setupTab')),
    setupTabAria: g('setupTab') ? g('setupTab').getAttribute('aria-expanded') : null,
    runFormVisible: vis(g('floorRunForm')),
    conductorFormVisible: vis(g('conductorForm')),
    questTrackerVisible: vis(g('questtracker')),
    chip: g('floorModeChip') ? g('floorModeChip').textContent : null,
    statusText: g('statusText') ? g('statusText').textContent : null,
    rosterText: g('roster') ? g('roster').textContent.replace(/\\s+/g, ' ').trim() : null,
    tasklistText: g('tasklist') ? g('tasklist').textContent.replace(/\\s+/g, ' ').trim() : null,
    budgetStatus: g('budgetStatus') ? g('budgetStatus').textContent : null,
    floorStatus: g('floorStatus') ? g('floorStatus').textContent : null,
    rigFoot: g('rigFoot') ? g('rigFoot').textContent : null,
    zoneName: g('zoneName') ? g('zoneName').textContent : null,
    state: dbg ? dbg.state() : null,
    overflow: { sw: document.documentElement.scrollWidth, iw: window.innerWidth }
  };
})()`;

const CANVAS_PROBE = `(() => {
  const c = document.getElementById('cv');
  if (!c) return null;
  try {
    const g = c.getContext('2d');
    const img = g.getImageData(0, 0, c.width, c.height).data;
    let distinct = new Set();
    for (let i = 0; i < img.length; i += 4 * 997) {
      distinct.add((img[i] << 16) | (img[i + 1] << 8) | img[i + 2]);
      if (distinct.size > 40) break;
    }
    return { w: c.width, h: c.height, distinctSampled: distinct.size, readable: true };
  } catch (e) {
    return { readable: false, error: String(e) };
  }
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
    state: dbg ? dbg.state() : null,
    rows,
    badge: (document.getElementById('holdBadge') || {}).textContent ?? null,
    nbHidden: nb ? nb.classList.contains('hidden') : null,
    nbCards: nb ? nb.querySelectorAll('.nbcard').length : 0,
    sidebarCards: document.querySelectorAll('#holdList .holdrow').length
  };
})()`;

function classifyErrors(errs, label) {
  const logEntries = errs.filter((e) => e.startsWith("log:"));
  const nonLog = errs.filter((e) => !e.startsWith("log:"));
  const noise = logEntries.filter((e) =>
    (e.includes("net::ERR_FAILED") || e.includes("net::ERR_CONNECTION_REFUSED")) &&
    (e.includes(`127.0.0.1:${BRIDGE_PORT}`) || e.includes("127.0.0.1:7717")));
  const unexplained = logEntries.filter((e) => !noise.includes(e));
  note(`${label}: zero console errors (transport noise tallied + named)`,
    nonLog.length === 0 && unexplained.length === 0,
    `nonLog=${nonLog.length} noise=${noise.length} unexplained=${unexplained.slice(0, 2).join(" | ") || "none"}`);
  return { total: errs.length, nonLog: nonLog.length, noise: noise.length, unexplained };
}

/* ============================ PART S: desktop shell ============================ */

async function partShell() {
  const errs = [];
  const { proc, cdp, ws } = await startChrome("/tmp/floor-shell-profile", 9344, errs, false);
  try {
    await cdp.send("Page.navigate", { url: PAGE_URL });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load");
    await waitFor(async () => {
      const p = await cdp.eval(SHELL_PROBE).catch(() => null);
      return p && p.state && p.state.agents === 0 ? p : null;
    }, 15000, "locked empty state applied");
    await sleep(2500); // let the room settle into its idle frame

    const p = await cdp.eval(SHELL_PROBE);
    results.shell.desktop = p;
    note("shell: page lands on the empty floor — no overlay forced (connect card hidden, no door-open)",
      p.connectHidden === true && p.doorOpen === false);
    note("shell: body is in shell-mode; banner + setup tab visible and labeled",
      p.shellMode === true && p.bannerVisible === true && p.setupTabVisible === true &&
      /starts empty/.test(p.bannerText || ""),
      (p.bannerText || "").slice(0, 90));
    note("shell: room state is honestly empty (0 agents / 0 tasks / 0 runs, not connected)",
      p.state && p.state.agents === 0 && p.state.tasks === 0 && p.state.runs === 0 && p.state.connected === false,
      J(p.state));
    note("shell: chip reads OFFLINE; status pill 'not connected'; rig foot 'bridge offline'",
      p.chip === "OFFLINE" && p.statusText === "not connected" && p.rigFoot === "bridge offline",
      `chip=${p.chip} status=${p.statusText} rig=${p.rigFoot}`);
    note("shell: roster + quest log show honest empty states; budget pill is '—', never a number",
      /No crew yet/.test(p.rosterText || "") && /No runs yet/.test(p.tasklistText || "") && p.budgetStatus === "—",
      `roster=${J(p.rosterText)} tasks=${J(p.tasklistText)} budget=${J(p.budgetStatus)}`);
    note("shell: run form, conductor form and quest tracker are hidden (nothing can run without a crew)",
      p.runFormVisible === false && p.conductorFormVisible === false && p.questTrackerVisible === false);
    note("shell: floor status line reads 'offline'", p.floorStatus === "offline", J(p.floorStatus));
    note("shell: no horizontal overflow on desktop", p.overflow.sw <= p.overflow.iw + 1, J(p.overflow));

    const cv = await cdp.eval(CANVAS_PROBE);
    results.shell.canvas = cv;
    note("shell: the room actually renders (canvas readable, many distinct colors — not a blank void)",
      !!cv && cv.readable === true && cv.distinctSampled > 20,
      cv ? `canvas=${cv.w}x${cv.h} distinct>${cv.distinctSampled}` : "probe failed");

    const sz = await shot(cdp, "shell-desktop.png", "SHELL (desktop, unpaired, no bridge): the empty floor, banner + setup tab, honest empty sidebar");
    note("shell desktop screenshot captured", sz > 10000, `${sz} bytes`);

    /* the room is explorable: switch the view to the Foundry */
    await cdp.eval(`document.querySelector('#viewbar [data-view="foundry"]').click()`);
    await sleep(1200);
    const zone = await cdp.eval(`document.getElementById('zoneName').textContent`);
    note("shell: room explorable without setup — view switch to the Foundry answers", zone === "THE FOUNDRY", `zone=${zone}`);
    await cdp.eval(`document.querySelector('#viewbar [data-view="overview"]').click()`);
    await sleep(800);

    /* the setup tab expands the pairing card; the close control collapses it */
    await cdp.eval(`document.getElementById('setupTab').click()`);
    await sleep(700);
    const open = await cdp.eval(SHELL_PROBE);
    note("shell: setup tab expands the pairing card (aria-expanded tracks, door-open set)",
      open.connectHidden === false && open.doorOpen === true && open.setupTabAria === "true");
    const sz2 = await shot(cdp, "shell-setup-expanded.png", "SHELL: setup tab expanded — the unchanged pairing card over the empty floor");
    note("shell setup-expanded screenshot captured", sz2 > 10000, `${sz2} bytes`);
    await cdp.eval(`document.getElementById('connectClose').click()`);
    await sleep(500);
    const closed = await cdp.eval(SHELL_PROBE);
    note("shell: close collapses back to the shell — still unpaired, nothing lost",
      closed.connectHidden === true && closed.doorOpen === false && closed.shellMode === true && closed.state.agents === 0);

    results.shell.desktopErrors = classifyErrors(errs, "shell (desktop)");
  } finally {
    try { ws.close(); } catch { /* done */ }
    proc.kill("SIGKILL");
  }
}

/* ============================ PART P: phone shell ============================ */

async function partPhone() {
  const errs = [];
  const { proc, cdp, ws } = await startChrome("/tmp/floor-shell-phone-profile", 9345, errs, false);
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true, screenWidth: 412, screenHeight: 915
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.navigate", { url: PAGE_URL });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load (phone)");
    await waitFor(async () => {
      const p = await cdp.eval(SHELL_PROBE).catch(() => null);
      return p && p.state && p.state.agents === 0 ? p : null;
    }, 15000, "locked empty state applied (phone)");
    await sleep(2500);
    const p = await cdp.eval(SHELL_PROBE);
    results.shell.phone = p;
    note("phone shell: lands on the empty floor, banner + setup tab visible, card collapsed",
      p.shellMode === true && p.bannerVisible === true && p.setupTabVisible === true && p.connectHidden === true);
    note("phone shell: honest empty states (No crew yet / No runs yet / budget '—')",
      /No crew yet/.test(p.rosterText || "") && /No runs yet/.test(p.tasklistText || "") && p.budgetStatus === "—");
    note("phone shell: zero horizontal overflow at 412px", p.overflow.sw <= p.overflow.iw + 1, J(p.overflow));
    const sz = await shot(cdp, "shell-phone.png", "SHELL (phone 412x915, unpaired): the empty floor with its banner");
    note("phone shell screenshot captured", sz > 10000, `${sz} bytes`);
    results.shell.phoneErrors = classifyErrors(errs, "shell (phone)");
  } finally {
    try { ws.close(); } catch { /* done */ }
    proc.kill("SIGKILL");
  }
}

/* ============================ PART R: paired regression ============================ */

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

let llamaProc = null, bridge = null, token = null;
const authH = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
async function bridgeGet(p) {
  const r = await fetch(BRIDGE_BASE + p, { headers: authH() });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function partRegression() {
  writeRigHome();
  llamaProc = spawn("taskset", ["-c", "0", LLAMA_BIN, "-m", MODEL, "--alias", "gemma-local", "-t", "1", "--host", "127.0.0.1", "--port", String(LLAMA_PORT)],
    { stdio: "ignore" });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/models`).catch(() => null);
    return r && r.ok;
  }, 60000, "llama-server models");
  const warm = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gemma-local", messages: [{ role: "user", content: "Reply with the single word: ready" }], max_tokens: 8 })
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  note("regression rig: lane warm-up completed directly against llama-server",
    !warm.error && !!(warm.choices && warm.choices[0]));

  bridge = startBridge();
  const code = await waitFor(() => {
    const m = /Pairing code: (\d{6})/.exec(bridge.out());
    return m && m[1];
  }, 20000, "bridge pairing code");

  const errs = [];
  const { proc, cdp, ws } = await startChrome("/tmp/floor-shell-rig-profile", 9340, errs, true);
  try {
    interceptOrigin(cdp, `*127.0.0.1:${BRIDGE_PORT}*`, ["authorization", "content-type"]);
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*127.0.0.1:${BRIDGE_PORT}*`, requestStage: "Request" }] });
    await cdp.send("Page.navigate", { url: PAGE_URL });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load (rig)");
    await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 15000, "locked before pairing (rig)");

    /* The bridge EXISTS, but the page holds no token: it must still
       land on the shell — pairing is invited, not forced. */
    await sleep(1500);
    const pre = await cdp.eval(SHELL_PROBE);
    results.regression.prePair = pre;
    note("regression: bridge up but page unpaired — still the shell (banner up, card collapsed)",
      pre.shellMode === true && pre.bannerVisible === true && pre.connectHidden === true);

    /* ---- pair THROUGH THE EXPANDED TAB ---- */
    await cdp.eval(`document.getElementById('setupTab').click()`);
    await sleep(600);
    const expanded = await cdp.eval(`!document.getElementById('connectScreen').classList.contains('hidden')`);
    note("regression: setup tab expanded the pairing card", expanded === true);
    await cdp.eval(`(() => { const i = document.getElementById('bridgeUrl'); i.focus(); i.select(); })()`);
    await cdp.send("Input.insertText", { text: BRIDGE_BASE });
    await cdp.eval(`(() => { const i = document.getElementById('pairCode'); i.focus(); i.select(); })()`);
    await cdp.send("Input.insertText", { text: code });
    await sleep(500);
    await cdp.eval(`document.getElementById('pairBtn').click()`);
    await waitFor(() => cdp.eval(`document.getElementById('connectScreen').classList.contains('hidden')`), 25000, "card drops after pairing");
    token = await cdp.eval(`localStorage.getItem('vokrew.token')`);
    note("regression: paired through the expanded tab's own form", !!token);
    const post = await cdp.eval(SHELL_PROBE);
    results.regression.postPair = post;
    note("regression: pairing exits shell mode — banner gone, run + conductor forms back",
      post.shellMode === false && post.bannerVisible === false &&
      post.runFormVisible === true && post.conductorFormVisible === true);

    /* ---- seat the rig crew ---- */
    await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, "default crew seats");
    await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, "crew picker populated");
    await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, "rig crew seated");
    await sleep(2000);
    const idleSz = await shot(cdp, "shell-paired-idle.png", "REGRESSION: paired via the expanded tab — rig crew seated, shell gone, room live");
    note("regression paired-idle screenshot captured", idleSz > 10000, `${idleSz} bytes`);

    /* ---- conductor session: call-out -> hold -> approve -> run ---- */
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

    await cdp.eval(`(() => { const i = document.getElementById('conductorInput'); i.focus(); i.scrollIntoView({ block: 'center' }); })()`);
    await sleep(400);
    for (const chunk of ["Scout, ", "write a one-line bash ", "command that prints ", "the word hello, then ", "explain it in one ", "short sentence"]) {
      await cdp.send("Input.insertText", { text: chunk });
      await sleep(350);
    }
    await sleep(600);
    await cdp.eval(`document.getElementById('conductorSend').click()`);
    const pHold = await waitFor(async () => {
      const p = await cdp.eval(CONDUCTOR_PROBE).catch(() => null);
      return p && p.state && p.state.holds && p.state.holds.length === 1 ? p : null;
    }, 20000, "hold created from the call-out");
    note("regression: conductor call-out became exactly one hold; badge + noticeboard agree",
      pHold.badge === "1" && pHold.sidebarCards === 1 && pHold.nbCards === 1 && pHold.nbHidden === false,
      `badge=${J(pHold.badge)} sidebar=${pHold.sidebarCards} noticeboard=${pHold.nbCards}`);

    const holdId = pHold.state.holds[0].id;
    const doorstep = await cdp.eval(`(() => { const d = window.__floorDebug.allDoorsteps().find(x => x.id === 'c-w2'); return window.__floorDebug.cellOfPoint(d); })()`);
    const approved = await cdp.eval(`(() => {
      const root = document.getElementById('holdList');
      const cardEl = [...root.querySelectorAll('[data-hold]')].find((r) => r.getAttribute('data-hold') === ${J(holdId)});
      if (!cardEl) return false;
      const btn = cardEl.querySelector('[data-hold-action="approve"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    note("regression: approve clicked on the hold card", approved);
    const started = await waitFor(async () => {
      const l = await bridgeGet("/runs?limit=5");
      return l.data.runs.find((r) => r.task === TEXT_NAMED && r.crew === "rig") || null;
    }, 30000, "approved run registered on the bridge");
    const runId = started.id;
    results.regression.runId = runId;
    note("regression: approved run registered on the bridge", !!runId, runId);

    let final = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 480000) {
      const { data } = await bridgeGet("/runs/" + runId);
      if (data.run.state !== "running") { final = data.run; break; }
      await sleep(400);
    }
    if (!final) throw new Error("approved run did not settle within 480s");
    results.regression.finalRecord = { state: final.state, verdict: final.verdict, crossFamily: final.crossFamily, error: final.error || null, stamps: final.stamps.length };
    note("regression: approved run settled done/APPROVED on the bridge",
      final.state === "done" && final.verdict === "APPROVED",
      `state=${final.state} verdict=${final.verdict} duration=${Math.round((Date.now() - t0) / 1000)}s`);
    if (final.state !== "done") throw new Error("REGRESSION FAILED: run settled " + final.state);

    await sleep(2500);
    logging = false;
    await logLoop.catch(() => {});
    const revHits = stateLog.filter((e) => {
      const r = e.act.find((a) => a.agent === "rig:reviewer");
      return r && r.cell && r.cell.cx === doorstep.cx && r.cell.cy === doorstep.cy;
    }).length;
    results.regression.doorstepLogEntries = revHits;
    note("regression: reviewer reached the executor doorstep during the run (state-log corroborated)",
      revHits > 0, `${revHits} entries`);
    const pSettled = await cdp.eval(CONDUCTOR_PROBE).catch(() => null);
    const verdictRow = pSettled && pSettled.rows.find((r) => r.kind === "verdict" && r.run === runId);
    note("regression: verdict landed in the conductor transcript, tied to the run id",
      !!verdictRow && verdictRow.verdict === "APPROVED",
      verdictRow ? verdictRow.text.slice(0, 120) : "row missing");
    const setSz = await shot(cdp, "shell-settled.png", "REGRESSION: run settled APPROVED after pairing via the expanded tab");
    note("regression settled screenshot captured", setSz > 10000, `${setSz} bytes`);

    results.regression.errors = classifyErrors(errs, "regression");
  } finally {
    try { ws.close(); } catch { /* done */ }
    proc.kill("SIGKILL");
  }
}

try {
  await partShell();
  await partPhone();
  await partRegression();
} catch (e) {
  note("capture harness completed without error", false, e.message);
  results.failed = String(e.message || e);
} finally {
  for (const p of [llamaProc, bridge && bridge.proc]) {
    try { if (p) p.kill("SIGKILL"); } catch { /* already gone */ }
  }
  const missed = results.assertions.filter((a) => !a.ok);
  results.verdict = results.failed
    ? `SHELL CAPTURE FAILED — ${results.failed}`
    : missed.length === 0
      ? `SHELL CAPTURE: COMPLETE — ${results.assertions.length}/${results.assertions.length} assertions`
      : `SHELL CAPTURE: COMPLETE WITH ${missed.length} MISS(ES)`;
  fs.writeFileSync(path.join(HERE, "results.json"), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict);
  if (results.failed) process.exitCode = 2;
}
