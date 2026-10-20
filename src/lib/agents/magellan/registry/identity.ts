import { fullCompanyKey, normalizeCompanyName } from "@/lib/regulatory/cfpb";
import type { RegistryDb } from "./partitions";

/**
 * Matches external company identities (CFPB company names, SEC filers) to
 * institution_sources and records every decision in institution_identity_links.
 *
 * Only unambiguous matches are accepted automatically. A name shared by
 * unrelated institutions is stored as needs_review and never used for data
 * until a person accepts it. Links a person verified (verified_by set) are
 * never overwritten by the agent.
 */

export type IdentityLinkType = "cfpb_company" | "sec_cik";

export interface IdentityCandidate {
  id: number;
  name: string;
  holdingCompanyRssd: string | null;
  assetSize: number;
  via: "institution_name" | "holding_company_name";
}

export interface IdentityIndex {
  byName: Map<string, IdentityCandidate[]>;
  /** fullCompanyKey(holding company name) -> its banks. */
  byHoldingName?: Map<string, IdentityCandidate[]>;
}

export interface IdentityMatch {
  institutionId: number;
  confidence: number;
  method: string;
  status: "accepted" | "needs_review" | "rejected";
  candidates: number;
}

const MIN_KEY_LENGTH = 4;
/** asset_size is in thousands: $10B. A short name ("PNC", "TD", "U S") is safe only for a bank this large. */
const LARGE_BANK_ASSETS = 10_000_000;
/** A full holding-company name shared by unrelated parents goes to the largest only when it is this many times the next. */
const DOMINANT_PARENT_RATIO = 20;

export async function loadIdentityIndex(db: RegistryDb): Promise<IdentityIndex> {
  const rows = await db<
    Array<{
      id: number;
      institution_name: string;
      holding_company_name: string | null;
      holding_company_rssd: string | null;
      asset_size: number | null;
    }>
  >`
    SELECT id, institution_name, holding_company_name, holding_company_rssd, asset_size
      FROM institution_sources
     WHERE regulatory_status IS DISTINCT FROM 'inactive'
  `;
  const byName = new Map<string, IdentityCandidate[]>();
  const byHoldingName = new Map<string, IdentityCandidate[]>();
  const addTo = (map: Map<string, IdentityCandidate[]>, key: string, candidate: IdentityCandidate) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    if (!list.some((entry) => entry.id === candidate.id)) list.push(candidate);
    map.set(key, list);
  };
  const add = (key: string, candidate: IdentityCandidate) => addTo(byName, key, candidate);
  for (const row of rows) {
    const base = {
      id: Number(row.id),
      name: row.institution_name,
      holdingCompanyRssd: row.holding_company_rssd,
      assetSize: Number(row.asset_size ?? 0),
    };
    add(normalizeCompanyName(row.institution_name), { ...base, via: "institution_name" });
    if (row.holding_company_name) {
      add(normalizeCompanyName(row.holding_company_name), { ...base, via: "holding_company_name" });
      addTo(byHoldingName, fullCompanyKey(row.holding_company_name), { ...base, via: "holding_company_name" });
    }
  }
  return { byName, byHoldingName };
}

