/**
 * #1920 (go-live gate G10, billing and access): what each billing state may reach in Hamilton.
 *
 * Four explicit tables, read by two tests:
 * - ACCOUNTS: one synthetic account per billing state, with the users row the Stripe webhook
 *   would leave (`mapSubscriptionStatus` and `reconcileSubscription` in
 *   src/lib/billing/subscription-state.ts) and what the access rules say about it
 *   (`canAccessPremium`, `isPaymentLapsed` in src/lib/access.ts).
 * - EXPECTED: for each kind of gate, the outcome each state should get. Written out by hand.
 * - ROUTES: every page and route handler under HAMILTON_ROUTE_ROOTS, by file, with its gate kind
 *   and the requests the journey sends. A new file under those folders that is not listed here
 *   fails billing-access.test.ts.
 * - ACTIONS: every exported server action under src/app/pro, sent or not, with what it checks.
 *
 * billing-access.test.ts (Vitest, no database; runs in the CI unit job) checks the tables against
 * the rules in code and the filesystem. billing-access.pw.ts (local, against the production build
 * that serve.mjs starts) sends every request as every account and checks the result.
 *
 * This module imports nothing from src/, so the Playwright runner loads it without the app.
 */
import { createHmac } from "node:crypto";

/** A billing state the journey signs in as. `anonymous` sends no session. */
export type BillingState =
  | "anonymous"
  | "paid"
  | "trialing"
  | "free"
  | "past_due_grace"
  | "past_due_unknown_start"
  | "past_due_lapsed"
  | "expired"
  | "cancelled"
  | "seat_owner_paid"
  | "seat_owner_lapsed"
  | "analyst"
  | "admin";

export const BILLING_STATES: BillingState[] = [
  "anonymous", "paid", "trialing", "free", "past_due_grace", "past_due_unknown_start", "past_due_lapsed",
  "expired", "cancelled", "seat_owner_paid", "seat_owner_lapsed", "analyst", "admin",
];

/** Reserved ids inside the shared fixture range (9_701_000-9_709_999), so global teardown removes them. */
export const ACCESS_ID_MIN = 9_708_000;
export const ACCESS_ID_MAX = 9_708_999;
/** Synthetic workspaces for the two seat accounts (demo-cast names). */
export const SEAT_WORKSPACES = {
  paidOwner: { id: 9_708_001, name: "Harbor Point Test Bank (access fixture)", owner: "paid" as BillingState },
  lapsedOwner: { id: 9_708_002, name: "Ridgeline Test Bank (access fixture)", owner: "past_due_lapsed" as BillingState },
};

export interface AccessAccount {
  state: Exclude<BillingState, "anonymous">;
  id: number;
  email: string;
  /** What Stripe reports for this account's subscription; null when there is none. */
  stripeStatus: string | null;
  /** The users row the webhook leaves for that Stripe status. */
  role: "viewer" | "premium" | "analyst" | "admin";
  subscriptionStatus: "none" | "active" | "past_due" | "canceled";
  /** Days since the subscription went past due; null leaves past_due_since empty. */
  pastDueDays: number | null;
  /** Active member (not owner) of this workspace. */
  seatIn?: keyof typeof SEAT_WORKSPACES;
  /** What src/lib/access.ts says. billing-access.test.ts checks both against the real functions. */
  premium: boolean;
  lapsed: boolean;
}

const account = (state: AccessAccount["state"], n: number, rest: Omit<AccessAccount, "state" | "id" | "email">): AccessAccount => ({
  state, id: ACCESS_ID_MIN + 100 + n, email: `access.${state.replace(/_/g, "-")}@fixture.test`, ...rest,
});

