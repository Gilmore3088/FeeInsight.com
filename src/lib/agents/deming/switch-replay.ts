import { compareGoldenSet, goldenMatches, goldenTraces, measureGoldenSet, notLoadedNote, type GoldenSet, type GoldenSetComparison, type GoldenSetMeasure } from "./golden-set";
import { experimentalVariant, type ExperimentConfig } from "./shadow-lab/variants";
import type { CaseTrace, FeeRef, ShadowCase, StageFee } from "./shadow-lab/types";
import { SWEEP_REPLAYS, sweepSwitches, sweepTraces } from "./sweep-replay";
import { DAILY_CAP_LINES_LIVE } from "@/lib/daily-cap-wording";
import { DASH_LIST_ROWS_LIVE } from "@/lib/agents/knox/dash-list-rows";

/**
 * Plan step 4 (#2535): every `*_LIVE` switch passes the golden set before it turns on. A switch's
 * change replays on the frozen golden set (#2533, `golden-set.ts`) twice, switch held off and
 * switch held on, through the override parameters the replayed Knox, Darwin and Hamilton functions
 * already take (`ExperimentConfig.switches` in `shadow-lab/variants.ts`). No database, no model call.
 *
 * Only a switch listed in `SWITCH_REPLAYS` (read switches here, database sweeps from `sweep-replay.ts`) can be replayed. Every other switch gets a receipt that
 * says "not replayable" with its reason from `NOT_REPLAYABLE_REASONS`; with no reason it fails. A replay is `full` when every read of the switch on the
 * replay path takes the override, `full on shadow cases` when the shadow cases take it everywhere but
 * the regression members replay the PR head's own checks, and `partial` when some reads keep the PR
 * head's code value (the receipt names which). "Code value" always means the value in the PR head
 * being tested, not main's or prod's.
 *
 * The gate: no number gets worse with the switch on. Recall, precision and known-wrong refused
 * must not fall, no expected fee may be lost, and no member may publish or let through more
 * known-wrong fees. `switch-gate.test.ts` also proves each mapped override changes at least one
 * input, so a misspelled or ignored override cannot pass by measuring the same pipeline twice.
 */

export type ReplayScope = "full" | "full on shadow cases" | "partial" | "sweep" | "sweep, partial";

export interface SwitchReplay {
  scope: ReplayScope;
  /** What the replay holds on and off. */
  replays: string;
  /** For `partial`: the reads on the replay path that keep the PR head's code value. */
  keepsCodeValue?: string;
  /** The experiment fields that hold the switch at `on`. */
  config: (on: boolean) => Partial<Pick<ExperimentConfig, "dailyCapLines" | "dashListRows" | "switches">>;
  /**
   * A database sweep (`sweep-replay.ts`): the pipeline runs once at the PR head's code values and
   * the sweep's decision function runs over what it published, switch off then on.
   */
  sweep?: true;
}

const CATEGORY_KEEPS = "Knox's own category reads inside the free read and Darwin's `category_mismatch` check (`verificationReasonCode`)";

const READ_REPLAYS: Readonly<Record<string, SwitchReplay>> = {
  KNOX_HELD_NAME_RULES_LIVE: {
    scope: "full on shadow cases",
    replays: "every stage of the shadow-case replay runs under `withHeldNameRules(on)`, the module flag each held-name read consults; the regression members replay the PR head's own checks",
    config: (on) => ({ switches: { heldNameRules: on } }),
  },
  DASH_LIST_ROWS_LIVE: {
    scope: "full",
    replays: "Knox's free read (`runFreeSpecialists` `dashListRows`), its only read on the replay path",
    config: (on) => ({ dashListRows: on }),
  },
  KNOX_DISCONTINUED_TABLES_LIVE: {
    scope: "full",
    replays: "Knox's free read (`runFreeSpecialists` `withoutDiscontinuedTables`), its only read on the replay path",
    config: (on) => ({ switches: { withoutDiscontinuedTables: on } }),
  },
  DAILY_CAP_LINES_LIVE: {
    scope: "partial",
    replays: "Knox's self-check trace and Darwin's `statedInOwnSource` / `sourceLineFor` (`dailyCapLines`)",
    keepsCodeValue: "Knox's plain trace (`specialists.ts`, no options), Darwin's stated-$0 trace and the replay's own attribution trace",
    config: (on) => ({ dailyCapLines: on }),
  },
  NO_CHARGE_SENTENCE_READ_LIVE: {
    scope: "partial",
    replays: "Knox's free read (`noChargeSentences`) and Darwin's `statedInOwnSource` / `sourceLineFor`",
    keepsCodeValue: "Knox's self-check traces and the replay's own attribution trace",
    config: (on) => ({ switches: { noChargeSentences: on } }),
  },
  DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE: {
    scope: "partial",
    replays: "Darwin's post-source conditional-$0 check (`postSourceCheck` `layout`)",
    keepsCodeValue: "the layout default inside `sourceLineFor` (`ownSegment`), which picks the line the check reads",
    config: (on) => ({ switches: { conditionalZeroLayout: on } }),
  },
  BORROWED_DIRECTION_LIVE: {
    scope: "partial",
    replays: "Hamilton's publish category guard (`checkFeeCategory` `borrowedDirection`)",
    keepsCodeValue: `the replay's re-file of Knox's hint, ${CATEGORY_KEEPS}`,
    config: (on) => ({ switches: { category: { borrowedDirection: on } } }),
  },
  NON_CUSTOMER_CASHIERS_CHECK_LIVE: {
    scope: "partial",
    replays: "Hamilton's publish category guard (`checkFeeCategory` `nonCustomerCashiersCheck`)",
    keepsCodeValue: `the replay's re-file of Knox's hint, ${CATEGORY_KEEPS}`,
    config: (on) => ({ switches: { category: { nonCustomerCashiersCheck: on } } }),
  },
  INTL_ABBREVIATION_REFILE_LIVE: {
    scope: "partial",
    replays: "the replay's re-file of Knox's hint (`refileCategory`) and Hamilton's publish category guard (`intlAbbreviation`)",
    keepsCodeValue: CATEGORY_KEEPS,
    config: (on) => ({ switches: { category: { intlAbbreviation: on } } }),
  },
  LOAN_PAYMENT_NSF_REFILE_LIVE: {
    scope: "partial",
    replays: "the replay's re-file of Knox's hint (`refileCategory`) and Hamilton's publish category guard (`loanPaymentNsf`)",
    keepsCodeValue: CATEGORY_KEEPS,
    config: (on) => ({ switches: { category: { loanPaymentNsf: on } } }),
  },
};

