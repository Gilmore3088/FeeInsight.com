import { normalizeCompanyName } from "@/lib/regulatory/cfpb";
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
}

export interface IdentityMatch {
  institutionId: number;
  confidence: number;
  method: string;
  status: "accepted" | "needs_review";
  candidates: number;
}

const MIN_KEY_LENGTH = 4;

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
  const add = (key: string, candidate: IdentityCandidate) => {
    if (!key) return;
    const list = byName.get(key) ?? [];
    if (!list.some((entry) => entry.id === candidate.id)) list.push(candidate);
    byName.set(key, list);
  };
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
    }
  }
  return { byName };
}

export function matchCompany(name: string, index: IdentityIndex): IdentityMatch | null {
  const key = normalizeCompanyName(name);
  const candidates = index.byName.get(key);
  if (!candidates || candidates.length === 0) return null;
  const largest = [...candidates].sort((a, b) => b.assetSize - a.assetSize)[0];

  if (key.length < MIN_KEY_LENGTH) {
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
  return { institutionId: largest.id, confidence: 0.5, method: "ambiguous_name", status: "needs_review", candidates: candidates.length };
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

/** external_key -> institution_id for links that may be used for data. */
export async function loadAcceptedLinks(db: RegistryDb, linkType: IdentityLinkType): Promise<Map<string, number>> {
  const rows = await db<Array<{ external_key: string; institution_id: number }>>`
    SELECT external_key, institution_id
      FROM institution_identity_links
     WHERE link_type = ${linkType} AND status = 'accepted' AND institution_id IS NOT NULL
  `;
  return new Map(rows.map((row) => [row.external_key, Number(row.institution_id)]));
}
