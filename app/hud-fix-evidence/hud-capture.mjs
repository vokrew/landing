#!/usr/bin/env node
/*
 * HUD OVERLAP FIX harness (KC, 2026-10-27) — Kevin's live report from
 * the deployed site: the sector map panel (bottom-right) overlaps the
 * room-selection tab strip (Overview/Foundry/Skyloft/Workshop/Yard);
 * the tabs sit on the minimap's top edge and the two collide.
 *
 * This harness measures the actual rendered geometry (bounding rects
 * + elementFromPoint click-through) in four quadrants:
 *   PART S — desktop shell (unpaired, no bridge)
 *   PART P — phone shell (412x915, unpaired)
 *   PART R — paired desktop regression on the real rig (real bridge +
 *     llama.cpp Gemma 3 1B, isolated VOKREW_HOME, Fetch interception):
 *     pair via the expanded setup tab -> seat rig crew -> sector sweep
 *     -> conductor call-out -> hold (noticeboard geometry) -> approve
 *     -> run (run-strip geometry mid-run) -> settles done/APPROVED ->
 *     reviewer doorstep corroborated in the state log.
 *   PART Q — paired phone: pair at phone width, fire a run through
 *     the bridge API, measure tab strip vs docked run strip while the
 *     run is live, run settles.
 *
 * PHASE env: "before" | "after" — prefixes screenshots and the
 * results file. The "before" run is EXPECTED to miss the clearance
 * assertions (that is the bug, measured); the "after" run must pass
 * every assertion.
 *
 * Run:  PHASE=after xvfb-run -a node hud-capture.mjs
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
const RIG_HOME = "/tmp/vokrew-hudfix-home";
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const PHASE = process.env.PHASE || "after";
const PARTS = (process.env.PARTS || "S,P,R,Q").split(",").map((s) => s.trim()).filter(Boolean);
/* Ambient-light gate (Kevin's 13:02 scope addition): mean luminance
   of the room canvas in each shell / paired-idle state must clear a
   per-state floor set at BEFORE x 1.10 from the measured before run
   (results-before.json): shellDesktop 0.0702, phoneShell 0.0587,
   pairedIdle 0.0710. The phone floor is lower because the portrait
   canvas carries an out-of-world void band the lighting cannot
   reach; each state is gated against its own before. LUM_MIN env
   overrides all floors (used record-only, 0, on before runs). */
const LUM_FLOORS = { shellDesktop: 0.0772, phoneShell: 0.0646, pairedIdle: 0.0781 };
const LUM_MIN = process.env.LUM_MIN !== undefined ? Number(process.env.LUM_MIN) : null;
const TEXT_NAMED = "Scout, write a one-line bash command that prints the word hello, then explain it in one short sentence";
const TEXT_API = "Write a one-line bash command that prints the word hello";

