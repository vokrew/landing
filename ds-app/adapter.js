// Vokrew web face — bridge adapter.
//
// Everything the page knows about the crew comes through here, and every
// translation from bridge JSON to room state happens in this module. The
// bridge is the only source of truth: no placeholder agents, lanes, models,
// runs, or counts are created in this file.
//
// Bridge contract (current `vokrew serve`, verified against src/serve.js):
//   GET  /health                      — no auth
//   POST /pair   {code}               — → {ok, token}
//   POST /run    {task, surface, crew, workspace}
//                                     — 202 {ok, runId}; ?wait=1 keeps the old
//                                       synchronous 200 result body
//   GET  /runs/:id                    — 200 {ok, run: <record>} or 404
//                                       {ok:false, error:"no such run: ..."}
//   GET  /runs?limit=N                — {ok, runs:[summary]} newest first
//   POST /chat   {message, verify, crew, sessionId}
//   GET  /budget?surface=coding|chat  — per-lane call counts for today
//   GET  /lanes                       — lane metadata + health string
//   GET  /crews                       — crew presets (role names/instructions/lanes)
//
// Every response is enveloped: {ok:true, ...} / {ok:false, error}. The run
// record is nested under `.run`; phases and stamps come from that record.
// A synchronous 200 bridge (older builds) is still tracked honestly from the
// bridge's own served-call counter, and run history is the page's journal.

export const ROLE_ORDER = ["planner", "executor", "reviewer"];
export const ROLE_PALETTE = { planner: "sunset", executor: "ocean", reviewer: "violet" };
export const RUN_LOST = "run lost — bridge restarted";
export const RUN_LOST_RELOAD = "run lost — page reloaded mid-run";
export const RUN_LOST_NO_STATE = "run lost — this bridge keeps no run records";

const DEFAULT_BASE = "http://127.0.0.1:7717";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------------- */
/* Small pure helpers — unit tested                                          */
/* ------------------------------------------------------------------------- */

export function normaliseBaseUrl(url) {
  const raw = String(url || "").trim() || DEFAULT_BASE;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : "http://" + raw;
  return withScheme.replace(/\/+$/, "");
}

export function modelLabel(model) {
  const s = String(model || "").trim();
  if (!s) return "";
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1] || s;
}

/** One readable stamp line: role · agent · lane · model · family · tier · latency. */
export function stampText(stamp) {
  if (!stamp) return "";
  const bits = [stamp.role || "stage"];
  if (stamp.agent) bits.push(stamp.agent);
  if (stamp.lane) bits.push(stamp.lane);
  if (stamp.model) bits.push(modelLabel(stamp.model));
  if (stamp.family) bits.push(stamp.family);
  if (stamp.tier) bits.push(stamp.tier);
  if (typeof stamp.latencyMs === "number") bits.push(fmtMs(stamp.latencyMs));
  return bits.join(" · ");
}

export function fmtMs(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return "—";
  if (ms < 1000) return Math.round(ms) + "ms";
  return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + "s";
}

/** The signature line: lane · model · family · latency. */
export function stampLine(stamp) {
  if (!stamp) return "";
  return [stamp.lane || "unknown lane", modelLabel(stamp.model) || "unknown model",
    stamp.family || "unknown family", fmtMs(stamp.latencyMs)].join(" · ");
}

export function reviewLabel(crossFamily) {
  return crossFamily ? "cross-family review" : "same family";
}

export function reviewSentence(record) {
  const stamps = record && record.stamps ? record.stamps : [];
  const ex = stamps.find((s) => s.role === "executor");
  const rv = stamps.find((s) => s.role === "reviewer");
  const verdict = (record && record.verdict) || "UNKNOWN";
  if (!ex || !rv) return verdict + " · stamps unavailable";
  if (record.crossFamily) {
    return `${verdict} · cross-family review (${ex.family} → ${rv.family})`;
  }
  return `${verdict} · same family (${ex.family} → ${rv.family})`;
}