/** Every sweep switch (`SWEEP_REPLAYS`): the sweep's decision function over the golden publications. */
const SWEEP_SWITCH_REPLAYS: Readonly<Record<string, SwitchReplay>> = Object.fromEntries(SWEEP_REPLAYS.flatMap((sweep) =>
  Object.keys(sweep.switches).map((name) => [name, {
    scope: sweep.scope, replays: `${sweep.replays} (\`${sweep.check}\`)`, keepsCodeValue: sweep.keepsCodeValue, sweep: true, config: () => ({}),
  } satisfies SwitchReplay])));

export const SWITCH_REPLAYS: Readonly<Record<string, SwitchReplay>> = { ...READ_REPLAYS, ...SWEEP_SWITCH_REPLAYS };

const SYSTEM = "does not read, write or publish a fee";
const ONE_DOCUMENT = "each golden member is one document read once, with no other copies, editions or publication history";
const DATABASE = (what: string) => `its decision reads ${what} from the database, which no golden member carries`;

/**
 * Plan step 4 (#2533 follow-up, Nov 2): why each switch with no entry in `SWITCH_REPLAYS` cannot
 * replay on the golden set. The inventory prints it in the replay column and fails a switch with
 * neither a replay nor a reason here, so a new switch cannot land unexplained. The switch gate
 * fails a PR that turns a switch on (or adds one switched on) with no replay unless this map's
 * line for it is on an added line of the same PR: the PR states the reason it ships without a
 * golden-set receipt, and review reads it in the diff.
 */
