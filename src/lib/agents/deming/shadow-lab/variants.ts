import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { withHeldNameRules } from "@/lib/agents/knox/rules";
import { withSectionPath } from "@/lib/section-path";
import { withHeldNameVocabulary } from "@/lib/agents/knox/held-name-vocabulary";
import { DASH_LIST_ROWS_LIVE } from "@/lib/agents/knox/dash-list-rows";
import { DAILY_CAP_LINES_LIVE } from "@/lib/daily-cap-wording";
import { refileCategory, checkFeeCategory, type CategoryGuardOptions } from "@/lib/fee-category-guard";
import {
  pendingCategoryLesson,
  postSourceCheck,
  sourceLineFor,
  statedInOwnSource,
  verificationReasonCode,
  verifiedFrequency,
  type RawFeeRow,
} from "@/lib/agents/darwin/verify";
import { tierPerkZero } from "@/lib/agents/darwin/tier-perk";
import { accountBenefitZeroOf } from "@/lib/account-benefit-zero";
import { zeroWaiverRowOf, zeroWaiverRowRead } from "@/lib/zero-waiver-row";
import { serviceMaintenanceOf, serviceMaintenanceRead } from "@/lib/service-maintenance-heading";
import { foldContext } from "@/lib/fee-fold";
import { withFootnotedAtmHeading } from "@/lib/fee-fold-atm-heading";
import { isProductPage } from "@/lib/agents/hamilton/product-page";
import { ZERO_FEE_RAW_FLAG, ZERO_FEE_VERIFIED_FLAG } from "@/lib/agents/darwin/envelopes";
import {
  decidePriorFee,
  HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE,
  publishedFeeName,
  publishNameHold,
  publishSkipReason,
  sameValueLinesApart,
  type PriorPublishedFeeRow,
} from "@/lib/agents/hamilton/publish";
import { toCents, toDollars, verifiedRow } from "./rows";
import type { PipelineVariant, ShadowCase, StageFee, StageOutput, VerifyResult } from "./types";

/**
 * The stages wired from today's pure functions: Knox's free read (`runFreeSpecialists`, filed as
 * Darwin files it), Darwin's per-row verify checks in `runDarwinVerify`'s order, and Hamilton's
 * publish order (category guard, name hold, skip reason, prior-fee decision). DB-bound parts are
 * not replayed: learned envelopes, the peer check, same-batch duplicates and Knox's lessons. An
 * experiment only passes different arguments to the same functions; no production code changes.
 */
export interface ExperimentConfig {
  id: string;
  description: string;
  /** The publish row carries Knox's excerpt, so the existing limit guard reads the line too. */
  excerptAtPublish: boolean;
  /** v146 (#2064): Knox's self-check and Darwin's verify trace daily caps the wider way (`dailyCapLines`). */
  dailyCapLines?: boolean;
  /** v148 (#1092): a dash list run may replace base's reads of its own lines (`DASH_LIST_ROWS_LIVE` on). */
  dashListRows?: boolean;
  /**
   * Plan step 4 (#2535): `*_LIVE` switches held on or off through the override parameters the
   * replayed functions already take (`deming/switch-replay.ts` maps each switch to its field).
   * Unset fields keep each function's own default, so a config without `switches` is today's pipeline.
   */
  switches?: SwitchOverrides;
}

