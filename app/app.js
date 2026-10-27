"use strict";
/*
 * Vokrew web face — a remote control for the user's own local bridge.
 *
 * Honesty rules baked in:
 * - This page makes NO external requests. Every fetch goes to the bridge
 *   URL the user entered (default http://127.0.0.1:7717) plus one of the
 *   bridge's known endpoints: /pair /health /run /chat /budget /lanes /crews.
 * - The pairing token lives in localStorage and is sent ONLY to that bridge.
 * - If the bridge can't be reached, the UI goes back to Connect with a plain
 *   message. No fake data, no spinner forever, no hosted demo (coming soon).
 */
const DEFAULT_BRIDGE = "http://127.0.0.1:7717";
const LS_BRIDGE = "vokrew.bridgeUrl";
const LS_TOKEN = "vokrew.token";
const UNREACHABLE_MSG = "Can't reach your crew — is the Vokrew bridge running on this device? (See “How this works” above.)";

const $ = (id) => document.getElementById(id);

const state = {
  bridge: (localStorage.getItem(LS_BRIDGE) || DEFAULT_BRIDGE).replace(/\/+$/, ""),
  token: localStorage.getItem(LS_TOKEN) || null,
  sessionId: null,
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------------- bridge calls ---------------- */

async function bridgeFetch(path, { method = "GET", body, auth = true, timeoutMs = 30000 } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(state.bridge + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealth() {
  try {
    const { status, data } = await bridgeFetch("/health", { auth: false, timeoutMs: 4000 });
    return status === 200 && data && data.ok === true;
  } catch {
    return false;
  }
}

/* ---------------- connection state ---------------- */

function setStatus(mode, text) {
  const pill = $("statusPill");
  pill.classList.remove("ok", "bad");
  if (mode) pill.classList.add(mode);
  $("statusText").textContent = text;
}

/* EMPTY-FLOOR SHELL (KC, 2026-10-27): the shell always renders, and
   unpaired it renders as the empty floor — the real room in the
   adapter's locked state (OFFLINE, nobody seated, no data), labeled
   by the shell banner. The setup card is a collapsed tab in that
   banner: it expands when the visitor opens it, or when a message
   says the user must act (invalid pairing, bridge died mid-session).
   The Stage 3 forced door — overlay up on every unpaired load — is
   retired; the room was never faked then and is not faked now, it is
   simply no longer covered. */
function setSetupOpen(open) {
  $("connectScreen").classList.toggle("hidden", !open);
  document.body.classList.toggle("door-open", open);
  const tab = $("setupTab");
  if (tab) tab.setAttribute("aria-expanded", open ? "true" : "false");
}

function syncShellMode() {
  // Shell mode = the page holds no pairing token. Drives the banner
  // and hides the run / conductor forms (nothing can run until a
  // crew exists) — presentation only; adapter state is untouched.
  document.body.classList.toggle("shell-mode", !state.token);
}

function showConnect(message) {
  state.sessionId = null;
  $("disconnectBtn").classList.add("hidden");
  activateTab("floor"); // the locked room is the home screen either way
  if (state.token) setStatus("bad", "bridge unreachable");
  else setStatus("", "not connected");
  const err = $("pairError");
  if (message) {
    err.textContent = message;
    err.classList.remove("hidden");
    setSetupOpen(true); // a message means the user needs to act — show it
  } else {
    err.classList.add("hidden");
    setSetupOpen(false); // no message: the empty-floor shell, unforced
  }
  syncShellMode();
}

async function enterApp() {
  // Health first, then prove the stored token still works.
  if (!(await checkHealth())) {
    showConnect(UNREACHABLE_MSG);
    return false;
  }
  try {
    const { status } = await bridgeFetch("/crews");
    if (status === 401) {
      disconnect("That pairing is no longer valid — pair again to continue.");
      return false;
    }
  } catch {
    showConnect(UNREACHABLE_MSG);
    return false;
  }
  $("pairError").classList.add("hidden");
  setSetupOpen(false);
  syncShellMode(); // token held: the shell fills with the real crew
  $("disconnectBtn").classList.remove("hidden");
  setStatus("ok", "connected");
  activateTab("floor"); // Stage 3: the Floor is the default post-pair screen
  return true;
}

function disconnect(message) {
  state.token = null;
  localStorage.removeItem(LS_TOKEN);
  showConnect(message);
  setStatus("", "not connected");
  if (message) {
    const err = $("pairError");
    err.textContent = message;
    err.classList.remove("hidden");
  }
}

// Any authed call that comes back 401 or unreachable mid-session drops the
// UI back to Connect — never a dead screen or a stuck spinner.
function handleDeadBridge(status) {
  if (status === 401) {
    disconnect("That pairing is no longer valid — pair again to continue.");
    return true;
  }
  return false;
}

async function guardedCall(path, opts) {
  let out;
  try {
    out = await bridgeFetch(path, opts);
  } catch {
    showConnect(UNREACHABLE_MSG);
    setStatus("bad", "bridge unreachable");
    throw new Error("unreachable");
  }
  if (handleDeadBridge(out.status)) throw new Error("unauthorized");
  if (out.status !== 200 || !out.data || out.data.ok !== true) {
    throw new Error((out.data && out.data.error) || `bridge returned ${out.status}`);
  }
  return out.data;
}

/* ---------------- pairing ---------------- */

$("pairForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("pairError");
  err.classList.add("hidden");
  const urlInput = $("bridgeUrl").value.trim().replace(/\/+$/, "");
  if (urlInput) {
    state.bridge = urlInput;
    localStorage.setItem(LS_BRIDGE, state.bridge);
  }
  const code = $("pairCode").value.trim();
  const btn = $("pairBtn");
  btn.disabled = true;
  btn.textContent = "Pairing…";
  try {
    let res;
    try {
      res = await bridgeFetch("/pair", { method: "POST", body: { code }, auth: false, timeoutMs: 8000 });
    } catch {
      err.textContent = UNREACHABLE_MSG;
      err.classList.remove("hidden");
      return;
    }
    if (res.status !== 200 || !res.data || !res.data.token) {
      err.textContent = (res.data && res.data.error) || "Pairing failed — check the code and try again.";
      err.classList.remove("hidden");
      return;
    }
    state.token = res.data.token;
    localStorage.setItem(LS_TOKEN, state.token);
    $("pairCode").value = "";
    await enterApp();
  } finally {
    btn.disabled = false;
    btn.textContent = "Pair";
  }
});

$("disconnectBtn").addEventListener("click", () => disconnect());

/* The shell's setup tab expands the pairing card; the card's close
   control collapses it back to the shell. Invited, never forced —
   closing loses nothing: unpaired, the empty floor waits; paired
   with a down bridge, the room behind shows its OFFLINE state. */
$("setupTab").addEventListener("click", () => {
  setSetupOpen(true);
  const code = $("pairCode");
  if (code) code.focus();
});
$("connectClose").addEventListener("click", () => setSetupOpen(false));

/* ---------------- tabs ---------------- */

function activateTab(name) {
  // Phase 2 Stage 0 (G-2): floor mode lets the room take the viewport
  // (see the floor-mode rules in app.css / floor.css).
  document.body.classList.toggle("floor-on", name === "floor");
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.screen === name));
  ["chat", "budget", "crew", "floor"].forEach((s) => {
    $("screen-" + s).classList.toggle("hidden", s !== name);
  });
  if (name === "budget") refreshBudget();
  if (name === "crew") refreshCrew();
  if (name === "floor") openFloor();
  else closeFloor();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.screen));
});

