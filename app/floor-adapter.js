"use strict";
/*
 * floor-adapter.js — Phase 1, Stage 2: the LIVE adapter (spec §3).
 *
 * Polls the real Vokrew bridge and translates its JSON into the
 * Floor-shaped state the room consumes through VokrewFloor.applyState().
 * The bridge gains nothing Floor-shaped (spec §2); this file is the
 * translation layer, and it is the only place bridge vocabulary
 * (crews, run records, stamps, call ledger) meets office vocabulary
 * (agents, desks, quest log, bubbles).
 *
 * Data flow: GET /crews + /lanes + /budget (15 s), GET /runs?limit=20
 * + GET /runs/:id for the active / tracked / selected run (1 s while
 * any run is active, 2.5 s idle, paused while document.hidden or the
 * Floor screen is not the visible tab). POST /run (async form) comes
 * from the Floor screen's own run form below.
 *
 * FIELD CHECKLIST (spec §7.2) — every field the floor.js engine reads,
 * and where the adapter defaults it. If a field is ever left undefined
 * the engine degrades SILENTLY (an agent that just never works), so
 * this list is the contract; keep it in sync with floor.js.
 *
 *   applyState({ agents, tasks, runs, liveRuns, budget, connected, rigText })
 *
 *   agent:  id            "<crew>:<role>"                     [buildAgents]
 *           name          roles[r].name, else capitalized role
 *           role          "planner" | "executor" | "reviewer"
 *           deskId        first three CUBICLES in order: c-w1 / c-w2 / c-sw
 *           lifecycleState "ready" (always — the bridge has no lifecycle)
 *           status        "running" while its phase runs, "rejected" (red
 *                         dot) for the stage a failed run died in, else "idle"
 *           appearance    { paletteId } — planner sunset, executor ocean,
 *                         reviewer violet (spec §3)
 *           adapterConfig { model } — last stamp's model, else the role's
 *                         preferred lane's model, else absent ("no brain")
 *           cloud         current lane's tier !== "local"
 *           heartbeat     false (no heartbeat concept on the bridge)
 *           instructions  roles[r].instructions, else ""
 *           memory        stamp lines for this role, oldest → newest
 *                         ({ text, at }) — the focus panel's stamp record
 *           beliefs       [] (no bridge source; engine tolerates empty)
 *           xp            0 (no XP source on the bridge — spec §4 cut)
 *           tasksDone     count of this role's landed stamps
 *   task:   id = run id · identifier "RUN-<short>" (+ " · <verdict>" when
 *           done) · title = run task text · description "" · agentId =
 *           phase agent while running, executor when settled · status
 *           running→in_progress / done→done / failed→failed · stamped =
 *           (state === "done")
 *   run:    id · agentId (as task) · taskId = run id · state · stamped ·
 *           tokens 0 (the bridge counts calls, not tokens — never fake
 *           a token number) · actionsRun = landed stamp count · steps []
 *           · error = record error or null
 *   liveRun: id = run id · agentId = phase agent · taskId = run id ·
 *           taskIdentifier "RUN-<short>" · startedAt · tokens 0 ·
 *           actionsRun = landed stamp count · lastStep { kind:"phase",
 *           text:"phase: <role>" } — synthesized ONLY for planner /
 *           executor phases; during the reviewer phase there is
 *           deliberately NO liveRun (the reviewer visits instead, below)
 *   budget: usedGlobal = Σ lane used (coding surface) · globalCap = Σ cap
 *           over capped lanes only (or usedGlobal when nothing is capped)
 *           · perAgentCap 0 · usedPerAgent {} · remainingGlobal ·
 *           warningGlobal false · warningPerAgent {} · day
 *           NOTE: renderTop() formats this as a token ratio; the adapter
 *           re-stamps #budgetStatus with the CALLS text after every
 *           applyState (see stampPill) — the pill never says TOKENS.
 *   connected: false until the first good poll, false again on any
 *           unreachable / 401 poll (the locked room, spec §3 "the door")
 *   rigText: "<n> lane(s) up · <m> down" from /lanes health strings
 *
 * ENTITY-LEVEL EFFECTS — two behaviors cannot be expressed through
 * applyState's state shape, so the adapter drives them through the
 * engine's published entity map (window.__floorDebug.ents, the same
 * surface the Stage 1 evaluator read):
 *   - THE REVIEW WALK: while a run record sits in phase "reviewer"
 *     with no reviewer stamp yet, the reviewer entity is put into the
 *     engine's own visit behavior (activity "visit", visitId =
 *     executor, activityPoint = the executor's doorstep point from
 *     __floorDebug.allDoorsteps(), activityUntil refreshed each poll).
 *     desiredFor() then walks it down the hallways to the doorway —
 *     it cannot enter (walkableFor forbids it). When the reviewer
 *     stamp lands (or the run settles), the adapter clears the visit
 *     and the reviewer walks home. No entity is ever teleported and
 *     no position is ever written by the adapter.
 *   - STAMP BUBBLES: e.bubble = { text, until } — the exact field the
 *     engine's own setBubble() writes. A landed stamp raises
 *     "✓ <lane> · <model> · <latencyMs>ms" over its agent; a stamp
 *     whose attempts[] show a failure first raises
 *     "lane X down — failing over" (stamp data only — spec §7.5).
 *
 * HONESTY (spec §3 / §7.5): a same-family review is labeled, never
 * dressed up — the reviewer's completion bubble, the run card footer
 * and the status line all say "same family" when the record's
 * crossFamily is false. Mock stamps would render as mock (the lane /
 * model names come straight from the stamp). A 404 on a run this page
 * submitted or opened renders "run lost — bridge restarted" — the
 * registry is in-memory (spec §7.6); the room never spins forever.
 */