export const NOT_REPLAYABLE_REASONS: Readonly<Record<string, string>> = {
  DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE: "not wired yet: added by #2894 after this gate was built; its live $0 re-check reads each fee's stored line and the account it belongs to, and no sweep replay for it exists yet",
  ACCOUNT_OWNER_REFILE_LIVE: `not wired yet: the account-owner re-file needs each raw row's own product name and Knox's raw name, which the replayed read does not keep (${DATABASE("the raw row's product")})`,
  ACCOUNT_TYPE_COLUMN_READ_LIVE: "not wired yet: Hamilton's account-type hold reads the fee's table column product (`tableColumnProduct`) and account type from the raw row; the golden set scores no account type",
  ATM_SURCHARGE_TAKEDOWN_LIVE: "a hand list of named production fee ids (#1772, #1773); no golden fee is one of them, so a replay could only pass vacuously",
  AUDIENCE_V5_LIVE: "changes only the audience Darwin reads (box rows) and the relabel chain; the golden set has no audience answer to score",
  CALL_PERIOD_PRUNE_LIVE: `Hoovie's call-report period storage prune; ${SYSTEM}`,
  CARD_PRODUCT_TAKEDOWN_LIVE: "governs only Hamilton's live sweep of card-product misfiles; the replayed publish guard already applies the same rule (`cardProductMisfile`) to every golden fee, so the sweep would find nothing left to take down",
  CITY_REPAIR_LIVE: `Atlas's institution city repair; ${SYSTEM}`,
  CLUB_WITHDRAWAL_LIVE: "read once into a category guard rule's exclude pattern at module load; no override reaches it without changing `fee-category-guard.ts`",
  COLD_EXPORT_LIVE: `Hoovie's cold storage export; ${SYSTEM}`,
  COMPARATOR_FRAGMENT_REREAD_LIVE: "its comparator shapes are only ever a `reread` (kept live with a re-read request to Knox, never renamed or taken down), and the golden set does not replay Knox's re-read requests; the fragment sweep's takedowns replay under FRAGMENT_NAME_TAKEDOWN_LIVE with this switch at its code value",
  CURRENT_COPY_CONFIRM_LIVE: `Hamilton's current-copy confirm compares a live fee's document with the bank's current sources; ${ONE_DOCUMENT}`,
  DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE: `re-judges verified rows whose category a learning pass changed (\`options.learning\`); ${DATABASE("the learned category change")}`,
  DARWIN_RECHECK_OLDER_LIVE: `Darwin's verified re-check of older live rows decides by publication age and earlier verdicts; ${DATABASE("each row's verify history")}`,
  DARWIN_RECHECK_SECOND_LOOK_LIVE: `second looks are due by a first look's timestamp 12 hours earlier; ${DATABASE("the earlier first look")}`,
  DARWIN_RECHECK_TIER_RULE_LIVE: `the tier rule reads the bank's general schedule beside a tier document; ${ONE_DOCUMENT}`,
  DARWIN_RELEASE_REPAIR_LIVE: `re-checks fees released from Knox's held queue; ${DATABASE("the held-queue release")}`,
  DARWIN_TAKEOVER_CATEGORY_PROOF_LIVE: `proves a takeover's category against the fee it replaces; ${DATABASE("the replaced live fee")}`,
  DATED_EDITION_TAKEOVER_LIVE: `retires a fee when a newer dated edition of its schedule is live; ${ONE_DOCUMENT}`,
  EDITION_CHECK_LIVE: `compares a bank's schedule editions by effective date; ${ONE_DOCUMENT}`,
  EDITION_LATE_HEADING_LIVE: `reads a late edition heading only to order a bank's editions (\`judgeEditions\`); ${ONE_DOCUMENT}`,
  ESCHEAT_HOLD_REREAD_LIVE: "an SQL predicate over Knox's held rows (`escheatProcessingNameSql`); the replay has no held queue to re-read",
  FEDERAL_BILLS_TRACKER_LIVE: `Magellan's federal bills tracker; ${SYSTEM}`,
  FEDERAL_REGISTER_TRACKER_LIVE: `Magellan's Federal Register tracker; ${SYSTEM}`,
  HAND_LINK_REPAIR_LIVE: `Atlas's hand-listed fee-link repairs; ${SYSTEM} (it changes which document a bank links)`,
  HAND_TAKEDOWN_RETURNS_LIVE: "re-reads of hand-listed production lines (`hand-takedowns.ts`); no golden fee is a listed line",
  INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE: "not wired yet: its rows join each live wire fee to the stored text identity of its raw row (`storedTextIsOriginal`) and the bank's own wire scope, which the replay does not build",
  KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE: `corrects the account subject of live monthly fees across a bank's documents; ${ONE_DOCUMENT}`,
  KNOX_ANCILLARY_OWNER_CORRECT_LIVE: `re-owns ancillary products' fees to their primary account across live raw rows; ${DATABASE("the raw rows' product ownership")}`,
  KNOX_AUDIENCE_LESSONS_LIVE: `Knox's audience lessons come from confirmed takedowns (pipeline feedback), and the golden set scores no audience; ${DATABASE("the lessons")}`,
  KNOX_READ_LESSONS_LIVE: `Knox's read lessons are other checks' fixes to a document's earlier read; ${DATABASE("those fixes")}`,
  KNOX_REREAD_FEEDBACK_LIVE: `acts on re-read requests other checks filed in pipeline feedback; ${DATABASE("the requests")}`,
  KNOX_REREAD_PUBLISHED_NAME_LIVE: `renames a live fee from a re-read request; ${DATABASE("the request")}, and the golden set does not score names`,
  KNOX_SINGLE_ACCOUNT_OWNER_LIVE: `re-owns single-account disclosures' fees across live raw rows; ${DATABASE("the raw rows' product ownership")}`,
  LIVE_NAME_REFRESH_LIVE: "renames live fees to a better name; the golden set scores category, price and frequency, not names",
  LIVE_SOURCE_REFETCH_LIVE: "Magellan's refetch of live fees' source pages; the golden set's documents are frozen text",
  MOVED_PAGE_REFRESH_LIVE: `moves a live fee to the page its document moved to; ${ONE_DOCUMENT}`,
  NEAR_NAME_COLLAPSE_LIVE: `collapses near-name repeats among a bank's live fees across publish steps; ${ONE_DOCUMENT}`,
  NEWER_COPY_RETIRE_LIVE: `retires fees an older copy published once a newer copy of the document is read; ${ONE_DOCUMENT}`,
  NON_DEPOSIT_LINK_RELEASE_LIVE: `sends a bank's left-behind fee link back to discovery; ${SYSTEM}`,
  OVERDRAFT_PLAN_HOLD_LIVE: "not wired yet: Hamilton's frequency fill holds a period-priced overdraft plan beside the bank's per-item overdraft fee; the replay does not run the fill",
  PAGE_COPY_COLLAPSE_LIVE: `collapses copies of one page published from different documents; ${ONE_DOCUMENT}`,
  PRODUCT_PAGE_CONFLICT_LIVE: `rolls back a product page's fee that conflicts with the bank's schedule; ${ONE_DOCUMENT}`,
  PRODUCT_PAGE_REPEAT_TAKEDOWN_LIVE: `takes down a product page's repeat of a schedule line (\`scheduleTwin\`); ${ONE_DOCUMENT}`,
  PUBLISH_REFUSE_DUPLICATES_LIVE: `refuses rows the exact-duplicate collapse would close against live fees from earlier publish steps; ${ONE_DOCUMENT}`,
  PUBLISH_REFUSE_PAGE_COPIES_LIVE: `refuses rows the page-copy collapse would close; ${ONE_DOCUMENT}`,
  PUBLISH_REFUSE_SAME_LINE_READS_LIVE: "not wired yet: refuses a second read of a live fee's printed line at publish; the replayed publish gate does not call it (Darwin's same-line read sweep, which uses the same `readsSameLine`, is replayed)",
  PUBLISH_REFUSE_SWEEP_RULES_LIVE: "not wired yet: refuses at publish the rows a sweep would take down; the replayed publish gate does not call it, and each sweep it borrows is replayed after publish on its own switch",
  PUBLISH_SWEEPS_SPLIT_LIVE: "schedules Hamilton's publish sweeps as their own run kind; it changes when sweeps run, not what they decide",
  RANGE_BAND_SET_ASIDE_LIVE: `sets aside rate and balance bands in Knox's held queue; ${DATABASE("the held queue")}`,
  REG_WIRE_SUMMARIES_LIVE: `Magellan's regulatory wire summaries (shadow mode, no model call); ${SYSTEM}`,
  REREAD_CATEGORY_RECHECK_LIVE: `acts only on fees another check asked Knox to re-read (\`fragment_name\`); ${DATABASE("the re-read request")}`,
  RESEARCH_SPLIT_LIVE: "read once into the fold's split table at module load (`SPLIT_CATEGORIES`); no override reaches it without changing `fee-fold.ts`",
  RETENTION_LIVE: `Atlas's ledger retention; ${SYSTEM}`,
  RULES_RECHECK_TAKEDOWN_LIVE: `a pause switch: a re-check failure comes down only when a second run 12 hours later fails it again; ${DATABASE("the first look")}`,
  SAME_LINE_REPLACEMENT_TAKEDOWN_LIVE: `judges a live fee against the older publication it replaced; ${ONE_DOCUMENT}`,
  SAME_PAGE_SUPERSEDE_LIVE: `chooses which stored copy of a page is current; ${ONE_DOCUMENT}`,
  SAME_TEXT_COPY_REOPEN_LIVE: "reopens rejected stored copies in Rosetta; the golden set's documents are frozen text that is never rejected",
  SAMPLE_REPORT_LIVE: `shows the sample report page; ${SYSTEM}`,
  SAVED_LINK_FETCH_LIVE: "Magellan's fetch of a bank's saved fee link; the golden set's documents are frozen text",
  REDIRECT_WEBSITE_PROOF_LIVE: "Magellan's proof before a redirect landing replaces an institution's website; upstream of extraction, and the golden set's documents are frozen text",
  SECTION_PATH_LIVE: "the replay can hold it (`switches.sectionPath`), but it changes only the audience Darwin reads, and the golden set has no audience answer, so no golden number can move",
  SOURCE_LINK_DRIFT_LIVE: `repairs a live fee's source link when its document's address drifts; ${ONE_DOCUMENT}`,
  STATE_BILLS_TRACKER_LIVE: `Magellan's state bills tracker; ${SYSTEM}`,
  STATE_NEWS_TRACKER_LIVE: `Magellan's state regulatory news tracker; ${SYSTEM}`,
  STORAGE_COMPACTION_LIVE: `Hoovie's storage compaction; ${SYSTEM}`,
  SUBORDINATION_REFILE_LIVE: "read once into the fold's split table at module load (`SPLIT_CATEGORIES`); no override reaches it without changing `fee-fold.ts`",
  SUNDAY_EMAIL_LIVE: `Deming's Sunday maintenance email; ${SYSTEM}`,
  SUPERSEDED_RECHECK_LIVE: `re-checks Knox's held rows from a superseded document against its current text; ${ONE_DOCUMENT}`,
  SUPERSEDED_REFILE_LIVE: `re-files held rows from a superseded document on a state lane's extract; ${DATABASE("the held rows")}`,
  TEXAS_CAPITAL_TAKEDOWN_LIVE: "a hand list of named production fee ids (#1880); no golden fee is one of them, so a replay could only pass vacuously",
  TRANSLATED_COPY_RESTORE_LIVE: `restores a fee taken down as a translated copy once its English twin is gone; ${ONE_DOCUMENT}`,
  TRANSLATED_COPY_TAKEDOWN_LIVE: `takes down a Spanish copy's fee beside its live English twin; ${ONE_DOCUMENT}`,
  VAULT_RETENTION_LIVE: `Atlas's document vault retention; ${SYSTEM}`,
};

