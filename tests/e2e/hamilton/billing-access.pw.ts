/**
 * #1920 (go-live gate G10): one journey, every billing state, every Hamilton page and route.
 *
 * Seeds one synthetic account per billing state (billing-access.ts ACCOUNTS) into the local
 * fixture database, gives each a session, and sends every probe in ROUTES over real HTTP to the
 * production build serve.mjs starts: src/proxy.ts, the /pro layouts and each route's own check
 * all run as they do in production. Redirects are followed (3xx and Next's streamed meta
 * refresh) until the request lands on /login, /subscribe, /account/billing-issue or an answer.
 *
 * Every cell is checked against EXPECTED with a soft assertion, so one run names every mismatch.
 * The observed matrix is written to test-results/hamilton-billing-access/matrix.md (and .json).
 * No browser is launched and no provider is called (serve.mjs blanks every key).
 *
 *   E2E_DATABASE_URL=postgres://...localhost.../e2e npx playwright test -c tests/e2e/hamilton/playwright.config.ts billing-access
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "playwright/test";
import {
  ACCESS_ID_MAX, ACCESS_ID_MIN, ACCOUNTS, ACTIONS, ACTION_TOKENS, BILLING_STATES, EXPECTED, ROUTES, SEAT_WORKSPACES, TOKENS,
  expectedOutcome, isRefusedActionResult, ownAnalysisId, ownScenarioId, reportLinkToken, signedSessionCookie,
  type ActionEntry, type BillingState, type Outcome, type Probe, type RouteEntry,
} from "./billing-access";
import { HOME, connectFixtureDb, type FixtureDb } from "./fixtures";

// Not serial: a state's mismatches must not stop the other states from running. A failed test
// restarts the worker, so seeding is idempotent and each state's cells are kept on disk.

const port = Number(process.env.HAMILTON_E2E_PORT ?? 3197);
const base = `http://localhost:${port}`;
const root = path.resolve(__dirname, "../../..");
const outDir = path.join(root, "test-results/hamilton-billing-access");
const actionKey = (action: ActionEntry) => `ACTION ${action.file}#${action.name}`;

interface BuiltAction { id: string; workers: string[] }
/** Server actions in the build the server runs: `src/app/<file>#<name>` -> id and pages. */
function builtActions(): Map<string, BuiltAction> {
  const manifest = JSON.parse(readFileSync(path.join(root, ".next/server/server-reference-manifest.json"), "utf8")) as {
    node: Record<string, { filename?: string; exportedName?: string; workers: Record<string, unknown> }>;
  };
  const out = new Map<string, BuiltAction>();
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.filename && entry.exportedName) out.set(`${entry.filename}#${entry.exportedName}`, { id, workers: Object.keys(entry.workers) });
  }
  return out;
}

/** "app/pro/(hamilton)/analyze/page" -> "/pro/analyze": a page that loads the action. */
function pagePathFor(workers: string[]): string {
  const worker = workers.find((w) => w.startsWith("app/pro/") && !w.includes("[")) ?? workers[0];
  return worker.replace(/^app/, "").replace(/\/page$/, "").replace(/\/\([^)]+\)/g, "") || "/";
}

interface Cell { outcome: Outcome; status: number; finalPath: string }
const cellsFile = (state: BillingState) => path.join(outDir, `cells-${state}.json`);
const cookies = new Map<BillingState, string>();
const jobIds = new Map<BillingState, string>();
let marketToken = "";

const probeKey = (probe: Probe) => `${probe.method} ${probe.path}`;

/** Removes this journey's rows (ids ACCESS_ID_MIN..ACCESS_ID_MAX) and anything its requests wrote for them. */
async function clear(db: FixtureDb): Promise<void> {
  const ids = Array.from({ length: ACCESS_ID_MAX - ACCESS_ID_MIN + 1 }, (_, i) => String(ACCESS_ID_MIN + i));
  const tables = await db<{ table_name: string; column_name: string }[]>`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name IN ('user_id', 'institution_id') AND t.table_type = 'BASE TABLE'`;
  const pending = [...tables.map((t) => ({ table: t.table_name, column: t.column_name })), { table: "users", column: "id" }, { table: "institution_sources", column: "id" }];
  for (let pass = 0; pass < 6 && pending.length; pass += 1) {
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      try {
        // No DELETE on a table without these rows: append-only tables refuse any DELETE (#2170),
        // so this journey must never write a normalized witness for its institutions.
        const held = await db.unsafe(`SELECT 1 FROM public.${pending[i].table} WHERE ${pending[i].column}::text = ANY($1::text[]) LIMIT 1`, [ids]);
        if (held.length) await db.unsafe(`DELETE FROM public.${pending[i].table} WHERE ${pending[i].column}::text = ANY($1::text[])`, [ids]);
        pending.splice(i, 1);
      } catch (error) {
        if (pass === 5) throw error;
      }
    }
  }
}