(function () {
  const LS_BRIDGE = "vokrew.bridgeUrl";
  const LS_TOKEN = "vokrew.token";
  const DEFAULT_BRIDGE = "http://127.0.0.1:7717";
  const ROLES = ["planner", "executor", "reviewer"];
  const PALETTE_BY_ROLE = { planner: "sunset", executor: "ocean", reviewer: "violet" };
  // First three CUBICLES keys in floor.js definition order (spec §3).
  const DESK_BY_ROLE = { planner: "c-w1", executor: "c-w2", reviewer: "c-sw" };

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const S = {
    connected: false,
    crews: [],              // [{ name, roles }] from GET /crews
    selectedCrew: null,     // crew name seated in the room
    lanes: new Map(),       // lane id -> /lanes view
    budget: null,           // GET /budget?surface=coding payload
    summaries: [],          // GET /runs?limit=20 (newest first)
    records: new Map(),     // run id -> full record
    trackedId: null,        // last run submitted from this page
    selectedId: null,       // run shown in the run card
    cardOpen: false,
    seenStamps: new Set(),  // "<runId>:<role>" bubbles already raised
    doneNoted: new Set(),   // run ids whose completion bubble already fired
    lostIds: new Set(),     // run ids the bridge 404'd after we knew them
    visitFor: null,         // run id currently driving the review walk
    agentNames: {},         // role -> display name (status line / bubbles)
    lastSlow: 0,
    fastBusy: false,
  };

  /* ---------------- bridge calls (same conventions as app.js) ---------------- */

  function bridgeBase() {
    return (localStorage.getItem(LS_BRIDGE) || DEFAULT_BRIDGE).replace(/\/+$/, "");
  }

  async function call(path, { method = "GET", body, timeoutMs = 8000 } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = localStorage.getItem(LS_TOKEN);
    if (token) headers["Authorization"] = "Bearer " + token;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(bridgeBase() + path, {
        method, headers,
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

  /* ---------------- stamp formatting (mirrors core.js stampLine) ---------------- */

  function stampLine(st) {
    const bits = (st.attempts || [])
      .filter((a) => a.status !== "served")
      .map((a) => `${a.lane} ${a.status}${a.error ? ` (${a.error})` : ""}`);
    const suffix = bits.length ? `  [attempts: ${bits.join("; ")}${st.failover ? "; failover" : ""}]` : "";
    const agent = st.agent ? ` agent=${st.agent}` : "";
    return `${st.role}:${agent} lane=${st.lane} provider=${st.provider} model=${st.model} family=${st.family} tier=${st.tier} latency=${st.latencyMs}ms${suffix}`;
  }

  function recordStampLine(rec, stamp) {
    if (rec.state === "done" && Array.isArray(rec.stampLines)) {
      const hit = rec.stampLines.find((l) => l.startsWith(stamp.role + ":"));
      if (hit) return hit;
    }
    return stampLine(stamp);
  }

  /* ---------------- derived state ---------------- */

  function crewObj() {
    return S.crews.find((c) => c.name === S.selectedCrew) || { name: S.selectedCrew, roles: {} };
  }

  function agentId(role) { return S.selectedCrew + ":" + role; }

  function activeRecord() {
    const sum = S.summaries.find((x) => x.state === "running");
    if (sum && S.records.has(sum.id)) return S.records.get(sum.id);
    if (S.trackedId && S.records.has(S.trackedId)) {
      const rec = S.records.get(S.trackedId);
      if (rec.state === "running") return rec;
    }
    return null;
  }

  function inRoom(rec) { return rec && (!rec.crew || rec.crew === S.selectedCrew); }

  function lastStampFor(role) {
    let best = null;
    S.records.forEach((rec) => {
      if (rec.crew && rec.crew !== S.selectedCrew) return;
      (rec.stamps || []).forEach((st) => {
        if (st.role === role && (!best || rec.startedAt >= best.at)) best = { at: rec.startedAt, stamp: st };
      });
    });
    return best ? best.stamp : null;
  }

  function stampCountFor(role) {
    let n = 0;
    S.records.forEach((rec) => {
      if (rec.crew && rec.crew !== S.selectedCrew) return;
      (rec.stamps || []).forEach((st) => { if (st.role === role) n++; });
    });
    return n;
  }

  function memoryFor(role) {
    const rows = [];
    const recs = [...S.records.values()]
      .filter((rec) => !rec.crew || rec.crew === S.selectedCrew)
      .sort((a, b) => a.startedAt - b.startedAt);
    recs.forEach((rec) => {
      (rec.stamps || []).forEach((st) => {
        if (st.role !== role) return;
        let text = recordStampLine(rec, st);
        if (role === "reviewer" && rec.crossFamily === false) text += " · same family as executor";
        rows.push({ text, at: rec.startedAt });
      });
    });
    return rows;
  }

  function statusFor(role, active, failedRole) {
    if (active && active.phase === role) return "running";
    if (!active && failedRole === role) return "rejected";
    return "idle";
  }

  function buildAgents() {
    const crew = crewObj();
    const active = activeRecord();
    const inRoomActive = inRoom(active) ? active : null;
    // The stage a failed run died in: the role after its last landed stamp.
    let failedRole = null;
    if (!inRoomActive) {
      const newest = S.summaries[0] && S.records.get(S.summaries[0].id);
      if (newest && newest.state === "failed" && inRoom(newest)) {
        failedRole = ROLES[Math.min(newest.stamps.length, ROLES.length - 1)];
      }
    }
    return ROLES.map((role) => {
      const slot = (crew.roles && crew.roles[role]) || {};
      const stamp = lastStampFor(role);
      const prefLaneId = Array.isArray(slot.lanes) && slot.lanes.length ? slot.lanes[0] : null;
      const lane = (stamp && S.lanes.get(stamp.lane)) || (prefLaneId && S.lanes.get(prefLaneId)) || null;
      const model = stamp ? stamp.model : lane ? lane.model : undefined;
      const name = slot.name || (role.charAt(0).toUpperCase() + role.slice(1));
      S.agentNames[role] = name;
      return {
        id: agentId(role),
        name,
        role,
        deskId: DESK_BY_ROLE[role],
        lifecycleState: "ready",
        status: statusFor(role, inRoomActive, failedRole),
        appearance: { paletteId: PALETTE_BY_ROLE[role] },
        adapterConfig: model ? { model } : undefined,
        cloud: lane ? lane.tier !== "local" : false,
        heartbeat: false,
        instructions: slot.instructions || "",
        memory: memoryFor(role),
        beliefs: [],
        xp: 0,
        tasksDone: stampCountFor(role),
      };
    });
  }

  function shortId(id) { return String(id).replace(/-/g, "").slice(0, 4).toUpperCase(); }

  function buildTasksAndRuns() {
    const tasks = [], runs = [];
    S.summaries.forEach((sum) => {
      const rec = S.records.get(sum.id);
      const role = sum.state === "running" ? (sum.phase || "planner") : "executor";
      const aid = (sum.crew || S.selectedCrew) + ":" + role;
      tasks.push({
        id: sum.id,
        identifier: "RUN-" + shortId(sum.id) + (sum.state === "done" && sum.verdict ? " · " + sum.verdict : ""),
        title: String(sum.task || "").slice(0, 140),
        description: "",
        agentId: aid,
        status: sum.state === "running" ? "in_progress" : sum.state === "done" ? "done" : "failed",
        stamped: sum.state === "done",
      });
      runs.push({
        id: sum.id,
        agentId: aid,
        taskId: sum.id,
        state: sum.state,
        stamped: sum.state === "done",
        tokens: 0,
        actionsRun: rec ? (rec.stamps || []).length : 0,
        steps: [],
        error: rec ? rec.error : null,
      });
    });
    return { tasks, runs };
  }

  function buildLiveRuns(active) {
    if (!active || !inRoom(active) || active.state !== "running") return [];
    if (!active.phase || active.phase === "reviewer") return []; // reviewer visits instead
    return [{
      id: active.id,
      agentId: agentId(active.phase),
      taskId: active.id,
      taskIdentifier: "RUN-" + shortId(active.id),
      startedAt: active.startedAt,
      tokens: 0,
      actionsRun: (active.stamps || []).length,
      lastStep: { kind: "phase", text: "phase: " + active.phase },
    }];
  }

  function budgetTotals() {
    let used = 0, capSum = 0, capped = 0;
    ((S.budget && S.budget.lanes) || []).forEach((l) => {
      used += l.used || 0;
      if (l.cap !== null && l.cap !== undefined) { capSum += l.cap; capped++; }
    });
    return { used, capSum, capped };
  }

  function buildBudgetGlobal() {
    if (!S.budget) return null;
    const { used, capSum, capped } = budgetTotals();
    return {
      usedGlobal: used,
      globalCap: capped ? capSum : used,
      perAgentCap: 0,
      usedPerAgent: {},
      remainingGlobal: capped ? Math.max(0, capSum - used) : 0,
      warningGlobal: false,
      warningPerAgent: {},
      day: S.budget.day || "",
    };
  }

  function rigText() {
    if (!S.connected) return "bridge offline";
    if (!S.lanes.size) return "checking lanes…";
    let up = 0, down = 0;
    S.lanes.forEach((l) => { if (/^NOT reachable/.test(l.health || "")) down++; else up++; });
    return `${up} lane${up === 1 ? "" : "s"} up · ${down} down`;
  }

  /* ---------------- entity-level effects (see header) ---------------- */

  function entsMap() {
    return (window.__floorDebug && window.__floorDebug.ents) || null;
  }

  function setBubble(ent, text, seconds) {
    if (!ent) return;
    ent.bubble = { text: String(text).slice(0, 420), until: Date.now() + seconds * 1000 };
  }

  function driveVisit(active) {
    const dbg = window.__floorDebug;
    if (!dbg || !dbg.ents) return;
    const want = active && inRoom(active) && active.state === "running" &&
      active.phase === "reviewer" && !(active.stamps || []).some((s) => s.role === "reviewer");
    const revEnt = dbg.ents[agentId("reviewer")];
    if (want && revEnt) {
      const door = (dbg.allDoorsteps() || []).find((d) => d.id === DESK_BY_ROLE.executor);
      if (door) {
        revEnt.activity = "visit";
        revEnt.visitId = agentId("executor");
        revEnt.activityPoint = { x: door.x, y: door.y };
        revEnt.activityLabel = "reviewing " + (S.agentNames.executor || "the executor");
        revEnt.activityUntil = dbg.simClock + 6; // refreshed every poll while the phase lasts
        revEnt.goalKey = null;
        S.visitFor = active.id;
        return;
      }
    }
    if (S.visitFor && revEnt && revEnt.activity === "visit" && revEnt.visitId === agentId("executor")) {
      revEnt.activity = "desk";
      revEnt.visitId = null;
      revEnt.activityPoint = null;
      revEnt.goalKey = null;
    }
    if (!want) S.visitFor = null;
  }

  function noteStamps() {
    const ents = entsMap();
    S.records.forEach((rec) => {
      if (!inRoom(rec)) return;
      (rec.stamps || []).forEach((st) => {
        const key = rec.id + ":" + st.role;
        if (S.seenStamps.has(key)) return;
        S.seenStamps.add(key);
        if (!ents || st.role === "reviewer") return; // reviewer's bubble fires at completion
        const ent = ents[agentId(st.role)];
        const failed = (st.attempts || []).filter((a) => a.status === "failed");
        if (st.failover && failed.length) {
          setBubble(ent, `lane ${failed[0].lane} down — failing over`, 2.6);
          setTimeout(() => setBubble(ent, `✓ ${st.lane} · ${st.model} · ${st.latencyMs}ms`, 5), 2800);
        } else {
          setBubble(ent, `✓ ${st.lane} · ${st.model} · ${st.latencyMs}ms`, 5);
        }
      });
      if (rec.state === "done" && !S.doneNoted.has(rec.id)) {
        S.doneNoted.add(rec.id);
        const rst = (rec.stamps || []).find((s) => s.role === "reviewer");
        if (rst && ents) {
          setBubble(ents[agentId("reviewer")],
            `✓ ${rst.lane} · ${rst.model} · ${rst.latencyMs}ms` + (rec.crossFamily === false ? " · same family" : ""), 6);
        }
      }
    });
  }

  /* ---------------- chrome the engine renders from Floor-shaped state,
     re-stamped with bridge semantics after every applyState ---------------- */

  function stampPill() {
    const el = $("budgetStatus");
    if (!el) return;
    if (!S.budget) { el.textContent = "—"; return; }
    const { used, capSum, capped } = budgetTotals();
    el.textContent = capped ? `${used} / ${capSum}` : `${used}`;
    const wrap = $("budgetWrap");
    if (wrap) wrap.title = "Lane calls today (coding surface). The bridge counts calls, not tokens — per-lane detail lives on the Budget tab.";
  }

  function stampChrome() {
    const chip = $("floorModeChip");
    if (chip) chip.textContent = S.connected ? "LIVE" : "OFFLINE";
    const title = $("crewTitle");
    if (title && title.childNodes[0]) {
      title.childNodes[0].textContent = (S.selectedCrew || "Crew") + " ";
    }
    const foot = $("floorFoot");
    if (foot) foot.textContent = S.connected ? `live bridge · ${bridgeBase()}` : "bridge unreachable — room locked";
  }

  function updateStatusLine(active) {
    const el = $("floorRunStatus");
    if (!el) return;
    const tracked = S.trackedId ? S.records.get(S.trackedId) : null;
    let text = "";
    if (S.trackedId && S.lostIds.has(S.trackedId)) {
      text = "run lost — bridge restarted";
    } else if (active && inRoom(active)) {
      const n = S.agentNames;
      if (active.phase === "reviewer") {
        text = `${n.reviewer || "Reviewer"} is reviewing at ${n.executor || "the executor"}'s doorway…`;
      } else if (active.phase) {
        text = `${n[active.phase] || active.phase} is ${active.phase === "planner" ? "planning" : "executing"}…`;
      }
    } else if (tracked && tracked.state === "done") {
      text = `Run complete — verdict ${tracked.verdict || "—"}` +
        (tracked.crossFamily === false ? " · same family review" : tracked.crossFamily === true ? " · cross-family review" : "");
    } else if (tracked && tracked.state === "failed") {
      text = `Run failed — ${tracked.error || "unknown error"}`;
    }
    el.textContent = text;
    const btn = $("floorRunBtn");
    if (btn) {
      const running = !!(tracked && tracked.state === "running");
      btn.disabled = running;
      btn.textContent = running ? "Running…" : "Run the crew";
    }
  }

  /* ---------------- the run card (mirrors the Run tab's rendering) ---------------- */

  function renderCard() {
    const card = $("floorRunCard");
    if (!card) return;
    if (!S.cardOpen || !S.selectedId) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    const verdictEl = $("floorCardVerdict");
    const rec = S.records.get(S.selectedId);
    const sum = S.summaries.find((x) => x.id === S.selectedId);
    if (S.lostIds.has(S.selectedId)) {
      verdictEl.className = "verdict changes";
      verdictEl.textContent = "run lost — bridge restarted";
      $("floorCardPlan").textContent = "The bridge keeps its run registry in memory. The run was real, but its record is gone.";
      $("floorCardWork").textContent = "";
      $("floorCardReview").textContent = "";
      $("floorCardStamps").textContent = "";
      return;
    }
    if (!rec) {
      verdictEl.className = "verdict";
      verdictEl.textContent = sum ? `Run ${sum.state}…` : "Loading run…";
      $("floorCardPlan").textContent = sum ? String(sum.task || "") : "";
      $("floorCardWork").textContent = "";
      $("floorCardReview").textContent = "";
      $("floorCardStamps").textContent = "";
      return;
    }
    if (rec.state === "failed") {
      verdictEl.className = "verdict changes";
      verdictEl.textContent = `Run failed — ${rec.error || "unknown error"}`;
    } else if (rec.state === "done") {
      if (rec.verdict === "CHANGES") {
        verdictEl.className = "verdict changes";
        verdictEl.textContent = "!! Reviewer verdict: CHANGES requested — read the review !!";
      } else {
        verdictEl.className = "verdict";
        verdictEl.textContent = `Reviewer verdict: ${rec.verdict || "—"}`;
      }
    } else {
      verdictEl.className = "verdict";
      verdictEl.textContent = `Running — phase: ${rec.phase || "…"}`;
    }
    $("floorCardPlan").textContent = rec.plan || (rec.state === "running" ? "…" : "");
    $("floorCardWork").textContent = rec.work || (rec.state === "running" ? "…" : "");
    $("floorCardReview").textContent = rec.review || (rec.state === "running" ? "…" : "");
    const lines = (rec.stamps || []).map((st) => recordStampLine(rec, st));
    const footer = [];
    if (rec.crew && rec.crew !== "default") footer.push(`crew=${rec.crew}`);
    if (rec.workspace) footer.push(`workspace=${rec.workspace}`);
    footer.push(`cross-family=${rec.crossFamily === null || rec.crossFamily === undefined ? "…" : rec.crossFamily ? "yes" : "no"}`);
    $("floorCardStamps").textContent = [...lines, footer.join(" ")].join("\n");
  }

  /* ---------------- apply ---------------- */

  function applyOnce() {
    if (!window.VokrewFloor) return;
    const active = activeRecord();
    const { tasks, runs } = buildTasksAndRuns();
    window.VokrewFloor.applyState({
      agents: S.selectedCrew ? buildAgents() : [],
      tasks,
      runs,
      liveRuns: buildLiveRuns(active),
      budget: buildBudgetGlobal(),
      connected: S.connected,
      rigText: rigText(),
    });
    driveVisit(active);
    stampPill();
    stampChrome();
    updateStatusLine(active);
    renderCard();
  }

  function markOffline() {
    S.connected = false;
    applyOnce();
  }

  /* ---------------- polls ---------------- */

  async function slowPoll() {
    const [crewsRes, lanesRes, budgetRes] = await Promise.all([
      call("/crews"), call("/lanes"), call("/budget?surface=coding"),
    ]);
    if (crewsRes.status === 401 || crewsRes.status === 403) { markOffline(); return; }
    if (crewsRes.status === 200 && crewsRes.data && crewsRes.data.ok) {
      S.connected = true;
      S.crews = crewsRes.data.crews || [];
      if (!S.selectedCrew || !S.crews.some((c) => c.name === S.selectedCrew)) {
        S.selectedCrew = S.crews.some((c) => c.name === "default") ? "default" : (S.crews[0] && S.crews[0].name) || null;
      }
      syncCrewPicker();
    }
    if (lanesRes.status === 200 && lanesRes.data && lanesRes.data.ok) {
      S.lanes = new Map((lanesRes.data.lanes || []).map((l) => [l.id, l]));
    }
    if (budgetRes.status === 200 && budgetRes.data && budgetRes.data.ok) {
      S.budget = budgetRes.data;
    }
    applyOnce();
  }

  async function fastPoll() {
    if (S.fastBusy) return;
    S.fastBusy = true;
    try {
      const token = localStorage.getItem(LS_TOKEN);
      if (!token) { markOffline(); return; }
      const res = await call("/runs?limit=20");
      if (res.status === 401 || res.status === 403) { markOffline(); return; }
      if (res.status !== 200 || !res.data || !res.data.ok) { markOffline(); return; }
      S.connected = true;
      const prevRunning = new Set(S.summaries.filter((x) => x.state === "running").map((x) => x.id));
      S.summaries = res.data.runs || [];
      // A run just settled: its final stage's call landed in the ledger
      // after the last 15 s budget poll — refresh the budget now so the
      // pill is exact at completion, not up to 15 s behind it.
      const settled = [...prevRunning].some((id) => {
        const s = S.summaries.find((x) => x.id === id);
        return s && s.state !== "running";
      });
      if (settled) {
        const b = await call("/budget?surface=coding");
        if (b.status === 200 && b.data && b.data.ok) S.budget = b.data;
      }
      const want = new Set();
      const activeSum = S.summaries.find((x) => x.state === "running");
      if (activeSum) want.add(activeSum.id);
      if (S.trackedId) want.add(S.trackedId);
      if (S.selectedId) want.add(S.selectedId);
      // A lost run never comes back (in-memory registry): probe it
      // once, render the loss, and never 404 it again.
      S.lostIds.forEach((id) => want.delete(id));
      for (const id of want) {
        const r = await call("/runs/" + encodeURIComponent(id));
        if (r.status === 404) {
          if (S.records.has(id) || S.trackedId === id || S.selectedId === id) S.lostIds.add(id);
          S.records.delete(id);
          continue;
        }
        if (r.status === 200 && r.data && r.data.run) {
          const rec = r.data.run;
          const firstSight = !S.records.has(id);
          S.records.set(id, rec);
          if (firstSight && rec.state === "done") {
            // History from before this page opened: seed silently, no bubbles.
            (rec.stamps || []).forEach((st) => S.seenStamps.add(id + ":" + st.role));
            S.doneNoted.add(id);
          }
        }
      }
      // Prune records the registry no longer lists and nobody is looking at.
      const listed = new Set(S.summaries.map((x) => x.id));
      S.records.forEach((rec, id) => {
        if (!listed.has(id) && id !== S.trackedId && id !== S.selectedId) S.records.delete(id);
      });
      noteStamps();
      applyOnce();
    } catch {
      markOffline();
    } finally {
      S.fastBusy = false;
    }
  }

  /* ---------------- wiring: crew picker, run form, quest log, card ---------------- */

  function syncCrewPicker() {
    const sel = $("floorRunCrew");
    if (!sel) return;
    const names = S.crews.map((c) => c.name);
    const current = sel.value;
    if (sel.options.length !== names.length || names.some((n, i) => sel.options[i].value !== n)) {
      sel.innerHTML = "";
      names.forEach((n) => {
        const opt = document.createElement("option");
        opt.value = n;
        opt.textContent = n;
        sel.appendChild(opt);
      });
    }
    const want = S.selectedCrew || current;
    if (want && names.includes(want)) sel.value = want;
  }

  function wire() {
    const form = $("floorRunForm");
    if (form) {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const input = $("floorRunTask");
        const task = (input.value || "").trim();
        const status = $("floorRunStatus");
        if (!task) { if (status) status.textContent = "Give the crew a task first."; return; }
        const crew = ($("floorRunCrew") && $("floorRunCrew").value) || S.selectedCrew || "default";
        const btn = $("floorRunBtn");
        if (btn) { btn.disabled = true; btn.textContent = "Starting…"; }
        try {
          const res = await call("/run", { method: "POST", body: { task, crew }, timeoutMs: 10000 });
          if (res.status === 202 && res.data && res.data.runId) {
            S.trackedId = res.data.runId;
            S.selectedId = res.data.runId;
            S.cardOpen = true;
            S.lostIds.delete(res.data.runId);
            input.value = "";
            fastPoll();
          } else {
            if (status) status.textContent = `The run failed to start: ${(res.data && res.data.error) || "bridge returned " + res.status}`;
            if (btn) { btn.disabled = false; btn.textContent = "Run the crew"; }
          }
        } catch {
          if (status) status.textContent = "Can't reach your crew — is the bridge running?";
          if (btn) { btn.disabled = false; btn.textContent = "Run the crew"; }
        }
      });
    }
    const picker = $("floorRunCrew");
    if (picker) {
      picker.addEventListener("change", () => {
        S.selectedCrew = picker.value;
        applyOnce();
      });
    }
    const close = $("floorCardClose");
    if (close) close.addEventListener("click", () => { S.cardOpen = false; renderCard(); });
    const list = $("tasklist");
    if (list) {
      // Delegated: floor.js re-renders the rows on every applyState, so
      // this listener lives on the parent and survives re-renders. The
      // engine's own openTask() also fires (selection + tracker); the
      // adapter adds the run card on top.
      list.addEventListener("click", (ev) => {
        const row = ev.target.closest(".trow");
        if (!row || !row.dataset.id) return;
        S.selectedId = row.dataset.id;
        S.cardOpen = true;
        if (!S.records.has(S.selectedId)) fastPoll();
        renderCard();
      });
    }
  }

  /* ---------------- scheduler (spec §3 cadence) ---------------- */

  function floorVisible() {
    const scr = $("screen-floor");
    return !!(scr && !scr.classList.contains("hidden") && !document.hidden);
  }

  async function loop() {
    applyOnce(); // first paint: locked room until the first good poll
    for (;;) {
      const anyRunning = S.summaries.some((x) => x.state === "running") ||
        (S.trackedId && !S.lostIds.has(S.trackedId) && (!S.records.has(S.trackedId) || S.records.get(S.trackedId).state === "running"));
      await sleep(anyRunning ? 1000 : 2500);
      if (!floorVisible()) continue;
      try {
        if (Date.now() - S.lastSlow >= 15000) {
          S.lastSlow = Date.now();
          await slowPoll();
        }
        await fastPoll();
      } catch { /* polls guard themselves; never let the loop die */ }
    }
  }

  wire();
  loop();
})();
