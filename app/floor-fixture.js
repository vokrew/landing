"use strict";
/*
 * =========================================================================
 * ⚠⚠⚠  FIXTURE — STAGE 1 ONLY. DELETE THIS FILE BEFORE STAGE 2.  ⚠⚠⚠
 *
 * This file replays RECORDED, Floor-shaped state through the adapter
 * boundary (VokrewFloor.applyState) so the extracted room can render
 * and animate before the real bridge adapter exists. It is NOT bridge
 * data, NOT a demo mode, and NOT a fallback: nothing here talks to a
 * bridge, and the state below was written by hand for this stage.
 *
 * Stage 2 replaces this file with floor-adapter.js (live bridge data)
 * and deletes it. If you are reading this in Stage 2 or later, this
 * file should not exist.
 *
 * What it replays: the demo crew (Scout plans, Musky executes, Judge
 * reviews) sits idle, then one scripted run crosses the room —
 * planner works at its desk, then the executor, then the reviewer —
 * and the task lands STAMPED in the quest log. The sequence loops so
 * the room is alive whenever a human opens it. All motion is produced
 * by the real engine from this state feed; nothing here touches an
 * entity directly (spec §6, Stage 1).
 * =========================================================================
 */
(function () {
  const PLANNER = "fixture:planner";
  const EXECUTOR = "fixture:executor";
  const REVIEWER = "fixture:reviewer";
  const TASK_ID = "fixture-task-1";

  function agent(id, name, role, deskId, paletteId, model, instructions) {
    return {
      id, name, role, deskId,
      lifecycleState: "ready",
      status: "idle",
      appearance: { paletteId },
      adapterConfig: { model },
      cloud: false,
      heartbeat: false,
      instructions,
      memory: [],
      beliefs: []
    };
  }

  // Desks: first three CUBICLES keys in order (spec §3 mapping).
  const CREW = [
    agent(PLANNER, "Scout", "planner", "c-w1", "sunset", "fixture-lane",
      "Fixture planner. Recorded state only — Stage 1."),
    agent(EXECUTOR, "Musky", "executor", "c-w2", "ocean", "fixture-lane",
      "Fixture executor. Recorded state only — Stage 1."),
    agent(REVIEWER, "Judge", "reviewer", "c-sw", "violet", "fixture-lane",
      "Fixture reviewer. Recorded state only — Stage 1.")
  ];

  function crewWith(runningId) {
    return CREW.map((a) => Object.assign({}, a, {
      status: a.id === runningId ? "running" : "idle"
    }));
  }

  function task(status, stamped) {
    return [{
      id: TASK_ID,
      identifier: "FIX-1",
      title: "Fixture run — prove the room moves",
      description: "Recorded Stage 1 sequence: plan, execute, review, stamp.",
      agentId: EXECUTOR,
      status,
      stamped: !!stamped
    }];
  }

  function run(n, agentId, state, tokens) {
    return {
      id: "fixture-run-" + n,
      agentId,
      taskId: TASK_ID,
      state,
      stamped: state === "done",
      tokens,
      actionsRun: state === "done" ? 3 : 1,
      steps: [],
      error: null
    };
  }

  function live(n, agentId, stepText, tokens) {
    return [{
      id: "fixture-run-" + n,
      agentId,
      taskId: TASK_ID,
      taskIdentifier: "FIX-1",
      startedAt: Date.now(),
      tokens,
      actionsRun: 1,
      lastStep: { kind: "step", text: stepText }
    }];
  }

  function budget(usedGlobal) {
    return {
      usedGlobal,
      globalCap: 1000000,
      perAgentCap: 250000,
      usedPerAgent: {},
      remainingGlobal: 1000000 - usedGlobal,
      warningGlobal: false,
      warningPerAgent: {},
      day: "fixture"
    };
  }

  const RIG = "FIXTURE · recorded state — no bridge";

  // One replay of the sequence. Each step is a full state snapshot fed
  // through the adapter boundary; the engine does everything else.
  const STEPS = [
    [0, () => ({
      agents: crewWith(null),
      tasks: task("todo", false),
      runs: [],
      liveRuns: [],
      budget: budget(0),
      connected: true,
      rigText: RIG
    })],
    [2000, () => ({
      agents: crewWith(PLANNER),
      tasks: task("in_progress", false),
      runs: [run(1, PLANNER, "running", 400)],
      liveRuns: live(1, PLANNER, "Planning the fixture run", 400),
      budget: budget(400),
      connected: true,
      rigText: RIG
    })],
    [6500, () => ({
      agents: crewWith(EXECUTOR),
      tasks: task("in_progress", false),
      runs: [run(1, PLANNER, "done", 1100), run(2, EXECUTOR, "running", 1500)],
      liveRuns: live(2, EXECUTOR, "Executing the fixture run", 1500),
      budget: budget(2600),
      connected: true,
      rigText: RIG
    })],
    [11000, () => ({
      agents: crewWith(REVIEWER),
      tasks: task("in_progress", false),
      runs: [run(1, PLANNER, "done", 1100), run(2, EXECUTOR, "done", 3400), run(3, REVIEWER, "running", 900)],
      liveRuns: live(3, REVIEWER, "Reviewing the fixture run", 900),
      budget: budget(4300),
      connected: true,
      rigText: RIG
    })],
    [15500, () => ({
      agents: crewWith(null),
      tasks: task("done", true),
      runs: [run(1, PLANNER, "done", 1100), run(2, EXECUTOR, "done", 3400), run(3, REVIEWER, "done", 1600)],
      liveRuns: [],
      budget: budget(6100),
      connected: true,
      rigText: RIG
    })]
  ];
  const CYCLE_MS = 26000;

  let timers = [];
  function play() {
    timers.forEach(clearTimeout);
    timers = STEPS.map(([at, snap]) => setTimeout(() => {
      if (window.VokrewFloor) window.VokrewFloor.applyState(snap());
    }, at));
    timers.push(setTimeout(play, CYCLE_MS));
  }

  if (window.VokrewFloor) {
    play();
  } else {
    // floor.js is loaded immediately before this file by app.js; this
    // retry only covers a slow script fetch.
    let tries = 0;
    const wait = setInterval(() => {
      if (window.VokrewFloor || ++tries > 50) {
        clearInterval(wait);
        if (window.VokrewFloor) play();
      }
    }, 100);
  }
})();