async function seed(db: FixtureDb): Promise<void> {
  await clear(db);
  for (const ws of Object.values(SEAT_WORKSPACES)) {
    await db`INSERT INTO institution_sources (id, institution_name, charter_type, source, city, state, state_code, fed_district, status, website_url)
             VALUES (${ws.id}, ${ws.name}, 'bank', 'fdic', 'Testville', 'FL', 'FL', 6, 'active', ${`https://fixture.test/${ws.id}`})`;
  }
  for (const a of ACCOUNTS) {
    const pastDueSince = a.pastDueDays === null ? null : new Date(Date.now() - a.pastDueDays * 86_400_000).toISOString();
    await db`INSERT INTO users (id, username, email, password_hash, display_name, role, is_active, subscription_status, past_due_since)
             VALUES (${a.id}, ${a.email}, ${a.email}, 'no-login: session seeded by billing-access.pw.ts', ${`Access ${a.state}`},
                     ${a.role}, true, ${a.subscriptionStatus}, ${pastDueSince})`;
    const sessionId = randomBytes(24).toString("hex");
    await db`INSERT INTO sessions (id, user_id, expires_at) VALUES (${sessionId}, ${a.id}, NOW() + interval '1 day')`;
    cookies.set(a.state, `fsh_session=${signedSessionCookie(sessionId)}`);
    await db`INSERT INTO hamilton_saved_analyses (id, user_id, institution_id, title, analysis_focus, prompt, response_json)
             VALUES (${ownAnalysisId(a.id)}, ${String(a.id)}, '', ${`Saved answer of ${a.state}`}, 'pricing', 'What is the median NSF fee?',
                     ${db.json({ title: `Saved answer of ${a.state}`, confidence: "medium", hamiltonView: "Synthetic.", whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [] })})`;
    await db`INSERT INTO hamilton_scenarios (id, user_id, institution_id, fee_category, current_value, proposed_value, result_json, confidence_tier)
             VALUES (${ownScenarioId(a.id)}, ${String(a.id)}, ${String(HOME.id)}, 'nsf', 27, 30, ${db.json({})}, 'provisional')`;
    const [job] = await db<{ id: string }[]>`
      INSERT INTO report_jobs (report_type, status, user_id) VALUES ('national_index', 'pending', ${a.id}) RETURNING id::text AS id`;
    jobIds.set(a.state, job.id);
  }
  let membershipId = 9_708_500;
  for (const ws of Object.values(SEAT_WORKSPACES)) {
    const owner = ACCOUNTS.find((a) => a.state === ws.owner)!;
    await db`INSERT INTO institution_workspace_memberships (id, institution_id, user_id, membership_role, membership_status, source, notes)
             VALUES (${membershipId++}, ${ws.id}, ${owner.id}, 'owner', 'active', 'manual_admin', 'billing-access synthetic owner')`;
  }
  for (const a of ACCOUNTS.filter((x) => x.seatIn)) {
    await db`INSERT INTO institution_workspace_memberships (id, institution_id, user_id, membership_role, membership_status, source, notes)
             VALUES (${membershipId++}, ${SEAT_WORKSPACES[a.seatIn!].id}, ${a.id}, 'analyst', 'active', 'manual_admin', 'billing-access synthetic seat')`;
  }
  jobIds.set("anonymous", jobIds.get("paid")!);
  marketToken = reportLinkToken(HOME.id);
}

function resolvePath(probe: Probe, state: BillingState): string {
  return probe.path.replace(TOKENS.marketReport, marketToken).replace(TOKENS.ownJob, jobIds.get(state)!);
}

const META_REDIRECT = /<meta[^>]*http-equiv="refresh"[^>]*content="\d+;\s*url=([^"]+)"/i;

function gateFor(pathname: string): Outcome | null {
  if (pathname === "/login") return "login";
  if (pathname === "/subscribe") return "subscribe";
  if (pathname === "/account/billing-issue") return "billing";
  return null;
}

function outcomeFor(status: number): Outcome {
  if (status === 401 || status === 403) return "denied";
  if (status === 503) return "unavailable";
  if (status >= 500) return "error";
  return "ok";
}