export interface SwitchOverrides {
  /** `KNOX_HELD_NAME_RULES_LIVE`: every stage runs under `withHeldNameRules`. */
  heldNameRules?: boolean;
  /** `SECTION_PATH_LIVE` (#1092): every stage runs under `withSectionPath`. */
  sectionPath?: boolean;
  /**
   * v161's held-name vocabulary (#1092): every stage runs under `withHeldNameVocabulary`. Off is how the
   * paths that correct live fees read while `HELD_VOCABULARY_RELABEL_LIVE` is off.
   */
  heldNameVocabulary?: boolean;
  /** `KNOX_DISCONTINUED_TABLES_LIVE`: Knox's free read leaves discontinued tables out. */
  withoutDiscontinuedTables?: boolean;
  /** `NO_CHARGE_SENTENCE_READ_LIVE`: Knox's free read and Darwin's source trace. */
  noChargeSentences?: boolean;
  /** `FOOTNOTED_ATM_HEADING_LIVE` (#1092): every stage runs under `withFootnotedAtmHeading`, the module flag the fold's ATM heading read consults. */
  footnotedAtmHeading?: boolean;
  /** `DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE`: Darwin's post-source conditional-$0 check. */
  conditionalZeroLayout?: boolean;
  /**
   * `HTML_ROW_PAIRING_LIVE` (#1092, rosetta/html-row-pairing.ts): a Rosetta reader switch, so it
   * moves only the source replay's re-read of the answer-key documents' bytes. The frozen-text lab
   * replays stored text and reads it identically either way.
   */
  htmlRowPairing?: boolean;
  /**
   * Knox v165's service-heading hold and Darwin's matching refusal (#1092, `service-maintenance-heading.ts`).
   * Off is how main read before v165: the hold has no switch of its own, only its live re-check does
   * (`SERVICE_MAINTENANCE_TAKEDOWN_LIVE`), so this override exists to measure what the hold changes.
   */
  serviceMaintenanceHold?: boolean;
  /** Category guard switches: the replay's re-file of Knox's hint and Hamilton's publish guard. */
  category?: Pick<CategoryGuardOptions, "borrowedDirection" | "nonCustomerCashiersCheck" | "intlAbbreviation" | "loanPaymentNsf">;
}

const CURRENT_CONFIG: ExperimentConfig = {
  id: "current",
  description: "Today's free Knox read, Darwin's verify checks and Hamilton's publish gate.",
  excerptAtPublish: false,
};

export const DEFAULT_EXPERIMENT = "excerpt-at-publish";

export const EXPERIMENTS: Readonly<Record<string, ExperimentConfig>> = {
  "excerpt-at-publish": {
    id: "excerpt-at-publish",
    description:
      "Hamilton's publish-time limit guard reads Knox's excerpt, instead of leaving the excerpt to the live limit sweep after publication.",
    excerptAtPublish: true,
  },
  "dash-list-rows": {
    id: "dash-list-rows",
    description:
      "Knox reads a dash price-first list as its label rows even where that replaces base's reads of those lines (`DASH_LIST_ROWS_LIVE` switched on).",
    excerptAtPublish: false,
    dashListRows: true,
  },
  "section-path": {
    id: "section-path",
    description:
      "Every stage reads each line's section path (`SECTION_PATH_LIVE` switched on): Darwin's audience comes from the heading the path ties the fee to. The lab has no audience measure, so its numbers do not move; the read diff over the stored texts is the measure.",
    excerptAtPublish: false,
    switches: { sectionPath: true },
  },
  "held-name-vocabulary-off": {
    id: "held-name-vocabulary-off",
    description:
      "Every stage reads without Knox v161's held-name vocabulary, as main read and as the live-correction paths read while `HELD_VOCABULARY_RELABEL_LIVE` is off (Knox's re-read of Darwin's requests, Darwin's re-read category and re-file checks, the live name re-tidy, Hamilton's live name refresh). Current minus experimental is what the vocabulary adds to new reads; the relabel paths themselves are a database sweep the lab cannot replay (switch dry-run audit, section 6).",
    excerptAtPublish: false,
    switches: { heldNameVocabulary: false },
  },
  "service-maintenance-hold-off": {
    id: "service-maintenance-hold-off",
    description:
      "Every stage reads without Knox v165's service-heading hold and Darwin's matching refusal, as main read before them: a monthly maintenance row under a heading that names a service (\"Consumer Online Banking Services and Mobile Banking Fees\") is read as the account's fee. Current minus experimental is what the hold changes on the frozen texts; the live re-check behind `SERVICE_MAINTENANCE_TAKEDOWN_LIVE` is a database sweep the lab cannot replay (switch dry-run audit, section 9).",
    excerptAtPublish: false,
    switches: { serviceMaintenanceHold: false },
  },
  "footnoted-atm-heading": {
    id: "footnoted-atm-heading",
    description:
      "The retired-category fold reads an ATM heading with a note mark (\"Non-TBT or Non-Allpoint ATM1:\") and another bank named in several words (\"Non-Austin Bank ATM:\") (`FOOTNOTED_ATM_HEADING_LIVE` switched on), wherever a read is re-filed with its schedule section.",
    excerptAtPublish: false,
    switches: { footnotedAtmHeading: true },
  },
  "html-row-pairing": {
    id: "html-row-pairing",
    description:
      "Rosetta's HTML reader writes a label and its price that one DOM row holds (an ARIA row, a grid row of columns, a flex row) on one line (`HTML_ROW_PAIRING_LIVE` switched on). A reader switch: the frozen-text lab cannot move, and the source replay (`source-replay.test.ts`) re-reads the answer-key documents' bytes with it on.",
    excerptAtPublish: false,
    switches: { htmlRowPairing: true },
  },
  "daily-cap-lines": {
    id: "daily-cap-lines",
    description:
      "The shared check traces a daily cap the wider v146 way (`DAILY_CAP_LINES_LIVE` switched on) in Knox's self-check and Darwin's verify.",
    excerptAtPublish: false,
    dailyCapLines: true,
  },
};