/** One synthetic account per billing state. */
export const ACCOUNTS: AccessAccount[] = [
  account("paid", 1, { stripeStatus: "active", role: "premium", subscriptionStatus: "active", pastDueDays: null, premium: true, lapsed: false }),
  // Stripe "trialing" is stored as active: a trial is paid-for access.
  account("trialing", 2, { stripeStatus: "trialing", role: "premium", subscriptionStatus: "active", pastDueDays: null, premium: true, lapsed: false }),
  // A free (unpaid) account: signed up, never subscribed.
  account("free", 3, { stripeStatus: null, role: "viewer", subscriptionStatus: "none", pastDueDays: null, premium: false, lapsed: false }),
  // Card failed two days ago: inside the 7-day grace window.
  account("past_due_grace", 4, { stripeStatus: "past_due", role: "premium", subscriptionStatus: "past_due", pastDueDays: 2, premium: true, lapsed: false }),
  // Past due with no recorded start (set before the column existed): treated as in grace.
  account("past_due_unknown_start", 5, { stripeStatus: "past_due", role: "premium", subscriptionStatus: "past_due", pastDueDays: null, premium: true, lapsed: false }),
  // Card failed ten days ago: grace is over.
  account("past_due_lapsed", 6, { stripeStatus: "past_due", role: "premium", subscriptionStatus: "past_due", pastDueDays: 10, premium: false, lapsed: true }),
  // Checkout never completed (Stripe incomplete_expired): stored as canceled, role back to viewer.
  account("expired", 7, { stripeStatus: "incomplete_expired", role: "viewer", subscriptionStatus: "canceled", pastDueDays: null, premium: false, lapsed: false }),
  account("cancelled", 8, { stripeStatus: "canceled", role: "viewer", subscriptionStatus: "canceled", pastDueDays: null, premium: false, lapsed: false }),
  // A team member on a paid institution account (no subscription of their own).
  account("seat_owner_paid", 9, { stripeStatus: null, role: "viewer", subscriptionStatus: "none", pastDueDays: null, seatIn: "paidOwner", premium: true, lapsed: false }),
  // A team member whose account owner is past due beyond grace.
  account("seat_owner_lapsed", 10, { stripeStatus: null, role: "viewer", subscriptionStatus: "none", pastDueDays: null, seatIn: "lapsedOwner", premium: false, lapsed: false }),
  account("analyst", 11, { stripeStatus: null, role: "analyst", subscriptionStatus: "none", pastDueDays: null, premium: true, lapsed: false }),
  account("admin", 12, { stripeStatus: null, role: "admin", subscriptionStatus: "none", pastDueDays: null, premium: true, lapsed: false }),
];

/**
 * What the journey sees for one request, after following redirects (3xx and Next's streamed
 * meta refresh) up to five hops:
 * - login: sent to /login. subscribe: sent to /subscribe. billing: sent to /account/billing-issue.
 *   team_billing: sent to /account/team-billing (a seat whose team owner's payment lapsed, #1999).
 * - denied: 401 or 403. unavailable: 503. error: any other 5xx.
 * - ok: anything else (2xx, or a 4xx such as 400 for the deliberately empty body, 404, 409):
 *   the request got past every access check.
 * - locked: a 200 page that rendered the upgrade gate (`data-upgrade-gate`, src/components/upgrade-gate.tsx)
 *   in place of its premium section. Only probes with `lockedMarker` read it.
 */
export type Outcome = "login" | "subscribe" | "billing" | "team_billing" | "denied" | "unavailable" | "error" | "ok" | "locked";

/** The kinds of gate the routes use. */
export type GateKind =
  /** A Hamilton page: /pro layouts (src/app/pro/layout.tsx, (hamilton)/layout.tsx) and src/proxy.ts. */
  | "pro_page"
  /** A Hamilton API: `!user || !canAccessPremium(user)` -> 401/403. */
  | "premium_api"
  /**
   * The streamed Ask: the same premium gate, then (no provider key on the local server) a 503.
   * A 503 therefore means the request got past the gate; a 401/403 means it did not.
   */
  | "premium_api_provider_after_gate"
  /** A premium route handler under /pro: src/proxy.ts sends a visitor with no session to /login first. */
  | "pro_export"
  /** Staff-only Hamilton chat memory: role analyst or admin. */
  | "staff_api"
  /** Staff-only Hamilton chat, which answers 503 before any access check when no provider key is set. */
  | "staff_api_provider_first"
  /** Admin-only job trigger (hasPermission trigger_jobs). */
  | "admin_api"
  /** Any signed-in account; the route then checks the account owns the record. */
  | "session_api"
  /** Account pages: any signed-in account. */
  | "account_page"
  /** /account/team-billing: renders for a lapsed team's seat; sends everyone else where /pro would. */
  | "team_billing_page"
  /** The report-job callback: a server secret, never a session. */
  | "internal_secret"
  /** A link whose token is the access: the same answer for every state. */
  | "token_link"
  /**
   * A public page outside the Hamilton folders whose premium section only Hamilton access opens
   * (V5 T6): it renders for everyone, and everyone without access gets the upgrade gate instead.
   */
  | "premium_section"
  /** Open to everyone. */
  | "public";

