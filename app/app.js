// Vokrew web face — the page.
//
// All bridge JSON → room state translation lives in adapter.js. This file
// wires that state to the DOM: the Floor, the tab views, the run card, the
// focus panel, and the pairing flow. Honesty rules live here too: nothing is
// rendered that the bridge did not report.

import {
  RUN_LOST,
  RUN_LOST_RELOAD,
  RUN_LOST_NO_STATE,
  ROLE_ORDER,
  ROLE_PALETTE,
  BridgeClient,
  budgetPill,
  failovers,
  fmtMs,
  modelLabel,
  reviewSentence,
  rosterFor,
  settleStaleRuns,
  stampLine,
  stampText,
  stampsByRole,
  upsertRecord,
  verdictTone,
} from "./adapter.js";

import { createFloor, DOORSTEPS, SEATS, TILE } from "./floor.js";

const LS = {
  url: "vokrew.bridgeUrl",
  token: "vokrew.token",
  crew: "vokrew.activeCrew",
  journal: "vokrew.journal",
  tab: "vokrew.tab",
};

const ROLE_LABEL = { planner: "planner", executor: "executor", reviewer: "reviewer" };
const ROLE_SHORT = { planner: "plan", executor: "work", reviewer: "review" };
const PART_KEY = { planner: "plan", executor: "work", reviewer: "review" };
const STATE_LABEL = {
  idle: "at desk",
  working: "working",
  done: "done",
  walking: "walking",
  reviewing: "reviewing",
  waiting: "waiting",
};

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------------- */
/* tiny DOM helper                                                           */
/* ------------------------------------------------------------------------- */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v; // trusted literals only
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ------------------------------------------------------------------------- */
/* markdown → DOM (safe: every model string becomes text nodes)              */
/* ------------------------------------------------------------------------- */

// Inline spans. Deliberately small: bold, italic, inline code and http(s)
// links. Everything else stays literal text, so a model cannot inject markup.
//
// The parser is a small recursive descent, not a single regex pass: code
// spans are tokenized first at every level, so a code span nested inside
// bold (`**Type `pwd`…**`) keeps its CODE element instead of leaking its
// backticks into the <strong> as literal punctuation.
function inlineMarkdown(text) {
  const frag = document.createDocumentFragment();
  appendInline(frag, String(text ?? ""));
  return frag;
}

function appendInline(frag, src) {
  let buf = "";
  const flush = () => {
    if (buf) { frag.append(document.createTextNode(buf)); buf = ""; }
  };
  let i = 0;
  while (i < src.length) {
    // inline code — contents stay literal, never re-parsed
    if (src[i] === "`") {
      const end = src.indexOf("`", i + 1);
      const inner = end > i + 1 ? src.slice(i + 1, end) : null;
      if (inner !== null && !inner.includes("\n")) {
        flush();
        frag.append(h("code", { text: inner }));
        i = end + 1;
        continue;
      }
    }
    // bold — the inner text parses recursively, so code/italic nest inside
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      const inner = end > i + 2 ? src.slice(i + 2, end) : null;
      if (inner !== null && !inner.includes("\n")) {
        flush();
        const strong = h("strong", {});
        appendInline(strong, inner);
        frag.append(strong);
        i = end + 2;
        continue;
      }
    }
    // link
    if (src[i] === "[") {
      const link = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/.exec(src.slice(i));
      if (link) {
        flush();
        frag.append(h("a", {
          href: link[2], target: "_blank", rel: "noopener noreferrer", text: link[1],
        }));
        i += link[0].length;
        continue;
      }
    }
    // italic
    if (src[i] === "*" && src[i + 1] !== "*") {
      const end = src.indexOf("*", i + 1);
      const inner = end > i + 1 ? src.slice(i + 1, end) : null;
      if (inner !== null && !inner.includes("\n") && !inner.includes("*")) {
        flush();
        const em = h("em", {});
        appendInline(em, inner);
        frag.append(em);
        i = end + 1;
        continue;
      }
    }
    buf += src[i];
    i += 1;
  }
  flush();
}

// Block-level markdown: headings, fenced code, lists, quotes, rules and
// paragraphs. The run card, conduct transcript and chat replies all use it so
// `**Plan:**` reads as a heading, not as punctuation.
function markdownNode(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blockStart = (line) => /^\s*(#{1,4}\s|```|>\s?|[-*+]\s+|\d+[.)]\s+|([-*_])\2{2,}\s*$)/.test(line);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i += 1;
      const code = h("code", { text: body.join("\n") });
      if (fence[1]) code.dataset.lang = fence[1];
      frag.append(h("pre", { class: "md-code" }, code));
      continue;
    }

    const heading = /^\s*(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length + 2);
      frag.append(h("h" + level, { class: "md-h" }, inlineMarkdown(heading[2])));
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      frag.append(h("hr"));
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      frag.append(h("blockquote", { class: "md-quote" }, inlineMarkdown(body.join(" "))));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const list = h("ul", { class: "md-list" });
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        list.append(h("li", {}, inlineMarkdown(lines[i].replace(/^\s*[-*+]\s+/, ""))));
        i += 1;
      }
      frag.append(list);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const list = h("ol", { class: "md-list" });
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        list.append(h("li", {}, inlineMarkdown(lines[i].replace(/^\s*\d+[.)]\s+/, ""))));
        i += 1;
      }
      frag.append(list);
      continue;
    }

    const body = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) {
      body.push(lines[i].trim());
      i += 1;
    }
    frag.append(h("p", {}, inlineMarkdown(body.join(" "))));
  }
  return frag;
}

