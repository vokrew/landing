// Production smoke: the Floor against the live bridge on 127.0.0.1:7717
// (v0.3.1, real ledger, real crews). No model run; read-only contract checks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { launchChromium, waitFor } from "./cdp.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEB_PORT = 7789;
const EVIDENCE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "evidence");
const token = fs.readFileSync(process.env.HOME + "/.vokrew/bridge-token", "utf8").trim();
const budget = await (await fetch("http://127.0.0.1:7717/budget?surface=coding", {
  headers: { authorization: "Bearer " + token },
})).json();
const expectedUsed = budget.lanes.reduce((n, l) => n + (l.used || 0), 0);

const web = spawn(process.execPath, ["web/dev-server.js"], {
  cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
  env: { ...process.env, PORT: String(WEB_PORT) },
  stdio: "ignore",
});
let browser = null;
try {
  await waitFor(async () => {
    try { return (await fetch(`http://localhost:${WEB_PORT}/`)).ok; } catch { return false; }
  }, { timeout: 15000, label: "web" });
  browser = await launchChromium({ url: `http://localhost:${WEB_PORT}/`, port: 9394, width: 1440, height: 1000 });
  const cdp = browser.cdp;
  const ev = (js) => cdp.eval(js);
  await waitFor(async () => await ev("!!window.__vokrew && !!window.__vokrew.floor"), { timeout: 20000, label: "boot" });
  await ev(`localStorage.setItem('vokrew.token', ${JSON.stringify(token)}); localStorage.setItem('vokrew.bridgeUrl','http://127.0.0.1:7717'); localStorage.setItem('vokrew.activeCrew','example'); 'ok'`);
  await browser.goto(`http://localhost:${WEB_PORT}/`);
  await waitFor(async () => await ev("window.__vokrew.getState().online === true"), { timeout: 25000, label: "online" });
  await sleep(700);

  const st = JSON.parse(await ev("JSON.stringify(window.__vokrew.getState())"));
  assert.equal(st.paired, true);
  assert.equal(st.crewName, "example");
  assert.equal(st.floor.seated, 3);
  assert.equal(st.floor.chars.planner.name, "Scout");
  assert.equal(st.floor.chars.executor.name, "Patch");
  assert.equal(st.floor.chars.reviewer.name, "Judge");
  const pill = await ev("document.getElementById('budgetPill').textContent");
  assert.equal(Number(/CALLS TODAY\s+(\d+)/.exec(pill)[1]), expectedUsed, "pill = summed ledger");
  assert.match(pill, /\/\s*—/, "no caps configured → cap shown as —");
  assert.equal((await ev("document.getElementById('bridgeStatusText').textContent")).trim(), "LIVE");

  for (const tab of ["chat", "run", "budget", "crew", "floor"]) {
    await ev(`document.querySelector('.tab[data-tab="${tab}"]').click(); 'ok'`);
    await sleep(150);
    assert.equal(await ev(`document.querySelector('.tab[data-tab="${tab}"]').classList.contains('active')`), true, tab);
    assert.equal(await ev(`document.querySelector('.view[data-view="${tab}"]').classList.contains('active')`), true, tab + " view");
  }
  await browser.screenshot(path.join(EVIDENCE, "08-live-production-bridge.png"));

  // One still of each console, same live bridge and crew, so the visual
  // language can be judged side by side with the room.
  for (const [tab, file] of [
    ["run", "16-desk-run.png"],
    ["chat", "17-desk-chat.png"],
    ["budget", "18-desk-budget.png"],
    ["crew", "19-desk-crew.png"],
  ]) {
    await ev(`document.querySelector('.tab[data-tab="${tab}"]').click(); 'ok'`);
    await sleep(220);
    await browser.screenshot(path.join(EVIDENCE, file));
  }
  await ev("document.querySelector('.tab[data-tab=\"floor\"]').click(); 'ok'");
  await sleep(200);

  // the bridge's nameless default crew: the room must say so, not invent names
  await ev("document.getElementById('crewSelect').value = 'default'; document.getElementById('crewSelect').dispatchEvent(new Event('change', { bubbles: true })); 'ok'");
  await waitFor(async () => (await ev("window.__vokrew.getState().crewName")) === "default", { timeout: 5000, label: "crew default" });
  await sleep(300);
  const rosterText = await ev("document.getElementById('roster').textContent");
  assert.match(rosterText, /Unnamed planner/);
  assert.match(rosterText, /Unnamed executor/);
  assert.match(rosterText, /Unnamed reviewer/);
  await browser.screenshot(path.join(EVIDENCE, "09-nameless-crew-honesty.png"));

  // Phone width: the same live bridge, the named example crew, every tab.
  await ev("window.__vokrew.applyCrew('example')");
  await waitFor(async () => (await ev("window.__vokrew.getState().crewName")) === "example", { timeout: 5000, label: "crew example" });
  const phone = await launchChromium({ url: `http://localhost:${WEB_PORT}/`, port: 9395, width: 390, height: 1200 });
  const pev = (js) => phone.cdp.eval(js);
  try {
    await waitFor(async () => await pev("!!window.__vokrew && !!window.__vokrew.floor"), { timeout: 20000, label: "phone boot" });
    await pev(`localStorage.setItem('vokrew.token', ${JSON.stringify(token)}); localStorage.setItem('vokrew.bridgeUrl','http://127.0.0.1:7717'); localStorage.setItem('vokrew.activeCrew','example'); 'ok'`);
    await phone.goto(`http://localhost:${WEB_PORT}/`);
    // Chromium enforces a 500px minimum window width; force the layout viewport
    // to a real phone width so the print paper and the CSS layout agree.
    await phone.setViewport(390, 1200, 1);
    await waitFor(async () => await pev("window.__vokrew.getState().online === true"), { timeout: 25000, label: "phone online" });
    await sleep(700);
    for (const [tab, file] of [
      ["floor", "11-phone-floor.png"],
      ["run", "12-phone-run.png"],
      ["chat", "13-phone-chat.png"],
      ["budget", "14-phone-budget.png"],
      ["crew", "15-phone-crew.png"],
    ]) {
      await pev(`document.querySelector('.tab[data-tab="${tab}"]').click(); 'ok'`);
      await sleep(220);
      // The Run page's chain rail needs a taller paper than the other tabs.
      await phone.screenshot(path.join(EVIDENCE, file), tab === "run" ? { height: 1600 } : {});
    }
    const phoneErrors = phone.errors().filter((e) => !/favicon/i.test(e));
    assert.deepEqual(phoneErrors, [], "no phone console errors");
  } finally {
    await phone.close();
  }

  const errors = browser.errors().filter((e) => !/favicon/i.test(e));
  assert.deepEqual(errors, [], "no console errors");
  console.log("production smoke ok:", { used: expectedUsed, pill, crew: st.crewName });
} finally {
  try { if (browser) await browser.close(); } catch { /* gone */ }
  try { web.kill("SIGTERM"); } catch { /* gone */ }
}
process.exit(0);
