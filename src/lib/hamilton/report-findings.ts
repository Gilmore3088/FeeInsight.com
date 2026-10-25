/**
 * The reader's added findings as a report reads them (#1899), server side, for the paid report
 * (`reports/actions.ts`) and the board brief (`reports/board-actions.ts`) alike. Not a "use server"
 * module, so nothing here can be called from the browser.
 *
 * - A saved Ask answer is re-read with numeric-user scoping and read through its saved claims
 *   (#1077 step 6; report-saved-finding.ts): its detail is its supported sentences only, its claims
 *   and Hamilton's reading ride with it server side, and its evidence is the answer's own, as saved.
 * - A Position or Test finding is re-read against the report's peers (report-finding-evidence.ts):
 *   its title, detail and evidence come from the institution's published fees, never the browser.
 */

import { getInstitutionById } from "@/lib/data-store";
import { getInstitutionOwnFees, type IndexEntry } from "@/lib/data-store/fee-index";
import { resolveHamiltonPeerIndex } from "./peer-index";
import type { InstitutionOwnFee } from "@/lib/own-fee";
import { readHamiltonIdentitySnapshot } from "./identity-display";
import { basketItemsFor, sanitizeBasketItems, type ReportBasketItem } from "./report-basket";
import { positionFinding, savedAnswerEvidence, testFinding } from "./report-finding-evidence";
import { savedAnswerFinding } from "./report-saved-finding";
import { readSavedAnalysisRecord } from "./saved-analysis-record";
import type { ReportSummaryResponse } from "./types";

export interface ReportFindingPeers {
  /** The report's peer index, one entry per fee category. */
  entries: readonly IndexEntry[];
  /** The peer group's name, as the report names it. */
  label: string;
  /** The institution the report is about; null leaves Position and Test findings out. */
  institutionName: string | null;
}

export interface ReportFindingOptions {
  /** When the report reads the figures; defaults to now. */
  now?: Date;
  /** The institution's own published fees by category; defaults to the catalog read. */
  loadOwnFees?: (institutionId: number, categories: string[]) => Promise<Map<string, InstitutionOwnFee>>;
}

/** A saved Ask answer as a finding, or null when it is not one to restate. */
async function savedAskFinding(item: ReportBasketItem & { savedAnalysisId: string }): Promise<ReportBasketItem | null> {
  // The server-only read: the saved claims are kept here (never in what a browser receives).
  const saved = await readSavedAnalysisRecord(item.savedAnalysisId);
  if (!saved || typeof saved.responseJson.hamiltonView !== "string") return null;
  // An answer that failed the evidence gate when it was saved is not a finding to restate.
  if (saved.responseJson.answerEvidence?.passed === false) return null;
  const { detail, reading, claims } = savedAnswerFinding(saved.responseJson);
  // No supported sentence left: the title alone is model prose with nothing behind it.
  if (!detail) return null;
  const identity = readHamiltonIdentitySnapshot(saved.responseJson.identityContext);
  return {
    ...item,
    // A saved-answer reference authenticates its original content as well as
    // its identity; browser edits cannot relabel another institution's answer.
    title: saved.responseJson.title,
    detail,
    ...(claims ? { savedClaims: claims } : {}),
    ...(reading.length ? { reading } : {}),
    institutionId: saved.institutionId,
    ...(identity ? { identityContext: identity } : { identityContext: undefined }),
    evidence: savedAnswerEvidence(saved.responseJson, saved.savedAt),
  };
}

/**
 * The browser's basket, authenticated and re-read for one institution's report. Items for another
 * institution are left out; a Position or Test finding without a category or institution is left
 * out, since there is nothing to re-read it against.
 */
export async function authenticatedReportFindings(
  raw: unknown,
  institutionId: string | null,
  peers: ReportFindingPeers | null,
  options: ReportFindingOptions = {},
): Promise<ReportBasketItem[]> {
  const items = await Promise.all(sanitizeBasketItems(raw).map(async (item): Promise<ReportBasketItem | null> => {
    if (item.source === "Ask") {
      if (item.savedAnalysisId) return savedAskFinding({ ...item, savedAnalysisId: item.savedAnalysisId });
      // An Ask finding with no saved answer behind it has no record to re-read: it is not restated.
      return null;
    }
    // Browser metadata can identify a research selection but cannot establish who the
    // account represented when a historic answer was generated.
    return { ...item, identityContext: undefined };
  }));
  const scoped = basketItemsFor(items.filter((item): item is ReportBasketItem => item !== null), institutionId);
  return withPeerFindings(scoped, institutionId, peers, options);
}