function store(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode / storage disabled */ }
}

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function loadJournal() {
  const raw = load(LS.journal);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveJournal(journal) {
  try { store(LS.journal, JSON.stringify(journal.slice(0, 40))); } catch { /* too big — keep memory copy */ }
}

function timeOf(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayOf(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function durationOf(rec) {
  if (!rec || !rec.startedAt || !rec.endedAt) return null;
  const ms = new Date(rec.endedAt) - new Date(rec.startedAt);
  if (!isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  return Math.floor(s / 60) + "m " + (s % 60) + "s";
}

function shortTask(task, n = 64) {
  const s = String(task || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function ttlBubble(text, n = 150) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* ------------------------------------------------------------------------- */
/* app state                                                                 */
/* ------------------------------------------------------------------------- */

const app = {
  client: new BridgeClient({ baseUrl: load(LS.url) || "http://127.0.0.1:7717", token: load(LS.token) }),
  token: load(LS.token),
  url: load(LS.url) || "http://127.0.0.1:7717",
  paired: false,
  online: false,
  crews: [],
  crewName: load(LS.crew) || "default",
  roster: [],
  journal: loadJournal(),
  budget: null,
  chatBudget: null,
  lanes: [],
  running: false,
  phase: "idle",
  served: 0,
  conduct: false,
  pendingId: null,
  lastRecord: null,
  lastSource: null,
  chatSession: null,
  chatBusy: false,
  reviewWalkStarted: false,
  timers: [],
  bootDone: false,
  healthTimer: null,
  budgetTimer: null,
  rosterTimer: null,
  reattachTimer: null,
  reattaching: false,
  floor: null,
};

/* ------------------------------------------------------------------------- */
/* boot                                                                      */
/* ------------------------------------------------------------------------- */

function initFloor() {
  app.floor = createFloor($("floorCanvas"), {
    onSelect: (role) => renderFocus(role),
  });
  window.__floor = app.floor;
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setTab(tab.dataset.tab));
  });

  $("connectBtn").addEventListener("click", openPairModal);
  $("lockConnect").addEventListener("click", openPairModal);
  $("pairClose").addEventListener("click", closePairModal);
  $("pairForm").addEventListener("submit", safe(async (ev) => {
    ev.preventDefault();
    await pairFromForm();
  }));
  $("forgetBtn").addEventListener("click", safe(forgetPairing));

  $("conductForm").addEventListener("submit", safe(async (ev) => {
    ev.preventDefault();
    const input = $("conductInput");
    const task = input.value.trim();
    if (!task) return;
    input.value = "";
    await startRun(task, { conduct: true, surface: "coding", source: "floor" });
  }));

  $("crewSelect").addEventListener("change", (ev) => applyCrew(ev.target.value));
  $("crewSelectPage").addEventListener("change", (ev) => applyCrew(ev.target.value));

  // Suggested prompts are product copy, not bridge data: they only fill the
  // composer. Nothing is sent until the person presses Send.
  $("chatLog").addEventListener("click", (ev) => {
    const chip = ev.target.closest("[data-prompt]");
    if (!chip) return;
    $("chatInput").value = chip.dataset.prompt || "";
    $("chatInput").focus();
  });
  $("runForm").addEventListener("click", (ev) => {
    const chip = ev.target.closest("[data-task]");
    if (!chip) return;
    $("runTask").value = chip.dataset.task || "";
    $("runTask").focus();
  });

  $("focusClose").addEventListener("click", () => app.floor.setSelected(null));

  $("runForm").addEventListener("submit", safe(async (ev) => {
    ev.preventDefault();
    const task = $("runTask").value.trim();
    if (!task) return;
    await startRun(task, {
      surface: $("runSurface").value,
      workspace: $("runWorkspace").value.trim() || null,
      conduct: false,
      source: "run",
    });
  }));

  $("chatForm").addEventListener("submit", safe(async (ev) => {
    ev.preventDefault();
    const input = $("chatInput");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    await sendChat(msg);
  }));

  $("budgetRefresh").addEventListener("click", safe(async () => {
    await refreshBudget({ force: true });
  }));

  $("runModal").addEventListener("click", (ev) => {
    if (ev.target === $("runModal")) closeRunModal();
  });
  $("runClose").addEventListener("click", closeRunModal);
  $("pairModal").addEventListener("click", (ev) => {
    if (ev.target === $("pairModal")) closePairModal();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (!$("runModal").hidden) closeRunModal();
      else if (!$("pairModal").hidden) closePairModal();
      else app.floor.setSelected(null);
    }
  });

  $("chatInput").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      $("chatForm").requestSubmit();
    }
  });
  $("conductInput").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      $("conductForm").requestSubmit();
    }
  });
}

async function boot() {
  initFloor();
  bindEvents();
  // Keep any "running" records until reattachment has had its chance below;
  // anything still running after that is honestly marked lost.
  renderQuestLog();
  renderRoster();
  renderBudgetPage();
  renderCrewPage();
  syncCrewSelects();
  setOffline("not paired — connect your bridge");
  setTab("floor");

  app.client.setBaseUrl(app.url);
  app.client.setToken(app.token);

  app.healthTimer = setInterval(safe(checkHealth), 12000);
  app.budgetTimer = setInterval(safe(() => (app.online && !app.running ? refreshBudget({ silent: true }) : null)), 20000);
  app.rosterTimer = setInterval(() => {
    updateRosterStates();
    if (!$("focusPanel").hidden) renderFocus(app.floor.getState().selected);
  }, 500);

  if (!app.token) {
    app.journal = settleStaleRuns(app.journal, RUN_LOST_RELOAD);
    saveJournal(app.journal);
    renderQuestLog();
    // Offer pairing shortly after first paint — but only if the visitor has not
    // already paired in the meantime (or the prompt lands on top of the Floor).
    setTimeout(() => {
      if (!app.token && !app.online) openPairModal();
    }, 500);
    app.bootDone = true;
    return;
  }

  await bootWithToken();
  app.journal = settleStaleRuns(app.journal, RUN_LOST_RELOAD);
  saveJournal(app.journal);
  renderQuestLog();
  app.bootDone = true;
}

async function bootWithToken() {
  setStatus("offline", "CONNECTING…");
  try {
    await app.client.health();
  } catch {
    setOffline("bridge unreachable — start `vokrew serve`");
    return;
  }
  try {
    await loadBridgeDataWithRetry();
    // Become live as soon as the bridge data lands. A reattached run may take
    // minutes to settle; the room must not sit behind the lock screen meanwhile.
    setOnline();
    await tryReattach();
  } catch (err) {
    if (err.status === 401) {
      // The bridge restarted with a fresh token; pairing is required again.
      await forgetPairing({ silent: true });
      setOffline("pairing expired — pair again");
      openPairModal();
    } else {
      setOffline("bridge error — " + (err.message || "unreachable"));
    }
  }
}

// A reload can land while a run is in flight. One transient read failure must
// not leave the page offline with the run unclaimed, so try the bridge twice.
async function loadBridgeDataWithRetry() {
  try {
    await loadBridgeData();
  } catch (err) {
    if (err.status === 401) throw err;
    await sleep(600);
    await loadBridgeData();
  }
}

async function loadBridgeData() {
  const [crews, budget, lanes] = await Promise.all([
    app.client.crews(),
    app.client.budget("coding"),
    app.client.lanes(),
  ]);
  app.crews = Array.isArray(crews.crews) ? crews.crews : [];
  app.budget = budget;
  app.lanes = Array.isArray(lanes.lanes) ? lanes.lanes : [];
  if (!app.crews.some((c) => c.name === app.crewName)) {
    app.crewName = app.crews[0] ? app.crews[0].name : "default";
    store(LS.crew, app.crewName);
  }
  app.paired = true;
  applyCrew(app.crewName, { persist: false });
  renderBudgetPill();
  renderBudgetPage();
}

/**
 * Reattach to runs this page was tracking when it went away. The journal
 * stores the bridge's own runId at submit time, so each entry can be asked
 * about directly: GET /runs/:id. A 200 adopts the record — resume following
 * while it runs, render the verdict and stamps when it has settled. Only a
 * 404 (the registry has no such run) is a lost run, and on this path it is
 * named as a reload, never as a bridge restart.
 */
async function tryReattach() {
  const running = app.journal.filter((r) => r.state === "running");
  if (!running.length || app.reattaching) return;
  app.reattaching = true;
  try {
    // Does this bridge keep run records at all? A 404 on the list endpoint
    // means there is no registry to ask (older bridge), not that runs are lost.
    // A transient failure keeps the claim open and retries a moment later.
    let listed = false;
    for (let attempt = 0; attempt < 3 && !listed; attempt++) {
      try {
        await app.client.listRuns(1);
        listed = true;
      } catch (err) {
        if (err.status === 404) {
          app.journal = settleStaleRuns(app.journal, RUN_LOST_NO_STATE);
          saveJournal(app.journal);
          renderQuestLog();
          return;
        }
        if (err.status === 401) throw err;
        if (attempt === 2) {
          scheduleReattach();
          return;
        }
        await sleep(500);
      }
    }

    for (const rec of running) {
      if (!rec.runId) {
        // Submitted, but the 202 never reached this page before it reloaded:
        // there is no bridge id to ask about. Name the real cause.
        app.journal = app.journal.map((r) => r.id === rec.id
          ? { ...r, state: "lost", endedAt: new Date().toISOString(), lostReason: RUN_LOST_RELOAD }
          : r);
        continue;
      }
      app.pendingId = rec.id;
      setBusy(true);
      try {
        const { result, timeline } = await app.client.followRun(rec.runId, {
          onPhase: (p) => handlePhase(p, { conduct: false, surface: rec.surface || "coding" }),
        });
        const joined = {
          ...rec,
          ...recordFromRun(result, rec),
          runId: rec.runId,
          reattached: true,
          state: result.state === "failed" ? "lost" : "done",
          endedAt: new Date().toISOString(),
          timeline: timeline && timeline.length ? timeline : rec.timeline,
          lostReason: result.state === "failed" ? (result.error || RUN_LOST) : null,
          stage: result.state === "failed" ? (rec.stage || "planner") : "settled",
        };
        await finishRun(joined, { conduct: false, source: "floor" });
      } catch (err) {
        const lostReason = err.status === 404
          ? RUN_LOST_RELOAD
          : (err.status ? "run lost — " + (err.message || "bridge did not answer") : RUN_LOST);
        const lost = { ...rec, state: "lost", endedAt: new Date().toISOString(), lostReason };
        await finishRun(lost, { conduct: false, source: "floor" });
      } finally {
        app.pendingId = null;
        setBusy(false);
      }
    }
    saveJournal(app.journal);
    renderQuestLog();
  } finally {
    app.reattaching = false;
  }
}

