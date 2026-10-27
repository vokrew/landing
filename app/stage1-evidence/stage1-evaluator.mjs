#!/usr/bin/env node
/*
 * Stage 1 evaluator — PHASE1-FLOOR-SPEC.md §6, Stage 1 gate.
 *
 * Drives the real /app page in headless Chromium over CDP and asserts:
 *   1. the page loads and runs with ZERO console errors / exceptions;
 *   2. the existing Chat/Run/Budget/Crew tabs still switch (regression);
 *   3. the Floor room loads (floor.js lazy), the fixture seats a roster
 *      of exactly 3 agents, all sitting at their desks;
 *   4. the page's own auditRoutes() reports every destination —
 *      including all 19 doorsteps — reachable, zero failures;
 *   5. a canvas pixel-probe finds the static layer non-blank in all
 *      four zones (foundry / skyloft / workshop / yard);
 *   6. the fixture's scripted live-run sequence actually plays through
 *      the engine: a live run appears, an agent enters mode "work"
 *      (planner first), the task completes, and the quest log shows
 *      the done pill;
 *   7. screenshots land in this directory for the Stage 4 side-by-side.
 *
 * The bridge on :7717 is a STUB (health/crews only) so app.js can pair
 * and enter the shell; the Floor room itself is fixture-fed in Stage 1
 * and never talks to it. Run:  node stage1-evaluator.mjs
 * Exit code 0 = gate green.
 *
 * ENVIRONMENT NOTE (this VM's managed Chromium 152): CDP-driven
 * navigations to http://127.0.0.1 are hard-blocked by Local Network
 * Access checks (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS) —
 * feature flags, --disable-web-security, and CDP permission grants do
 * not lift it; only the browser's own UI navigation would. The page
 * is therefore loaded over file:// (a local-address-space origin,
 * which LNA permits, and from which the loopback bridge fetch is
 * local→local). Production serving (vokrew.com over HTTPS) is not
 * affected by this; Stages 2–4 rigs on this VM will need the same
 * route or a browser-UI-driven browser.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const CHROME = process.env.CHROME || "/opt/meta-chromium/chrome";
const BRIDGE_PORT = 7717;
const CDP_PORT = 9333;
const PAGE_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;

const results = { assertions: [], consoleErrors: [], screenshots: [] };
function assert(name, ok, detail = "") {
  results.assertions.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- stub bridge ---------------- */

const stubBridge = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, "http://x").pathname;
  const json = (obj) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (u === "/health") return json({ ok: true, name: "vokrew", version: "eval-stub", surfaces: ["coding", "chat"] });
  if (u === "/crews") return json({ ok: true, crews: [{ name: "default", roles: {} }] });
  if (u === "/lanes") return json({ ok: true, lanes: [] });
  if (u === "/budget") return json({ ok: true, surface: "coding", day: "eval", lanes: [], otherSurfaceTotal: 0, text: "" });
  return json({ ok: true });
});

/* ---------------- tiny CDP client ---------------- */

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

/* ---------------- main ---------------- */