const row = (
  anonymous: Outcome, paid: Outcome, trialing: Outcome, free: Outcome, past_due_grace: Outcome, past_due_unknown_start: Outcome,
  past_due_lapsed: Outcome, expired: Outcome, cancelled: Outcome, seat_owner_paid: Outcome, seat_owner_lapsed: Outcome,
  analyst: Outcome, admin: Outcome,
): Record<BillingState, Outcome> => ({
  anonymous, paid, trialing, free, past_due_grace, past_due_unknown_start, past_due_lapsed, expired, cancelled,
  seat_owner_paid, seat_owner_lapsed, analyst, admin,
});

/**
 * The intended outcome for each gate kind and state, written out. Columns, in order:
 * anonymous, paid, trialing, free, past_due_grace, past_due_unknown_start, past_due_lapsed,
 * expired, cancelled, seat_owner_paid, seat_owner_lapsed, analyst, admin.
 * `token_link` is not here: its probes name their own status, the same for every state.
 */
export const EXPECTED: Record<Exclude<GateKind, "token_link">, Record<BillingState, Outcome>> = {
  //                         anon      paid  trial  free         grace unknown lapsed     expired      cancelled    seatPaid seatLapsed   analyst admin
  pro_page:             row("login",  "ok", "ok", "subscribe", "ok", "ok",   "billing", "subscribe", "subscribe", "ok",    "team_billing", "ok", "ok"),
  premium_api:          row("denied", "ok", "ok", "denied",    "ok", "ok",   "denied",  "denied",    "denied",    "ok",    "denied",    "ok",   "ok"),
  premium_api_provider_after_gate:
                        row("denied", "unavailable", "unavailable", "denied", "unavailable", "unavailable", "denied", "denied", "denied",
                            "unavailable", "denied", "unavailable", "unavailable"),
  pro_export:           row("login",  "ok", "ok", "denied",    "ok", "ok",   "denied",  "denied",    "denied",    "ok",    "denied",    "ok",   "ok"),
  staff_api:            row("denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "ok", "ok"),
  // No provider key on the local server: the route answers 503 first, so the gate cannot be seen here.
  staff_api_provider_first: row("unavailable", "unavailable", "unavailable", "unavailable", "unavailable", "unavailable", "unavailable",
                            "unavailable", "unavailable", "unavailable", "unavailable", "unavailable", "unavailable"),
  admin_api:            row("denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "ok"),
  session_api:          row("denied", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"),
  account_page:         row("login",  "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"),
  team_billing_page:    row("login",  "ok", "ok", "subscribe", "ok", "ok",   "billing", "subscribe", "subscribe", "ok",    "ok",        "ok",   "ok"),
  internal_secret:      row("denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied", "denied"),
  premium_section:      row("locked", "ok", "ok", "locked",    "ok", "ok",   "locked",  "locked",    "locked",    "ok",    "locked",    "ok",   "ok"),
  public:               row("ok",     "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"),
};

/** Placeholders the journey substitutes in a probe path. */
export const TOKENS = {
  /** A signed /market-report link for the fixture home institution (serve.mjs sets the secret). */
  marketReport: "{marketReportToken}",
  /** The report job the signed-in account owns (anonymous gets the paid account's). */
  ownJob: "{ownReportJobId}",
} as const;

export interface Probe {
  method: "GET" | "POST" | "PATCH";
  path: string;
  /** Raw request body; the bodies are deliberately invalid, so an allowed request stops at a 400. */
  body?: string;
  contentType?: string;
  /** token_link only: the status every state must get. */
  status?: number;
  /** premium_section only: a 200 whose HTML contains this is "locked" rather than "ok". */
  lockedMarker?: string;
  note?: string;
}

export interface RouteEntry {
  /** Path under src/app. */
  file: string;
  kind: GateKind;
  /** What the route is, in a few words. */
  label: string;
  probes: Probe[];
}

/** Folders under src/app whose pages and route handlers serve Hamilton, its exports and its report links. */
export const HAMILTON_ROUTE_ROOTS = [
  "pro", "api/hamilton", "api/pro", "api/research", "api/reports", "market-report", "r", "pay", "account",
];

const NOT_JSON = "not json";
const json = (method: "POST" | "PATCH", path: string, note?: string): Probe => ({ method, path, body: NOT_JSON, contentType: "application/json", note });
const get = (path: string, extra: Partial<Probe> = {}): Probe => ({ method: "GET", path, ...extra });
const page = (file: string, path: string, label: string): RouteEntry => ({ file, kind: "pro_page", label, probes: [get(path)] });

export const ROUTES: RouteEntry[] = [
  // Hamilton pages.
  page("pro/page.tsx", "/pro", "Hamilton entry (redirects to /pro/hamilton)"),
  page("pro/reports/new/page.tsx", "/pro/reports/new", "Old new-report address (redirects to Reports)"),
  page("pro/(hamilton)/hamilton/page.tsx", "/pro/hamilton", "Hamilton home"),
  page("pro/(hamilton)/analyze/page.tsx", "/pro/analyze", "Ask (analyze)"),
  page("pro/(hamilton)/research/page.tsx", "/pro/research", "Research (redirects to Ask)"),
  page("pro/(hamilton)/categories/page.tsx", "/pro/categories", "Fee categories"),
  page("pro/(hamilton)/data/page.tsx", "/pro/data", "Data"),
  page("pro/(hamilton)/districts/page.tsx", "/pro/districts", "Districts"),
  page("pro/(hamilton)/financials/page.tsx", "/pro/financials", "Financial performance"),
  page("pro/(hamilton)/intelligence/page.tsx", "/pro/intelligence", "Intelligence"),
  page("pro/(hamilton)/market/page.tsx", "/pro/market", "Market"),
  page("pro/(hamilton)/peers/page.tsx", "/pro/peers", "Peer group"),
  page("pro/(hamilton)/monitor/page.tsx", "/pro/monitor", "Monitor"),
  page("pro/(hamilton)/monitor/deliverable/page.tsx", "/pro/monitor/deliverable", "Monitor deliverable"),
  page("pro/(hamilton)/news/page.tsx", "/pro/news", "News"),
  page("pro/(hamilton)/news/digest/page.tsx", "/pro/news/digest", "News digest"),
  page("pro/(hamilton)/peer-research/[id]/page.tsx", "/pro/peer-research/00000000-0000-4000-8000-000009708999", "Saved peer research (unknown id)"),
  page("pro/(hamilton)/reports/page.tsx", "/pro/reports", "Reports"),
  page("pro/(hamilton)/reports/committee/page.tsx", "/pro/reports/committee", "Pricing committee brief"),
  page("pro/(hamilton)/reports/monthly/page.tsx", "/pro/reports/monthly", "Monthly briefing"),
  page("pro/(hamilton)/saved/page.tsx", "/pro/saved", "Saved answers"),
  page("pro/(hamilton)/settings/page.tsx", "/pro/settings", "Settings"),
  page("pro/(hamilton)/simulate/page.tsx", "/pro/simulate", "Simulate"),
  page("pro/(hamilton)/simulate/plan/page.tsx", "/pro/simulate/plan", "Simulate plan"),
  page("pro/(hamilton)/studies/market/page.tsx", "/pro/studies/market", "Market study"),
  page("pro/(hamilton)/studies/merger/page.tsx", "/pro/studies/merger", "Merger study"),
  // Hamilton route handlers under /pro: an export and two old addresses that redirect to Reports.
  { file: "pro/(hamilton)/research/peers/route.ts", kind: "pro_export", label: "Peer list CSV export", probes: [get("/pro/research/peers")] },
  { file: "pro/brief/route.ts", kind: "pro_page", label: "Old brief address (307 to Reports)", probes: [get("/pro/brief")] },
  { file: "pro/brief/preview/route.ts", kind: "pro_page", label: "Old brief preview (307 to Reports)", probes: [get("/pro/brief/preview")] },

  // Ask and the other Hamilton APIs.
  { file: "api/research/hamilton/route.ts", kind: "premium_api_provider_after_gate", label: "Ask (streamed research answer)", probes: [json("POST", "/api/research/hamilton")] },
  { file: "api/hamilton/ask/route.ts", kind: "premium_api", label: "Ask (structured: peers, fees)", probes: [json("POST", "/api/hamilton/ask")] },
  { file: "api/hamilton/ask/market/route.ts", kind: "premium_api", label: "Ask (branch market)", probes: [json("POST", "/api/hamilton/ask/market")] },
  { file: "api/hamilton/ask/memo/route.ts", kind: "premium_api", label: "Ask (memo)", probes: [json("POST", "/api/hamilton/ask/memo")] },
  { file: "api/hamilton/decisions/route.ts", kind: "premium_api", label: "Decision log", probes: [get("/api/hamilton/decisions")] },
  { file: "api/hamilton/simulate/route.ts", kind: "premium_api", label: "Simulate", probes: [json("POST", "/api/hamilton/simulate")] },
  { file: "api/hamilton/uploads/route.ts", kind: "premium_api", label: "Upload a fee file", probes: [json("POST", "/api/hamilton/uploads")] },
  { file: "api/hamilton/uploads/apply/route.ts", kind: "premium_api", label: "Apply an uploaded file", probes: [json("POST", "/api/hamilton/uploads/apply")] },
  { file: "api/hamilton/chat/route.ts", kind: "staff_api_provider_first", label: "Staff chat", probes: [json("POST", "/api/hamilton/chat")] },
  { file: "api/hamilton/conversations/route.ts", kind: "staff_api", label: "Staff chat conversations", probes: [get("/api/hamilton/conversations"), { method: "POST", path: "/api/hamilton/conversations" }] },
  { file: "api/hamilton/conversations/[id]/messages/route.ts", kind: "staff_api", label: "Staff chat messages", probes: [get("/api/hamilton/conversations/00000000-0000-4000-8000-000009708998/messages")] },

  // Exports and report jobs.
  { file: "api/pro/report-pdf/route.ts", kind: "premium_api", label: "PDF export of a saved answer or report", probes: [json("POST", "/api/pro/report-pdf")] },
  { file: "api/reports/peer-brief/confirm/route.ts", kind: "premium_api", label: "Peer brief confirm", probes: [get("/api/reports/peer-brief/confirm")] },
  { file: "api/reports/[id]/status/route.ts", kind: "session_api", label: "Report job status (owner)", probes: [get(`/api/reports/${TOKENS.ownJob}/status`)] },
  { file: "api/reports/[id]/download/route.ts", kind: "session_api", label: "Report job download (owner; pending job answers 409)", probes: [get(`/api/reports/${TOKENS.ownJob}/download`)] },
  // The PATCH half of the status route is the renderer's callback (REPORT_INTERNAL_SECRET).
  { file: "api/reports/[id]/status/route.ts#PATCH", kind: "internal_secret", label: "Report job callback", probes: [json("PATCH", `/api/reports/${TOKENS.ownJob}/status`)] },
  { file: "api/reports/generate/route.ts", kind: "admin_api", label: "Queue a report job", probes: [json("POST", "/api/reports/generate")] },
  { file: "api/reports/catalog/route.ts", kind: "public", label: "Public report catalog", probes: [get("/api/reports/catalog")] },
    // Not sent: public lead capture, limited to 8 posts per visitor per 10 minutes (rate-limit.ts).
  { file: "api/reports/email-gate/route.ts", kind: "public", label: "Sample report email gate (lead capture; not sent)", probes: [] },

  // Report links: the token is the access.
  { file: "market-report/[token]/page.tsx", kind: "token_link", label: "Market report link", probes: [
    // The signature passes; the fixture home has no branch market, so the page is not found.
    get(`/market-report/${TOKENS.marketReport}`, { status: 404, note: "signed; no market on file" }),
    get("/market-report/9708000-20260101-000000000000000000000000", { status: 404, note: "bad signature" }),
  ] },
  { file: "market-report/[token]/csv/route.ts", kind: "token_link", label: "Market report CSV", probes: [
    get(`/market-report/${TOKENS.marketReport}/csv`, { status: 404, note: "signed; no market on file" }),
    get("/market-report/9708000-20260101-000000000000000000000000/csv", { status: 404, note: "bad signature" }),
  ] },
  { file: "r/[token]/page.tsx", kind: "token_link", label: "Hosted report link", probes: [get("/r/0000000000000000", { status: 404, note: "unknown token" })] },
  { file: "r/[token]/print/route.ts", kind: "token_link", label: "Hosted report print/PDF", probes: [get("/r/0000000000000000/print", { status: 404, note: "unknown token" })] },
  { file: "pay/report/[token]/page.tsx", kind: "token_link", label: "Report pay link", probes: [get("/pay/report/0000000000000000", { status: 404, note: "unknown token" })] },

  // Account pages around billing.
  { file: "account/page.tsx", kind: "account_page", label: "Account", probes: [get("/account")] },
  { file: "account/welcome/page.tsx", kind: "account_page", label: "Welcome after checkout", probes: [get("/account/welcome")] },
  { file: "account/billing-issue/page.tsx", kind: "account_page", label: "Payment issue (Pro accounts are sent on to Hamilton)", probes: [get("/account/billing-issue")] },
  { file: "account/team-billing/page.tsx", kind: "team_billing_page", label: "Team subscription needs attention (#1999)", probes: [get("/account/team-billing")] },
  { file: "account/reports/page.tsx", kind: "account_page", label: "Your reports, read-only for any signed-in account (#1999)", probes: [get("/account/reports")] },
];

/** The upgrade gate's own attribute (src/components/upgrade-gate.tsx). */
export const UPGRADE_GATE_MARKER = "data-upgrade-gate";

/**
 * Pages outside HAMILTON_ROUTE_ROOTS that check canAccessPremium (V5 T6). Each is either probed
 * here (its premium section must be locked for every state without Hamilton access) or listed in
 * PREMIUM_CHECK_EXEMPT with the reason it is not a premium section. billing-access.test.ts fails
 * on a page that is in neither.
 */
const section = (file: string, path: string, label: string): RouteEntry => ({
  file, kind: "premium_section", label, probes: [get(path, { lockedMarker: UPGRADE_GATE_MARKER })],
});
export const PREMIUM_SECTION_PAGES: RouteEntry[] = [
  section("(public)/research/market-concentration/page.tsx", "/research/market-concentration", "Market concentration research"),
  section("(public)/research/fee-revenue-analysis/page.tsx", "/research/fee-revenue-analysis", "Fee-to-revenue research"),
  section("(public)/guides/pro/[slug]/page.tsx", "/guides/pro/building-a-peer-set", "Professional guide"),
];

/** Pages outside the Hamilton folders that call canAccessPremium for a reason other than a premium section. */
export const PREMIUM_CHECK_EXEMPT: Record<string, string> = {
  "subscribe/page.tsx": "routes a paying account on to Hamilton; shows no premium data",
  "workspace-invite/page.tsx": "accepting an invitation; grants a seat, shows no premium data",
  "(public)/fees/[category]/page.tsx":
    "the asset-size and state breakdown and per-institution tier/state are Pro only; explorerPoints(points, isPro) is unit-tested in category-view.test.ts",
};

/** Every probed entry: the Hamilton folders plus the premium sections outside them. */
export const ALL_ROUTES: RouteEntry[] = [...ROUTES, ...PREMIUM_SECTION_PAGES];

/** The outcome a probe must get for a state. */
export function expectedOutcome(entry: RouteEntry, probe: Probe, state: BillingState): Outcome {
  if (entry.kind === "token_link") {
    const status = probe.status ?? 200;
    return status === 401 || status === 403 ? "denied" : status >= 500 ? "error" : "ok";
  }
  return EXPECTED[entry.kind][state];
}

/** `src/app` file path -> the HTTP methods its route handler exports (route.ts only). */
export function exportedMethods(source: string): string[] {
  const found = new Set<string>();
  const re = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  for (let m = re.exec(source); m; m = re.exec(source)) found.add(m[1]);
  return [...found].sort();
}

/** The secrets serve.mjs gives the local server. They sign nothing anywhere else. */
export const E2E_COOKIE_SECRET = "hamilton-e2e-local-cookie-secret";
export const E2E_REPORT_LINK_SECRET = "hamilton-e2e-local-report-link-secret";

/** The `fsh_session` cookie value for a session id, signed as src/lib/session-cookie.ts does. */
export function signedSessionCookie(sessionId: string, secret = E2E_COOKIE_SECRET): string {
  return `${sessionId}.${createHmac("sha256", secret).update(sessionId).digest("hex")}`;
}

/** A /market-report token, signed as createReportToken in src/lib/custom-report/link.ts does. */
export function reportLinkToken(institutionId: number, now: Date = new Date(), secret = E2E_REPORT_LINK_SECRET): string {
  const issued = now.toISOString().slice(0, 10).replace(/-/g, "");
  const sig = createHmac("sha256", secret).update(`custom-report:${institutionId}:${issued}`).digest("hex").slice(0, 24);
  return `${institutionId}-${issued}-${sig}`;
}

/**
 * Server actions under src/app/pro. A server action is called by POSTing its id (from
 * .next/server/server-reference-manifest.json) to a page, and it runs without the /pro layouts,
 * so each action must check access itself. The journey sends the read actions as every account
 * (each account owns one saved answer and one scenario) and expects what `pro_export` expects:
 * a visitor with no session is sent to /login by src/proxy.ts; an account with Hamilton access
 * gets its own data back ("ok"); every other account gets nothing ("denied": null, [], an error
 * result, or an empty snapshot). Actions that write, fetch other sites or call a provider are
 * listed with the check they make, but not sent.
 */
export const ACTION_TOKENS = {
  ownAnalysis: "{ownAnalysisId}",
  ownScenario: "{ownScenarioId}",
} as const;

/** The saved answer and scenario the journey seeds for an account. */
export const ownAnalysisId = (accountId: number) => `00000000-0000-4000-8000-${String(accountId).padStart(12, "0")}`;
export const ownScenarioId = (accountId: number) => `00000000-0000-4000-8001-${String(accountId).padStart(12, "0")}`;

export interface ActionEntry {
  /** Path under src/app. */
  file: string;
  name: string;
  /**
   * "premium": sent; expects EXPECTED.pro_export. "not_sent": callable, but the reason says why it
   * is not sent and what the code checks. "server_only": no client code imports it, so the build
   * has no action id for it and it cannot be called over HTTP; the journey fails if it gains one.
   * "route_only": the build has an id for it, but its only workers are API routes, which run their
   * own handler (probed as a route) and never the action; the journey fails if a page loads it.
   */
  kind: "premium" | "not_sent" | "server_only" | "route_only";
  /** JSON array of arguments, with ACTION_TOKENS placeholders. */
  args?: string;
  reason?: string;
}

const A = "pro/(hamilton)";
const notSent = (file: string, name: string, reason: string): ActionEntry => ({ file: `${A}/${file}`, name, kind: "not_sent", reason });
const routeOnly = (file: string, name: string, reason: string): ActionEntry => ({ file: `${A}/${file}`, name, kind: "route_only", reason });
const sent = (file: string, name: string, args = "[]"): ActionEntry => ({ file: `${A}/${file}`, name, kind: "premium", args });

export const ACTIONS: ActionEntry[] = [
  sent("analyze/actions.ts", "listSavedAnalyses"),
  sent("analyze/actions.ts", "loadAnalysisRecord", `["${ACTION_TOKENS.ownAnalysis}"]`),
  sent("analyze/actions.ts", "loadAnalysis", `["${ACTION_TOKENS.ownAnalysis}"]`),
  notSent("analyze/actions.ts", "saveAnalysis", "writes; checks canAccessPremium"),
  notSent("analyze/answer-actions.ts", "addAnswerToDecision", "writes; checks canAccessPremium"),
  sent("analyze/conversation-actions.ts", "startAnalyzeConversationAction"),
  notSent("analyze/conversation-actions.ts", "recordAnalyzeConversationAction", "writes; checks canAccessPremium"),
  sent("reports/actions.ts", "loadActiveScenarios"),
  sent("reports/actions.ts", "loadScenarioById", `["${ACTION_TOKENS.ownScenario}"]`),
  routeOnly("reports/actions.ts", "loadRecentReports", "loaded only by the /api/pro/report-pdf route, probed above; checks canAccessPremium"),
  routeOnly("reports/actions.ts", "loadReport", "loaded only by the /api/pro/report-pdf route, probed above; checks canAccessPremium"),
  notSent("reports/actions.ts", "previewReportPeerCoverage", "needs a report draft; checks canAccessPremium"),
  notSent("reports/actions.ts", "generateReport", "may call a provider; checks canAccessPremium"),
  routeOnly("reports/actions.ts", "loadPublishedReport", "loaded only by the /api/pro/report-pdf route, probed above; checks canAccessPremium"),
  routeOnly("reports/actions.ts", "saveLandingResearchReport", "writes; loaded only by the /api/pro/report-pdf route, probed above; checks canAccessPremium"),
  notSent("reports/board-actions.ts", "saveBoardBrief", "writes; checks canAccessPremium"),
  notSent("reports/board-actions.ts", "createMarketBoardBrief", "writes; checks canAccessPremium"),
  notSent("reports/monthly/actions.ts", "createMonthlyBriefing", "writes; checks canAccessPremium via redirectWithoutPremium and reportStartError"),
  notSent("reports/monthly/actions.ts", "saveMonthlyBriefing", "writes; checks canAccessPremium via reportStartError"),
  routeOnly("simulate/actions.ts", "listScenarios", "loaded only by the /api/hamilton/simulate route, probed above; checks canAccessPremium"),
  routeOnly("simulate/actions.ts", "getScenario", "loaded only by the /api/hamilton/simulate route, probed above; checks canAccessPremium"),
  routeOnly("simulate/actions.ts", "getDistributionForCategory", "loaded only by the /api/hamilton/simulate route, probed above; checks canAccessPremium"),
  routeOnly("simulate/actions.ts", "getInstitutionFee", "loaded only by the /api/hamilton/simulate route, probed above; checks canAccessPremium"),
  routeOnly("simulate/actions.ts", "getSimulationCategories", "loaded only by the /api/hamilton/simulate route, probed above; checks canAccessPremium"),
  routeOnly("simulate/actions.ts", "saveScenario", "writes; loaded only by the /api/hamilton/simulate route, probed above; checks canAccessPremium"),
  sent("settings/actions.ts", "getIntelligenceSnapshot"),
  notSent("settings/actions.ts", "updateWorkspaceInstitution", "writes; checks canAccessPremium"),
  notSent("settings/actions.ts", "grantWorkspaceAccess", "writes; checks canAccessPremium"),
  notSent("settings/actions.ts", "revokeWorkspaceAccess", "writes; checks canAccessPremium"),
  notSent("settings/actions.ts", "revokeWorkspaceInvitation", "writes; checks canAccessPremium"),
  notSent("settings/actions.ts", "createPeerSet", "writes; checks canAccessPremium"),
  notSent("settings/actions.ts", "editPeerSet", "writes; checks canAccessPremium"),
  notSent("settings/actions.ts", "setPeerSetForAllCharts", "writes; checks canAccessPremium"),
  notSent("settings/actions.ts", "removePeerSet", "writes; checks canAccessPremium"),
  notSent("monitor/actions.ts", "addToWatchlist", "writes; checks canAccessPremium"),
  notSent("monitor/actions.ts", "removeFromWatchlist", "writes; checks canAccessPremium"),
  notSent("news/watch-actions.ts", "setWatchedState", "writes; checks canAccessPremium"),
  notSent("news/watch-actions.ts", "watchStateFormAction", "writes; checks canAccessPremium"),
  notSent("news/actions.ts", "refreshFeeds", "queues a registry run; admin or analyst only"),
  notSent("view-as-actions.ts", "setViewAsCustomer", "sets a cookie; admin or analyst only"),
];

/** True when an action's result is "nothing for you": null, [], an error result or an empty snapshot. */
export function isRefusedActionResult(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return "error" in v || v.success === false || v.ok === false || v.tier === "Unknown";
}

/** Exported function names in a "use server" file. */
export function exportedServerActions(source: string): string[] {
  if (!/^\s*["']use server["']/m.test(source)) return [];
  return [...source.matchAll(/^export\s+async\s+function\s+(\w+)/gm)].map((m) => m[1]).sort();
}