/** The inventory's replay cell for a switch: its scope, its stated reason, or the missing reason that fails the inventory. */
export const MISSING_REASON = "no: NO REASON STATED (add one to NOT_REPLAYABLE_REASONS in src/lib/agents/deming/switch-replay.ts)";
export function replayCell(name: string): string {
  const spec = SWITCH_REPLAYS[name];
  if (spec) return spec.scope;
  const reason = NOT_REPLAYABLE_REASONS[name];
  return reason ? `no: ${reason}` : MISSING_REASON;
}

export function switchExperiment(name: string, spec: SwitchReplay, on: boolean): ExperimentConfig {
  return {
    id: `${name}=${on ? "on" : "off"}`,
    description: `${name} held ${on ? "on" : "off"}: ${spec.replays}.`,
    excerptAtPublish: false,
    // Every switch but the one under test keeps the PR head's code value.
    dailyCapLines: DAILY_CAP_LINES_LIVE,
    dashListRows: DASH_LIST_ROWS_LIVE,
    ...spec.config(on),
  };
}

export interface WorseFee {
  member: string;
  /** An expected fee no longer published; a known-wrong fee now published; a forbidden fee or takedown now let through. */
  change: "lost" | "wrong_published" | "let_through";
  /** Null for a regression takedown whose frozen input names no fee. */
  fee: FeeRef | null;
}