/** Candidates grouped by parent (a bank with no parent is its own group), largest group first. */
function parentGroups(candidates: IdentityCandidate[]): Array<{ assets: number; largest: IdentityCandidate }> {
  const groups = new Map<string, IdentityCandidate[]>();
  for (const c of candidates) {
    const key = c.holdingCompanyRssd ?? `id:${c.id}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => b.assetSize - a.assetSize);
      return { assets: sorted.reduce((sum, c) => sum + c.assetSize, 0), largest: sorted[0] };
    })
    .sort((a, b) => b.assets - a.assets);
}

function matchHoldingCompany(name: string, index: IdentityIndex): IdentityMatch | null {
  const candidates = index.byHoldingName?.get(fullCompanyKey(name));
  if (!candidates || candidates.length === 0) return null;
  const groups = parentGroups(candidates);
  if (groups.length === 1) {
    return { institutionId: groups[0].largest.id, confidence: 0.9, method: "holding_company_full_name", status: "accepted", candidates: candidates.length };
  }
  const [first, second] = groups;
  if (first.assets >= LARGE_BANK_ASSETS && first.assets >= second.assets * DOMINANT_PARENT_RATIO) {
    return { institutionId: first.largest.id, confidence: 0.75, method: "holding_company_dominant_parent", status: "accepted", candidates: candidates.length };
  }
  return null;
}

/** Words only a bank, thrift, trust company or credit union (or its holding company) carries in its name. */
const BANK_NAME_WORDS = /\b(BANK|BANKS|BANKING|BANKSHARES|BANC|BANCORP|BANCORPORATION|BANCSHARES|BANCSHS|BCORP|SAVINGS|TRUST|FSB|SSB|CREDIT UNION|THRIFT)\b/;

export function hasBankWord(name: string): boolean {
  return BANK_NAME_WORDS.test(name.toUpperCase().replace(/[^A-Z0-9 ]+/g, " "));
}

export interface MatchOptions {
  /**
   * CFPB lists every company with complaints, mostly collectors, servicers and lenders. A name
   * that would wait for review but carries no bank word ("FMS Inc.", "D&A Services, LLC",
   * "Fidelity National Financial") is recorded as not a match instead, and so is one accepted only
   * after its generic words were stripped (see trustedNonBankName). SEC filers are already
   * limited to bank SIC codes, so the SEC matcher leaves this off.
   */
  rejectNonBankNames?: boolean;
}

export function matchCompany(name: string, index: IdentityIndex, options: MatchOptions = {}): IdentityMatch | null {
  const match = matchCompanyName(name, index);
  if (!match || !options.rejectNonBankNames || hasBankWord(name)) return match;
  if (match.status === "needs_review") return { ...match, confidence: 0, method: "non_bank_name", status: "rejected" };
  if (match.status === "accepted" && !trustedNonBankName(name, match, index)) {
    // Not recorded as rejected: a person can still accept a real parent ("Eagle Financial Services").
    return { ...match, confidence: 0.3, method: "non_bank_name_review", status: "needs_review" };
  }
  return match;
}

/** Matches that compare the CFPB name with a holding company's full name, word for word. */
const FULL_NAME_METHODS = new Set(["holding_company_full_name", "holding_company_dominant_parent"]);

/**
 * CFPB lists lenders, servicers and collectors beside banks, and a name with no bank word can
 * belong to any of them: "Progressive Financial Services, Inc." (a debt collector) became
 * "PROGRESSIVE", the key of Progressive National Bank, once "Financial" and "Services" were
 * stripped, and "Berkshire Financial Services, LLC" is the full name of Lee Bank's parent. Such a
 * name is accepted without a person only for a bank of $10B or more, and, unless it matched a
 * holding company's full name, only when it leads with the bank's own words ("SANTANDER HOLDINGS
 * USA, INC.", "FIFTH THIRD FINANCIAL CORPORATION"; not "Financial Services of America").
 */
function trustedNonBankName(name: string, match: IdentityMatch, index: IdentityIndex): boolean {
  const key = normalizeCompanyName(name);
  const assets = (list: IdentityCandidate[] | undefined) => list?.find((c) => c.id === match.institutionId)?.assetSize ?? 0;
  const bankAssets = Math.max(assets(index.byName.get(key)), assets(index.byHoldingName?.get(fullCompanyKey(name))));
  if (bankAssets < LARGE_BANK_ASSETS) return false;
  if (FULL_NAME_METHODS.has(match.method)) return true;
  const words = name.toUpperCase().replace(/&/g, " ").replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && w !== "THE");
  return words.slice(0, key.split(" ").length).join(" ") === key;
}

function matchCompanyName(name: string, index: IdentityIndex): IdentityMatch | null {
  const holding = matchHoldingCompany(name, index);
  if (holding) return holding;
  const key = normalizeCompanyName(name);
  const candidates = index.byName.get(key);
  if (!candidates || candidates.length === 0) return null;
  const largest = [...candidates].sort((a, b) => b.assetSize - a.assetSize)[0];

  if (key.length < MIN_KEY_LENGTH) {
    const oneParent = parentGroups(candidates).length === 1;
    if (oneParent && largest.assetSize >= LARGE_BANK_ASSETS) {
      return { institutionId: largest.id, confidence: 0.8, method: "short_name_large_bank", status: "accepted", candidates: candidates.length };
    }
    return { institutionId: largest.id, confidence: 0.3, method: "short_name", status: "needs_review", candidates: candidates.length };
  }
  if (candidates.length === 1) {
    return {
      institutionId: largest.id,
      confidence: 0.95,
      method: largest.via === "holding_company_name" ? "holding_company_name" : "exact_name",
      status: "accepted",
      candidates: 1,
    };
  }
  const holdingCompanies = new Set(candidates.map((c) => c.holdingCompanyRssd));
  if (holdingCompanies.size === 1 && largest.holdingCompanyRssd) {
    // One parent with several bank charters: attribute to its largest bank.
    return {
      institutionId: largest.id,
      confidence: 0.85,
      method: "holding_company_largest_bank",
      status: "accepted",
      candidates: candidates.length,
    };
  }
  const exact = matchExactBankName(name, candidates);
  if (exact) return exact;
  return { institutionId: largest.id, confidence: 0.5, method: "ambiguous_name", status: "needs_review", candidates: candidates.length };
}

/**
 * A company name that is a bank's own full name ("COMMERCE BANK", "STATE STREET BANK AND TRUST
 * COMPANY") goes to that bank when its parent is $10B or more and at least 20 times every other
 * parent whose bank has the same full name. Debt collectors and holding-style names ("FMS Inc.",
 * "Fidelity National Financial") never equal a bank's full name, so they stay for review.
 */
function matchExactBankName(name: string, candidates: IdentityCandidate[]): IdentityMatch | null {
  const key = fullCompanyKey(name);
  const exact = candidates.filter((c) => c.via === "institution_name" && fullCompanyKey(c.name) === key);
  if (exact.length === 0) return null;
  const [first, second] = parentGroups(exact);
  if (first.assets < LARGE_BANK_ASSETS || (second && first.assets < second.assets * DOMINANT_PARENT_RATIO)) return null;
  return { institutionId: first.largest.id, confidence: 0.8, method: "exact_bank_name_dominant", status: "accepted", candidates: candidates.length };
}

export interface IdentityLinkInput {
  externalKey: string;
  externalName: string;
  match: IdentityMatch;
  detail?: Record<string, unknown>;
}

export async function upsertIdentityLinks(
  db: RegistryDb,
  linkType: IdentityLinkType,
  links: IdentityLinkInput[],
  runId: number | null,
): Promise<void> {
  if (links.length === 0) return;
  const payload = JSON.stringify(
    links.map((link) => ({
      institution_id: link.match.institutionId,
      external_key: link.externalKey,
      external_name: link.externalName,
      method: link.match.method,
      confidence: link.match.confidence,
      status: link.match.status,
      detail: { candidates: link.match.candidates, ...(link.detail ?? {}) },
    })),
  );
  await db`
    INSERT INTO institution_identity_links
      (institution_id, link_type, external_key, external_name, method, confidence, status, detail, agent_run_id)
    SELECT r.institution_id, ${linkType}, r.external_key, r.external_name, r.method, r.confidence, r.status,
           r.detail, ${runId}
      FROM jsonb_to_recordset(${payload}::jsonb) AS r(
        institution_id bigint, external_key text, external_name text, method text,
        confidence double precision, status text, detail jsonb
      )
    ON CONFLICT (link_type, external_key) DO UPDATE SET
      institution_id = EXCLUDED.institution_id,
      external_name = EXCLUDED.external_name,
      method = EXCLUDED.method,
      confidence = EXCLUDED.confidence,
      status = EXCLUDED.status,
      detail = EXCLUDED.detail,
      agent_run_id = EXCLUDED.agent_run_id,
      updated_at = NOW()
    WHERE institution_identity_links.verified_by IS NULL
  `;
}

/**
 * Every institution a name could belong to: the banks whose own or parent's short name matches,
 * and the banks of a parent whose full name matches. The reviewer's candidate list for a link
 * (the matcher stores only how many there were), largest first.
 */
export function identityCandidatesFor(name: string, index: IdentityIndex): IdentityCandidate[] {
  const found = new Map<number, IdentityCandidate>();
  for (const list of [index.byName.get(normalizeCompanyName(name)), index.byHoldingName?.get(fullCompanyKey(name))]) {
    for (const candidate of list ?? []) if (!found.has(candidate.id)) found.set(candidate.id, candidate);
  }
  return [...found.values()].sort((a, b) => b.assetSize - a.assetSize);
}

/** Registry source whose past partitions must re-run when a link of this type is accepted by hand. */
const BACKFILL_SOURCE: Record<IdentityLinkType, string> = { cfpb_company: "cfpb", sec_cik: "sec-filings" };

export type IdentityDecision = "accept" | "reject" | "reset";

/** Most links one bulk accept or reject on the review screen may decide. */
export const IDENTITY_REVIEW_BULK_LIMIT = 50;

export interface IdentityDecisionInput {
  linkId: number;
  decision: IdentityDecision;
  /** Accept only: point the link at this institution instead of the matcher's guess. */
  institutionId?: number | null;
  note?: string | null;
  reviewer: { id: number; username: string };
}

export interface IdentityDecisionResult {
  linkId: number;
  linkType: IdentityLinkType;
  externalKey: string;
  before: { institutionId: number | null; status: string };
  after: { institutionId: number | null; status: string };
}

const NEXT_STATUS: Record<IdentityDecision, "accepted" | "rejected" | "needs_review"> = {
  accept: "accepted",
  reject: "rejected",
  reset: "needs_review",
};

/**
 * A person accepts (optionally re-pointing), rejects or resets one identity link. Run it inside a
 * transaction: it locks the link, writes the decision and an audit row in agent_events (the
 * record the Knox review screens kept), and keeps what the link drives in step:
 * - verified_by is set on accept and reject, so matcher runs never change the link again; reset
 *   clears it and hands the link back to the matcher as needs_review.
 * - An SEC link moves institution_sources.sec_cik with it: off every institution that carried
 *   this CIK, then (accept only) onto the chosen bank and the banks sharing its parent, the same
 *   spread the SEC links worker uses. The holding-company card follows sec_cik.
 * - Accepting makes that source's loaded partitions due again, so the next ticks backfill the
 *   company's history (past CFPB years are otherwise not re-pulled for months).
 * Complaint rows already written through a link stay on reject; removing them is undecided.
 * Returns null when the link does not exist; throws when an accept has no institution to point at.
 */
export async function applyIdentityDecision(db: RegistryDb, input: IdentityDecisionInput): Promise<IdentityDecisionResult | null> {
  const [link] = await db<Array<{ id: number; link_type: IdentityLinkType; external_key: string; institution_id: number | null; status: string }>>`
    SELECT id, link_type, external_key, institution_id, status
      FROM institution_identity_links
     WHERE id = ${input.linkId}
     FOR UPDATE
  `;
  if (!link) return null;
  const status = NEXT_STATUS[input.decision];
  const beforeInstitution = link.institution_id === null ? null : Number(link.institution_id);
  let institutionId = beforeInstitution;
  if (input.decision === "accept") {
    institutionId = input.institutionId ?? beforeInstitution;
    if (institutionId === null) throw new Error("Choose an institution before accepting this link.");
    const [target] = await db<Array<{ id: number }>>`SELECT id FROM institution_sources WHERE id = ${institutionId} AND regulatory_status IS DISTINCT FROM 'inactive'`;
    if (!target) throw new Error(`Institution #${institutionId} was not found or is inactive.`);
  }
  const note = input.note?.trim() || null;
  const review = JSON.stringify({
    review_decision: input.decision,
    review_note: note,
    reviewed_by: input.reviewer.username,
    reviewed_at: new Date().toISOString(),
  });

  if (input.decision === "accept") {
    await db`
      UPDATE institution_identity_links
         SET status = 'accepted', institution_id = ${institutionId}, confidence = 1, method = 'manual',
             verified_by = ${input.reviewer.username}, detail = detail || ${review}::jsonb, updated_at = NOW()
       WHERE id = ${link.id}
    `;
  } else {
    await db`
      UPDATE institution_identity_links
         SET status = ${status}, verified_by = ${input.decision === "reset" ? null : input.reviewer.username},
             detail = detail || ${review}::jsonb, updated_at = NOW()
       WHERE id = ${link.id}
    `;
  }

  if (link.link_type === "sec_cik") {
    await db`UPDATE institution_sources SET sec_cik = NULL WHERE sec_cik = ${link.external_key}`;
    if (input.decision === "accept") {
      await db`
        UPDATE institution_sources s SET sec_cik = ${link.external_key}
          FROM institution_sources anchor
         WHERE anchor.id = ${institutionId}
           AND (s.id = anchor.id OR (anchor.holding_company_rssd IS NOT NULL AND s.holding_company_rssd = anchor.holding_company_rssd))
      `;
    }
  }
  if (input.decision === "accept") {
    await db`
      UPDATE registry_ingest_partitions
         SET next_attempt_after = NOW(), updated_at = NOW()
       WHERE source = ${BACKFILL_SOURCE[link.link_type]} AND status IN ('succeeded', 'empty')
    `;
  }

  const result: IdentityDecisionResult = {
    linkId: Number(link.id),
    linkType: link.link_type,
    externalKey: link.external_key,
    before: { institutionId: beforeInstitution, status: link.status },
    after: { institutionId, status },
  };
  const audit = JSON.stringify({
    reviewer_id: input.reviewer.id,
    reviewer: input.reviewer.username,
    decision: input.decision,
    link_type: link.link_type,
    external_key: link.external_key,
    before: result.before,
    after: result.after,
    note,
  });
  await db`
    INSERT INTO agent_events (agent_name, action, tool_name, entity, entity_id, status, input_payload)
    VALUES ('_human_review', ${`identity_link_${input.decision}`}, 'registry_identity_review_ui',
            'institution_identity_links', ${String(link.id)}, 'success', ${audit}::jsonb)
  `;
  return result;
}

/** external_key -> institution_id for links that may be used for data. */
export async function loadAcceptedLinks(db: RegistryDb, linkType: IdentityLinkType): Promise<Map<string, number>> {
  const rows = await db<Array<{ external_key: string; institution_id: number }>>`
    SELECT external_key, institution_id
      FROM institution_identity_links
     WHERE link_type = ${linkType} AND status = 'accepted' AND institution_id IS NOT NULL
  `;
  return new Map(rows.map((row) => [row.external_key, Number(row.institution_id)]));
}
