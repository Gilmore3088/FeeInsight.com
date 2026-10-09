import { FEE_SOURCE_NAME, quarterLabel, readInstitutionPrices, type SqlTag } from "./common";
import { readFeeIncomeShare, readLocalIncome, readMarketConcentration, type DriverRead } from "./drivers";
import { buildFeeDependence, readDependencePanel } from "./fee-dependence";
import { buildInferredVolume, readIncomeAndFees, saveInferredVolume } from "./inferred-volume";
import { feeLabel, runPriceStudy, type Driver } from "./price-study";
import { findStudy, saveStudy, sourcesChanged, studiesSchemaReady, type Placement, type StudyRecord } from "./store";

/**
 * Hamilton's studies: statistical studies on the joined data, refreshed each quarter and
 * stored (hamilton_studies, hamilton_study_placements, inferred_fee_volume) so Hamilton
 * can cite a result and place one institution in it. Deterministic SQL and arithmetic;
 * never calls a model.
 *
 * Each study is one run step. A step stores nothing when its study already exists for
 * the same method and data period, so the daily cron refreshes a study as soon as new
 * data lands and is otherwise a cheap no-op.
 */

export const STUDY_STEP_KEYS = [
  "study-fee-dependence",
  "study-local-income",
  "study-concentration",
  "study-fee-income",
  "study-inferred-volume",
] as const;

export type StudyStepKey = (typeof STUDY_STEP_KEYS)[number];

export const STUDY_STEP_TITLES: Record<StudyStepKey, string> = {
  "study-fee-dependence": "Study fee dependence since 2010",
  "study-local-income": "Study local income against fee prices",
  "study-concentration": "Study market concentration against fee prices",
  "study-fee-income": "Study fee income against fee prices",
  "study-inferred-volume": "Infer overdraft and NSF items paid",
};

export function isStudyStep(stepKey: string): stepKey is StudyStepKey {
  return (STUDY_STEP_KEYS as readonly string[]).includes(stepKey);
}

export interface StudyStepResult {
  schemaReady: boolean;
  dryRun: boolean;
  studyKey: string;
  asOf: string;
  stored: boolean;
  alreadyCurrent: boolean;
  studyId: number | null;
  n: number;
  placements: number;
  headline: string;
  findings: Record<string, unknown>;
}

export const PRICE_STUDY_VERSION = 1;

const PRICE_DRIVERS: Record<"study-local-income" | "study-concentration" | "study-fee-income", {
  key: string;
  title: string;
  label: string;
  perUnits: number;
  perLabel: string;
  read: (db: SqlTag) => Promise<DriverRead>;
}> = {
  "study-local-income": {
    key: "local_income",
    title: "Local income and fee prices",
    label: "local median household income",
    perUnits: 10_000,
    perLabel: "$10,000 of local median household income",
    read: readLocalIncome,
  },
  "study-concentration": {
    key: "market_concentration",
    title: "Market concentration and fee prices",
    label: "metro deposit concentration (HHI)",
    perUnits: 1_000,
    perLabel: "1,000 points of metro deposit HHI",
    read: readMarketConcentration,
  },
  "study-fee-income": {
    key: "fee_income_share",
    title: "Fee income and fee prices",
    label: "fee income as a share of deposits",
    perUnits: 0.001,
    perLabel: "0.1 percentage point of fee income to deposits",
    read: readFeeIncomeShare,
  },
};

async function store(
  db: SqlTag,
  record: StudyRecord,
  placements: Placement[],
  opts: { runId: number | null; dryRun: boolean; force: boolean; schemaReady: boolean },
  after?: (studyId: number) => Promise<void>,
): Promise<Pick<StudyStepResult, "stored" | "alreadyCurrent" | "studyId">> {
  if (!opts.schemaReady || opts.dryRun) return { stored: false, alreadyCurrent: false, studyId: null };
  if (!opts.force) {
    const existing = await findStudy(db, record.studyKey, record.methodVersion, record.asOf);
    // Same period, same data: nothing to redo. A source with a newer period (a new Census year) rebuilds it.
    if (existing && !sourcesChanged(existing.sources, record.sources)) return { stored: false, alreadyCurrent: true, studyId: existing.id };
  }
  const studyId = await saveStudy(db, record, placements, opts.runId);
  if (after) await after(studyId);
  return { stored: true, alreadyCurrent: false, studyId };
}

