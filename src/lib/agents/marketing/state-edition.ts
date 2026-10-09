import type { sql } from "@/lib/data-store/connection";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { STATE_NAMES } from "@/lib/us-states";
import { allowedNumbers, readNational, readStateFees, readTotals, unbackedNumbers, type FactBundle, type FeeStat } from "./facts";
import { copyProblems, copyText, renderEmail, type EmailCopy } from "./email";
import { CAMPAIGN_NAME_PREFIX, campaignName, parseCampaignName } from "./formats";
import {
  createRegularDraft,
  listCampaigns,
  listGroups,
  listStateGroups,
  mailerLiteConfigured,
  nationalGroupId,
  toStateGroups,
  type FetchLike,
  type StateGroup,
} from "./mailerlite-campaigns";
import { whatsNewFor } from "./whats-new";

type SqlTag = typeof sql;

/**
 * State editions: the same monthly email in one version per state, sent to readers who
 * chose that state. Written from the data with fixed wording (no model call), so every
 * number is the state's own median against the national one. They go out with the
 * month's approval. A reader in a state group gets that edition instead of the national email;
 * a state with too little data for its own edition gets the national email instead
 * (`nationalAudience`), so every reader gets one marketing email a month.
 */

export const STATE_EDITION_FORMAT = "state_edition";
/** A state fee needs this many institutions behind it (the state reports' "not a small sample" bar). */
export const STATE_EDITION_MIN_INSTITUTIONS = 10;
/** Fewer qualifying fees than this and the state has too little data for its own email yet. */
export const STATE_EDITION_MIN_FEES = 3;

