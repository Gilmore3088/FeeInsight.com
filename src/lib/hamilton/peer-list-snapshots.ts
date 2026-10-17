/** Durable user-scoped peer research snapshots in the EXISTING analyses ledger.
 * The typed page uses these only as research records. The saved page reopens the snapshot as it was
 * saved, and its CSV export (peer-list-export.ts) prints those same rows; no PDF is made of a list.
 */
import { insertSavedAnalysis } from "@/lib/data-store/hamilton-analyses";
import { loadHamiltonAccountContext } from "./account-context-store";
import { accountIdentitySnapshot } from "./account-context";
import { MAX_PEER_LIST_ROWS, type PeerListData, type PeerListResponse } from "./peer-list";
import type { AnalyzeResponse } from "./types";

type SnapshotAsker = { id: number; institution_name?: string | null };

export function peerSnapshotSignature(data: PeerListData): string {
  return JSON.stringify({
    version: data.version, status: data.status, subject: data.subject,
    criteria: data.criteria, rows: data.rows, totalMatches: data.totalMatches,
    feeComparison: data.feeComparison ?? null, offset: data.offset ?? 0,
  });
}

/** Compare a client-displayed snapshot to a fresh server recomputation. */
export function matchesFreshPeerSnapshot(expected: unknown, fresh: PeerListData): boolean {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return false;
  if (fresh.status !== "ready" || !fresh.subject ||
      fresh.rows.length > MAX_PEER_LIST_ROWS || fresh.rows.some(row => !Number.isSafeInteger(row.institutionId))) return false;
  const provided = expected as Partial<PeerListData>;
  if (provided.version !== 1 || provided.status !== "ready" ||
      !Array.isArray(provided.rows) || !provided.subject || !provided.criteria) return false;
  return peerSnapshotSignature(provided as PeerListData) === peerSnapshotSignature(fresh);
}

export async function savePeerResearchSnapshot(
  user: SnapshotAsker, question: unknown, response: PeerListResponse, expected: unknown,
): Promise<string | null> {
  if (typeof question !== "string" || question.length > 1000 ||
      !matchesFreshPeerSnapshot(expected, response.peerList) || !response.peerList.subject) return null;
  const subject = response.peerList.subject;
  const account = await loadHamiltonAccountContext(user);
  const analysis: AnalyzeResponse & { peerListSnapshot: PeerListData } = {
    title: "Peer research for " + subject.name,
    confidence: { level: "low", basis: ["Deterministic institution filings and published fee records; independently review source dates and coverage."] },
    hamiltonView: response.shortAnswer,
    whatThisMeans: "This saved research records only the displayed peer IDs, dated asset records, selection criteria and published fees from the original question. It does not dynamically choose replacement peers.",
    whyItMatters: ["Missing fee data must not be treated as zero. Multiple valid fee rows remain separate."],
    evidence: { metrics: [{ label: "Selected institutions", value: String(response.peerList.rows.length) }] },
    exploreFurther: [],
    identityContext: accountIdentitySnapshot(subject.institutionId, account, {
      researchInstitutionName: subject.name,
      researchSelectionSource: "Saved, server-revalidated peer research",
      peerSetId: response.peerList.criteria?.peerSetId ?? null,
      peerBaselineLabel: response.peerList.criteria?.peerSetLabel ?? null,
      peerBaselineSource: null,
      peerBaselineFallbackReason: null,
    }),
    peerListSnapshot: response.peerList,
  };
  return insertSavedAnalysis({
    userId: user.id, institutionId: String(subject.institutionId),
    title: analysis.title, analysisFocus: "Exact peer research snapshot",
    prompt: question, response: analysis,
  });
}