export interface SwitchReceipt {
  switch: string;
  status: "pass" | "fail" | "not_replayable" | "no_reason" | "not_comparable" | "removed" | "retired";
  scope: ReplayScope | null;
  replays: string | null;
  keepsCodeValue: string | null;
  /** Why a switch is not replayable, or why the two runs were not comparable. */
  reason: string | null;
  goldenSet: { version: number; manifestSha256: string; members: GoldenSetMeasure["members"]; notLoadedIds?: readonly string[] } | null;
  off: Pick<GoldenSetMeasure, "recall" | "precision" | "knownWrongRefused"> | null;
  on: Pick<GoldenSetMeasure, "recall" | "precision" | "knownWrongRefused"> | null;
  comparison: Omit<GoldenSetComparison, "lost" | "gained" | "moreWrong" | "moreLetThrough">
    & { lost: number; gained: number; moreWrong: number; moreLetThrough: number; membersChanged: number } | null;
  /** The numbers that got worse, by name. */
  worse: string[];
  /** The fees behind them: expected fees lost, and known-wrong fees the switch publishes. */
  worseFees: WorseFee[];
  gainedFees: Array<{ member: string; fee: FeeRef }>;
}

const EPSILON = 1e-12;
const fell = (delta: number | null) => delta != null && delta < -EPSILON;
const feeKey = (fee: StageFee | FeeRef) => JSON.stringify([fee.canonicalFeeKey, fee.amountCents, fee.frequency ?? null, fee.feeName]);

type Traces = ReadonlyMap<string, CaseTrace>;
const byCase = (traces: readonly CaseTrace[]): Traces => new Map(traces.map((trace) => [trace.caseKey, trace]));

/** Known-wrong publications of one member in a run, as `measureGoldenSet` counts them. */
function wrongPublications(set: GoldenSet, memberId: string, traces: Traces): StageFee[] {
  const entry = set.cases.find((candidate) => candidate.member.id === memberId);
  if (!entry) return [];
  const published = traces.get(entry.case.caseKey)?.published ?? [];
  const hit = (ref: FeeRef, fee: StageFee) => goldenMatches(entry.member, ref, fee);
  return published.filter((fee) => entry.case.expected.forbid.some((ref) => hit(ref, fee))
    || (!entry.case.expected.publish.some((ref) => hit(ref, fee)) && entry.member.completeInventory));
}

const asRef = (fee: StageFee): FeeRef => ({ canonicalFeeKey: fee.canonicalFeeKey, feeName: fee.feeName, amountCents: fee.amountCents, frequency: fee.frequency ?? null });

/** The forbidden fees one member publishes in a run (shadow cases; a takedown names its own). */
function letThroughFees(set: GoldenSet, memberId: string, traces: Traces): FeeRef[] {
  const entry = set.cases.find((candidate) => candidate.member.id === memberId);
  if (!entry) return [];
  const published = traces.get(entry.case.caseKey)?.published ?? [];
  return entry.case.expected.forbid.filter((ref) => published.some((fee) => goldenMatches(entry.member, ref, fee)));
}

function takedownFee(set: GoldenSet, memberId: string): FeeRef | null {
  const input = set.regression.find((member) => member.id === memberId)?.input as Record<string, unknown> | undefined;
  const source = (input?.fee ?? input) as Record<string, unknown> | undefined;
  if (!source || typeof source.canonical_fee_key !== "string") return null;
  const amount = source.amount == null ? null : Number(source.amount);
  return { canonicalFeeKey: source.canonical_fee_key, feeName: typeof source.fee_name === "string" ? source.fee_name : null,
    amountCents: amount == null || Number.isNaN(amount) ? null : Math.round(amount * 100) };
}

/** The gate: each number that got worse from switch off to switch on. Empty passes. */
export function worseNumbers(comparison: Pick<GoldenSetComparison, "recall" | "precision" | "knownWrongRefused" | "lost" | "moreWrong" | "moreLetThrough">): string[] {
  const worse: string[] = [];
  if (fell(comparison.recall.delta)) worse.push("recall");
  if (fell(comparison.precision.delta)) worse.push("precision");
  if (fell(comparison.knownWrongRefused.delta)) worse.push("known-wrong refused");
  if (comparison.lost.length > 0) worse.push("expected fees lost");
  if (comparison.moreWrong.length > 0) worse.push("members publishing more known-wrong fees");
  if (comparison.moreLetThrough.length > 0) worse.push("members letting more known-wrong fees or takedowns through");
  return worse;
}

/** Members whose found, correct, wrong or let-through count differs between the two runs. */
function membersChanged(off: GoldenSetMeasure, on: GoldenSetMeasure): number {
  const sig = (r: GoldenSetMeasure["perMember"][number]) => `${r.found}:${r.correct}:${r.wrong}:${r.letThrough}`;
  const before = new Map(off.perMember.map((r) => [r.id, sig(r)]));
  return on.perMember.filter((r) => before.get(r.id) !== sig(r)).length;
}

/** Why a switch has no replay: its line in `NOT_REPLAYABLE_REASONS`, or null when none is stated. */
export type NotReplayableReason = string | null;

/** The pipeline at the PR head's code values, run once per set and shared by every sweep replay. */
const headTraces = new WeakMap<GoldenSet, CaseTrace[]>();
function sweepBase(set: GoldenSet, name: string, spec: SwitchReplay): CaseTrace[] {
  const cached = headTraces.get(set);
  if (cached) return cached;
  const traces = goldenTraces(set, experimentalVariant(switchExperiment(name, spec, false)));
  headTraces.set(set, traces);
  return traces;
}