const money = (value: number) => (Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`);

function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

interface Gap {
  fee: FeeStat;
  national: FeeStat;
  ratio: number;
}

function gaps(bundle: FactBundle): Gap[] {
  return (bundle.state?.fees ?? [])
    .map((fee) => ({ fee, national: bundle.national.find((n) => n.key === fee.key) }))
    .filter((row): row is { fee: FeeStat; national: FeeStat } => Boolean(row.national && row.national.median > 0))
    .map((row) => ({ ...row, ratio: row.fee.median / row.national.median - 1 }));
}

function gapLine(gap: Gap, state: string): string {
  return `${getDisplayName(gap.fee.key)}: ${money(gap.fee.median)} in ${state} across ${gap.fee.institutions.toLocaleString("en-US")} institutions, against ${money(gap.national.median)} nationally.`;
}

/** The edition's copy, built only from the bundle. */
export function stateEditionCopy(bundle: FactBundle): EmailCopy | null {
  if (!bundle.state) return null;
  const state = bundle.state.name;
  const rows = gaps(bundle);
  if (rows.length < STATE_EDITION_MIN_FEES) return null;
  const above = rows.filter((row) => row.fee.median > row.national.median).sort((a, b) => b.ratio - a.ratio);
  const below = rows.filter((row) => row.fee.median < row.national.median).sort((a, b) => a.ratio - b.ratio);
  const lead = rows.find((row) => row.fee.key === "overdraft") ?? [...rows].sort((a, b) => b.fee.institutions - a.fee.institutions)[0];

  const headline = above.length || below.length
    ? `${state} runs above the national median on ${above.length} ${above.length === 1 ? "fee" : "fees"} and below on ${below.length}`
    : `${state} fees track the national median`;
  const sections: EmailCopy["sections"] = [];
  if (above[0]) sections.push({ heading: `Furthest above the national line`, body: gapLine(above[0], state) });
  if (below[0]) sections.push({ heading: `Furthest below`, body: gapLine(below[0], state) });
  sections.push({
    heading: "What to ask",
    body: `A state median is a better yardstick than a national one, but your real peers are the institutions your customers compare you with. The table shows every headline fee with enough ${state} institutions behind it.`,
  });
  return {
    subjectA: `${state}: ${getDisplayName(lead.fee.key)} at ${money(lead.fee.median)} vs ${money(lead.national.median)} nationally`.slice(0, 70),
    subjectB: `Where ${state} fees sit this month`,
    label: `${state} edition · ${monthLabel(bundle.month)}`,
    headline,
    intro: `Each month we compare the fees ${state} banks and credit unions publish with the national median. Here is where ${state} sits this month.`,
    sections,
    table: "state",
  };
}

/** The facts behind one state's edition. */
export function stateBundle(
  month: string,
  state: { code: string; fees: FeeStat[] },
  national: FeeStat[],
  totals: { institutions: number; fees: number },
): FactBundle {
  return {
    month,
    asOf: new Date().toISOString().slice(0, 10),
    liveInstitutions: totals.institutions,
    liveFees: totals.fees,
    national,
    previousCoverage: null,
    byCharter: [],
    state: { code: state.code, name: STATE_NAMES[state.code] ?? state.code, fees: state.fees },
  };
}

/** True when the state has enough data for its own edition this month. */
export async function stateHasEdition(
  db: SqlTag,
  month: string,
  code: string,
  national: FeeStat[],
  totals: { institutions: number; fees: number },
): Promise<boolean> {
  const fees = await readStateFees(db, code, STATE_EDITION_MIN_INSTITUTIONS);
  return stateEditionCopy(stateBundle(month, { code, fees }, national, totals)) !== null;
}

export interface NationalAudience {
  groupIds: string[];
  /** States with readers but too little data for their own edition; their readers get the national email. */
  thinStates: string[];
}

/**
 * Who gets the national email: readers with no state (the national group), plus readers whose
 * state has no edition this month. Readers in a state with an edition are left out; they get
 * that edition from `marketing-states`.
 */
export async function nationalAudience(
  db: SqlTag,
  month: string,
  { fetcher, dryRun = false }: { fetcher?: FetchLike; dryRun?: boolean } = {},
): Promise<NationalAudience> {
  const groups = await listGroups(fetcher);
  const national = await nationalGroupId(fetcher, groups, !dryRun);
  const base = national ? [national] : [];
  const withReaders = toStateGroups(groups).filter((group) => group.activeCount > 0);
  if (!withReaders.length) return { groupIds: base, thinStates: [] };
  const [nationalFees, totals] = await Promise.all([readNational(), readTotals(db)]);
  const thin: StateGroup[] = [];
  for (const group of withReaders) {
    if (!(await stateHasEdition(db, month, group.stateCode, nationalFees, totals))) thin.push(group);
  }
  return { groupIds: [...base, ...thin.map((group) => group.groupId)], thinStates: thin.map((group) => group.stateCode) };
}

export interface StateEditionResult {
  month: string;
  states: number;
  drafts: Array<{ state: string; campaignId: string; name: string; readers: number }>;
  skipped: Array<{ state: string; reason: string }>;
  failures: Array<{ state: string; reason: string }>;
  skippedAll: string | null;
}

/** `FI Agent 2026-11 · state_edition · TX · Texas` → "TX". */
function editionState(name: string): string | null {
  const parsed = parseCampaignName(name);
  if (parsed?.format !== STATE_EDITION_FORMAT) return null;
  return name.split(" · ")[2]?.trim() || null;
}

export async function runStateEditions({
  db,
  month,
  mailingAddress,
  dryRun = false,
  fetcher,
}: {
  db: SqlTag;
  month: string;
  mailingAddress: string | null;
  dryRun?: boolean;
  fetcher?: FetchLike;
}): Promise<StateEditionResult> {
  const result: StateEditionResult = { month, states: 0, drafts: [], skipped: [], failures: [], skippedAll: null };
  if (!mailerLiteConfigured()) return { ...result, skippedAll: "MAILERLITE_API_KEY is not set" };

  const groups = (await listStateGroups(fetcher)).filter((group) => group.activeCount > 0);
  result.states = groups.length;
  if (!groups.length) return { ...result, skippedAll: "no reader has picked a state yet" };

  const drafted = new Set(
    (await listCampaigns("draft", `${CAMPAIGN_NAME_PREFIX} ${month} · ${STATE_EDITION_FORMAT} `, fetcher))
      .map((campaign) => editionState(campaign.name))
      .filter((code): code is string => Boolean(code)),
  );
  const [national, totals] = await Promise.all([readNational(), readTotals(db)]);

  for (const group of groups) {
    const code = group.stateCode;
    const name = STATE_NAMES[code] ?? code;
    if (drafted.has(code)) {
      result.skipped.push({ state: code, reason: "already drafted this month" });
      continue;
    }
    try {
      const fees = await readStateFees(db, code, STATE_EDITION_MIN_INSTITUTIONS);
      const bundle = stateBundle(month, { code, fees }, national, totals);
      const copy = stateEditionCopy(bundle);
      if (!copy) {
        result.skipped.push({ state: code, reason: `fewer than ${STATE_EDITION_MIN_FEES} fees with ${STATE_EDITION_MIN_INSTITUTIONS}+ institutions` });
        continue;
      }
      const allowed = allowedNumbers(bundle);
      // The headline counts fees above and below; those counts come from the same rows.
      for (let n = 0; n <= fees.length; n += 1) allowed.add(String(n));
      const unbacked = unbackedNumbers(copyText(copy), allowed);
      const problems = [...copyProblems(copy), ...(unbacked.length ? [`numbers not in the data: ${unbacked.join(", ")}`] : [])];
      if (problems.length) {
        result.failures.push({ state: code, reason: problems.join("; ") });
        continue;
      }
      if (dryRun) {
        result.skipped.push({ state: code, reason: "dry run: not drafted" });
        continue;
      }
      const draft = await createRegularDraft(
        {
          name: campaignName(month, STATE_EDITION_FORMAT, `${code} · ${name}`),
          subject: copy.subjectA,
          html: renderEmail(copy, bundle, STATE_EDITION_FORMAT, mailingAddress, whatsNewFor(month)),
          groupId: group.groupId,
        },
        fetcher,
      );
      result.drafts.push({ state: code, campaignId: draft.id, name: draft.name, readers: group.activeCount });
    } catch (error) {
      result.failures.push({ state: code, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export function summarizeStateEditions(result: StateEditionResult): string {
  if (result.skippedAll) return `No state editions: ${result.skippedAll}.`;
  const readers = `${result.states} state${result.states === 1 ? "" : "s"} with readers`;
  const wouldDraft = result.skipped.filter((row) => row.reason === "dry run: not drafted").map((row) => row.state);
  const parts = [
    wouldDraft.length
      ? `Would draft ${wouldDraft.length} state edition${wouldDraft.length === 1 ? "" : "s"} (${wouldDraft.join(", ")}) for ${readers}; dry run, nothing drafted.`
      : `Drafted ${result.drafts.length} state edition${result.drafts.length === 1 ? "" : "s"} for ${readers}.`,
  ];
  const thin = result.skipped.filter((row) => row.reason.startsWith("fewer"));
  if (thin.length) parts.push(`Not enough data yet for ${thin.map((row) => row.state).join(", ")}; their readers get the national email.`);
  if (result.failures.length) parts.push(`Failed: ${result.failures.map((row) => `${row.state} (${row.reason})`).join("; ")}.`);
  return parts.join(" ");
}