export function selectExperiment(env: Readonly<Record<string, string | undefined>> = process.env): ExperimentConfig {
  const name = env.SHADOW_LAB_EXPERIMENT || DEFAULT_EXPERIMENT;
  const config = EXPERIMENTS[name];
  if (!config) {
    throw new Error(`unknown SHADOW_LAB_EXPERIMENT "${name}"; known: ${Object.keys(EXPERIMENTS).join(", ")}`);
  }
  return config;
}

/** The fixed document id every replayed line shares: one case is one stored document. */
const REPLAY_DOCUMENT_ID = 1;
const REPLAY_PUBLISHED_AT = "2026-01-01T00:00:00.000Z";
const REPLAY_URL = "https://bank.example/fees";

function filedAs(text: string, hint: string, name: string, amount: number, switches: SwitchOverrides = {}): string {
  const refile = switches.category
    ? { intlAbbreviation: switches.category.intlAbbreviation, loanPaymentNsf: switches.category.loanPaymentNsf }
    : undefined;
  return refileCategory(hint, name, foldContext(text, name, amount), refile) ?? hint;
}

function readText(text: string, dailyCapLines = false, dashListRows = false, switches: SwitchOverrides = {}): StageOutput {
  const result = runFreeSpecialists(text, {
    dailyCapLines,
    dashListRows,
    ...(switches.noChargeSentences == null ? {} : { noChargeSentences: switches.noChargeSentences }),
    ...(switches.withoutDiscontinuedTables == null ? {} : { withoutDiscontinuedTables: switches.withoutDiscontinuedTables }),
  });
  const serviceHold = switches.serviceMaintenanceHold !== false;
  // Knox v165 holds a monthly maintenance read under a service's heading for review, $0 or priced, on
  // Knox's own hint (`extract.ts`): never sent to Darwin.
  const serviceHeld = (hint: string | null, excerpt: string | null | undefined) =>
    serviceHold ? serviceMaintenanceOf({ line: excerpt, canonicalFeeKey: hint, documentText: text }) : null;
  const passed: StageFee[] = [];
  const dropped: StageFee[] = [];
  for (const candidate of result.candidates) {
    const fee: StageFee = {
      canonicalFeeKey: filedAs(text, candidate.canonicalHint, candidate.feeName, candidate.amount, switches),
      feeName: candidate.feeName,
      amountCents: toCents(candidate.amount),
      frequency: candidate.frequency ?? null,
      excerpt: candidate.excerpt ?? null,
      reason: null,
    };
    if (serviceHeld(candidate.canonicalHint, candidate.excerpt)) dropped.push({ ...fee, reason: "held:service_maintenance" });
    else passed.push(fee);
  }
  for (const held of result.held) {
    const fee: StageFee = {
      canonicalFeeKey: held.canonicalHint ? filedAs(text, held.canonicalHint, held.feeName, held.amount ?? 0, switches) : null,
      feeName: held.feeName,
      amountCents: toCents(held.amount),
      frequency: held.frequency ?? null,
      excerpt: held.excerpt ?? null,
      reason: null,
    };
    // A stated $0 with a category is a fee the free pipe keeps (`reproducibleReads`), unless Knox v163
    // holds it because its own line is no priced row (`zeroWaiverRowOf`, as `extract.ts` persists it).
    const waiverRow = held.shape === "zero" && zeroWaiverRowOf({ line: held.excerpt, amount: 0, documentText: text });
    if (waiverRow) dropped.push({ ...fee, reason: `held:zero_waiver_row:${waiverRow.kind}` });
    else if (held.shape === "zero" && serviceHeld(held.canonicalHint, held.excerpt)) dropped.push({ ...fee, reason: "held:service_maintenance" });
    else if (held.shape === "zero" && fee.canonicalFeeKey) passed.push({ ...fee, amountCents: 0 });
    else dropped.push({ ...fee, reason: `held:${held.shape}` });
  }
  return { passed, dropped };
}

