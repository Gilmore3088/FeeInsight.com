/**
 * Hamilton hand-offs from the public institution profile (James's Oct 18 brief, step 4).
 *
 * Each hand-off is a Pro address that carries what the reader was looking at: the institution
 * (`instId`), the cohort and quarter behind the comparison, and the fees compared, written into
 * the question Hamilton opens with. A reader who isn't Pro goes to the plans with that address
 * as `from`, and /subscribe, /register, /login, checkout and /account/welcome all pass `from`
 * through `sanitizeInternalRedirect`, so the same address opens once they have paid.
 *
 * Questions open unsent (no `send=1`): the reader confirms before Hamilton runs anything.
 */

/** /pro/analyze trims its `q` to 500 characters; stay inside it so nothing is cut mid-sentence. */
export const HANDOFF_QUESTION_MAX = 500;

export interface HandoffFee {
  /** "overdraft", "atm_non_network". */
  key: string;
  /** "overdraft", "out-of-network ATM": as it reads inside a sentence. */
  label: string;
  /** "$35": the value the page compares. */
  amount: string;
  /** "the Florida median of $30". */
  against: string | null;
}

export interface HandoffContext {
  institutionId: number;
  institutionName: string;
  /** "bank" or "credit union". */
  kind: string;
  /** "Tallahassee, Florida": where its local competitors are. */
  place: string | null;
  /** "Q2 2026": the call-report quarter the comparison uses. */
  quarter: string | null;
  /** Its fee-income share of revenue, as a percent value (8.7). */
  ownSharePct: number | null;
  /** The cohort median share, as a percent value (2.2). */
  peerSharePct: number | null;
  /** How many institutions the cohort median counts. */
  peerCount: number | null;
  /** "$1B to $10B": the asset band the cohort shares. */
  sizeRange: string | null;
  /** "Service-charge income" (FDIC) or "Fee income" (NCUA). */
  incomeLabel: string;
  fees: HandoffFee[];
}

export type HandoffKey = "drivers" | "competitors" | "briefing";

export interface HamiltonHandoff {
  key: HandoffKey;
  label: string;
  /** The Pro address it opens; plain strings only, so it can cross into a client island. */
  proHref: string;
}

const pct = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;

/**
 * Joins a question's sentences inside the limit. Optional sentences (the context) are dropped,
 * last first, before the required ones; the opening question and the closing instruction stay.
 */
function fit(required: { open: string; close: string }, optional: string[]): string {
  const kept = [...optional];
  const join = () => [required.open, ...kept, required.close].join(" ");
  while (kept.length > 0 && join().length > HANDOFF_QUESTION_MAX) kept.pop();
  return join().slice(0, HANDOFF_QUESTION_MAX);
}

function feeClause(fees: HandoffFee[]): string | null {
  const parts = fees.map((fee) => `${fee.label} ${fee.amount}${fee.against ? ` against ${fee.against}` : ""}`);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The question behind "Analyze the drivers of service-charge income". */
export function driversQuestion(ctx: HandoffContext): string {
  const plural = ctx.kind === "bank" ? "banks" : "credit unions";
  const share =
    ctx.ownSharePct !== null && ctx.peerSharePct !== null
      ? `${ctx.incomeLabel} was ${pct(ctx.ownSharePct)} of revenue${ctx.quarter ? ` in ${ctx.quarter}` : ""}, against a median of ${pct(ctx.peerSharePct)} for ${
          ctx.peerCount ? `${ctx.peerCount.toLocaleString("en-US")} ` : ""
        }${plural}${ctx.sizeRange ? ` with ${ctx.sizeRange} in assets` : " of the same asset size"}.`
      : null;
  const fees = feeClause(ctx.fees);
  return fit(
    {
      open: `What drives ${ctx.institutionName}'s ${ctx.incomeLabel.toLowerCase()}?`,
      close: "Separate what pricing, fee volume and account mix can and can't explain, and say what data would settle it.",
    },
    [share, fees ? `Its published fees include ${fees}.` : null].filter((part): part is string => part !== null),
  );
}

/** The question behind "Compare local deposit competitors". */
export function competitorsQuestion(ctx: HandoffContext): string {
  return fit(
    {
      open: `Who are ${ctx.institutionName}'s local deposit competitors${ctx.place ? ` around ${ctx.place}` : ""}?`,
      close: `Compare their deposit share, branches and published fees with ${ctx.institutionName}'s, and say which comparisons have too few institutions to rely on.`,
    },
    [],
  );
}

/**
 * The three contextual actions (James's audit, Oct 18): each keeps the institution and the
 * comparison it was opened from. The briefing opens Hamilton's competitive brief on this institution.
 */
export function hamiltonHandoffs(ctx: HandoffContext): HamiltonHandoff[] {
  const instId = String(ctx.institutionId);
  const ask = (q: string) => `/pro/analyze?${new URLSearchParams({ instId, intent: "institution", q }).toString()}`;
  return [
    { key: "drivers", label: `Analyze the drivers of ${ctx.incomeLabel.toLowerCase().replace("-", "\u2011")}`, proHref: ask(driversQuestion(ctx)) },
    { key: "competitors", label: "Compare local deposit competitors", proHref: ask(competitorsQuestion(ctx)) },
    {
      key: "briefing",
      label: "Generate a pricing committee briefing",
      proHref: `/pro/reports?${new URLSearchParams({ instId, intent: "competitive-brief" }).toString()}`,
    },
  ];
}

/**
 * Where a hand-off goes for this reader. Pro opens Hamilton directly. Everyone else, signed in or
 * not, goes to the plans on this institution's tier with the Pro address as `from`; the Pro gate's
 * own redirect is not relied on, because it rebuilds the address from request headers.
 */
export function handoffHref(proHref: string, institutionId: number, viewer: { isPro: boolean }): string {
  if (viewer.isPro) return proHref;
  return `/subscribe?${new URLSearchParams({ inst: String(institutionId), from: proHref }).toString()}#pro`;
}