/** Total served calls for one surface, from GET /budget. */
export function sumBudget(budget) {
  const lanes = (budget && budget.lanes) || [];
  return {
    used: lanes.reduce((n, l) => n + (Number(l.used) || 0), 0),
    lanes,
  };
}

/**
 * Header pill. The brief asks for "summed across capped lanes only"; when the
 * user's config has no capped lanes (the default here: every lane cap=null)
 * summing capped lanes would print 0/0 forever, so we fall back to every lane
 * and show the cap as "—" (unmetered). `cappedLanesOnly` says which rule ran.
 */
export function budgetPill(budget) {
  const lanes = ((budget && budget.lanes) || []).map((l) => ({
    ...l,
    used: Number(l.used) || 0,
    cap: l.cap === null || l.cap === undefined ? null : Number(l.cap),
  }));
  const capped = lanes.filter((l) => l.cap !== null && l.cap > 0);
  const pool = capped.length ? capped : lanes;
  const used = pool.reduce((n, l) => n + l.used, 0);
  const cap = capped.length ? capped.reduce((n, l) => n + l.cap, 0) : null;
  return {
    used,
    cap,
    cappedLanesOnly: capped.length > 0,
    label: `⚡ CALLS TODAY ${used} / ${cap === null ? "—" : cap}`,
    surface: (budget && budget.surface) || "coding",
  };
}

/** The three room seats, built only from what /crews reports. */
export function rosterFor(crew, stampsByRole = {}) {
  const roles = (crew && crew.roles) || {};
  return ROLE_ORDER.map((role) => {
    const r = roles[role] || {};
    const stamp = stampsByRole[role] || null;
    return {
      role,
      name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : null,
      instructions: typeof r.instructions === "string" ? r.instructions : null,
      prefersLanes: Array.isArray(r.lanes) ? r.lanes.slice() : [],
      modelOverride: typeof r.model === "string" ? r.model : null,
      palette: ROLE_PALETTE[role],
      lane: stamp ? stamp.lane : null,
      family: stamp ? stamp.family : null,
      model: stamp ? stamp.model : null,
      lastStamp: stamp,
    };
  });
}

export function stampsByRole(stamps) {
  const out = {};
  (stamps || []).forEach((s) => {
    if (s && s.role && ROLE_ORDER.includes(s.role)) out[s.role] = s;
  });
  return out;
}

/** Failover moments reported by the bridge: which lane actually served. */
export function failovers(stamps) {
  const out = [];
  (stamps || []).forEach((s) => {
    const attempts = Array.isArray(s.attempts) ? s.attempts : [];
    const failed = attempts.filter((a) => a.status === "failed");
    if (!failed.length) return;
    out.push({
      role: s.role,
      servedLane: s.lane,
      failedLanes: failed.map((a) => a.lane),
      text: `${failed.map((a) => a.lane).join(", ")} failed → served on ${s.lane}`,
    });
  });
  return out;
}

/* ------------------------------------------------------------------------- */
/* Live phase inference from the bridge's own served-call counter            */
/* ------------------------------------------------------------------------- */

export function stageForServed(n) {
  if (n <= 0) return "planner";
  if (n === 1) return "executor";
  if (n === 2) return "reviewer";
  return "settling";
}

/**
 * The chain serves planner → executor → reviewer, and `increment()` runs once
 * per *served* stage (cap-skipped and failed lanes never increment). So the
 * delta of the summed per-lane used counter tells us how many stages the
 * bridge has actually finished. Nothing here guesses: the count is the
 * bridge's /budget number.
 */
export class PhaseTracker {
  constructor(baselineUsed, at) {
    this.baseline = Number(baselineUsed) || 0;
    this.served = 0;
    this.stage = "planner";
    this.timeline = [{ stage: "planner", served: 0, at: at || new Date().toISOString() }];
  }
  observe(totalUsed, at) {
    const delta = Math.max(0, (Number(totalUsed) || 0) - this.baseline);
    const served = Math.min(3, delta);
    const before = this.served;
    if (served !== this.served) {
      this.served = served;
      this.stage = stageForServed(served);
      this.timeline.push({ stage: this.stage, served, at: at || new Date().toISOString() });
    }
    return { changed: served !== before, served, stage: this.stage };
  }
  current() {
    return { served: this.served, stage: this.stage, timeline: this.timeline };
  }
}

