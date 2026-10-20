/**
 * #1920: keeps the billing-access tables honest without a server or database (runs in the CI
 * unit job). The HTTP journey itself is billing-access.pw.ts.
 *
 * - Every account row matches what the Stripe mapping would store and what src/lib/access.ts says.
 * - The hand-written EXPECTED table equals the outcome the rules derive for every state.
 * - Every page and route handler under HAMILTON_ROUTE_ROOTS, every HTTP method it exports, and
 *   every server action under src/app/pro is classified, so a new one cannot go unchecked.
 * - Every server action under src/app/pro checks access in its own body.
 * - The API policy table records the same gate the route enforces.
 * - The cookie and link signers match the app's.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canAccessPremium, isPaymentLapsed } from "@/lib/access";
import type { User } from "@/lib/auth";
import { API_ROUTE_POLICIES } from "@/lib/api-hardening/policies";
import { mapSubscriptionStatus } from "@/lib/billing/subscription-state";
import { createReportToken } from "@/lib/custom-report/link";
import { signSessionId } from "@/lib/session-cookie";
import {
  ACCOUNTS, ACTIONS, BILLING_STATES, EXPECTED, E2E_COOKIE_SECRET, E2E_REPORT_LINK_SECRET, HAMILTON_ROUTE_ROOTS, ROUTES,
  SEAT_WORKSPACES, exportedMethods, exportedServerActions, reportLinkToken, signedSessionCookie,
  type AccessAccount, type BillingState, type GateKind, type Outcome,
} from "./billing-access";

const APP = path.resolve(__dirname, "../../../src/app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => path.relative(APP, file).split(path.sep).join("/");

function userFor(a: AccessAccount, seat: boolean): User {
  return {
    id: a.id, username: a.email, display_name: a.state, role: a.role, email: a.email, stripe_customer_id: null,
    subscription_status: a.subscriptionStatus,
    past_due_since: a.pastDueDays === null ? null : new Date(Date.now() - a.pastDueDays * 86_400_000).toISOString(),
    institution_name: null, institution_type: null, asset_tier: null, state_code: null, fed_district: null, job_role: null, interests: null,
    workspace_seat: seat,
  };
}

/** hasWorkspaceSeat in auth.ts: a member (or owner) of a workspace whose owner is active or past due in grace. */
function holdsSeat(a: AccessAccount): boolean {
  const workspace = a.seatIn ? SEAT_WORKSPACES[a.seatIn] : Object.values(SEAT_WORKSPACES).find((ws) => ws.owner === a.state);
  if (!workspace) return false;
  const owner = ACCOUNTS.find((x) => x.state === workspace.owner)!;
  const ownerUser = userFor(owner, false);
  return owner.subscriptionStatus === "active" || (owner.subscriptionStatus === "past_due" && !isPaymentLapsed(ownerUser));
}

describe("billing-access accounts", () => {
  it("has one account per signed-in state", () => {
    expect(ACCOUNTS.map((a) => a.state).sort()).toEqual(BILLING_STATES.filter((s) => s !== "anonymous").sort());
    expect(new Set(ACCOUNTS.map((a) => a.id)).size).toBe(ACCOUNTS.length);
  });

  it.each(ACCOUNTS)("$state stores what the Stripe webhook would store", (a) => {
    if (a.stripeStatus === null) {
      expect(a.subscriptionStatus).toBe("none");
      return;
    }
    const stored = mapSubscriptionStatus(a.stripeStatus);
    expect(a.subscriptionStatus).toBe(stored);
    // reconcileSubscription: active promotes a viewer to premium, past_due keeps the role, canceled/none demote to viewer.
    expect(a.role).toBe(stored === "active" || stored === "past_due" ? "premium" : "viewer");
  });

  it.each(ACCOUNTS)("$state: premium and lapsed match src/lib/access.ts", (a) => {
    const user = userFor(a, holdsSeat(a));
    expect({ premium: canAccessPremium(user), lapsed: isPaymentLapsed(user) }).toEqual({ premium: a.premium, lapsed: a.lapsed });
  });
});

describe("billing-access expected table", () => {
  const derived = (kind: Exclude<GateKind, "token_link">, state: BillingState): Outcome => {
    if (kind === "public") return "ok";
    if (kind === "internal_secret") return "denied";
    if (kind === "staff_api_provider_first") return "unavailable";
    const a = ACCOUNTS.find((x) => x.state === state);
    const signedOut: Outcome =
      kind === "pro_page" || kind === "pro_export" || kind === "account_page" || kind === "team_billing_page" ? "login" : "denied";
    if (!a) return signedOut;
    const staff = a.role === "admin" || a.role === "analyst";
    // A seat whose workspace owner is past due beyond grace (#1999).
    const ownerState = a.seatIn ? SEAT_WORKSPACES[a.seatIn].owner : null;
    const teamLapsed = ACCOUNTS.some((x) => x.state === ownerState && x.lapsed);
    const withoutPremium: Outcome = a.lapsed ? "billing" : teamLapsed ? "team_billing" : "subscribe";
    switch (kind) {
      case "pro_page": return a.premium && !a.lapsed ? "ok" : withoutPremium;
      // The team-billing page renders for a lapsed team's seat and sends everyone else on.
      case "team_billing_page": return a.premium && !a.lapsed ? "ok" : teamLapsed ? "ok" : withoutPremium;
      case "premium_api": case "pro_export": return a.premium ? "ok" : "denied";
      case "premium_api_provider_after_gate": return a.premium ? "unavailable" : "denied";
      case "staff_api": return staff ? "ok" : "denied";
      case "admin_api": return a.role === "admin" ? "ok" : "denied";
      case "session_api": case "account_page": return "ok";
    }
  };

  for (const kind of Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>) {
    it(`${kind} row follows the rules`, () => {
      for (const state of BILLING_STATES) expect(`${state}: ${EXPECTED[kind][state]}`).toBe(`${state}: ${derived(kind, state)}`);
    });
  }
});