/** Sends one probe as one state and follows redirects until it lands. */
async function send(probe: Probe, state: BillingState): Promise<Cell> {
  const cookie = cookies.get(state);
  let url = new URL(resolvePath(probe, state), base);
  let method: string = probe.method;
  let body: string | undefined = probe.body;
  for (let hop = 0; hop < 6; hop += 1) {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "content-type": probe.contentType ?? "text/plain" } : {}),
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      },
      body,
      signal: AbortSignal.timeout(90_000),
    });
    let next: string | null = null;
    if (response.status >= 300 && response.status < 400) next = response.headers.get("location");
    const text = next ? "" : await response.text();
    if (!next && response.status === 200 && (response.headers.get("content-type") ?? "").includes("text/html")) {
      const meta = META_REDIRECT.exec(text);
      if (meta) next = meta[1].replace(/&amp;/g, "&");
    }
    if (!next) return { outcome: outcomeFor(response.status), status: response.status, finalPath: url.pathname };
    url = new URL(next, url);
    const gate = gateFor(url.pathname);
    if (gate) return { outcome: gate, status: response.status, finalPath: url.pathname };
    method = "GET";
    body = undefined;
  }
  return { outcome: "error", status: 0, finalPath: `${url.pathname} (too many redirects)` };
}

/** Calls one server action as one state, the way the browser does, and reads its result. */
async function callAction(action: ActionEntry, built: BuiltAction, state: BillingState): Promise<Cell> {
  const owner = ACCOUNTS.find((a) => a.state === state) ?? ACCOUNTS.find((a) => a.state === "paid")!;
  const args = (action.args ?? "[]").replace(ACTION_TOKENS.ownAnalysis, ownAnalysisId(owner.id)).replace(ACTION_TOKENS.ownScenario, ownScenarioId(owner.id));
  const pagePath = pagePathFor(built.workers);
  const cookie = cookies.get(state);
  const response = await fetch(new URL(pagePath, base), {
    method: "POST",
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      "next-action": built.id,
      "content-type": "text/plain;charset=UTF-8",
      accept: "text/x-component",
      origin: base,
    },
    body: args,
    signal: AbortSignal.timeout(90_000),
  });
  if (response.status >= 300 && response.status < 400) {
    const next = new URL(response.headers.get("location") ?? "/", base);
    return { outcome: gateFor(next.pathname) ?? "ok", status: response.status, finalPath: next.pathname };
  }
  if (response.status >= 500 || response.status === 401 || response.status === 403) {
    return { outcome: outcomeFor(response.status), status: response.status, finalPath: pagePath };
  }
  // The flight answer: row 0 points at the result ("a":"$@1"); row 1 is the result.
  const text = await response.text();
  const row = /^1:(.*)$/m.exec(text);
  let value: unknown = null;
  try { value = row ? JSON.parse(row[1]) : null; } catch { value = row?.[1] ?? null; }
  return { outcome: isRefusedActionResult(value) ? "denied" : "ok", status: response.status, finalPath: pagePath };
}

