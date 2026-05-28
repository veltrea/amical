/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Long-session AudioContext leak stress harness.
 *
 * Drives the real AudioCaptureEngine (the same code useAudioCapture uses) in
 * Electron's Chromium with a fake audio device, running thousands of
 * start/stop cycles. A single engine is reused across cycles, exactly like the
 * app keeps one engine for the recording UI's lifetime.
 *
 * Pass criteria:
 *   - Only a small, bounded number of AudioContexts are ever constructed
 *     (the fix reuses one; the old bug created a new one every recording and
 *     eventually hit the browser's concurrent-AudioContext limit).
 *   - No start/stop failures across the whole run.
 *   - JS heap does not grow unboundedly with cycle count.
 *
 * Run: pnpm --filter @amical/desktop stress:audio   (optionally CYCLES=5000)
 */
const { app, BrowserWindow } = require("electron");
const esbuild = require("esbuild");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const CYCLES = parseInt(process.env.CYCLES || "2000", 10);
const MAX_CONTEXTS = parseInt(process.env.MAX_CONTEXTS || "2", 10);
// Allow this much heap growth end-to-end before calling it a leak (MB).
const MAX_HEAP_GROWTH_MB = parseFloat(process.env.MAX_HEAP_GROWTH_MB || "30");

// Use a synthetic mic so no real audio device / routing is required.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Precise heap numbers + a window.gc() hook so we can settle GC before measuring.
app.commandLine.appendSwitch("enable-precise-memory-info");
app.commandLine.appendSwitch("js-flags", "--expose-gc");

const ENGINE_ENTRY = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "hooks",
  "audio-capture-engine.ts",
);
const WORKLET_SRC = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "assets",
  "audio-recorder-processor.js",
);

function bundleEngine() {
  const result = esbuild.buildSync({
    entryPoints: [ENGINE_ENTRY],
    bundle: true,
    format: "iife",
    globalName: "AudioCaptureModule",
    platform: "browser",
    write: false,
  });
  return result.outputFiles[0].text;
}

const HARNESS_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <script src="/engine.js"></script>
    <script>
      // Count every AudioContext the engine constructs.
      let audioContextsCreated = 0;
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor(...args) {
          super(...args);
          audioContextsCreated++;
        }
      };

      const SAMPLE_RATE = 16000;
      const CONSTRAINTS = {
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      window.runHarness = async (cycles) => {
        const { AudioCaptureEngine } = window.AudioCaptureModule;
        let failures = 0;
        let framesReceived = 0;
        const heapSamples = [];

        // One engine reused for the whole session, mirroring useAudioCapture.
        const engine = new AudioCaptureEngine({
          sampleRate: SAMPLE_RATE,
          workletUrl: "/worklet.js",
          onFrame: () => {
            framesReceived++;
          },
        });

        const heapAt = () =>
          performance.memory ? performance.memory.usedJSHeapSize : 0;
        const heapStart = heapAt();

        for (let i = 0; i < cycles; i++) {
          try {
            await engine.start(CONSTRAINTS);
            // Let the worklet actually run and emit a few frames.
            await new Promise((r) => setTimeout(r, 2));
            await engine.stop();
          } catch (e) {
            failures++;
            if (failures <= 3) console.error("cycle " + i + " failed:", e);
          }
          if (i % Math.max(1, Math.floor(cycles / 10)) === 0) {
            heapSamples.push({ cycle: i, heapMB: +(heapAt() / 1048576).toFixed(2) });
          }
        }

        await engine.dispose();
        if (window.gc) {
          window.gc();
          await new Promise((r) => setTimeout(r, 50));
          window.gc();
        }
        const heapEnd = heapAt();

        return {
          cycles,
          audioContextsCreated,
          failures,
          framesReceived,
          heapStartMB: +(heapStart / 1048576).toFixed(2),
          heapEndMB: +(heapEnd / 1048576).toFixed(2),
          heapGrowthMB: +((heapEnd - heapStart) / 1048576).toFixed(2),
          finalContextState: engine.contextState,
          heapSamples,
        };
      };
    </script>
  </body>
</html>`;

function startServer(engineJs, workletJs) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = (req.url || "/").split("?")[0];
      if (url === "/" || url === "/harness.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(HARNESS_HTML);
      } else if (url === "/engine.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(engineJs);
      } else if (url === "/worklet.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(workletJs);
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  await app.whenReady();

  const engineJs = bundleEngine();
  const workletJs = fs.readFileSync(WORKLET_SRC, "utf-8");
  const server = await startServer(engineJs, workletJs);
  const { port } = server.address();

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });

  let exitCode = 1;
  try {
    await win.loadURL(`http://127.0.0.1:${port}/harness.html`);
    console.log(`Running AudioContext leak harness: ${CYCLES} cycles...`);
    const started = Date.now();
    const metrics = await win.webContents.executeJavaScript(
      `runHarness(${CYCLES})`,
    );
    const durationS = ((Date.now() - started) / 1000).toFixed(1);

    console.log("\n=== AudioContext leak harness result ===");
    console.log(JSON.stringify(metrics, null, 2));
    console.log(`duration: ${durationS}s`);

    const checks = [
      {
        name: `audioContextsCreated <= ${MAX_CONTEXTS}`,
        pass: metrics.audioContextsCreated <= MAX_CONTEXTS,
        got: metrics.audioContextsCreated,
      },
      { name: "no start/stop failures", pass: metrics.failures === 0, got: metrics.failures },
      { name: "received audio frames", pass: metrics.framesReceived > 0, got: metrics.framesReceived },
      {
        name: `heap growth <= ${MAX_HEAP_GROWTH_MB}MB`,
        pass: metrics.heapGrowthMB <= MAX_HEAP_GROWTH_MB,
        got: metrics.heapGrowthMB,
      },
    ];

    console.log("\n=== Checks ===");
    let allPass = true;
    for (const c of checks) {
      const ok = c.pass;
      allPass = allPass && ok;
      console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  (got: ${c.got})`);
    }
    exitCode = allPass ? 0 : 1;
    console.log(`\n${allPass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
  } catch (err) {
    console.error("Harness crashed:", err);
    exitCode = 1;
  } finally {
    server.close();
    app.exit(exitCode);
  }
}

main();