/* ---------------- floor (Phase 1) ----------------
   floor.js (the room: world, engine, drawing — a fork of floor-oc) is
   lazy-loaded the first time the Floor tab opens, so the connect /
   chat / run path never pays for it. The state source is
   floor-adapter.js (Stage 2): it polls the real bridge and feeds live
   crews / runs / stamps / budget through the adapter boundary
   (VokrewFloor.applyState). */

let floorLoaded = false;
let floorLoading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("failed to load " + src));
    document.body.appendChild(s);
  });
}

async function openFloor() {
  if (!floorLoaded) {
    if (!floorLoading) {
      floorLoading = (async () => {
        await loadScript("floor.js");
        await loadScript("floor-adapter.js"); // Stage 2: live bridge data (spec §3)
        floorLoaded = true;
      })();
    }
    try { await floorLoading; } catch { floorLoading = null; return; }
  }
  if (window.VokrewFloor) window.VokrewFloor.setActive(true);
}

function closeFloor() {
  if (floorLoaded && window.VokrewFloor) window.VokrewFloor.setActive(false);
}

/* ---------------- chat ---------------- */

function addMessage(who, text, { stamp = "", verdict = null, error = false } = {}) {
  const thread = $("chatThread");
  const wrap = document.createElement("div");
  wrap.className = "msg " + who + (error ? " error" : "");
  const whoEl = document.createElement("div");
  whoEl.className = "who";
  whoEl.textContent = who === "user" ? "YOU" : "CREW";
  const textEl = document.createElement("div");
  textEl.className = "text";
  textEl.textContent = text;
  wrap.append(whoEl, textEl);
  if (verdict) {
    const v = document.createElement("div");
    v.className = "verdictline " + (verdict === "CHANGES" ? "bad" : "ok");
    v.textContent = verdict === "CHANGES" ? "Reviewer verdict: CHANGES requested" : `Reviewer verdict: ${verdict}`;
    wrap.appendChild(v);
  }
  if (stamp) {
    const s = document.createElement("div");
    s.className = "stamp";
    s.textContent = stamp;
    wrap.appendChild(s);
  }
  thread.appendChild(wrap);
  wrap.scrollIntoView({ block: "end", behavior: "smooth" });
}

