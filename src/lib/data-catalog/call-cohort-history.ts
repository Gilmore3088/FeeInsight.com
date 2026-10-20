import type { withTransaction } from "@/lib/data-store/connection";

export const MAX_COHORT_REPORTERS = 512;
export const MAX_COHORT_IDENTITIES = 2000;
export const MAX_COHORT_EVENTS = 200;
export const MAX_COHORT_PERIODS = 40;

// Existing structure-event writers: registry/{fdic-history,industry-events,bank-merger-orders}.ts.
// New source names require an explicit namespace decision; a stored institution link cannot supply one.
const BANK_EVENT_SOURCES = ["fdic-history", "fdic-failures", "fed-h2", "occ-bulletin", "fed-orders", "occ-merger-decisions"];
const CU_EVENT_SOURCES = ["ncua-mergers", "ncua-liquidations", "ncua-proposed-mergers"];
const RELEASE_OR_DECISION_SOURCES = ["fed-h2", "occ-bulletin", "fed-orders", "occ-merger-decisions"];

export interface CallCohortPeriodInput {
  period: string;
  unit: string;
  period_basis: string | null;
  sources: readonly string[] | null;
  institution_count: number;
  reporting_institution_ids?: readonly (number | string)[];
  reporter_ids_complete?: boolean;
  subject_included?: boolean | null;
}
export interface CallCohortHistoryInput {
  periods: readonly CallCohortPeriodInput[];
  requestedIds: readonly number[] | null;
  subjectId?: number | null;
  /** The reader's actual reporting eligibility; raw lines and positive derived quarters differ. */
  eligibility_basis?: string;
}
export interface CallCohortIdentity {
  id: number | string;
  source: string | null;
  charter_type: string | null;
  cert_number: string | null;
  ncua_charter_id: string | null;
  institution_name: string | null;
  regulatory_status: string | null;
  closed_date: string | null;
}
export interface CallCohortEvent {
  id: number | string;
  source: string;
  event_key: string;
  institution_id: number | string | null;
  cert: string | null;
  acquirer_cert: string | null;
  outgoing_cert: string | null;
  survivor_cert: string | null;
  effective_date: string | null;
  change_code: string | null;
  change_description: string | null;
  source_url: string | null;
}
type ReadStatus = "complete" | "truncated" | "unavailable";
export interface CallCohortFacts {
  identities?: readonly CallCohortIdentity[];
  identity_read_status?: ReadStatus;
  lifecycleEvents?: readonly CallCohortEvent[];
  lifecycle_read_status?: ReadStatus | "not_compared";
}
export interface CallCohortCharterRef {
  institution_id: number;
  source: string;
  registry_source: string | null;
  registry_charter_type: string | null;
  cert_number: string | null;
  ncua_charter_id: string | null;
  registry_name: string | null;
  current_regulatory_status: string | null;
  closed_date: string | null;
  identity_state: "resolved" | "missing" | "conflicting";
}
export interface CallCohortPeriod {
  period: string;
  source: string;
  unit: string;
  period_basis: string | null;
  reported_count: number;
  reporting_institution_ids: number[];
  reporter_ids_complete: boolean;
  identity_refs_complete: boolean;
  subject_included: boolean | null;
}
export interface CallCohortMembershipChange {
  source: string;
  unit: string;
  period_basis: string | null;
  from_period: string;
  to_period: string;
  complete: boolean;
  common_ids: number[] | null;
  added_ids: number[] | null;
  dropped_ids: number[] | null;
}
export interface CallCohortLifecycleEvent extends CallCohortEvent {
  date_basis: "member_vote" | "publication_or_decision_date" | "reported_effective_date" | "unknown";
  certainty: "proposal_not_completion" | "published_event_unreviewed";
  related_members: Array<{ institution_id: number; source: string; roles: string[] }>;
}
export interface CallCohortHistory {
  basis: "period_cross_sections";
  growth_status: "not_established";
  merger_adjusted: false;
  identity_basis: "current_registry_links_not_dated_identity";
  eligibility_basis: string;
  requested: { institution_ids: number[] | null; member_count: number | null; ids_complete: boolean };
  periods: CallCohortPeriod[];
  periods_complete: boolean;
  charter_refs: CallCohortCharterRef[];
  charter_refs_complete: boolean;
  identity_read_status: ReadStatus;
  membership_changes: CallCohortMembershipChange[];
  lifecycle: {
    read_status: ReadStatus | "not_compared";
    coverage: "not_established";
    window_start: string | null;
    window_end: string | null;
    events: CallCohortLifecycleEvent[];
  };
  caps: { reporters_per_period: number; identity_refs: number; events: number; periods: number };
  limitations: string[];
}