/** One run of a switch held off or on: its traces (sweeps applied after publish for a sweep switch). */
function switchRun(set: GoldenSet, name: string, spec: SwitchReplay, on: boolean): CaseTrace[] {
  if (!spec.sweep) return goldenTraces(set, experimentalVariant(switchExperiment(name, spec, on)));
  const cases = new Map<string, ShadowCase>(set.cases.map((entry) => [entry.case.caseKey, entry.case]));
  return sweepTraces(sweepBase(set, name, spec), cases, sweepSwitches({ [name]: on }));
}

/** One switch, off then on, on the same frozen set. */
export function replaySwitch(set: GoldenSet, name: string, notReplayable: NotReplayableReason = NOT_REPLAYABLE_REASONS[name] ?? null): SwitchReceipt {
  const spec = SWITCH_REPLAYS[name];
  const goldenSet = { version: set.version, manifestSha256: set.manifestSha256, members: { total: set.manifest.members.length, measured: set.cases.length + set.regression.length, notLoaded: set.notLoaded.length, problems: set.problems.length }, notLoadedIds: set.notLoaded };
  if (!spec) {
    return { switch: name, status: notReplayable ? "not_replayable" : "no_reason", scope: null, replays: null, keepsCodeValue: null,
      reason: notReplayable ?? `no replay is mapped in \`SWITCH_REPLAYS\` and no reason is stated in \`NOT_REPLAYABLE_REASONS\``,
      goldenSet, off: null, on: null, comparison: null, worse: [], worseFees: [], gainedFees: [] };
  }
  const offTraces = switchRun(set, name, spec, false);
  const onTraces = switchRun(set, name, spec, true);
  const offConfig = switchExperiment(name, spec, false);
  const onConfig = switchExperiment(name, spec, true);
  const off = measureGoldenSet(set, experimentalVariant(offConfig), { traces: offTraces });
  const on = measureGoldenSet(set, experimentalVariant(onConfig), { traces: onTraces });
  const [offBy, onBy] = [byCase(offTraces), byCase(onTraces)];
  const comparison = compareGoldenSet(off, on);
  const worse = worseNumbers(comparison);
  const worseFees: WorseFee[] = comparison.lost.map((entry) => ({ member: entry.id, change: "lost", fee: entry.fee }));
  for (const member of comparison.moreWrong) {
    const before = new Set(wrongPublications(set, member.id, offBy).map(feeKey));
    for (const fee of wrongPublications(set, member.id, onBy)) {
      if (!before.has(feeKey(fee))) worseFees.push({ member: member.id, change: "wrong_published", fee: asRef(fee) });
    }
  }
  for (const member of comparison.moreLetThrough) {
    if (member.id.startsWith("regression:")) {
      worseFees.push({ member: member.id, change: "let_through", fee: takedownFee(set, member.id) });
      continue;
    }
    const before = new Set(letThroughFees(set, member.id, offBy).map(feeKey));
    for (const fee of letThroughFees(set, member.id, onBy)) {
      if (!before.has(feeKey(fee))) worseFees.push({ member: member.id, change: "let_through", fee });
    }
  }
  const status = !comparison.comparable ? "not_comparable" : worse.length > 0 ? "fail" : "pass";
  const { lost, gained, moreWrong, moreLetThrough, ...rates } = comparison;
  return {
    switch: name, status, scope: spec.scope, replays: spec.replays, keepsCodeValue: spec.keepsCodeValue ?? null,
    reason: comparison.comparable ? null : comparison.reason,
    goldenSet: { version: off.version, manifestSha256: off.manifestSha256, members: off.members, notLoadedIds: set.notLoaded },
    off: { recall: off.recall, precision: off.precision, knownWrongRefused: off.knownWrongRefused },
    on: { recall: on.recall, precision: on.precision, knownWrongRefused: on.knownWrongRefused },
    comparison: { ...rates, lost: lost.length, gained: gained.length, moreWrong: moreWrong.length, moreLetThrough: moreLetThrough.length, membersChanged: membersChanged(off, on) },
    worse, worseFees,
    gainedFees: gained.map((entry) => ({ member: entry.id, fee: entry.fee })),
  };
}

/**
 * Switches a diff turns on: a code constant defined `true` on an added line of non-test source
 * whose removed lines do not define it `true` (a flip from false, or a new switch added on).
 * An environment switch flips outside the code, so a diff cannot show it.
 */
export function switchesTurnedOnInDiff(diff: string): string[] {
  const addedTrue = new Set<string>();
  const removedTrue = new Set<string>();
  let skip = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.split(" b/").pop() ?? "";
      skip = isSwitchTooling(path) || isTestSource(path);
    }
    if (skip || !/^[+-]/.test(line) || line.startsWith("+++") || line.startsWith("---")) continue;
    const match = /\bconst\s+([A-Z][A-Z0-9_]*_LIVE)\b\s*(?::\s*boolean)?\s*=\s*true\b/.exec(line);
    if (match) (line.startsWith("+") ? addedTrue : removedTrue).add(match[1]);
  }
  return [...addedTrue].filter((name) => !removedTrue.has(name)).sort();
}