$("chatForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("chatInput");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  addMessage("user", message);
  const btn = $("chatSend");
  btn.disabled = true;
  try {
    const body = { message, verify: $("verifyToggle").checked };
    if (state.sessionId) body.sessionId = state.sessionId;
    const data = await guardedCall("/chat", { method: "POST", body });
    if (data.sessionId) state.sessionId = data.sessionId;
    addMessage("crew", data.text, {
      stamp: (data.compactStamps || []).join("  "),
      verdict: data.verdict || null,
    });
  } catch (err) {
    if (err.message !== "unreachable" && err.message !== "unauthorized") {
      addMessage("crew", `The run failed: ${err.message}`, { error: true });
    }
  } finally {
    btn.disabled = false;
    input.focus();
  }
});

/* ---------------- run ----------------
   Folded into the Floor (Phase 2 Stage 0): the Run tab is gone. Runs
   are submitted from the Floor's own form and their full stage text
   (plan / work / review + stamps) renders in the Floor run card —
   the Stage 0 evaluator proved the settled card byte-equal to the
   bridge record before this fold landed. */

/* ---------------- budget ---------------- */

function renderBudgetPanel(el, data) {
  el.innerHTML = "";
  (data.lanes || []).forEach((lane) => {
    const row = document.createElement("div");
    row.className = "lane-row";
    if (lane.cap === null || lane.cap === undefined) {
      row.innerHTML =
        `<div class="lane-head"><span>${esc(lane.id)}</span><span class="nums">${lane.used} used · unlimited</span></div>` +
        `<div class="budget-note">no cap on this lane</div>`;
    } else {
      const pct = lane.cap > 0 ? Math.min(100, Math.round((lane.used / lane.cap) * 100)) : 0;
      const cls = lane.used >= lane.cap ? "maxed" : pct >= 75 ? "hot" : "";
      row.innerHTML =
        `<div class="lane-head"><span>${esc(lane.id)}</span><span class="nums">${lane.used} / ${lane.cap} · ${lane.remaining} left</span></div>` +
        `<div class="bar"><i class="${cls}" style="width:${pct}%"></i></div>`;
    }
    el.appendChild(row);
  });
  const note = document.createElement("div");
  note.className = "budget-note";
  note.textContent = `today (${data.day}) · the other surface used ${data.otherSurfaceTotal} calls — counted separately`;
  el.appendChild(note);
}