export function buildRecord({ id, runId = null, task, surface, crew, startedAt, endedAt, result, timeline, state }) {
  const stamps = (result && result.stamps) || [];
  const crossFamily = !!(result && result.crossFamily);
  return {
    id,
    runId: runId || (result && result.id) || null,
    task,
    surface: surface || "coding",
    crew: crew || (result && result.crew) || "default",
    startedAt,
    endedAt: endedAt || null,
    state: state || "done",
    verdict: (result && result.verdict) || "UNKNOWN",
    crossFamily,
    plan: (result && result.plan) || "",
    work: (result && result.work) || "",
    review: (result && result.review) || "",
    stamps: stamps.map((s) => ({
      role: s.role, agent: s.agent, lane: s.lane, provider: s.provider,
      model: s.model, family: s.family, tier: s.tier,
      latencyMs: s.latencyMs, attempts: s.attempts || [], failover: !!s.failover,
    })),
    stampLines: (result && result.stampLines) || stamps.map(stampText),
    timeline: timeline || [],
    lostReason: null,
    error: null,
  };
}

/* ------------------------------------------------------------------------- */
/* Bridge client                                                             */
/* ------------------------------------------------------------------------- */

export class BridgeClient {
  constructor({ baseUrl = DEFAULT_BASE, token = null } = {}) {
    this.baseUrl = normaliseBaseUrl(baseUrl);
    this.token = token || null;
  }

  setToken(token) { this.token = token || null; return this; }

  setBaseUrl(url) { this.baseUrl = normaliseBaseUrl(url); return this; }

  headers(extra) {
    return {
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...(extra || {}),
    };
  }

