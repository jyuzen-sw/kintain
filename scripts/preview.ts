import { spawn } from "node:child_process";
import { resolve } from "node:path";

const wrangler = spawn(
  resolve("node_modules/.bin/wrangler"),
  [
    "dev",
    "--config",
    resolve("dist/server/wrangler.json"),
    "--persist-to",
    resolve(".wrangler/state"),
    ...process.argv.slice(2),
  ],
  {
    cwd: process.cwd(),
    env: process.env,
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