/** Switches whose `NOT_REPLAYABLE_REASONS` line is on an added line of this diff. */
export function reasonsStatedInDiff(diff: string): string[] {
  const names = new Set<string>();
  let inReplay = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) inReplay = (line.split(" b/").pop() ?? "") === "src/lib/agents/deming/switch-replay.ts";
    const match = inReplay ? /^\+\s*([A-Z][A-Z0-9_]*_LIVE):\s*[`"]/.exec(line) : null;
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

/**
 * The receipt of a switch the golden set cannot replay, as the gate judges it: a stated reason
 * passes it loudly, no reason fails, and a switch this diff turns on fails unless the same diff
 * adds its reason line.
 */
export function unreplayableVerdict(receipt: SwitchReceipt, turnedOn: ReadonlySet<string>, statedInDiff: ReadonlySet<string>): string | null {
  if (receipt.status === "no_reason") return `${receipt.switch} has no replay and no stated reason: add a replay (\`SWITCH_REPLAYS\` or \`SWEEP_REPLAYS\`) or its line in \`NOT_REPLAYABLE_REASONS\``;
  if (receipt.status !== "not_replayable") return null;
  if (turnedOn.has(receipt.switch) && !statedInDiff.has(receipt.switch)) {
    return `${receipt.switch} is turned on in this PR with no golden-set replay: state why in this PR by adding (or rewording) its line in \`NOT_REPLAYABLE_REASONS\` (src/lib/agents/deming/switch-replay.ts), or add a replay`;
  }
  return null;
}


/** Tests and fixtures name switches without defining or reading them. */
export const isTestSource = (path: string) => /\.test\.tsx?$|\.fixtures\.ts$|\/__fixtures__\//.test(path);
/**
 * The gate and inventory name switches to map them, and the read-only dry-run audit (#2842) names
 * the switches it counts; editing them turns no switch on.
 */
export const isSwitchTooling = (path: string) =>
  /^src\/lib\/agents\/deming\/switch-(inventory|replay|gate)(\.test)?\.ts$/.test(path)
  || /^src\/lib\/agents\/deming\/switch-dry-runs\//.test(path)
  || /^src\/lib\/data-store\/switch-dry-runs(\.db)?(\.test)?\.ts$/.test(path);

/** At most this many switches replay for one diff; more get a "too many" receipt (about 70 s each). */
export const MAX_SWITCHES_PER_DIFF = 6;

/**
 * A switch counts as named by a PR when an added or removed line of non-test source in its diff
 * names it. Tests, fixtures and the gate's own files are skipped.
 */
export function switchesNamedInDiff(diff: string, known: ReadonlySet<string>): string[] {
  const { added, removed } = namesOnChangedLines(diff);
  return [...new Set([...added, ...removed])].filter((name) => known.has(name)).sort();
}

/** Every `*_LIVE` name on an added or a removed line of non-test source. */
function namesOnChangedLines(diff: string): { added: Set<string>; removed: Set<string> } {
  const added = new Set<string>();
  const removed = new Set<string>();
  let skip = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.split(" b/").pop() ?? "";
      skip = isSwitchTooling(path) || isTestSource(path);
    }
    if (skip || !/^[+-]/.test(line) || line.startsWith("+++") || line.startsWith("---")) continue;
    for (const match of line.matchAll(/\b[A-Z][A-Z0-9_]*_LIVE\b/g)) (line.startsWith("-") ? removed : added).add(match[0]);
  }
  return { added, removed };
}

/**
 * Switches retired under the 14-day rule (DECISIONS, 2026-11-01). A PR that removes a switch's last
 * use adds its name here with the on-date and receipts it cites, so the removal is reviewed in the
 * diff. Any other `*_LIVE` name that disappears from `src/` fails the gate.
 */
export const RETIRED_SWITCHES: Readonly<Record<string, string>> = {};

/**
 * `*_LIVE` names on a removed line of non-test source that appear nowhere in the PR head's `src/`:
 * a deleted or renamed switch. Deleting `FOO_LIVE = false` with its guard turns the path on
 * everywhere, and the head scan no longer sees the name, so it is collected here instead.
 */
export function switchesRemovedInDiff(diff: string, headNames: ReadonlySet<string>): string[] {
  return [...namesOnChangedLines(diff).removed].filter((name) => !headNames.has(name)).sort();
}

/** The receipt for a removed name: it fails, unless the name is listed in `RETIRED_SWITCHES`. */
export function removedSwitchReceipt(name: string, retired: Readonly<Record<string, string>> = RETIRED_SWITCHES): SwitchReceipt {
  const note = retired[name];
  return {
    switch: name, status: note ? "retired" : "removed", scope: null, replays: null, keepsCodeValue: null,
    reason: note
      ? `retired under the 14-day rule: ${note}`
      : "the PR removes every use of this name from `src/`, so its code path changes everywhere with no golden-set replay. " +
        "If it is retired under the 14-day rule, add it to `RETIRED_SWITCHES` in `src/lib/agents/deming/switch-replay.ts` with its on-date and receipts. " +
        "If it is renamed, the new name gets its own receipt",
    goldenSet: null, off: null, on: null, comparison: null, worse: [], worseFees: [], gainedFees: [],
  };
}

/** What a PR naming more than `MAX_SWITCHES_PER_DIFF` switches fails with: the local command to run. */
export function tooManyMessage(names: readonly string[]): string {
  return `TOO MANY: this PR names ${names.length} switches (cap ${MAX_SWITCHES_PER_DIFF}), so none was replayed in CI. ` +
    `Run them locally and paste the receipts into the PR: \`SWITCH_GATE_SWITCHES=${names.join(",")} npx vitest run src/lib/agents/deming/switch-gate.test.ts\`.`;
}