const positiveId = (value: unknown): boolean => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const ids = (values: readonly (number | string)[]) => [...new Set(values.filter(positiveId).map(Number))].sort((a, b) => a - b);
const namespace = (source: string | null): "bank" | "credit_union" | null => source === "ncua" ? "credit_union" : source === "fdic" || source === "ffiec" ? "bank" : null;
const identifier = (value: string | null | undefined): string | null => value && /^\d+$/.test(value.trim()) && /[1-9]/.test(value) ? value.trim().replace(/^0+(?=\d)/, "") : null;
const validDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const sourceOf = (row: CallCohortPeriodInput) => row.sources?.length === 1 ? row.sources[0] : "unknown";
const seriesKey = (row: { source: string; unit: string; period_basis: string | null }) => JSON.stringify([row.source, row.unit, row.period_basis]);

/** Income windows begin with their income period, not merely the first report's end date. */
export function callCohortWindow(periods: readonly CallCohortPeriodInput[]): { start: string | null; end: string | null } {
  const dated = periods.filter((row) => validDate(row.period));
  const starts = dated.map((row) => row.period_basis === "ytd" || row.period_basis === "year_to_date"
    ? `${row.period.slice(0, 4)}-01-01`
    : row.period_basis === "standalone_quarter"
      ? `${row.period.slice(0, 4)}-${String(Math.floor((Number(row.period.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`
      : row.period);
  return { start: starts.sort()[0] ?? null, end: dated.map((row) => row.period).sort().at(-1) ?? null };
}

function charterRef(id: number, source: string, identity: CallCohortIdentity | undefined): CallCohortCharterRef {
  const cert = identifier(identity?.cert_number);
  const charter = identifier(identity?.ncua_charter_id);
  const kind = namespace(source);
  const conflicting = Boolean(identity && (identity.charter_type !== kind
    || (kind === "credit_union" && cert && charter && cert !== charter)));
  return {
    institution_id: id, source, registry_source: identity?.source ?? null,
    registry_charter_type: identity?.charter_type ?? null,
    cert_number: identity?.cert_number ?? null, ncua_charter_id: identity?.ncua_charter_id ?? null,
    registry_name: identity?.institution_name ?? null, current_regulatory_status: identity?.regulatory_status ?? null,
    closed_date: identity?.closed_date ?? null,
    identity_state: conflicting ? "conflicting" : !identity || !kind || !(kind === "bank" ? cert : charter ?? cert) ? "missing" : "resolved",
  };
}

function eventNamespace(source: string): "bank" | "credit_union" | null {
  return CU_EVENT_SOURCES.includes(source) ? "credit_union" : BANK_EVENT_SOURCES.includes(source) ? "bank" : null;
}
function relatedMembers(event: CallCohortEvent, refs: readonly CallCohortCharterRef[]): CallCohortLifecycleEvent["related_members"] {
  return refs.flatMap((ref) => {
    const kind = eventNamespace(event.source);
    if (kind === null || kind !== namespace(ref.source)) return [];
    const roles: string[] = [];
    if (event.institution_id !== null && Number(event.institution_id) === ref.institution_id) roles.push("institution");
    const keys = new Set([identifier(ref.cert_number), ...(kind === "credit_union" ? [identifier(ref.ncua_charter_id)] : [])].filter(Boolean));
    for (const [field, role] of [["cert", "cert"], ["outgoing_cert", "predecessor"], ["acquirer_cert", "acquirer"], ["survivor_cert", "survivor"]] as const) {
      const key = identifier(event[field]);
      if (key && keys.has(key)) roles.push(role);
    }
    return roles.length ? [{ institution_id: ref.institution_id, source: ref.source, roles }] : [];
  });
}