/** Runs async work over items with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

test.beforeAll(async () => {
  const db = connectFixtureDb();
  try {
    await seed(db);
  } finally {
    await db.end();
  }
});

test.afterAll(() => {
  mkdirSync(outDir, { recursive: true });
  const lines = [
    `# Hamilton access by billing state (#1920)`,
    "",
    `Observed ${new Date().toISOString()} against ${base}. Cell: outcome, then the last HTTP status (a redirect's status when it landed on a gate).`,
    "A cell marked **MISMATCH** differs from the intended outcome in tests/e2e/hamilton/billing-access.ts.",
    "",
    `| Route | Gate | ${BILLING_STATES.join(" | ")} |`,
    `| --- | --- | ${BILLING_STATES.map(() => "---").join(" | ")} |`,
  ];
  const json: Record<string, Record<string, Cell & { expected: Outcome }>> = {};
  const byState = new Map<BillingState, Record<string, Cell>>();
  for (const state of BILLING_STATES) {
    if (existsSync(cellsFile(state))) byState.set(state, JSON.parse(readFileSync(cellsFile(state), "utf8")));
  }
  for (const entry of ROUTES) {
    for (const probe of entry.probes) {
      json[probeKey(probe)] = {};
      const row = BILLING_STATES.map((state) => {
        const cell = byState.get(state)?.[probeKey(probe)];
        if (!cell) return "not run";
        const expected = expectedOutcome(entry, probe, state);
        json[probeKey(probe)][state] = { ...cell, expected };
        const mismatch = cell.outcome !== expected || (probe.status !== undefined && cell.status !== probe.status);
        return `${cell.outcome} ${cell.status}${mismatch ? ` **MISMATCH** (want ${expected}${probe.status ? ` ${probe.status}` : ""})` : ""}`;
      });
      lines.push(`| \`${probeKey(probe)}\`${probe.note ? ` (${probe.note})` : ""} | ${entry.kind} | ${row.join(" | ")} |`);
    }
  }
  lines.push("", "Server actions (POSTed with their action id to a page that loads them; ok = the account's own data came back, denied = nothing came back):", "",
    `| Action | Gate | ${BILLING_STATES.join(" | ")} |`, `| --- | --- | ${BILLING_STATES.map(() => "---").join(" | ")} |`);
  for (const action of ACTIONS.filter((a) => a.kind === "premium")) {
    const row = BILLING_STATES.map((state) => {
      const cell = byState.get(state)?.[actionKey(action)];
      if (!cell) return "not run";
      const expected = EXPECTED.pro_export[state];
      return `${cell.outcome} ${cell.status}${cell.outcome !== expected ? ` **MISMATCH** (want ${expected})` : ""}`;
    });
    lines.push(`| \`${action.file}#${action.name}\` | premium | ${row.join(" | ")} |`);
  }
  lines.push("", "Not sent: " + ACTIONS.filter((a) => a.kind !== "premium").map((a) => `\`${a.name}\` (${a.kind === "server_only" ? "server-only; " : a.kind === "route_only" ? "route-only; " : ""}${a.reason})`).join(", ") + ".");
  writeFileSync(path.join(outDir, "matrix.md"), `${lines.join("\n")}\n`);
  writeFileSync(path.join(outDir, "matrix.json"), `${JSON.stringify(json, null, 2)}\n`);
});

for (const state of BILLING_STATES) {
  test(`G10 #1920: ${state} reaches exactly what its billing state allows`, async () => {
    test.setTimeout(900_000);
    const jobs: Array<{ entry: RouteEntry; probe: Probe }> = ROUTES.flatMap((entry) => entry.probes.map((probe) => ({ entry, probe })));
    const cells: Record<string, Cell> = {};
    await pool(jobs, 4, async ({ probe }) => {
      cells[probeKey(probe)] = await send(probe, state);
    });
    const built = builtActions();
    const actions = ACTIONS.filter((a) => a.kind === "premium");
    await pool(actions, 4, async (action) => {
      const entry = built.get(`src/app/${action.file}#${action.name}`);
      cells[actionKey(action)] = entry
        ? await callAction(action, entry, state)
        : { outcome: "error", status: 0, finalPath: "no action id in the build" };
    });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(cellsFile(state), JSON.stringify(cells));
    for (const { entry, probe } of jobs) {
      const cell = cells[probeKey(probe)];
      const expected = expectedOutcome(entry, probe, state);
      const where = `${probeKey(probe)} as ${state} (${entry.label}; landed on ${cell.finalPath}, HTTP ${cell.status})`;
      expect.soft(cell.outcome, where).toBe(expected);
      if (probe.status !== undefined) expect.soft(cell.status, `${where}: a token link answers the same for every state`).toBe(probe.status);
    }
    for (const action of actions) {
      const cell = cells[actionKey(action)];
      expect.soft(cell.outcome, `${actionKey(action)} as ${state} (posted to ${cell.finalPath}, HTTP ${cell.status})`).toBe(EXPECTED.pro_export[state]);
    }
  });
}

test("G10 #1920: every server action under src/app/pro in the build is classified", () => {
  const built = builtActions();
  const listed = new Map(ACTIONS.map((a) => [`src/app/${a.file}#${a.name}`, a]));
  const unlisted = [...built.keys()].filter((key) => key.startsWith("src/app/pro/") && !listed.has(key));
  expect(unlisted, "server actions with no entry in billing-access.ts ACTIONS").toEqual([]);
  const gainedId = ACTIONS.filter((a) => a.kind === "server_only" && built.has(`src/app/${a.file}#${a.name}`)).map((a) => a.name);
  expect(gainedId, "server_only actions that the browser can now call: classify and send them").toEqual([]);
  const onPage = ACTIONS.filter((a) => a.kind === "route_only" && (built.get(`src/app/${a.file}#${a.name}`)?.workers ?? []).some((w) => !w.startsWith("app/api/")))
    .map((a) => a.name);
  expect(onPage, "route_only actions a page now loads, so the browser can call them: send them").toEqual([]);
  const missing = ACTIONS.filter((a) => a.kind !== "server_only" && !built.has(`src/app/${a.file}#${a.name}`)).map((a) => a.name);
  expect(missing, "actions listed as callable that the build has no id for").toEqual([]);
});