const percent = (rate: number | null) => (rate == null ? "n/a" : `${(rate * 100).toFixed(2)}%`);
const points = (delta: number | null) => (delta == null ? "n/a" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)} pt`);
const feeText = (fee: FeeRef) => `${fee.canonicalFeeKey ?? "?"} ${fee.amountCents == null ? "varies" : `$${(fee.amountCents / 100).toFixed(2)}`}${fee.feeName ? ` "${fee.feeName}"` : ""}`;
const STATUS_LINE: Record<SwitchReceipt["status"], string> = {
  pass: "PASS: no number got worse with the switch on",
  fail: "FAIL: a number got worse with the switch on",
  not_replayable: "NOT REPLAYABLE: the golden set cannot replay this switch; it passes only on the reason stated below, which review reads",
  no_reason: "NOT REPLAYABLE, NO REASON STATED: this receipt fails until a replay or a reason in NOT_REPLAYABLE_REASONS is added",
  not_comparable: "NOT COMPARABLE: the off and on runs measured different members",
  removed: "REMOVED: the PR deletes this switch name from src/ with no replay, so this receipt fails",
  retired: "RETIRED: removed under the 14-day rule and listed in RETIRED_SWITCHES",
};
const SHOWN_FEES = 25;
const CHANGE_TEXT: Record<WorseFee["change"], string> = {
  lost: "expected fee lost",
  wrong_published: "wrong fee published",
  let_through: "known-wrong fee let through",
};

/** The receipt a PR carries for one switch, as Markdown. */
export function renderReceipt(receipt: SwitchReceipt): string {
  const lines = [`### ${receipt.switch}: ${STATUS_LINE[receipt.status]}`, ""];
  const g = receipt.goldenSet;
  if (g) lines.push(`Golden set v${g.version} (members sha256 \`${g.manifestSha256.slice(0, 12)}\`): ${g.members.measured} of ${g.members.total} members measured, ${g.members.notLoaded} answer-key banks not loaded, ${g.members.problems} problems.`, "");
  if (g?.notLoadedIds) lines.push(notLoadedNote(g.notLoadedIds), "");
  if (receipt.status === "not_replayable" || receipt.status === "no_reason" || receipt.status === "removed" || receipt.status === "retired") {
    lines.push(`Why: ${receipt.reason}.`, "");
    return lines.join("\n");
  }
  lines.push(`Replay (${receipt.scope}): ${receipt.replays}.`);
  if (receipt.keepsCodeValue) lines.push(`Keeps the PR head's code value: ${receipt.keepsCodeValue}.`);
  if (receipt.reason) lines.push(`Not comparable: ${receipt.reason}.`);
  const off = receipt.off;
  const on = receipt.on;
  const c = receipt.comparison;
  if (off && on && c) {
    lines.push("", "| Measure | Switch off | Switch on | Change |", "| --- | --- | --- | --- |",
      `| Recall | ${percent(off.recall.rate)} (${off.recall.found}/${off.recall.expected}) | ${percent(on.recall.rate)} (${on.recall.found}/${on.recall.expected}) | ${points(c.recall.delta)} |`,
      `| Precision | ${percent(off.precision.rate)} (${off.precision.correct}/${off.precision.judged}) | ${percent(on.precision.rate)} (${on.precision.correct}/${on.precision.judged}) | ${points(c.precision.delta)} |`,
      `| Known-wrong refused | ${percent(off.knownWrongRefused.rate)} (${off.knownWrongRefused.refused}/${off.knownWrongRefused.cases}) | ${percent(on.knownWrongRefused.rate)} (${on.knownWrongRefused.refused}/${on.knownWrongRefused.cases}) | ${points(c.knownWrongRefused.delta)} |`,
      `| Expected fees lost | | ${c.lost} | |`,
      `| Expected fees gained | | ${c.gained} | |`,
      `| Members publishing more known-wrong fees | | ${c.moreWrong} | |`,
      `| Members letting more known-wrong fees or takedowns through | | ${c.moreLetThrough} | |`,
      `| Members whose result changed | | ${c.membersChanged} | |`);
    if (c.membersChanged === 0) {
      lines.push("", "No golden-set member moved: the set holds no case this switch changes, so this pass shows only that nothing regressed.");
    }
  }
  if (receipt.worse.length > 0) lines.push("", `Got worse: ${receipt.worse.join(", ")}.`);
  if (receipt.worseFees.length > 0) {
    lines.push("", "Fees that got worse:");
    for (const fee of receipt.worseFees.slice(0, SHOWN_FEES)) {
      lines.push(`- ${CHANGE_TEXT[fee.change]}: ${fee.fee ? feeText(fee.fee) : "a confirmed takedown"} (${fee.member})`);
    }
    if (receipt.worseFees.length > SHOWN_FEES) lines.push(`- and ${receipt.worseFees.length - SHOWN_FEES} more (the JSON receipt lists all)`);
  }
  if (receipt.gainedFees.length > 0) {
    lines.push("", "Expected fees gained:");
    for (const fee of receipt.gainedFees.slice(0, SHOWN_FEES)) lines.push(`- ${feeText(fee.fee)} (${fee.member})`);
    if (receipt.gainedFees.length > SHOWN_FEES) lines.push(`- and ${receipt.gainedFees.length - SHOWN_FEES} more`);
  }
  lines.push("");
  return lines.join("\n");
}