const results = { phase: PHASE, assertions: [], screenshots: [], geometry: {}, regression: {} };
function note(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "OK  " : "MISS"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (x) => JSON.stringify(x);

/* geometry helpers (viewport coords, y down) */
const inter = (a, b) => (!a || !b) ? 0 :
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const clearanceAbove = (upper, lower) => (!upper || !lower) ? null : lower.top - upper.bottom;

/* ---------------- tiny CDP client (same shape as the shell/AAA harnesses) ---------------- */

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

/* ---------------- geometry probe ---------------- */

const GEO_PROBE = `(() => {
  const R = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: r.x, y: r.y, w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  const g = (id) => document.getElementById(id);
  const tabs = [...document.querySelectorAll('#viewbar button')].map((b) => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      view: b.getAttribute('data-view'), on: b.classList.contains('on'),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      hitOk: !!hit && (hit === b || b.contains(hit))
    };
  });
  return {
    stage: R(g('stage')),
    minimap: R(g('minimapWrap')),
    viewbar: R(g('viewbar')),
    tabs,
    runCard: R(g('floorRunCard')),
    strip: R(g('floorCardStrip')),
    noticeboard: R(g('noticeboard')),
    quest: R(g('questtracker')),
    hint: R(g('hint')),
    shellMode: document.body.classList.contains('shell-mode'),
    zoneName: g('zoneName') ? g('zoneName').textContent : null,
    overflow: { sw: document.documentElement.scrollWidth, iw: window.innerWidth }
  };
})()`;

/* Mean relative luminance (Rec.709 weights on sRGB channels) of the
   room canvas, sampled on a stride. Comparative gate, not
   colorimetry: same renderer, same rig, before vs after. */
const LUM_PROBE = `(() => {
  const c = document.getElementById('cv');
  if (!c) return null;
  try {
    const g = c.getContext('2d');
    const img = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, n = 0;
    for (let i = 0; i < img.length; i += 4 * 613) {
      sum += (0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2]) / 255;
      n++;
    }
    return { mean: sum / n, samples: n, w: c.width, h: c.height };
  } catch (e) {
    return { error: String(e) };
  }
})()`;

async function lumAssertion(cdp, label, key) {
  const lum = await cdp.eval(LUM_PROBE);
  if (!results.luminance) results.luminance = {};
  results.luminance[key] = lum;
  const floor = LUM_MIN !== null ? LUM_MIN : (LUM_FLOORS[key] ?? 0);
  const v = lum && typeof lum.mean === "number" ? lum.mean : null;
  note(`${label}: room mean luminance clears the ambient floor (${floor})`,
    v !== null && v >= floor,
    v === null ? `probe failed: ${lum && lum.error}` : `mean=${v.toFixed(4)} floor=${floor} samples=${lum.samples}`);
  return v;
}

const SHELL_PROBE = `(() => {
  const g = (id) => document.getElementById(id);
  const dbg = window.__floorDebug;
  return {
    shellMode: document.body.classList.contains('shell-mode'),
    connectHidden: g('connectScreen') ? g('connectScreen').classList.contains('hidden') : null,
    state: dbg ? dbg.state() : null
  };
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

const SECTORS = [
  ["overview", "THE FLOOR"], ["foundry", "THE FOUNDRY"], ["skyloft", "SKYLOFT"],
  ["workshop", "WORKSHOP"], ["yard", "THE YARD"]
];

async function sectorSweep(cdp, label, shotPrefix) {
  for (const [view, zone] of SECTORS) {
    await cdp.eval(`document.querySelector('#viewbar [data-view="${view}"]').click()`);
    await sleep(1150);
    const p = await cdp.eval(GEO_PROBE);
    const clear = clearanceAbove(p.viewbar, p.minimap);
    const tab = p.tabs.find((t) => t.view === view);
    note(`${label}: sector "${view}" — zone label answers, tab active, every tab clickable through, minimap fully clear`,
      p.zoneName === zone && !!tab && tab.on === true && p.tabs.every((t) => t.hitOk) &&
      !!p.minimap && clear !== null && clear >= 6 && inter(p.viewbar, p.minimap) <= 1,
      `zone=${p.zoneName} clearance=${clear === null ? "n/a" : clear.toFixed(1)}px overlap=${inter(p.viewbar, p.minimap)}px2 hitOk=${p.tabs.map((t) => t.hitOk ? 1 : 0).join("")}`);
    if (shotPrefix && view === "foundry") {
      const sz = await shot(cdp, `${shotPrefix}-sector-foundry.png`, `${label}: Foundry sector — tab strip + sector map corner`);
      note(`${label}: sector screenshot captured`, sz > 10000, `${sz} bytes`);
    }
  }
}

function hudCornerAssertions(p, label, storeKey) {
  if (storeKey) results.geometry[storeKey] = p;
  const clear = clearanceAbove(p.viewbar, p.minimap);
  note(`${label}: sector map present and tab strip docks fully clear of it (>=6px air, zero overlap)`,
    !!p.minimap && !!p.viewbar && clear !== null && clear >= 6 && inter(p.viewbar, p.minimap) <= 1,
    p.minimap ? `minimap=${Math.round(p.minimap.w)}x${Math.round(p.minimap.h)} clearance=${clear === null ? "n/a" : clear.toFixed(1)}px overlap=${inter(p.viewbar, p.minimap)}px2` : "minimap missing");
  note(`${label}: every room tab is clickable through its center (nothing paints over it)`,
    p.tabs.length === 5 && p.tabs.every((t) => t.hitOk),
    `hitOk=${p.tabs.map((t) => t.hitOk ? 1 : 0).join("")}`);
  note(`${label}: tab strip sits inside the stage`, !!p.stage && !!p.viewbar &&
    p.viewbar.left >= p.stage.left - 1 && p.viewbar.right <= p.stage.right + 1 &&
    p.viewbar.top >= p.stage.top - 1 && p.viewbar.bottom <= p.stage.bottom + 1);
}

/* ============================ PART S: desktop shell ============================ */

async function partShell() {
  const errs = [];
  const { proc, cdp, ws } = await startChrome("/tmp/floor-hudfix-shell-profile", 9354, errs, false);
  try {
    await cdp.send("Page.navigate", { url: PAGE_URL });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load");
    await waitFor(async () => {
      const p = await cdp.eval(SHELL_PROBE).catch(() => null);
      return p && p.state && p.state.agents === 0 ? p : null;
    }, 15000, "locked empty state applied");
    await sleep(2500);
    const p = await cdp.eval(GEO_PROBE);
    note("shell (desktop): page is the unpaired shell", p.shellMode === true);
    hudCornerAssertions(p, "shell (desktop)", "shellDesktop");
    await lumAssertion(cdp, "shell (desktop)", "shellDesktop");
    note("shell (desktop): no horizontal overflow", p.overflow.sw <= p.overflow.iw + 1, J(p.overflow));
    const sz = await shot(cdp, `${PHASE}-shell-desktop.png`, `SHELL desktop (${PHASE}): bottom-right HUD corner — tab strip vs sector map`);
    note("shell (desktop) screenshot captured", sz > 10000, `${sz} bytes`);
    await sectorSweep(cdp, "shell (desktop)", `${PHASE}-shell`);
    await cdp.eval(`document.querySelector('#viewbar [data-view="overview"]').click()`);
    await sleep(900);
    classifyErrors(errs, "shell (desktop)");
  } finally {
    try { ws.close(); } catch { /* done */ }
    proc.kill("SIGKILL");
  }
}

/* ============================ PART P: phone shell ============================ */

async function partPhone() {
  const errs = [];
  const { proc, cdp, ws } = await startChrome("/tmp/floor-hudfix-phone-profile", 9355, errs, false);
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
    /* The tab strip docks at the stage's bottom edge, which starts a
       few px past the 915px fold in this emulation (page content is
       taller than the viewport). Scroll it into view so the
       elementFromPoint test measures OCCLUSION (the overlap
       question), not fold position — a real user scrolls the same
       few px. */
    await cdp.eval(`document.getElementById('viewbar').scrollIntoView({ block: 'nearest' })`);
    await sleep(500);
    const p = await cdp.eval(GEO_PROBE);
    results.geometry.phoneShell = p;
    note("phone shell: page is the unpaired shell", p.shellMode === true);
    note("phone shell: sector map is hidden at this width (existing <=1320px rule) — nothing for the tabs to collide with",
      p.minimap === null);
    note("phone shell: every room tab is clickable through its center",
      p.tabs.length === 5 && p.tabs.every((t) => t.hitOk),
      `hitOk=${p.tabs.map((t) => t.hitOk ? 1 : 0).join("")}`);
    note("phone shell: tab strip does not collide with the hint pill or the (absent) run strip",
      inter(p.viewbar, p.hint) <= 1 && inter(p.viewbar, p.strip) <= 1,
      `hintOverlap=${inter(p.viewbar, p.hint)} stripOverlap=${inter(p.viewbar, p.strip)}`);
    note("phone shell: zero horizontal overflow at 412px", p.overflow.sw <= p.overflow.iw + 1, J(p.overflow));
    await lumAssertion(cdp, "phone shell", "phoneShell");
    const sz = await shot(cdp, `${PHASE}-phone-shell.png`, `SHELL phone 412x915 (${PHASE}): bottom HUD corner`);
    note("phone shell screenshot captured", sz > 10000, `${sz} bytes`);
    classifyErrors(errs, "shell (phone)");
  } finally {
    try { ws.close(); } catch { /* done */ }
    proc.kill("SIGKILL");
  }
}

/* ============================ rig (shared by R + Q) ============================ */

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
/* The bridge's pairing code is SINGLE-USE (serve.js handlePair:
   newPairingCode() on every success, printed to the console). Any
   part that pairs must read the LATEST code from the bridge output —
   reusing a consumed code earns a 401 and the card never drops. */
function latestCode() {
  const all = [...bridge.out().matchAll(/Pairing code: (\d{6})/g)];
  return all.length ? all[all.length - 1][1] : null;
}
const authH = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
async function bridgeGet(p) {
  const r = await fetch(BRIDGE_BASE + p, { headers: authH() });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function bridgePost(p, body) {
  const r = await fetch(BRIDGE_BASE + p, { method: "POST", headers: authH(), body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function startRig() {
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
  note("rig: lane warm-up completed directly against llama-server",
    !warm.error && !!(warm.choices && warm.choices[0]));
  bridge = startBridge();
  await waitFor(() => latestCode(), 20000, "bridge pairing code");
}

async function pairAndSeat(cdp, label) {
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 0`), 15000, `locked before pairing (${label})`);
  await sleep(1200);
  await cdp.eval(`document.getElementById('setupTab').click()`);
  await sleep(600);
  await cdp.eval(`(() => { const i = document.getElementById('bridgeUrl'); i.focus(); i.select(); })()`);
  await cdp.send("Input.insertText", { text: BRIDGE_BASE });
  await cdp.eval(`(() => { const i = document.getElementById('pairCode'); i.focus(); i.select(); })()`);
  await cdp.send("Input.insertText", { text: latestCode() });
  await sleep(500);
  await cdp.eval(`document.getElementById('pairBtn').click()`);
  await waitFor(() => cdp.eval(`document.getElementById('connectScreen').classList.contains('hidden')`), 25000, `card drops after pairing (${label})`);
  token = await cdp.eval(`localStorage.getItem('vokrew.token')`);
  note(`${label}: paired through the expanded setup tab`, !!token);
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 30000, `default crew seats (${label})`);
  await waitFor(() => cdp.eval(`document.getElementById('floorRunCrew').options.length >= 2`), 20000, `crew picker populated (${label})`);
  await cdp.eval(`(() => { const s = document.getElementById('floorRunCrew'); s.value = 'rig'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(() => cdp.eval(`window.__floorDebug.agents.map(a => a.name).join(',') === 'Scout,Musky,Judge'`), 15000, `rig crew seated (${label})`);
  await sleep(2000);
}

/* ============================ PART R: paired desktop regression ============================ */

async function partRegression() {
  const errs = [];
  const { proc, cdp, ws } = await startChrome("/tmp/floor-hudfix-rig-profile", 9350, errs, true);
  try {
    interceptOrigin(cdp, `*127.0.0.1:${BRIDGE_PORT}*`, ["authorization", "content-type"]);
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*127.0.0.1:${BRIDGE_PORT}*`, requestStage: "Request" }] });
    await cdp.send("Page.navigate", { url: PAGE_URL });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load (rig)");
    await pairAndSeat(cdp, "regression");
    const idle = await cdp.eval(GEO_PROBE);
    note("regression: paired page is out of shell mode", idle.shellMode === false);
    hudCornerAssertions(idle, "paired idle (desktop)", "pairedIdle");
    await lumAssertion(cdp, "paired idle (desktop)", "pairedIdle");
    const idleSz = await shot(cdp, `${PHASE}-paired-idle.png`, `PAIRED idle desktop (${PHASE}): bottom-right HUD corner`);
    note("regression paired-idle screenshot captured", idleSz > 10000, `${idleSz} bytes`);
    await sectorSweep(cdp, "paired (desktop)", null);

    /* conductor session: call-out -> hold -> approve -> run -> settle */
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

    const geoHold = await cdp.eval(GEO_PROBE);
    results.geometry.holdPending = geoHold;
    note("regression: with a hold pending, the noticeboard (top-right) and the tab strip do not collide",
      inter(geoHold.noticeboard, geoHold.viewbar) <= 1 && inter(geoHold.noticeboard, geoHold.minimap) <= 1,
      `nb∩vb=${inter(geoHold.noticeboard, geoHold.viewbar)} nb∩mm=${inter(geoHold.noticeboard, geoHold.minimap)}`);

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
      return l.data && l.data.runs.find((r) => r.task === TEXT_NAMED && r.crew === "rig") || null;
    }, 30000, "approved run registered on the bridge");
    const runId = started.id;
    results.regression.runId = runId;
    note("regression: approved run registered on the bridge", !!runId, runId);

    /* mid-run geometry: wait for the docked strip, then measure */
    const geoRun = await waitFor(async () => {
      const p = await cdp.eval(GEO_PROBE).catch(() => null);
      return p && p.strip ? p : null;
    }, 60000, "docked run strip visible mid-run");
    results.geometry.midRun = geoRun;
    const clearRun = clearanceAbove(geoRun.viewbar, geoRun.minimap);
    note("regression mid-run: tab strip still fully clear of the sector map",
      clearRun !== null && clearRun >= 6 && inter(geoRun.viewbar, geoRun.minimap) <= 1,
      `clearance=${clearRun === null ? "n/a" : clearRun.toFixed(1)}px`);
    note("regression mid-run: docked run strip and tab strip do not collide; tabs still clickable through",
      inter(geoRun.strip, geoRun.viewbar) <= 1 && geoRun.tabs.every((t) => t.hitOk),
      `strip∩vb=${inter(geoRun.strip, geoRun.viewbar)} hitOk=${geoRun.tabs.map((t) => t.hitOk ? 1 : 0).join("")}`);
    const runSz = await shot(cdp, `${PHASE}-paired-midrun.png`, `PAIRED mid-run desktop (${PHASE}): run strip docked, tab strip + sector map corner`);
    note("regression mid-run screenshot captured", runSz > 10000, `${runSz} bytes`);

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
    const setSz = await shot(cdp, `${PHASE}-paired-settled.png`, `PAIRED settled desktop (${PHASE})`);
    note("regression settled screenshot captured", setSz > 10000, `${setSz} bytes`);
    classifyErrors(errs, "regression");
  } finally {
    try { ws.close(); } catch { /* done */ }
    proc.kill("SIGKILL");
  }
}