// If the bridge blipped while a run was still unclaimed, keep the claim open
// and try again instead of declaring the run lost.
function scheduleReattach() {
  if (app.reattachTimer) return;
  app.reattachTimer = setTimeout(() => {
    app.reattachTimer = null;
    if (!app.online) return;
    tryReattach().catch((err) => {
      if (err.status !== 401) scheduleReattach();
    });
  }, 3500);
}

/* ------------------------------------------------------------------------- */
/* status, pairing                                                           */
/* ------------------------------------------------------------------------- */

function setStatus(state, text) {
  const pill = $("bridgeStatus");
  pill.dataset.state = state;
  $("bridgeStatusText").textContent = text;
}

function setOffline(reason) {
  app.online = false;
  app.floor.clearRoster();
  app.roster = [];
  setStatus("offline", "OFFLINE");
  $("roomLocked").hidden = false;
  $("lockText").textContent = reason || "Pair a bridge to seat your crew. Nothing is shown that the bridge did not report.";
  $("liveBanner").hidden = true;
  $("floorSub").textContent = "No bridge paired — the room is dark.";
  $("conductInput").disabled = true;
  $("conductBtn").disabled = true;
  $("runBtn").disabled = true;
  $("chatSend").disabled = true;
  $("chatHint").textContent = "Bridge offline — nothing is sent until it reconnects.";
  renderRunHint();
  $("budgetPill").textContent = "⚡ CALLS TODAY — / —";
  renderRoster();
  renderChatSide();
  syncCrewSelects();
  renderBudgetPage();
}

function setOnline() {
  app.online = true;
  app.paired = !!app.token;
  setStatus(app.running ? "busy" : "live", app.running ? "RUNNING" : "LIVE");
  $("roomLocked").hidden = true;
  const crew = app.crews.find((c) => c.name === app.crewName);
  const named = app.roster.filter((r) => r.name).length;
  $("floorSub").textContent = crew
    ? `Crew ${crew.name} · ${named === 3 ? "all three named on the bridge" : named ? `${named} of 3 named` : "names not set on the bridge"}`
    : "Crew not reported by the bridge.";
  $("conductInput").disabled = false;
  $("conductBtn").disabled = false;
  $("runBtn").disabled = false;
  $("chatSend").disabled = false;
  $("chatHint").textContent = "Chat calls are counted on the chat surface — separate from coding runs.";
  app.floor.setRoster(app.roster, { crew: app.crewName });
  renderRoster();
  renderChatSide();
  syncCrewSelects();
  refreshBudget();
}

function openPairModal() {
  const modal = $("pairModal");
  modal.hidden = false;
  $("pairUrl").value = app.url;
  $("pairCode").value = "";
  $("pairError").hidden = true;
  $("forgetBtn").hidden = !app.token;
  $("pairFootState").textContent = app.token ? (app.online ? "paired · bridge online" : "paired · bridge offline") : "not paired";
  setTimeout(() => $("pairCode").focus(), 30);
}

function closePairModal() {
  $("pairModal").hidden = true;
}

async function pairFromForm() {
  const url = $("pairUrl").value.trim();
  const code = $("pairCode").value.trim();
  const errEl = $("pairError");
  errEl.hidden = true;
  if (!code) {
    errEl.textContent = "Enter the pairing code printed by `vokrew serve`.";
    errEl.hidden = false;
    return;
  }
  const btn = $("pairBtn");
  btn.disabled = true;
  btn.textContent = "Pairing…";
  app.client.setBaseUrl(url);
  try {
    const token = await app.client.pair(code);
    app.token = token;
    app.url = app.client.baseUrl;
    store(LS.token, token);
    store(LS.url, app.url);
    setStatus("offline", "CONNECTING…");
    await loadBridgeData();
    setOnline();
    await tryReattach();
    closePairModal();
    setTab("floor");
  } catch (err) {
    errEl.textContent = err.message || "pairing failed";
    errEl.hidden = false;
    setStatus("offline", "OFFLINE");
  } finally {
    btn.disabled = false;
    btn.textContent = "Pair";
  }
}

async function forgetPairing({ silent = false } = {}) {
  app.token = null;
  app.paired = false;
  app.online = false;
  app.client.setToken(null);
  store(LS.token, null);
  if (!silent) {
    // Explicit forget: the history belongs to the bridge we are leaving.
    store(LS.journal, null);
    app.journal = [];
  }
  app.lastRecord = null;
  app.chatSession = null;
  app.floor.clearRoster();
  app.roster = [];
  renderQuestLog();
  renderRoster();
  setOffline("not paired — connect your bridge");
  if (!silent) {
    closePairModal();
    openPairModal();
  }
}

/* ------------------------------------------------------------------------- */
/* crews, roster                                                             */
/* ------------------------------------------------------------------------- */

function syncCrewSelects() {
  for (const id of ["crewSelect", "crewSelectPage"]) {
    const sel = $(id);
    const names = app.crews.map((c) => c.name);
    sel.replaceChildren(...names.map((name) => h("option", { value: name, text: name })));
    if (!names.includes(app.crewName) && names.length) app.crewName = names[0];
    sel.value = app.crewName;
    sel.disabled = !app.online || app.running || names.length === 0;
  }
}

function latestDoneRunForCrew(crewName) {
  return app.journal.find((r) => r.state === "done" && r.crew === crewName && (r.stamps || []).length) || null;
}

function applyCrew(name, { persist = true } = {}) {
  const crew = app.crews.find((c) => c.name === name);
  if (!crew) return;
  app.crewName = crew.name;
  if (persist) store(LS.crew, crew.name);

  const last = latestDoneRunForCrew(crew.name);
  const byRole = stampsByRole(last ? last.stamps : []);
  app.roster = rosterFor(crew, byRole);

  if (app.online) {
    app.floor.setRoster(app.roster, { crew: crew.name });
    const named = app.roster.filter((r) => r.name).length;
    $("floorSub").textContent = `Crew ${crew.name} · ${named === 3 ? "all three named on the bridge" : named ? `${named} of 3 named` : "names not set on the bridge"}`;
  }

  syncCrewSelects();
  renderRoster();
  renderChatSide();
  renderCrewPage();
  renderFocus(app.floor.getState().selected);
  updateRosterStates();

  // The conduct transcript belongs to the crew that ran it. Leaving another
  // crew's stamps under the new nameplates reads as if they had done the work.
  if (!app.running) {
    hideLive();
    app.floor.clearBubbles();
    $("conductPanel").hidden = true;
    $("conductMeta").textContent = "";
    $("conductParts").replaceChildren();
  }
}