/** Reporter equality is descriptive only; it never establishes an unchanged economic perimeter. */
export function buildCallCohortHistory(input: CallCohortHistoryInput & CallCohortFacts): CallCohortHistory {
  const requested = input.requestedIds === null ? null : ids(input.requestedIds);
  const identityRows = input.identities ?? [];
  const byId = new Map(identityRows.slice(0, MAX_COHORT_IDENTITIES).map((row) => [Number(row.id), row]));
  const identityRead = input.identity_read_status ?? "unavailable";
  const refsByKey = new Map<string, CallCohortCharterRef>();
  const periods = input.periods.slice(0, MAX_COHORT_PERIODS).map((row): CallCohortPeriod => {
    const all = ids(row.reporting_institution_ids ?? []);
    const reportingIds = all.slice(0, MAX_COHORT_REPORTERS);
    const complete = row.reporter_ids_complete !== false && Boolean(row.reporting_institution_ids)
      && validDate(row.period) && namespace(sourceOf(row)) !== null
      && Number.isSafeInteger(row.institution_count) && row.institution_count >= 0
      && all.length === row.institution_count && reportingIds.length === row.institution_count;
    for (const id of reportingIds) {
      const key = JSON.stringify([sourceOf(row), id]);
      if (!refsByKey.has(key) && refsByKey.size < MAX_COHORT_IDENTITIES) refsByKey.set(key, charterRef(id, sourceOf(row), byId.get(id)));
    }
    const refs = reportingIds.map((id) => refsByKey.get(JSON.stringify([sourceOf(row), id])));
    return {
      period: row.period, source: sourceOf(row), unit: row.unit, period_basis: row.period_basis,
      reported_count: row.institution_count, reporting_institution_ids: reportingIds,
      reporter_ids_complete: complete,
      identity_refs_complete: complete && identityRead === "complete" && refs.every((ref) => ref?.identity_state === "resolved"),
      subject_included: input.subjectId == null ? row.subject_included ?? null : complete ? reportingIds.includes(input.subjectId) : row.subject_included ?? null,
    };
  });
  const groups = new Map<string, CallCohortPeriod[]>();
  for (const row of periods) { const key = seriesKey(row); groups.set(key, [...(groups.get(key) ?? []), row]); }
  const membershipChanges: CallCohortMembershipChange[] = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
    for (let at = 1; at < sorted.length; at++) {
      const before = sorted[at - 1]; const after = sorted[at];
      const complete = before.reporter_ids_complete && after.reporter_ids_complete && before.period !== after.period;
      const oldIds = new Set(before.reporting_institution_ids); const newIds = new Set(after.reporting_institution_ids);
      membershipChanges.push({ source: after.source, unit: after.unit, period_basis: after.period_basis, from_period: before.period, to_period: after.period, complete,
        common_ids: complete ? after.reporting_institution_ids.filter((id) => oldIds.has(id)) : null,
        added_ids: complete ? after.reporting_institution_ids.filter((id) => !oldIds.has(id)) : null,
        dropped_ids: complete ? before.reporting_institution_ids.filter((id) => !newIds.has(id)) : null });
    }
  }
  const window = callCohortWindow(input.periods);
  const refs = [...refsByKey.values()].sort((a, b) => a.source.localeCompare(b.source) || a.institution_id - b.institution_id);
  const events = (input.lifecycleEvents ?? []).flatMap((event): CallCohortLifecycleEvent[] => {
    const related = relatedMembers(event, refs);
    if (!related.length || (validDate(event.effective_date) && (window.start && event.effective_date < window.start || window.end && event.effective_date > window.end))) return [];
    const proposal = event.source === "ncua-proposed-mergers" || event.change_code === "proposed_merger";
    return [{ ...event, date_basis: proposal ? "member_vote" : !validDate(event.effective_date) ? "unknown"
      : RELEASE_OR_DECISION_SOURCES.includes(event.source) ? "publication_or_decision_date" : "reported_effective_date",
      certainty: proposal ? "proposal_not_completion" : "published_event_unreviewed", related_members: related }];
  });
  return {
    basis: "period_cross_sections", growth_status: "not_established", merger_adjusted: false,
    identity_basis: "current_registry_links_not_dated_identity",
    eligibility_basis: input.eligibility_basis ?? "reported_curated_line",
    requested: { institution_ids: requested?.slice(0, MAX_COHORT_IDENTITIES) ?? null, member_count: requested?.length ?? null, ids_complete: requested !== null && requested.length <= MAX_COHORT_IDENTITIES },
    periods, periods_complete: input.periods.length <= MAX_COHORT_PERIODS, identity_read_status: identityRead,
    charter_refs: refs, charter_refs_complete: input.periods.length <= MAX_COHORT_PERIODS && periods.every((row) => row.identity_refs_complete),
    membership_changes: membershipChanges,
    lifecycle: { read_status: events.length > MAX_COHORT_EVENTS ? "truncated" : input.lifecycle_read_status ?? "unavailable", coverage: "not_established",
      window_start: window.start, window_end: window.end, events: events.slice(0, MAX_COHORT_EVENTS) },
    caps: { reporters_per_period: MAX_COHORT_REPORTERS, identity_refs: MAX_COHORT_IDENTITIES, events: MAX_COHORT_EVENTS, periods: MAX_COHORT_PERIODS },
    limitations: [
      "Each period is its own source-, unit- and basis-specific filing cross-section; missing filings are not zero or carried forward.",
      "Requested membership and charter/name references use current registry links and attributes, not dated legal-identity or historical-asset snapshots.",
      "Current inactive status does not remove a legitimate historical reporter.",
      "Identical reporter or charter IDs do not establish an unchanged business perimeter. No merger adjustment or comparable economic-growth basis is established.",
      "Loaded lifecycle events are diagnostic references, not complete lifecycle coverage; no matching event does not establish that no merger occurred.",
      "Proposed-merger member-vote dates do not establish merger completion. No predecessor values are filled or combined into a pro forma history.",
      "Fed/OCC release and decision dates are publication or regulatory-decision dates, not merger-completion dates.",
      "Lists are bounded; a shortened or incomplete membership/identity/event list cannot establish a consistent cohort.",
    ],
  };
}