let chromeProc = null;
try {
  await new Promise((r) => stubBridge.listen(BRIDGE_PORT, "127.0.0.1", r));

  const chromeEnv = { ...process.env };
  for (const k of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]) delete chromeEnv[k];
  chromeProc = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server",
    `--remote-debugging-port=${CDP_PORT}`, "--window-size=1440,900",
    "--user-data-dir=/tmp/floor-eval-profile", "about:blank"
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
      results.consoleErrors.push("log: " + m.params.entry.text);
    }
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("vokrew.token", "eval-token");`
  });
  await cdp.send("Page.navigate", { url: PAGE_URL });

  // App shell enters (stub bridge pairs the seeded token).
  await waitFor(() => cdp.eval(`!document.getElementById('appShell').classList.contains('hidden')`), 15000, "app shell");
  assert("app shell enters with stub bridge", true);

  // Regression: existing tabs still switch.
  let tabsOk = true;
  for (const name of ["budget", "crew", "run", "chat"]) {
    await cdp.eval(`document.querySelector('[data-screen="${name}"]').click()`);
    await sleep(250);
    const vis = await cdp.eval(`!document.getElementById('screen-${name}').classList.contains('hidden')`);
    if (!vis) tabsOk = false;
  }
  assert("existing tabs (chat/run/budget/crew) still switch", tabsOk);

  // Open the Floor.
  await cdp.eval(`document.querySelector('[data-screen="floor"]').click()`);
  await waitFor(() => cdp.eval(`!!(window.__floorDebug && window.VokrewFloor)`), 20000, "floor.js load");
  await waitFor(() => cdp.eval(`window.__floorDebug.state().agents === 3`), 15000, "fixture seats 3 agents");

  const rosterCount = await cdp.eval(`document.querySelectorAll('#roster .acard').length`);
  assert("roster renders 3 agents", rosterCount === 3, `count=${rosterCount}`);

  // Agents at their desks (fixture idle window).
  await sleep(900);
  const act0 = await cdp.eval(`window.__floorDebug.activity()`);
  assert("3 agents seated at desks",
    act0.length === 3 && act0.every((a) => a.sitting === true),
    JSON.stringify(act0.map((a) => `${a.agent}:${a.mode}:${a.sitting}`)));

  const idleLive = await cdp.eval(`window.__floorDebug.state().liveRuns`);
  const idleShot = path.join(HERE, "stage1-room-idle.png");
  const shot1 = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(idleShot, Buffer.from(shot1.data, "base64"));
  results.screenshots.push({ file: "stage1-room-idle.png", liveRunsAtCapture: idleLive });
  assert("idle screenshot captured", fs.statSync(idleShot).size > 10000, `${fs.statSync(idleShot).size} bytes, liveRuns=${idleLive}`);

  // The page's own reachability audit — every doorstep, zero "no path".
  const audit = await cdp.eval(`window.__floorDebug.auditRoutes()`);
  const doorsteps = await cdp.eval(`window.__floorDebug.allDoorsteps().length`);
  assert("auditRoutes: every destination reachable, zero failures",
    audit.ok === true && audit.failures === 0 && audit.agents === 3,
    `routes=${audit.routes} destinations=${audit.destinations} failures=${audit.failures}`);
  assert("all doorsteps present (19 cubicles + office)", doorsteps === 20, `doorsteps=${doorsteps}`);

  // Fixture live-run sequence plays through the engine (loops every 26s;
  // watch up to two cycles for the full arc + an executor-phase shot).
  let sawLive = false, sawWork = false, plannerFirst = false, sawDone = false, runShotDone = false;
  let firstLiveAgent = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 80000 && !(sawDone && runShotDone)) {
    const st = await cdp.eval(`window.__floorDebug.state()`).catch(() => null);
    if (st && st.liveRuns > 0) {
      sawLive = true;
      const lv = await cdp.eval(`window.__floorDebug.liveRuns[0] && window.__floorDebug.liveRuns[0].agentId`);
      if (!firstLiveAgent && lv) { firstLiveAgent = lv; plannerFirst = lv === "fixture:planner"; }
      const act = await cdp.eval(`window.__floorDebug.activity()`);
      if (act.some((a) => a.mode === "work")) sawWork = true;
      if (lv === "fixture:executor" && !runShotDone) {
        await cdp.eval(`window.__floorDebug.setView('overview')`);
        await sleep(1000);
        const p = path.join(HERE, "stage1-room-run.png");
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(p, Buffer.from(shot.data, "base64"));
        results.screenshots.push({ file: "stage1-room-run.png", phase: "executor live" });
        runShotDone = fs.statSync(p).size > 10000;
      }
    }
    const taskStatus = await cdp.eval(`(window.__floorDebug.tasks[0] || {}).status`).catch(() => null);
    if (taskStatus === "done") {
      sawDone = true;
      const pill = await cdp.eval(`!!document.querySelector('#tasklist .pill.done')`);
      if (pill) results.questDonePill = true;
    }
    await sleep(400);
  }
  assert("fixture live-run appears in the room", sawLive);
  assert("planner works first", plannerFirst, `first live agent=${firstLiveAgent}`);
  assert("an agent visibly works (mode=work)", sawWork);
  assert("fixture run completes; quest log shows done pill", sawDone && results.questDonePill === true);
  assert("mid-run screenshot captured", runShotDone);

  // Pixel probe: static layer non-blank in all four zones.
  for (const zone of ["foundry", "skyloft", "workshop", "yard"]) {
    await cdp.eval(`window.__floorDebug.setView('room', '${zone}')`);
    await sleep(1200);
    const frac = await cdp.eval(`(() => {
      const cv = document.getElementById('cv');
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let non = 0, tot = 0;
      for (let i = 0; i < d.length; i += 16) {
        tot++;
        if (Math.abs(d[i] - 5) + Math.abs(d[i + 1] - 8) + Math.abs(d[i + 2] - 12) > 24) non++;
      }
      return non / tot;
    })()`);
    assert(`static layer non-blank in zone: ${zone}`, frac > 0.04, `non-bg fraction=${frac.toFixed(3)}`);
  }
  await cdp.eval(`window.__floorDebug.setView('overview')`);

  assert("zero console errors for the whole session", results.consoleErrors.length === 0,
    results.consoleErrors.slice(0, 4).join(" | "));

  ws.close();
} catch (e) {
  assert("evaluator completed without harness error", false, e.message);
} finally {
  if (chromeProc) chromeProc.kill("SIGKILL");
  stubBridge.close();
  const failed = results.assertions.filter((a) => !a.ok);
  results.verdict = failed.length === 0 ? "STAGE 1 GATE: PASS" : `STAGE 1 GATE: FAIL (${failed.length})`;
  fs.writeFileSync(path.join(HERE, "results.json"), JSON.stringify(results, null, 2));
  console.log("\n" + results.verdict);
  process.exit(failed.length === 0 ? 0 : 1);
}