export async function runStudyStep(
  stepKey: StudyStepKey,
  { db, runId, dryRun = false, force = false, now = new Date() }: { db: SqlTag; runId: number | null; dryRun?: boolean; force?: boolean; now?: Date },
): Promise<StudyStepResult> {
  const schemaReady = await studiesSchemaReady(db);
  const opts = { runId, dryRun, force, schemaReady };

  if (stepKey === "study-fee-dependence") {
    const built = buildFeeDependence(await readDependencePanel(db));
    if (!built) return emptyResult("fee_dependence", schemaReady, dryRun, "No call report rows to measure.");
    const saved = await store(db, built.record, built.placements, opts);
    return { schemaReady, dryRun, ...saved, studyKey: built.record.studyKey, asOf: built.record.asOf, n: built.record.n, placements: built.placements.length, headline: String(built.record.findings.headline), findings: built.record.findings };
  }

  if (stepKey === "study-inferred-volume") {
    const built = buildInferredVolume(await readIncomeAndFees(db));
    const saved = await store(db, built.record, built.placements, opts, (studyId) => saveInferredVolume(db, built.rows, studyId));
    return { schemaReady, dryRun, ...saved, studyKey: built.record.studyKey, asOf: built.record.asOf, n: built.record.n, placements: built.placements.length, headline: String(built.record.findings.headline), findings: built.record.findings };
  }

  const spec = PRICE_DRIVERS[stepKey];
  const driverRead = await spec.read(db);
  const driver: Driver = { key: spec.key, label: spec.label, perUnits: spec.perUnits, perLabel: spec.perLabel, values: driverRead.values };
  const result = runPriceStudy(await readInstitutionPrices(db), driver);
  const asOf = quarterLabel(now);
  const findings: Record<string, unknown> = {
    headline: result.headline,
    driver: result.driver,
    institutions: result.institutions,
    driver_coverage: { banks: driverRead.banks, credit_unions: driverRead.creditUnions },
    fees: result.fees,
    method:
      "Cross-sectional: live fee schedules this quarter against the driver. Per fee: Spearman rank correlation, average price by fifth of the driver, and OLS of price on the driver with log assets and charter as controls (HC1 robust 95% intervals). Describes how prices differ across institutions, not what happens when the driver changes.",
    fee_labels: Object.fromEntries(result.fees.map((f) => [f.fee, feeLabel(f.fee)])),
  };
  const record: StudyRecord = {
    studyKey: spec.key,
    methodVersion: PRICE_STUDY_VERSION,
    title: spec.title,
    asOf,
    metric: spec.key,
    n: result.institutions,
    sources: [{ name: FEE_SOURCE_NAME, asOf }, ...driverRead.sources],
    findings,
  };
  const saved = await store(db, record, result.placements, opts);
  return { schemaReady, dryRun, ...saved, studyKey: spec.key, asOf, n: result.institutions, placements: result.placements.length, headline: result.headline, findings };
}

function emptyResult(studyKey: string, schemaReady: boolean, dryRun: boolean, headline: string): StudyStepResult {
  return { schemaReady, dryRun, studyKey, asOf: "none", stored: false, alreadyCurrent: false, studyId: null, n: 0, placements: 0, headline, findings: {} };
}

export function summarizeStudyStep(result: StudyStepResult): string {
  const verb = result.stored ? "Stored" : result.alreadyCurrent ? "Already current:" : result.dryRun ? "Dry run:" : result.schemaReady ? "Read" : "Read (tables not created yet)";
  return `${verb} ${result.studyKey} for ${result.asOf}, n=${result.n}. ${result.headline}`;
}
