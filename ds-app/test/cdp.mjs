// Minimal Chrome DevTools Protocol driver (no dependencies).
// Used by browser.test.mjs and for manual evidence captures.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 20000, interval = 100, label = "condition" } = {}) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) { lastErr = err; }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}${lastErr ? ` (${lastErr.message})` : ""}`);
}

async function fetchJson(url, timeoutMs = 2000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.errors = [];
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "CDP error"));
        else resolve(msg.result || {});
        return;
      }
      if (msg.method) {
        if (msg.method === "Runtime.exceptionThrown") {
          const d = msg.params.exceptionDetails;
          this.errors.push(`exception: ${d.exception?.description || d.text}`);
        }
        if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
          this.errors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
        }
        const hs = this.handlers.get(msg.method) || [];
        hs.forEach((fn) => { try { fn(msg.params); } catch { /* handler */ } });
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(d.exception?.description || d.text || "evaluation failed");
    }
    return res.result ? res.result.value : undefined;
  }
}

export async function launchChromium({
  url,
  port = 9333,
  width = 1440,
  height = 1000,
  userDataDir = "/tmp/vokrew-chrome-" + process.pid,
  gpu = false,
  headed = false,
} = {}) {
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const args = [
    ...(headed ? [] : ["--headless=new"]),
    ...(gpu ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--disable-gpu"]),
    // Deterministic raster for screenshots: let every compositor stage finish
    // before the capture, otherwise headless can grab a half-tiled surface.
    "--run-all-compositor-stages-before-draw",
    "--disable-new-content-rendering-timeout",
    "--force-color-profile=srgb",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ];
  const bin = process.env.CHROME_BIN || "/usr/bin/chromium";
  // A desktop session here exports GDK_SCALE=2 for HiDPI. Chromium honours it
  // and double-exposes the raster, which corrupts every screenshot. Launch with
  // a neutral scale so captures are 1:1 with the layout under test.
  const env = { ...process.env };
  delete env.GDK_SCALE;
  delete env.GDK_DPI_SCALE;
  const proc = spawn(bin, args, { stdio: "ignore", env });
  proc.unref();

  const version = await waitFor(() => fetchJson(`http://127.0.0.1:${port}/json/version`), {
    timeout: 20000, label: "chromium devtools",
  }).catch((err) => {
    try { proc.kill("SIGKILL"); } catch { /* gone */ }
    throw err;
  });

  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Error("no page target");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("websocket failed")), { once: true });
  });

  const cdp = new CDP(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.navigate", { url });

  const api = {
    cdp,
    proc,
    port,
    version,
    async goto(u) {
      await cdp.send("Page.navigate", { url: u });
    },
    async close() {
      try { ws.close(); } catch { /* closed */ }
      try { proc.kill("SIGTERM"); } catch { /* gone */ }
      await sleep(250);
      try { proc.kill("SIGKILL"); } catch { /* gone */ }
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
    async screenshot(file, { width: paperW = width, height: paperH = height } = {}) {
      // Page.captureScreenshot double-exposes the raster on this desktop
      // session (a scaled compositor surface), so evidence images are rendered
      // through the print path instead: vector output, rasterized 1:1 at 96dpi.
      const pdfPath = file.replace(/\.png$/, ".pdf");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        // The print layout restarts CSS animations at t=0, so a dialog that is
        // still fading in would be captured at opacity 0. Finish every running
        // animation first; the still frame then matches what a person sees.
        await cdp.eval(
          "(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch { /* infinite */ } } return true; })()",
        ).catch(() => {});
        // Print from the top of the document: a sticky header captured at a
        // scrolled offset leaves a blank band and clips the toolbar.
        await cdp.eval("window.scrollTo(0, 0)").catch(() => {});
        const pdf = await cdp.send("Page.printToPDF", {
          printBackground: true,
          paperWidth: paperW / 96,
          paperHeight: paperH / 96,
          marginTop: 0,
          marginBottom: 0,
          marginLeft: 0,
          marginRight: 0,
          scale: 1,
          preferCSSPageSize: false,
        });
        fs.writeFileSync(pdfPath, Buffer.from(pdf.data, "base64"));
        const prefix = pdfPath.replace(/\.pdf$/, "-page");
        execFileSync("pdftoppm", ["-png", "-r", "96", "-f", "1", "-l", "1", pdfPath, prefix], { stdio: "ignore" });
        fs.renameSync(prefix + "-1.png", file);
        return file;
      } catch (err) {
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
        return file;
      } finally {
        try { fs.rmSync(pdfPath, { force: true }); } catch { /* gone */ }
      }
    },
    async setViewport(w, hgt, scale = 1) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: w, height: hgt, deviceScaleFactor: scale, mobile: false,
      });
    },
    errors() { return cdp.errors.slice(); },
  };
  return api;
}
