// A real Vokrew bridge for browser tests: same createBridge/runChain code as
// `vokrew serve`, real local model lanes (llama-swap), its own VOKREW_HOME and
// ledger so the production ledger is untouched. No mocks anywhere.

import fs from "node:fs";
import path from "node:path";
import { createBridge } from "../../src/serve.js";
import { loadConfig, loadLedger, buildLanes } from "../../src/core.js";

export const TEST_LANES = [
  {
    id: "pc-lfm",
    provider: "openai-compatible",
    family: "lfm",
    tier: "local",
    model: "lfm2.5:latest",
    baseUrl: "http://127.0.0.1:8080/v1",
    cap: null,
  },
  {
    id: "pc-gemma",
    provider: "openai-compatible",
    family: "gemma",
    tier: "local",
    model: "gemma3:4b-cpu",
    baseUrl: "http://127.0.0.1:8080/v1",
    cap: null,
  },
  {
    // First planner candidate on purpose: proves failover surfaces honestly.
    // Nothing listens on port 9, so the attempt fails immediately.
    id: "dead-lane",
    provider: "openai-compatible",
    family: "lfm",
    tier: "local",
    model: "missing-model",
    baseUrl: "http://127.0.0.1:9/v1",
    cap: null,
  },
];

const TEST_CONFIG = {
  lanes: TEST_LANES,
  roles: {
    planner: ["dead-lane", "pc-lfm"],
    executor: ["pc-gemma"],
    reviewer: ["pc-gemma"],
  },
};

const TEST_CREWS = {
  default: {
    roles: {
      planner: { name: "Nova", lanes: ["dead-lane", "pc-lfm"], instructions: "Frame the task in one short paragraph." },
      executor: { name: "Rivet", lanes: ["pc-gemma"], instructions: "Answer directly and briefly." },
      reviewer: { name: "Glass", lanes: ["pc-gemma"], instructions: "Be strict. Start with APPROVED or CHANGES." },
    },
  },
  relief: {
    roles: {
      planner: { name: "Moss", lanes: ["dead-lane", "pc-lfm"] },
      executor: { name: "Anvil", lanes: ["pc-gemma"] },
      reviewer: { name: "Quill", lanes: ["pc-gemma"] },
    },
  },
};

export async function startTestBridge({ port = 7791, home, reuse = false } = {}) {
  home = home || path.join("/tmp", "vokrew-test-home-" + process.pid);
  if (!reuse) {
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(TEST_CONFIG, null, 2) + "\n");
    fs.writeFileSync(path.join(home, "crews.json"), JSON.stringify(TEST_CREWS, null, 2) + "\n");
  }

  const config = loadConfig(home);
  const ledger = loadLedger(home);
  const lanes = buildLanes(config);
  let code = null;
  const bridge = createBridge({
    home,
    config,
    lanes,
    ledger,
    onPairingCode: (c) => { code = c; },
  });

  await new Promise((resolve, reject) => {
    bridge.server.once("error", reject);
    bridge.server.listen(port, "127.0.0.1", resolve);
  });
  bridge.newPairingCode();

  return {
    port,
    home,
    ledger,
    getCode: () => code,
    // Drop open sockets too: a restart test needs the in-flight /run to fail
    // now, not after the chain finishes.
    close: () => new Promise((resolve) => {
      try { bridge.server.closeAllConnections(); } catch { /* older node */ }
      bridge.server.close(() => resolve());
    }),
    state: bridge.state,
  };
}