/** Separate bounded reads keep optional lifecycle failure from aborting valid financial results. */
export async function loadCallCohortFacts(input: CallCohortHistoryInput, read?: typeof withTransaction): Promise<CallCohortFacts> {
  if (!input.periods.length) return { identities: [], identity_read_status: "complete", lifecycleEvents: [], lifecycle_read_status: "not_compared" };
  const run = read ?? (await import("@/lib/data-store/connection")).withTransaction;
  // Charter references describe actual reporters only. Requested-only members have no filing
  // reference here and must not consume the bounded identity or lifecycle lookup budget.
  const allIds = ids(input.periods.flatMap((row) => row.reporting_institution_ids ?? []));
  const boundedIds = allIds.slice(0, MAX_COHORT_IDENTITIES);
  let identities: CallCohortIdentity[];
  try {
    identities = boundedIds.length ? await run(async (tx) => {
      await tx`SET LOCAL statement_timeout = '5s'`;
      return [...await tx<CallCohortIdentity[]>`SELECT id, source, charter_type, cert_number, ncua_charter_id, institution_name, regulatory_status, closed_date::text AS closed_date
        FROM institution_sources WHERE id = ANY(${boundedIds}::bigint[]) ORDER BY id LIMIT ${MAX_COHORT_IDENTITIES}`];
    }) : [];
  } catch { return { identities: [], identity_read_status: "unavailable", lifecycleEvents: [], lifecycle_read_status: "unavailable" }; }
  const identityStatus = allIds.length > boundedIds.length ? "truncated" : "complete";
  const series = new Map<string, Set<string>>();
  for (const row of input.periods) { const key = seriesKey({ source: sourceOf(row), unit: row.unit, period_basis: row.period_basis }); series.set(key, new Set([...(series.get(key) ?? []), row.period])); }
  const window = callCohortWindow(input.periods);
  if (![...series.values()].some((dates) => dates.size > 1) || !window.start || !window.end || !boundedIds.length) {
    return { identities, identity_read_status: identityStatus, lifecycleEvents: [], lifecycle_read_status: "not_compared" };
  }
  const boundedSet = new Set(boundedIds);
  const reportersFor = (kind: "bank" | "credit_union") => ids(input.periods.filter((row) => namespace(sourceOf(row)) === kind).flatMap((row) => row.reporting_institution_ids ?? [])).filter((id) => boundedSet.has(id));
  const bankIds = reportersFor("bank"); const cuIds = reportersFor("credit_union");
  const bankSet = new Set(bankIds); const cuSet = new Set(cuIds);
  const bankCerts = [...new Set(identities.filter((row) => row.charter_type === "bank" && bankSet.has(Number(row.id))).map((row) => identifier(row.cert_number)).filter((value): value is string => value !== null))];
  const cuCharters = [...new Set(identities.filter((row) => row.charter_type === "credit_union" && cuSet.has(Number(row.id))).flatMap((row) => [identifier(row.cert_number), identifier(row.ncua_charter_id)]).filter((value): value is string => value !== null))];
  try {
    const events = await run(async (tx) => {
      await tx`SET LOCAL statement_timeout = '5s'`;
      return [...await tx<CallCohortEvent[]>`SELECT id, source, event_key, institution_id, cert, acquirer_cert, outgoing_cert, survivor_cert,
          effective_date::text AS effective_date, change_code, change_description, source_url
        FROM institution_structure_events
        WHERE (effective_date IS NULL OR effective_date BETWEEN ${window.start}::date AND ${window.end}::date)
          AND ((source = ANY(${BANK_EVENT_SOURCES}::text[]) AND (institution_id = ANY(${bankIds}::bigint[])
              OR ltrim(cert, '0') = ANY(${bankCerts}::text[]) OR ltrim(acquirer_cert, '0') = ANY(${bankCerts}::text[]) OR ltrim(outgoing_cert, '0') = ANY(${bankCerts}::text[]) OR ltrim(survivor_cert, '0') = ANY(${bankCerts}::text[])))
            OR (source = ANY(${CU_EVENT_SOURCES}::text[]) AND (institution_id = ANY(${cuIds}::bigint[])
              OR ltrim(cert, '0') = ANY(${cuCharters}::text[]) OR ltrim(acquirer_cert, '0') = ANY(${cuCharters}::text[]) OR ltrim(outgoing_cert, '0') = ANY(${cuCharters}::text[]) OR ltrim(survivor_cert, '0') = ANY(${cuCharters}::text[]))))
        ORDER BY effective_date DESC NULLS LAST, source, event_key LIMIT ${MAX_COHORT_EVENTS + 1}`];
    });
    return { identities, identity_read_status: identityStatus, lifecycleEvents: events, lifecycle_read_status: events.length > MAX_COHORT_EVENTS ? "truncated" : "complete" };
  } catch { return { identities, identity_read_status: identityStatus, lifecycleEvents: [], lifecycle_read_status: "unavailable" }; }
}

export async function readCallCohortHistory(input: CallCohortHistoryInput, read?: typeof withTransaction): Promise<CallCohortHistory> {
  return buildCallCohortHistory({ ...input, ...await loadCallCohortFacts(input, read) });
}