async function refreshBudget() {
  try {
    const [coding, chat] = await Promise.all([
      guardedCall("/budget?surface=coding"),
      guardedCall("/budget?surface=chat"),
    ]);
    renderBudgetPanel($("budgetCoding"), coding);
    renderBudgetPanel($("budgetChat"), chat);
  } catch { /* guardedCall already surfaced the problem */ }
}
$("budgetRefresh").addEventListener("click", refreshBudget);

/* ---------------- crew ---------------- */

function laneHealthClass(health) {
  if (/^NOT reachable/.test(health)) return "bad";
  if (/unsupported|no .*KEY|no API key/i.test(health)) return "warn";
  return "ok";
}

async function refreshCrew() {
  try {
    const [crewsData, lanesData] = await Promise.all([guardedCall("/crews"), guardedCall("/lanes")]);
    const crewList = $("crewList");
    crewList.innerHTML = "";
    (crewsData.crews || []).forEach((crew) => {
      const card = document.createElement("div");
      card.className = "crew-card";
      let html = `<h4>${esc(crew.name)}</h4>`;
      const roles = crew.roles || {};
      const roleNames = Object.keys(roles);
      if (!roleNames.length) html += `<div class="role-line">Default crew — plain pipeline roles, no named agents.</div>`;
      ["planner", "executor", "reviewer", ...roleNames.filter((r) => !["planner", "executor", "reviewer"].includes(r))].forEach((role) => {
        const slot = roles[role];
        if (!slot) return;
        const bits = [];
        if (slot.name) bits.push(`<span class="agent-name">${esc(slot.name)}</span>`);
        if (slot.instructions) bits.push(`<span class="instr">${esc(slot.instructions)}</span>`);
        if (Array.isArray(slot.lanes) && slot.lanes.length) bits.push(`lanes: ${esc(slot.lanes.join(", "))}`);
        if (slot.model) bits.push(`model: ${esc(slot.model)}`);
        html += `<div class="role-line"><b>${esc(role)}</b> ${bits.join(" · ") || "—"}</div>`;
      });
      card.innerHTML = html;
      crewList.appendChild(card);
    });
    const laneList = $("laneList");
    laneList.innerHTML = "";
    (lanesData.lanes || []).forEach((lane) => {
      const card = document.createElement("div");
      card.className = "lane-card";
      card.innerHTML =
        `<h4>${esc(lane.id)}</h4>` +
        `<div class="meta">${esc(lane.provider)} · ${esc(lane.model)} · family ${esc(lane.family)} · tier ${esc(lane.tier)} · cap ${lane.cap === null ? "unlimited" : lane.cap}</div>` +
        `<div class="health ${laneHealthClass(lane.health)}">${esc(lane.health)}</div>`;
      laneList.appendChild(card);
    });
  } catch { /* guardedCall already surfaced the problem */ }
}

/* ---------------- boot + health watch ---------------- */

$("bridgeUrl").value = state.bridge;

if (state.token) {
  enterApp();
} else {
  // Unpaired: the empty-floor shell. The room renders empty and
  // OFFLINE behind the shell banner; the setup card stays collapsed
  // until the visitor opens it (showConnect with no message).
  showConnect();
}

// Health watch: if the bridge dies mid-session, raise the setup card
// with the unreachable message (spec rule). If it comes back and we
// still hold a token, re-enter quietly. "In the app" = the card is
// down. Every branch is token-guarded: an unpaired shell visitor has
// no session to lose, and a silent health probe must never force
// the card open over the empty floor they are exploring.
setInterval(async () => {
  const inApp = $("connectScreen").classList.contains("hidden");
  const ok = await checkHealth();
  if (inApp && !ok && state.token) {
    showConnect(UNREACHABLE_MSG);
    setStatus("bad", "bridge unreachable");
  } else if (!inApp && ok && state.token) {
    enterApp();
  } else if (inApp && ok && state.token) {
    setStatus("ok", "connected");
  }
}, 20000);
