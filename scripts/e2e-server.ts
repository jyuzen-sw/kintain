import { spawn, spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const port = process.env.E2E_PORT ?? "4173";
const runtimeEnvironment = {
  ...process.env,
  WRANGLER_LOG: "none",
  WRANGLER_LOG_PATH: resolve(".wrangler/logs/kintain-e2e-wrangler.log"),
  WRANGLER_SEND_METRICS: "false",
  XDG_CONFIG_HOME: resolve(".wrangler/config"),
};

const npmExecutable = process.env.npm_execpath;
if (!npmExecutable) {
  throw new Error("npm_execpath is required to run the E2E production build");
}

const buildStartedAt = Date.now();
const build = spawnSync(process.execPath, [npmExecutable, "run", "build"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: runtimeEnvironment,
  stdio: "inherit",
});

if (build.error) throw build.error;
if (build.status !== 0) {
  throw new Error(`Production build failed with status ${build.status ?? "unknown"}`);
}

const wranglerConfig = resolve("dist/server/wrangler.json");
let buildOutputReady = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    const output = await stat(wranglerConfig);
    if (output.mtimeMs >= buildStartedAt - 1_000) {
      buildOutputReady = true;
      break;
    }
  } catch {
    await wait(100);
  }
}
if (!buildOutputReady) {
  throw new Error(`Build output was not created: ${wranglerConfig}`);
}

const wrangler = spawn(
  process.execPath,
  [
    resolve("node_modules/wrangler/bin/wrangler.js"),
    "dev",
    "--config",
    wranglerConfig,
    "--persist-to",
    resolve(".wrangler/state"),
    "--port",
    port,
    "--ip",
    "127.0.0.1",
    "--inspector-ip",
    "127.0.0.1",
    "--log-level",
    "error",
    "--var",
    "DEMO_MODE:true",
    "--var",
    "SHOW_DEMO_CREDENTIALS:true",
    "--var",
    "ALLOW_PUBLIC_DEMO:true",
  ],
  {
    cwd: process.cwd(),
    env: runtimeEnvironment,
    stdio: "inherit",
  },
);

const stop = (signal: NodeJS.Signals) => {
  if (!wrangler.killed) wrangler.kill(signal);
};

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

wrangler.once("error", (error) => {
  throw error;
});

wrangler.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