  async raw(path, { method = "GET", body, timeoutMs = 300000, auth = true } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        cache: "no-store",
        headers: this.headers({
          ...(body ? { "content-type": "application/json" } : {}),
          ...(auth ? {} : {}),
        }),
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: res.status, ok: res.ok, json, text };
    } finally {
      clearTimeout(timer);
    }
  }

  async json(path, opts) {
    const res = await this.raw(path, opts);
    if (!res.ok) {
      const err = new Error((res.json && res.json.error) || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = res.json;
      throw err;
    }
    return res.json;
  }

  async health() { return this.json("/health", { timeoutMs: 4000, auth: false }); }

  async pair(code) {
    const res = await this.raw("/pair", { method: "POST", body: { code: String(code || "").trim() }, timeoutMs: 8000 });
    if (!res.ok || !res.json || !res.json.token) {
      throw new Error((res.json && res.json.error) || `pairing failed (HTTP ${res.status})`);
    }
    this.token = res.json.token;
    return this.token;
  }

  async budget(surface = "coding") {
    return this.json(`/budget?surface=${encodeURIComponent(surface)}`, { timeoutMs: 8000 });
  }

  async lanes() { return this.json("/lanes", { timeoutMs: 15000 }); }

  async crews() { return this.json("/crews", { timeoutMs: 6000 }); }

  async chat({ message, verify = false, crew = null, sessionId = null }) {
    return this.json("/chat", {
      method: "POST",
      body: { message, verify, crew: crew || undefined, sessionId: sessionId || undefined },
      timeoutMs: 240000,
    });
  }

  /**
   * The documented async contract (202 + runId, GET /runs/:id, GET /runs) is
   * followed when the bridge answers with it. The real v0.3.1 bridge answers
   * POST /run synchronously with 200, so no probe is needed to start a run —
   * that keeps the browser console free of a deliberate 404 every run.
   */
  async listRuns(limit = 20) {
    const rec = await this.json(`/runs?limit=${encodeURIComponent(limit)}`, { timeoutMs: 6000 });
    if (Array.isArray(rec)) return rec;
    if (rec && Array.isArray(rec.runs)) return rec.runs;
    return [];
  }

  /**
   * Start a chain and track it. Returns a settled record with real stamps.
   * onPhase({stage, served, at, budget}) fires for planner/executor/reviewer
   * transitions; onBudget(budget) fires on every poll.
   */
  async startRun({
    task, surface = "coding", crew = null, workspace = null,
    onPhase = () => {}, onBudget = () => {}, onRunId = () => {},
    pollMs = 400, idFactory,
  }) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();

    const baseBudget = await this.budget(surface);
    const baseline = sumBudget(baseBudget).used;
    const tracker = new PhaseTracker(baseline, startedAt);

    let emittedServed = 0;
    function emit(served, at, budget, source = "budget") {
      const stage = stageForServed(served);
      if (!tracker.timeline.some((t) => t.served === served && t.stage === stage)) {
        tracker.timeline.push({ stage, served, at });
      }
      onPhase({ stage, served, at, budget, source });
    }
    function advanceTo(n, at, budget, source = "budget") {
      const target = Math.max(0, Math.min(3, n));
      while (emittedServed < target) {
        emittedServed += 1;
        emit(emittedServed, at, budget, source);
      }
    }

    onPhase({ stage: "planner", served: 0, at: startedAt, baseline, budget: baseBudget, source: "start" });

    let finished = false;
    // While a registry record is available it is the authority for phases;
    // the budget counter stays a fallback for synchronous 200 bridges.
    let following = false;
    const poll = (async () => {
      while (!finished) {
        await sleep(pollMs);
        if (finished) break;
        try {
          const b = await this.budget(surface);
          onBudget(b);
          const p = tracker.observe(sumBudget(b).used, new Date().toISOString());
          if (!following) advanceTo(p.served, new Date().toISOString(), b);
        } catch { /* bridge busy or restarting; keep the last known phase */ }
      }
    })();

    let result = null;
    let runId = null;
    let error = null;
    let networkFailure = false;
    let lostReason = null;

    try {
      const res = await this.raw("/run", {
        method: "POST",
        body: { task, surface, crew: crew || undefined, workspace: workspace || undefined },
        timeoutMs: 300000,
      });
      if (res.status === 202 && res.json && (res.json.runId || res.json.id)) {
        runId = res.json.runId || res.json.id;
        following = true;
        // Save the bridge's own id on the journal entry *now*, not at settle:
        // a page reload mid-run must be able to reattach by this id.
        onRunId(runId);
        result = await this.#followRun(runId, {
          pollMs,
          emit: (served, at) => advanceTo(served, at, null, "run-record"),
        });
      } else if (!res.ok) {
        const err = new Error((res.json && res.json.error) || `run failed (HTTP ${res.status})`);
        err.status = res.status;
        err.body = res.json;
        throw err;
      } else {
        result = res.json;
      }
    } catch (e) {
      error = e;
      networkFailure = !e.status;
      if (e.status === 404) lostReason = RUN_LOST;
      else if (networkFailure) {
        const back = await this.#bridgeReachable();
        lostReason = back ? RUN_LOST : "bridge unreachable — run lost";
      } else {
        lostReason = e.message;
      }
    }

    finished = true;
    await poll;
    const endedAt = new Date().toISOString();
    const id = (idFactory && idFactory()) || "run-" + startedMs.toString(36) + "-" + Math.random().toString(36).slice(2, 6);

    if (error || !result || result.state === "failed") {
      if (!error && result && result.state === "failed") {
        lostReason = result.error || "run failed on the bridge";
      }
      return {
        id, runId, task, surface, crew: crew || "default", startedAt, endedAt,
        state: "lost", verdict: "LOST", crossFamily: false,
        plan: "", work: "", review: "", stamps: [], stampLines: [],
        timeline: tracker.timeline, lostReason: lostReason || (error && error.message) || "run failed",
        error: error ? error.message : (result && result.error) || "no result",
      };
    }

    // A successful chain has plan/work/review stamps. Emit any phase the poll
    // did not catch, then the settle transition — all from reported data.
    advanceTo(3, endedAt, null);

    return buildRecord({
      id, runId, task, surface, crew, startedAt, endedAt, result,
      timeline: tracker.timeline, state: "done",
    });
  }

  /**
   * Read one registry record, envelope unwrapped. Throws an error carrying
   * `.status` on HTTP failure; 404 means the registry has no such run.
   */
  async getRun(runId) {
    const body = await this.json(`/runs/${encodeURIComponent(runId)}`, { timeoutMs: 10000 });
    if (body && body.ok === false) {
      const err = new Error(body.error || "run record unavailable");
      err.status = 404;
      err.body = body;
      throw err;
    }
    const rec = body && body.run;
    if (!rec || typeof rec !== "object") {
      const err = new Error("bridge returned no run record");
      err.status = 502;
      err.body = body;
      throw err;
    }
    return rec;
  }

  /** Reattach to a bridge that keeps run records: follow to settle. */
  async followRun(runId, { onPhase = () => {} } = {}) {
    const tracker = new PhaseTracker(0, new Date().toISOString());
    const result = await this.#followRun(runId, {
      emit: (served, at) => {
        const stage = stageForServed(served);
        const last = tracker.timeline[tracker.timeline.length - 1];
        if (!last || last.stage !== stage || last.served !== served) {
          tracker.timeline.push({ stage, served, at });
        }
        tracker.stage = stage;
        tracker.served = served;
        onPhase({ stage, served, at, source: "run-record" });
      },
    });
    return { result, timeline: tracker.timeline, record: result, runId };
  }

  /**
   * Poll one registry record until it settles. Success is enveloped as
   * {ok:true, run:<record>}; the record is body.run. A 404 (or ok:false)
   * means the registry no longer has this run — a bridge restart or eviction.
   */
  async #followRun(runId, { emit = () => {}, pollMs = 450 } = {}) {
    let lastServed = -1;
    for (;;) {
      const rec = await this.getRun(runId);
      const at = new Date().toISOString();
      const settled = rec.state === "done" || rec.state === "succeeded";
      const failed = rec.state === "failed" || rec.state === "lost";
      const stamps = Array.isArray(rec.stamps) ? rec.stamps.length : 0;
      const phaseIndex = ROLE_ORDER.indexOf(rec.phase);
      const served = settled || failed ? 3 : Math.max(stamps, phaseIndex);
      if (served > lastServed) {
        lastServed = served;
        emit(served, at);
      }
      if (settled) {
        if (lastServed < 3) emit(3, at);
        return rec;
      }
      if (failed) {
        const err = new Error(rec.error || "run failed on the bridge");
        err.status = 409; // the chain completed with a failure, not a network drop
        err.record = rec;
        throw err;
      }
      await sleep(pollMs);
    }
  }

  async #bridgeReachable() {
    for (let i = 0; i < 6; i++) {
      try { await this.health(); return true; } catch { await sleep(700); }
    }
    return false;
  }
}

/* ------------------------------------------------------------------------- */
/* Journal helpers (page-local history; the bridge reports no run list)     */
/* ------------------------------------------------------------------------- */

export function upsertRecord(journal, record, cap = 40) {
  const list = Array.isArray(journal) ? journal.slice() : [];
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = record; else list.unshift(record);
  return list.slice(0, cap);
}

export function settleStaleRuns(journal, reason = RUN_LOST_RELOAD) {
  return (journal || []).map((r) => (
    r.state === "running"
      ? { ...r, state: "lost", endedAt: r.endedAt || new Date().toISOString(), lostReason: reason }
      : r
  ));
}

export function verdictTone(verdict) {
  if (verdict === "APPROVED") return "good";
  if (verdict === "CHANGES") return "warn";
  if (verdict === "LOST") return "bad";
  return "muted";
}