function rosterEntry(role) {
  return app.roster.find((r) => r.role === role) || null;
}

function runningRecordFor(role) {
  // a small convenience for the focus panel: this page's most recent stamps
  return app.journal.flatMap((r) => (r.stamps || []).filter((s) => s.role === role).map((s) => ({ rec: r, stamp: s }))).slice(0, 6);
}

function renderRoster() {
  const wrap = $("roster");
  const st = app.floor ? app.floor.getState() : null;
  $("rosterMeta").textContent = app.online
    ? `${app.roster.filter((r) => r.name).length}/3 named · ${app.crewName}`
    : "locked";

  if (!app.online || !app.roster.length) {
    wrap.replaceChildren(h("p", { class: "rail-note", text: app.online ? "The bridge reported no crew." : "No crew seated — connect a bridge." }));
    renderRunSide();
    return;
  }

  wrap.replaceChildren(...app.roster.map((r) => {
    const char = st && st.chars ? st.chars[r.role] : null;
    const phase = char ? char.phase : "idle";
    const initials = initialsFor(r.name, r.role);
    const card = h("button", {
      class: "roster-card" + (st && st.selected === r.role ? " selected" : ""),
      type: "button",
      onclick: () => app.floor.select(r.role),
    },
      h("span", { class: "roster-stripe " + r.palette }),
      h("span", { class: "roster-avatar " + r.palette, "aria-hidden": "true" }, initials),
      h("span", { class: "roster-main" },
        h("span", { class: "roster-name" },
          r.name || `Unnamed ${r.role}`,
          h("span", { class: "role", text: r.role })),
        h("span", { class: "roster-sub", text: r.lane ? `${r.lane} · ${modelLabel(r.model)}` : "no stamp yet" })),
      h("span", { class: "roster-state " + (phase === "walking" ? "walking" : phase), dataset: { role: r.role }, text: STATE_LABEL[phase] || phase }),
    );
    return card;
  }));
  renderRunSide();
}

