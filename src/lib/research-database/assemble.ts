import { createHash } from "node:crypto";
import { summarizeFees, STATS_METHOD_VERSION } from "@/lib/data-store/fee-stats";
import type { ResearchInputs, ResearchFinancial } from "@/lib/data-store/research-database";
import { finiteOrNull, median, metricDefinition, RESEARCH_METRIC_VERSION, RESEARCH_MIN_PEERS } from "./metrics";
import { RESEARCH_VERSION, type ResearchCell, type ResearchRequest, type ResearchSnapshot } from "./types";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function researchHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function researchTitle(snapshot: ResearchSnapshot): string {
  if (snapshot.footprint) return `${snapshot.footprint.name}: Local Market Research`;
  return snapshot.request.cadence === "monthly" ? "Banking and Local Markets: Monthly Pulse" : "Banking and Local Markets Outlook";
}

function periodEnd(period: string): Date | null {
  if (/^\d{4}$/.test(period)) return new Date(`${period}-12-31T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return new Date(`${period}T00:00:00Z`);
  return null;
}

/** Pure calculations over saved inputs: reports never need live rows to reproduce their figures. */
export function assembleResearchSnapshot(request: ResearchRequest, input: ResearchInputs, pipelineCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? "local"): ResearchSnapshot {
  const unique = (keys: string[], label: string) => { if (new Set(keys).size !== keys.length) throw new Error(`Duplicate ${label} in research inputs.`); };
  unique(input.institutions.map(i => String(i.id)), "institution");
  unique(input.branches.map(b => b.branch_key), "branch");
  unique(input.demographics.map(d => d.geo_id), "county");
  unique(input.financials.map(f => `${f.institution_id}:${f.source}`), "financial filing");
  unique(input.areas.map(a => `${a.source}:${a.series_key}:${a.geo_code}`), "economic observation");
  if (new Set(input.demographics.map(d => d.year)).size > 1) throw new Error("Mixed ACS vintages cannot be aggregated.");
  for (const source of ["fdic", "ncua"]) if (new Set(input.financials.filter(f => f.source === source).map(f => f.report_date)).size > 1) throw new Error("Mixed financial quarters cannot be compared.");
  if (!Number.isFinite(new Date(input.capturedAt).getTime())) throw new Error("Research capture time is invalid.");
  const cells: ResearchCell[] = [];
  const limitations = [
    "Descriptive research. Associations do not establish causation or predict results.",
    "Source reporting periods differ and are printed beside each figure. Annual data are not monthly changes.",
    "This is a snapshot of available evidence at capture time, not a reconstruction of what was known in an earlier period.",
    "A branch footprint describes physical presence, not the complete customer catchment or a credit union field of membership.",
    "Bank deposits exclude credit unions. Credit union branch deposits are unavailable and are never estimated.",
    "Branch-assigned deposits can include nonlocal or online balances booked at a headquarters office. They do not measure resident household deposits or local demand.",
    "Fee benchmarks are verified-only consumer comparisons under the shared statistics contract; unknown-audience schedules remain included and provisional evidence is excluded.",
    "Fee sample counts apply shared-schedule deduplication. They are counted benchmark observations, not a census of institutions in scope.",
    "Financial amounts are converted from stored thousands to dollars. Performance cohorts use current registry asset tiers and one latest quarter per regulator.",
    "Institution cohorts use the current active registry. Growth comparisons describe matched continuing reporters and do not adjust for mergers or survivor bias.",
    "Loan-to-deposit ratios are balance-sheet comparisons, not measures of local loan originations.",
  ];
  const add = (key: string, cohort: string, value: number | null, period: string | null, eligible: number, observed: number, note: string, sourceUrls: string[] = [], min = 0) => {
    const definition = metricDefinition(key);
    const sources = definition.sources.filter(s => !(cohort.startsWith("bank:") && s === "ncua-financials") && !(cohort.startsWith("credit_union:") && s === "fdic-financials"));
    const blocked = sources.filter(s => s !== "published_fee_catalog").some(s => input.audit.some(a => a.source === s && a.status === "blocked"));
    const incomparable = definition.module === "performance" && cohort.endsWith(":unclassified");
    const end = period ? periodEnd(period) : null;
    const age = end ? (new Date(input.capturedAt).getTime() - end.getTime()) / 86_400_000 : 0;
    const stale = age > definition.maxAgeDays;
    const missing = observed === 0 || value === null || !Number.isFinite(value) || observed < min || blocked || incomparable;
    cells.push({ key, cohort, value: missing ? null : value, period, eligible, observed,
      status: missing ? "unavailable" : observed < eligible || stale || input.footprint?.status === "partial" ? "limited" : "available",
      note: blocked ? `${note} Source access or reuse is blocked.` : incomparable ? `${note} Asset tier is unavailable, so a comparable size cohort cannot be established.` : observed < min ? `${note} At least ${min} eligible observations are required.` : stale ? `${note} Reporting period is older than the metric freshness limit.` : note,
      sourceUrls: [...new Set(sourceUrls.filter(url => {
        try { const parsed = new URL(url); return parsed.protocol === "https:" && !!parsed.hostname && !parsed.username && !parsed.password; }
        catch { return false; }
      }))].sort(),
    });
  };
  if (input.footprint?.status === "partial") limitations.push(`${input.footprint.unmatchedBranches} branches have no current county placement; market coverage is partial.`);
  if (request.modules.includes("market")) {
    for (const [series, key, url] of [["UNRATE", "national_unemployment", "https://www.bls.gov/cps/"], ["FEDFUNDS", "fed_funds", "https://www.federalreserve.gov/releases/h15/"]] as const) {
      const row = input.macro?.find(m => m.series_id === series);
      const value = row?.units === "Percent" ? finiteOrNull(row.value) : null;
      add(key, "US national context", value, row?.observation_date ?? null, 1, value === null ? 0 : 1, "Original publisher observations only; national context remains separate from local market measures.", [url]);
    }
    const counties = input.footprint?.counties ?? [...new Set(input.demographics.map(d => d.geo_id.replace("county:", "")))];
    const population = input.demographics.map(d => finiteOrNull(d.total_population)).filter((v): v is number => v !== null && v >= 0);
    const vintage = input.demographics[0]?.year?.toString() ?? null;
    add("population", "Market counties", population.length === counties.length ? population.reduce((a, b) => a + b, 0) : null, vintage, counties.length, population.length,
      "ACS five-year estimates. Total withheld if any footprint county is missing; national total is the covered county universe, not a national population estimate.", ["https://www.census.gov/programs-surveys/acs"]);
    for (const d of request.scope === "footprint" ? input.demographics : []) {
      const income = finiteOrNull(d.median_household_income);
      add("household_income", d.geo_name ?? d.geo_id, income !== null && income >= 0 ? income : null, String(d.year), 1, income !== null && income >= 0 ? 1 : 0,
        "County median; not a footprint median.", ["https://www.census.gov/programs-surveys/acs"]);
    }
    const bankBranches = input.branches.filter(b => b.branch_key.startsWith("bank:") && b.county_fips !== null);
    const deposits = bankBranches.map(b => finiteOrNull(b.deposits)).filter((v): v is number => v !== null && v >= 0);
    const summary = request.scope === "national" ? input.branchSummary : null;
    add("bank_deposits", "Banks in market counties", summary ? summary.priced_branches === summary.branches ? finiteOrNull(summary.deposits) : null : deposits.length === bankBranches.length ? deposits.reduce((a, b) => a + b, 0) : null,
      summary?.vintage ?? bankBranches[0]?.vintage ?? null, summary?.branches ?? bankBranches.length, summary?.priced_branches ?? deposits.length, "Banks only. Each branch counted once; all deposits must be present.", ["https://banks.data.fdic.gov/bankfind-suite/SOD"]);
    if (summary?.unmapped_branches) limitations.push(`${summary.unmapped_branches} bank branches have no county identifier and are excluded from the county-based deposit total.`);
    for (const series of ["qcew_employment", "qcew_establishments"]) {
      const rows = input.areas.filter(a => a.series_key === series);
      const values = rows.map(a => finiteOrNull(a.value)).filter((v): v is number => v !== null && v >= 0);
      add(series, "Market counties", values.length === counties.length ? values.reduce((a, b) => a + b, 0) : null,
        rows[0]?.period ?? null, counties.length, values.length, "BLS county annual averages. Suppressed or missing counties prevent a complete total.", rows.map(a => a.source_url ?? "https://www.bls.gov/cew/"));
    }
    const lending = input.lending ?? [];
    add("mortgage_originations", "Counties with reported lending", lending.length ? lending.reduce((sum, row) => sum + Number(row.originations), 0) : null,
      lending[0]?.activity_year.toString() ?? null, counties.length, lending.length,
      "Reported HMDA observations only. This is not a completeness estimate for the mortgage market.", lending.map(r => r.source_url ?? "https://ffiec.cfpb.gov/data-browser/"));
  }
  if (request.modules.includes("performance")) {
    const cohorts = new Map<string, ResearchFinancial[]>();
    for (const row of input.financials) {
      const key = `${row.source === "fdic" ? "bank" : "credit_union"}:${row.asset_size_tier ?? "unclassified"}`;
      cohorts.set(key, [...(cohorts.get(key) ?? []), row]);
    }
    for (const [cohort, rows] of cohorts) {
      const [charter, tier] = cohort.split(":");
      const eligible = input.institutions.filter(i => i.charter_type === charter && (i.asset_size_tier ?? "unclassified") === tier).length;
      const period = rows[0].report_date;
      const url = charter === "bank" ? "https://banks.data.fdic.gov/bankfind-suite/financialreporting" : "https://ncua.gov/analysis/credit-union-corporate-call-report-data";
      for (const [key, field, scale] of [["assets", "total_assets", 1000], ["roa", "roa", 1]] as const) {
        const values = rows.map(r => finiteOrNull(r[field])).filter((v): v is number => v !== null && (field !== "total_assets" || v >= 0));
        add(key, cohort, median(values.map(v => v * scale)), period, eligible, values.length, "Same charter, asset tier and reporting quarter; one filing per institution.", [url], RESEARCH_MIN_PEERS);
      }
      const growth = rows.filter(r => (finiteOrNull(r.prior_assets) ?? 0) > 0 && finiteOrNull(r.total_assets) !== null).map(r => (Number(r.total_assets) / Number(r.prior_assets) - 1) * 100);
      add("asset_growth", cohort, median(growth), period, eligible, growth.length, "Same-quarter year-over-year change; missing prior filings excluded.", [url], RESEARCH_MIN_PEERS);
      const equity = rows.filter(r => (finiteOrNull(r.total_assets) ?? 0) > 0 && finiteOrNull(r.total_equity) !== null).map(r => Number(r.total_equity) / Number(r.total_assets) * 100);
      add("equity_assets", cohort, median(equity), period, eligible, equity.length, "Balance-sheet equity to assets; not a regulatory capital ratio.", [url], RESEARCH_MIN_PEERS);
      const pairs = rows.filter(r => finiteOrNull(r.total_loans) !== null && (finiteOrNull(r.total_deposits) ?? 0) > 0);
      const denominator = pairs.reduce((sum, r) => sum + Number(r.total_deposits), 0);
      add("loan_deposit_ratio", cohort, denominator > 0 ? pairs.reduce((sum, r) => sum + Number(r.total_loans), 0) / denominator : null,
        period, eligible, pairs.length, "Ratio of aggregate loans to aggregate deposits, using paired observations.", [url], RESEARCH_MIN_PEERS);
    }
    if (!cohorts.size) limitations.push("No comparable financial cohort was available; institution performance is unavailable.");
  }
  if (request.modules.includes("fees")) {
    for (const charter of ["bank", "credit_union"] as const) {
      const eligible = input.institutions.filter(i => i.charter_type === charter).length;
      for (const category of ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing"]) {
        const rows = input.fees.filter(f => f.charter_type === charter && f.fee_category === category);
        const stats = summarizeFees(rows);
        add(`fee:${category}`, charter, stats.median_amount, input.capturedAt.slice(0, 10), eligible, stats.institution_count,
          `Verified published dollar fees captured on this date; source effective dates may differ. Statistics method ${STATS_METHOD_VERSION}. Shared schedules counted under the existing contract.`, ["https://feeinsight.com/research/data-sources"], RESEARCH_MIN_PEERS);
      }
    }
  }
  for (const cell of cells) {
    const previous = input.previous?.cells.find(c => c.key === cell.key && c.cohort === cell.cohort);
    cell.releaseStatus = cell.key.startsWith("fee:") ? "snapshot_refresh" : !previous ? "first_edition" : previous.period === cell.period ? "same_period" : "new_period";
  }
  if (request.cadence === "monthly") limitations.push("Monthly release labels compare source periods with the preceding public edition. Fee catalog snapshots do not establish that an institution changed a fee.");
  const body = {
    version: RESEARCH_VERSION, metricVersion: RESEARCH_METRIC_VERSION, feeStatsVersion: STATS_METHOD_VERSION, capturedAt: input.capturedAt,
    request, footprint: input.footprint, cells, audit: input.audit, limitations, inputHash: researchHash(input), pipelineCommit,
  };
  return { ...body, snapshotHash: researchHash(body) };
}

export function validateResearchSnapshot(snapshot: ResearchSnapshot, inputs: ResearchInputs): boolean {
  if (snapshot.version !== RESEARCH_VERSION || snapshot.metricVersion !== RESEARCH_METRIC_VERSION) return false;
  const replay = assembleResearchSnapshot(snapshot.request, inputs, snapshot.pipelineCommit);
  return replay.snapshotHash === snapshot.snapshotHash && researchHash({ ...snapshot, snapshotHash: undefined }) === snapshot.snapshotHash;
}