async function withPeerFindings(
  items: ReportBasketItem[],
  institutionId: string | null,
  peers: ReportFindingPeers | null,
  options: ReportFindingOptions,
): Promise<ReportBasketItem[]> {
  const id = institutionId && /^\d+$/.test(institutionId) ? Number(institutionId) : null;
  const peerItems = items.filter((item) => item.source !== "Ask");
  if (!peerItems.length) return items;
  if (id === null || !peers?.institutionName) return items.filter((item) => item.source === "Ask");
  const categories = [...new Set(peerItems.map((item) => item.feeCategory).filter((c): c is string => Boolean(c)))];
  const load = options.loadOwnFees ?? getInstitutionOwnFees;
  const ownFees = categories.length ? await load(id, categories) : new Map<string, InstitutionOwnFee>();
  const readAt = (options.now ?? new Date()).toISOString();
  const byCategory = new Map(peers.entries.map((entry) => [entry.fee_category, entry]));
  const institutionName = peers.institutionName;
  return items.flatMap((item): ReportBasketItem[] => {
    if (item.source === "Ask") return [item];
    if (!item.feeCategory) return [];
    const input = {
      feeCategory: item.feeCategory,
      institutionName,
      own: ownFees.get(item.feeCategory) ?? null,
      peer: byCategory.get(item.feeCategory) ?? null,
      peerLabel: peers.label,
      readAt,
    };
    const rebuilt = item.source === "Test" ? testFinding({ ...input, proposedFee: item.proposedFee ?? null }) : positionFinding(input);
    return [{ ...item, title: rebuilt.title, detail: rebuilt.detail, evidence: rebuilt.evidence, institutionId: String(id) }];
  });
}

/**
 * The findings a board brief made from one saved answer carries (#1899): the reader's added
 * findings for the answer's institution, the answer itself left out (it is the brief), Position
 * and Test findings re-read against the institution's default peers, as on Position.
 */
export async function boardBriefFindings(
  raw: unknown,
  brief: { analysisId: string; institutionId: string | null; userId: number | string },
  options: ReportFindingOptions & { loadPeers?: (institutionId: number) => Promise<ReportFindingPeers | null> } = {},
): Promise<ReportBasketItem[]> {
  const items = sanitizeBasketItems(raw).filter((item) => item.savedAnalysisId !== brief.analysisId);
  if (!items.length || !brief.institutionId) return [];
  const id = /^\d+$/.test(brief.institutionId) ? Number(brief.institutionId) : null;
  const needsPeers = items.some((item) => item.source !== "Ask");
  const loadPeers = options.loadPeers ?? ((institutionId: number) => defaultPeers(institutionId, brief.userId));
  const peers = needsPeers && id !== null ? await loadPeers(id) : null;
  return authenticatedReportFindings(items, brief.institutionId, peers, options);
}

/** The institution's default peer read, the one Position compares against. */
async function defaultPeers(institutionId: number, userId: number | string): Promise<ReportFindingPeers | null> {
  const institution = await getInstitutionById(institutionId);
  if (!institution) return null;
  const index = await resolveHamiltonPeerIndex({ selectedInstitution: institution, institutionId, userId });
  return { entries: index.entries, label: index.label, institutionName: institution.institution_name };
}

/** The findings as a report stores them; a saved answer's reading only with the switch on. */
export function reportAddedFindings(items: readonly ReportBasketItem[], printReading: boolean): NonNullable<ReportSummaryResponse["addedFindings"]> {
  return items.map((f) => ({
    source: f.source, title: f.title, detail: f.detail,
    ...(printReading && f.reading?.length ? { reading: [...f.reading] } : {}),
    ...(f.identityContext ? { identityContext: f.identityContext } : {}),
    ...(f.evidence ? { evidence: f.evidence } : {}),
  }));
}
