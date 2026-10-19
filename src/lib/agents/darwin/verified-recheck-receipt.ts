import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import type { DarwinReasonCode } from "./verify";

export const RECHECK_RECEIPT_PROTOCOL = "darwin.recheck.receipt.v1";
const SAMPLE_LIMIT = 20;
// Only these fixed codes can leave the producer in this receipt. New producer codes need review.
const REASONS = [
  "missing_canonical", "missing_name", "category_mismatch", "missing_lineage", "invalid_amount",
  "not_in_source", "outside_envelope", "peer_outlier", "duplicate_in_batch", "duplicate_verified",
  "percent_not_publishable", "category_lesson_pending", "retired_category", "conditional_zero",
  "tier_perk_zero", "name_rule", "insert_failed",
] as const satisfies readonly DarwinReasonCode[];
const REASON_SET = new Set<string>(REASONS);
const CATEGORIES = new Set(Object.values(CANONICAL_KEY_MAP));
const INVALID = Symbol("unreadable field");
type RecordValue = Record<string, unknown>;
type State = "reported" | "not_run" | "unavailable" | "invalid";
type SafeSample = Record<string, number | string | null>;

interface ReportedSamples {
  reportedCount: number | null;
  samples: SafeSample[];
  sampleLimit: number;
  omittedCount: number | null;
  invalidSampleCount: number;
}

interface ShadowReceipt {
  state: "reported" | "not_reported" | "invalid";
  scope: "producer_assessed_in_selected_batch";
  read?: number | null;
  due?: number | null;
  wouldFail?: Partial<Record<DarwinReasonCode, number | null>> | null;
  wouldConfirm?: Partial<Record<DarwinReasonCode, number | null>> | null;
  wouldClear?: number | null;
  reasonMapScope: "allowlisted_codes_only";
  reasonMapCompleteness: "unknown";
  hasError: boolean | null;
  errorCode: "shadow_assessment_error" | "invalid_error_field" | null;
  sample: ReportedSamples;
}

export interface VerifiedRecheckReceipt {
  protocol: typeof RECHECK_RECEIPT_PROTOCOL;
  state: State;
  reasonCode: "dry_run" | "learning_unavailable" | "missing_report" | "invalid_report" | null;
  assessmentCompleteness: "unknown";
  outcomeBasis: "producer_reported_not_affected_rows";
  checked: number | null;
  passed: number | null;
  cleared: number | null;
  flagged: number | null;
  waiting: number | null;
  secondLookOtherCode: number | null;
  rejected: ReportedSamples;
  restored: ReportedSamples;
  takenDown: ReportedSamples;
  olderLive: ShadowReceipt;
  dueSecondLooks: ShadowReceipt;
  invalidFields: string[];
}

function record(value: unknown): RecordValue | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null ? value as RecordValue : null;
}