/* ============================ PART Q: paired phone ============================ */

async function partPhonePaired() {
  const errs = [];
  const { proc, cdp, ws } = await startChrome("/tmp/floor-hudfix-phone-rig-profile", 9351, errs, true);
  try {
    interceptOrigin(cdp, `*127.0.0.1:${BRIDGE_PORT}*`, ["authorization", "content-type"]);
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*127.0.0.1:${BRIDGE_PORT}*`, requestStage: "Request" }] });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true, screenWidth: 412, screenHeight: 915
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.navigate", { url: PAGE_URL });
    await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 25000, "floor.js + adapter load (phone rig)");
    await pairAndSeat(cdp, "phone regression");
    await cdp.eval(`document.getElementById('viewbar').scrollIntoView({ block: 'nearest' })`);
    await sleep(500);
    const idle = await cdp.eval(GEO_PROBE);
    results.geometry.phonePairedIdle = idle;
    note("phone paired idle: tabs clickable through, no collision with hint pill, no overflow",
      idle.tabs.every((t) => t.hitOk) && inter(idle.viewbar, idle.hint) <= 1 && idle.overflow.sw <= idle.overflow.iw + 1,
      `hitOk=${idle.tabs.map((t) => t.hitOk ? 1 : 0).join("")} hintOverlap=${inter(idle.viewbar, idle.hint)} overflow=${J(idle.overflow)}`);

    /* hold geometry at phone width: the noticeboard's max-height was
       re-clearanced against the tab strip's new dock (136px); with a
       hold pending the board and the tabs must not meet. The hold is
       dismissed afterwards — no run is fired from it. */
    await cdp.eval(`(() => { const i = document.getElementById('conductorInput'); i.focus(); i.scrollIntoView({ block: 'center' }); })()`);
    await sleep(400);
    for (const chunk of ["Scout, ", "write a one-line bash ", "command that prints ", "the word hello, then ", "explain it in one ", "short sentence"]) {
      await cdp.send("Input.insertText", { text: chunk });
      await sleep(300);
    }
    await sleep(500);
    await cdp.eval(`document.getElementById('conductorSend').click()`);
    const pHoldQ = await waitFor(async () => {
      const p = await cdp.eval(CONDUCTOR_PROBE).catch(() => null);
      return p && p.state && p.state.holds && p.state.holds.length === 1 ? p : null;
    }, 20000, "hold created from the call-out (phone)");
    note("phone regression: conductor call-out became exactly one hold; noticeboard shows it",
      pHoldQ.nbCards === 1 && pHoldQ.nbHidden === false,
      `noticeboard=${pHoldQ.nbCards} sidebar=${pHoldQ.sidebarCards}`);
    const geoHoldQ = await cdp.eval(GEO_PROBE);
    results.geometry.phoneHoldPending = geoHoldQ;
    note("phone hold pending: noticeboard and tab strip do not collide",
      !!geoHoldQ.noticeboard && inter(geoHoldQ.noticeboard, geoHoldQ.viewbar) <= 1,
      `nb∩vb=${inter(geoHoldQ.noticeboard, geoHoldQ.viewbar)}px2`);
    const holdIdQ = pHoldQ.state.holds[0].id;
    const dismissed = await cdp.eval(`(() => {
      const root = document.getElementById('holdList');
      const cardEl = [...root.querySelectorAll('[data-hold]')].find((r) => r.getAttribute('data-hold') === ${J(holdIdQ)});
      if (!cardEl) return false;
      const btn = cardEl.querySelector('[data-hold-action="dismiss"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    note("phone regression: hold dismissed from its card", dismissed);
    await waitFor(async () => {
      const p = await cdp.eval(CONDUCTOR_PROBE).catch(() => null);
      return p && p.state && p.state.holds && p.state.holds.length === 0 ? p : null;
    }, 15000, "hold cleared after dismiss (phone)");
    await cdp.eval(`document.getElementById('viewbar').scrollIntoView({ block: 'nearest' })`);
    await sleep(400);

    /* fire a run through the bridge API; the page must pick it up live */
    const fired = await bridgePost("/run", { task: TEXT_API, crew: "rig" });
    const apiRunId = fired.data && (fired.data.runId || (fired.data.run && fired.data.run.id));
    note("phone regression: run fired through the bridge API", fired.status === 200 || fired.status === 202 || !!apiRunId,
      `status=${fired.status} runId=${apiRunId || "?"}`);
    results.regression.apiRunId = apiRunId || null;

    await cdp.eval(`document.getElementById('viewbar').scrollIntoView({ block: 'nearest' })`);
    await sleep(400);
    const geoRun = await waitFor(async () => {
      const p = await cdp.eval(GEO_PROBE).catch(() => null);
      return p && p.strip ? p : null;
    }, 60000, "docked run strip visible on phone mid-run");
    results.geometry.phoneMidRun = geoRun;
    note("phone mid-run: docked run strip and tab strip do not collide; every tab still clickable through its center",
      inter(geoRun.strip, geoRun.viewbar) <= 1 && geoRun.tabs.every((t) => t.hitOk),
      `strip∩vb=${inter(geoRun.strip, geoRun.viewbar)}px2 hitOk=${geoRun.tabs.map((t) => t.hitOk ? 1 : 0).join("")}`);
    note("phone mid-run: zero horizontal overflow", geoRun.overflow.sw <= geoRun.overflow.iw + 1, J(geoRun.overflow));
    const sz = await shot(cdp, `${PHASE}-phone-paired-midrun.png`, `PAIRED mid-run phone 412x915 (${PHASE}): run strip + tab strip`);
    note("phone paired mid-run screenshot captured", sz > 10000, `${sz} bytes`);

    if (apiRunId) {
      let final = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 480000) {
        const { data } = await bridgeGet("/runs/" + apiRunId);
        if (data.run.state !== "running") { final = data.run; break; }
        await sleep(500);
      }
      note("phone regression: API-fired run settled done/APPROVED on the bridge",
        !!final && final.state === "done" && final.verdict === "APPROVED",
        final ? `state=${final.state} verdict=${final.verdict}` : "did not settle in 480s");
    }
    classifyErrors(errs, "phone regression");
  } finally {
    try { ws.close(); } catch { /* done */ }
    proc.kill("SIGKILL");
  }
}

try {
  if (PARTS.includes("S")) await partShell();
  if (PARTS.includes("P")) await partPhone();
  if (PARTS.includes("R") || PARTS.includes("Q")) {
    await startRig();
    if (PARTS.includes("R")) await partRegression();
    if (PARTS.includes("Q")) await partPhonePaired();
  }
} catch (e) {
  note("capture harness completed without error", false, e.message);
  results.failed = String(e.message || e);
} finally {
  for (const p of [llamaProc, bridge && bridge.proc]) {
    try { if (p) p.kill("SIGKILL"); } catch { /* already gone */ }
  }
  const missed = results.assertions.filter((a) => !a.ok);
  results.verdict = results.failed
    ? `HUD CAPTURE (${PHASE}) FAILED — ${results.failed}`
    : missed.length === 0
      ? `HUD CAPTURE (${PHASE}): COMPLETE — ${results.assertions.length}/${results.assertions.length} assertions`
      : `HUD CAPTURE (${PHASE}): COMPLETE WITH ${missed.length} MISS(ES)`;
  fs.writeFileSync(path.join(HERE, `results-${PHASE}.json`), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict);
  if (results.failed) process.exitCode = 2;
}
