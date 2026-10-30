/**
 * Server reads behind the coverage and freshness line (coverage-line.ts, #1891). The fee and
 * schedule part always comes from `getInstitutionFeeCoverage`; the peer part comes from the read
 * the page already holds (the command center's briefing) or, for a board brief, from the same
 * peer group read every Hamilton screen uses (`getEnginePeerGroup`, #1893). Deterministic, no
 * provider call.
 */
import { getInstitutionFeeCoverage } from "@/lib/data-store/institution-coverage";
import type { InstitutionCoverage } from "./coverage-line";
import { getEnginePeerGroup, type EnginePeerOptions } from "./workspace/research";
import type { Briefing } from "./workspace/types";

/** The peer set a briefing read, sized the way its provenance counts it; null on a copy without the count. */
export function briefingPeer(briefing: Briefing | null): InstitutionCoverage["peer"] {
  const n = briefing?.provenance.peerGroup?.n;
  if (!briefing || typeof n !== "number") return null;
  return { label: briefing.peerLabel, institutions: n };
}

export async function readInstitutionCoverage(
  institution: { id: number; name: string },
  peer: InstitutionCoverage["peer"],
  now = new Date(),
): Promise<InstitutionCoverage> {
  const read = await getInstitutionFeeCoverage(institution.id);
  return {
    institutionId: institution.id,
    institutionName: institution.name,
    readAt: now.toISOString(),
    fees: read.fees,
    categories: read.categories,
    documents: read.documents,
    lastVerifiedAt: read.lastVerifiedAt,
    peer,
  };
}

/**
 * The coverage a board brief prints on its cover, read when the brief is saved. The peer size is
 * kept only when today's group is the one the saved answer names (`baselineLabel`); a different
 * group would contradict the cover's peer baseline, so the size is left out then.
 */
export async function readBriefCoverage(
  institution: { id: number; name: string },
  baselineLabel: string | null,
  options: EnginePeerOptions = {},
  now = new Date(),
): Promise<InstitutionCoverage> {
  const coverage = await readInstitutionCoverage(institution, null, now);
  if (!baselineLabel || coverage.categories.length === 0) return coverage;
  const group = await getEnginePeerGroup(institution.id, coverage.categories, options).catch(() => null);
  if (!group || group.peerLabel !== baselineLabel) return coverage;
  const institutions = new Set(group.fees.flatMap((f) => f.peers.map((p) => p.countedAs ?? p.institutionId))).size;
  return { ...coverage, peer: { label: group.peerLabel, institutions } };
}