function initialsFor(name, role) {
  return (name || role || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/* The Run page's "chain" rail: the three seated roles, from the same roster
   the room uses. No extra bridge calls, no invented agents. */
function renderRunSide() {
  const box = $("chainRoles");
  if (!box) return;
  const st = app.floor ? app.floor.getState() : null;
  if (!app.online || !app.roster.length) {
    box.replaceChildren(h("p", { class: "rail-note", text: app.online ? "The bridge reported no crew." : "Pair a bridge to seat the chain." }));
    $("chainMeta").textContent = "—";
    return;
  }
  $("chainMeta").textContent = `${app.roster.filter((r) => r.name).length}/3 named`;
  box.replaceChildren(...ROLE_ORDER.map((role) => {
    const r = app.roster.find((x) => x.role === role) || { role };
    const char = st && st.chars ? st.chars[role] : null;
    const phase = char ? char.phase : "idle";
    const palette = r.palette || ROLE_PALETTE[role];
    return h("div", { class: "chain-role", dataset: { role } },
      h("span", { class: "cr-avatar " + palette, "aria-hidden": "true" }, initialsFor(r.name, role)),
      h("span", { class: "cr-main" },
        h("span", { class: "cr-name", text: r.name || `Unnamed ${role}` }),
        h("span", { class: "cr-sub", text: r.lane ? `${r.lane} · ${modelLabel(r.model)}` : "no stamp yet" })),
      h("span", { class: "cr-state " + phase, dataset: { role }, text: STATE_LABEL[phase] || phase }),
    );
  }));
}

function renderChatSide() {
  if (!$("chatCalls")) return;
  const used = app.online && app.chatBudget && Array.isArray(app.chatBudget.lanes)
    ? app.chatBudget.lanes.reduce((n, l) => n + (Number(l.used) || 0), 0)
    : null;
  $("chatCalls").textContent = used === null ? "—" : String(used);
  $("chatCrew").textContent = app.online ? app.crewName : "—";
  $("chatSessionId").textContent = app.chatSession ? String(app.chatSession).slice(0, 8) : "new";
  $("chatSurfaceMeta").textContent = app.chatBudget ? (app.chatBudget.surface || "chat") : "—";
}

function updateRosterStates() {
  if (!app.floor) return;
  const st = app.floor.getState();
  document.querySelectorAll(".roster-card").forEach((card) => {
    const stateEl = card.querySelector(".roster-state");
    if (!stateEl) return;
    const role = stateEl.dataset.role;
    const char = st.chars[role];
    const phase = char ? char.phase : "idle";
    stateEl.textContent = STATE_LABEL[phase] || phase;
    stateEl.className = "roster-state " + (phase === "walking" ? "walking" : phase);
    card.classList.toggle("selected", st.selected === role);
  });
  document.querySelectorAll(".chain-role").forEach((row) => {
    const stateEl = row.querySelector(".cr-state");
    if (!stateEl) return;
    const char = st.chars[stateEl.dataset.role];
    const phase = char ? char.phase : "idle";
    stateEl.textContent = STATE_LABEL[phase] || phase;
    stateEl.className = "cr-state " + phase;
  });
}

/* ------------------------------------------------------------------------- */
/* budget                                                                    */
/* ------------------------------------------------------------------------- */

function renderBudgetPill() {
  if (!app.budget) {
    $("budgetPill").textContent = "⚡ CALLS TODAY — / —";
    return;
  }
  $("budgetPill").textContent = budgetPill(app.budget).label;
  $("budgetPill").title = budgetPill(app.budget).cappedLanesOnly
    ? "Sum of capped lanes, from GET /budget"
    : "No lane has a cap — this totals every lane, from GET /budget";
}

async function refreshBudget({ force = false, silent = false } = {}) {
  if (!app.online) {
    if (!silent) renderBudgetPage();
    return;
  }
  try {
    const [coding, chat] = await Promise.all([
      app.client.budget("coding"),
      app.client.budget("chat").catch(() => null),
    ]);
    app.budget = coding;
    if (chat) app.chatBudget = chat;
    renderBudgetPill();
    renderChatSide();
    if (force || document.querySelector('.view.active')?.dataset.view === "budget") renderBudgetPage();
  } catch { /* keep the last reported numbers rather than inventing new ones */ }
}

function renderBudgetPage() {
  const rows = $("budgetRows");
  const summary = $("budgetSummary");
  const note = $("budgetNote");
  if (!app.budget) {
    summary.replaceChildren();
    rows.replaceChildren(h("tr", {}, h("td", { colspan: "4", class: "unmetered", text: "No budget reported — pair the bridge." })));
    note.textContent = "";
    if ($("budgetDay")) $("budgetDay").textContent = "day —";
    if ($("budgetSurface")) $("budgetSurface").textContent = "—";
    return;
  }
  const pill = budgetPill(app.budget);
  const capped = app.budget.lanes.filter((l) => l.cap !== null && l.cap !== undefined);
  const other = Number(app.budget.otherSurfaceTotal) || 0;
  if ($("budgetDay")) $("budgetDay").textContent = app.budget.day ? `day ${app.budget.day}` : "day —";
  if ($("budgetSurface")) $("budgetSurface").textContent = app.budget.surface || "coding";

  const card = (glyph, label, value, sub, accent) => h("div", { class: "sum-card", style: `--accent:${accent}` },
    h("span", { class: "k" }, h("span", { class: "glyph", "aria-hidden": "true", text: glyph }), label),
    h("span", { class: "v" }, String(value), sub ? h("small", { text: sub }) : null),
  );

  summary.replaceChildren(
    card("⚡", "coding calls today", pill.used, "served by the bridge", "var(--ocean)"),
    card("◈", "capped lanes", capped.length, capped.length === 0 ? "no caps set" : "metered", "var(--violet)"),
    card("⌁", "chat surface today", other, "calls, separate ledger", "var(--sunset)"),
  );

  const tints = ["#64b5ff", "#bb95ff", "#ffa05c", "#5fd39b", "#ffcb6b", "#ff7185"];
  rows.replaceChildren(...app.budget.lanes.map((l, i) => {
    const used = Number(l.used) || 0;
    const metered = l.cap !== null && l.cap !== undefined;
    const pct = metered && l.cap > 0 ? Math.min(100, Math.round((used / l.cap) * 100)) : 0;
    return h("tr", { dataset: { lane: l.id } },
      h("td", { class: "lane" },
        h("span", { class: "lane-cell" },
          h("span", { class: "lane-dot", style: `--lane:${tints[i % tints.length]}` }),
          h("span", {}, l.id))),
      h("td", { class: "num" }, String(used), metered ? h("div", { class: "bar" }, h("i", { style: `width:${pct}%` })) : null),
      h("td", { class: "num" + (metered ? "" : " unmetered"), text: metered ? String(l.cap) : "unlimited" }),
      h("td", { class: "num" + (metered ? "" : " unmetered"), text: metered ? String(l.remaining) : "unlimited" }),
    );
  }));
  note.textContent = `surface: ${app.budget.surface || "coding"} · day ${app.budget.day || "—"} · ${pill.cappedLanesOnly
    ? "summed across capped lanes, as specified."
    : "this bridge reports no caps, so the pill totals every lane and shows the cap as — rather than inventing one."}`;
}

/* ------------------------------------------------------------------------- */
/* quest log + run card                                                      */
/* ------------------------------------------------------------------------- */

function renderQuestLog() {
  const wrap = $("questLog");
  const rows = app.journal;
  $("questMeta").textContent = `${rows.length} ${rows.length === 1 ? "run" : "runs"}`;
  $("questNote").textContent = "Run history is this browser's journal of responses the bridge actually returned.";

  if (!rows.length) {
    wrap.replaceChildren(h("p", { class: "quest-empty", text: app.online ? "No runs yet. Conduct the crew or send a task." : "Connect a bridge to start a ledger." }));
    return;
  }

  wrap.replaceChildren(...rows.map((rec) => {
    const running = rec.state === "running";
    const lost = rec.state === "lost";
    const label = running ? "running" : lost ? "lost" : (rec.verdict || "unknown");
    const tone = running ? "live" : lost ? "bad" : verdictTone(rec.verdict);
    const meta = [
      running ? `stage: ${rec.stage || "planner"}` : lost ? (rec.lostReason || RUN_LOST) : `${rec.crew || "default"}`,
      timeOf(rec.startedAt),
      !running && !lost && rec.stamps && rec.stamps.length ? (rec.crossFamily ? "cross-family" : "same family") : null,
    ].filter(Boolean).join(" · ");

    return h("button", {
      class: "quest-row",
      type: "button",
      onclick: () => openRunCard(rec),
      dataset: { id: rec.id },
    },
      h("span", { class: "chip " + tone, text: label }),
      h("span", { class: "quest-task" },
        h("strong", { text: shortTask(rec.task, 46) }),
        h("span", { text: meta })),
      h("span", { class: "chip", text: running ? "live" : `${(rec.stamps || []).length}/3` }),
    );
  }));
}

function runCardNode(rec, { inline = false } = {}) {
  const stamps = rec.stamps || [];
  const byRole = stampsByRole(stamps);
  const lost = rec.state === "lost";
  const running = rec.state === "running";
  const verdict = lost ? "LOST" : running ? "RUNNING" : (rec.verdict || "UNKNOWN");
  const tone = lost ? "bad" : running ? "live" : verdictTone(rec.verdict);
  const cross = !!rec.crossFamily;
  const summary = lost
    ? (rec.lostReason || RUN_LOST)
    : running
      ? `tracking · phase ${rec.stage || "planner"}`
      : reviewSentence(rec);
  const summaryClass = lost || running ? "" : cross ? "cross" : "same";

  const head = h("div", { class: "rc-head" },
    h("div", {},
      h("div", { class: "rc-task", text: rec.task || "(task not reported)" }),
      h("div", { class: "rc-meta" },
        h("span", { text: `${rec.surface || "coding"} · ${rec.crew || "default"}` }),
        h("span", { text: `${dayOf(rec.startedAt)} ${timeOf(rec.startedAt)}` }),
        h("span", { text: durationOf(rec) ? `took ${durationOf(rec)}` : (running ? "in flight" : "duration not reported") }),
        h("span", { text: `${stamps.length}/3 stamps` }),
      )),
    h("span", { class: "rc-verdict " + tone, text: verdict }),
  );

  const lostLine = (lost || running)
    ? h("div", { class: "rc-lost" + (running ? " running" : ""), text: lost ? (rec.lostReason || RUN_LOST) : `tracking · ${rec.stage || "planner"} — ${rec.served || 0}/3 stages reported` })
    : null;

  // The lost/running strip already names the state; a second line would only
  // repeat it. Completed cards keep the reviewer's one-line summary.
  const summaryLine = (!lost && !running)
    ? h("div", { class: "rc-summary" }, h("span", { class: summaryClass, text: summary }))
    : null;

  const parts = h("div", { class: "rc-parts" });
  for (const role of ROLE_ORDER) {
    const stamp = byRole[role] || null;
    const text = rec[PART_KEY[role]] || "";
    const failed = stamp ? failovers([stamp]) : [];
    parts.append(h("div", { class: "rc-part", dataset: { role } },
      h("div", { class: "rc-part-head" },
        h("span", { class: "rc-part-role", text: ROLE_SHORT[role] }),
        h("span", { class: "rc-part-agent", text: stamp && stamp.agent ? stamp.agent : "—" }),
        stamp ? h("span", { class: "chip " + (role === "reviewer" ? verdictTone(rec.verdict) : ""), text: stamp.role || role }) : null,
      ),
      h("div", { class: "rc-part-text md" },
        text ? markdownNode(text) : document.createTextNode(lost ? "not reported — run lost." : "not reported.")),
      stamp
        ? h("div", { class: "rc-stamp" },
            stampLine(stamp),
            failed.length ? h("span", { class: "fail", text: `  · failover: ${failed.map((f) => `${f.failedLanes.join(", ")} failed → served on ${f.servedLane}`).join("; ")}` }) : null)
        : h("div", { class: "rc-stamp", text: "no stamp reported for this stage" }),
    ));
  }

  const foot = h("div", { class: "rc-foot" },
    h("div", {},
      h("div", { class: "stamp-line", text: stamps.length ? "full stamps" : "no stamps" }),
      ...stamps.map((s) => h("div", { class: "stamp-line", text: stampText(s) })),
      ...failovers(stamps).map((f) => h("div", { class: "stamp-line", text: `failover · ${f.text}` })),
    ),
  );

  const timeline = (rec.timeline || []).length
    ? h("div", { class: "rc-timeline" },
        ...(rec.timeline || []).map((t) => h("span", { text: `${t.stage} · ${timeOf(t.at)}` })))
    : null;

  return h("article", { class: "run-card" },
    head, lostLine, summaryLine, parts, foot, timeline,
  );
}

function openRunCard(rec) {
  $("runModalTitle").textContent = rec.state === "running" ? "Run in flight" : "Run card";
  $("runCardBody").replaceChildren(runCardNode(rec));
  $("runModal").hidden = false;
}

function closeRunModal() {
  $("runModal").hidden = true;
}

function renderRunResult(rec) {
  const box = $("runResult");
  box.replaceChildren(runCardNode(rec, { inline: true }));
  box.hidden = false;
}

/* ------------------------------------------------------------------------- */
/* focus panel                                                               */
/* ------------------------------------------------------------------------- */

function renderFocus(role) {
  const panel = $("focusPanel");
  if (!role) {
    panel.hidden = true;
    return;
  }
  const st = app.floor.getState();
  const char = st.chars[role];
  if (!char) {
    panel.hidden = true;
    return;
  }
  const entry = rosterEntry(role);
  panel.hidden = false;
  $("focusDot").className = "palette-dot " + (char.palette || (entry && entry.palette) || "");
  $("focusName").textContent = char.name || `Unnamed ${role}`;
  $("focusRole").textContent = role;
  $("focusStage").textContent = `${char.phase}${app.running && app.phase === role ? " · live" : ""}`;
  $("focusLane").textContent = char.lane || "no stamp yet";
  $("focusModel").textContent = char.model ? modelLabel(char.model) : "—";
  $("focusModel").title = char.model || "";

  const lane = app.budget && char.lane ? app.budget.lanes.find((l) => l.id === char.lane) : null;
  $("focusCalls").textContent = lane ? `${lane.used} on ${lane.id} today` : (char.lane ? "not in /budget" : "—");

  const history = runningRecordFor(role);
  $("focusStampCount").textContent = String(history.length);
  const box = $("focusHistory");
  if (!history.length) {
    box.replaceChildren(h("div", { class: "fh-row", text: "No stamps for this agent yet." }));
  } else {
    box.replaceChildren(...history.map(({ rec, stamp }) => h("div", { class: "fh-row" },
      h("span", { class: "fh-verdict", text: rec.state === "done" ? (rec.verdict || "?") : (rec.state || "?") }),
      h("span", { text: `${timeOf(rec.startedAt)} · ${stamp.lane || "?"} · ${modelLabel(stamp.model) || "?"} · ${fmtMs(stamp.latencyMs)}` }),
    )));
  }
}

/* ------------------------------------------------------------------------- */
/* run lifecycle                                                             */
/* ------------------------------------------------------------------------- */

function setBusy(busy) {
  app.running = busy;
  $("conductInput").disabled = busy || !app.online;
  $("conductBtn").disabled = busy || !app.online;
  $("runBtn").disabled = busy || !app.online;
  $("chatSend").disabled = busy || !app.online;
  for (const id of ["crewSelect", "crewSelectPage"]) $(id).disabled = busy || !app.online;
  setStatus(busy ? "busy" : app.online ? "live" : "offline", busy ? "RUNNING" : app.online ? "LIVE" : "OFFLINE");
  renderRunHint();
}

// The line under the Run form derives from the same run state as the header
// pill and the chain rail — app.running / app.phase / app.served, all set by
// setBusy + handlePhase. It must never claim "no run in flight" while the
// pill says RUNNING.
function renderRunHint() {
  const el = $("runHint");
  if (!el) return;
  if (app.running) {
    const stage = app.phase === "settling" ? "settling" : `${app.phase || "planner"} stage`;
    el.textContent = `Run in flight — ${stage} · ${app.served || 0}/3 stages reported by the bridge.`;
  } else if (!app.online) {
    el.textContent = "No run in flight — pair a bridge to send a task.";
  } else {
    el.textContent = "No run in flight.";
  }
}

function showLive(text, spend = "") {
  const banner = $("liveBanner");
  banner.hidden = false;
  banner.className = "room-overlay live";
  $("liveText").textContent = text;
  $("liveSpend").textContent = spend;
}

function hideLive() {
  $("liveBanner").hidden = true;
  $("liveBanner").className = "room-overlay live";
}

function showCompletion(rec) {
  const banner = $("liveBanner");
  banner.hidden = false;
  const done = rec.state === "done";
  banner.className = "room-overlay done" + (done && !rec.crossFamily ? " same" : "") + (!done ? " lost" : "");
  if (done) {
    $("liveText").textContent = reviewSentence(rec);
    $("liveSpend").textContent = `⚡ ${(rec.stamps || []).length} calls stamped`;
  } else {
    $("liveText").textContent = rec.lostReason || RUN_LOST;
    $("liveSpend").textContent = "";
  }
  later(() => {
    if (app.lastRecord === rec && !app.running) hideLive();
  }, 30000);
}

function clearTimers() {
  for (const t of app.timers) clearTimeout(t);
  app.timers = [];
}

function later(fn, ms) {
  const t = setTimeout(() => {
    app.timers = app.timers.filter((x) => x !== t);
    try { fn(); } catch { /* never let a presentation timer break the app */ }
  }, ms);
  app.timers.push(t);
  return t;
}

function setPhaseUI(stage, served) {
  const track = $("phaseTrack");
  const order = ["planner", "executor", "reviewer"];
  const idx = order.indexOf(stage);
  track.querySelectorAll(".phase").forEach((el) => {
    const i = order.indexOf(el.dataset.phase);
    el.classList.toggle("active", i === idx && stage !== "settling");
    el.classList.toggle("done", stage === "settling" ? true : i < idx);
  });
  const names = app.roster.map((r) => `${r.role} ${r.name || "unnamed"}`).join(" · ");
  $("runPhaseText").textContent = stage === "settling"
    ? `settling — ${served}/3 stages reported by the bridge`
    : `${stage} · ${served}/3 stages reported${names ? " · " + names : ""}`;
  $("runLive").hidden = false;
}

function handlePhase(p, { conduct = false, surface = "coding" } = {}) {
  if (!app.running) return;
  app.phase = p.stage;
  app.served = p.served;
  renderRunHint();
  if (p.budget && surface === "coding") {
    app.budget = p.budget;
    renderBudgetPill();
  }
  if (surface === "coding") setPhaseUI(p.stage, p.served);

  const st = app.floor.getState();
  const nameOf = (role) => (st.chars[role] && st.chars[role].name) || `unnamed ${role}`;
  const laneOf = (role) => (st.chars[role] && st.chars[role].lane) || "lane not yet reported";

  const pending = app.journal.find((r) => r.id === app.pendingId);
  if (pending) {
    pending.stage = p.stage;
    pending.served = p.served;
    pending.timeline = pending.timeline || [];
    if (!pending.timeline.some((t) => t.stage === p.stage && t.served === p.served)) {
      pending.timeline.push({ stage: p.stage, served: p.served, at: p.at });
    }
    renderQuestLog();
  }

  if (p.stage === "planner") {
    app.floor.startWork("planner");
    showLive(`planner ${nameOf("planner")} framing the task`, `⚡ ${p.served}/3 served`);
  } else if (p.stage === "executor") {
    app.floor.finishWork("planner");
    if (conduct) {
      app.floor.walkTo("executor", DOORSTEPS.executor, { then: "working" });
      showLive(`executor ${nameOf("executor")} answering from the doorway`, `⚡ ${p.served}/3 served`);
    } else {
      app.floor.startWork("executor");
      showLive(`executor ${nameOf("executor")} working at ${laneOf("executor")}`, `⚡ ${p.served}/3 served`);
    }
  } else if (p.stage === "reviewer") {
    app.floor.finishWork("planner");
    app.floor.finishWork("executor");
    if (conduct) app.floor.walkTo("executor", SEATS.executor, { then: "done" });
    app.reviewWalkStarted = true;
    app.floor.reviewWalk().catch(() => {});
    showLive(`reviewer ${nameOf("reviewer")} walking to the executor's doorway`, `⚡ ${p.served}/3 served`);
    later(() => {
      if (app.running && app.phase === "reviewer") {
        showLive(`review in progress at the executor's doorway · ${nameOf("reviewer")} checking`, `⚡ ${p.served}/3 served`);
      }
    }, 1700);
  } else if (p.stage === "settling") {
    app.floor.finishWork("reviewer");
    showLive("settling — the crew is returning to their desks", `⚡ ${p.served}/3 served`);
  }
}

function newId() {
  return "run-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

function lostRecord(id, task, surface, message) {
  return {
    id, task, surface, crew: app.crewName,
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    state: "lost", verdict: "LOST", crossFamily: false,
    plan: "", work: "", review: "", stamps: [], stampLines: [], timeline: [],
    lostReason: message || RUN_LOST, error: message || null,
  };
}

function recordFromRun(result, base) {
  return {
    ...(base || {}),
    task: result.task || (base && base.task) || "",
    surface: result.surface || (base && base.surface) || "coding",
    crew: result.crew || (base && base.crew) || app.crewName,
    verdict: result.verdict || "UNKNOWN",
    crossFamily: !!result.crossFamily,
    plan: result.plan || "",
    work: result.work || "",
    review: result.review || "",
    stamps: result.stamps || [],
    stampLines: result.stampLines || [],
  };
}

async function startRun(task, { surface = "coding", workspace = null, conduct = false, source = "floor" } = {}) {
  task = String(task || "").trim();
  if (!task) return;
  if (!app.online) {
    openPairModal();
    return;
  }
  if (app.running) return;

  clearTimers();
  app.running = true;
  app.conduct = conduct;
  app.phase = "planner";
  app.served = 0;
  app.reviewWalkStarted = false;
  app.lastSource = source;
  const id = newId();
  app.pendingId = id;

  if (conduct) {
    $("conductPanel").hidden = false;
    $("conductParts").replaceChildren(h("p", { class: "rail-note", text: "Listen to the room — parts appear as the bridge reports them." }));
    $("conductMeta").textContent = "in flight";
  }

  const pending = {
    id, runId: null, task, surface, crew: app.crewName,
    startedAt: new Date().toISOString(), endedAt: null,
    state: "running", verdict: "RUNNING", crossFamily: false,
    plan: "", work: "", review: "", stamps: [], stampLines: [], timeline: [],
    stage: "planner", served: 0, lostReason: null,
  };
  app.journal = upsertRecord(app.journal, pending);
  saveJournal(app.journal);
  renderQuestLog();
  setBusy(true);
  hideLive();
  $("runResult").hidden = true;
  app.floor.resetToSeats();
  setPhaseUI("planner", 0);

  try {
    const rec = await app.client.startRun({
      task,
      surface,
      crew: app.crewName,
      workspace,
      pollMs: 350,
      idFactory: () => id,
      // Store the bridge runId the moment the 202 arrives: a reload before
      // settle must still be able to reattach to this exact run.
      onRunId: (runId) => {
        app.journal = app.journal.map((r) => (r.id === id ? { ...r, runId } : r));
        saveJournal(app.journal);
      },
      onBudget: (b) => {
        if (surface === "coding") {
          app.budget = b;
          renderBudgetPill();
        }
      },
      onPhase: (p) => handlePhase(p, { conduct, surface }),
    });
    await finishRun(rec, { conduct, source });
  } catch (err) {
    const rec = lostRecord(id, task, surface, "bridge error — " + (err.message || "run failed"));
    await finishRun(rec, { conduct, source });
  } finally {
    app.running = false;
    app.pendingId = null;
    setBusy(false);
    await refreshBudget({ silent: true });
  }
}

async function finishRun(rec, { conduct = false, source = "floor" } = {}) {
  app.lastRecord = rec;
  app.journal = upsertRecord(app.journal, rec);
  saveJournal(app.journal);
  renderQuestLog();

  if (rec.state === "done") {
    const by = stampsByRole(rec.stamps || []);
    for (const role of ROLE_ORDER) {
      const stamp = by[role];
      if (!stamp) continue;
      app.floor.updateAgent(role, {
        name: stamp.agent || undefined,
        lane: stamp.lane || null,
        model: stamp.model || null,
        family: stamp.family || null,
      });
    }
    app.roster = rosterFor(app.crews.find((c) => c.name === rec.crew) || null, by);
    renderRoster();

    await ensureReviewWalk(rec);
    await app.floor.returnAll();
    showCompletion(rec);

    if (conduct) renderConduct(rec);

    // Failover moments surface as a bubble on the character whose lane failed
    // over, naming the lane that actually served. Scheduled after any conduct
    // speech so both are readable.
    const fbs = failovers(rec.stamps || []);
    fbs.forEach((f, i) => {
      later(() => {
        if (app.lastRecord && app.lastRecord.id === rec.id) {
          app.floor.bubble(f.role, f.text, { kind: "failover", ttl: 16000 });
        }
      }, (conduct ? 3200 : 0) + i * 500);
    });

    if (source === "run") renderRunResult(rec);
  } else {
    app.floor.bubble("executor", rec.lostReason || RUN_LOST, { kind: "failover", ttl: 16000 });
    await app.floor.returnAll();
    showCompletion(rec);
    if (source === "run") renderRunResult(rec);
    if (!$("runModal").hidden) openRunCard(rec);
  }

  if (conduct) $("conductMeta").textContent = rec.state === "done" ? `${rec.verdict} · ${(rec.stamps || []).length} stamps` : "lost";
  updateRosterStates();
  renderFocus(app.floor.getState().selected);
}

async function ensureReviewWalk(rec) {
  const reviewerStamp = (rec.stamps || []).find((s) => s.role === "reviewer");
  if (!reviewerStamp) return;
  const st = app.floor.getState();
  const c = st.chars.reviewer;
  if (!c) return;
  if (c.moving) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const now = app.floor.getState().chars.reviewer;
      if (!now || !now.moving) break;
      await sleep(120);
    }
  } else if (!app.reviewWalkStarted && !(c.cell.x === DOORSTEPS.executor.x && c.cell.y === DOORSTEPS.executor.y)) {
    // The poll missed the reviewer phase (a very fast lane). The review did
    // happen; show the walk the room would have shown, then return.
    app.reviewWalkStarted = true;
    await app.floor.reviewWalk();
  }
  await sleep(950);
}

function renderConduct(rec) {
  $("conductPanel").hidden = false;
  $("conductMeta").textContent = `${rec.verdict || "?"} · ${(rec.stamps || []).length} stamps`;
  const by = stampsByRole(rec.stamps || []);
  const parts = [];
  for (const role of ROLE_ORDER) {
    const stamp = by[role];
    const text = rec[PART_KEY[role]] || "";
    parts.push(h("div", { class: "conduct-part", dataset: { role } },
      h("header", {},
        h("span", { class: "cp-role", text: ROLE_SHORT[role] }),
        h("span", { class: "cp-agent", text: stamp && stamp.agent ? stamp.agent : "—" }),
        role === "reviewer" ? h("span", { class: "chip " + verdictTone(rec.verdict), text: rec.verdict || "?" }) : null,
      ),
      h("p", { class: "md" }, markdownNode(text || "not reported.")),
      stamp ? h("span", { class: "cp-stamp", text: stampLine(stamp) }) : h("span", { class: "cp-stamp", text: "no stamp reported" }),
    ));
  }
  $("conductParts").replaceChildren(...parts);

  // the room speaks the parts in chain order
  const speak = [
    ["planner", rec.plan],
    ["executor", rec.work],
    ["reviewer", rec.review],
  ];
  speak.forEach(([role, text], i) => {
    later(() => {
      if (app.lastRecord && app.lastRecord.id === rec.id) {
        app.floor.bubble(role, ttlBubble(text || "—", 160), { kind: "info", ttl: 11000 });
      }
    }, 250 + i * 900);
  });
}

/* ------------------------------------------------------------------------- */
/* chat                                                                      */
/* ------------------------------------------------------------------------- */

function appendChat(kind, text, { stamps = [], verdict = null, note = null, pending = false, markdown = false } = {}) {
  const log = $("chatLog");
  log.querySelector(".chat-empty")?.remove();
  const el = h("div", { class: "msg " + kind + (pending ? " pending" : "") });
  if (markdown) el.append(h("div", { class: "msg-body md" }, markdownNode(text)));
  else el.append(document.createTextNode(String(text ?? "")));
  if (verdict) el.append(h("span", { class: "chip verdict " + verdictTone(verdict), text: verdict }));
  if (note) el.append(h("span", { class: "stamp", text: note }));
  if (stamps.length) {
    el.append(h("span", { class: "stamp", text: stamps.map((s) => stampText(s)).join("  ·  ") }));
  }
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

async function sendChat(message) {
  if (!app.online) { openPairModal(); return; }
  if (app.chatBusy) return;
  app.chatBusy = true;
  $("chatSend").disabled = true;
  appendChat("user", message);
  const pending = appendChat("assistant", "thinking…", { pending: true });

  try {
    const res = await app.client.chat({
      message,
      verify: $("chatVerify").checked,
      crew: app.crewName,
      sessionId: app.chatSession,
    });
    app.chatSession = res.sessionId || app.chatSession;
    pending.remove();
    const by = stampsByRole(res.stamps || []);
    let note = null;
    if (by.executor && by.reviewer) {
      const cross = by.executor.family !== by.reviewer.family;
      note = `${res.verdict || "UNKNOWN"} · ${cross ? "cross-family review" : "same family"} (${by.executor.family} → ${by.reviewer.family})`;
    } else if (res.verdict) {
      note = res.verdict;
    }
    appendChat("assistant", res.text || "(empty reply)", {
      stamps: res.stamps || [],
      verdict: res.verdict || null,
      note,
      markdown: true,
    });
  } catch (err) {
    pending.classList.remove("pending");
    pending.classList.add("error");
    pending.textContent = "chat failed — " + (err.message || "bridge error");
  } finally {
    app.chatBusy = false;
    $("chatSend").disabled = !app.online || app.running;
    refreshBudget({ silent: true });
    app.client.budget("chat").then((b) => { app.chatBudget = b; }).catch(() => {});
  }
}

/* ------------------------------------------------------------------------- */
/* crew page                                                                 */
/* ------------------------------------------------------------------------- */

function renderCrewPage() {
  const grid = $("crewGrid");
  if (!app.crews.length) {
    grid.replaceChildren(h("p", { class: "rail-note", text: "No crews reported — pair a bridge." }));
    $("crewNote").textContent = "";
    return;
  }
  grid.replaceChildren(...app.crews.map((crew, index) => {
    const roles = crew.roles || {};
    const active = crew.name === app.crewName;
    const named = ROLE_ORDER.filter((role) => (roles[role] || {}).name).length;
    const card = h("article", { class: "crew-card" + (active ? " active" : ""), style: `--i:${index}` },
      h("header", { class: "crew-card-head" },
        h("div", {},
          h("span", { class: "crew-kicker", text: active ? "in the room" : "bridge crew" }),
          h("h3", {}, crew.name),
          h("p", { class: "crew-sub", text: `${named}/3 named · ${ROLE_ORDER.length} seats` })),
        active ? h("span", { class: "chip good", text: "active" }) : null,
      ),
    );
    for (const role of ROLE_ORDER) {
      const r = roles[role] || {};
      const palette = ROLE_PALETTE[role];
      card.append(h("div", { class: "crew-role" },
        h("span", { class: "cr-avatar " + palette, "aria-hidden": "true" }, initialsFor(r.name, role)),
        h("span", { class: "r", text: role }),
        h("span", { class: "n" },
          r.name || `Unnamed ${role}`,
          r.instructions ? h("small", { text: ttlBubble(r.instructions, 86) }) : null,
          Array.isArray(r.lanes) && r.lanes.length ? h("small", { text: "prefers " + r.lanes.join(", ") }) : null,
        ),
      ));
    }
    card.append(h("button", {
      class: "btn" + (active ? "" : " primary"),
      type: "button",
      disabled: active || app.running || !app.online,
      text: active ? "Seated" : "Seat this crew",
      onclick: () => applyCrew(crew.name),
    }));
    return card;
  }));
  $("crewNote").textContent = "Names, roles and preferred lanes are shown exactly as /crews reports them. The room only seats what the bridge sends.";
}

/* ------------------------------------------------------------------------- */
/* health                                                                    */
/* ------------------------------------------------------------------------- */

async function checkHealth() {
  if (!app.token) return;
  try {
    await app.client.health();
    if (!app.online) await bootWithToken();
  } catch {
    if (app.online && !app.running) {
      setOffline("bridge unreachable — start `vokrew serve`, then reconnect");
    }
  }
}

/* ------------------------------------------------------------------------- */
/* tabs                                                                      */
/* ------------------------------------------------------------------------- */

function setTab(name) {
  const views = ["floor", "chat", "run", "budget", "crew"];
  if (!views.includes(name)) name = "floor";
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  store(LS.tab, name);
  if (name === "budget") refreshBudget({ force: true, silent: true });
  if (name === "crew") renderCrewPage();
  if (name === "chat") renderChatSide();
  if (name === "run") renderRunSide();
  if (name === "floor") app.floor.setSelected(app.floor.getState().selected);
}

/* ------------------------------------------------------------------------- */
/* safe wrapper + boot                                                       */
/* ------------------------------------------------------------------------- */

function safe(fn) {
  return (...args) => {
    // Call synchronously so form handlers can preventDefault() inside the
    // event dispatch — deferring to a microtask lets the browser navigate.
    try {
      const out = fn(...args);
      if (out && typeof out.then === "function") {
        out.catch((err) => console.warn("[vokrew]", err && err.message ? err.message : err));
      }
      return out;
    } catch (err) {
      console.warn("[vokrew]", err && err.message ? err.message : err);
      return undefined;
    }
  };
}

window.__vokrew = {
  getState: () => ({
    paired: app.paired,
    online: app.online,
    running: app.running,
    crewName: app.crewName,
    phase: app.phase,
    served: app.served,
    budget: app.budget,
    pill: app.budget ? budgetPill(app.budget) : null,
    journal: app.journal,
    floor: app.floor ? app.floor.getState() : null,
    roster: app.roster,
    conduct: app.conduct,
    chatSession: app.chatSession,
    crews: app.crews,
  }),
  floor: {
    getState: () => app.floor.getState(),
  },
  setTab,
  startRun,
  applyCrew,
  refreshBudget,
  renderMarkdown: (text) => {
    const el = h("div", { class: "md" });
    el.append(markdownNode(text));
    return el;
  },
};

boot().catch((err) => {
  console.error("[vokrew] boot failed", err);
  setOffline("boot failed — " + (err && err.message ? err.message : "unknown error"));
});