// Never execute accessors or toJSON/toString while projecting untrusted producer fields.
function field(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && !("value" in descriptor) ? INVALID : descriptor?.value;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function id(value: unknown): number | null {
  const parsed = count(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function emptySamples(): ReportedSamples {
  return { reportedCount: null, samples: [], sampleLimit: SAMPLE_LIMIT, omittedCount: null, invalidSampleCount: 0 };
}

function emptyShadow(): ShadowReceipt {
  return { state: "not_reported", scope: "producer_assessed_in_selected_batch", reasonMapScope: "allowlisted_codes_only", reasonMapCompleteness: "unknown", hasError: null, errorCode: null, sample: emptySamples() };
}

function emptyReceipt(state: State, reasonCode: VerifiedRecheckReceipt["reasonCode"]): VerifiedRecheckReceipt {
  return {
    protocol: RECHECK_RECEIPT_PROTOCOL, state, reasonCode,
    assessmentCompleteness: "unknown", outcomeBasis: "producer_reported_not_affected_rows",
    checked: null, passed: null, cleared: null, flagged: null, waiting: null, secondLookOtherCode: null,
    rejected: emptySamples(), restored: emptySamples(), takenDown: emptySamples(),
    olderLive: emptyShadow(), dueSecondLooks: emptyShadow(), invalidFields: [],
  };
}

/** A bounded projection, not an attestation that the producer selected or updated every row. */
function legacyVerifiedRecheckReceipt(
  input: unknown,
  context: { dryRun: unknown; learning: unknown },
): VerifiedRecheckReceipt {
  try {
    if (input == null) {
      return context.dryRun === true ? emptyReceipt("not_run", "dry_run")
        : context.learning === false ? emptyReceipt("not_run", "learning_unavailable")
        : emptyReceipt("unavailable", "missing_report");
    }
    const source = record(input);
    if (!source) return emptyReceipt("invalid", "invalid_report");
    const result = emptyReceipt("reported", null);
    const invalid = (path: string) => { result.invalidFields.push(path); };
    const numberField = (obj: object, key: string, path: string): number | null => {
      const parsed = count(field(obj, key));
      if (parsed === null) invalid(path);
      return parsed;
    };
    const samples = (value: unknown, path: string, kind: "id" | "rejected" | "older" | "due"): ReportedSamples => {
      if (!Array.isArray(value)) { invalid(path); return emptySamples(); }
      const length = count(field(value, "length"));
      if (length === null) { invalid(path); return emptySamples(); }
      const output = { ...emptySamples(), reportedCount: length };
      // Inspect at most the first 20 positions; never refill from an unbounded invalid tail.
      for (let index = 0; index < Math.min(length, SAMPLE_LIMIT); index++) {
        const entry = field(value, String(index));
        let projected: SafeSample | null = null;
        if (kind === "id") {
          const feeVerifiedId = id(entry);
          if (feeVerifiedId !== null) projected = { feeVerifiedId };
        } else {
          const row = record(entry);
          if (row) {
            const code = field(row, "code");
            const feeVerifiedId = id(field(row, "feeVerifiedId"));
            if (kind === "rejected") {
              if (feeVerifiedId !== null && typeof code === "string" && REASON_SET.has(code)) projected = { feeVerifiedId, code };
            } else {
              const feePublishedId = id(field(row, "feePublishedId"));
              const institutionId = id(field(row, "institutionId"));
              const canonicalFeeKey = field(row, "canonicalFeeKey");
              const amount = field(row, "amount");
              if (feePublishedId !== null && institutionId !== null && (kind === "due" || feeVerifiedId !== null)
                && typeof canonicalFeeKey === "string" && CATEGORIES.has(canonicalFeeKey)
                && typeof code === "string" && REASON_SET.has(code)
                && (amount === null || (typeof amount === "number" && Number.isFinite(amount) && amount >= 0))) {
                projected = { feePublishedId, institutionId, canonicalFeeKey, amount, code,
                  ...(kind === "older" ? { feeVerifiedId } : {}) };
              }
            }
          }
        }
        if (projected) output.samples.push(projected);
        else output.invalidSampleCount++;
      }
      output.omittedCount = length - output.samples.length;
      if (output.invalidSampleCount > 0) invalid(`${path}.sample`);
      return output;
    };
    const reasonMap = (value: unknown, path: string) => {
      const sourceMap = record(value);
      if (!sourceMap) { invalid(path); return null; }
      const output: Partial<Record<DarwinReasonCode, number | null>> = {};
      // No Object.keys/entries of producer maps: arbitrary/large/error keys never leave here.
      for (const code of REASONS) {
        if (field(sourceMap, code) !== undefined) output[code] = numberField(sourceMap, code, `${path}.${code}`);
      }
      return output;
    };
    const shadow = (value: unknown, path: "olderLive" | "dueSecondLooks"): ShadowReceipt => {
      if (value == null) return emptyShadow();
      const sourceShadow = record(value);
      if (!sourceShadow) { invalid(path); return { ...emptyShadow(), state: "invalid" }; }
      const before = result.invalidFields.length;
      const error = field(sourceShadow, "error");
      const hasError = error === undefined ? false : typeof error === "string" ? true : null;
      if (hasError === null) invalid(`${path}.error`);
      const projected: ShadowReceipt = {
        ...emptyShadow(), state: "reported", hasError,
        errorCode: hasError === true ? "shadow_assessment_error" : hasError === null ? "invalid_error_field" : null,
        sample: samples(field(sourceShadow, "samples"), `${path}.samples`, path === "olderLive" ? "older" : "due"),
        ...(path === "olderLive"
          ? { read: numberField(sourceShadow, "read", `${path}.read`), wouldFail: reasonMap(field(sourceShadow, "wouldFail"), `${path}.wouldFail`) }
          : { due: numberField(sourceShadow, "due", `${path}.due`), wouldConfirm: reasonMap(field(sourceShadow, "wouldConfirm"), `${path}.wouldConfirm`), wouldClear: numberField(sourceShadow, "wouldClear", `${path}.wouldClear`) }),
      };
      if (result.invalidFields.length > before) projected.state = "invalid";
      return projected;
    };
    for (const key of ["checked", "passed", "cleared", "flagged", "waiting"] as const) result[key] = numberField(source, key, key);
    const other = field(source, "secondLookOtherCode");
    // Optional does not mean zero, including reports from before this field existed.
    result.secondLookOtherCode = other === undefined ? null : numberField(source, "secondLookOtherCode", "secondLookOtherCode");
    result.rejected = samples(field(source, "rejected"), "rejected", "rejected");
    result.restored = samples(field(source, "restored"), "restored", "id");
    result.takenDown = samples(field(source, "takenDown"), "takenDown", "id");
    const coreInvalid = result.invalidFields.length > 0;
    result.olderLive = shadow(field(source, "olderLive"), "olderLive");
    result.dueSecondLooks = shadow(field(source, "dueSecondLooks"), "dueSecondLooks");
    if (coreInvalid) { result.state = "invalid"; result.reasonCode = "invalid_report"; }
    return result;
  } catch {
    // Proxies/accessors and malformed packets cannot roll back otherwise valid verification.
    return emptyReceipt("invalid", "invalid_report");
  }
}

export const ATTESTED_RECHECK_RECEIPT_PROTOCOL = "darwin.recheck.receipt.v2";
interface RecheckContext { dryRun: unknown; learning: unknown; runId?: number; stepId?: number; }
export interface AttestedRecheckReceipt extends Omit<VerifiedRecheckReceipt, "protocol" | "state" | "outcomeBasis" | "reasonCode" | "assessmentCompleteness"> {
  protocol: typeof ATTESTED_RECHECK_RECEIPT_PROTOCOL;
  state: "referenced" | "unavailable" | "invalid";
  scope: "selected_batch";
  outcomeBasis: "producer_transaction_event_reference";
  producerEventId: number | null;
  runId: number | null;
  stepId: number | null;
  assessmentCompleteness: "complete" | "partial" | "unavailable";
  selected: number | null;
  assessed: number | null;
  settled: number | null;
  unresolved: number | null;
  reasonCode: string | null;
  phases: Record<string, string | null>;
  effects: { restored: number | null; rejected: number | null; takenDown: number | null; flagged: number | null; cleared: number | null; waiting: number | null };
  unresolvedSamples: Array<{ feeVerifiedId: number; code: string }>;
  report: VerifiedRecheckReceipt;
}
const EXECUTION_REASONS = new Set(["invalid_run_context","transaction_unavailable","selection_failed","source_unavailable","identity_changed","settlement_failed","producer_witness_failed"]);
const PHASE_STATES = new Set(["complete","partial","unavailable","not_run","cadence_skip","reported_unknown"]);
/** v2 references a producer's real event. It never upgrades legacy v1 reports or remeasures fees. */
export function verifiedRecheckReceipt(input: unknown, context: RecheckContext): VerifiedRecheckReceipt | AttestedRecheckReceipt {
  const legacy = legacyVerifiedRecheckReceipt(input, context);
  try {
    const inputRecord = record(input);
    const execution = record(inputRecord && field(inputRecord, "execution"));
    if (!execution || field(execution,"protocol") !== "darwin.recheck.execution.v1") return legacy;
    const runId = id(field(execution,"runId")), stepId = id(field(execution,"stepId"));
    const eventId = id(field(execution,"eventId"));
    const state = field(execution,"state");
    const validContext = runId !== null && stepId !== null && runId === context.runId && stepId === context.stepId;
    const phases = record(field(execution,"phases"));
    const selected=count(field(execution,"selected")),assessed=count(field(execution,"assessed")),settled=count(field(execution,"settled")),unresolved=count(field(execution,"unresolved"));
    const phaseKeys=["primary","due","source","olderShadow","dueShadow"];
    const phaseShape=phases!==null && phaseKeys.every(key=>typeof field(phases,key)==="string" && PHASE_STATES.has(field(phases,key) as string));
    const countsShape=assessed!==null && settled!==null && unresolved!==null && assessed<=1600 && settled<=assessed && unresolved<=1600
      && (selected===null ? state==="unavailable" && assessed===0 && settled===0 && unresolved===0
        : selected<=1600 && assessed<=selected && legacy.secondLookOtherCode!==null && settled+unresolved+legacy.secondLookOtherCode===selected);
    const completeShape=state!=="complete" || (phases!==null && field(phases,"primary")==="complete" && (field(phases,"due")==="complete" || field(phases,"due")==="not_run") && field(phases,"source")==="complete" && unresolved===0);
    const referenced = validContext && eventId !== null && phaseShape && countsShape && completeShape && (state === "complete" || state === "partial" || state === "unavailable");
    const code = field(execution,"reasonCode");
    const returnedSamples = field(execution,"samples");
    const samples: Array<{ feeVerifiedId: number; code: string }> = [];
    if (Array.isArray(returnedSamples)) for (let i=0;i<Math.min(returnedSamples.length,20);i++) {
      const sample = record(field(returnedSamples,String(i))), sampleId = sample && id(field(sample,"feeVerifiedId")), sampleCode = sample && field(sample,"code");
      if (sampleId && typeof sampleCode === "string" && EXECUTION_REASONS.has(sampleCode)) samples.push({feeVerifiedId:sampleId,code:sampleCode});
    }
    return {
      ...legacy,
      protocol: ATTESTED_RECHECK_RECEIPT_PROTOCOL, state: referenced ? "referenced" : validContext && eventId===null ? "unavailable" : "invalid",
      scope: "selected_batch", outcomeBasis: "producer_transaction_event_reference", producerEventId: referenced ? eventId : null,
      runId, stepId, assessmentCompleteness: referenced ? state === "complete" ? "complete" : state === "partial" ? "partial" : "unavailable" : "unavailable",
      selected, assessed, settled, unresolved,
      reasonCode: typeof code === "string" && EXECUTION_REASONS.has(code) ? code : null,
      phases: Object.fromEntries(["primary","due","source","olderShadow","dueShadow"].map(key => {
        const value = phases && field(phases,key); return [key,typeof value === "string" && PHASE_STATES.has(value) ? value : null];
      })),
      effects: { restored: referenced ? legacy.restored.reportedCount : null, rejected: referenced ? legacy.rejected.reportedCount : null,
        takenDown: referenced ? legacy.takenDown.reportedCount : null, flagged: referenced ? legacy.flagged : null, cleared: referenced ? legacy.cleared : null, waiting: referenced ? legacy.waiting : null },
      unresolvedSamples: samples, report: legacy,
    };
  } catch { return legacy; }
}

/** Render only this protocol's safe fields; legacy/malformed stored values never supply prose. */
export function recheckReceiptNote(input: unknown): string {
  try {
    const receipt = record(input);
    if (!receipt) return "";
    if (field(receipt,"protocol") === ATTESTED_RECHECK_RECEIPT_PROTOCOL) {
      const shown = (value: unknown) => count(value)?.toLocaleString("en-US") ?? "unavailable";
      const eventId = id(field(receipt,"producerEventId"));
      if (field(receipt,"state") !== "referenced" || eventId === null) return " Recheck execution unavailable; no committed producer witness referenced. Unresolved inputs remain eligible for ordinary retry.";
      const effects = record(field(receipt,"effects"));
      return ` Recheck selected-batch witness #${eventId}: ${shown(field(receipt,"assessed"))} assessed, ${shown(field(receipt,"settled"))} settled assessments, ${shown(field(receipt,"unresolved"))} unresolved; ${shown(effects && field(effects,"restored"))} restored, ${shown(effects && field(effects,"rejected"))} rejected, ${shown(effects && field(effects,"takenDown"))} archived. Selected-batch assessment ${field(receipt,"assessmentCompleteness") === "complete" ? "complete" : field(receipt,"assessmentCompleteness") === "partial" ? "partial" : "unavailable"}; whole backlog unknown. This receipt references the producer transaction event, not a new measurement or policy decision.`;
    }
    if (field(receipt, "protocol") !== RECHECK_RECEIPT_PROTOCOL) return "";
    const state = field(receipt, "state");
    if (state === "not_run") {
      const reason = field(receipt, "reasonCode");
      return reason === "dry_run" ? " Recheck not run: verification dry run."
        : reason === "learning_unavailable" ? " Recheck not run: learning log unavailable."
        : " Recheck report invalid; assessment completeness unknown.";
    }
    if (state === "unavailable") return " Recheck report unavailable; cause and assessment completeness unknown.";
    if (state !== "reported" && state !== "invalid") return " Recheck report invalid; assessment completeness unknown.";
    const shown = (value: unknown) => count(value)?.toLocaleString("en-US") ?? "unavailable";
    const outcome = (key: string) => {
      const list = record(field(receipt, key));
      return shown(list && field(list, "reportedCount"));
    };
    const shadowNote = (key: string, label: string, counter: string) => {
      const value = record(field(receipt, key));
      if (!value || field(value, "state") === "not_reported") return ` ${label}: not reported.`;
      if (field(value, "state") !== "reported" && field(value, "state") !== "invalid") return ` ${label}: report invalid.`;
      return ` ${label}: ${shown(field(value, counter))} assessed in the selected batch${field(value, "hasError") === true ? "; assessment error reported" : ""}${field(value, "state") === "invalid" ? "; invalid fields unavailable" : ""}.`;
    };
    return ` Recheck producer report: ${shown(field(receipt, "checked"))} checked, ${shown(field(receipt, "passed"))} passed, ${outcome("rejected")} rejection reports, ${outcome("restored")} restoration reports, ${shown(field(receipt, "cleared"))} cleared, ${shown(field(receipt, "flagged"))} flagged, ${shown(field(receipt, "waiting"))} waiting, ${outcome("takenDown")} takedown reports, ${shown(field(receipt, "secondLookOtherCode"))} other-code second looks.${state === "invalid" ? " Invalid fields unavailable." : ""}${shadowNote("olderLive", "Older-live shadow", "read")}${shadowNote("dueSecondLooks", "Due-second-look shadow", "due")} Assessment completeness unknown; reported IDs do not verify affected rows.`;
  } catch {
    return " Recheck report invalid; assessment completeness unknown.";
  }
}