/** A Knox row as Darwin reads it, for one fee of the replayed document. */
function rawRow(fee: StageFee): RawFeeRow {
  return {
    fee_raw_id: 1,
    institution_id: 1,
    source_url: REPLAY_URL,
    document_url: REPLAY_URL,
    document_r2_key: null,
    extraction_confidence: 0.95,
    fee_name: fee.feeName ?? "",
    amount: toDollars(fee.amountCents),
    frequency: fee.frequency ?? null,
    // Knox marks a stated $0 so Darwin can tell it from a missing price.
    outlier_flags: fee.amountCents === 0 ? [ZERO_FEE_RAW_FLAG] : [],
    conditions: `Knox deterministic extraction. excerpt="${fee.excerpt ?? ""}"`,
    source_document_id: REPLAY_DOCUMENT_ID,
  };
}

function verifyFee(fee: StageFee, text: string, dailyCapLines = false, switches: SwitchOverrides = {}): VerifyResult {
  const key = fee.canonicalFeeKey;
  const name = fee.feeName ?? "";
  if (!key) return { ok: false, reason: "missing_canonical" };
  const row = rawRow(fee);
  const amount = fee.amountCents == null ? null : fee.amountCents / 100;
  const texts = new Map([[REPLAY_DOCUMENT_ID, text]]);
  const trace = { dailyCapLines, ...(switches.noChargeSentences == null ? {} : { noChargeSentences: switches.noChargeSentences }) };
  const code =
    verificationReasonCode(row, key) ??
    (pendingCategoryLesson(key, name) ? "category_lesson_pending" : null) ??
    (statedInOwnSource(row, texts, key, trace) ? null : "not_in_source");
  if (code) return { ok: false, reason: code };
  const traced = sourceLineFor(row, texts, key, trace);
  const line = traced ?? fee.excerpt;
  const layout = switches.conditionalZeroLayout == null ? {} : { layout: switches.conditionalZeroLayout };
  const post = postSourceCheck(key, name, amount, line, text, layout);
  if (post) return { ok: false, reason: post.rule ? `${post.code}:${post.rule}` : post.code };
  if (tierPerkZero(amount, name, REPLAY_URL, text, key)) return { ok: false, reason: "tier_perk_zero" };
  if (amount === 0 && accountBenefitZeroOf({ line: fee.excerpt ?? line, documentText: text, feeName: name })) return { ok: false, reason: "account_benefit_zero" };
  if (zeroWaiverRowRead({ excerpt: fee.excerpt, tracedLine: traced, amount, documentText: text })) return { ok: false, reason: "zero_waiver_row" };
  if (switches.serviceMaintenanceHold !== false && serviceMaintenanceRead({ excerpt: fee.excerpt, tracedLine: traced, canonicalFeeKey: key, documentText: text })) {
    return { ok: false, reason: "service_maintenance_heading" };
  }
  // Darwin settles the frequency it verifies from Knox's own excerpt (insertCurrentVerifiedFee).
  return { ok: true, fee: { ...fee, frequency: verifiedFrequency(fee.excerpt, amount, fee.frequency ?? null, key) } };
}

function priorRow(fee: StageFee, index: number): PriorPublishedFeeRow {
  return {
    fee_published_id: index + 1,
    amount: toDollars(fee.amountCents),
    fee_name: fee.feeName ?? "",
    frequency: fee.frequency ?? null,
    published_at: REPLAY_PUBLISHED_AT,
    source_document_id: REPLAY_DOCUMENT_ID,
  } as PriorPublishedFeeRow;
}

