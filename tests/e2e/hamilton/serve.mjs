#!/usr/bin/env node
/**
 * Starts the local Next server for the Hamilton browser journeys (H07-T03, T04).
 *
 * The server gets a clean environment: DATABASE_URL is the local fixture database (refused unless
 * it is on this machine), and every provider, billing, email and mailing-list key is blanked, so
 * a journey can never make a paid call or send a message even on a machine whose .env.local holds
 * real keys. Next does not let .env files override a variable that is already set.
 *
 * By default it serves a production build (`next start`), building first when `.next` has none
 * or HAMILTON_E2E_BUILD=1. `next dev` with webpack cannot hydrate under the site's
 * Content-Security-Policy (no 'unsafe-eval'), so HAMILTON_E2E_SERVER=dev is for Turbopack only.
 * HAMILTON_E2E_NEXT_ARGS adds flags to build/dev (for example `--webpack` in a git worktree
 * whose node_modules is a symlink, which Turbopack refuses).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const url = process.env.E2E_DATABASE_URL;
if (!url) {
  console.error("Set E2E_DATABASE_URL to the local fixture database.");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
  console.error(`Refusing to serve Hamilton journeys against ${host}: local databases only.`);
  process.exit(1);
}

const BLANK_PREFIXES = ["ANTHROPIC_", "OPENAI_", "STRIPE_", "RESEND_", "MAILERLITE_", "GSC_", "FIRECRAWL_", "R2_", "AWS_", "SUPABASE_", "VERCEL_"];
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (BLANK_PREFIXES.some((prefix) => key.startsWith(prefix))) env[key] = "";
}
// Names .env files commonly set: blank them even when absent here, so a file cannot supply them.
for (const key of [
  "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_HAMILTON", "ANTHROPIC_API_KEY_GROWTH", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY", "MAILERLITE_API_KEY", "CRON_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
]) env[key] = "";
env.DATABASE_URL = url;
env.DATABASE_POOL_MAX = "4";
env.BFI_COOKIE_SECRET = "hamilton-e2e-local-cookie-secret";
env.MAILERLITE_SYNC_ENABLED = "false";
env.NEXT_TELEMETRY_DISABLED = "1";
env.EXECUTION_BACKEND = "agentic_v1";
const port = process.env.HAMILTON_E2E_PORT ?? "3197";
env.NEXT_PUBLIC_SITE_URL = `http://localhost:${port}`;
env.BFI_APP_URL = `http://localhost:${port}`;

const mode = process.env.HAMILTON_E2E_SERVER === "dev" ? "dev" : "start";
const extra = (process.env.HAMILTON_E2E_NEXT_ARGS ?? "").split(/\s+/).filter(Boolean);
if (mode === "start" && (process.env.HAMILTON_E2E_BUILD === "1" || !existsSync(".next/BUILD_ID"))) {
  const build = spawnSync("npx", ["next", "build", ...extra], { env: { ...env, NODE_ENV: "production" }, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const child = spawn("npx", ["next", mode, "-p", port, ...(mode === "dev" ? extra : [])], { env, stdio: "inherit" });
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