describe("billing-access route coverage", () => {
  const files = HAMILTON_ROUTE_ROOTS.flatMap((root) => walk(path.join(APP, root)))
    .filter((f) => /\/(page\.tsx|route\.ts)$/.test(f))
    .map(rel)
    .sort();
  const listed = (file: string) => ROUTES.filter((r) => r.file.split("#")[0] === file);

  it("classifies every page and route handler under the Hamilton folders", () => {
    expect(files.filter((f) => listed(f).length === 0), "add these to ROUTES in billing-access.ts").toEqual([]);
  });

  it("lists no file that does not exist", () => {
    expect(ROUTES.map((r) => r.file.split("#")[0]).filter((f) => !files.includes(f))).toEqual([]);
  });

  it("sends a request for every HTTP method each route handler exports, and GET for every page", () => {
    for (const file of files) {
      const probed = [...new Set(listed(file).flatMap((r) => r.probes.map((p) => p.method)))].sort();
      const unprobedPublic = listed(file).every((r) => r.kind === "public" && r.probes.length === 0);
      if (unprobedPublic) continue;
      const methods = file.endsWith("route.ts") ? exportedMethods(readFileSync(path.join(APP, file), "utf8")) : ["GET"];
      expect(`${file}: ${probed.join(",")}`).toBe(`${file}: ${methods.join(",")}`);
    }
  });

  it("classifies every server action under src/app/pro, and each checks access itself", () => {
    const sources = walk(path.join(APP, "pro")).filter((f) => f.endsWith(".ts") && !f.includes(".test."));
    const found = sources.flatMap((file) => exportedServerActions(readFileSync(file, "utf8")).map((name) => `${rel(file)}#${name}`)).sort();
    expect(found).toEqual(ACTIONS.map((a) => `${a.file}#${a.name}`).sort());
    for (const action of ACTIONS) {
      const source = readFileSync(path.join(APP, action.file), "utf8");
      const start = source.indexOf(`export async function ${action.name}(`);
      const next = source.indexOf("\nexport ", start + 1);
      const body = source.slice(start, next === -1 ? undefined : next);
      // canAccessPremium (directly, via hasProAccess or via redirectWithoutPremium), a staff role check, or a call to an action that has one.
      const checked = /canAccessPremium\(|redirectWithoutPremium\(|hasProAccess\(\)|user\.role !== "admin"|await loadAnalysisRecord\(|await setWatchedState\(/.test(body);
      expect(checked, `${action.file}#${action.name} must check access itself: server actions skip the /pro layouts`).toBe(true);
    }
  });
});

describe("billing-access API policy table", () => {
  const wanted: Partial<Record<GateKind, string[]>> = {
    premium_api: ["premium"], premium_api_provider_after_gate: ["premium"], staff_api: ["admin_or_analyst"],
    staff_api_provider_first: ["admin_or_analyst"], admin_api: ["cron_or_admin"], session_api: ["session"], public: ["public"],
  };
  for (const route of ROUTES.filter((r) => r.file.startsWith("api/") && !r.file.includes("#"))) {
    it(`${route.file} records the gate it enforces`, () => {
      const policy = API_ROUTE_POLICIES.find((p) => p.file === `src/app/${route.file}`);
      expect(policy, "wrapped API routes have a policy").toBeDefined();
      expect(wanted[route.kind]).toContain(policy!.authRequirement);
    });
  }
});

describe("billing-access signers", () => {
  it("signs the session cookie as the app does", () => {
    const before = process.env.BFI_COOKIE_SECRET;
    process.env.BFI_COOKIE_SECRET = E2E_COOKIE_SECRET;
    try {
      expect(signedSessionCookie("abc123")).toBe(signSessionId("abc123"));
    } finally {
      if (before === undefined) delete process.env.BFI_COOKIE_SECRET; else process.env.BFI_COOKIE_SECRET = before;
    }
  });

  it("signs a market report link as the app does", () => {
    const before = process.env.CUSTOM_REPORT_LINK_SECRET;
    process.env.CUSTOM_REPORT_LINK_SECRET = E2E_REPORT_LINK_SECRET;
    try {
      const now = new Date("2026-10-18T12:00:00Z");
      expect(reportLinkToken(9_701_001, now)).toBe(createReportToken(9_701_001, now));
    } finally {
      if (before === undefined) delete process.env.CUSTOM_REPORT_LINK_SECRET; else process.env.CUSTOM_REPORT_LINK_SECRET = before;
    }
  });

  it("uses the secrets serve.mjs gives the server", () => {
    const serve = readFileSync(path.join(__dirname, "serve.mjs"), "utf8");
    expect(serve).toContain(`env.BFI_COOKIE_SECRET = "${E2E_COOKIE_SECRET}"`);
    expect(serve).toContain(`env.CUSTOM_REPORT_LINK_SECRET = "${E2E_REPORT_LINK_SECRET}"`);
  });
});