function gateFee(config: ExperimentConfig, fee: StageFee, text: string, live: StageFee[]) {
  const key = fee.canonicalFeeKey ?? "";
  const name = fee.feeName ?? "";
  // As the publish step calls it (publish.ts): the published name, with the amount.
  const category = checkFeeCategory(
    key,
    publishedFeeName(name, key),
    { amount: fee.amountCents == null ? null : fee.amountCents / 100 },
    config.switches?.category,
  );
  if (!category.ok) return { publish: false, reason: `category_guard:${category.code}` };
  const hold = publishNameHold(name, key, fee.amountCents == null ? null : fee.amountCents / 100);
  if (hold) return { publish: false, reason: `name_hold:${hold.code}` };
  const row = verifiedRow(
    { canonical_fee_key: key, fee_name: name, amount: toDollars(fee.amountCents) ?? "0.00", source_document_id: REPLAY_DOCUMENT_ID },
    {
      frequency: fee.frequency ?? null,
      // Darwin flags every $0 it verifies, which is what lets a free fee publish.
      outlier_flags: fee.amountCents === 0 ? ["agentic_darwin_verified", ZERO_FEE_VERIFIED_FLAG] : ["agentic_darwin_verified"],
      // Not a VerifiedFeeRow column today: the limit guard reads `conditions` when it is present.
      ...(config.excerptAtPublish ? ({ conditions: `Knox deterministic extraction. excerpt="${fee.excerpt ?? ""}"` } as object) : {}),
    },
  );
  const skip = publishSkipReason(row, HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE);
  if (skip) return { publish: false, reason: `skip:${skip}` };
  const sameKey = live.filter((prior) => prior.canonicalFeeKey === key).map(priorRow);
  const apart = sameValueLinesApart(row, sameKey, text);
  const decision = decidePriorFee(row, sameKey, (prior) => apart.has(prior));
  if (decision.kind === "identical" || decision.kind === "older_document") {
    return { publish: false, reason: `prior:${decision.kind}` };
  }
  return { publish: true, reason: null };
}

function buildVariant(config: ExperimentConfig): PipelineVariant {
  const switches = config.switches ?? {};
  // `KNOX_HELD_NAME_RULES_LIVE` is a module flag every read consults, so each stage runs under it.
  const held = switches.heldNameRules;
  // `SECTION_PATH_LIVE` (#1092) is a module flag the audience read consults.
  const sectionPath = switches.sectionPath;
  const underHeld = <T>(read: () => T): T => (held == null ? read() : withHeldNameRules(held, read));
  // `FOOTNOTED_ATM_HEADING_LIVE` (#1092) is a module flag the fold's ATM heading read consults.
  const atmHeading = switches.footnotedAtmHeading;
  const underPath = <T>(read: () => T): T => (sectionPath == null ? underHeld(read) : withSectionPath(sectionPath, () => underHeld(read)));
  const underAtm = <T>(read: () => T): T => (atmHeading == null ? underPath(read) : withFootnotedAtmHeading(atmHeading, () => underPath(read)));
  // v161's held-name vocabulary is a module flag every name read consults.
  const vocabulary = switches.heldNameVocabulary;
  const under = <T>(read: () => T): T => (vocabulary == null ? underAtm(read) : withHeldNameVocabulary(vocabulary, () => underAtm(read)));
  return {
    id: config.id,
    description: config.description,
    documentGate(c: ShadowCase) {
      if (c.document.url && isProductPage(c.document.url)) return { accepted: false, reason: "product_page" };
      return { accepted: true, reason: null };
    },
    // Unset means the PR head's code value, so a replay runs the pipeline the head deploys.
    extract: (text) => under(() => readText(text, config.dailyCapLines ?? DAILY_CAP_LINES_LIVE, config.dashListRows ?? DASH_LIST_ROWS_LIVE, switches)),
    verify: (fee, text) => under(() => verifyFee(fee, text, config.dailyCapLines ?? DAILY_CAP_LINES_LIVE, switches)),
    publishGate: (fee, text, live) => under(() => gateFee(config, fee, text, live)),
  };
}

export const currentVariant: PipelineVariant = buildVariant(CURRENT_CONFIG);

export function experimentalVariant(config: ExperimentConfig): PipelineVariant {
  return buildVariant(config);
}
